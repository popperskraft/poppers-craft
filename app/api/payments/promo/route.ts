import { NextResponse } from "next/server";
import { getViewerIdentity } from "@/lib/waitlist";
import { consumeRateLimit, rateLimitResponse } from "@/lib/request-security";
import { checkPromo, PaymentError } from "@/lib/payments";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const PRIVATE = { "Cache-Control": "private, no-store" };

/* Проверка промокода в окне оплаты: активация здесь не занимается —
   код резервируется, только когда игрок нажимает «Оплатить». */
export async function GET(request: Request) {
  const identity = await getViewerIdentity();
  if (!identity || identity.needsMfa) {
    return NextResponse.json({ error: "Войдите в аккаунт.", loginRequired: true }, { status: 401, headers: PRIVATE });
  }
  const limit = await consumeRateLimit(request, { scope: "promo-check", key: identity.user.id, limit: 40, windowSeconds: 60 * 60 });
  if (!limit.allowed) return rateLimitResponse(limit, "Слишком много проверок промокода. Попробуйте позже.");
  const url = new URL(request.url);
  /* Что покупают: пропуск, PLUS или HYPE — у кода может быть ограничение. */
  const raw = url.searchParams.get("kind");
  const kind = raw === "pass" || raw === "hype" ? raw : "plus";
  try {
    const promo = await checkPromo(url.searchParams.get("code") ?? "", identity.user.id, kind);
    return NextResponse.json(promo, { headers: PRIVATE });
  } catch (error) {
    if (error instanceof PaymentError) return NextResponse.json({ error: error.message }, { status: error.status, headers: PRIVATE });
    console.error("Promo check failed", error);
    return NextResponse.json({ error: "Не удалось проверить промокод." }, { status: 500, headers: PRIVATE });
  }
}
