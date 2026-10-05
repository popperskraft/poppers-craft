/* r096: правки владельца от 2026-10-03 — тексты HYPE, студия профиля,
   контакты, меню профиля, полоска голосования, удаление статей, шапка
   поверх страницы, темы карточки и фанкопопы. */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const read=p=>fs.readFileSync(p,'utf8');

test('HYPE texts: launcher wardrobe and in-game perks, no site wardrobe numbers',()=>{
  const files=['app/donation/DonationPlansPage.tsx','app/donation/PaymentDialog.tsx','app/profile/PaymentsPanel.tsx','app/PlusCelebration.tsx','app/rules/page.tsx','lib/poppers-knowledge.ts','lib/poppers-site-guide.ts','app/profile/PlusStudio.tsx'];
  for(const file of files){
    const text=read(file);
    assert.ok(!/шесть образов|двенадцать образов|Образов в гардеробе|Образы в гардеробе/.test(text),file);
  }
  const plans=read('app/donation/DonationPlansPage.tsx');
  for(const perk of ['Гардероб в лаунчере: пять скинов человека и пять скинов пони','Префикс в чате, цвет ника с градиентом и флаг','Две свои строки в списке серверов Minecraft','Своё сообщение о смерти','Размер персонажа от 25% до 300%'])assert.ok(plans.includes(perk),perk);
  /* r099: пластинки — без подписки и с PLUS одна в неделю, с HYPE одна в день. */
  assert.match(plans,/\{ label: "Свои пластинки", base: "1 в неделю", plus: "1 в неделю", hype: "1 в день" \}/);
  assert.match(read('app/profile/PlusStudio.tsx'),/\{ title: "Гардероб в лаунчере", need: "hype"/);
});

test('profile studio: no site wardrobe, styling blocks under the card',()=>{
  const studio=read('app/profile/ProfileEditStudio.tsx');
  assert.ok(!studio.includes('LooksWardrobe')&&!studio.includes('plus-looks')&&!studio.includes('ГАРДЕРОБ'));
  assert.match(studio,/<div className="profile-studio-panel profile-studio-extras">\n\s*<PlusStudio integrated/);
  const css=read('app/profile/profile-window.css');
  assert.match(css,/grid-template-areas:\n\s*"preview main"\n\s*"extras main";/);
  assert.match(css,/grid-template-rows: auto 1fr;/);
});

test('contacts are visible to everyone; bio spans the card',()=>{
  const community=read('lib/community.ts');
  assert.match(community,/social_links: profile\.social_links \?\? "",\n\s*contactsLocked: false,/);
  assert.ok(!read('app/players/[login]/page.tsx').includes('[LOCKED]'));
  /* r098: без фигурок «о себе» и контакты по-прежнему на всю ширину под именем и скином. */
  assert.match(read('app/profile-ux.css'),/grid-template-areas: "copy skin" "facts facts" "socials socials";/);
});

test('profile menu: the green button opens the profile, under it only log out (r100)',()=>{
  const menu=read('app/ProfileMenu.tsx');
  assert.ok(!menu.includes('className="header-profile-item" href="/profile"')&&!menu.includes('href="/players"')&&menu.includes('ВЫЙТИ'));
  assert.match(menu,/href=\{needsMfa \? "\/mfa" : "\/profile"\}/);
  assert.ok(!menu.includes('tab=settings')&&!menu.includes('tab=subscription'));
});

test('vote strip is part of the header band, page background starts below it',()=>{
  assert.match(read('app/WhitelistNudge.tsx'),/<div className="whitelist-nudge-band">/);
  const css=read('app/site-nav.css');
  assert.match(css,/\.site-header\.site-header-inner:has\(\+ \.whitelist-nudge-band\) \{\n\s*border-bottom: 0;/);
  assert.match(css,/\.whitelist-nudge-band \{\n\s*position: relative;\n\s*z-index: 2;/);
});

test('wiki: author and admins can delete an article',()=>{
  const page=read('app/wiki/articles/[slug]/page.tsx');
  assert.match(page,/\{article\.canEdit \? <WikiDeleteArticle articleId=\{article\.id\} title=\{article\.title\} \/> : null\}/);
  assert.match(read('app/wiki/WikiDeleteArticle.tsx'),/fetch\(`\/api\/wiki\/articles\/\$\{articleId\}`, \{ method: "DELETE" \}\)/);
  /* Права проверяет сервер: автор или администратор. */
  assert.match(read('app/api/wiki/articles/[id]/route.ts'),/article\.payload\.authorId !== viewer\.user\.id && !viewer\.adminProfile/);
});

test('header editor expands over the page; theme tiles',()=>{
  const editor=read('app/profile/PixelHeaderEditor.tsx');
  assert.match(editor,/className=\{expanded \? "pixel-header-editor is-expanded" : "pixel-header-editor"\}/);
  assert.match(editor,/if \(event\.key === "Escape"\) setExpanded\(false\);/);
  assert.match(read('app/globals.css'),/\.pixel-header-editor\.is-expanded \{ position: fixed;/);
  const studio=read('app/profile/PlusStudio.tsx');
  assert.match(studio,/className=\{`plus-theme-tile theme-\$\{option\.id\}/);
  assert.match(read('app/card-themes.css'),/\.plus-theme-tile\.theme-night \.plus-theme-preview \{/);
});

test('funko: unique figures, Thomas the rarest, shelf only when owned',()=>{
  const sql=read('supabase/migrations/20261003130000_r096_funko_figures.sql');
  assert.match(sql,/\('step', 1, 'Степан', 45\),\n\s*\('platon', 2, 'Платон', 45\),\n\s*\('tomac', 3, 'Томас', 10\)/);
  assert.match(sql,/order by -ln\(1 - random\(\)\) \/ rarity_weight/);
  assert.match(sql,/owner_id uuid references auth\.users \(id\) on delete set null/);
  assert.match(sql,/grant execute on function public\.pc_funko_award\(uuid, text, text, text\) to service_role;/);
  /* r100: владелец убрал FANKOPOP с сайта — на карточках раздела нет. */
  for(const file of ['app/profile/ProfileCard.tsx','app/players/[login]/page.tsx'])assert.ok(!/funko|FunkoShelf/i.test(read(file)),file);
  const game=read('app/api/game/funko/route.ts');
  assert.match(game,/process\.env\.POPPERSCRAFT_BROWSER_SECRET/);
  assert.match(game,/timingSafeEqual/);
  const admin=read('app/api/admin/funko/route.ts');
  assert.match(admin,/if \(admin\.profile\.role !== "owner"\) return NextResponse\.json\(\{ error: "Фигурки выдаёт только владелец\." \}/);
});
