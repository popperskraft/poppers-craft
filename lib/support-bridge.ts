import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { consumeRateLimit } from "@/lib/request-security";
import { appendSupportTranscript, resolveSupportTranscript, startSupportTranscript } from "@/lib/poppers-learning";

export const SUPPORT_COOKIE_NAME = "poppers_support_session";

/* Обращения из чата на сайте.

   Строка __poppers_support:<id>:<хэш браузера> хранит вопрос и состояние,
   а ответы администраторов лежат отдельными строками
   __poppers_support_reply:<id>:<метка>: поле body ограничено 1200 символами,
   и переписка в одну строку не помещается.

   Состояния:
   - waiting  — обращение открыто. Администраторы отвечают сколько угодно
                раз, ответы видны в чате на сайте, а новые сообщения
                посетителя уходят в то же обращение, а не Попперсу;
   - resolved — администратор отметил вопрос решённым или посетитель сам
                завершил обращение. Текст вопроса и ответов стирается, и
                виджет убирает ответы из чата;
   - answered — старый формат с единственным ответом. Такие обращения
                считаются закрытыми и больше не показываются.

   Копия переписки для обучения Попперса ведётся отдельно
   (lib/poppers-learning.ts) и после решения не стирается. */

const SUPPORT_PREFIX = "__poppers_support:";
const REPLY_PREFIX = "__poppers_support_reply:";
const REPLY_CHARS = 900;
/* Обращение без решения показывается в чате не дольше недели. */
const OPEN_THREAD_MS = 7 * 24 * 60 * 60_000;

type WaitingPayload = {
  state: "waiting";
  /* 2 — обращение новой схемы. Старые открытые вопросы без этой метки не
     показываются и не перехватывают сообщения посетителя. */
  v?: 2;
  question: string;
  notifications?: Record<string, number>;
  ticket?: number;
};

type AnsweredPayload = {
  state: "answered";
  answer: string;
  answeredAt: string;
  notifications?: Record<string, number>;
};

type ResolvedPayload = {
  state: "resolved";
  resolvedAt: string;
  resolvedBy: string;
  ticket?: number;
};

type SupportPayload = WaitingPayload | AnsweredPayload | ResolvedPayload;
type SupportRow = {
  id: number;
  source_key: string;
  body: string;
  created_at: string;
};

export type SupportReply = { id: string; text: string; at: string; by: string };
export type BrowserSupportThread = { id: string; replies: SupportReply[] };

function telegramSupportToken() {
  return process.env.TELEGRAM_SUPPORT_BOT_TOKEN?.trim() ?? "";
}

function telegramAdminChatIds() {
  return (process.env.TELEGRAM_SUPPORT_ADMIN_IDS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => /^-?\d+$/.test(value));
}

/**
 * Sends a short operational notification through the same Telegram bot that
 * handles the website support bridge. Delivery errors never expose the bot
 * token and are returned to the caller as a simple count.
 */
export async function notifySupportAdmins(text: string) {
  const token = telegramSupportToken();
  const chatIds = telegramAdminChatIds();
  const safeText = text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]+/g, " ").trim().slice(0, 4_000);
  if (!token || !chatIds.length || !safeText) return { sent: 0, configured: Boolean(token && chatIds.length) };
  const notificationLimit = await consumeRateLimit(new Request("https://popperscraft.local/support-notification"), {
    scope: "support-notification-global",
    key: "global",
    limit: 60,
    windowSeconds: 60 * 60,
  });
  if (!notificationLimit.allowed) return { sent: 0, configured: true };

  const deliveries = await Promise.allSettled(chatIds.map(async (chatId) => {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: safeText }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error("telegram-admin-notification-failed");
  }));

  return {
    sent: deliveries.filter((delivery) => delivery.status === "fulfilled").length,
    configured: true,
  };
}

export function newSupportBrowserToken() {
  return randomBytes(32).toString("base64url");
}

export function hashSupportBrowserToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function sourceKey(threadId: string, browserTokenHash: string) {
  return `${SUPPORT_PREFIX}${threadId}:${browserTokenHash}`;
}

function threadIdFromSourceKey(value: string) {
  return value.startsWith(SUPPORT_PREFIX) ? value.slice(SUPPORT_PREFIX.length).split(":")[0] : "";
}

/* Номер обращения попадает в шаблон LIKE, поэтому принимается только UUID. */
function isThreadId(value: string) {
  return /^[0-9a-f-]{36}$/.test(value);
}

function parsePayload(body: string): SupportPayload | null {
  try {
    const value = JSON.parse(body) as SupportPayload;
    return value?.state === "waiting" || value?.state === "answered" || value?.state === "resolved" ? value : null;
  } catch {
    return null;
  }
}

async function findRowByThreadId(threadId: string) {
  if (!isThreadId(threadId)) return null;
  const { data, error } = await createSupabaseAdminClient()
    .from("site_updates")
    .select("id,source_key,body,created_at")
    .like("source_key", `${SUPPORT_PREFIX}${threadId}:%`)
    .maybeSingle();
  if (error) throw error;
  return data as SupportRow | null;
}

/* Запись меняется, только если её никто не успел изменить с момента
   чтения — иначе два администратора могли бы затереть действия друг друга. */
async function replacePayload(row: SupportRow, next: SupportPayload) {
  const { data, error } = await createSupabaseAdminClient().from("site_updates")
    .update({ body: JSON.stringify(next), updated_at: new Date().toISOString() })
    .eq("id", row.id)
    .eq("body", row.body)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

export async function createSupportThread(question: string, aiAnswer: string, browserToken: string, pageUrl = "") {
  const threadId = randomUUID();
  const payload: WaitingPayload = { state: "waiting", v: 2, question: question.slice(0, 500) };
  const { data, error } = await createSupabaseAdminClient().from("site_updates").insert({
    source_key: sourceKey(threadId, hashSupportBrowserToken(browserToken)),
    badge: "SUPPORT",
    title: "Вопрос Попперсу",
    body: JSON.stringify(payload),
    color: "cyan",
    published: false,
  }).select("created_at").single();
  if (error || !data) throw error ?? new Error("support-thread-create-failed");
  await startSupportTranscript({ threadId, question, poppersAnswer: aiAnswer, pageUrl });
  return { id: threadId, created_at: data.created_at as string };
}

export async function findSupportThreadByNotification(chatId: number, messageId: number) {
  const { data, error } = await createSupabaseAdminClient()
    .from("site_updates")
    .select("id,source_key,body,created_at")
    .like("source_key", `${SUPPORT_PREFIX}%`)
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) throw error;
  for (const row of (data ?? []) as SupportRow[]) {
    const payload = parsePayload(row.body);
    if (payload && "notifications" in payload && payload.notifications?.[String(chatId)] === messageId) {
      return { id: threadIdFromSourceKey(row.source_key), question: payload.state === "waiting" ? payload.question : "", status: payload.state };
    }
  }
  return null;
}

/* Номера уведомлений в личке владельцев. Уточнения посетителя приходят
   новыми уведомлениями, поэтому номера дописываются, а не заменяются. */
export async function saveSupportNotificationIds(threadId: string, ids: Record<string, number>) {
  const row = await findRowByThreadId(threadId);
  if (!row) throw new Error("support-thread-not-found");
  const payload = parsePayload(row.body);
  if (payload?.state !== "waiting") return;
  await replacePayload(row, { ...payload, notifications: { ...payload.notifications, ...ids } });
}

export async function setSupportThreadTicket(threadId: string, ticket: number) {
  const row = await findRowByThreadId(threadId);
  if (!row) return;
  const payload = parsePayload(row.body);
  if (payload?.state !== "waiting") return;
  await replacePayload(row, { ...payload, ticket });
}

/* Ответ администратора посетителю. Возвращает "closed", если обращение уже
   решено, — тогда ответ на сайт не попадает. */
export async function addSupportReply(threadId: string, text: string, by: string): Promise<"added" | "closed" | "missing"> {
  const row = await findRowByThreadId(threadId);
  if (!row) return "missing";
  const payload = parsePayload(row.body);
  if (payload?.state !== "waiting") return "closed";
  const at = new Date().toISOString();
  const { error } = await createSupabaseAdminClient().from("site_updates").insert({
    source_key: `${REPLY_PREFIX}${threadId}:${Date.now().toString(36)}${randomBytes(3).toString("hex")}`,
    badge: "SUPPORT",
    title: "Ответ администратора",
    body: JSON.stringify({ text: text.slice(0, REPLY_CHARS), at, by: by.slice(0, 40) }),
    color: "cyan",
    published: false,
  });
  if (error) throw error;
  await appendSupportTranscript(threadId, "operator", text, by);
  return "added";
}

/* Уточнение посетителя в открытом обращении — только в журнал обучения:
   в Telegram его отправляет вызывающий код. */
export async function recordVisitorMessage(threadId: string, text: string) {
  if (isThreadId(threadId)) await appendSupportTranscript(threadId, "visitor", text);
}

/* Старое имя для ответа через Reply в личке владельца. */
export async function answerSupportThread(threadId: string, answer: string) {
  return (await addSupportReply(threadId, answer, "Администратор")) === "added";
}

/* Вопрос решён: обращение закрывается, а текст вопроса и ответов стирается.
   Строки остаются (сервер ничего не удаляет), но содержимого в них нет. */
export async function resolveSupportThread(threadId: string, by: string) {
  const row = await findRowByThreadId(threadId);
  if (!row) return null;
  const payload = parsePayload(row.body);
  if (payload?.state !== "waiting") return null;
  const resolvedAt = new Date().toISOString();
  const resolved = await replacePayload(row, { state: "resolved", resolvedAt, resolvedBy: by.slice(0, 40), ticket: payload.ticket });
  if (!resolved) return null;
  await resolveSupportTranscript(threadId, by);
  const { error } = await createSupabaseAdminClient().from("site_updates")
    .update({ body: JSON.stringify({ cleared: true }), updated_at: resolvedAt })
    .like("source_key", `${REPLY_PREFIX}${threadId}:%`);
  if (error) console.error("Support replies were not cleared", error.message);
  return { id: threadId, ticket: payload.ticket ?? null };
}

async function openBrowserRows(browserToken: string) {
  const tokenHash = hashSupportBrowserToken(browserToken);
  const { data, error } = await createSupabaseAdminClient()
    .from("site_updates")
    .select("id,source_key,body,created_at")
    .like("source_key", `${SUPPORT_PREFIX}%:${tokenHash}`)
    .order("created_at", { ascending: true })
    .limit(50);
  if (error) throw error;
  const now = Date.now();
  return ((data ?? []) as SupportRow[]).flatMap((row) => {
    const payload = parsePayload(row.body);
    if (payload?.state !== "waiting" || payload.v !== 2 || now - Date.parse(row.created_at) > OPEN_THREAD_MS) return [];
    return [{ id: threadIdFromSourceKey(row.source_key), payload }];
  });
}

/* Последнее открытое обращение этого браузера: туда уходят уточнения. */
export async function findOpenBrowserThread(browserToken: string) {
  const rows = await openBrowserRows(browserToken);
  const last = rows.at(-1);
  return last ? { id: last.id, ticket: last.payload.ticket ?? null } : null;
}

/* Посетитель сам завершил обращение кнопкой в чате. */
export async function resolveBrowserThread(browserToken: string) {
  const open = await findOpenBrowserThread(browserToken);
  return open ? resolveSupportThread(open.id, "посетитель") : null;
}

/* Открытые обращения браузера с ответами. Решённые сюда не попадают, и по
   их исчезновению виджет понимает, что ответы нужно убрать из чата. */
export async function listBrowserSupportThreads(browserToken: string): Promise<BrowserSupportThread[]> {
  const rows = await openBrowserRows(browserToken);
  const admin = createSupabaseAdminClient();
  return Promise.all(rows.map(async ({ id }) => {
    const { data, error } = await admin
      .from("site_updates")
      .select("source_key,body")
      .like("source_key", `${REPLY_PREFIX}${id}:%`)
      .order("created_at", { ascending: true })
      .limit(50);
    if (error) throw error;
    const replies = (data ?? []).flatMap((row) => {
      try {
        const value = JSON.parse(row.body as string) as Partial<SupportReply>;
        if (typeof value.text !== "string" || !value.text) return [];
        return [{
          id: String(row.source_key).split(":").pop() ?? "",
          text: value.text,
          at: typeof value.at === "string" ? value.at : "",
          by: typeof value.by === "string" ? value.by : "Администратор",
        }];
      } catch {
        return [];
      }
    });
    return { id, replies };
  }));
}
