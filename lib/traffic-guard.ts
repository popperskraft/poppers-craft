/* Защита сайта от перегрузки и очередь на открытие (proxy.ts).

   Решения владельца (2026-10-02):
   • больше 4000 активных посетителей — «новые ждут»: тем, кто уже на сайте,
     всё работает, а новым показывается «Сайт перегружен», и страница сама
     пробует снова через 30 секунд. Нагрузка спала — пускаем всех;
   • в момент открытия (отсчёт в «Управлении») — очередь: пускаем по 10
     человек каждые 10 секунд, остальные видят своё место и время ожидания;
   • плюс ограничение запросов с одного адреса — от простого флуда.

   Здесь только логика без Next.js и с часами снаружи, чтобы её можно было
   проверить тестами (tests/r091-traffic-guard.test.cjs). От настоящей атаки
   на канал сервера спасает только прокси Cloudflare перед сайтом. */

export type GuardConfig = {
  /* Активный посетитель — был на сайте за последнюю минуту. */
  overloadLimit: number;
  /* Перегрузка снимается, когда активных станет меньше этого числа. */
  overloadRelease: number;
  activeWindowMs: number;
  /* «Уже на сайте» — заходил за последние 5 минут: таких во время перегрузки пускаем. */
  knownWindowMs: number;
  ipLimit: number;
  ipWindowMs: number;
  ipBlockMs: number;
  queueBatch: number;
  queueBatchMs: number;
  /* Сколько после открытия действует очередь (пустая очередь никого не держит). */
  queueDurationMs: number;
  /* Больше мест в очереди с одного адреса не выдаём — боты не раздуют её. */
  ticketsPerIp: number;
  maxTracked: number;
};

export const DEFAULT_GUARD: GuardConfig = {
  overloadLimit: 4000,
  overloadRelease: 3500,
  activeWindowMs: 60_000,
  knownWindowMs: 5 * 60_000,
  /* С запасом: за одним адресом бывают несколько игроков (общий VPN, дом),
     а Next заранее подгружает страницы по ссылкам. */
  ipLimit: 600,
  ipWindowMs: 10_000,
  ipBlockMs: 60_000,
  queueBatch: 10,
  queueBatchMs: 10_000,
  queueDurationMs: 3 * 60 * 60_000,
  ticketsPerIp: 5,
  maxTracked: 60_000,
};

export function createTrafficGuard(config: GuardConfig = DEFAULT_GUARD) {
  const seen = new Map<string, number>();
  const ipHits = new Map<string, { count: number; start: number }>();
  const ipBlocked = new Map<string, number>();
  const ipTickets = new Map<string, { count: number; admitAt: number; since: number }>();
  let overloaded = false;
  let batchStart = -Infinity;
  let batchFill = 0;
  let lastPrune = 0;
  /* Подсчёт активных — не чаще раза в секунду: под нагрузкой таблица большая. */
  let countedAt = -Infinity;
  let counted = 0;

  function prune(now: number) {
    if (now - lastPrune < 5_000 && seen.size < config.maxTracked) return;
    lastPrune = now;
    for (const [key, at] of seen) if (now - at > config.knownWindowMs) seen.delete(key);
    for (const [ip, entry] of ipHits) if (now - entry.start > config.ipWindowMs) ipHits.delete(ip);
    for (const [ip, until] of ipBlocked) if (until <= now) ipBlocked.delete(ip);
    for (const [ip, entry] of ipTickets) if (now - entry.since > config.queueDurationMs) ipTickets.delete(ip);
    /* Под атакой со множества адресов таблица не растёт бесконечно. */
    if (seen.size > config.maxTracked) {
      const drop = seen.size - config.maxTracked;
      let index = 0;
      for (const key of seen.keys()) { if (index++ >= drop) break; seen.delete(key); }
    }
  }

  function activeCount(now: number) {
    let count = 0;
    for (const at of seen.values()) if (now - at <= config.activeWindowMs) count++;
    return count;
  }

  return {
    /* Ограничение запросов с адреса. exempt — сервер и свои службы. */
    rateLimit(ip: string, now: number, exempt = false): { ok: true } | { ok: false; retryAfter: number } {
      if (exempt || !ip) return { ok: true };
      const blockedUntil = ipBlocked.get(ip);
      if (blockedUntil && blockedUntil > now) return { ok: false, retryAfter: Math.ceil((blockedUntil - now) / 1000) };
      const entry = ipHits.get(ip);
      if (!entry || now - entry.start > config.ipWindowMs) {
        ipHits.set(ip, { count: 1, start: now });
        return { ok: true };
      }
      entry.count++;
      if (entry.count > config.ipLimit) {
        ipBlocked.set(ip, now + config.ipBlockMs);
        return { ok: false, retryAfter: Math.ceil(config.ipBlockMs / 1000) };
      }
      return { ok: true };
    },

    /* Был ли посетитель на сайте в последние минуты (до этого запроса). */
    isKnown(key: string, now: number) {
      const at = seen.get(key);
      return at !== undefined && now - at <= config.knownWindowMs;
    },

    record(key: string, now: number) {
      seen.delete(key);
      seen.set(key, now);
      prune(now);
    },

    /* Перегрузка с запасом: включается выше лимита, выключается ниже порога. */
    isOverloaded(now: number) {
      prune(now);
      if (now - countedAt >= 1_000) {
        counted = activeCount(now);
        countedAt = now;
      }
      const active = counted;
      if (!overloaded && active > config.overloadLimit) overloaded = true;
      else if (overloaded && active < config.overloadRelease) overloaded = false;
      return overloaded;
    },

    /* Очередь открыта с opensAt и ещё queueDurationMs после него. */
    queueActive(opensAt: number | null, now: number) {
      return opensAt !== null && now >= opensAt && now < opensAt + config.queueDurationMs;
    },

    /* Время, когда посетителя пустят: по queueBatch человек каждые
       queueBatchMs. Пустая очередь пускает сразу. */
    ticket(ip: string, now: number) {
      const own = ipTickets.get(ip);
      if (own && own.count >= config.ticketsPerIp) return Math.max(own.admitAt, now);
      if (now >= batchStart + config.queueBatchMs) {
        batchStart = now;
        batchFill = 0;
      }
      if (batchFill >= config.queueBatch) {
        batchStart += config.queueBatchMs;
        batchFill = 0;
      }
      batchFill++;
      const admitAt = Math.max(batchStart, now);
      ipTickets.set(ip, { count: (own?.count ?? 0) + 1, admitAt, since: own?.since ?? now });
      return admitAt;
    },

    /* Примерно сколько людей впереди, если пустят в admitAt. */
    ahead(admitAt: number, now: number) {
      if (admitAt <= now) return 0;
      return Math.ceil((admitAt - now) / config.queueBatchMs) * config.queueBatch;
    },

    stats(now: number) {
      return { active: activeCount(now), tracked: seen.size, overloaded, blockedIps: ipBlocked.size };
    },
  };
}

export type TrafficGuard = ReturnType<typeof createTrafficGuard>;

/* Какие запросы вообще держит очередь и перегрузка: только открытие
   страницы в браузере. Запросы данных идут со страниц, которые уже
   пропустили; служебные адреса (управление, вход, письма, оплата, лаунчер,
   нейросети, вебхуки) не держим никогда. */
const NEVER_HOLD = [
  /^\/admin(?:\/|$)/,
  /^\/api(?:\/|$)/,
  /^\/mfa(?:\/|$)/,
  /^\/auth(?:\/|$)/,
  /^\/oauth(?:\/|$)/,
  /^\/\.well-known(?:\/|$)/,
  /^\/mcp(?:\/|$)/,
  /^\/launcher\/authorize(?:\/|$)/,
  /^\/mail(?:\/|$)/,
  /^\/reset(?:\/|$)/,
  /^\/donation\/return(?:\/|$)/,
  /^\/media(?:\/|$)/,
];

const PREVIEW_BOTS = /TelegramBot|facebookexternalhit|Twitterbot|vkShare|WhatsApp|Slackbot|Discordbot|LinkedInBot|Googlebot|YandexBot|bingbot/i;

export function holdable(request: { method: string; pathname: string; accept: string; secFetchDest: string; rsc: boolean; userAgent: string }) {
  if (request.method !== "GET") return false;
  if (request.rsc) return false;
  if (NEVER_HOLD.some((pattern) => pattern.test(request.pathname))) return false;
  if (PREVIEW_BOTS.test(request.userAgent)) return false;
  return request.secFetchDest === "document" || (!request.secFetchDest && request.accept.includes("text/html"));
}

/* Подпись куки очереди и пропуска (HMAC, node:crypto в proxy). */
export type Signer = (value: string) => string;

export function makeTicketCookie(admitAt: number, nonce: string, sign: Signer) {
  const value = `${admitAt}.${nonce}`;
  return `${value}.${sign(value)}`;
}

export function readSigned(cookie: string | undefined, sign: Signer): { first: number; nonce: string } | null {
  const parts = String(cookie ?? "").split(".");
  if (parts.length !== 3) return null;
  const [first, nonce, signature] = parts;
  if (!/^\d{10,16}$/.test(first) || !/^[A-Za-z0-9_-]{6,40}$/.test(nonce)) return null;
  if (sign(`${first}.${nonce}`) !== signature) return null;
  return { first: Number(first), nonce };
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char] ?? char);
}

/* countdownSeconds — сколько ждать по часам сервера: отсчёт идёт от загрузки
   страницы, а не по часам посетителя, которые могут спешить или отставать. */
function page(title: string, body: string, refreshSeconds: number, countdownSeconds: number | null) {
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="${refreshSeconds}"><meta name="robots" content="noindex"><title>${escapeHtml(title)} — PoppersCraft</title>
<style>
@font-face{font-family:Monocraft;src:url(/Monocraft.ttf) format("truetype");font-display:swap}
*{box-sizing:border-box}html,body{margin:0;min-height:100%}
body{min-height:100vh;display:grid;place-items:center;padding:16px;background:linear-gradient(90deg,rgba(0,0,0,.06) 50%,transparent 50%) 0 0/8px 8px,#74b64b;font-family:Monocraft,"Courier New",monospace;color:#171717}
.w{width:min(560px,100%);border:3px solid;border-color:#fff #282828 #282828 #fff;box-shadow:10px 10px 0 #171717;background:#f4f1dd}
.b{display:flex;justify-content:space-between;padding:8px 12px;background:#1c44da;color:#fff;font-size:13px}
.c{padding:24px 22px 26px;display:grid;gap:14px}
h1{margin:0;font-size:clamp(26px,7vw,40px);line-height:1.1}
p{margin:0;font-size:14px;line-height:1.7}
.n{padding:14px;border:3px solid #171717;background:#d7ff24;box-shadow:4px 4px 0 #171717;font-size:16px;font-weight:900}
small{color:#555;font-size:11px;line-height:1.6}
</style></head><body><main class="w"><div class="b"><span>popperscraft.exe</span><span>□</span></div><div class="c">${body}</div></main>
${countdownSeconds ? `<script>(function(){var left=${countdownSeconds},start=Date.now(),done=false,e=document.getElementById("eta");function f(){var s=Math.max(0,Math.ceil(left-(Date.now()-start)/1000));if(e)e.textContent=s>59?Math.floor(s/60)+" мин "+(s%60)+" с":s+" с";if(s<=0&&!done){done=true;location.reload();}}f();setInterval(f,1000);})();</script>` : ""}
</body></html>`;
}

export function queuePage(ahead: number, admitAt: number, now: number) {
  const seconds = Math.max(1, Math.ceil((admitAt - now) / 1000));
  const eta = seconds > 59 ? `${Math.floor(seconds / 60)} мин ${seconds % 60} с` : `${seconds} с`;
  return page(
    "Очередь на вход",
    `<h1>ОЧЕРЕДЬ НА ВХОД</h1>
<p>Сервер только что открылся, и на сайт заходит очень много игроков. Чтобы всё работало, пускаем по 10 человек каждые 10 секунд.</p>
<div class="n">Перед вами примерно ${ahead} чел. · осталось <span id="eta">${eta}</span></div>
<p>Страница обновится сама — не закрывайте её. Место в очереди сохранится, даже если обновить вручную.</p>
<small>Queue: we let 10 people in every 10 seconds. This page refreshes by itself.</small>`,
    Math.min(10, Math.max(2, seconds)),
    seconds,
  );
}

export function overloadPage() {
  return page(
    "Сайт перегружен",
    `<h1>САЙТ ПЕРЕГРУЖЕН</h1>
<p>Сейчас на сайте очень много людей. Те, кто уже внутри, продолжают пользоваться сайтом, а новых пускаем, как только станет свободнее.</p>
<div class="n">Пробуем снова через <span id="eta">30 с</span></div>
<p>Страница обновится сама. Сервер Minecraft при этом работает как обычно.</p>
<small>The site is overloaded right now. This page retries by itself every 30 seconds.</small>`,
    30,
    null,
  );
}
