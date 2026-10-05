import { NextResponse } from "next/server";
import {
  APP_BUNDLE_ID,
  SUPPORTER_PRODUCT_ID,
  saveSupporter,
  supporterFromTransaction,
  supporterUserId,
  verifyAppleSignedPayload,
  type AppleRenewalInfo,
  type AppleTransaction,
} from "@/lib/app-store";

export const dynamic = "force-dynamic";

/* App Store Server Notifications V2 — адрес для Apple, а не для браузера.

   Сюда App Store сам присылает продления, отмены и возвраты, поэтому подписка
   на сайте гаснет и оживает без участия приложения. Проверка одна: подпись
   Apple. Отвечаем 200 даже на неинтересные события, иначе Apple будет повторять
   доставку несколько суток. */

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { signedPayload?: unknown } | null;
  const signed = typeof body?.signedPayload === "string" ? body.signedPayload.trim() : "";
  if (!signed || signed.length > 60_000) {
    return NextResponse.json({ error: "bad-request" }, { status: 400 });
  }

  let notification: Record<string, unknown>;
  try {
    notification = verifyAppleSignedPayload(signed);
  } catch {
    return NextResponse.json({ error: "unverified" }, { status: 401 });
  }

  const data = (notification.data ?? {}) as Record<string, unknown>;
  const notificationType = String(notification.notificationType ?? "");
  if (notificationType === "TEST") return NextResponse.json({ ok: true });
  if (data.bundleId && data.bundleId !== APP_BUNDLE_ID) {
    return NextResponse.json({ error: "other-app" }, { status: 400 });
  }

  const signedTransaction = typeof data.signedTransactionInfo === "string" ? data.signedTransactionInfo : "";
  if (!signedTransaction) return NextResponse.json({ ok: true });

  let transaction: AppleTransaction;
  let renewal: AppleRenewalInfo | null = null;
  try {
    transaction = verifyAppleSignedPayload(signedTransaction) as AppleTransaction;
    if (typeof data.signedRenewalInfo === "string" && data.signedRenewalInfo) {
      renewal = verifyAppleSignedPayload(data.signedRenewalInfo) as AppleRenewalInfo;
    }
  } catch {
    return NextResponse.json({ error: "unverified" }, { status: 401 });
  }

  if (transaction.productId !== SUPPORTER_PRODUCT_ID) return NextResponse.json({ ok: true });

  const userId = await supporterUserId(transaction);
  if (!userId) return NextResponse.json({ ok: true });

  try {
    await saveSupporter(userId, supporterFromTransaction(transaction, renewal));
  } catch {
    // Пусть Apple повторит доставку: состояние подписки важнее одной попытки.
    return NextResponse.json({ error: "storage" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
