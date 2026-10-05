/* r099: правки владельца и Платона 2026-10-04 — флаг под анимацией HYPE, шапка
   «кастомная / цвет / пресет» с галереей, разделы профиля над окном, окно
   соглашения на телефоне, подсказка про IP, кнопка «Редактировать профиль»
   и стикеры в серой полосе под постом. */
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const read=(file)=>fs.readFileSync(file,'utf8');

test('animation frames are part of the custom drawing only',()=>{
  assert.match(read('app/players/[login]/page.tsx'),/frames=\{profile\.header_flag === "custom" \? profile\.headerFrames : \[\]\}/);
  assert.match(read('app/players/PlayerDirectory.tsx'),/frames=\{player\.plus && player\.header_flag === "custom" \? player\.headerFrames : \[\]\}/);
  assert.match(read('app/profile/ProfileCard.tsx'),/frames=\{card\.header_flag === "custom" \? card\.headerFrames : \[\]\}/);
  for(const file of ['app/players/[login]/page.tsx','app/players/PlayerDirectory.tsx','app/profile/ProfileCard.tsx','app/profile/PlusPreview.tsx'])
    assert.ok(!/frames=\{(profile|player|card)\.headerFrames\}/.test(read(file)),file);
});

test('header presets: Minecraft scenes are not pride flags',()=>{
  const flags=read('lib/header-flags.ts');
  for(const id of ['mc-meadow','mc-sky','mc-sunset','mc-night','mc-nether','mc-end','mc-hearts'])assert.match(flags,new RegExp(`value: "${id}", label: "[^"]+", group: "minecraft"`),id);
  assert.match(flags,/\{ value: "rainbow", label: "Радужный", group: "pride" \}/);
  assert.match(flags,/option\.value === normalized && option\.group === "pride"/);
  assert.match(flags,/return normalized === "custom" \? "custom" : normalized === "none" \? "color" : "preset";/);
  const css=read('app/card-themes.css');
  for(const id of ['mc-meadow','mc-sky','mc-sunset','mc-night','mc-nether','mc-end','mc-hearts'])assert.match(css,new RegExp(`\\.flag-${id}::before \\{\\n  background:`),id);
  assert.match(css,/\.profile-flag:is\(\.flag-mc-meadow,[^)]*\)::before \{\n  opacity: 1;/);
});

test('header editor: custom, color and preset modes with a gallery',()=>{
  const editor=read('app/profile/CommunityProfileEditor.tsx');
  assert.match(editor,/\["custom", "КАСТОМНАЯ"\],\n\s*\["color", "ЦВЕТ"\],\n\s*\["preset", "ПРЕСЕТ"\],/);
  assert.ok(!editor.includes('<select name="headerFlag"'),'the old flag dropdown is gone');
  assert.match(editor,/<input name="headerFlag" type="hidden" value=\{headerFlag\} \/>/);
  assert.match(editor,/<input name="headerColor" type="hidden" value=\{headerColor\} \/>/);
  assert.match(editor,/if \(mode === "custom"\) setHeaderFlag\("custom"\);\n\s*if \(mode === "color"\) setHeaderFlag\("none"\);/);
  assert.match(editor,/\{headerMode === "custom" \? <>[\s\S]*<PixelHeaderEditor[\s\S]*<\/> : null\}/);
  assert.match(editor,/role="radiogroup"[\s\S]*<span className="header-preset-swatch" aria-hidden="true"><span className=\{`profile-flag flag-\$\{option\.value\}`\}/);
  assert.ok(editor.indexOf('name="hidePrideFlags"')>editor.indexOf('</> : null}'),'the homophobe filter stays for every mode');
  const css=read('app/profile/profile-window.css');
  assert.match(css,/\.header-mode-tabs \{\n\s*display: grid;\n\s*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/);
  assert.match(css,/\.header-preset-grid \{\n\s*display: grid;\n\s*grid-template-columns: repeat\(auto-fill, minmax\(112px, 1fr\)\);/);
});

test('profile sections sit above the window',()=>{
  const page=read('app/profile/page.tsx');
  const tabs=page.indexOf('<nav className="profile-tabs profile-page-tabs"'),win=page.indexOf('<div className="paint-window profile-window">');
  assert.ok(tabs>0&&tabs<win,'tabs before the window');
  assert.equal((page.match(/className="profile-tabs/g)||[]).length,1);
  assert.match(read('app/profile/profile-window.css'),/\.profile-page\.profile-page-with-tabs \{\n\s*align-content: center;/);
});

test('agreement window: blocks do not collapse on a phone',()=>{
  const css=read('app/text-containment.css');
  assert.match(css,/\.agreement-gate-body \{[^}]*display: flex;\n\s*flex-direction: column;/);
  assert.match(css,/\.agreement-gate-body > \* \{\n\s*flex-shrink: 0;\n\}/);
  assert.match(css,/\.agreement-gate-text \{\n\s*min-height: 140px;/);
});

test('home: no hint about an IP that is not there',()=>{
  const home=read('app/HomePage.tsx');
  assert.ok(!home.includes('Нажмите на IP'));
  assert.ok(home.includes('Играть — через лаунчер PoppersCraft.'));
  assert.ok(read('lib/i18n/en.ts').includes('"Играть — через лаунчер PoppersCraft.": "Play through the PoppersCraft launcher."'));
});

test('edit-profile button matches the other toolbar buttons; stickers in the grey bar',()=>{
  const ux=read('app/profile-ux.css');
  assert.match(ux,/\.player-page-toolbar \.player-settings-link \{ background: var\(--acid\); justify-self: end; align-self: start; white-space: nowrap; \}/);
  assert.ok(!/player-settings-link \{[^}]*max-width/.test(ux));
  const marks=read('app/player-marks.css');
  assert.match(marks,/\.feed-reactions \+ \.sticker-bar \{ padding: 0 24px 16px; background: #d4d0c8; \}/);
  assert.match(marks,/\.feed-stream\.is-dark \.feed-reactions \+ \.sticker-bar \{ background: #24242e; \}/);
});

test('records: one a week without a subscription and with PLUS, one a day with HYPE',()=>{
  const files=['app/PlusCelebration.tsx','app/donation/DonationSection.tsx','app/donation/DonationPlansPage.tsx','app/donation/PaymentDialog.tsx','app/profile/PaymentsPanel.tsx','app/profile/PlusStudio.tsx','app/rules/page.tsx','lib/poppers-site-guide.ts','lib/poppers-knowledge.ts','lib/plus-style.ts','lib/payments.ts'];
  for(const file of files)assert.ok(!/две свои пластинки|2 в неделю|ДВЕ В НЕДЕЛЮ|пластинок вдвое|с HYPE — две|вторая своя пластинка/i.test(read(file)),file);
  assert.match(read('app/profile/PlusStudio.tsx'),/\(hype \? "одна каждый день" : "одна в неделю, с HYPE — каждый день"\)/);
  assert.match(read('lib/plus-style.ts'),/records: "Своя пластинка каждый день"/);
  assert.match(read('app/donation/DonationSection.tsx'),/<li>Одна в неделю — всем<\/li><li>С HYPE — одна каждый день<\/li>/);
  assert.match(read('lib/poppers-knowledge.ts'),/одну в неделю \(и без подписки, и с PLUS\), с HYPE — одну каждый день\./);
});

test('ready skin upload is unlimited for everyone; no "game advantages" row',()=>{
  const plans=read('app/donation/DonationPlansPage.tsx');
  assert.match(plans,/\{ label: "Загрузка готового скина", base: "сколько угодно", plus: "сколько угодно", hype: "сколько угодно" \}/);
  assert.ok(!plans.includes('label: "Игровые преимущества"'));
  assert.ok(!plans.includes('"Загрузка готового скина сколько угодно раз"'),'not a HYPE perk any more');
  assert.match(read('app/profile/PlusStudio.tsx'),/\{ title: "Загрузка готового скина файлом", need: "free"/);
  assert.match(read('app/profile/SkinForm.tsx'),/unlimited \? "Загружайте сколько угодно раз\. В гардеробе лаунчера — до пяти скинов человека и пяти скинов пони\." : "Загружайте сколько угодно раз — новый скин заменит прежний/);
  for(const file of ['app/rules/page.tsx','lib/poppers-site-guide.ts','lib/poppers-knowledge.ts'])assert.ok(!/один раз, дальше сколько угодно|замена загруженного файла скина|менять загруженный файл скина/.test(read(file)),file);
});

test('donation showcase: the right column is HYPE, blue, with current perks',()=>{
  const plans=read('app/donation/DonationPlansPage.tsx');
  assert.match(plans,/<div className="dp-side plus hype">\n\s*<div className="dp-side-bar"><b>С ПОДПИСКОЙ HYPE<\/b>/);
  assert.match(plans,/<b><Item name="totem_of_undying" className="dp-badge-item" \/>HYPE<\/b>/);
  assert.match(plans,/frames=\{SHOWCASE_HEADER_FRAMES\} frameMs=\{700\}/);
  assert.ok(!plans.includes('dp-label pink'),'no pink labels in the HYPE column');
  assert.match(read('app/donation/showcase-data.ts'),/export const SHOWCASE_HEADER_FRAMES: PixelHeaderArt\[\]/);
  const css=read('app/donation/plans.css');
  assert.match(css,/\.dp-side\.plus\.hype \{\n\s*border-color: #101a7a;\n\s*box-shadow: 6px 6px 0 #2b3ce6/);
  assert.match(css,/\.dp-side\.plus\.hype \.dp-side-bar \{\n\s*background: linear-gradient\(90deg, #0b1160, #2033d8\);/);
});

