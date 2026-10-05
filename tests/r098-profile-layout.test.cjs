/* r098: правки владельца 2026-10-03 — таблица «Что где» без своей прокрутки,
   окно профиля на 80%, FANKOPOP под скином со стрелками, новые фоны тем. */
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const read=(file)=>fs.readFileSync(file,'utf8');

test('compare table does not scroll vertically while rows slide in',()=>{
  assert.match(read('app/donation/plans.css'),/\.dp-table-wrap \{\n\s*overflow-x: auto;\n\s*overflow-y: hidden;\n\}/);
});

test('profile window is 80% on big screens, site header untouched',()=>{
  const css=read('app/profile/profile-window.css');
  assert.match(css,/@media \(min-width: 900px\) \{\n\s*\.profile-page \.profile-window,\n\s*\.profile-page \.profile-page-tabs \{\n\s*zoom: 0\.8;/);
  assert.match(css,/\.profile-page \.pixel-header-editor\.is-expanded \{\n\s*zoom: 1\.25;/);
  assert.ok(css.indexOf('zoom: 0.8')<css.indexOf('.profile-studio {'),'the studio card is not scaled on its own');
  for(const file of ['app/site-nav.css','app/globals.css'])assert.ok(!/\.site-header[^{]*\{[^}]*zoom/.test(read(file)),file);
  /* Под zoom getBoundingClientRect уменьшается, а clientWidth — нет. */
  const name=read('app/players/ProfileName.tsx');
  assert.match(name,/heading\.clientWidth - 2\) \/ Math\.max\(1, label\.offsetWidth\)/);
  assert.ok(!/\.getBoundingClientRect\(/.test(name));
});

test('card layout: name and skin side by side, the rest full width (FANKOPOP removed in r100)',()=>{
  for(const file of ['app/profile/ProfileCard.tsx','app/players/[login]/page.tsx']){
    const text=read(file);
    assert.match(text,/<div className="player-identity-row">/,file);
    const main=text.indexOf('className="player-main-col"'),side=text.indexOf('className="player-side-col"');
    assert.ok(main>0&&side>main,file);
    for(const block of ['player-identity-copy','player-identity-facts','player-socials'])assert.ok(text.indexOf(block)>main&&text.indexOf(block)<side,`${file}: ${block}`);
    assert.ok(text.indexOf('player-skin-rating-column')>side,`${file}: skin on the right`);
    assert.ok(!/funko/i.test(text),`${file}: no FANKOPOP`);
  }
  const css=read('app/profile-ux.css');
  assert.match(css,/\.player-card \.player-identity-row > :is\(\.player-main-col, \.player-side-col\) \{ display: contents; \}/);
  /* text-containment.css в сборке идёт позже — правила раскладки должны быть сильнее его. */
  assert.match(css,/\.player-card \.player-identity-row \.player-identity-facts \{ grid-area: facts; \}/);
  assert.match(css,/\.player-card \.player-identity-row \.player-skin-rating-column \{ grid-area: skin; width: 100%; \}/);
  assert.match(read('app/text-containment.css'),/\.player-card \.player-identity-facts \{\n  display: grid;/);
  assert.match(css,/grid-template-areas: "copy" "skin" "facts" "socials";/);
  assert.match(read('app/profile/profile-window.css'),/@container studio-card \(max-width: 560px\)[\s\S]*grid-template-areas: "copy" "skin" "facts" "socials";/);
});

test('FANKOPOP is gone from the site UI (r100)',()=>{
  const dashboard=read('app/admin/AdminDashboard.tsx');
  assert.ok(!/AdminFunkoPanel|\["funko", "FANKOPOP"\]/.test(dashboard));
  assert.ok(!read('lib/community.ts').includes('funkoOf'));
  assert.ok(!read('lib/profile-card.ts').includes('funko'));
});

test('card themes: pixel backgrounds in one file, previews match',()=>{
  const layout=read('app/layout.tsx');
  assert.ok(layout.indexOf('import "./card-themes.css";')>layout.indexOf('import "./player-marks.css";'));
  const css=read('app/card-themes.css');
  for(const theme of ['night','sky','grass','nether','end','candy']){
    assert.match(css,new RegExp(`\\.player-card\\.theme-${theme} \\.player-card-body \\{\\n  background:`),theme);
    assert.match(css,new RegExp(`\\.plus-theme-tile\\.theme-${theme} \\.plus-theme-preview \\{`),theme);
    assert.match(css,new RegExp(`\\.plus-swatch\\.theme-${theme} i \\{`),theme);
  }
  assert.match(css,/--pc-night-moon: url\("data:image\/svg\+xml,/);
  assert.match(css,/var\(--card-no-emblem, var\(--pc-night-moon\)/);
  assert.match(css,/@media \(max-width: 580px\) \{\n\s*\.player-card \{\n\s*--card-no-emblem: none;/);
  assert.ok(!/\.player-card\.theme-night \.player-card-body/.test(read('app/player-marks.css')),'old theme rules removed');
  assert.ok(!/\.plus-theme-tile\.theme-night \.plus-theme-preview/.test(read('app/profile/plus-studio.css')),'old previews removed');
  assert.ok(Buffer.byteLength(css)<40000,'theme images stay small');
});
