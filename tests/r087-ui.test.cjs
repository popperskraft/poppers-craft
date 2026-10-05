/* r087: правки владельца и Платона от 2026-10-02 — кнопка настройки шапки,
   читаемые отзывы на тёмных карточках, шапки без анимации в списке и ленте,
   кнопка «Удалить из вайтлиста», без блока IP на «Играть» и подсказки
   «анкеты ждут вашего голоса». */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const read=p=>fs.readFileSync(p,'utf8');
function load(p,require=()=>({})){const exports={};vm.runInNewContext(ts.transpileModule(read(p),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require,URLSearchParams});return exports;}
const nav=load('lib/site-navigation.ts');

test('whitelist item shows how many applications wait for this player',()=>{
  const item=viewer=>nav.mainNavItems(viewer).find(entry=>entry.href==='/whitelist');
  assert.equal(item({authenticated:true,approved:true,admin:false,whitelistToVote:3}).badge,3);
  assert.equal(item({authenticated:true,approved:false,admin:true,whitelistToVote:1}).badge,1);
  /* Ноль — без числа, а без поля пункт выглядит как раньше. */
  assert.ok(!('badge' in item({authenticated:true,approved:true,admin:false,whitelistToVote:0})));
  assert.ok(!('badge' in item({authenticated:true,approved:true,admin:false})));
  assert.equal(nav.whitelistBadgeLabel(1),'1 анкета ждёт вашего голоса');
  assert.equal(nav.whitelistBadgeLabel(3),'3 анкеты ждут вашего голоса');
  assert.equal(nav.whitelistBadgeLabel(5),'5 анкет ждут вашего голоса');
  assert.equal(nav.whitelistBadgeLabel(11),'11 анкет ждут вашего голоса');
  assert.equal(nav.whitelistBadgeLabel(21),'21 анкета ждёт вашего голоса');
  assert.equal(nav.whitelistBadgeLabel(22),'22 анкеты ждут вашего голоса');
});

test('the counter is cached, reset after a vote, and shown in the header, home and whitelist',()=>{
  const counter=read('lib/whitelist-to-vote.ts');
  assert.match(counter,/__player_vote__:%:\$\{userId\}/);
  assert.match(counter,/TTL_MS = 60_000/);
  const route=read('app/api/player-waitlist/route.ts');
  assert.ok(route.indexOf('forgetWhitelistToVote(member.userId)')>route.indexOf('const sourceKey = `__player_vote__'));
  assert.match(read('lib/site-navigation-viewer.ts'),/approved \|\| admin \? await whitelistToVote\(identity\.user\.id\)\.catch\(\(\) => null\)/);
  const header=read('app/SiteHeader.tsx');
  assert.match(header,/<WhitelistNudge count=/);
  assert.match(header,/!pathname\.startsWith\("\/whitelist"\)/);
  assert.match(read('app/HomePage.tsx'),/whitelistToVote: viewer\.whitelistToVote/);
  assert.match(read('app/page.tsx'),/initialViewer\.whitelistToVote = toVote\.count/);
  const list=read('app/whitelist/PlayerWhitelist.tsx');
  assert.match(list,/ЖДЁТ ВАШЕГО ГОЛОСА/);
  assert.match(list,/router\.refresh\(\)/);
});

test('header animation: hover-only in the player list, still in the feed and wiki',()=>{
  const art=read('app/ProfileHeaderArt.tsx');
  assert.match(art,/playing = true/);
  assert.match(art,/if \(!playing\) \{\s*setIndex\(0\);/);
  const directory=read('app/players/PlayerDirectory.tsx');
  assert.match(directory,/playing=\{active\}/);
  assert.match(directory,/onMouseEnter=\{\(\) => setActive\(true\)\}/);
  assert.match(directory,/onFocus=\{\(\) => setActive\(true\)\}/);
  assert.match(read('app/feed/FeedClient.tsx'),/<ProfileHeaderArt art=\{post\.author\.header_flag === "custom" \? post\.author\.header_art : null\} playing=\{false\} \/>/);
  assert.match(read('app/wiki/WikiAuthor.tsx'),/playing=\{false\}/);
  /* В самом профиле шапка по-прежнему анимирована — если это свой рисунок (r099: при флаге кадров нет). */
  assert.match(read('app/players/[login]/page.tsx'),/<ProfileHeaderArt art=\{profile\.header_flag === "custom" \? profile\.header_art : null\} frames=\{profile\.header_flag === "custom" \? profile\.headerFrames : \[\]\}/);
  const marks=read('app/player-marks.css');
  assert.match(marks,/\.player-directory-card\.ring-rainbow \{\s*animation-play-state: paused;/);
  assert.match(marks,/\.player-directory-card\.ring-rainbow:is\(:hover, :focus-visible\) \{\s*animation-play-state: running;/);
});

test('readable text and buttons',()=>{
  assert.match(read('app/player-marks.css'),/\.player-card:is\(\.theme-night, \.theme-nether, \.theme-end, \.theme-grass\) section \{\s*color: var\(--ink\);/);
  const css=read('app/globals.css');
  /* Сильнее, чем «.candidate-vote-actions button:first-child» с салатовым фоном. */
  assert.match(css,/\.candidate-vote-actions button\.admin-delete-candidate \{[^}]*color: #fff;[^}]*background: #a5261b;/);
  assert.ok(css.indexOf('.candidate-vote-actions button.admin-delete-candidate {')>css.indexOf('.candidate-vote-actions button:first-child,'));
});

test('header settings button and no server IP on the play page',()=>{
  const editor=read('app/profile/CommunityProfileEditor.tsx');
  assert.match(editor,/className="cover-settings-button" type="button" onClick=\{openHeaderSettings\}/);
  assert.match(editor,/ref=\{headerGroupRef\}/);
  assert.match(editor,/group\.open = true;/);
  const members=read('app/members/page.tsx');
  assert.ok(!members.includes('className="member-ip"'));
  assert.ok(!members.includes('Адрес нужен, только если заходите своим клиентом'));
});

test('new texts are translated',()=>{
  const {EN_PHRASES}=load('lib/i18n/en.ts');
  const translate=load('lib/i18n/translate.ts').createTranslator(EN_PHRASES);
  for(const text of ['НАСТРОИТЬ ШАПКУ','ГОЛОСОВАТЬ →','ЖДЁТ ВАШЕГО ГОЛОСА','Кого пустить на сервер, решаем вместе.','Подключение нейросетей сейчас закрыто.',nav.whitelistBadgeLabel(1)+'.',nav.whitelistBadgeLabel(3),nav.whitelistBadgeLabel(7)+'.'])assert.ok(translate(text),text);
  assert.ok(translate('Прочитайте анкету новичка и нажмите «ЗА» или «ПРОТИВ», а если есть что сказать — оставьте отзыв. Голоса игроков помогают администрации понять мнение сообщества, но не заменяют решение админов.'));
  for(const file of ['app/WhitelistNudge.tsx']){
    const source=ts.createSourceFile(file,read(file),99,true);
    (function visit(node){if((ts.isStringLiteralLike(node)||ts.isJsxText(node))&&/[А-Яа-яЁё]/.test(node.text)){const text=node.text.replace(/\s+/g,' ').trim();if(text&&!/^pc_/.test(text))assert.ok(translate(text),text);}ts.forEachChild(node,visit);})(source);
  }
});
