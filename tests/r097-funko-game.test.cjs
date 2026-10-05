/* r097: FANKOPOP в игре — задания с прогрессом, выдача фигурки игровому моду
   poppersfunko, победы в ивентах, ресурс-пак с моделями фигурок. */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const read=p=>fs.readFileSync(p,'utf8');

test('tasks: 180-day streak, 300 hours, one event win; claimed once per player',()=>{
  const lib=read('lib/funko.ts');
  assert.match(lib,/\{ id: "streak", title: "Полгода на сервере", detail: "заходить каждый день 180 дней подряд", target: 180, unit: "дн\." \}/);
  assert.match(lib,/\{ id: "playtime", title: "Ветеран", detail: "наиграть 300 часов", target: 300, unit: "ч" \}/);
  assert.match(lib,/\{ id: "event", title: "Чемпион ивента", detail: "выиграть официальный ивент сервера", target: 1, unit: "" \}/);
  assert.match(lib,/const streakDone = \(streak\?\.bestDays \?\? 0\) >= FUNKO_TASKS\[0\]\.target;/);
  const sql=read('supabase/migrations/20261003150000_r097_funko_claim.sql');
  assert.match(sql,/if exists \(select 1 from public\.pc_funko_figures where owner_id = p_user and via = 'tasks'\) then\s*return 'nothing';/);
  assert.match(sql,/if not p_tasks_done then\s*return 'not-ready';/);
  assert.match(sql,/order by -ln\(1 - random\(\)\) \/ rarity_weight/);
  assert.match(sql,/grant execute on function public\.pc_funko_claim\(uuid, text, boolean\) to service_role;/);
});

test('game API needs the launcher key; claim and progress go through the site',()=>{
  const route=read('app/api/game/funko/route.ts');
  assert.match(route,/timingSafeEqual/);
  assert.match(route,/if \(!authorized\(request\)\) return NextResponse\.json\(\{ error: "Unauthorized" \}, \{ status: 401/);
  assert.match(route,/await claimFunko\(login\)/);
  assert.match(route,/const progress = await funkoProgress\(login\);/);
});

test('admin: event wins and re-issuing a lost figurine are owner-only',()=>{
  const route=read('app/api/admin/funko/route.ts');
  const ownerCheck=route.indexOf('if (admin.profile.role !== "owner")');
  assert.ok(ownerCheck>0&&ownerCheck<route.indexOf('body?.action === "event-win"')&&ownerCheck<route.indexOf('body?.action === "redeliver"'));
  const panel=read('app/admin/AdminFunkoPanel.tsx');
  assert.match(panel,/ЗАСЧИТАТЬ ПОБЕДУ/);
  assert.match(panel,/ВЫДАТЬ ПРЕДМЕТ ЗАНОВО/);
});

test('resource pack route serves only hashed funko packs',()=>{
  const route=read('app/api/packs/[name]/route.ts');
  assert.match(route,/const NAME = \/\^popperscraft-funko-\[0-9a-f\]\{12\}\\\.zip\$\/;/);
  assert.match(route,/if \(!NAME\.test\(name\)\) return new Response\("Not found", \{ status: 404 \}\);/);
});
