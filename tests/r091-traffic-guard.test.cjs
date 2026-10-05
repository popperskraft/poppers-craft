/* r091: защита от перегрузки и очередь на открытие (lib/traffic-guard.ts, proxy.ts). */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript'),crypto=require('node:crypto');
const read=p=>fs.readFileSync(p,'utf8');
function load(p){const exports={};vm.runInNewContext(ts.transpileModule(read(p),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Math,Map,Number,String,Infinity});return exports;}
const g=load('lib/traffic-guard.ts');
const T0=Date.parse('2026-10-10T07:00:00Z');

test('opening queue: 10 people every 10 seconds, empty queue lets in at once',()=>{
  const guard=g.createTrafficGuard(g.DEFAULT_GUARD);
  const times=[];for(let i=0;i<25;i++)times.push(guard.ticket('10.0.0.'+i,T0));
  assert.deepEqual(times.slice(0,10),Array(10).fill(T0),'first ten go in immediately');
  assert.deepEqual(times.slice(10,20),Array(10).fill(T0+10_000),'next ten in 10 seconds');
  assert.deepEqual(times.slice(20),Array(5).fill(T0+20_000));
  assert.equal(guard.ahead(T0+20_000,T0),20);
  assert.equal(guard.ahead(T0,T0),0);
  /* Через минуту очередь пуста — новый человек входит сразу. */
  assert.equal(guard.ticket('10.0.1.1',T0+60_000),T0+60_000);
});

test('one address cannot inflate the queue',()=>{
  const guard=g.createTrafficGuard({...g.DEFAULT_GUARD,queueBatch:1,queueBatchMs:1000});
  const own=[];for(let i=0;i<8;i++)own.push(guard.ticket('6.6.6.6',T0));
  assert.deepEqual(own.slice(0,5),[T0,T0+1000,T0+2000,T0+3000,T0+4000]);
  assert.deepEqual(own.slice(5),[T0+4000,T0+4000,T0+4000],'sixth and later reuse the last place');
  assert.equal(guard.ticket('7.7.7.7',T0),T0+5000,'others are not pushed back by the extra requests');
});

test('queue window: from the opening for three hours',()=>{
  const guard=g.createTrafficGuard(g.DEFAULT_GUARD);
  assert.equal(guard.queueActive(null,T0),false);
  assert.equal(guard.queueActive(T0,T0-1),false);
  assert.equal(guard.queueActive(T0,T0),true);
  assert.equal(guard.queueActive(T0,T0+3*60*60_000-1),true);
  assert.equal(guard.queueActive(T0,T0+3*60*60_000),false);
});

test('overload: above the limit new visitors wait, those already inside keep going',()=>{
  const guard=g.createTrafficGuard({...g.DEFAULT_GUARD,overloadLimit:3,overloadRelease:2});
  for(const key of ['a','b','c'])guard.record(key,T0);
  assert.equal(guard.isOverloaded(T0),false,'exactly at the limit is fine');
  guard.record('d',T0+1);
  assert.equal(guard.isOverloaded(T0+1_001),true);
  assert.equal(guard.isKnown('a',T0+1_001),true,'already inside');
  assert.equal(guard.isKnown('new',T0+1_001),false,'new visitor waits');
  /* Через две минуты никто не активен — перегрузка снята. */
  assert.equal(guard.isOverloaded(T0+120_000),false);
  assert.equal(g.DEFAULT_GUARD.overloadLimit,4000);
});

test('per-address limit blocks floods for a minute, the server itself is exempt',()=>{
  const guard=g.createTrafficGuard({...g.DEFAULT_GUARD,ipLimit:5});
  for(let i=0;i<5;i++)assert.equal(guard.rateLimit('1.1.1.1',T0+i).ok,true);
  const blocked=guard.rateLimit('1.1.1.1',T0+6);
  assert.equal(blocked.ok,false);assert.equal(blocked.retryAfter,60);
  assert.equal(guard.rateLimit('1.1.1.1',T0+30_000).ok,false,'still blocked');
  assert.equal(guard.rateLimit('1.1.1.1',T0+61_000).ok,true,'released after a minute');
  for(let i=0;i<50;i++)assert.equal(guard.rateLimit('2.26.229.244',T0,true).ok,true);
});

test('only page openings are held; service addresses never',()=>{
  const req=(pathname,extra={})=>g.holdable({method:'GET',pathname,accept:'text/html',secFetchDest:'document',rsc:false,userAgent:'Mozilla/5.0',...extra});
  assert.equal(req('/'),true);assert.equal(req('/feed'),true);assert.equal(req('/donation'),true);
  for(const path of ['/admin','/admin/x','/api/login','/mfa','/auth/callback','/oauth/authorize','/.well-known/oauth-protected-resource','/mcp','/launcher/authorize','/mail','/reset','/donation/return','/media/launcher-install-windows.mp4'])assert.equal(req(path),false,path);
  assert.equal(req('/',{method:'POST'}),false);
  assert.equal(req('/feed',{rsc:true}),false,'client navigation of an admitted page');
  assert.equal(req('/',{userAgent:'TelegramBot (like TwitterBot)'}),false,'link previews still work');
  assert.equal(req('/',{secFetchDest:'',accept:'text/html,application/xhtml+xml'}),true);
  assert.equal(req('/',{secFetchDest:'empty',accept:'*/*'}),false);
});

test('queue tickets and passes are signed',()=>{
  const sign=value=>crypto.createHmac('sha256','k').update(value).digest('base64url').slice(0,22);
  const cookie=g.makeTicketCookie(T0,'abcdef123',sign);
  assert.deepEqual({...g.readSigned(cookie,sign)},{first:T0,nonce:'abcdef123'});
  assert.equal(g.readSigned(cookie.replace(String(T0),String(T0-60_000)),sign),null,'moving the place forward breaks the signature');
  assert.equal(g.readSigned('garbage',sign),null);
  assert.equal(g.readSigned(undefined,sign),null);
});

test('pages and proxy wiring',()=>{
  const queue=g.queuePage(40,T0+40_000,T0);
  assert.match(queue,/ОЧЕРЕДЬ НА ВХОД/);assert.match(queue,/Перед вами примерно 40 чел\./);assert.match(queue,/пускаем по 10 человек каждые 10 секунд/);assert.match(queue,/http-equiv="refresh" content="10"/);
  /* Отсчёт — от загрузки страницы по секундам сервера, не по часам посетителя. */
  assert.match(queue,/var left=40,start=Date\.now\(\)/);assert.ok(!queue.includes(String(T0+40_000)));
  const overload=g.overloadPage();
  assert.match(overload,/САЙТ ПЕРЕГРУЖЕН/);assert.match(overload,/content="30"/);
  const proxy=read('proxy.ts');
  assert.match(proxy,/export async function proxy\(request: NextRequest\)/);
  assert.match(proxy,/"2\.26\.229\.244"/);
  assert.match(proxy,/return htmlResponse\(overloadPage\(\), 503, \{ "Retry-After": "30" \}\);/);
  assert.match(proxy,/status: 429/);
  /* Первый заход — без метки pc_vid, записан по адресу: при перегрузке он уже «внутри». */
  assert.match(proxy,/const known = guard\.isKnown\(key, now\) \|\| guard\.isKnown\(`ip:\$\{ip\}`, now\);/);
  assert.match(proxy,/if \(now - opening\.fetchedAt < 5 \* 60_000\) return opening\.at;/,'opening time read at most every 5 minutes');
  assert.match(proxy,/_next\/static\|_next\/image/);
});
