/* r100: правки владельца, копятся до публикации. */
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const read=(file)=>fs.readFileSync(file,'utf8');

test('payment consent checkbox sits on the same line as its text',()=>{
  const css=read('app/donation/plans.css');
  assert.match(css,/\.dp-dialog \.dp-check \{\n\s*display: flex;\n\s*align-items: flex-start;/);
  assert.match(css,/\.dp-dialog \.dp-check input \{\n\s*width: 20px;\n\s*height: 20px;\n\s*min-height: 0;/);
  assert.ok(css.indexOf('.dp-dialog .dp-check {')>css.indexOf('.dp-dialog label {'),'after the generic dialog rules');
  assert.match(read('app/donation/PaymentDialog.tsx'),/<label className="dp-check">\n\s*<input type="checkbox" checked=\{consent\}/);
});

test('checkout dialog does not scroll the page behind it',()=>{
  const css=read('app/donation/plans.css');
  assert.match(css,/\.dp-dialog \{\n\s*width: min\(520px, 100%\);\n\s*max-height: calc\(100vh - 32px\);\n\s*overscroll-behavior: contain;/);
  assert.match(css,/\.dp-dialog-backdrop \{[^}]*overscroll-behavior: contain;/);
  assert.match(css,/html:has\(\.dp-dialog-backdrop\),\nhtml:has\(\.dp-dialog-backdrop\) body \{\n\s*overflow: hidden;/);
});

test('donation page for pass owners says "choose a plan", not PLUS',()=>{
  const plans=read('app/donation/DonationPlansPage.tsx');
  assert.match(plans,/<h1 className=\{owned \? "dp-hero-plan" : undefined\}>\{owned \? "ВЫБЕРИ ПЛАН" : "ДОНАТ"\}<\/h1>/);
  assert.ok(!plans.includes('{owned ? "PLUS" : "ДОНАТ"}'));
  assert.match(plans,/Пропуск у тебя уже есть — осталось выбрать подписку\./);
  assert.match(read('app/donation/page.tsx'),/title: "Выбери план — PoppersCraft"/);
  assert.match(read('app/donation/plans.css'),/\.dp-hero h1\.dp-hero-plan \{\n\s*font-size: clamp\(40px, 7\.5vw, 112px\);/);
  assert.match(read('lib/viewer-stage.ts'),/stage === "member" \? "ВЫБЕРИ ПЛАН" : "ДОНАТ"/);
});

test('header: player list after the feed; under «ПРОФИЛЬ» only a same-size «ВЫЙТИ»',()=>{
  const nav=read('lib/site-navigation.ts');
  assert.match(nav,/\{ label: "Лента", href: "\/feed", match: \["\/feed"\] \},\n[\s\S]*?\{ label: "Список игроков", href: "\/players", match: \["\/players"\] \},/);
  const menu=read('app/ProfileMenu.tsx');
  assert.ok(!menu.includes('header-profile-item" href="/profile"'),'no pink «Профиль»');
  assert.ok(!menu.includes('href="/players"'),'player list left the account menu');
  assert.match(menu,/className="header-login-button header-profile-logout"/);
  assert.match(menu,/if \(!window\.matchMedia\("\(hover: none\)"\)\.matches \|\| open\) return;/);
  assert.match(read('app/site-nav.css'),/\.header-profile-dropdown \.header-login-button\.header-profile-logout \{\n\s*width: 100%;/);
  for(const file of ['lib/poppers-site-guide.ts','lib/poppers-knowledge.ts','app/donation/DonationPlansPage.tsx','app/mail/page.tsx','lib/payments.ts','lib/plus-perks.ts'])
    assert.ok(!/Профиль ▾ → Профиль|«Профиль ▾» → «Профиль»/.test(read(file)),file);
});

test('home: no «server still being set up» block; donation stripes fade into the footer; Telegram goes to the bot',()=>{
  const home=read('app/HomePage.tsx');
  assert.ok(!home.includes('launch_status.exe')&&!home.includes('СЕРВЕР ЕЩЁ НАСТРАИВАЕМ')&&!home.includes('soonCopy'));
  assert.match(home,/<a href=\{SUPPORT_BOT_URL\} target="_blank" rel="noreferrer">Telegram ↗<\/a>/);
  assert.ok(!home.includes('href="https://t.me/popperskraft"'));
  /* r101: градиент в подвал владелец отменил. */
  assert.match(read('app/globals.css'),/\.site-footer \{[^}]*background: #181818;\n  color: #fff;\n  border-top: 5px solid var\(--ink\);/);
});

test('no «payment soon» e-mail window: buttons always open the payment dialog',()=>{
  const plans=read('app/donation/DonationPlansPage.tsx');
  assert.ok(!plans.includes('payment_soon.exe')&&!plans.includes('НАПИШИТЕ МНЕ')&&!plans.includes('/api/donation-interest'));
  assert.ok(!plans.includes('запишись, и мы напомним'));
  assert.match(plans,/\{plan && session \? \(\n\s*<PaymentDialog/);
  const stage=read('lib/viewer-stage.ts');
  assert.ok(!stage.includes('УЗНАТЬ ПЕРВЫМ')&&!stage.includes('closedLabel'));
  assert.ok(!read('app/donation/DonationSection.tsx').includes('"ЗАПИСАТЬСЯ"'));
  assert.match(read('app/donation/PaymentDialog.tsx'),/<h2 id="dp-dialog-title">Оплата закрыта<\/h2>/);
});

test('six admin menu items fit on 1181–1279px screens',()=>{
  assert.match(read('app/site-nav.css'),/@media \(min-width: 1181px\) and \(max-width: 1279px\) \{\n\s*\.site-header \.main-nav:has\(> a:nth-of-type\(6\)\) a \{\n\s*min-width: 0;\n\s*padding: 0 7px;\n\s*font-size: 12px;\n\s*white-space: nowrap;/);
});

test('rules and Poppers no longer mention the self-employed receipt line',()=>{
  for(const file of ['app/rules/page.tsx','lib/poppers-site-guide.ts'])assert.ok(!/самозанятый, чек формируется в «Мой налог»/.test(read(file)),file);
  assert.match(read('app/rules/page.tsx'),/Данные карты мы не видим и не храним\.<\/li>/);
});

test('rules §8: contacts are the official Telegram bot (a plain link) or e-mail',()=>{
  const rules=read('app/rules/page.tsx');
  assert.match(rules,/в официальном <a href=\{SUPPORT_BOT_URL\} target="_blank" rel="noreferrer">Telegram-боте<\/a> или на почту <a href="mailto:popperskraft@gmail\.com">popperskraft@gmail\.com<\/a>\./);
  assert.ok(!rules.includes('Telegram-канале.'));
});

test('agreement §13: contacts are the bug button or e-mail, no Telegram channel',()=>{
  const agreement=read('lib/user-agreement.ts');
  assert.match(agreement,/через кнопку «Сообщить о баге» на сайте либо на почту popperskraft@gmail\.com\./);
  assert.ok(!agreement.includes('официальный канал поддержки в Telegram'));
});

test('«Играть» page: the Telegram button opens the support bot',()=>{
  const members=read('app/members/page.tsx');
  assert.match(members,/<a href=\{SUPPORT_BOT_URL\} target="_blank" rel="noreferrer">TELEGRAM ↗<\/a>/);
  assert.ok(!members.includes('NEWS_CHANNEL_URL'));
});

test('home donation block does not jump when scrolling fast right after load',()=>{
  const section=read('app/donation/DonationSection.tsx');
  assert.match(section,/const RECORD_SIZES = "\(max-width: 767px\) 45vw, 360px";/);
  assert.equal((section.match(/sizes=\{RECORD_SIZES\} loading="eager"/g)||[]).length,3);
  assert.match(section,/if \(ScrollTrigger\.isScrolling\(\)\) \{\n\s*if \(!waiting\) \{\n\s*waiting = true;\n\s*ScrollTrigger\.addEventListener\("scrollEnd", run\);/);
  assert.equal((section.match(/calmRefresher\(\);/g)||[]).length,2,'both desktop and phone use the calm refresh');
  assert.ok(!section.includes('const refresh = () => ScrollTrigger.refresh();'));
  assert.match(section,/scrub: 0\.6,\n\s*fastScrollEnd: true,/);
});

test('account e-mail box stretches to the free space',()=>{
  const css=read('app/profile-ux.css');
  assert.match(css,/\.profile-content \.profile-identity \{\n\s*display: flex;\n\s*flex-wrap: wrap;/);
  assert.match(css,/\.profile-content \.profile-identity > div:last-child \{\n\s*flex: 1 1 280px;/);
});

