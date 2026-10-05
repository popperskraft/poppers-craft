import { NextResponse } from "next/server";
import { syncProviderPayment } from "@/lib/payments";
import { isYooPaymentId } from "@/lib/yookassa";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/* HTTP-уведомления ЮKassa (адрес указывается в кабинете: Интеграция →
   HTTP-уведомления). Телу уведомления не доверяем: берём из него только номер
   платежа и запрашиваем актуальный статус у ЮKassa сами. */
export async function POST(request: Request) {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(length) && length > 64 * 1024) return NextResponse.json({ error: "too-large" }, { status: 413 });
  const body = await request.json().catch(() => null) as { event?: unknown; object?: { id?: unknown; payment_id?: unknown } } | null;
  const event = String(body?.event ?? "");
  const paymentId = String((event.startsWith("refund.") ? body?.object?.payment_id : body?.object?.id) ?? "");
  if (!event || !isYooPaymentId(paymentId)) return NextResponse.json({ error: "bad-request" }, { status: 400 });
  if (!event.startsWith("payment.") && !event.startsWith("refund.")) return NextResponse.json({ ok: true });
  try {
    await syncProviderPayment(paymentId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    /* 500 — ЮKassa повторит уведомление позже. */
    console.error("YooKassa notification failed", { event, error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "retry" }, { status: 500 });
  }
}
