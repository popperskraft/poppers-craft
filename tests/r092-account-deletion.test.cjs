/* r092: удаление аккаунта самим игроком (пароль или код из письма) и
   редакция соглашения 1.2. */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const read=p=>fs.readFileSync(p,'utf8');
function loadTs(file,mocks={},cache=new Map()){
  const full=path.resolve(file);
  if(cache.has(full))return cache.get(full);
  const exports={};cache.set(full,exports);
  const code=ts.transpileModule(read(full),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
  const localRequire=name=>{
    if(name in mocks)return mocks[name];
    if(name==='server-only')return {};
    if(name.startsWith('@/')||name.startsWith('.')){
      const base=name.startsWith('@/')?path.resolve(name.slice(2)):path.resolve(path.dirname(full),name);
      for(const candidate of [base+'.ts',base+'.tsx'])if(fs.existsSync(candidate))return loadTs(candidate,mocks,cache);
      throw new Error('Cannot resolve '+name);
    }
    return require(name);
  };
  vm.runInNewContext(code,{exports,module:{exports},require:localRequire,Buffer,console,process,Date,Math,JSON,Promise},{filename:full});
  return exports;
}

function fakeAuth(){
  const calls=[];let meta={};
  const admin={
    auth:{admin:{
      updateUserById:async(id,patch)=>{calls.push(['update',id,JSON.parse(JSON.stringify(patch))]);meta={...meta,...patch.app_metadata};return {error:null};},
      getUserById:async()=>({data:{user:{app_metadata:meta}},error:null}),
      deleteUser:async(id,soft)=>{calls.push(['deleteUser',id,soft]);return {error:null};},
    }},
    from:table=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:table==='waitlist_applications'?{id:42}:null,error:null})})})}),
  };
  return {admin,calls,meta:()=>meta};
}

test('email code: six digits, stored only as a hash, 15 minutes, five attempts',async()=>{
  const auth=fakeAuth();
  const lib=loadTs('lib/account-deletion.ts',{
    '@/lib/supabase/admin':{createSupabaseAdminClient:()=>auth.admin},
    '@/lib/payments':{forgetCard:async()=>{}},
    '@/lib/ai-connect/oauth':{revokeAllAiTokens:async()=>{}},
    '@/lib/player-account-deletion':{permanentlyDeletePlayerAccount:async()=>{}},
    '@supabase/supabase-js':{createClient:()=>({})},
  });
  const code=await lib.issueDeletionCode('u1');
  assert.match(code,/^\d{6}$/);
  const stored=auth.meta().account_delete;
  assert.ok(!JSON.stringify(stored).includes(code),'the code itself is not stored');
  assert.equal(stored.attempts,0);
  assert.ok(Date.parse(stored.expiresAt)-Date.now()<=15*60_000+1000);
  assert.equal((await lib.checkDeletionCode('u1','12')).ok,false);
  const wrong=code==='000000'?'111111':'000000';
  assert.deepEqual({...(await lib.checkDeletionCode('u1',wrong))},{ok:false,error:'Неверный код.'});
  assert.equal(auth.meta().account_delete.attempts,1);
  assert.equal((await lib.checkDeletionCode('u1',code)).ok,true);
  assert.equal(auth.meta().account_delete,null,'a used code is cleared');
  assert.equal((await lib.checkDeletionCode('u1',code)).ok,false,'a code works once');
  /* После пяти ошибок даже верный код не принимается. */
  const again=await lib.issueDeletionCode('u1');
  for(let i=0;i<5;i++)await lib.checkDeletionCode('u1',again==='000000'?'111111':'000000');
  assert.match((await lib.checkDeletionCode('u1',again)).error,/Слишком много/);
});

test('deleting: charges stopped first, then the same deletion as in admin',async()=>{
  const order=[];const auth=fakeAuth();
  const lib=loadTs('lib/account-deletion.ts',{
    '@/lib/supabase/admin':{createSupabaseAdminClient:()=>auth.admin},
    '@/lib/payments':{forgetCard:async id=>order.push(['forgetCard',id])},
    '@/lib/ai-connect/oauth':{revokeAllAiTokens:async id=>order.push(['revokeAi',id])},
    '@/lib/player-account-deletion':{permanentlyDeletePlayerAccount:async args=>order.push(['delete',args.applicationId,args.userId])},
    '@supabase/supabase-js':{createClient:()=>({})},
  });
  await lib.deleteOwnAccount('u1');
  assert.deepEqual(JSON.parse(JSON.stringify(order)),[['forgetCard','u1'],['revokeAi','u1'],['delete',42,'u1']]);
});

test('route: full sign-in, no admins, explicit confirmation, rate limits, sign-out',()=>{
  const route=read('app/api/profile/delete/route.ts');
  assert.match(route,/if \(!sameOriginOrMissing\(request\)\)/);
  assert.match(route,/identity\.needsMfa/);
  assert.match(route,/if \(identity\.adminProfile\) return reply/);
  assert.match(route,/if \(body\.confirm !== true\)/);
  assert.match(route,/scope: "account-delete-code", key: userId, limit: 3/);
  assert.match(route,/scope: "account-delete", key: userId, limit: 10/);
  assert.match(route,/if \(!isRealEmail\(email\)\)/);
  assert.ok(route.indexOf('checkDeletionCode')<route.indexOf('deleteOwnAccount(userId)')&&route.indexOf('checkPassword')<route.indexOf('deleteOwnAccount(userId)'));
  assert.match(route,/auth\.signOut\(\{ scope: "local" \}\)/);
  const lib=read('lib/account-deletion.ts');
  assert.match(lib,/signOut\(\{ scope: "local" \}\)/,'the password probe closes only its own session');
  const page=read('app/profile/page.tsx');
  assert.match(page,/<DeleteAccount hasEmail=\{isRealEmail\(viewer\.user\.email\)\} staff=\{Boolean\(viewer\.adminProfile\)\} \/>/);
  const ui=read('app/profile/DeleteAccount.tsx');
  assert.match(ui,/disabled=\{Boolean\(busy\) \|\| !confirm\}/);
  assert.match(ui,/disabled=\{!hasEmail\}/);
});

test('agreement 1.2: self-deletion, new subscription path, changes shown on acceptance',()=>{
  const agreement=loadTs('lib/user-agreement.ts');
  assert.equal(agreement.AGREEMENT_VERSION,'1.2');
  assert.equal(agreement.AGREEMENT_DATE,'2 октября 2026 года');
  const text=JSON.stringify(agreement.AGREEMENT_SECTIONS);
  assert.match(text,/«Профиль → Настройки → Аккаунт и почта → Удаление аккаунта»/);
  assert.match(text,/«Профиль → Подписка»/);
  assert.ok(!/Настройки профиля|настройки профиля/.test(text));
  assert.equal(agreement.AGREEMENT_CHANGES.length,2);
  assert.match(read('app/UserAgreementGate.tsx'),/AGREEMENT_CHANGES\.map/);
  const rules=read('app/rules/page.tsx');
  assert.match(rules,/РЕДАКЦИЯ ОТ 2 ОКТЯБРЯ 2026 ГОДА/);
  assert.ok(!rules.includes('Настройки профиля'));
  assert.match(rules,/Удалить аккаунт можно на сайте: «Профиль → Настройки → Аккаунт и почта → Удаление аккаунта»/);
});

test('texts are translated',()=>{
  const {EN_PHRASES}=loadTs('lib/i18n/en.ts');
  const translate=loadTs('lib/i18n/translate.ts').createTranslator(EN_PHRASES);
  const agreement=loadTs('lib/user-agreement.ts');
  for(const line of agreement.AGREEMENT_CHANGES)assert.ok(translate(line),line);
  assert.ok(translate(agreement.AGREEMENT_SECTIONS.find(section=>section.heading==='3. Аккаунт').items.at(-1)));
  assert.ok(translate('НОВОЕ В РЕДАКЦИИ 1.2'));
  const source=ts.createSourceFile('d.tsx',read('app/profile/DeleteAccount.tsx'),99,true);
  (function visit(node){if((ts.isStringLiteralLike(node)||ts.isJsxText(node))&&/[А-Яа-яЁё]/.test(node.text)){const text=node.text.replace(/\s+/g,' ').trim();if(text)assert.ok(translate(text),text);}ts.forEachChild(node,visit);})(source);
});

/* r092: студия «Редактировать профиль» и масштаб 90%. */
test('edit studio: live card on the left, every editor on the right',()=>{
  const studio=read('app/profile/ProfileEditStudio.tsx');
  assert.match(studio,/<aside className="profile-studio-preview"/);
  assert.match(studio,/<ProfileCard card=\{shown\} className="profile-studio-card" \/>/);
  for(const editor of ['<CommunityProfileEditor','hidePreview','onPreview={onProfilePreview}','onPreview={onLookPreview}','<SkinForm','onSaved={bumpSkin}'])assert.ok(studio.includes(editor),editor);
  /* Колбэки стабильны — иначе эффекты редакторов зациклятся. */
  assert.match(studio,/const onProfilePreview = useCallback\(/);
  assert.match(studio,/const onLookPreview = useCallback\(/);
  const community=read('app/profile/CommunityProfileEditor.tsx');
  assert.match(community,/onInput=\{\(event\) => previewFields\(event\.currentTarget\)\}/);
  assert.match(community,/if \(!previewMounted\.current\) \{ previewMounted\.current = true; return; \}/,'no false "not saved" on open');
  assert.match(read('app/profile/PlusStudio.tsx'),/onPreview\?\.\(\{ active, hype, ring: option\.id, theme: studio\.theme \}\)/);
  const overview=read('app/profile/ProfileOverview.tsx');
  assert.ok(!overview.includes('КАК ВИДЯТ ДРУГИЕ'),'no button that leaves the profile window');
  assert.match(overview,/<ProfileCard card=\{toProfileCardData\(profile\)\} \/>/);
  const css=read('app/profile/profile-window.css');
  assert.match(css,/grid-template-columns: minmax\(0, 1fr\) clamp\(400px, 36%, 540px\);/,'settings on the right');
});

/* r093: владелец отменил масштаб 90% — сайт снова в натуральную величину. */
test('site scale cancelled: no page zoom, original sizes and measurements',()=>{
  assert.ok(!fs.existsSync('app/site-scale.css'));
  assert.ok(!fs.existsSync('lib/page-zoom.ts'));
  assert.ok(!read('app/layout.tsx').includes('site-scale'));
  function walk(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(entry=>{const full=path.join(dir,entry.name);return entry.isDirectory()?walk(full):/\.(css|tsx?)$/.test(entry.name)?[full]:[];});}
  for(const file of [...walk('app'),...walk('lib')]){
    const text=read(file);
    assert.ok(!/site-zoom|pageZoom/.test(text),`${file}: leftover of the page scale`);
    if(file.endsWith('.css')) assert.ok(!/:root\s*\{[^}]*\bzoom:/.test(text),`${file}: page zoom on :root`);
  }
  assert.match(read('app/GrammarAssistant.tsx'),/left: Math\.max\(8, rect\.right - 38\), top: Math\.max\(8, rect\.top \+ 8\)/);
  assert.match(read('app/donation/DonationSection.tsx'),/x: shift \/ FINAL_SCENE_SCALE/);
});

/* Находки проверки r092. */
test('review fixes: queue signatures, charge job, studio refresh',()=>{
  const proxy=read('proxy.ts');
  assert.match(proxy,/readSigned\(request\.cookies\.get\("pc_in"\)\?\.value, signPass\)/);
  assert.match(proxy,/readSigned\(request\.cookies\.get\("pc_q"\)\?\.value, signTicket\)/);
  assert.match(proxy,/update\(`\$\{purpose\}:\$\{value\}`\)/);
  const payments=read('lib/payments.ts');
  assert.match(payments,/const application = await applicationFor\(subscription\.user_id\)\.catch\(\(\) => undefined\);\n\s*if \(application === undefined\) continue;/);
  const studio=read('app/profile/ProfileEditStudio.tsx');
  assert.match(studio,/const keepFields = profileSaved\.current \? LOOK_FIELDS : \[\.\.\.SAVED_FIELDS, \.\.\.LOOK_FIELDS\];/);
  assert.match(studio,/onSaved=\{onProfileSaved\}/);
});

/* r094: карточка в студии без своей прокрутки и без zoom; скин отдаётся и на popperscraft.org без www. */
test('studio card sits in the page; skins load cross-origin',()=>{
  const css=read('app/profile/profile-window.css');
  const studio=css.slice(css.indexOf('.profile-studio {'));
  assert.ok(!/zoom|sticky|overflow: auto|max-height/.test(studio),'studio card must not scroll on its own or be zoomed');
  assert.match(studio,/container: studio-card \/ inline-size;/,'card layout follows its own width');
  assert.match(studio,/@container studio-card \(max-width: 560px\)[\s\S]*grid-template-columns: 1fr;/);
  assert.match(studio,/grid-template-columns: minmax\(0, 1fr\) clamp\(400px, 36%, 540px\);/);
  assert.match(read('app/api/skins/[login]/route.ts'),/"Access-Control-Allow-Origin":"\*"/);
});
