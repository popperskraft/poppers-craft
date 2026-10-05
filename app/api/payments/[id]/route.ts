import { NextResponse } from "next/server";
import { getViewerIdentity } from "@/lib/waitlist";
import { paymentForUser } from "@/lib/payments";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const PRIVATE = { "Cache-Control": "private, no-store" };

/* Итог платежа для страницы возврата: при необходимости сверяется с ЮKassa. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const identity = await getViewerIdentity();
  if (!identity || identity.needsMfa) {
    return NextResponse.json({ error: "Войдите в аккаунт.", loginRequired: true }, { status: 401, headers: PRIVATE });
  }
  try {
    const payment = await paymentForUser((await params).id, identity.user.id);
    if (!payment) return NextResponse.json({ error: "Платёж не найден." }, { status: 404, headers: PRIVATE });
    return NextResponse.json({
      payment: {
        id: payment.id,
        kind: payment.kind,
        amount: Number(payment.amount),
        status: payment.status,
        applied: Boolean(payment.applied_at),
        autoRenew: Boolean(payment.payment_method_id),
        tier: payment.tier === "hype" ? "hype" : "plus",
        plan: payment.plan === "year" ? "year" : "month",
        recipientLogin: payment.recipient_login,
        cancellationReason: payment.cancellation_reason,
      },
    }, { headers: PRIVATE });
  } catch (error) {
    console.error("Payment status failed", error);
    return NextResponse.json({ error: "Не удалось проверить платёж." }, { status: 500, headers: PRIVATE });
  }
}
