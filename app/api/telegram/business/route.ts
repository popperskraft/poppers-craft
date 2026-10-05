import { after, NextResponse } from "next/server";
import { generatePoppersAnswer, POPPERS_SUPPORT_USERNAME } from "@/lib/poppers-knowledge";
import { poppersPlainText } from "@/lib/poppers-format";
import { reportPoppersOutage } from "@/lib/poppers-outage";
import { answerSupportThread, findSupportThreadByNotification, resolveSupportThread } from "@/lib/support-bridge";
import { getTelegramAutoReplyState, setTelegramAutoReplyState } from "@/lib/telegram-business-state";
import {
  handleBotCallback,
  handleBotGroupMessage,
  handleBotPrivateMessage,
  isSupportGroup,
  type TgCallback,
  type TgMessage,
} from "@/lib/telegram-support-bot";

export const runtime = "nodejs";

type TelegramUser = { id?: number; is_bot?: boolean; first_name?: string; last_name?: string; username?: string };
type BusinessMessage = {
  message_id?: number;
  business_connection_id?: string;
  chat?: { id?: number; type?: string; username?: string; first_name?: string; last_name?: string };
  from?: TelegramUser;
  text?: string;
  caption?: string;
  sender_business_bot?: TelegramUser;
};
type BotMessage = BusinessMessage & {
  reply_to_message?: { message_id?: number };
  message_thread_id?: number;
  chat?: NonNullable<BusinessMessage["chat"]>;
};
type CallbackQuery = { id?: string; from?: TelegramUser; data?: string; message?: BotMessage };
type TelegramUpdate = { update_id?: number; business_message?: BusinessMessage; message?: BotMessage; callback_query?: CallbackQuery };

const processedUpdates = new Map<number, number>();
const chatReplyTimes = new Map<number, number>();

function telegramToken() {
  return process.env.TELEGRAM_SUPPORT_BOT_TOKEN?.trim() ?? "";
}

async function telegram(method: string, payload: Record<string, unknown>) {
  const token = telegramToken();
  if (!token) throw new Error("telegram-token-missing");
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15_000),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || result?.ok === false) throw new Error(`telegram-${method}-failed`);
  return result;
}

function humanAdminIds() {
  return (process.env.TELEGRAM_SUPPORT_ADMIN_IDS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => /^-?\d+$/.test(value));
}

function cleanTelegramText(value: unknown, maximum = 3_000) {
  return String(value ?? "").replace(/[\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, maximum);
}

function splitTelegramText(value: string, maximum = 3_900) {
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
  return chunks;
}

async function sendBusinessText(connectionId: string, chatId: number, text: string, replyTo?: number) {
  const chunks = splitTelegramText(text);
  for (let index = 0; index < chunks.length; index += 1) {
    await telegram("sendMessage", {
      business_connection_id: connectionId,
      chat_id: chatId,
      text: chunks[index],
      reply_parameters: index === 0 && replyTo ? { message_id: replyTo } : undefined,
    });
  }
}

async function notifyHumans(message: BusinessMessage, question: string) {
  const chatId = message.chat?.id;
  const sender = message.from;
  const name = [sender?.first_name, sender?.last_name].filter(Boolean).join(" ") || message.chat?.first_name || "Пользователь";
  const username = sender?.username || message.chat?.username;
  const alert = `АЛО, ГАРАЖ — НУЖНО ПОМОЧЬ\n\nОт: ${name}${username ? ` (@${username})` : ""}\nЧат ID: ${chatId ?? "неизвестен"}\nВопрос: ${question}\n\nПопперс ответил, что позвал администратора. Откройте диалог в аккаунте поддержки.`;
  await Promise.allSettled(humanAdminIds().map((adminId) => telegram("sendMessage", {
    chat_id: adminId,
    text: alert,
    reply_markup: chatId ? { inline_keyboard: [[
      { text: "ВКЛЮЧИТЬ АВТООТВЕТ", callback_data: `auto:on:${chatId}` },
      { text: "ОСТАВИТЬ ВЫКЛЮЧЕННЫМ", callback_data: `auto:off:${chatId}` },
    ]] } : undefined,
  })));
}

function isHumanAdmin(chatId: number) {
  return humanAdminIds().includes(String(chatId));
}

async function handleWebsiteAdminReply(message: BotMessage) {
  const chatId = message.chat?.id;
  const replyMessageId = message.reply_to_message?.message_id;
  const answer = cleanTelegramText(message.text ?? message.caption, 4_000);
  if (!chatId || !replyMessageId || !answer) return false;
  /* Отвечать на вопросы из чата сайта можно из лички владельца или из
     группы поддержки бота — там отвечает любой участник. */
  if (!isHumanAdmin(chatId) && !(await isSupportGroup(chatId))) return false;
  const thread = await findSupportThreadByNotification(chatId, replyMessageId);
  if (!thread) return false;
  const saved = await answerSupportThread(thread.id, answer);
  await telegram("sendMessage", {
    chat_id: chatId,
    message_thread_id: message.message_thread_id,
    text: saved ? "Ответ отправлен в чат на сайте. Когда вопрос решён — нажмите «✅ Вопрос решён» под уведомлением." : "Это обращение уже закрыто — ответ на сайт не попал.",
  });
  return true;
}

/* Сообщение, пригодное для бота поддержки: с номером и чатом. */
function asBotMessage(message: BotMessage): TgMessage | null {
  if (typeof message.message_id !== "number" || typeof message.chat?.id !== "number" || typeof message.chat.type !== "string") return null;
  return message as unknown as TgMessage;
}

/* Бот поддержки отвечает после того, как Telegram получил ответ вебхука:
   ИИ думает до десятков секунд, и без этого Telegram посчитал бы запрос
   зависшим и прислал его повторно. */
function runLater(label: string, task: () => Promise<unknown>) {
  after(async () => {
    try {
      await task();
    } catch (error) {
      console.error(label, error instanceof Error ? error.message : "unknown");
    }
  });
}

async function handleAutoReplyCommand(message: BotMessage) {
  const adminId = message.from?.id ?? message.chat?.id;
  const text = cleanTelegramText(message.text, 300);
  if (!adminId || !isHumanAdmin(adminId) || !text.startsWith("/auto_")) return false;
  const match = text.match(/^\/(auto_on|auto_off|auto_status)(?:@\w+)?\s+(-?\d+)$/i);
  if (!match) {
    await telegram("sendMessage", { chat_id: message.chat?.id, text: "Формат: /auto_on CHAT_ID, /auto_off CHAT_ID или /auto_status CHAT_ID" });
    return true;
  }
  const chatId = Number(match[2]);
  if (!Number.isSafeInteger(chatId)) return true;
  if (match[1].toLowerCase() === "auto_status") {
    const state = await getTelegramAutoReplyState(chatId);
    await telegram("sendMessage", { chat_id: message.chat?.id, text: `Автоответ для чата ${chatId}: ${state.enabled ? "ВКЛЮЧЁН" : "ВЫКЛЮЧЕН"}.` });
    return true;
  }
  const enabled = match[1].toLowerCase() === "auto_on";
  const previous = await getTelegramAutoReplyState(chatId);
  await setTelegramAutoReplyState(chatId, enabled, previous.connectionId, `admin:${adminId}`);
  await telegram("sendMessage", { chat_id: message.chat?.id, text: `Автоответ для чата ${chatId} ${enabled ? "включён" : "выключен"}.` });
  return true;
}

/* «✅ Вопрос решён» под уведомлением в личке владельца: обращение с сайта
   закрывается, и ответы исчезают из чата на сайте. */
async function handleSiteResolveCallback(query: CallbackQuery) {
  const adminId = query.from?.id;
  const threadId = query.data?.slice(3) ?? "";
  if (!query.id || !adminId || !isHumanAdmin(adminId)) return;
  const resolved = await resolveSupportThread(threadId, cleanTelegramText(query.from?.first_name, 40) || "администратор");
  await telegram("answerCallbackQuery", { callback_query_id: query.id, text: resolved ? "Вопрос решён, ответы убраны с сайта" : "Обращение уже закрыто" });
  if (query.message?.chat?.id && query.message.message_id) {
    await telegram("editMessageReplyMarkup", { chat_id: query.message.chat.id, message_id: query.message.message_id }).catch(() => undefined);
  }
}

async function handleCallback(query: CallbackQuery) {
  const adminId = query.from?.id;
  const match = query.data?.match(/^auto:(on|off):(-?\d+)$/);
  if (!query.id || !adminId || !isHumanAdmin(adminId) || !match) return;
  const chatId = Number(match[2]);
  if (!Number.isSafeInteger(chatId)) return;
  const enabled = match[1] === "on";
  const previous = await getTelegramAutoReplyState(chatId);
  await setTelegramAutoReplyState(chatId, enabled, previous.connectionId, `admin:${adminId}`);
  await telegram("answerCallbackQuery", { callback_query_id: query.id, text: enabled ? "Автоответ включён" : "Автоответ выключен" });
  if (query.message?.chat?.id) {
    await telegram("sendMessage", { chat_id: query.message.chat.id, text: `Автоответ для чата ${chatId} ${enabled ? "включён" : "выключен"}.` });
  }
}

export async function GET() {
  return NextResponse.json({ ok: true, mode: "telegram-business" });
}

export async function POST(request: Request) {
  const expectedSecret = process.env.TELEGRAM_SUPPORT_WEBHOOK_SECRET?.trim();
  if (!expectedSecret || request.headers.get("x-telegram-bot-api-secret-token") !== expectedSecret) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  if (!telegramToken()) return NextResponse.json({ ok: false }, { status: 503 });

  const update = await request.json().catch(() => null) as TelegramUpdate | null;
  if (!update) return NextResponse.json({ ok: true });
  const now = Date.now();
  for (const [id, time] of processedUpdates) if (now - time > 10 * 60_000) processedUpdates.delete(id);
  if (typeof update.update_id === "number") {
    if (processedUpdates.has(update.update_id)) return NextResponse.json({ ok: true });
    processedUpdates.set(update.update_id, now);
  }

  if (update.message) {
    const incoming = update.message;
    const botMessage = asBotMessage(incoming);
    const chatType = incoming.chat?.type;

    /* Группы: сначала обращения бота и команды операторов, затем ответы
       через Reply на вопросы из чата сайта. */
    if (chatType === "group" || chatType === "supergroup") {
      if (botMessage) {
        runLater("Telegram support group update failed", async () => {
          if (!(await handleBotGroupMessage(botMessage))) await handleWebsiteAdminReply(incoming);
        });
      }
      return NextResponse.json({ ok: true });
    }

    /* Личка: служебные сценарии владельцев остаются как были, всё
       остальное — меню, частые вопросы, ИИ и обращения. */
    if (await handleWebsiteAdminReply(incoming).catch(() => false)) return NextResponse.json({ ok: true });
    if (await handleAutoReplyCommand(incoming).catch(() => false)) return NextResponse.json({ ok: true });
    if (chatType === "private" && botMessage) {
      runLater("Telegram support private update failed", () => handleBotPrivateMessage(botMessage));
    }
    return NextResponse.json({ ok: true });
  }

  if (update.callback_query) {
    const query = update.callback_query;
    if (query.data?.startsWith("auto:")) {
      await handleCallback(query).catch(() => undefined);
    } else if (query.data?.startsWith("sr:")) {
      await handleSiteResolveCallback(query).catch(() => undefined);
    } else if (query.id && query.from?.id && query.message && asBotMessage(query.message)) {
      runLater("Telegram support callback failed", () => handleBotCallback(query as unknown as TgCallback));
    }
    return NextResponse.json({ ok: true });
  }

  const message = update.business_message;
  const chatId = message?.chat?.id;
  const connectionId = message?.business_connection_id;
  const question = cleanTelegramText(message?.text ?? message?.caption);
  if (!message || !chatId || !connectionId || !question || message.from?.is_bot || message.sender_business_bot) return NextResponse.json({ ok: true });

  const senderId = message.from?.id;
  if (senderId && isHumanAdmin(senderId)) {
    await setTelegramAutoReplyState(chatId, false, connectionId, `human:${senderId}`).catch(() => undefined);
    return NextResponse.json({ ok: true });
  }

  const autoReply = await getTelegramAutoReplyState(chatId);
  if (!autoReply.enabled) return NextResponse.json({ ok: true });
  if (autoReply.connectionId !== connectionId) {
    await setTelegramAutoReplyState(chatId, true, connectionId, "business-message").catch(() => undefined);
  }

  const previousReply = chatReplyTimes.get(chatId) ?? 0;
  if (now - previousReply < 2_500) return NextResponse.json({ ok: true });
  chatReplyTimes.set(chatId, now);

  try {
    await telegram("sendChatAction", { business_connection_id: connectionId, chat_id: chatId, action: "typing" });
    const { answer, needsHuman } = await generatePoppersAnswer(
      question,
      `Это личный чат поддержки Telegram Business. Имя пользователя: ${cleanTelegramText(message.from?.first_name || message.chat?.first_name, 100)}.`,
    );
    /* В Telegram нет оформления: заголовки и звёздочки убираем (lib/poppers-format.ts). */
    const plain = poppersPlainText(answer) || answer;
    const reply = needsHuman
      ? `${plain}\n\nЯ позвал администратора — он подключится к чату. Поддержка: ${POPPERS_SUPPORT_USERNAME}`
      : plain;
    await sendBusinessText(connectionId, chatId, reply, message.message_id);
    if (needsHuman) {
      await setTelegramAutoReplyState(chatId, false, connectionId, "poppers-escalation").catch(() => undefined);
      await notifyHumans(message, question);
    }
  } catch (error) {
    /* ИИ недоступен — человек уже передан администратору, владельцу сообщение в бота. */
    after(() => reportPoppersOutage(error, "Telegram Business"));
    await Promise.allSettled([
      sendBusinessText(connectionId, chatId, `Я позвал администратора — он подключится к чату. Поддержка: ${POPPERS_SUPPORT_USERNAME}`),
      setTelegramAutoReplyState(chatId, false, connectionId, "poppers-error"),
      notifyHumans(message, question),
    ]);
  }
  return NextResponse.json({ ok: true });
}
