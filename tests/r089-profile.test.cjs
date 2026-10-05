/* r089: окно профиля из трёх разделов (Профиль / Настройки / Подписка),
   активные устройства и превью ссылки без «недонатной помойки». */
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
  vm.runInNewContext(code,{exports,module:{exports},require:localRequire,Buffer,URL,console,process,Date,Math,JSON},{filename:full});
  return exports;
}
const plain=value=>JSON.parse(JSON.stringify(value));

test('profile window: three sections, editing mode and old tab links',()=>{
  const view=loadTs('lib/profile-view.ts');
  assert.deepEqual(plain(view.resolveProfileView({})),{tab:'profile',editing:false,section:null});
  assert.deepEqual(plain(view.resolveProfileView({edit:'1'})),{tab:'profile',editing:true,section:null});
  assert.deepEqual(plain(view.resolveProfileView({tab:'settings',section:'devices'})),{tab:'settings',editing:false,section:'devices'});
  assert.deepEqual(plain(view.resolveProfileView({tab:'settings',section:'nope'})),{tab:'settings',editing:false,section:null});
  assert.deepEqual(plain(view.resolveProfileView({tab:'subscription',edit:'1'})),{tab:'subscription',editing:false,section:null});
  /* Старые вкладки до r089. */
  assert.deepEqual(plain(view.resolveProfileView({tab:'payments'})),{tab:'subscription',editing:false,section:null});
  assert.deepEqual(plain(view.resolveProfileView({tab:'plus'})),{tab:'profile',editing:true,section:null});
  assert.deepEqual(plain(view.resolveProfileView({tab:'appearance'})),{tab:'profile',editing:true,section:null});
  assert.deepEqual(plain(view.resolveProfileView({tab:'referrals'})),{tab:'settings',editing:false,section:'referrals'});
  assert.deepEqual(plain(view.resolveProfileView({tab:'ai'})),{tab:'settings',editing:false,section:'ai'});
  assert.equal(view.profileViewHref({tab:'profile'}),'/profile');
  assert.equal(view.profileViewHref({tab:'profile',editing:true}),'/profile?edit=1');
  assert.equal(view.profileViewHref({tab:'settings',section:'security'}),'/profile?tab=settings&section=security');
  assert.equal(view.profileViewHref({tab:'subscription'}),'/profile?tab=subscription');

  const page=read('app/profile/page.tsx');
  assert.match(page,/\{ id: "profile", label: "ПРОФИЛЬ"[\s\S]*\{ id: "settings", label: "НАСТРОЙКИ"[\s\S]*\{ id: "subscription", label: "ПОДПИСКА"/);
  assert.match(page,/<ProfileOverview viewer=\{viewer\} \/>/);
  /* Скин, модели и гардероб — в редактировании профиля, не в настройках аккаунта. */
  /* r092: редактирование — студия с живой карточкой (ProfileEditStudio). */
  assert.match(page,/<ProfileEditStudio\n\s*card=\{editCard\}/);
  const editor=read('app/profile/ProfileEditStudio.tsx');
  for(const id of ['plus-skin','plus-models'])assert.ok(editor.includes(`id="${id}"`),id);
  const settings=page.slice(page.indexOf('view.tab === "settings"'),page.indexOf('view.tab === "subscription"'));
  for(const label of ['АККАУНТ И ПОЧТА','ВХОД И БЕЗОПАСНОСТЬ','АКТИВНЫЕ УСТРОЙСТВА','ЯЗЫК САЙТА','ПРИГЛАСИТЬ ДРУГА','НЕЙРОСЕТИ'])assert.ok(settings.includes(`label: "${label}"`),label);
  for(const editorOnly of ['<SkinForm','<LooksWardrobe','<CommunityProfileEditor'])assert.ok(!settings.includes(editorOnly),editorOnly);
  /* Ник сменить нельзя (решение владельца) — в настройках только пояснение. */
  assert.match(settings,/сменить его нельзя/);
  const subscription=page.slice(page.indexOf('view.tab === "subscription"'));
  assert.match(subscription,/<PaymentsPanel afterPlan=\{<PlusStudio login=\{viewer\.profile\.login\} parts=\{\["perks", "tenure", "early"\]\} \/>\} \/>/);
  const menu=read('app/ProfileMenu.tsx');
  /* r100: под зелёной «Профиль» — только «Выйти»; «Список игроков» — пункт шапки. */
  assert.ok(menu.includes('ВЫЙТИ')&&!menu.includes('СПИСОК ИГРОКОВ'));
  assert.match(read('app/plus/page.tsx'),/redirect\("\/profile\?tab=subscription"\)/);
  /* Отключить подписку = выключить автопродление — кнопка в «Подписке». */
  assert.match(read('app/profile/PaymentsPanel.tsx'),/ОТКЛЮЧИТЬ АВТОПРОДЛЕНИЕ/);
});

test('device names for the active devices list',()=>{
  const {describeDevice}=loadTs('lib/device-label.ts');
  const name=ua=>plain(describeDevice(ua));
  assert.deepEqual(name('PoppersCraft-Launcher-API/1.0'),{kind:'launcher',label:'Лаунчер PoppersCraft'});
  assert.deepEqual(name(''),{kind:'unknown',label:'Устройство без данных'});
  assert.deepEqual(name('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Safari/605.1.15'),{kind:'computer',label:'Safari · macOS'});
  assert.deepEqual(name('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36'),{kind:'computer',label:'Chrome · Windows'});
  assert.deepEqual(name('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0 Safari/537.36 Edg/140.0'),{kind:'computer',label:'Edge · Windows'});
  assert.deepEqual(name('Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148'),{kind:'phone',label:'Приложение PoppersCraft · iPhone'});
  assert.deepEqual(name('Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/140.0 Mobile Safari/537.36 YaBrowser/25.1'),{kind:'phone',label:'Яндекс Браузер · Android'});
});

test('sessions: own sessions only, never the current one, written lazily',async()=>{
  const calls=[];
  const admin={from:table=>({upsert:async(row)=>{calls.push(['upsert',table,row]);return {error:null};}}),rpc:async(name,args)=>{calls.push(['rpc',name,args]);return name==='pc_end_sessions'?{data:args.p_sessions.length,error:null}:{data:[],error:null};}};
  const lib=loadTs('lib/session-devices.ts',{'@/lib/supabase/admin':{createSupabaseAdminClient:()=>admin},'@/lib/supabase/server':{createSupabaseServerClient:async()=>({})}});
  const session='11111111-2222-3333-4444-555555555555',other='66666666-7777-8888-9999-000000000000';
  const token=['x',Buffer.from(JSON.stringify({sub:'user-1',session_id:session})).toString('base64url'),'y'].join('.');
  assert.equal(lib.sessionIdFromAccessToken(token,'user-1'),session);
  assert.equal(lib.sessionIdFromAccessToken(token,'someone-else'),null);
  assert.equal(lib.sessionIdFromAccessToken('garbage'),null);
  assert.equal(await lib.endSessions('user-1',[session],session),0,'current session is never ended here');
  assert.equal(await lib.endSessions('user-1',[other,'not-a-uuid',other],session),1);
  assert.deepEqual(plain(calls.at(-1)),['rpc','pc_end_sessions',{p_user:'user-1',p_sessions:[other]}]);
  await lib.rememberDevice({sessionId:session,userId:'user-1',userAgent:'UA',ip:'1.2.3.4'});
  await lib.rememberDevice({sessionId:session,userId:'user-1',userAgent:'UA',ip:'1.2.3.4'});
  assert.equal(calls.filter(call=>call[0]==='upsert').length,1,'at most once per 15 minutes');
  const route=read('app/api/profile/sessions/route.ts');
  assert.match(route,/if \(!sameOriginOrMissing\(request\)\)/);
  assert.match(route,/identity\.needsMfa/);
  assert.match(route,/const others = devices\.filter\(\(device\) => !device\.current\)/);
  const migration=read('supabase/migrations/20261002200000_r089_session_devices.sql');
  assert.match(migration,/revoke all on public\.pc_session_devices from anon, authenticated;/);
  assert.match(migration,/revoke all on function public\.pc_end_sessions\(uuid, uuid\[\]\) from public, anon, authenticated;/);
  assert.match(migration,/delete from auth\.sessions where user_id = p_user and id = any\(p_sessions\);/);
  assert.match(read('app/layout.tsx'),/after\(\(\) => rememberDevice\(device\)\.catch\(\(\) => undefined\)\)/);
  const login=read('app/api/login/route.ts');
  assert.ok(login.indexOf('await rememberDevice({')>login.indexOf('if (error || !data.user)'),'remembered only after a successful sign-in');
});

test('link preview text and translations',()=>{
  const layout=read('app/layout.tsx');
  assert.match(layout,/: "Майнкрафт сервер";/);
  assert.ok(!layout.includes('ПОМОЙКА'));
  const {EN_PHRASES}=loadTs('lib/i18n/en.ts');
  const translate=loadTs('lib/i18n/translate.ts').createTranslator(EN_PHRASES);
  for(const file of ['app/profile/page.tsx','app/profile/ProfileOverview.tsx','app/profile/DevicesPanel.tsx','app/profile/ProfileSettings.tsx','app/ProfileMenu.tsx','lib/device-label.ts']){
    const source=ts.createSourceFile(file,read(file),99,true);
    (function visit(node){if((ts.isStringLiteralLike(node)||ts.isJsxText(node))&&/[А-Яа-яЁё]/.test(node.text)){const text=node.text.replace(/\s+/g,' ').trim();if(text)assert.ok(translate(text),`${file}: ${text}`);}ts.forEachChild(node,visit);})(source);
  }
  for(const label of ['Приложение PoppersCraft · iPhone','Яндекс Браузер · Windows'])assert.ok(translate(label),label);
});
