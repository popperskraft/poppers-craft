import "server-only";
import { timingSafeEqual } from "node:crypto";

/* lava.top — оплата картами не из России (r103). ЮKassa остаётся для
   российских карт. Покупка идёт так: сайт создаёт счёт (контракт) через
   API, игрок платит на странице lava.top, а lava.top присылает вебхук на
   /api/payments/lava/webhook. По номеру контракта сайт находит свой платёж
   в pc_payments (provider = 'lava') и выдаёт пропуск или подписку той же
   функцией, что и для ЮKassa (pc_apply_payment). Продление месячной подписки
   списывает сама lava.top и присылает вебхук с parentContractId.

   Ключи — в .env релиза: LAVA_API_KEY (ключ API из «Интеграции») и
   LAVA_WEBHOOK_KEY (строка, которую lava.top кладёт в X-Api-Key вебхука).
   Пока не задан LAVA_PUBLIC=1, кнопку видят только администраторы. */

const API = "https://gate.lava.top";

export type LavaCurrency = "USD" | "EUR" | "RUB";
export const LAVA_CURRENCIES: LavaCurrency[] = ["USD", "EUR", "RUB"];

/* Цены (offerId) продуктов в кабинете lava.top. */
export const LAVA_OFFERS = {
  pass: "07bf2b19-cc2d-4ab8-92a3-fa06249136a5",
  "plus-month": "f6f46a28-cea9-46ad-8fda-428d8c6e3ff0",
  "hype-month": "7e54cbf4-3e31-467a-8572-e08de2808ef3",
  "plus-year": "c4cc64b9-43b4-42a9-9545-f8bdba4c19a0",
  "hype-year": "130a8a28-6874-4635-869e-2456f95c6dc5",
} as const;
export type LavaOfferKey = keyof typeof LAVA_OFFERS;

export function lavaOfferKey(kind: "pass" | "plus", plan: "month" | "year", tier: "plus" | "hype"): LavaOfferKey {
  return kind === "pass" ? "pass" : (`${tier}-${plan}` as LavaOfferKey);
}

export function lavaConfigured() {
  return Boolean(process.env.LAVA_API_KEY);
}

/* Кнопку «Карта не из России» видят все, когда владелец включил LAVA_PUBLIC=1. */
export function lavaPublic() {
  return lavaConfigured() && process.env.LAVA_PUBLIC === "1";
}

export class LavaError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function lavaFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const key = process.env.LAVA_API_KEY;
  if (!key) throw new LavaError("lava.top is not configured", 503);
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: { "X-Api-Key": key, Accept: "application/json", "Content-Type": "application/json", ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  const text = await response.text();
  if (!response.ok) throw new LavaError(`lava.top ${path} ${response.status}: ${text.slice(0, 200)}`, response.status);
  return (text ? JSON.parse(text) : {}) as T;
}

type LavaProducts = { items?: Array<{ offers?: Array<{ id: string; prices?: Array<{ currency: string; amount: number | null }> }> }> };

let priceCache: { at: number; prices: Map<string, number> } | null = null;

/* Цена тарифа в валюте — для суммы в нашей записи о платеже. Кэш 10 минут. */
export async function lavaPrice(offerId: string, currency: LavaCurrency) {
  if (!priceCache || Date.now() - priceCache.at > 10 * 60_000) {
    const data = await lavaFetch<LavaProducts>("/api/v2/products");
    const prices = new Map<string, number>();
    for (const product of data.items ?? []) {
      for (const offer of product.offers ?? []) {
        for (const price of offer.prices ?? []) {
          if (typeof price.amount === "number") prices.set(`${offer.id}:${price.currency}`, price.amount);
        }
      }
    }
    priceCache = { at: Date.now(), prices };
  }
  const amount = priceCache.prices.get(`${offerId}:${currency}`);
  if (amount === undefined) throw new LavaError(`no ${currency} price for offer ${offerId}`, 404);
  return amount;
}

export async function createLavaInvoice(input: {
  email: string;
  offerId: string;
  currency: LavaCurrency;
  language: "RU" | "EN";
  returnUrl: string;
}) {
  const body = {
    email: input.email,
    offerId: input.offerId,
    currency: input.currency,
    buyerLanguage: input.language,
    successful_return_url: input.returnUrl,
    failure_return_url: input.returnUrl,
    cancel_return_url: input.returnUrl,
  };
  const result = await lavaFetch<{ id?: string; paymentUrl?: string | null }>("/api/v3/invoice", { method: "POST", body: JSON.stringify(body) });
  if (!result.id || !result.paymentUrl) throw new LavaError("lava.top did not return a payment link", 502);
  return { contractId: result.id, paymentUrl: result.paymentUrl };
}

/* Вебхук: lava.top кладёт в X-Api-Key ту строку, что указана в его настройках. */
export function lavaWebhookAuthorized(header: string | null) {
  const expected = process.env.LAVA_WEBHOOK_KEY ?? "";
  const supplied = header ?? "";
  if (expected.length < 20 || expected.length !== supplied.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(supplied));
}

export type LavaWebhook = {
  eventType?: string;
  event_type?: string;
  contractId?: string;
  parentContractId?: string | null;
  amount?: number;
  currency?: string;
  status?: string;
  errorMessage?: string | null;
  buyer?: { email?: string };
  product?: { id?: string; title?: string };
  data?: Record<string, unknown>;
};
