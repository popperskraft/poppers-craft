import { NextResponse } from "next/server";
import { handleLavaWebhook } from "@/lib/payments";
import { lavaWebhookAuthorized, type LavaWebhook } from "@/lib/lava";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/* Вебхук lava.top (r103): lava.top кладёт в X-Api-Key строку из своих
   настроек вебхука, она же — LAVA_WEBHOOK_KEY. Ответ 200 значит «принято»;
   при ошибке lava.top повторит запрос. */
export async function POST(request: Request) {
  if (!lavaWebhookAuthorized(request.headers.get("x-api-key"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const event = await request.json().catch(() => null) as LavaWebhook | null;
  if (!event || typeof event !== "object") return NextResponse.json({ error: "bad request" }, { status: 400 });
  try {
    const result = await handleLavaWebhook(event);
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    console.error("lava.top webhook failed", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "retry" }, { status: 500 });
  }
}

/* Проверка адреса из кабинета lava.top. */
export async function GET() {
  return NextResponse.json({ ok: true });
}
