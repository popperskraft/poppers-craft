import { after, NextResponse } from "next/server";
import { generatePoppersAnswer, isEnglishQuestion, POPPERS_SUPPORT_USERNAME } from "@/lib/poppers-knowledge";
import { cookies } from "next/headers";
import { createSupportThread, findOpenBrowserThread, newSupportBrowserToken, recordVisitorMessage, saveSupportNotificationIds, setSupportThreadTicket, SUPPORT_COOKIE_NAME } from "@/lib/support-bridge";
import { sameOriginOrMissing } from "@/lib/waitlist";
import { consumeRateLimit, rateLimitResponse } from "@/lib/request-security";
import { openSiteTicket, relaySiteMessage } from "@/lib/telegram-support-bot";
import { reportPoppersOutage } from "@/lib/poppers-outage";

export const runtime = "nodejs";

function cleanContext(value: unknown, maximum: number) {
  return String(value ?? "").replace(/[\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, maximum);
}

function telegramToken() {
  return process.env.TELEGRAM_SUPPORT_BOT_TOKEN?.trim() ?? "";
}

function humanAdminIds() {
  return (process.env.TELEGRAM_SUPPORT_ADMIN_IDS ?? "").split(",").map((value) => value.trim()).filter((value) => /^-?\d+$/.test(value));
}

/* Запасной путь, когда группа поддержки не подключена: уведомление в
   личку владельцам. Ответ — через Reply, закрытие — кнопкой под сообщением. */
async function notifyWebsiteSupport(threadId: string, question: string, followUp = false) {
  const token = telegramToken();
  if (!token) return {} as Record<string, number>;
  const alert = followUp
    ? `УТОЧНЕНИЕ ПО ОБРАЩЕНИЮ С САЙТА\n\n${question}\n\nОтветьте на это сообщение обычным Reply — ответ появится в чате на сайте.`
    : `АЛО, ГАРАЖ — НУЖНО ПОМОЧЬ НА САЙТЕ\n\nВопрос: ${question}\n\nОтветьте на это сообщение обычным Reply — ответ появится в чате на сайте. Можно отвечать несколько раз. Когда вопрос решён, нажмите кнопку ниже: ответы исчезнут из чата на сайте.`;
  const replyMarkup = { inline_keyboard: [[{ text: "✅ Вопрос решён", callback_data: `sr:${threadId}` }]] };
  const pairs = await Promise.all(humanAdminIds().map(async (chatId) => {
    try {
      const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: alert, reply_markup: replyMarkup }),
        signal: AbortSignal.timeout(15_000),
      });
      const result = await response.json();
      const messageId = result?.result?.message_id;
      return response.ok && Number.isInteger(messageId) ? [chatId, messageId] as const : null;
    } catch {
      return null;
    }
  }));
  return Object.fromEntries(pairs.filter((pair): pair is readonly [string, number] => Boolean(pair)));
}

export async function POST(request: Request) {
  if (!sameOriginOrMissing(request)) return NextResponse.json({ error: "Запрос отклонён." }, { status: 403 });
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > 32 * 1024) return NextResponse.json({ error: "Вопрос слишком большой." }, { status: 413 });
  const clientLimit = await consumeRateLimit(request, { scope: "poppers-client", limit: 30, windowSeconds: 60 * 60 });
  if (!clientLimit.allowed) return rateLimitResponse(clientLimit, "Слишком много вопросов. Попробуйте позже.");

  const body = await request.json().catch(() => null);
  const question = cleanContext(body?.question, 500);
  const pageTitle = cleanContext(body?.pageTitle, 180);
  const pageUrl = cleanContext(body?.pageUrl, 300);
  const pageText = cleanContext(body?.pageText, 12_000);
  /* Служебные фразы чата — на языке вопроса, как и ответ Попперса. */
  const english = isEnglishQuestion(question);
  if (question.length < 2) return NextResponse.json({ error: english ? "Please write your question in a bit more detail." : "Напишите вопрос чуть подробнее." }, { status: 400 });
  const globalLimit = await consumeRateLimit(request, {
    scope: "poppers-global",
    key: "global",
    limit: 1_000,
    windowSeconds: 60 * 60,
    cost: Math.max(1, Math.ceil((question.length + pageText.length) / 2_000)),
  });
  if (!globalLimit.allowed) return rateLimitResponse(globalLimit, "Попперс сейчас занят. Попробуйте позже.");

  /* Пока у посетителя открыто обращение к администратору, его сообщения
     уходят туда же, а не Попперсу — как в боте, пока открыто обращение. */
  const cookieStore = await cookies();
  const existingToken = cookieStore.get(SUPPORT_COOKIE_NAME)?.value;
  if (existingToken && existingToken.length >= 32) {
    const open = await findOpenBrowserThread(existingToken).catch(() => null);
    if (open) {
      let relayed = false;
      try {
        if (open.ticket) {
          relayed = await relaySiteMessage(open.ticket, question);
        } else {
          const ids = await notifyWebsiteSupport(open.id, question, true);
          relayed = Object.keys(ids).length > 0;
          if (relayed) await saveSupportNotificationIds(open.id, ids);
        }
      } catch (error) {
        console.error("Website support relay failed", error);
      }
      if (relayed) await recordVisitorMessage(open.id, question);
      return NextResponse.json({
        answer: relayed
          ? (english ? "Passed it to an admin. Their reply will appear here." : "Передал администратору. Его ответ появится здесь.")
          : (english ? `Couldn't pass your message to an admin. Write to them directly: ${POPPERS_SUPPORT_USERNAME}` : `Не получилось передать сообщение администратору. Напишите напрямую: ${POPPERS_SUPPORT_USERNAME}`),
        supportThreadId: open.id,
        relayed: true,
      });
    }
  }

  /* ИИ не ответил (кончились токены, ключ, сбой Google) — вопрос сразу уходит
     оператору, как при [NEEDS_HUMAN], а владельцу — сообщение в бота. */
  let generated: { answer: string; needsHuman: boolean };
  try {
    generated = await generatePoppersAnswer(
      question,
      `Текущая страница: ${pageTitle} (${pageUrl})\n${pageText || "Контекст страницы не запрашивался."}`,
    );
  } catch (error) {
    after(() => reportPoppersOutage(error, "чат на сайте"));
    generated = {
      answer: english ? "Poppers can't answer on his own right now." : "Попперс сейчас не может ответить сам.",
      needsHuman: true,
    };
  }

  try {
    const { answer, needsHuman } = generated;
    let finalAnswer = needsHuman
      ? `${answer}\n\n${english ? "I've called an admin — their reply will appear here, in this chat. While the request is open, the team gets your messages." : "Я позвал администратора — его ответ появится здесь, в этом чате. Пока обращение открыто, ваши сообщения получает команда."}`
      : answer;
    let supportThreadId: string | null = null;
    if (needsHuman) {
      try {
        const [clientEscalationLimit, globalEscalationLimit] = await Promise.all([
          consumeRateLimit(request, { scope: "poppers-escalation-client", limit: 3, windowSeconds: 60 * 60 }),
          consumeRateLimit(request, { scope: "poppers-escalation-global", key: "global", limit: 30, windowSeconds: 60 * 60 }),
        ]);
        if (!clientEscalationLimit.allowed || !globalEscalationLimit.allowed) {
          finalAnswer = `${answer}\n\n${english ? "The support queue is full right now. Write to an admin:" : "Сейчас очередь поддержки заполнена. Напишите администратору:"} @PoppersCraftAuthBot`;
          return NextResponse.json({ answer: finalAnswer, supportThreadId });
        }
        const browserToken = existingToken && existingToken.length >= 32 ? existingToken : newSupportBrowserToken();
        const thread = await createSupportThread(question, answer, browserToken, pageUrl);
        supportThreadId = thread.id;
        /* Обращение с отдельной темой в группе поддержки, как из бота. Если
           группа не подключена — уведомление владельцам в личку. */
        const ticket = await openSiteTicket(thread.id, question).catch((error) => {
          console.error("Website support ticket failed", error);
          return null;
        });
        if (ticket) {
          await setSupportThreadTicket(thread.id, ticket);
        } else {
          const notificationIds = await notifyWebsiteSupport(thread.id, question);
          if (Object.keys(notificationIds).length) await saveSupportNotificationIds(thread.id, notificationIds);
        }
        if (!existingToken) cookieStore.set(SUPPORT_COOKIE_NAME, browserToken, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 30 });
      } catch (error) {
        console.error("Website support bridge failed", error);
        finalAnswer = `${answer}\n\n${english ? "Couldn't call an admin. Write to them directly:" : "Не получилось позвать администратора. Напишите напрямую:"} ${POPPERS_SUPPORT_USERNAME}`;
        supportThreadId = null;
      }
    }
    return NextResponse.json({ answer: finalAnswer, supportThreadId });
  } catch {
    return NextResponse.json({ error: english ? `Poppers isn't answering right now. Write to an admin: ${POPPERS_SUPPORT_USERNAME}` : `Попперс сейчас не отвечает. Напишите администратору: ${POPPERS_SUPPORT_USERNAME}` }, { status: 502 });
  }
}
