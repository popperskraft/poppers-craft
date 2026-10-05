const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function load(file, overrides = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, require: name => Object.hasOwn(overrides, name) ? overrides[name] : require(name) });
  return exports;
}
const shared = load('lib/streak.ts');
const { calculateStreak, streakDay, isStreakDay, formatStreakDays } = shared;
const art = load('lib/streak-art.ts', { 'server-only': {} });
const { getStreakFlame } = art;
const flameDays = [1,2,3,5,7,10,14,18,21,25,30,40,50,60,75,90,120,150,180,210,240,270,300,365];
const at = value => Date.parse(value);
const now = at('2026-10-01T12:00:00Z');

test('first visit, same-day reconnects and the second consecutive day', () => {
  assert.equal(calculateStreak([], now).currentDays, 0);
  const first = calculateStreak(['2026-10-01', '2026-10-01'], now);
  assert.equal(first.currentDays, 1); assert.equal(first.playedToday, true);
  assert.equal(calculateStreak(['2026-09-30', '2026-10-01'], now).currentDays, 2);
});
test('yesterday stays alive all today, one missed day expires without changing best', () => {
  const days = ['2026-09-28', '2026-09-29', '2026-09-30'];
  const active = calculateStreak(days, at('2026-10-01T20:59:59.999Z'));
  assert.equal(active.currentDays, 3); assert.equal(active.playedToday, false);
  const expired = calculateStreak(days, at('2026-10-01T21:00:00Z'));
  assert.equal(expired.currentDays, 0); assert.equal(expired.bestDays, 3);
  assert.equal(calculateStreak([...days, '2026-10-02'], at('2026-10-02T12:00:00Z')).currentDays, 1);
});
test('Moscow midnight is UTC 21:00, independent of browser timezone and DST', () => {
  assert.equal(streakDay(at('2026-10-01T20:59:59.999Z')), '2026-10-01');
  assert.equal(streakDay(at('2026-10-01T21:00:00Z')), '2026-10-02');
  assert.equal(streakDay(at('2026-03-29T21:00:00Z')), '2026-03-30');
});
test('unsorted, duplicate, invalid and future days cannot inflate series', () => {
  const result = calculateStreak(['2026-10-03', 'garbage', '2026-02-30', '2026-10-01', '2026-09-30', '2026-10-01'], now);
  assert.equal(result.currentDays, 2); assert.equal(result.bestDays, 2);
  assert.equal(result.lastActiveDay, '2026-10-01');
  assert.equal(isStreakDay('2026-02-29'), false); assert.equal(isStreakDay('2028-02-29'), true);
});
test('leap day, year boundary, a full year and beyond are real calendar days', () => {
  assert.equal(calculateStreak(['2028-02-28', '2028-02-29', '2028-03-01'], at('2028-03-01T10:00:00Z')).currentDays, 3);
  assert.equal(calculateStreak(['2026-12-31', '2027-01-01'], at('2027-01-01T10:00:00Z')).currentDays, 2);
  const days = Array.from({ length: 400 }, (_, i) => new Date(now - i * 86400000).toISOString().slice(0, 10));
  assert.equal(calculateStreak(days, now).currentDays, 400);
  assert.equal(getStreakFlame(400), getStreakFlame(365));
});
test('best run survives several resets and current can beat it', () => {
  const days = ['2026-09-20', '2026-09-21', '2026-09-22', '2026-09-23', '2026-09-29', '2026-10-01'];
  assert.equal(calculateStreak(days, now).bestDays, 4); assert.equal(calculateStreak(days, now).currentDays, 1);
});
test('24 distinct flames change at each boundary, never one day early', () => {
  const unlocked = new Set();
  let previous = null;
  for (const days of flameDays) {
    assert.equal(getStreakFlame(days - 1), previous);
    const source = getStreakFlame(days);
    assert.match(source, /^\/streak\/flames\/[a-f0-9]{20}\.svg$/);
    assert.notEqual(source, previous);
    unlocked.add(source);
    previous = source;
  }
  assert.equal(unlocked.size, 24);
  assert.equal(getStreakFlame(10000), previous);
});
test('an inactive or invalid streak does not receive a flame', () => {
  for (const days of [0, -1, 0.9, NaN, Infinity, -Infinity]) {
    assert.equal(getStreakFlame(days), null);
  }
});
test('shared client helpers disclose no thresholds, names or flame catalog', () => {
  assert.deepEqual(Object.keys(shared).sort(), ['calculateStreak', 'formatStreakDays', 'isStreakDay', 'streakDay']);
  assert.deepEqual(Object.keys(art), ['getStreakFlame']);
  assert.match(fs.readFileSync('lib/streak-art.ts', 'utf8'), /^import "server-only";/);
});
test('Russian day forms remain correct through yearly milestones', () => {
  for (const [n, expected] of [[0,'0 дней'],[1,'1 день'],[2,'2 дня'],[5,'5 дней'],[11,'11 дней'],[14,'14 дней'],[21,'21 день'],[22,'22 дня'],[111,'111 дней'],[365,'365 дней']]) {
    assert.equal(formatStreakDays(n), expected);
  }
});

function snapshot(overrides = {}) {
  return {version:1, timeZone:'Europe/Moscow', utcOffsetMinutes:180, source:'poppersauth-confirmed-logins', generatedAt:new Date(now).toISOString(), players:{alice:{days:['2026-09-30','2026-10-01']}}, ...overrides};
}
// Supply only the expected environment, never credentials, to the reader VM.
const originalLoad = load;
function loadReader(value, onRead = () => {}) {
  const exports = {};
  const output = ts.transpileModule(fs.readFileSync('lib/player-streak.ts','utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(output, {exports, process:{env:{}}, require:name=>({
    'server-only':{}, './streak':shared, './streak-art':art,
    'node:fs/promises':{readFile:async()=>{onRead();if(value instanceof Error)throw value;return typeof value==='string'?value:JSON.stringify(value);}},
  })[name]});
  return exports;
}
test('reader reveals only requested player summary and current flame; missing player starts at zero', async () => {
  const {getPlayerStreak} = loadReader(snapshot());
  const value = await getPlayerStreak('ALICE', now);
  assert.equal(value.currentDays, 2); assert.equal('players' in value, false); assert.equal('days' in value, false);
  assert.equal(value.flameSrc, getStreakFlame(2));
  assert.deepEqual(Object.keys(value).sort(), ['bestDays', 'currentDays', 'flameSrc', 'lastActiveDay', 'playedToday', 'today', 'updatedAt']);
  const missing = await getPlayerStreak('bob', now);
  assert.equal(missing.currentDays, 0); assert.equal(missing.flameSrc, null);
  assert.equal(await getPlayerStreak('../../etc/passwd', now), null);
});
test('reader fails closed for missing, corrupt, wrong-source and stale snapshots', async () => {
  for(const value of [new Error('ENOENT'), '{broken', snapshot({version:2}), snapshot({source:'raw-joins'}), snapshot({timeZone:'UTC'}), snapshot({utcOffsetMinutes:0}), snapshot({generatedAt:new Date(now-180001).toISOString()}), snapshot({generatedAt:new Date(now+31000).toISOString()}), snapshot({players:{alice:{days:['2026-02-30']}}})]) {
    assert.equal(await loadReader(value).getPlayerStreak('alice', now), null);
  }
});
test('reader cache is shared, expires, and recomputes streak on each day', async () => {
  let reads = 0;
  const readerNow = at('2026-10-01T20:59:59Z');
  const {getPlayerStreak} = loadReader(snapshot({generatedAt:new Date(readerNow).toISOString(),players:{alice:{days:['2026-09-30']}}}),()=>reads++);
  assert.equal((await getPlayerStreak('alice',readerNow)).currentDays,1);
  const expired = await getPlayerStreak('alice',readerNow+1000);
  assert.equal(expired.currentDays,0); assert.equal(expired.flameSrc,null);
  await getPlayerStreak('bob',readerNow+2000); assert.equal(reads,1);
  await getPlayerStreak('alice',readerNow+10000); assert.equal(reads,2);
});
test('malformed existing player entries never become an empty history', async () => {
  for (const player of [null, false, 0, '', [], 'invalid', {}]) {
    assert.equal(await loadReader(snapshot({players:{alice:player}})).getPlayerStreak('alice',now),null);
  }
});

function route(viewer, target, streak) {
  let reads = 0, queries = 0;
  const query = {select(){return this},eq(){return this},async maybeSingle(){queries++;return target}};
  const {GET} = originalLoad('app/api/profiles/[login]/streak/route.ts', {
    'next/server':{NextResponse:{json:(body,options)=>({body,...options})}},
    '@/lib/community':{getCommunityViewer:async()=>viewer},
    '@/lib/supabase/admin':{createSupabaseAdminClient:()=>({from:()=>query})},
    '@/lib/player-streak':{getPlayerStreak:async()=>{reads++;return streak}},
    '@/lib/waitlist':{normalizeLogin:s=>s.trim().toLowerCase()},
  });
  return {get:login=>GET({}, {params:Promise.resolve({login})}), counts:()=>({reads,queries})};
}
test('endpoint checks viewer and profile existence before reading streaks', async () => {
  const guest=route(null,{data:{login:'alice'}},{});
  assert.equal((await guest.get('alice')).status,401); assert.deepEqual(guest.counts(),{reads:0,queries:0});
  const missing=route({}, {data:null}, {});
  assert.equal((await missing.get('alice')).status,404); assert.equal(missing.counts().reads,0);
  const failure=route({}, {data:null,error:{}}, {});
  assert.equal((await failure.get('alice')).status,503); assert.equal(failure.counts().reads,0);
});
test('endpoint never caches private responses and distinguishes unavailable from zero', async () => {
  const noData=await route({}, {data:{login:'alice'}}, null).get('alice');
  assert.equal(noData.status,503); assert.equal(noData.body.streak,null);
  const zero=await route({}, {data:{login:'alice'}}, {...calculateStreak([],now),flameSrc:null}).get('alice');
  assert.equal(zero.status,200); assert.equal(zero.headers['Cache-Control'],'private, no-store');
  assert.equal(zero.body.streak.currentDays,0);
  assert.equal(zero.body.streak.flameSrc,null);
  assert.equal((await route({}, {data:{login:'alice'}},{}).get('bad/path')).status,404);
});
