import { NextResponse } from "next/server";
import { getViewerIdentity, sameOriginOrMissing } from "@/lib/waitlist";
import { consumeRateLimit, rateLimitResponse } from "@/lib/request-security";
import { checkPromo, getPaymentSettings, paymentPrices, paymentsAvailable, PaymentError, paymentSummary, startPayment } from "@/lib/payments";
import { yookassaTestMode } from "@/lib/yookassa";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const PRIVATE = { "Cache-Control": "private, no-store" };

/* Состояние оплаты для страницы доната и настроек профиля. */
export async function GET() {
  const identity = await getViewerIdentity();
  if (!identity || identity.needsMfa) {
    const settings = await getPaymentSettings();
    return NextResponse.json({ authenticated: false, needsMfa: Boolean(identity?.needsMfa), available: paymentsAvailable(settings) && !yookassaTestMode(), test: yookassaTestMode(), prices: paymentPrices() }, { headers: PRIVATE });
  }
  try {
    const isAdmin = Boolean(identity.adminProfile);
    return NextResponse.json({ authenticated: true, isAdmin, ...(await paymentSummary(identity.user.id, { isAdmin })) }, { headers: PRIVATE });
  } catch (error) {
    console.error("Payment summary failed", error);
    return NextResponse.json({ error: "Не удалось загрузить состояние оплаты." }, { status: 500, headers: PRIVATE });
  }
}

/* Создать платёж и вернуть ссылку на страницу оплаты ЮKassa. */
export async function POST(request: Request) {
  if (!sameOriginOrMissing(request)) return NextResponse.json({ error: "Запрос отклонён." }, { status: 403, headers: PRIVATE });
  const identity = await getViewerIdentity();
  if (!identity || identity.needsMfa) {
    return NextResponse.json({ error: "Войдите в аккаунт, чтобы оплатить.", loginRequired: true }, { status: 401, headers: PRIVATE });
  }
  const limit = await consumeRateLimit(request, { scope: "payment-create", key: identity.user.id, limit: 10, windowSeconds: 60 * 60 });
  if (!limit.allowed) return rateLimitResponse(limit, "Слишком много попыток оплаты. Попробуйте позже.");
  const body = await request.json().catch(() => null) as { plan?: unknown; term?: unknown; tier?: unknown; promo?: unknown; autoRenew?: unknown; consent?: unknown; gift?: unknown; provider?: unknown; currency?: unknown; language?: unknown } | null;
  const plan = body?.plan === "pass" || body?.plan === "plus" ? body.plan : null;
  if (!plan) return NextResponse.json({ error: "Выберите пропуск или подписку." }, { status: 400, headers: PRIVATE });
  if (body?.consent !== true) {
    return NextResponse.json({ error: "Подтвердите согласие с условиями оплаты." }, { status: 400, headers: PRIVATE });
  }
  try {
    /* gift — ник игрока, которому дарят подписку; term — месяц или год; tier — PLUS или HYPE. */
    const giftTo = typeof body?.gift === "string" && body.gift.trim() ? body.gift.slice(0, 40) : null;
    const result = await startPayment({
      userId: identity.user.id,
      kind: plan,
      autoRenew: plan === "plus" && !giftTo && body?.autoRenew === true,
      isAdmin: Boolean(identity.adminProfile),
      giftTo,
      term: body?.term === "year" ? "year" : "month",
      tier: body?.tier === "hype" ? "hype" : "plus",
      promo: typeof body?.promo === "string" && body.promo.trim() ? body.promo : null,
      /* Карта не из России — lava.top (r103). */
      provider: body?.provider === "lava" ? "lava" : "yookassa",
      currency: body?.currency === "EUR" || body?.currency === "RUB" ? body.currency : "USD",
      language: body?.language === "RU" ? "RU" : "EN",
    });
    return NextResponse.json(result, { headers: PRIVATE });
  } catch (error) {
    if (error instanceof PaymentError) return NextResponse.json({ error: error.message }, { status: error.status, headers: PRIVATE });
    console.error("Payment start failed", error);
    return NextResponse.json({ error: "Не получилось начать оплату. Попробуйте позже." }, { status: 500, headers: PRIVATE });
  }
}
