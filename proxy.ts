import { createHmac, randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  createTrafficGuard,
  DEFAULT_GUARD,
  holdable,
  makeTicketCookie,
  overloadPage,
  queuePage,
  readSigned,
} from "@/lib/traffic-guard";

/* Привратник перед сайтом (r091): ограничение запросов с адреса, «новые
   ждут» при перегрузке и очередь в момент открытия. Логика —
   lib/traffic-guard.ts. Сайт работает одним процессом Node, поэтому счётчики
   в памяти общие для всех запросов. Числа можно поменять переменными
   окружения PC_GUARD_* (для проверки на отдельном порту). */

const envNumber = (name: string, fallback: number) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

const guard = createTrafficGuard({
  ...DEFAULT_GUARD,
  overloadLimit: envNumber("PC_GUARD_OVERLOAD_LIMIT", DEFAULT_GUARD.overloadLimit),
  overloadRelease: envNumber("PC_GUARD_OVERLOAD_RELEASE", DEFAULT_GUARD.overloadRelease),
  ipLimit: envNumber("PC_GUARD_IP_LIMIT", DEFAULT_GUARD.ipLimit),
});

/* Сам сервер (лаунчер-API, уведомления, вебхуки через Caddy) не ограничиваем. */
const EXEMPT_IPS = new Set(["127.0.0.1", "::1", "2.26.229.244", ...(process.env.PC_GUARD_EXEMPT_IPS ?? "").split(",").map((ip) => ip.trim()).filter(Boolean)]);

const SIGN_KEY = createHmac("sha256", process.env.POPPERSCRAFT_BROWSER_SECRET || process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "pc-guard")
  .update("pc-traffic-guard-v1")
  .digest();
/* У билета очереди и пропуска разные подписи: иначе билет с будущим временем
   можно было подложить в куку пропуска и пройти без очереди. */
const signWith = (purpose: string) => (value: string) => createHmac("sha256", SIGN_KEY).update(`${purpose}:${value}`).digest("base64url").slice(0, 22);
const signTicket = signWith("pc_q");
const signPass = signWith("pc_in");
const nonce = () => randomBytes(12).toString("base64url");

const DAY = 24 * 60 * 60;
const COOKIE = { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production" && process.env.PC_GUARD_INSECURE_COOKIES !== "1", path: "/" };

/* Время открытия из «Управления» (тот же отсчёт, что на сайте). Читается не
   чаще раза в 5 минут — лимиты Supabase. */
let opening: { at: number | null; fetchedAt: number } = { at: null, fetchedAt: 0 };
async function openingAt(now: number) {
  const forced = Date.parse(process.env.PC_QUEUE_OPENS_AT ?? "");
  if (Number.isFinite(forced)) return forced;
  if (now - opening.fetchedAt < 5 * 60_000) return opening.at;
  opening = { at: opening.at, fetchedAt: now };
  try {
    const { data } = await createSupabaseAdminClient()
      .from("site_updates")
      .select("body")
      .eq("source_key", "__opening_countdown__")
      .maybeSingle();
    const stored = data?.body ? JSON.parse(data.body) as { opensAt?: string | null } : null;
    const at = typeof stored?.opensAt === "string" ? Date.parse(stored.opensAt) : NaN;
    opening = { at: Number.isFinite(at) ? at : null, fetchedAt: now };
  } catch {
    /* Сбой чтения не закрывает сайт: пробуем снова через минуту. */
    opening = { at: opening.at, fetchedAt: now - 4 * 60_000 };
  }
  return opening.at;
}

function clientIp(request: NextRequest) {
  const parts = (request.headers.get("x-forwarded-for") ?? "").split(",").map((part) => part.trim()).filter(Boolean);
  return parts.at(-1) ?? "";
}

function htmlResponse(html: string, status: number, extra: Record<string, string> = {}) {
  return new NextResponse(html, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", ...extra },
  });
}

export async function proxy(request: NextRequest) {
  const now = Date.now();
  const ip = clientIp(request);
  const exempt = EXEMPT_IPS.has(ip);

  const limit = guard.rateLimit(ip, now, exempt);
  if (!limit.ok) {
    return new NextResponse("Слишком много запросов с вашего адреса. Подождите минуту. / Too many requests, please wait a minute.", {
      status: 429,
      headers: { "Retry-After": String(limit.retryAfter), "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  }
  if (exempt) return NextResponse.next();

  const vid = request.cookies.get("pc_vid")?.value;
  const visitor = vid && /^[A-Za-z0-9_-]{16,40}$/.test(vid) ? vid : null;
  const key = visitor ?? `ip:${ip}`;
  let admission: string | null = null;

  const hold = holdable({
    method: request.method,
    pathname: request.nextUrl.pathname,
    accept: request.headers.get("accept") ?? "",
    secFetchDest: request.headers.get("sec-fetch-dest") ?? "",
    rsc: request.headers.get("rsc") === "1" || request.nextUrl.searchParams.has("_rsc"),
    userAgent: request.headers.get("user-agent") ?? "",
  });

  if (hold) {
    /* Очередь в момент открытия: по 10 человек каждые 10 секунд. */
    const opensAt = await openingAt(now);
    if (opensAt !== null && guard.queueActive(opensAt, now)) {
      const pass = readSigned(request.cookies.get("pc_in")?.value, signPass);
      if (!pass || pass.first < now) {
        const held = readSigned(request.cookies.get("pc_q")?.value, signTicket);
        const valid = held && held.first >= opensAt - 60_000 && held.first <= opensAt + DEFAULT_GUARD.queueDurationMs;
        const admitAt = valid ? held.first : guard.ticket(ip, now);
        if (admitAt > now) {
          const response = htmlResponse(queuePage(guard.ahead(admitAt, now), admitAt, now), 200);
          if (!valid) response.cookies.set("pc_q", makeTicketCookie(admitAt, nonce(), signTicket), { ...COOKIE, maxAge: 6 * 60 * 60 });
          return response;
        }
        admission = makeTicketCookie(now + DAY * 1000, nonce(), signPass);
      }
    }

    /* Перегрузка: тех, кто уже на сайте, пускаем, новые ждут. */
    /* Первый заход посетитель делает без метки pc_vid — он записан по адресу,
       поэтому «уже на сайте» проверяем и по метке, и по адресу. */
    const known = guard.isKnown(key, now) || guard.isKnown(`ip:${ip}`, now);
    if (guard.isOverloaded(now) && !known) {
      return htmlResponse(overloadPage(), 503, { "Retry-After": "30" });
    }
  }

  guard.record(key, now);
  const response = NextResponse.next();
  if (!visitor) response.cookies.set("pc_vid", nonce() + nonce(), { ...COOKIE, maxAge: 30 * DAY });
  if (admission) response.cookies.set("pc_in", admission, { ...COOKIE, maxAge: DAY });
  return response;
}

/* Статика (картинки, шрифты, стили, скрипты, видео) идёт мимо привратника. */
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|.*\\.(?:png|jpg|jpeg|gif|webp|avif|svg|ico|css|js|map|woff|woff2|ttf|otf|mp4|webm|mp3|ogg|txt|xml|json|webmanifest)$).*)",
  ],
};
