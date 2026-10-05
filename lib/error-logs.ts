import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const ERROR_LOG_PREFIX = "__error_log__:";
export const ERROR_SESSION_COOKIE = "pc_error_session";

export type SiteErrorLog = {
  id: number;
  category: string;
  message: string;
  page: string;
  method: string;
  status_code: number | null;
  source: string;
  stack: string;
  digest: string;
  user_agent: string;
  user_id: string | null;
  created_at: string;
};

export type SiteErrorLogInput = {
  category?: unknown;
  message?: unknown;
  page?: unknown;
  method?: unknown;
  statusCode?: unknown;
  source?: unknown;
  stack?: unknown;
  digest?: unknown;
  userAgent?: unknown;
  userId?: unknown;
  sessionId?: unknown;
};

function clean(value: unknown, maxLength: number) {
  return String(value ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim().slice(0, maxLength);
}

export function validErrorSessionId(value: unknown) {
  const normalized = clean(value, 64);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized)
    ? normalized
    : "";
}

export function errorSessionFromCookieHeader(header: string | string[] | undefined) {
  const raw = Array.isArray(header) ? header.join(";") : header ?? "";
  const pair = raw.split(";").map((item) => item.trim()).find((item) => item.startsWith(`${ERROR_SESSION_COOKIE}=`));
  if (!pair) return "";
  try {
    return validErrorSessionId(decodeURIComponent(pair.slice(ERROR_SESSION_COOKIE.length + 1)));
  } catch {
    return "";
  }
}

function normalizeErrorDetails(input: SiteErrorLogInput) {
  const status = Number(input.statusCode);
  return {
    category: clean(input.category, 32) || "client",
    message: clean(input.message, 220) || "Неизвестная ошибка",
    page: clean(input.page, 140) || "/",
    method: clean(input.method, 12).toUpperCase(),
    statusCode: Number.isInteger(status) && status >= 100 && status <= 599 ? status : null,
    source: clean(input.source, 100),
    stack: clean(input.stack, 300),
    digest: clean(input.digest, 80),
    userAgent: clean(input.userAgent, 100),
    userId: clean(input.userId, 64) || null,
    sessionId: validErrorSessionId(input.sessionId) || null,
  };
}

function serializeDetails(input: SiteErrorLogInput) {
  const details = normalizeErrorDetails(input);
  let serialized = JSON.stringify(details);
  if (serialized.length <= 1200) return { details, serialized };

  const compact = { ...details, stack: details.stack.slice(0, 120), userAgent: details.userAgent.slice(0, 60) };
  serialized = JSON.stringify(compact);
  return { details: compact, serialized };
}

export async function writeSiteErrorLog(input: SiteErrorLogInput) {
  const { details, serialized } = serializeDetails(input);
  const title = `${details.category.toUpperCase()}: ${details.message}`.slice(0, 120);
  const { data, error } = await createSupabaseAdminClient()
    .from("site_updates")
    .insert({
      source_key: `${ERROR_LOG_PREFIX}${crypto.randomUUID()}`,
      badge: "ERROR",
      title: title.length >= 3 ? title : "SITE ERROR",
      body: serialized,
      color: "pink",
      published: false,
    })
    .select("id,created_at")
    .single();

  if (error) throw error;
  return { id: Number(data.id), createdAt: String(data.created_at) };
}

function parseErrorRow(row: { id: number; body: string; created_at: string }): SiteErrorLog | null {
  try {
    const details = JSON.parse(row.body) as Record<string, unknown>;
    const statusCode = details.statusCode === null || details.statusCode === undefined ? Number.NaN : Number(details.statusCode);
    return {
      id: Number(row.id),
      category: clean(details.category, 32) || "client",
      message: clean(details.message, 220) || "Неизвестная ошибка",
      page: clean(details.page, 140) || "/",
      method: clean(details.method, 12),
      status_code: Number.isInteger(statusCode) ? statusCode : null,
      source: clean(details.source, 100),
      stack: clean(details.stack, 300),
      digest: clean(details.digest, 80),
      user_agent: clean(details.userAgent, 100),
      user_id: clean(details.userId, 64) || null,
      created_at: row.created_at,
    };
  } catch {
    return null;
  }
}

export async function listSiteErrorLogs(limit = 400) {
  const { data, error } = await createSupabaseAdminClient()
    .from("site_updates")
    .select("id,body,created_at")
    .like("source_key", `${ERROR_LOG_PREFIX}%`)
    .order("created_at", { ascending: false })
    .limit(Math.min(1000, Math.max(1, limit)));
  if (error) throw error;
  return (data ?? []).flatMap((row) => {
    const parsed = parseErrorRow({ id: Number(row.id), body: String(row.body), created_at: String(row.created_at) });
    return parsed ? [parsed] : [];
  });
}

export async function recentSiteErrorLogIds({
  sessionId,
  userId,
  minutes = 30,
}: {
  sessionId?: string | null;
  userId?: string | null;
  minutes?: number;
}) {
  const validSession = validErrorSessionId(sessionId);
  const validUserId = clean(userId, 64);
  if (!validSession && !validUserId) return [];

  const since = new Date(Date.now() - Math.max(1, minutes) * 60_000).toISOString();
  const { data, error } = await createSupabaseAdminClient()
    .from("site_updates")
    .select("id,body,created_at")
    .like("source_key", `${ERROR_LOG_PREFIX}%`)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(300);
  if (error) throw error;

  return (data ?? []).flatMap((row) => {
    try {
      const details = JSON.parse(String(row.body)) as Record<string, unknown>;
      const sameSession = validSession && validErrorSessionId(details.sessionId) === validSession;
      const sameUser = validUserId && clean(details.userId, 64) === validUserId;
      return sameSession || sameUser ? [Number(row.id)] : [];
    } catch {
      return [];
    }
  }).slice(0, 30);
}
