const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const read=p=>fs.readFileSync(p,'utf8');
function load(p,require){const exports={};vm.runInNewContext(ts.transpileModule(read(p),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require});return exports;}
test('home keeps overview/feed content but removes obsolete nav and Discord section',()=>{
 const home=read('app/HomePage.tsx'),nav=home.match(/<nav className=\{menuOpen[\s\S]*?<\/nav>/)[0];
 /* r079: пункты меню общие для главной и остальных страниц (lib/site-navigation.ts).
    «Лента» вернулась в меню одобренных игроков по решению владельца; гостям её нет. */
 assert.match(nav,/navItems\.map/);
 const {mainNavItems}=load('lib/site-navigation.ts',()=>({}));
 for(const viewer of [null,{authenticated:true,approved:true,admin:false},{authenticated:true,approved:false,admin:true}]){
  const hrefs=mainNavItems(viewer).map(item=>item.href);
  /* r090: PLUS в меню — только у гостей (тарифы); игрокам подписка в «Профиль ▾ → Подписка». */
  assert.equal(hrefs.includes('/plus'),viewer===null);for(const target of ['#overview','/#overview','#discord','/#discord'])assert.ok(!hrefs.includes(target));
 }
 assert.ok(!mainNavItems(null).some(item=>item.href==='/feed'));
 assert.ok(!home.includes('id="discord"'));assert.ok(home.includes('id="overview"'));assert.ok(home.includes('renderBoards(updates, "before-discord")'));
 assert.ok(fs.existsSync('app/feed/page.tsx'));
 /* r100: под «Профиль» в шапке только «Выйти»; «Список игроков» — пункт шапки, подписка — вкладка окна профиля. */
 assert.ok(!read('app/ProfileMenu.tsx').includes('href="/players"'));
 assert.ok(read('lib/site-navigation.ts').includes('{ label: "Список игроков", href: "/players", match: ["/players"] }'));
 assert.ok(read('app/ProfileMenu.tsx').includes('ВЫЙТИ'));
 assert.ok(!read('app/ProfileMenu.tsx').includes('tab=subscription'));
});
function plusPage({identity=null,viewer=true,active=false,tier='plus',uploads=1}={}){
 const element=(type,props)=>({type,props});
 return load('app/plus/page.tsx',name=>{
  if(name==='react/jsx-runtime')return {jsx:element,jsxs:element};
  if(name==='next/navigation')return {redirect:url=>{throw new Error('redirect:'+url)}};
  if(name==='next/link')return {default:'Link'};
  if(name==='@/lib/waitlist')return {getViewerIdentity:async()=>identity};
  if(name==='@/lib/community')return {getCommunityViewer:async()=>viewer?{user:{id:'test',user_metadata:{},app_metadata:{}},profile:{login:'player',display_name:'Player'}}:null};
  if(name==='@/lib/player-marks')return {marksFor:async()=>({plus:active,tier,headerFrames:[],headerFrameMs:400,ring:'pink'})};
  if(name==='@/lib/player-skins')return {skinUploadsUsed:()=>uploads};
  if(name==='@/lib/plus-style')return {TIER_NAME:{plus:'POPPERS+',hype:'POPPERS HYPE'}};
  const key=name.split('/').pop();return {[key]:key};
 }).default();
}
function find(node,type){if(!node||typeof node!=='object')return null;if(node.type===type)return node;const children=node.props?.children??[];for(const child of [children].flat(Infinity)){const found=find(child,type);if(found)return found;}return null;}
test('PLUS server route sends guests and inactive subscriptions to plans',async()=>{
 await assert.rejects(plusPage(),/redirect:\/donation/);
 await assert.rejects(plusPage({identity:{user:{id:'test'}}}),/redirect:\/donation/);
});
test('PLUS route retains MFA and unavailable-profile safeguards',async()=>{
 await assert.rejects(plusPage({identity:{needsMfa:true}}),/redirect:\/mfa\?next=\/plus/);
 await assert.rejects(plusPage({identity:{},viewer:false}),/redirect:\/$/);
});
/* r089: настройки подписки переехали в окно профиля — /plus у подписчика
   открывает «Подписку», а все редакторы оформления живут в «Профиль → Редактировать». */
test('active PLUS and HYPE go to the subscription section; editors live in profile editing',async()=>{
 for(const tier of ['plus','hype'])await assert.rejects(plusPage({identity:{},active:true,tier}),/redirect:\/profile\?tab=subscription/);
 const page=read('app/profile/page.tsx'),editor=read('app/profile/ProfileEditStudio.tsx');/* r092: редакторы — в студии с живой карточкой. */
 for(const type of ['<CommunityProfileEditor','<PlusStudio integrated','<SkinForm','href="/models"'])assert.ok(editor.includes(type),type);
 /* r096: гардероб скинов переехал в лаунчер — на сайте его нет (решение владельца). */
 assert.ok(!editor.includes('<LooksWardrobe'));
 assert.match(editor,/parts=\{\["ring", "theme", "pinned"\]\}/);
 /* Права на загрузку скина не шире прежних: файл — один раз, дальше только HYPE. */
 assert.match(page,/const canUploadSkin = hype \? true : skinUploadsUsed\(viewer\.user\.id, viewer\.user\.user_metadata, viewer\.user\.app_metadata\) < 1;/);
});
test('embedded models preserve route/drafts and do not steal header undo shortcuts',()=>{
 assert.match(read('app/models/ModelStudio.tsx'),/if\(!embedded\)window.history.replaceState/);
 assert.match(read('app/plus/PlusModelPanel.tsx'),/visited \? <ModelStudio embedded active=\{open\}/);
 for(const file of ['HumanEditor','ModelEditor'])assert.match(read(`app/models/${file}.tsx`),/embedded&&.*closest\('\.models-page'\)/);
});
test('pin choices are own posts only; mutation still uses existing protected endpoint',()=>{
 assert.match(read('app/api/profile/plus/route.ts'),/select\("id,title"\)\.eq\("author_id", userId\)/);
 assert.match(read('app/profile/PlusStudio.tsx'),/\/api\/feed\/posts\/\$\{selectedPost\}\/pin/);
 assert.match(read('lib/plus-perks.ts'),/post.author_id !== userId/);
});
test('changed UI labels have manual English translations; language control keeps native names and error state',()=>{
 const {EN_PHRASES}=load('lib/i18n/en.ts');const translate=load('lib/i18n/translate.ts').createTranslator(EN_PHRASES);
 for(const file of ['app/plus/page.tsx','app/plus/PlusModelPanel.tsx','app/profile/PlusStudio.tsx','app/profile/LanguageSwitch.tsx','app/profile/SkinForm.tsx']){
  const source=ts.createSourceFile(file,read(file),99,true);function visit(n){if((ts.isStringLiteralLike(n)||ts.isJsxText(n))&&/[А-Яа-яЁё]/.test(n.text)){const s=n.text.replace(/\s+/g,' ').trim();if(['Русский','РУССКИЙ','ru','en'].includes(s))return;assert.ok(translate(s),`${file}: ${s}`);}ts.forEachChild(n,visit);}visit(source);
 }
 const switcher=read('app/profile/LanguageSwitch.tsx');assert.match(switcher,/role="alert"/);assert.match(switcher,/type="button"/);assert.match(switcher,/translate="no"/);
});
