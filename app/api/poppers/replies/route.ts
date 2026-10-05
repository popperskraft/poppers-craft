import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { listBrowserSupportThreads, resolveBrowserThread, SUPPORT_COOKIE_NAME } from "@/lib/support-bridge";
import { closeSiteTicketByVisitor } from "@/lib/telegram-support-bot";
import { sameOriginOrMissing } from "@/lib/waitlist";

export const runtime = "nodejs";

async function browserToken() {
  const token = (await cookies()).get(SUPPORT_COOKIE_NAME)?.value ?? "";
  return token.length >= 32 ? token : "";
}

/* Открытые обращения этого браузера с ответами администраторов. Решённые
   сюда не попадают — по их исчезновению виджет убирает ответы из чата.
   При сбое возвращается ошибка, а не пустой список: пустой список виджет
   принял бы за «вопрос решён» и стёр бы ответы. */
export async function GET() {
  const token = await browserToken();
  if (!token) return NextResponse.json({ threads: [] }, { headers: { "Cache-Control": "private, no-store" } });
  try {
    return NextResponse.json({ threads: await listBrowserSupportThreads(token) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "Ответы временно недоступны." }, { status: 503 });
  }
}

/* Посетитель сам завершает обращение кнопкой в чате. */
export async function POST(request: Request) {
  if (!sameOriginOrMissing(request)) return NextResponse.json({ error: "Запрос отклонён." }, { status: 403 });
  const token = await browserToken();
  if (!token) return NextResponse.json({ ok: true });
  try {
    const resolved = await resolveBrowserThread(token);
    if (resolved?.ticket) await closeSiteTicketByVisitor(resolved.ticket);
    return NextResponse.json({ ok: true, threadId: resolved?.id ?? null });
  } catch {
    return NextResponse.json({ error: "Не получилось завершить обращение." }, { status: 503 });
  }
}
