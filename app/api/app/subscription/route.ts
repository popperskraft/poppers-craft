import { NextResponse } from "next/server";
import {
  APP_BUNDLE_ID,
  SUPPORTER_PRODUCT_ID,
  readSupporter,
  saveSupporter,
  supporterFromTransaction,
  verifyAppleSignedPayload,
  type AppleTransaction,
} from "@/lib/app-store";
import { consumeRateLimit, rateLimitResponse } from "@/lib/request-security";
import { getViewerIdentity, sameOriginOrMissing } from "@/lib/waitlist";

export const dynamic = "force-dynamic";

const PRIVATE = { "Cache-Control": "private, no-store" } as const;

/* Подписка «Поддержка сервера» из приложения для iPhone.

   GET отдаёт состояние подписки вошедшего пользователя, POST принимает
   подписанную Apple транзакцию и сохраняет её. Приложение присылает транзакцию
   после покупки и при каждом открытии экрана подписки, поэтому срок окончания
   на сайте всегда свежий. */

export async function GET() {
  const identity = await getViewerIdentity();
  if (!identity || identity.needsMfa) {
    return NextResponse.json({ error: "Войдите в аккаунт." }, { status: 401, headers: PRIVATE });
  }
  return NextResponse.json({ supporter: readSupporter(identity.user.app_metadata) }, { headers: PRIVATE });
}

export async function POST(request: Request) {
  if (!sameOriginOrMissing(request)) {
    return NextResponse.json({ error: "Запрос отклонён." }, { status: 403, headers: PRIVATE });
  }
  const identity = await getViewerIdentity();
  if (!identity || identity.needsMfa) {
    return NextResponse.json({ error: "Войдите в аккаунт." }, { status: 401, headers: PRIVATE });
  }

  const limit = await consumeRateLimit(request, { scope: "app-subscription", limit: 60, windowSeconds: 60 * 60 });
  if (!limit.allowed) return rateLimitResponse(limit, "Слишком много обращений к App Store. Подождите немного.");

  const body = (await request.json().catch(() => null)) as { signedTransaction?: unknown } | null;
  const signed = typeof body?.signedTransaction === "string" ? body.signedTransaction.trim() : "";
  if (!signed || signed.length > 20_000) {
    return NextResponse.json({ error: "Нет подписанной покупки." }, { status: 400, headers: PRIVATE });
  }

  let transaction: AppleTransaction;
  try {
    transaction = verifyAppleSignedPayload(signed) as AppleTransaction;
  } catch {
    return NextResponse.json({ error: "App Store не подтвердил покупку." }, { status: 400, headers: PRIVATE });
  }

  if (transaction.bundleId !== APP_BUNDLE_ID || transaction.productId !== SUPPORTER_PRODUCT_ID) {
    return NextResponse.json({ error: "Эта покупка не от приложения PoppersCraft." }, { status: 400, headers: PRIVATE });
  }

  // Приложение подставляет id аккаунта в appAccountToken — чужую покупку засчитывать нельзя.
  const token = String(transaction.appAccountToken ?? "").trim();
  if (token && token.toLowerCase() !== identity.user.id.toLowerCase()) {
    return NextResponse.json({ error: "Подписка оформлена на другой аккаунт." }, { status: 403, headers: PRIVATE });
  }

  const state = supporterFromTransaction(transaction);
  try {
    await saveSupporter(identity.user.id, state);
  } catch {
    return NextResponse.json({ error: "Не удалось сохранить подписку." }, { status: 500, headers: PRIVATE });
  }

  return NextResponse.json({ supporter: state }, { headers: PRIVATE });
}
