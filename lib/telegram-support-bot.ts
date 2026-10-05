import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { generatePoppersAnswer, POPPERS_SUPPORT_USERNAME } from "@/lib/poppers-knowledge";
import { poppersPlainText } from "@/lib/poppers-format";
import { poppersOutageReason, reportPoppersOutage } from "@/lib/poppers-outage";
import { consumeRateLimit } from "@/lib/request-security";
import { addSupportReply, resolveSupportThread } from "@/lib/support-bridge";

/* Бот поддержки PoppersCraft в Telegram (@PoppersCraftAuthBot).

   Это тот же бот, через который работает вход на сайт: отдельный токен не
   нужен. Раньше он получал личные сообщения на /api/telegram/business и
   просто их игнорировал.

   ЧТО УМЕЕТ
   - В личке: меню, частые вопросы на кнопках, ответы ИИ с памятью диалога,
     статус анкеты — если Telegram привязан к аккаунту сайта.
   - «Позвать человека» создаёт обращение с номером. Каждое обращение —
     отдельная тема в группе поддержки: всё, что пишет пользователь,
     копируется в тему, а всё, что пишут в теме операторы, уходит ему.
   - Сообщение в теме, начинающееся с «//», — заметка для команды, его
     пользователь не видит.
   - /open и /stats в группе показывают открытые обращения и статистику.
   - Вопрос, который Попперс на сайте не смог решить, тоже становится
     обращением с отдельной темой. Ответы из темы появляются в чате на
     сайте, а закрытие обращения стирает их оттуда.

   ДОСТУП ОПЕРАТОРОВ
   Отвечать может любой участник группы поддержки. Выдать доступ — добавить
   человека в группу, забрать — удалить. Правок на сервере не нужно.
   Привязать группу может только владелец из TELEGRAM_SUPPORT_ADMIN_IDS
   командой /support_here, поэтому посторонний не уведёт поддержку в свою
   группу.

   ХРАНЕНИЕ
   Состояние лежит в site_updates под ключами __tgbot:*. Ключи с двумя
   подчёркиваниями listSiteUpdates отбрасывает, поэтому в публичную ленту
   они не попадают. Миграция базы не нужна. */

const SITE = "https://popperscraft.org";
const MAP_URL = "https://map.popperscraft.org";
const CHANNEL_URL = "https://t.me/popperskraft";
const PREFIX = "__tgbot:";
/* Для значка темы Telegram принимает только шесть фиксированных цветов. */
const TOPIC_COLOR = 7_322_096;

/* ------------------------------------------------------------------------ */
/* Telegram API                                                             */
/* ------------------------------------------------------------------------ */

type TgUser = { id: number; is_bot?: boolean; first_name?: string; last_name?: string; username?: string };
type TgChat = { id: number; type: string; title?: string; is_forum?: boolean };

export type TgMessage = {
  message_id: number;
  message_thread_id?: number;
  is_topic_message?: boolean;
  chat: TgChat;
  from?: TgUser;
  sender_chat?: { id: number };
  text?: string;
  caption?: string;
  reply_to_message?: { message_id: number };
  photo?: unknown;
  document?: unknown;
  video?: unknown;
  voice?: unknown;
  audio?: unknown;
  animation?: unknown;
  sticker?: unknown;
  video_note?: unknown;
  location?: unknown;
  contact?: unknown;
  new_chat_members?: TgUser[];
  migrate_from_chat_id?: number;
};

export type TgCallback = { id: string; from: TgUser; data?: string; message?: TgMessage };

type Button = { text: string; callback_data?: string; url?: string; copy_text?: { text: string } };
type Keyboard = { inline_keyboard: Button[][] };
type Entity = { type: "code"; offset: number; length: number };
type TgOutcome<T> = { ok: true; result: T } | { ok: false; description: string };

function botToken() {
  return process.env.TELEGRAM_SUPPORT_BOT_TOKEN?.trim() ?? "";
}

/* Токен в журнал не попадает: пишется только метод и описание от Telegram. */
async function tgCall<T>(method: string, payload: Record<string, unknown>): Promise<TgOutcome<T>> {
  const token = botToken();
  if (!token) return { ok: false, description: "token-missing" };
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || result?.ok !== true) {
      const description = String(result?.description ?? `http-${response.status}`);
      /* Повторное нажатие той же кнопки даёт «message is not modified» — это не сбой. */
      if (!description.includes("message is not modified")) console.error("Telegram bot call failed", method, description);
      return { ok: false, description };
    }
    return { ok: true, result: result.result as T };
  } catch (error) {
    const description = error instanceof Error ? error.name : "unknown";
    console.error("Telegram bot call failed", method, description);
    return { ok: false, description };
  }
}

/* Ошибка Telegram не прерывает обработку: бот должен ответить хоть чем-то. */
async function tg<T = true>(method: string, payload: Record<string, unknown>): Promise<T | null> {
  const outcome = await tgCall<T>(method, payload);
  return outcome.ok ? outcome.result : null;
}

function splitText(value: string, maximum = 3_900) {
  const chunks: string[] = [];
  let rest = value.trim();
  while (rest.length > maximum) {
    const window = rest.slice(0, maximum + 1);
    const cut = Math.max(window.lastIndexOf("\n\n"), window.lastIndexOf("\n"), window.lastIndexOf(" "));
    const safeCut = cut > maximum * 0.55 ? cut : maximum;
    chunks.push(rest.slice(0, safeCut).trim());
    rest = rest.slice(safeCut).trim();
  }
  if (rest) chunks.push(rest);
  return chunks.length ? chunks : ["…"];
}

type SendOptions = { keyboard?: Keyboard; threadId?: number; entities?: Entity[] };

/* Длинный текст уходит несколькими сообщениями; кнопки — под последним. */
async function send(chatId: number, text: string, options: SendOptions = {}) {
  const chunks = splitText(text);
  let last: { message_id: number } | null = null;
  for (let index = 0; index < chunks.length; index += 1) {
    last = await tg<{ message_id: number }>("sendMessage", {
      chat_id: chatId,
      text: chunks[index],
      message_thread_id: options.threadId,
      reply_markup: index === chunks.length - 1 ? options.keyboard : undefined,
      entities: chunks.length === 1 ? options.entities : undefined,
      link_preview_options: { is_disabled: true },
    });
    if (!last) return null;
  }
  return last;
}

function edit(chatId: number, messageId: number, text: string, keyboard?: Keyboard) {
  return tg("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text: text.slice(0, 4_000),
    reply_markup: keyboard,
    link_preview_options: { is_disabled: true },
  });
}

/* ------------------------------------------------------------------------ */
/* Мелкие помощники                                                         */
/* ------------------------------------------------------------------------ */

function ownerIds() {
  return (process.env.TELEGRAM_SUPPORT_ADMIN_IDS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => /^-?\d+$/.test(value));
}

function clean(value: unknown, maximum: number) {
  return String(value ?? "").replace(/\p{Cc}+/gu, " ").replace(/\s+/g, " ").trim().slice(0, maximum);
}

function displayName(user: TgUser) {
  return clean([user.first_name, user.last_name].filter(Boolean).join(" "), 64) || "Пользователь";
}

function commandOf(text: string) {
  const first = text.trim().split(/\s+/)[0] ?? "";
  return first.startsWith("/") ? first.toLowerCase().replace(/@\w+$/, "") : "";
}

/* Служебные сообщения (тему закрыли, кого-то добавили) пересылать нельзя. */
function hasContent(message: TgMessage) {
  return Boolean(
    message.text || message.caption || message.photo || message.document || message.video || message.voice
    || message.audio || message.animation || message.sticker || message.video_note || message.location || message.contact,
  );
}

function ago(iso: string) {
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  if (!Number.isFinite(minutes)) return "";
  if (minutes < 60) return `${minutes} мин назад`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} ч назад`;
  return `${Math.round(hours / 24)} дн назад`;
}

function limiterRequest() {
  return new Request("https://popperscraft.local/telegram-bot");
}

/* Защита от флуда кнопками и сообщениями. Хранится в памяти процесса:
   сайт работает одним процессом, а после перезапуска счёт начинается
   заново — для такой защиты это приемлемо. */
const recentEvents = new Map<number, number[]>();

function flooding(userId: number) {
  const now = Date.now();
  const times = (recentEvents.get(userId) ?? []).filter((time) => now - time < 60_000);
  times.push(now);
  if (recentEvents.size > 10_000) recentEvents.clear();
  recentEvents.set(userId, times);
  return times.length > 40;
}

/* ------------------------------------------------------------------------ */
/* Хранилище                                                                */
/* ------------------------------------------------------------------------ */

async function readState<T>(key: string): Promise<T | null> {
  const { data, error } = await createSupabaseAdminClient()
    .from("site_updates")
    .select("body")
    .eq("source_key", `${PREFIX}${key}`)
    .maybeSingle();
  if (error || !data) return null;
  try {
    return JSON.parse(data.body as string) as T;
  } catch {
    return null;
  }
}

async function writeState(key: string, badge: string, title: string, value: unknown) {
  const { error } = await createSupabaseAdminClient()
    .from("site_updates")
    .upsert({
      source_key: `${PREFIX}${key}`,
      badge,
      title: title.slice(0, 120),
      body: JSON.stringify(value),
      color: "cyan",
      /* Служебная запись: в публичной ленте её быть не должно. */
      published: false,
      updated_at: new Date().toISOString(),
    }, { onConflict: "source_key" });
  if (error) throw error;
}

/* Сессия: режим диалога, открытое обращение и короткая память для ИИ.
   Поле body ограничено 1200 символами, поэтому память урезана: последние
   восемь реплик, каждая не длиннее 110 символов. */
type Turn = ["u" | "b", string];
type Session = { mode: "ai" | "human"; ticket: number | null; history: Turn[] };

const MAX_TURNS = 8;
const TURN_CHARS = 110;

function isTurn(value: unknown): value is Turn {
  return Array.isArray(value) && (value[0] === "u" || value[0] === "b") && typeof value[1] === "string";
}

async function loadSession(userId: number): Promise<Session> {
  const stored = await readState<Partial<Session>>(`user:${userId}`);
  return {
    mode: stored?.mode === "human" ? "human" : "ai",
    ticket: typeof stored?.ticket === "number" ? stored.ticket : null,
    history: Array.isArray(stored?.history) ? stored.history.filter(isTurn).slice(-MAX_TURNS) : [],
  };
}

async function saveSession(userId: number, session: Session) {
  const fitted: Session = {
    ...session,
    history: session.history.slice(-MAX_TURNS).map(([role, text]) => [role, text.slice(0, TURN_CHARS)] as Turn),
  };
  while (JSON.stringify(fitted).length > 1_150 && fitted.history.length) fitted.history.shift();
  await writeState(`user:${userId}`, "TGBOT", `Сессия бота ${userId}`, fitted);
}

type GroupState = { chatId: number; title: string; boundBy: number; boundAt: string };

/* Группа нужна почти на каждое сообщение из неё, поэтому кэшируется на минуту. */
let groupCache: { value: GroupState | null; at: number } | null = null;

async function loadGroup() {
  if (groupCache && Date.now() - groupCache.at < 60_000) return groupCache.value;
  const stored = await readState<GroupState>("group");
  groupCache = { value: typeof stored?.chatId === "number" ? stored : null, at: Date.now() };
  return groupCache.value;
}

type Ticket = {
  n: number;
  userId: number;
  name: string;
  username: string;
  chatId: number | null;
  topicId: number | null;
  status: "open" | "closed";
  openedAt: string;
  closedAt?: string;
  closedBy?: string;
  rating?: "up" | "down";
  /* Обращение из чата на сайте: у него нет Telegram-пользователя (userId 0),
     ответы уходят в обращение сайта siteThreadId. */
  source?: "site";
  siteThreadId?: string;
};

async function loadTicket(n: number) {
  if (!Number.isSafeInteger(n) || n < 1) return null;
  const ticket = await readState<Ticket>(`ticket:${n}`);
  return ticket && typeof ticket.userId === "number" ? ticket : null;
}

async function saveTicket(ticket: Ticket) {
  await writeState(`ticket:${ticket.n}`, "TICKET", `Обращение #${ticket.n}`, ticket);
}

async function listTickets(): Promise<Ticket[]> {
  const { data, error } = await createSupabaseAdminClient()
    .from("site_updates")
    .select("body")
    .like("source_key", `${PREFIX}ticket:%`)
    .order("created_at", { ascending: false })
    .limit(1_000);
  if (error) throw error;
  return (data ?? []).flatMap((row) => {
    try {
      const ticket = JSON.parse(row.body as string) as Ticket;
      return typeof ticket.userId === "number" ? [ticket] : [];
    } catch {
      return [];
    }
  });
}

/* Номер обращения — следующий за последним. Если два обращения создаются
   одновременно, вторая вставка упадёт на уникальности source_key, и цикл
   возьмёт следующий номер. */
async function reserveTicketNumber(): Promise<number> {
  const admin = createSupabaseAdminClient();
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const { data, error } = await admin
      .from("site_updates")
      .select("source_key")
      .like("source_key", `${PREFIX}ticket:%`)
      .order("created_at", { ascending: false })
      .limit(1);
    if (error) throw error;
    const last = Number(String(data?.[0]?.source_key ?? "").split(":").pop());
    const next = (Number.isSafeInteger(last) ? last : 0) + 1 + attempt;
    const { error: insertError } = await admin.from("site_updates").insert({
      source_key: `${PREFIX}ticket:${next}`,
      badge: "TICKET",
      title: `Обращение #${next}`,
      body: JSON.stringify({ n: next, reserved: true }),
      color: "cyan",
      published: false,
    });
    if (!insertError) return next;
    if (insertError.code !== "23505") throw insertError;
  }
  throw new Error("ticket-number-unavailable");
}

/* Связь сообщения в группе с обращением — для ответов через Reply, когда
   темы недоступны. */
async function linkGroupMessage(chatId: number, messageId: number, n: number) {
  await writeState(`msg:${chatId}:${messageId}`, "TGMSG", `Сообщение обращения #${n}`, { n });
}

/* ------------------------------------------------------------------------ */
/* Аккаунт сайта                                                            */
/* ------------------------------------------------------------------------ */

/* При привязке Telegram в профиле сайт сохраняет telegram_id в app_metadata
   аккаунта. По нему бот узнаёт человека без отдельной привязки. */
type SiteAccount = {
  login: string;
  admin: boolean;
  status: "pending" | "approved" | "rejected" | null;
  banned: boolean;
  deleted: boolean;
  approvals: number;
  rejections: number;
};

async function lookupSiteAccount(telegramId: number): Promise<SiteAccount | null> {
  const admin = createSupabaseAdminClient();
  const id = String(telegramId);
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1_000 });
  if (error) throw error;
  const user = data.users.find((candidate) => {
    const metadata = candidate.app_metadata ?? {};
    return metadata.telegram_id === id || metadata.telegram_sub === id;
  });
  if (!user) return null;

  const [{ data: applications }, { data: adminProfile }] = await Promise.all([
    admin
      .from("waitlist_applications")
      .select("id,login,status,is_banned,is_deleted")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1),
    user.email
      ? admin.from("admin_profiles").select("id").eq("email", user.email.toLowerCase()).eq("active", true).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const application = applications?.[0];

  let approvals = 0;
  let rejections = 0;
  if (application?.id) {
    const { data: votes } = await admin.from("application_votes").select("vote").eq("application_id", application.id);
    approvals = (votes ?? []).filter((vote) => vote.vote === "approve").length;
    rejections = (votes ?? []).filter((vote) => vote.vote === "reject").length;
  }

  return {
    login: clean(application?.login, 40),
    admin: Boolean(adminProfile),
    status: (application?.status as SiteAccount["status"]) ?? null,
    banned: Boolean(application?.is_banned),
    deleted: Boolean(application?.is_deleted),
    approvals,
    rejections,
  };
}

/* Меню показывает кнопку «Моя анкета» только привязанным, поэтому поиск
   нужен часто. Он перебирает всех пользователей — кэшируем на пять минут.
   Статус анкеты всегда читается заново. Сбой поиска не кэшируется. */
const accountCache = new Map<number, { value: SiteAccount | null; at: number }>();

async function findSiteAccount(telegramId: number, fresh = false) {
  const cached = accountCache.get(telegramId);
  if (!fresh && cached && Date.now() - cached.at < 5 * 60_000) return cached.value;
  try {
    const value = await lookupSiteAccount(telegramId);
    if (accountCache.size > 5_000) accountCache.clear();
    accountCache.set(telegramId, { value, at: Date.now() });
    return value;
  } catch (error) {
    console.error("Telegram bot account lookup failed", error instanceof Error ? error.message : "unknown");
    return cached?.value ?? null;
  }
}

function accountLabel(account: SiteAccount) {
  if (account.admin) return "администратор";
  if (account.deleted) return "аккаунт удалён";
  if (account.banned) return "заблокирован";
  if (account.status === "approved") return "анкета одобрена";
  if (account.status === "rejected") return "анкета отклонена";
  if (account.status === "pending") return "анкета на рассмотрении";
  return "без анкеты";
}

function describeAccount(account: SiteAccount) {
  if (account.admin) return "Вы администратор PoppersCraft.";
  if (account.deleted) return "Аккаунт удалён. Если это ошибка — позовите человека.";
  if (account.banned) return "Аккаунт заблокирован. Обжаловать решение можно в течение шести месяцев — позовите человека.";
  if (account.status === "approved") return `✅ Анкета одобрена. Скачайте лаунчер PoppersCraft — он сам подключит к серверу: ${SITE}/launcher`;
  if (account.status === "rejected") return "❌ Анкета отклонена. Если хотите узнать причину — позовите человека.";
  if (account.status === "pending") {
    return `⏳ Анкета на рассмотрении.\n\nГолосов администраторов «за»: ${account.approvals}, «против»: ${account.rejections}.\nДва голоса «за» — одобрение, два «против» — отказ.`;
  }
  return "Анкета не найдена. Подать её можно на главной сайта в разделе «Лист ожидания».";
}

const LINK_HELP = `Telegram пока не привязан к аккаунту сайта.

Чтобы привязать: войдите на сайт по логину и паролю, откройте «Профиль → Вход через Telegram» и нажмите «Привязать Telegram».

После этого здесь будет виден статус анкеты, а на сайт можно будет входить через Telegram.`;

/* ------------------------------------------------------------------------ */
/* Частые вопросы                                                           */
/* ------------------------------------------------------------------------ */

/* Ответы сверены со справочником интерфейса (lib/poppers-site-guide.ts) и
   правилами (lib/poppers-knowledge.ts) — теми же, по которым отвечает
   Попперс на сайте, чтобы бот и сайт не противоречили друг другу. */
type FaqItem = { q: string; a: string };
type FaqCategory = { id: string; title: string; items: FaqItem[] };

const FAQ: FaqCategory[] = [
  {
    id: "join",
    title: "🎮 Как попасть на сервер",
    items: [
      { q: "С чего начать?", a: `1. Подайте анкету на главной сайта в разделе «Лист ожидания».\n2. Анкету читают и оценивают игроки, решение принимает администрация — придёт письмо.\n3. Оплатите вход (пропуск), если он нужен.\n4. Скачайте лаунчер: ${SITE}/launcher — и заходите под ником из анкеты.` },
      { q: "Как зайти на сервер?", a: `Только через лаунчер PoppersCraft: ${SITE}/launcher. Он ставит игру с модами и сам подключается к серверу — своим клиентом по IP зайти нельзя.\n\nНик в игре совпадает с логином из анкеты.` },
      { q: "Сколько ждать решения?", a: "Точного срока нет: анкету рассматривают администраторы, нужно два голоса «за». Если Telegram привязан к аккаунту сайта, текущий статус видно по кнопке «📝 Моя анкета» в меню." },
      { q: "Какие моды нужны?", a: "В списке модов на сайте сейчас указан Simple Voice Chat. Полный список открывается кнопкой «Список модов» на первом экране главной." },
    ],
  },
  {
    id: "app",
    title: "📝 Анкета",
    items: [
      { q: "Как подать анкету?", a: "На главной сайта откройте «Лист ожидания», заполните форму, примите правила и нажмите «Отправить анкету». Если перейти на другую страницу, черновик сохранится." },
      { q: "Каким должен быть логин?", a: "3–24 символа: латинские буквы, цифры, точка, тире или подчёркивание. Логин — это и игровой ник, поэтому он должен совпадать с ником в Minecraft." },
      { q: "Какой нужен пароль?", a: "8–128 символов. Сохраните его: он понадобится для входа после одобрения. Администраторы исходный пароль не видят." },
      { q: "Как принимают решение?", a: "Два голоса администраторов «за» — анкета одобрена, два «против» — отклонена. Голоса действующих игроков носят рекомендательный характер." },
    ],
  },
  {
    id: "launch",
    title: "⬇️ Лаунчер",
    items: [
      { q: "Где скачать лаунчер?", a: `${SITE}/launcher — выберите macOS, Windows или Linux. Там же требования к компьютеру и контрольная сумма файла.` },
      { q: "macOS не даёт запустить", a: "Откройте DMG, перетащите приложение в «Программы» и запустите. Если система блокирует: «Системные настройки» → «Конфиденциальность и безопасность» → «Открыть всё равно»." },
      { q: "Кнопка пишет «Файл готовится»", a: "Сборка для этой системы ещё не опубликована. Загляните позже или позовите человека." },
    ],
  },
  {
    id: "login",
    title: "🔑 Вход и пароль",
    items: [
      { q: "Как войти на сайт?", a: "Зелёная кнопка «Вход» → игровой логин и пароль → пиксельная капча. Если анкета ещё на рассмотрении, отклонена или аккаунт заблокирован, окно входа покажет точный статус." },
      { q: "Как сменить пароль?", a: "«Профиль» → «Смена пароля»: текущий пароль и новый два раза, минимум 8 символов. Если текущий пароль забыт — позовите человека." },
      { q: "Нет доступа к коду 2FA", a: "На экране ввода кода нажмите «Нет доступа к коду?». Если код просто не подходит — проверьте, что время на телефоне выставляется автоматически, и введите свежий код." },
      { q: "Как привязать Telegram?", a: "Войдите по логину и паролю, откройте «Профиль → Вход через Telegram» и нажмите «Привязать Telegram». После этого можно входить через Telegram, а здесь будет виден статус анкеты." },
    ],
  },
  {
    id: "rules",
    title: "📜 Правила",
    items: [
      { q: "Где прочитать правила?", a: `${SITE}/rules — там же пользовательское соглашение.` },
      { q: "Что запрещено?", a: `Коротко: читы, дюпы, грифинг, кража ресурсов и обход бана; травля, угрозы, оскорбления и разжигание ненависти; нацистская символика; публикация чужих персональных данных; спам, мошенничество и продажа аккаунтов; взлом и атаки на сайт или сервер; политическая агитация.\n\nПолный текст: ${SITE}/rules` },
      { q: "Что будет за нарушение?", a: "Материал могут скрыть, а аккаунт — ограничить или заблокировать. Решение обосновывается, обжаловать его можно в течение шести месяцев; жалобу рассматривает человек." },
    ],
  },
  {
    id: "donate",
    title: "💎 Донат",
    items: [
      { q: "Даёт ли донат преимущества?", a: "Нет. Донат — добровольное пожертвование на хостинг, домен и резервные копии мира. Игровых привилегий и попперсов за него нет." },
      { q: "Как поддержать сервер?", a: `Донат ещё не запущен. Войдите на сайт, откройте ${SITE}/donation и оставьте почту — администраторы напишут, когда он откроется.` },
    ],
  },
  {
    id: "world",
    title: "🗺 Мир и экономика",
    items: [
      { q: "Где посмотреть карту?", a: `${MAP_URL} — живая карта мира, её можно двигать и приближать.` },
      { q: "Что такое попперсы?", a: "Внутриигровая валюта для покупки земли и торговли. 1 алмаз = 100 попперсов." },
      { q: "Как получить участок?", a: "Выберите место и купите его за попперсы. После покупки на участке можно строить." },
      { q: "Есть ли транспорт?", a: "Готовой сети нет: дороги, станции и ветки метро строят сами игроки." },
    ],
  },
];

/* ------------------------------------------------------------------------ */
/* Тексты и клавиатуры                                                      */
/* ------------------------------------------------------------------------ */

const HELP_TEXT = `Команды:
/start — меню
/faq — частые вопросы
/status — статус анкеты
/ip — как зайти на сервер
/human — позвать человека

Или просто напишите вопрос — отвечу сам, а если не справлюсь, позову команду.`;

const TEAM_HELP = `Как отвечать:
• В теме обращения пишите как обычно — сообщение уйдёт пользователю от вашего имени.
• Начните сообщение с // — это заметка для команды, пользователь её не увидит.
• /close или кнопка «Закрыть обращение» — закрыть; пользователь оценит ответ.
• Вопросы из чата на сайте приходят в общий чат группы — ответьте на них через Reply.
• /open — открытые обращения, /stats — статистика.`;

/* Подписи в две колонки должны умещаться примерно в 12 символов: на
   телефоне длиннее обрезаются многоточием. «Моя анкета» одна для всех —
   непривязанному она объясняет, как привязать Telegram. */
function mainMenu(): Keyboard {
  return {
    inline_keyboard: [
      [{ text: "❓ Частые вопросы", callback_data: "f" }],
      [{ text: "⬇️ Лаунчер", url: `${SITE}/launcher` }, { text: "🗺 Карта", url: MAP_URL }],
      [{ text: "📝 Моя анкета", callback_data: "st" }, { text: "🌐 Сайт", url: SITE }],
      [{ text: "📣 Канал", url: CHANNEL_URL }],
      [{ text: "👤 Позвать человека", callback_data: "h" }],
    ],
  };
}

function faqRoot(): Keyboard {
  return {
    inline_keyboard: [
      ...FAQ.map((category) => [{ text: category.title, callback_data: `f:${category.id}` }]),
      [{ text: "🏠 Меню", callback_data: "m" }],
    ],
  };
}

function faqCategory(category: FaqCategory): Keyboard {
  return {
    inline_keyboard: [
      ...category.items.map((item, index) => [{ text: item.q, callback_data: `q:${category.id}:${index}` }]),
      [{ text: "← Все разделы", callback_data: "f" }, { text: "🏠 Меню", callback_data: "m" }],
    ],
  };
}

function faqAnswer(category: FaqCategory): Keyboard {
  return {
    inline_keyboard: [
      [{ text: `← ${category.title}`, callback_data: `f:${category.id}` }],
      [{ text: "👤 Не помогло — позвать человека", callback_data: "h" }],
      [{ text: "🏠 Меню", callback_data: "m" }],
    ],
  };
}

function closeKeyboard(n: number): Keyboard {
  return { inline_keyboard: [[{ text: "✅ Закрыть обращение", callback_data: `x:${n}` }]] };
}

function welcomeText(user: TgUser, account: SiteAccount | null, session: Session) {
  const name = account?.login || clean(user.first_name, 40) || "игрок";
  const lines = [
    `Привет, ${name}! Я Попперс — помощник сервера PoppersCraft.`,
    "",
    "Напишите вопрос обычным сообщением или выберите раздел ниже. Если не справлюсь — позову человека из команды.",
  ];
  if (session.mode === "human" && session.ticket) {
    lines.push("", `Сейчас открыто обращение №${session.ticket}: ваши сообщения получает команда.`);
  }
  return lines.join("\n");
}

async function showMenu(chatId: number, user: TgUser, editMessageId?: number) {
  const [account, session] = await Promise.all([findSiteAccount(user.id), loadSession(user.id)]);
  const text = welcomeText(user, account, session);
  const keyboard = mainMenu();
  if (editMessageId && (await edit(chatId, editMessageId, text, keyboard))) return;
  await send(chatId, text, { keyboard });
}

async function sendStatus(chatId: number, userId: number) {
  const account = await findSiteAccount(userId, true);
  if (!account) {
    await send(chatId, LINK_HELP, { keyboard: { inline_keyboard: [[{ text: "🌐 Открыть сайт", url: SITE }]] } });
    return;
  }
  await send(chatId, `Аккаунт: ${account.login || "без логина"}\n\n${describeAccount(account)}`);
}

/* /ip остался для привычки: адреса для своего клиента нет — заходят через лаунчер. */
async function sendIp(chatId: number) {
  await send(chatId, "Зайти на сервер можно только через лаунчер PoppersCraft: он ставит игру с модами и сам подключается. Ник в игре — логин из анкеты.", {
    keyboard: { inline_keyboard: [[{ text: "⬇️ Скачать лаунчер", url: `${SITE}/launcher` }]] },
  });
}

/* ------------------------------------------------------------------------ */
/* Обращения                                                                */
/* ------------------------------------------------------------------------ */

async function createTopic(chatId: number, ticket: Pick<Ticket, "n" | "name">) {
  const topic = await tg<{ message_thread_id: number }>("createForumTopic", {
    chat_id: chatId,
    name: `#${ticket.n} · ${ticket.name}`.slice(0, 128),
    icon_color: TOPIC_COLOR,
  });
  return topic?.message_thread_id ?? null;
}

function ticketHeader(ticket: Ticket, account: SiteAccount | null, history: Turn[]) {
  const recent = history.slice(-6).map(([role, text]) => `${role === "u" ? "👤" : "🤖"} ${text}`).join("\n");
  return [
    `Обращение #${ticket.n}`,
    `От: ${ticket.name}${ticket.username ? ` (@${ticket.username})` : ""}`,
    `Аккаунт сайта: ${account ? `${account.login || "без логина"} · ${accountLabel(account)}` : "не привязан"}`,
    "",
    recent ? `Последние сообщения с ботом:\n${recent}` : "Пользователь сразу позвал человека.",
    "",
    TEAM_HELP,
  ].join("\n");
}

/* Группа поддержки ещё не подключена (или отключена). Владелец сразу видит,
   что сделать, остальные — куда написать, чтобы не упереться в тупик. */
async function supportUnavailable(chatId: number, user: TgUser) {
  if (ownerIds().includes(String(user.id))) {
    await send(chatId, `Группа поддержки ещё не подключена, поэтому обращения некуда отправить.

Как подключить:
1. Создайте группу в Telegram и включите в её настройках «Темы».
2. Добавьте этого бота администратором с правом «Управление темами».
3. Отправьте в группе /support_here со своего аккаунта.

После этого кнопка «Позвать человека» заработает у всех. Операторов добавляйте в эту группу.`);
    return;
  }
  await send(chatId, "Связь с командой через бота пока не подключена. Напишите в аккаунт поддержки — там ответит человек.", {
    keyboard: { inline_keyboard: [[{ text: "✉️ Написать в поддержку", url: `https://t.me/${POPPERS_SUPPORT_USERNAME.replace(/^@/, "")}` }]] },
  });
}

/* Двойное нажатие «Да, позвать» не должно создать два обращения. */
const openingTickets = new Set<number>();

async function openTicket(chatId: number, user: TgUser) {
  if (openingTickets.has(user.id)) return;
  openingTickets.add(user.id);
  try {
    const session = await loadSession(user.id);
    if (session.mode === "human" && session.ticket) {
      const existing = await loadTicket(session.ticket);
      if (existing?.status === "open") {
        await send(chatId, `Обращение №${existing.n} уже открыто. Пишите сюда — команда ответит в этом чате.`);
        return;
      }
    }

    const group = await loadGroup();
    if (!group) {
      await supportUnavailable(chatId, user);
      return;
    }

    const limit = await consumeRateLimit(limiterRequest(), {
      scope: "tgbot-ticket",
      key: String(user.id),
      limit: 3,
      windowSeconds: 60 * 60,
    });
    if (!limit.allowed) {
      await send(chatId, `Слишком много обращений за час. Если срочно — напишите ${POPPERS_SUPPORT_USERNAME}.`);
      return;
    }

    const n = await reserveTicketNumber();
    const account = await findSiteAccount(user.id, true);
    const ticket: Ticket = {
      n,
      userId: user.id,
      name: displayName(user),
      username: clean(user.username, 32),
      chatId: group.chatId,
      topicId: null,
      status: "open",
      openedAt: new Date().toISOString(),
    };
    ticket.topicId = await createTopic(group.chatId, ticket);
    await saveTicket(ticket);

    const header = ticketHeader(ticket, account, session.history);
    let posted;
    if (ticket.topicId) {
      await writeState(`topic:${group.chatId}:${ticket.topicId}`, "TGTOPIC", `Тема обращения #${n}`, { n });
      posted = await send(group.chatId, header, { threadId: ticket.topicId, keyboard: closeKeyboard(n) });
    } else {
      /* Тему создать не удалось — например, у бота забрали право управлять
         темами. Обращение не теряется: заголовок уходит в общий чат, и на
         него отвечают через Reply. */
      posted = await send(group.chatId, `${header}\n\n⚠️ Тему создать не удалось — проверьте, что у бота есть право «Управление темами». Пока отвечайте через Reply на сообщения этого обращения.`, { keyboard: closeKeyboard(n) });
      if (posted) await linkGroupMessage(group.chatId, posted.message_id, n);
    }

    if (!posted) {
      /* Группа недоступна: бота удалили или лишили прав. */
      await saveTicket({ ...ticket, status: "closed", closedAt: new Date().toISOString(), closedBy: "система" });
      await send(chatId, `Не получилось передать обращение команде. Напишите напрямую: ${POPPERS_SUPPORT_USERNAME}`);
      return;
    }

    await saveSession(user.id, { ...session, mode: "human", ticket: n });
    await send(chatId, `Обращение №${n} передано команде. Опишите вопрос подробнее — всё, что вы напишете сюда, увидят в поддержке. Ответ придёт в этот чат.\n\nПока обращение открыто, я сам не отвечаю.`, {
      keyboard: { inline_keyboard: [[{ text: "Отменить обращение", callback_data: `c:${n}` }]] },
    });
  } finally {
    openingTickets.delete(user.id);
  }
}

/* Тема обращения в текущей группе. Если группу сменили или тему удалили
   вручную, создаётся новая. */
async function ensureTopic(ticket: Ticket, group: GroupState, force = false): Promise<Ticket> {
  if (!force && ticket.chatId === group.chatId && ticket.topicId) return ticket;
  const topicId = await createTopic(group.chatId, ticket);
  if (!topicId) return { ...ticket, chatId: group.chatId, topicId: null };
  const next: Ticket = { ...ticket, chatId: group.chatId, topicId };
  await saveTicket(next);
  await writeState(`topic:${group.chatId}:${topicId}`, "TGTOPIC", `Тема обращения #${ticket.n}`, { n: ticket.n });
  await send(group.chatId, `Обращение #${ticket.n} · ${ticket.name}${ticket.username ? ` (@${ticket.username})` : ""}\nПрежняя тема недоступна, переписка продолжается здесь.`, {
    threadId: topicId,
    keyboard: closeKeyboard(ticket.n),
  });
  return next;
}

async function copyToGroup(ticket: Ticket, fromChatId: number, messageId: number) {
  const group = await loadGroup();
  if (!group) return false;
  const copy = (threadId?: number) => tgCall<{ message_id: number }>("copyMessage", {
    chat_id: group.chatId,
    from_chat_id: fromChatId,
    message_id: messageId,
    message_thread_id: threadId,
  });

  let current = await ensureTopic(ticket, group);
  if (current.topicId) {
    const first = await copy(current.topicId);
    if (first.ok) return true;
    if (/TOPIC_CLOSED/i.test(first.description)) {
      /* Тему закрыли вручную, а обращение ещё открыто — открываем обратно. */
      await tg("reopenForumTopic", { chat_id: group.chatId, message_thread_id: current.topicId });
      if ((await copy(current.topicId)).ok) return true;
    } else if (/thread|topic/i.test(first.description)) {
      /* Тему удалили — создаём новую и пробуем ещё раз. */
      current = await ensureTopic(current, group, true);
      if (current.topicId && (await copy(current.topicId)).ok) return true;
    }
  }

  /* Тем нет совсем: подпись и копия уходят в общий чат, на них отвечают Reply. */
  const label = await send(group.chatId, `Обращение #${ticket.n} · ${ticket.name} пишет:`);
  const copied = await copy();
  if (!copied.ok) return false;
  await Promise.all([
    label ? linkGroupMessage(group.chatId, label.message_id, ticket.n) : null,
    linkGroupMessage(group.chatId, copied.result.message_id, ticket.n),
  ]);
  return true;
}

async function closeTicket(n: number, closedBy: string, by: "operator" | "user") {
  const ticket = await loadTicket(n);
  if (!ticket || ticket.status !== "open") return false;
  const closed: Ticket = { ...ticket, status: "closed", closedAt: new Date().toISOString(), closedBy: clean(closedBy, 64) };
  await saveTicket(closed);
  const fromSite = ticket.source === "site";

  if (fromSite) {
    /* Вопрос решён — ответы исчезают из чата на сайте. Если обращение
       завершил сам посетитель, обращение сайта уже закрыто. */
    if (by === "operator" && ticket.siteThreadId) await resolveSupportThread(ticket.siteThreadId, closed.closedBy ?? "администратор");
  } else {
    const session = await loadSession(ticket.userId);
    if (session.ticket === n) await saveSession(ticket.userId, { ...session, mode: "ai", ticket: null });
  }

  const cancelledText = fromSite ? "Посетитель сайта завершил обращение." : "Пользователь отменил обращение.";
  const closedText = fromSite ? `Вопрос решён (${closed.closedBy}). Ответы убраны из чата на сайте.` : `Обращение закрыто (${closed.closedBy}).`;
  const group = await loadGroup();
  if (group && ticket.chatId === group.chatId && ticket.topicId) {
    await send(group.chatId, by === "user" ? cancelledText : closedText, { threadId: ticket.topicId });
    await tg("editForumTopic", { chat_id: group.chatId, message_thread_id: ticket.topicId, name: `✅ #${n} · ${ticket.name}`.slice(0, 128) });
    await tg("closeForumTopic", { chat_id: group.chatId, message_thread_id: ticket.topicId });
  } else if (group) {
    await send(group.chatId, `Обращение #${n}: ${by === "user" ? cancelledText : closedText}`);
  }

  if (fromSite) return true;
  if (by === "operator") {
    await send(ticket.userId, `Обращение №${n} закрыто. Вопрос решён?`, {
      keyboard: { inline_keyboard: [[{ text: "👍 Да", callback_data: `r:${n}:u` }, { text: "👎 Нет", callback_data: `r:${n}:d` }]] },
    });
  } else {
    await send(ticket.userId, "Обращение отменено. Я снова на связи — спрашивайте.", { keyboard: mainMenu() });
  }
  return true;
}

/* ------------------------------------------------------------------------ */
/* Личные сообщения                                                         */
/* ------------------------------------------------------------------------ */

export async function handleBotPrivateMessage(message: TgMessage) {
  const user = message.from;
  if (!user || user.is_bot || message.chat.type !== "private") return;
  if (flooding(user.id)) return;
  const chatId = message.chat.id;
  const text = (message.text ?? message.caption ?? "").trim();
  const command = commandOf(message.text ?? "");

  if (command === "/start" || command === "/menu") return showMenu(chatId, user);
  if (command === "/faq") {
    await send(chatId, "Выберите раздел:", { keyboard: faqRoot() });
    return;
  }
  if (command === "/status") return sendStatus(chatId, user.id);
  if (command === "/ip") return sendIp(chatId);
  if (command === "/human") return openTicket(chatId, user);
  if (command === "/help") {
    await send(chatId, HELP_TEXT);
    return;
  }

  let session = await loadSession(user.id);

  /* Обращение открыто: сообщения идут команде, ИИ молчит. */
  if (session.mode === "human" && session.ticket) {
    const ticket = await loadTicket(session.ticket);
    if (ticket?.status === "open") {
      if (!hasContent(message)) {
        await send(chatId, "Такое сообщение передать не получится — опишите словами или пришлите фото.");
        return;
      }
      const limit = await consumeRateLimit(limiterRequest(), {
        scope: "tgbot-relay",
        key: String(user.id),
        limit: 60,
        windowSeconds: 10 * 60,
      });
      if (!limit.allowed) {
        await send(chatId, "Слишком много сообщений подряд — подождите немного.");
        return;
      }
      if (!(await copyToGroup(ticket, chatId, message.message_id))) {
        await send(chatId, `Не получилось передать сообщение команде. Напишите напрямую: ${POPPERS_SUPPORT_USERNAME}`);
      }
      return;
    }
    /* Обращение закрыли, а сессия осталась в режиме человека — возвращаем ИИ. */
    session = { ...session, mode: "ai", ticket: null };
    await saveSession(user.id, session);
  }

  if (command) {
    await send(chatId, "Такой команды нет. Список команд: /help");
    return;
  }
  if (!text) {
    await send(chatId, "Пока я понимаю только текст. Напишите вопрос словами или откройте меню: /start");
    return;
  }

  const limit = await consumeRateLimit(limiterRequest(), {
    scope: "tgbot-ai",
    key: String(user.id),
    limit: 30,
    windowSeconds: 60 * 60,
  });
  if (!limit.allowed) {
    await send(chatId, "Много вопросов подряд — дайте мне немного передохнуть. Пока можно посмотреть частые вопросы: /faq");
    return;
  }

  /* «Печатает…» гаснет через пять секунд, а ИИ может думать дольше. */
  void tg("sendChatAction", { chat_id: chatId, action: "typing" });
  const typing = setInterval(() => void tg("sendChatAction", { chat_id: chatId, action: "typing" }), 4_500);

  /* Память диалога: без неё уточнение вроде «а на маке?» после вопроса про
     лаунчер непонятно. Реплики передаются как справочный контекст. */
  const history = session.history
    .map(([role, value]) => `${role === "u" ? "Пользователь" : "Попперс"}: ${value}`)
    .join("\n");

  try {
    const { answer, needsHuman } = await generatePoppersAnswer(
      clean(text, 1_000),
      [
        `Это личный чат с ботом поддержки PoppersCraft в Telegram. Имя пользователя: ${clean(user.first_name, 60) || "неизвестно"}.`,
        "Пользователь сейчас не на сайте: давай ссылки на страницы полностью, например https://popperscraft.org/launcher.",
        `Предыдущие сообщения этого диалога:\n${history || "нет"}`,
      ].join("\n"),
    );
    clearInterval(typing);
    await saveSession(user.id, {
      ...session,
      history: [...session.history, ["u", clean(text, TURN_CHARS)], ["b", clean(answer, TURN_CHARS)]],
    });

    /* В Telegram нет оформления: заголовки и звёздочки убираем (lib/poppers-format.ts). */
    const plain = poppersPlainText(answer) || answer;
    /* Если ИИ не уверен, человека не зовём сами: иначе каждый непонятый
       вопрос превращался бы в обращение. Решает пользователь. */
    if (needsHuman) {
      await send(chatId, `${plain}\n\nЕсли нужно, позову человека из команды.`, {
        keyboard: { inline_keyboard: [[{ text: "👤 Позвать человека", callback_data: "h!" }], [{ text: "❓ Частые вопросы", callback_data: "f" }]] },
      });
    } else {
      await send(chatId, plain);
    }
  } catch (error) {
    console.error("Telegram bot AI answer failed", error instanceof Error ? error.message : "unknown");
    clearInterval(typing);
    if (!poppersOutageReason(error)) {
      /* Сбой не у ИИ (например, база): человек сам выбирает, что дальше. */
      await send(chatId, "Не получилось ответить. Посмотрите частые вопросы или позовите человека.", {
        keyboard: { inline_keyboard: [[{ text: "❓ Частые вопросы", callback_data: "f" }], [{ text: "👤 Позвать человека", callback_data: "h!" }]] },
      });
      return;
    }
    /* ИИ недоступен (кончились токены, ключ, сбой Google): владельцу —
       сообщение, а человека сразу передаём команде. Вопрос сохраняем в
       истории, чтобы он попал в заголовок обращения. */
    await reportPoppersOutage(error, "Telegram-бот");
    await saveSession(user.id, { ...session, history: [...session.history, ["u", clean(text, TURN_CHARS)]] });
    await send(chatId, "Попперс сейчас не может ответить сам — передаю ваш вопрос команде.");
    await openTicket(chatId, user);
  } finally {
    clearInterval(typing);
  }
}

/* ------------------------------------------------------------------------ */
/* Группа поддержки                                                         */
/* ------------------------------------------------------------------------ */

function operatorName(message: TgMessage, group: GroupState) {
  /* Анонимный администратор пишет от имени самой группы. */
  if (message.sender_chat?.id === group.chatId) return "Поддержка";
  if (!message.from || message.from.is_bot) return null;
  return clean(message.from.first_name, 40) || "Поддержка";
}

async function ticketForGroupMessage(group: GroupState, message: TgMessage) {
  if (message.is_topic_message && message.message_thread_id) {
    const link = await readState<{ n: number }>(`topic:${group.chatId}:${message.message_thread_id}`);
    if (typeof link?.n === "number") return link.n;
  }
  const replyId = message.reply_to_message?.message_id;
  if (replyId) {
    const link = await readState<{ n: number }>(`msg:${group.chatId}:${replyId}`);
    if (typeof link?.n === "number") return link.n;
  }
  return null;
}

function isOwner(userId: number) {
  return ownerIds().includes(String(userId));
}

let cachedBotId: number | null = null;

async function botUserId() {
  if (cachedBotId) return cachedBotId;
  cachedBotId = (await tg<{ id: number }>("getMe", {}))?.id ?? null;
  return cachedBotId;
}

type GroupSetup = { forum: boolean; admin: boolean; topics: boolean; title: string };

/* Состояние группы читается у Telegram заново при каждой проверке: права
   могли поменять минуту назад, а включение тем вообще переносит группу в
   новый чат. */
async function inspectGroupSetup(chatId: number): Promise<GroupSetup> {
  const [chat, id] = await Promise.all([
    tg<{ type: string; title?: string; is_forum?: boolean }>("getChat", { chat_id: chatId }),
    botUserId(),
  ]);
  const member = id
    ? await tg<{ status: string; can_manage_topics?: boolean }>("getChatMember", { chat_id: chatId, user_id: id })
    : null;
  const admin = member?.status === "administrator";
  return {
    forum: chat?.type === "supergroup" && Boolean(chat.is_forum),
    admin,
    topics: admin && Boolean(member?.can_manage_topics),
    title: clean(chat?.title, 100) || "Поддержка",
  };
}

function setupText(setup: GroupSetup) {
  const line = (ok: boolean, label: string, hint: string) => `${ok ? "✅" : "❌"} ${label}${ok ? "" : `\n     ${hint}`}`;
  return [
    "Чтобы эта группа стала группой поддержки PoppersCraft:",
    "",
    line(setup.forum, "Темы включены", "Настройки группы → «Темы»"),
    line(setup.admin, "Бот — администратор", "Настройки группы → «Администраторы» → «Добавить администратора»"),
    line(setup.topics, "Право «Управление темами»", "«Администраторы» → этот бот → «Управление темами»"),
    "",
    "Когда всё будет ✅, владелец нажимает «Подключить группу».",
  ].join("\n");
}

/* Кнопка надёжнее команды: нажатия доходят до бота всегда, даже в режиме
   приватности и от анонимного администратора, а команду /support_here
   Telegram передаёт боту без прав администратора не всегда. */
function setupKeyboard(): Keyboard {
  return { inline_keyboard: [[{ text: "✅ Подключить группу", callback_data: "bind" }]] };
}

async function tryBindGroup(chatId: number, user: TgUser) {
  const setup = await inspectGroupSetup(chatId);
  console.info("Telegram group bind attempt", JSON.stringify({ forum: setup.forum, admin: setup.admin, topics: setup.topics }));
  if (!setup.forum || !setup.admin || !setup.topics) return { bound: false, text: setupText(setup) };
  const state: GroupState = { chatId, title: setup.title, boundBy: user.id, boundAt: new Date().toISOString() };
  await writeState("group", "TGGROUP", "Группа поддержки", state);
  groupCache = { value: state, at: Date.now() };
  return {
    bound: true,
    text: `Готово: «${state.title}» — группа поддержки PoppersCraft.\n\nОбращения из бота появятся здесь отдельными темами, вопросы из чата на сайте — в общем чате.\n\nДоступ оператора — это участие в группе: чтобы человек мог отвечать, добавьте его сюда; чтобы забрать доступ — удалите.\n\n${TEAM_HELP}`,
  };
}

function notOwnerText(userId: number) {
  return `Подключить группу может только владелец. Ваш Telegram ID: ${userId}. Если вы владелец, этот номер нужно добавить в список владельцев на сервере.`;
}

async function bindGroupByCommand(message: TgMessage) {
  const threadId = message.is_topic_message ? message.message_thread_id : undefined;
  /* Анонимный администратор пишет от имени группы — кто это, не видно. */
  if (message.sender_chat?.id === message.chat.id) {
    await send(message.chat.id, "Вы пишете анонимно от имени группы, поэтому я не вижу, владелец ли это. Нажмите кнопку ниже со своего аккаунта.", {
      threadId,
      keyboard: setupKeyboard(),
    });
    return;
  }
  const user = message.from;
  if (!user || !isOwner(user.id)) {
    if (user) await send(message.chat.id, notOwnerText(user.id), { threadId });
    return;
  }
  const result = await tryBindGroup(message.chat.id, user);
  await send(message.chat.id, result.text, { threadId, keyboard: result.bound ? undefined : setupKeyboard() });
}

async function listOpenTickets(group: GroupState, threadId?: number) {
  const open = (await listTickets()).filter((ticket) => ticket.status === "open");
  if (!open.length) {
    await send(group.chatId, "Открытых обращений нет.", { threadId });
    return;
  }
  const internalId = String(group.chatId).replace(/^-100/, "");
  const lines = open.slice(0, 30).map((ticket) => {
    const link = ticket.chatId === group.chatId && ticket.topicId ? `\n   https://t.me/c/${internalId}/${ticket.topicId}` : "";
    return `#${ticket.n} · ${ticket.name}${ticket.username ? ` (@${ticket.username})` : ""} · ${ago(ticket.openedAt)}${link}`;
  });
  await send(group.chatId, `Открытые обращения: ${open.length}\n\n${lines.join("\n")}`, { threadId });
}

async function showStats(group: GroupState, threadId?: number) {
  const tickets = await listTickets();
  const closed = tickets.filter((ticket) => ticket.status === "closed" && ticket.closedBy !== "система");
  const week = tickets.filter((ticket) => Date.now() - Date.parse(ticket.openedAt) < 7 * 24 * 60 * 60_000).length;
  const durations = closed
    .map((ticket) => Date.parse(ticket.closedAt ?? "") - Date.parse(ticket.openedAt))
    .filter((value) => Number.isFinite(value) && value >= 0)
    .sort((left, right) => left - right);
  const median = durations.length ? durations[Math.floor(durations.length / 2)] : null;
  const medianText = median === null ? "—" : median < 60 * 60_000 ? `${Math.round(median / 60_000)} мин` : `${Math.round(median / (60 * 60_000))} ч`;
  const up = tickets.filter((ticket) => ticket.rating === "up").length;
  const down = tickets.filter((ticket) => ticket.rating === "down").length;
  await send(group.chatId, [
    "Обращения",
    `всего: ${tickets.length}, за 7 дней: ${week}`,
    `открыто: ${tickets.filter((ticket) => ticket.status === "open").length}, закрыто: ${closed.length}`,
    `обычно закрываются за: ${medianText}`,
    "",
    `Оценки: 👍 ${up} · 👎 ${down}`,
  ].join("\n"), { threadId });
}

/* Сообщения из групп. Возвращает true, если сообщение обработано ботом. */
export async function handleBotGroupMessage(message: TgMessage): Promise<boolean> {
  const text = (message.text ?? "").trim();
  const command = commandOf(text);
  const group = await loadGroup();
  const bound = Boolean(group && group.chatId === message.chat.id);

  /* Пока группа не подключена, в журнал пишется, что именно дошло до бота.
     Только служебные признаки — текст сообщений не записывается. */
  if (!bound || command) {
    console.info("Telegram group update", JSON.stringify({
      type: message.chat.type,
      forum: Boolean(message.chat.is_forum),
      bound,
      command: command.slice(0, 32),
      joined: Boolean(message.new_chat_members?.length),
      migrated: Boolean(message.migrate_from_chat_id),
      anonymous: message.sender_chat?.id === message.chat.id,
    }));
  }

  if (command === "/support_here") {
    await bindGroupByCommand(message);
    return true;
  }

  /* Бота добавили в группу или группа переехала в супергруппу после
     включения тем — сразу показываем, что осталось сделать. */
  const botId = message.new_chat_members?.length ? await botUserId() : null;
  const botJoined = Boolean(botId && message.new_chat_members?.some((member) => member.id === botId));
  if (!bound && (botJoined || message.migrate_from_chat_id)) {
    const setup = await inspectGroupSetup(message.chat.id);
    await send(message.chat.id, `Привет! Я бот поддержки PoppersCraft.\n\n${setupText(setup)}`, { keyboard: setupKeyboard() });
    return true;
  }

  if (!group || !bound) return false;
  const threadId = message.is_topic_message ? message.message_thread_id : undefined;

  if (command === "/open") {
    await listOpenTickets(group, threadId);
    return true;
  }
  if (command === "/stats") {
    await showStats(group, threadId);
    return true;
  }
  if (command === "/help") {
    await send(group.chatId, TEAM_HELP, { threadId });
    return true;
  }

  const n = await ticketForGroupMessage(group, message);
  if (!n) return false;
  const ticket = await loadTicket(n);
  if (!ticket) return false;

  const operator = operatorName(message, group);
  if (!operator) return true;

  if (command === "/close") {
    if (!(await closeTicket(n, operator, "operator"))) await send(group.chatId, "Обращение уже закрыто.", { threadId });
    return true;
  }
  /* Заметка для команды и служебные сообщения пользователю не уходят. */
  if (text.startsWith("//") || !hasContent(message)) return true;
  if (ticket.status !== "open") {
    await send(group.chatId, "Обращение закрыто — пользователь это сообщение не получит.", { threadId });
    return true;
  }

  /* Обращение с сайта: текст оператора появляется в чате на сайте. */
  if (ticket.source === "site") {
    if (!message.text) {
      await send(group.chatId, "На сайт уходит только текст — опишите словами.", { threadId });
      return true;
    }
    const result = ticket.siteThreadId ? await addSupportReply(ticket.siteThreadId, message.text, operator) : "missing";
    if (result !== "added") {
      await send(group.chatId, result === "closed" ? "Посетитель уже завершил обращение — ответ не показан." : "⚠️ Не получилось передать ответ на сайт.", { threadId });
    }
    return true;
  }

  /* Пользователь должен понимать, что отвечает человек, а не ИИ, поэтому
     к каждому сообщению добавляется имя оператора. */
  const signature = `👤 ${operator} · поддержка PoppersCraft`;
  let delivered: unknown;
  if (message.text) {
    delivered = await send(ticket.userId, `${signature}\n\n${message.text}`);
  } else if (message.photo || message.video || message.document || message.audio || message.voice || message.animation) {
    delivered = await tg("copyMessage", {
      chat_id: ticket.userId,
      from_chat_id: group.chatId,
      message_id: message.message_id,
      caption: `${signature}${message.caption ? `\n\n${message.caption}` : ""}`.slice(0, 1_024),
    });
  } else {
    /* У стикеров, кружков и геопозиций подписи нет — имя уходит отдельно. */
    await send(ticket.userId, `${signature}:`);
    delivered = await tg("copyMessage", { chat_id: ticket.userId, from_chat_id: group.chatId, message_id: message.message_id });
  }
  if (!delivered) {
    await send(group.chatId, "⚠️ Не доставлено: похоже, пользователь заблокировал бота или удалил чат.", { threadId });
  }
  return true;
}

/* ------------------------------------------------------------------------ */
/* Кнопки                                                                   */
/* ------------------------------------------------------------------------ */

/* Возвращает true, если нажатие относится к боту. */
export async function handleBotCallback(query: TgCallback): Promise<boolean> {
  const data = query.data ?? "";
  const message = query.message;
  if (!message) return false;
  const chatId = message.chat.id;
  const answer = (text?: string) => tg("answerCallbackQuery", { callback_query_id: query.id, text });

  if (flooding(query.from.id)) {
    await answer("Слишком часто — подождите немного");
    return true;
  }

  /* Закрыть обращение можно только из группы поддержки. */
  if (data.startsWith("x:")) {
    const group = await loadGroup();
    const n = Number(data.slice(2));
    if (!group || chatId !== group.chatId) {
      await answer();
      return true;
    }
    const closed = await closeTicket(n, clean(query.from.first_name, 40) || "Поддержка", "operator");
    await answer(closed ? "Обращение закрыто" : "Уже закрыто");
    return true;
  }

  if (data === "bind") {
    if (message.chat.type !== "group" && message.chat.type !== "supergroup") {
      await answer();
      return true;
    }
    if (!isOwner(query.from.id)) {
      await tg("answerCallbackQuery", { callback_query_id: query.id, text: notOwnerText(query.from.id), show_alert: true });
      return true;
    }
    const result = await tryBindGroup(chatId, query.from);
    await edit(chatId, message.message_id, result.text, result.bound ? undefined : setupKeyboard());
    await answer(result.bound ? "Группа подключена" : "Пока не всё готово — смотрите пункты с ❌");
    return true;
  }

  /* Остальные кнопки живут только в личке с ботом. */
  if (message.chat.type !== "private") return false;

  if (data === "m") {
    await answer();
    await showMenu(chatId, query.from, message.message_id);
    return true;
  }
  if (data === "f") {
    await answer();
    if (!(await edit(chatId, message.message_id, "Выберите раздел:", faqRoot()))) {
      await send(chatId, "Выберите раздел:", { keyboard: faqRoot() });
    }
    return true;
  }
  if (data.startsWith("f:")) {
    const category = FAQ.find((item) => item.id === data.slice(2));
    await answer();
    if (category) await edit(chatId, message.message_id, category.title, faqCategory(category));
    return true;
  }
  if (data.startsWith("q:")) {
    const [, categoryId, indexText] = data.split(":");
    const category = FAQ.find((item) => item.id === categoryId);
    const item = category?.items[Number(indexText)];
    await answer();
    if (category && item) await edit(chatId, message.message_id, `${item.q}\n\n${item.a}`, faqAnswer(category));
    return true;
  }
  if (data === "st") {
    await answer();
    await sendStatus(chatId, query.from.id);
    return true;
  }
  /* «ln» — кнопка «Привязать аккаунт» из меню прошлой версии: такие
     сообщения уже есть в чатах, поэтому она продолжает работать. */
  if (data === "ln") {
    await answer();
    await sendStatus(chatId, query.from.id);
    return true;
  }
  if (data === "h") {
    await answer();
    /* Без группы спрашивать «Позвать?» бессмысленно — сразу говорим, что делать. */
    if (!(await loadGroup())) {
      await supportUnavailable(chatId, query.from);
      return true;
    }
    await send(chatId, "Позвать человека из команды? Ответ придёт в этот чат.", {
      keyboard: { inline_keyboard: [[{ text: "Да, позвать", callback_data: "h!" }, { text: "Нет", callback_data: "m" }]] },
    });
    return true;
  }
  if (data === "h!") {
    await answer();
    await tg("editMessageReplyMarkup", { chat_id: chatId, message_id: message.message_id });
    await openTicket(chatId, query.from);
    return true;
  }
  if (data.startsWith("c:")) {
    const n = Number(data.slice(2));
    const ticket = await loadTicket(n);
    /* Отменить обращение может только его автор. */
    if (ticket && ticket.userId === query.from.id && ticket.status === "open") {
      await tg("editMessageReplyMarkup", { chat_id: chatId, message_id: message.message_id });
      await closeTicket(n, displayName(query.from), "user");
      await answer("Обращение отменено");
    } else {
      await answer("Обращение уже закрыто");
    }
    return true;
  }
  if (data.startsWith("r:")) {
    const [, nText, vote] = data.split(":");
    const ticket = await loadTicket(Number(nText));
    if (ticket && ticket.userId === query.from.id && !ticket.rating) {
      const rating = vote === "u" ? "up" : "down";
      await saveTicket({ ...ticket, rating });
      await edit(chatId, message.message_id, rating === "up"
        ? "Спасибо! Рады, что помогли."
        : "Жаль, что не получилось. Можно позвать человека ещё раз — или спросите меня.", {
        inline_keyboard: rating === "up"
          ? [[{ text: "🏠 Меню", callback_data: "m" }]]
          : [[{ text: "👤 Позвать человека снова", callback_data: "h!" }], [{ text: "🏠 Меню", callback_data: "m" }]],
      });
      const group = await loadGroup();
      if (group && ticket.chatId === group.chatId && ticket.topicId) {
        await send(group.chatId, `Оценка пользователя: ${rating === "up" ? "👍" : "👎"}`, { threadId: ticket.topicId });
      }
    }
    await answer();
    return true;
  }

  await answer();
  return false;
}

/* ------------------------------------------------------------------------ */
/* Вопросы из чата на сайте                                                 */
/* ------------------------------------------------------------------------ */

/* Вопрос из чата на сайте становится обращением с отдельной темой, как
   обращение из бота. Возвращает номер обращения или null, если группа
   поддержки не подключена — тогда сайт уведомляет владельцев в личке. */
export async function openSiteTicket(siteThreadId: string, question: string) {
  const group = await loadGroup();
  if (!group) return null;
  const n = await reserveTicketNumber();
  const ticket: Ticket = {
    n,
    userId: 0,
    name: "Посетитель сайта",
    username: "",
    chatId: group.chatId,
    topicId: null,
    status: "open",
    openedAt: new Date().toISOString(),
    source: "site",
    siteThreadId,
  };
  ticket.topicId = await createTopic(group.chatId, { n, name: "🌐 Сайт" });
  await saveTicket(ticket);

  const header = [
    `🌐 Обращение #${n} — вопрос из чата на сайте`,
    "",
    clean(question, 900),
    "",
    "Пишите ответ в этой теме — он появится у посетителя в чате на сайте (только текст, можно несколько сообщений). Уточнения посетителя придут сюда же.",
    "Когда вопрос решён — кнопка «Закрыть обращение» или /close: ответы исчезнут из чата на сайте.",
    "Сообщение, начинающееся с //, — заметка для команды.",
  ].join("\n");

  let posted;
  if (ticket.topicId) {
    await writeState(`topic:${group.chatId}:${ticket.topicId}`, "TGTOPIC", `Тема обращения #${n}`, { n });
    posted = await send(group.chatId, header, { threadId: ticket.topicId, keyboard: closeKeyboard(n) });
  } else {
    posted = await send(group.chatId, `${header}\n\n⚠️ Тему создать не удалось — отвечайте через Reply на это сообщение.`, { keyboard: closeKeyboard(n) });
    if (posted) await linkGroupMessage(group.chatId, posted.message_id, n);
  }
  if (!posted) {
    await saveTicket({ ...ticket, status: "closed", closedAt: new Date().toISOString(), closedBy: "система" });
    return null;
  }
  return n;
}

/* Уточнение посетителя сайта в открытое обращение. */
export async function relaySiteMessage(n: number, text: string) {
  const ticket = await loadTicket(n);
  const group = await loadGroup();
  if (!ticket || ticket.status !== "open" || !group) return false;
  const body = `👤 Посетитель сайта:\n\n${clean(text, 900)}`;
  const current = await ensureTopic(ticket, group);
  if (current.topicId && (await send(group.chatId, body, { threadId: current.topicId }))) return true;
  const posted = await send(group.chatId, `Обращение #${n} · ${body}`);
  if (!posted) return false;
  await linkGroupMessage(group.chatId, posted.message_id, n);
  return true;
}

/* Посетитель сам завершил обращение кнопкой в чате на сайте. */
export async function closeSiteTicketByVisitor(n: number) {
  return closeTicket(n, "посетитель", "user");
}

export async function isSupportGroup(chatId: number) {
  const group = await loadGroup();
  return Boolean(group && group.chatId === chatId);
}
