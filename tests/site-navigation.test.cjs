/* r079: общая шапка сайта и логика кнопок навигации
   (lib/site-navigation.ts, lib/viewer-stage.ts, lib/navigation-trail.ts). */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const read=p=>fs.readFileSync(p,'utf8');
function load(p,require=()=>({})){const exports={};vm.runInNewContext(ts.transpileModule(read(p),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require,URLSearchParams});return exports;}
const nav=load('lib/site-navigation.ts');
/* Массивы и объекты из другого контекста vm сравниваем после копирования в свой. */
const labels=viewer=>[...nav.mainNavItems(viewer).map(item=>`${item.label} ${item.href}`)];

test('menu items depend on who is viewing',()=>{
 assert.deepEqual(labels(null),['Лист ожидания /#waitlist','Обновления /#updates','Wiki /wiki','Правила /rules','PLUS /plus']);
 /* Вошёл, но код 2FA не введён или анкета не одобрена: закрытых разделов нет, анкеты тоже. */
 const outside=['Обновления /#updates','Wiki /wiki','Правила /rules','PLUS /plus'];
 assert.deepEqual(labels({authenticated:true,needsMfa:true,approved:true,admin:true}),outside);
 assert.deepEqual(labels({authenticated:true,approved:false,admin:false}),outside);
 /* r090: у игроков и администраторов пункта PLUS нет — подписка в «Профиль ▾ → Подписка». */
 assert.deepEqual(labels({authenticated:true,approved:true,admin:false}),['Играть /members','Лента /feed','Список игроков /players','Вайтлист /whitelist','Wiki /wiki']);
 assert.deepEqual(labels({authenticated:true,approved:true,admin:true}),['Играть /members','Лента /feed','Список игроков /players','Вайтлист /whitelist','Wiki /wiki','Управление /admin']);
 /* Администратору без анкеты страница доступа не положена — сразу лаунчер. */
 assert.equal(labels({authenticated:true,approved:false,admin:true})[0],'Играть /launcher');
});

test('current section is highlighted on its inner pages',()=>{
 const item=(viewer,label)=>nav.mainNavItems(viewer).find(entry=>entry.label===label);
 const member={authenticated:true,approved:true,admin:false};
 assert.ok(nav.isCurrentNavItem(item(member,'Список игроков'),'/players/step'));
 /* r100: «Список игроков» — свой пункт шапки, «Лента» на /players не подсвечивается. */
 assert.ok(!nav.isCurrentNavItem(item(member,'Лента'),'/players/step'));
 assert.ok(nav.isCurrentNavItem(item(member,'Играть'),'/launcher'));
 /* r090: PLUS в меню только у гостей и без одобренной анкеты. */
 assert.ok(nav.isCurrentNavItem(item(null,'PLUS'),'/donation'));
 assert.ok(nav.isCurrentNavItem(item(member,'Wiki'),'/wiki/articles/metro'));
 assert.ok(!nav.isCurrentNavItem(item(member,'Wiki'),'/wikipedia'));
 assert.ok(!nav.isCurrentNavItem(item(null,'Обновления'),'/'));
});

test('shared header is shown on regular pages and hidden on steps, editors and admin',()=>{
 for(const path of ['/feed','/players','/players/step','/wiki','/wiki/articles/metro','/donation','/rules','/members','/launcher','/profile','/plus','/whitelist'])assert.ok(nav.hasSiteHeader(path),path);
 for(const path of ['/','/admin','/admin/login','/mfa','/mail','/reset','/my-card','/launcher/authorize','/donation/return','/models','/wiki/new','/wiki/articles/metro/edit','/auth/callback'])assert.ok(!nav.hasSiteHeader(path),path);
});

test('buttons into the game lead to the Play section; ↗ only for other sites',()=>{
 const stage=load('lib/viewer-stage.ts');
 assert.deepEqual({...stage.heroAction('member')},{label:'ЗАЙТИ В МИР →',href:'/members'});
 assert.equal(stage.soonCopy('member').action.href,'/members');
 for(const kind of ['guest','mfa','member','needs-pass','admin','no-access']){
  for(const action of [stage.heroAction(kind),stage.soonCopy(kind).action]){
   if(action.label.endsWith('↗'))assert.ok(action.external,`${kind}: ${action.label}`);
   else assert.ok(!action.external&&(action.href.startsWith('/')||action.href.startsWith('#')),`${kind}: ${action.label}`);
  }
 }
 const access={paymentsOpen:true,plus:{active:true,renewsItself:true,tier:'plus',renewTier:'plus'}};
 assert.equal(stage.plusAction('member',access).href,'/profile?tab=subscription');
});

test('back button without a trail goes to the parent section',()=>{
 const trail=load('lib/navigation-trail.ts');
 assert.equal(trail.parentPage('/launcher'),'/members');
 assert.equal(trail.parentPage('/profile'),'/my-card');
 assert.equal(trail.parentPage('/players/step'),'/players');
 assert.equal(trail.parentPage('/players'),'/feed');
});

test('header, account menu and menu labels have manual English translations',()=>{
 const {EN_PHRASES}=load('lib/i18n/en.ts');const translate=load('lib/i18n/translate.ts').createTranslator(EN_PHRASES);
 const viewers=[null,{authenticated:true,approved:true,admin:true},{authenticated:true,approved:false,admin:true}];
 for(const viewer of viewers)for(const item of nav.mainNavItems(viewer))if(/[А-Яа-яЁё]/.test(item.label))assert.ok(translate(item.label),item.label);
 for(const file of ['app/SiteHeader.tsx','app/ProfileMenu.tsx']){
  const source=ts.createSourceFile(file,read(file),99,true);
  function visit(node){if((ts.isStringLiteralLike(node)||ts.isJsxText(node))&&/[А-Яа-яЁё]/.test(node.text)){const text=node.text.replace(/\s+/g,' ').trim();assert.ok(translate(text),`${file}: ${text}`);}ts.forEachChild(node,visit);}
  visit(source);
 }
});

test('inner pages no longer repeat the site menu in their own toolbars',()=>{
 for(const file of ['app/feed/page.tsx','app/players/page.tsx','app/players/[login]/page.tsx','app/profile/page.tsx','app/plus/page.tsx','app/members/page.tsx']){
  const source=read(file);
  assert.ok(!source.includes('>НА ГЛАВНУЮ<'),file);
  assert.ok(!source.includes('>ПОИСК ИГРОКОВ'),file);
 }
 assert.ok(read('app/layout.tsx').includes('<SiteHeader viewer={navViewer} />'));
});

test('feed toolbar keeps actions and view modes in one panel as wide as the feed',()=>{
 const feed=read('app/feed/FeedClient.tsx');
 const toolbar=feed.match(/<div className="feed-toolbar">[\s\S]*?\n      <\/div>/)[0];
 for(const part of ['feed-open-composer','feed-open-search','feed-open-finder','feed-modes','ВИД ЛЕНТЫ','РАННИЙ ДОСТУП HYPE'])assert.ok(toolbar.includes(part),part);
 assert.match(read('app/feed/page.tsx'),/import "\.\/feed-toolbar\.css";/);
 const css=read('app/feed/feed-toolbar.css');
 assert.match(css,/\.feed-layout \.feed-toolbar \{[\s\S]*?width: min\(820px, 100%\)/);
 assert.match(css,/\.feed-layout\.composer-closed \.feed-search-bar \{[\s\S]*?width: min\(820px, 100%\)/);
 const {EN_PHRASES}=load('lib/i18n/en.ts');const translate=load('lib/i18n/translate.ts').createTranslator(EN_PHRASES);
 for(const text of ['ВИД ЛЕНТЫ','РАННИЙ ДОСТУП HYPE','ОПУБЛИКОВАТЬ'])assert.ok(translate(text),text);
});

test('compact home header shrinks the language switch and fits the account menu',()=>{
 const css=read('app/site-nav.css');
 assert.match(css,/\.header-profile-dropdown \{\s*width: max-content;/);
 assert.match(css,/\.site-header\.is-compact \.language-switch\.is-compact \.language-switch-options button \{[\s\S]*?min-height: 26px/);
});
