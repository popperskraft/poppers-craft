import type { YooPayment } from "@/lib/yookassa";

/* Only a provider response for this exact order may grant a pass or a
   referral reward. The webhook body itself is never payment evidence. */
export function verifyProviderPayment(
  row: { id: string; amount: number; provider_payment_id: string | null },
  payment: YooPayment,
) {
  if (row.provider_payment_id && payment.id !== row.provider_payment_id) {
    throw new Error("payment-provider-id-mismatch");
  }
  if (payment.metadata?.payment_id !== row.id) {
    throw new Error("payment-metadata-mismatch");
  }
  const amount = Number(payment.amount?.value);
  if (!Number.isFinite(amount) || amount <= 0 || payment.amount?.currency !== "RUB"
    || Math.round(amount * 100) !== Math.round(Number(row.amount) * 100)) {
    throw new Error("payment-amount-mismatch");
  }
  if (payment.status === "succeeded" && payment.paid !== true) {
    throw new Error("payment-not-paid");
  }
}
