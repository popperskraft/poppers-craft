const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const read=(file)=>fs.readFileSync(file,'utf8');

/* r095 (решение владельца 2026-10-03): «Сделать игроком сейчас» и первые 10
   больше не дают бесплатный пропуск — до игры его оплачивают, а владелец
   может подарить пропуск не больше чем троим из первой десятки. */
const migration=read('supabase/migrations/20261003110000_r095_founder_pass_choice.sql');
const body=(name)=>{const start=migration.indexOf(`create or replace function public.${name}(`);assert.ok(start>=0,name);return migration.slice(start,migration.indexOf('$function$;',start));};

test('approval only takes a first-10 place, no automatic pass',()=>{
  const sync=body('pc_sync_founders');
  assert.match(sync,/insert into public\.pc_early_players/);
  assert.ok(!/insert into public\.pc_access_passes/.test(sync),'no free pass on approval');
});

test('owner gifts a pass to at most three of the first ten and can take only that gift back',()=>{
  const gift=body('pc_set_founder_pass');
  assert.match(gift,/if gifted >= 3 then\s*return 'limit';/);
  assert.match(gift,/e\.released_at is not null or e\.kind <> 'founder'/);
  assert.match(gift,/w\.status = 'approved' and not w\.is_deleted and not w\.is_banned/);
  assert.match(gift,/values \(p_user, player_login, 'founder', left\(coalesce\(p_by, ''\), 60\)\)/);
  assert.match(gift,/if current_source <> 'founder' then\s*return 'not-gift';/);
  assert.match(gift,/delete from public\.pc_access_passes where user_id = p_user and source = 'founder';/);
  assert.match(migration,/revoke all on function public\.pc_set_founder_pass\(uuid, boolean, text\) from public, anon, authenticated;/);
  assert.match(migration,/grant execute on function public\.pc_set_founder_pass\(uuid, boolean, text\) to service_role;/);
  const payments=read('lib/payments.ts');
  assert.match(payments,/export const FOUNDER_FREE_PASSES = 3;/);
  assert.match(payments,/db\(\)\.rpc\("pc_set_founder_pass", \{ p_user: userId, p_grant: grant, p_by: by\.slice\(0, 60\) \}\)/);
  assert.match(payments,/pass: passBy\.get\(row\.user_id\) \?\? null,/);
  assert.match(payments,/founderPasses: FOUNDER_FREE_PASSES,/);
  const route=read('app/api/admin/payments/route.ts');
  assert.match(route,/body\?\.action === "founder-pass"\) \{\n\s*if \(admin\.profile\.role !== "owner"\)/,'owner only');
});

test('admin list shows each pass and the gift buttons',()=>{
  const panel=read('app/admin/AdminPaymentsPanel.tsx');
  assert.match(panel,/"ПОДАРИТЬ ПРОПУСК"/);
  assert.match(panel,/"ЗАБРАТЬ ПРОПУСК"/);
  assert.match(panel,/без пропуска — оплачивает сам/);
  assert.match(panel,/Пропуск подарен: \{passFounders\} из \{passLimit\}/);
  assert.ok(!panel.includes('получают пропуск бесплатно — место'),'old rule text is gone');
});

test('make-player-now says the pass is still to be paid',()=>{
  const route=read('app/api/admin/applications/route.ts');
  assert.match(route,/const needsPass = data\.user_id \? !\(await hasServerAccess\(String\(data\.user_id\)\)\) : false;/);
  assert.match(route,/return NextResponse\.json\(\{ ok: true, status: "approved", needsPass \}\);/);
  assert.match(read('app/admin/AdminDashboard.tsx'),/result\.needsPass\n\s*\? "Игрок принят решением администратора\. Играть он сможет после оплаты пропуска\."/);
  assert.ok(read('lib/i18n/en.ts').includes('"Игрок принят решением администратора. Играть он сможет после оплаты пропуска.":'));
  const guide=read('lib/poppers-site-guide.ts');
  assert.ok(!guide.includes('тоже получают пропуск бесплатно'));
  assert.match(guide,/«Сделать игроком сейчас» заменяет только голосование за анкету: пропуск игрок всё равно оплачивает сам/);
});
