/* r090: чистка артефактов прошлых раскладок сайта — после переезда
   подписки и настроек в окно профиля (r089) ничего не должно вести в старые
   места: пункт PLUS у игроков, /plus как «оформление», «Настройки профиля →
   Оплата и PLUS», /my-card вместо окна профиля, #donate на главной, IP
   сервера для своего клиента (зайти можно только через лаунчер). */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const read=p=>fs.readFileSync(p,'utf8');
function load(p,require=()=>({})){const exports={};vm.runInNewContext(ts.transpileModule(read(p),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require,URLSearchParams});return exports;}
function walk(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(entry=>{const full=path.join(dir,entry.name);if(entry.name.startsWith('._'))return [];return entry.isDirectory()?walk(full):/\.(tsx?|css)$/.test(entry.name)?[full]:[];});}
/* Видимый код: строки без комментариев. */
const visible=file=>read(file).replace(/\/\*[\s\S]*?\*\//g,'').replace(/^\s*\/\/.*$/gm,'').replace(/\{\/\*[\s\S]*?\*\/\}/g,'');
/* r092: правила и соглашение 1.2 тоже проверяются — старые пути в них исправлены. */
const sources=[...walk('app'),...walk('lib')].filter(file=>!file.endsWith('lib/i18n/en.ts'));

test('no links into old places',()=>{
  for(const file of sources){
    const code=visible(file);
    assert.ok(!/href="\/plus"|\$\{siteUrl\(\)\}\/plus`/.test(code),`${file}: /plus as a destination`);
    assert.ok(!/\/#donate/.test(code),`${file}: /#donate (no such section)`);
    assert.ok(!/href="\/my-card"/.test(code),`${file}: /my-card instead of /profile`);
    assert.ok(!/Настройки профиля|Оплата и PLUS|Оформление PLUS|Анкета и контакты|странице PLUS|разделе PLUS/.test(code),`${file}: old section names`);
    assert.ok(!/НАСТРОЙКИ ПРОФИЛЯ|← Настройки</.test(code),`${file}: old buttons`);
  }
});

test('subscription is in the profile menu, not in the main menu of players',()=>{
  const nav=load('lib/site-navigation.ts');
  for(const viewer of [{authenticated:true,approved:true,admin:false},{authenticated:true,approved:true,admin:true},{authenticated:true,approved:false,admin:true}])
    assert.ok(!nav.mainNavItems(viewer).some(item=>item.href==='/plus'),JSON.stringify(viewer));
  assert.ok(nav.mainNavItems(null).some(item=>item.href==='/plus'),'guests still see tariffs');
  /* r096: подписка — вкладка окна профиля; r100: «Список игроков» — пункт шапки. */
  assert.ok(read('app/profile/page.tsx').includes('view.tab === "subscription"'));
  assert.ok(nav.mainNavItems({authenticated:true,approved:true,admin:false}).some(item=>item.href==='/players'));
});

test('no server IP for players: joining is launcher-only',()=>{
  const home=read('app/HomePage.tsx');
  assert.ok(!home.includes('copyIp')&&!home.includes('className="server-ip"'));
  const bot=read('lib/telegram-support-bot.ts');
  assert.ok(!bot.includes('SERVER_IP'));
  assert.match(bot,/Только через лаунчер PoppersCraft/);
  for(const file of ['lib/wiki-hub.ts','lib/poppers-knowledge.ts','lib/poppers-site-guide.ts'])assert.ok(!/IP сервера:|IP игрового сервера/.test(read(file)),file);
});

test('admin: one donation-waitlist list, rule banner only where it applies, honest placement label',()=>{
  const admin=read('app/admin/AdminDashboard.tsx');
  assert.ok(!admin.includes('ОЖИДАЮТ ДОНАТ'));
  assert.match(read('app/admin/AdminCommunicationPanel.tsx'),/ЖДУТ ЗАПУСКА ДОНАТА/);
  assert.match(admin,/\{panel === "applications" \|\| panel === "users" \? <div className="admin-rule-banner">/);
  assert.match(read('app/admin/BlockBuilder.tsx'),/<option value="after-donate">ПОСЛЕ ОБНОВЛЕНИЙ<\/option>/);
});

test('pages do not repeat the site menu; home numbering follows visible sections',()=>{
  assert.ok(!read('app/rules/page.tsx').includes('ВЕРНУТЬСЯ НА САЙТ'));
  assert.ok(!read('app/cookies/page.tsx').includes('ВЕРНУТЬСЯ НА САЙТ'));
  assert.match(read('app/HomePage.tsx'),/<span className="heading-number">\{viewer !== null && !viewer\.authenticated \? "03" : "02"\}<\/span>/);
  assert.match(read('lib/navigation-trail.ts'),/if \(pathname\.startsWith\("\/donation"\)\) return "\/";/);
});

test('Poppers guide describes the profile window and routes questions to it',()=>{
  const guide=read('lib/poppers-site-guide.ts');
  assert.match(guide,/^ОКНО ПРОФИЛЯ: ПРОФИЛЬ, НАСТРОЙКИ, ПОДПИСКА$/m);
  assert.ok(!guide.includes('"ПРОФИЛЬ: КАРТОЧКА И НАСТРОЙКИ"'));
  for(const heading of [...guide.matchAll(/sections: \[([^\]]+)\]/g)].flatMap(match=>[...match[1].matchAll(/"([^"]+)"/g)].map(m=>m[1])))
    assert.ok(new RegExp(`^${heading.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}$`,'m').test(guide),`routed section exists: ${heading}`);
});

test('changed texts are translated',()=>{
  const {EN_PHRASES}=load('lib/i18n/en.ts');
  const translate=load('lib/i18n/translate.ts').createTranslator(EN_PHRASES);
  for(const text of ['РЕДАКТИРОВАТЬ ПРОФИЛЬ →','В НАСТРОЙКИ →','← К профилю','ОТКРЫТЬ ПРОФИЛЬ','ПОСЛЕ ОБНОВЛЕНИЙ','Ссылка на Linux станет активной, когда сборка будет готова.','Анкета одобрена — вы в списке. Лаунчер и шаги для входа — в разделе «Играть».','Это возможность подписки. Оформить её можно в «Профиль → Подписка».','POPPERS HYPE уже оформлен и продлевается сам. Управлять им можно в «Профиль → Подписка».'])
    assert.ok(translate(text),text);
});
