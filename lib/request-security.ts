import "server-only";

import { createHash, createHmac, randomInt } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type LimitOptions = {
  scope: string;
  limit: number;
  windowSeconds: number;
  key?: string;
  cost?: number;
};

type LimitResult = { allowed: boolean; remaining: number; retryAfter: number };

const fallbackCounters = new Map<string, { count: number; resetAt: number }>();
const SECURITY_PREFIX = "__security_rate__";

const companionGlobalLimits: Record<string, { limit: number; windowSeconds: number }> = {
  "feed-media-mb": { limit: 8_192, windowSeconds: 24 * 60 * 60 },
};

function signingSecret() {
  return process.env.SUPABASE_SECRET_KEY
    || process.env.SUPABASE_SERVICE_ROLE_KEY
    || process.env.TELEGRAM_BOT_TOKEN
    || "popperscraft-local-request-security";
}

function stableHash(value: string) {
  return createHmac("sha256", signingSecret()).update(value).digest("hex").slice(0, 32);
}

/* Адрес посетителя для лимитов. Сайт стоит за Caddy, и доверять можно только
   последнему значению X-Forwarded-For — его дописывает сам Caddy. Первое
   значение и заголовки вроде x-vercel-forwarded-for или cf-connecting-ip
   может прислать кто угодно, и тогда каждый запрос считался бы «новым
   посетителем» — лимиты попыток перестали бы работать. */
export function clientAddress(request: Request) {
  return clientAddressFrom(request.headers);
}

/* То же по заголовкам — для серверных компонентов, где нет объекта Request. */
export function clientAddressFrom(headers: Headers) {
  const parts = (headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length ? parts[parts.length - 1].slice(0, 100) : "unknown";
}

function fallbackLimit(key: string, limit: number, windowSeconds: number, cost: number): LimitResult {
  const now = Date.now();
  if (fallbackCounters.size > 2_000) {
    for (const [entryKey, entry] of fallbackCounters) {
      if (entry.resetAt <= now) fallbackCounters.delete(entryKey);
    }
  }
  const existing = fallbackCounters.get(key);
  const entry = !existing || existing.resetAt <= now
    ? { count: 0, resetAt: now + windowSeconds * 1_000 }
    : existing;
  entry.count += cost;
  fallbackCounters.set(key, entry);
  return {
    allowed: entry.count <= limit,
    remaining: Math.max(0, limit - entry.count),
    retryAfter: Math.max(1, Math.ceil((entry.resetAt - now) / 1_000)),
  };
}

function deniedForWindow(windowStart: Date, windowSeconds: number, now: number): LimitResult {
  return {
    allowed: false,
    remaining: 0,
    retryAfter: Math.max(1, Math.ceil((windowStart.getTime() + windowSeconds * 1_000 - now) / 1_000)),
  };
}

function greatestCommonDivisor(left: number, right: number) {
  let a = left;
  let b = right;
  while (b !== 0) [a, b] = [b, a % b];
  return a;
}

async function claimPersistentLimit(options: Required<Pick<LimitOptions, "scope" | "limit" | "windowSeconds" | "cost">> & { identity: string }): Promise<LimitResult> {
  const identityHash = stableHash(`${options.scope}:${options.identity}`);
  const now = Date.now();
  const windowStart = new Date(Math.floor(now / (options.windowSeconds * 1_000)) * options.windowSeconds * 1_000);
  const prefix = `${SECURITY_PREFIX}:${options.scope}:${identityHash}:${windowStart.toISOString()}:`;
  const retryAfter = Math.max(1, Math.ceil((windowStart.getTime() + options.windowSeconds * 1_000 - now) / 1_000));

  try {
    const database = createSupabaseAdminClient();
    const baseQuery = () => database
      .from("site_updates")
      .select("id", { count: "exact", head: true })
      .gte("source_key", prefix)
      .lt("source_key", `${prefix}\uffff`);
    const [{ count: totalCount, error: countError }, { count: legacyCount, error: legacyError }] = await Promise.all([
      baseQuery(),
      baseQuery().not("source_key", "like", "%:slot:%"),
    ]);
    if (countError) throw countError;
    if (legacyError) throw legacyError;

    const consumed = Number(totalCount ?? 0);
    const legacyRows = Number(legacyCount ?? 0);
    const availableSlotCount = Math.max(0, options.limit - legacyRows);
    if (consumed + options.cost > options.limit || availableSlotCount < options.cost) {
      return deniedForWindow(windowStart, options.windowSeconds, now);
    }

    let claimed = 0;
    const start = availableSlotCount > 1 ? randomInt(availableSlotCount) : 0;
    let step = availableSlotCount > 2 ? randomInt(1, availableSlotCount) : 1;
    while (greatestCommonDivisor(step, availableSlotCount) !== 1) {
      step = step === availableSlotCount - 1 ? 1 : step + 1;
    }
    const maximumAttempts = Math.min(availableSlotCount, Math.max(64, options.cost * 64));
    for (let offset = 0; offset < maximumAttempts && claimed < options.cost; offset += 1) {
      const slot = (start + offset * step) % availableSlotCount;
      const { error } = await database.from("site_updates").insert({
        source_key: `${prefix}slot:${slot.toString(36)}`,
        badge: "LIMIT",
        title: `Rate ${options.scope}`.slice(0, 120),
        body: "used",
        color: "yellow",
        published: false,
      });
      if (!error) {
        claimed += 1;
        continue;
      }
      if (error.code === "23505") continue;
      throw error;
    }

    if (claimed < options.cost) {
      return deniedForWindow(windowStart, options.windowSeconds, now);
    }

    if (Math.random() < 0.02) {
      const cutoff = new Date(now - 48 * 60 * 60 * 1_000).toISOString();
      void database
        .from("site_updates")
        .delete()
        .gte("source_key", `${SECURITY_PREFIX}:`)
        .lt("source_key", `${SECURITY_PREFIX}:\uffff`)
        .lt("created_at", cutoff);
    }
    return {
      allowed: true,
      remaining: Math.max(0, options.limit - consumed - claimed),
      retryAfter,
    };
  } catch (error) {
    console.error("Persistent request limiter unavailable", error);
    if (process.env.NODE_ENV === "production") {
      return deniedForWindow(windowStart, options.windowSeconds, now);
    }
    return fallbackLimit(`${options.scope}:${identityHash}`, options.limit, options.windowSeconds, options.cost);
  }
}

export async function consumeRateLimit(request: Request, options: LimitOptions): Promise<LimitResult> {
  const cost = Math.max(1, Math.min(1_000, Math.ceil(options.cost ?? 1)));
  const limit = Math.max(1, Math.min(10_000, Math.ceil(options.limit)));
  const identity = options.key ?? clientAddress(request);
  const primary = await claimPersistentLimit({
    scope: options.scope,
    identity,
    limit,
    windowSeconds: options.windowSeconds,
    cost,
  });
  if (!primary.allowed) return primary;

  const companion = companionGlobalLimits[options.scope];
  if (!companion || options.key === "global") return primary;
  const globalResult = await claimPersistentLimit({
    scope: `${options.scope}-global`,
    identity: "global",
    limit: companion.limit,
    windowSeconds: companion.windowSeconds,
    cost,
  });
  return globalResult.allowed ? primary : globalResult;
}

export async function consumeSingleUseToken(token: string, lifetimeSeconds = 600) {
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const request = new Request("https://popperscraft.local/security-token");
  return consumeRateLimit(request, {
    scope: "single-use-token",
    key: tokenHash,
    limit: 1,
    windowSeconds: lifetimeSeconds,
  });
}

export function rateLimitResponse(result: LimitResult, message: string) {
  return Response.json(
    { error: message },
    { status: 429, headers: { "Retry-After": String(result.retryAfter), "Cache-Control": "private, no-store" } },
  );
}
