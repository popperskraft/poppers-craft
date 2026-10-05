import { NextResponse } from "next/server";
import { getViewerIdentity, sameOriginOrMissing } from "@/lib/waitlist";
import { forgetCard, PaymentError, paymentSummary, setAutoRenew } from "@/lib/payments";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const PRIVATE = { "Cache-Control": "private, no-store" };

/* Управление подпиской из настроек профиля: автопродление и сохранённая карта. */
export async function POST(request: Request) {
  if (!sameOriginOrMissing(request)) return NextResponse.json({ error: "Запрос отклонён." }, { status: 403, headers: PRIVATE });
  const identity = await getViewerIdentity();
  if (!identity || identity.needsMfa) return NextResponse.json({ error: "Войдите в аккаунт." }, { status: 401, headers: PRIVATE });
  const body = await request.json().catch(() => null) as { action?: unknown } | null;
  try {
    if (body?.action === "auto-renew-off") await setAutoRenew(identity.user.id, false);
    else if (body?.action === "auto-renew-on") await setAutoRenew(identity.user.id, true);
    else if (body?.action === "forget-card") await forgetCard(identity.user.id);
    else return NextResponse.json({ error: "Неизвестное действие." }, { status: 400, headers: PRIVATE });
    const isAdmin = Boolean(identity.adminProfile);
    return NextResponse.json({ ok: true, summary: { isAdmin, ...(await paymentSummary(identity.user.id, { isAdmin })) } }, { headers: PRIVATE });
  } catch (error) {
    if (error instanceof PaymentError) return NextResponse.json({ error: error.message }, { status: error.status, headers: PRIVATE });
    console.error("PLUS management failed", error);
    return NextResponse.json({ error: "Не удалось сохранить изменения." }, { status: 500, headers: PRIVATE });
  }
}
