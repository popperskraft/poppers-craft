import type { Metadata } from "next";
import { cache } from "react";
import { DonationPlansPage } from "./DonationPlansPage";
import type { PaymentSummary, Plan } from "./PaymentDialog";
import { getViewerIdentity } from "@/lib/waitlist";
import { getPaymentSettings, paymentPrices, paymentsAvailable, paymentSummary } from "@/lib/payments";
import { yookassaTestMode } from "@/lib/yookassa";

export const dynamic = "force-dynamic";

/* Состояние оплаты считается на сервере: заголовок (ДОНАТ или PLUS) и
   кнопки сразу соответствуют игроку, без перескока после загрузки. */
const loadSummary = cache(async (): Promise<PaymentSummary | null> => {
  try {
    const identity = await getViewerIdentity();
    if (!identity || identity.needsMfa) {
      const settings = await getPaymentSettings();
      return { authenticated: false, needsMfa: Boolean(identity?.needsMfa), available: paymentsAvailable(settings) && !yookassaTestMode(), test: yookassaTestMode(), prices: paymentPrices() };
    }
    const isAdmin = Boolean(identity.adminProfile);
    return { authenticated: true, isAdmin, ...(await paymentSummary(identity.user.id, { isAdmin })) };
  } catch (error) {
    console.error("Donation page summary failed", error instanceof Error ? error.message : error);
    return null;
  }
});

export async function generateMetadata(): Promise<Metadata> {
  const summary = await loadSummary();
  /* У игрока с доступом пропуск уже есть — раздел для него называется PLUS. */
  const prices = paymentPrices();
  return summary?.serverAccess
    ? { title: "Выбери план — PoppersCraft", description: `Подписка PLUS за ${prices.plus} ₽ и HYPE за ${prices.hype} ₽ в месяц: оформление профиля и то, что видно в игре.` }
    : { title: "Донат — PoppersCraft", description: `Пропуск POPPERSCRAFT за ${prices.pass} ₽ один раз и подписка PLUS или HYPE — оформление без игровых преимуществ.` };
}

export default async function DonationPage({ searchParams }: { searchParams: Promise<{ plan?: string; to?: string; tier?: string }> }) {
  const [{ plan, to, tier }, summary] = await Promise.all([searchParams, loadSummary()]);
  /* ?plan=pass|plus|hype — кнопки с главной, из профиля и гардероба сразу
     открывают окно; ?plan=gift&to=ник[&tier=hype] — подарок с карточки игрока. */
  const initialPlan: Plan | null = plan === "pass" || plan === "plus" || plan === "hype" ? plan : null;
  const initialGift = plan === "gift" && typeof to === "string" && /^@?[a-zA-Z0-9_.-]{3,32}$/.test(to) ? to.replace(/^@/, "") : null;
  return <DonationPlansPage initialSummary={summary} initialPlan={initialPlan} initialGift={initialGift} initialGiftTier={tier === "hype" ? "hype" : "plus"} />;
}
