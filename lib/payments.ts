import "server-only";
import { randomUUID } from "node:crypto";
import { verifyProviderPayment } from "@/lib/payment-verification";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { callModelService } from "@/lib/model-service";
import { isRealEmail, mailLocale, sendSiteMail, siteUrl } from "@/lib/mail";
import { parsePixelHeaderArt, hasPixelHeaderArt } from "@/lib/profile-header-art";
import { queueCelebration } from "@/lib/plus-celebration";
import type { ViewerAccess } from "@/lib/viewer-stage";
import { asTier, TIER_LABEL, TIER_NAME, type PlusTier } from "@/lib/plus-style";
import {
  createYooPayment,
  getYooPayment,
  paymentMethodTitle,
  YooKassaError,
  yookassaConfigured,
  yookassaTestMode,
  type YooPayment,
} from "@/lib/yookassa";
import { createLavaInvoice, LavaError, lavaConfigured, lavaOfferKey, LAVA_OFFERS, lavaPrice, lavaPublic, type LavaCurrency, type LavaWebhook } from "@/lib/lava";

/* Пропуск POPPERSCRAFT и подписка в двух тарифах — PLUS и HYPE.

   - Пропуск платят после одобрения анкеты. Пока владелец не включил
     «пропуск обязателен», доступ к серверу даёт одобренная анкета; при
     включении все уже одобренные игроки получают пропуск бесплатно.
     Первооткрыватели и первые 10 игроков получают его сразу (см. внизу).
   - Подписка — месяц или год косметики. Время подписки — два отрезка
     подряд: сначала HYPE (до hype_until), потом PLUS (до current_period_end).
     HYPE встаёт в конец отрезка HYPE и сдвигает дни PLUS, PLUS добавляется
     в самый конец (sql/r078_tier_segments.sql).
   - При оплате месяца карта сохраняется, если игрок согласился на
     автосписание; дальше сервер сам списывает цену тарифа этой карты
     (renew_tier), когда заканчивается именно он. Год — без автопродления.
   - «Косметика только с подпиской» включается отдельно; у тех, кто уже
     настроил пони или шапку, они остаются (pc_plus_legacy). */

export const PRICES = { pass: 499, plus: 199 } as const;
export type PaymentKind = keyof typeof PRICES;

/* Два тарифа подписки: PLUS — оформление на сайте, HYPE — всё из PLUS
   и то, что видно в игре. Год — 12 месяцев одним платежом со скидкой. */
export const TIER_PRICES: Record<PlusTier, number> = { plus: PRICES.plus, hype: 599 };
export const YEAR_DISCOUNT = 20;
export const yearPrice = (monthly: number) => Math.round((monthly * 12 * (100 - YEAR_DISCOUNT)) / 100);
export type PaymentPlan = "month" | "year";
export const PLANS: PaymentPlan[] = ["month", "year"];

export function basePrice(kind: PaymentKind, plan: PaymentPlan = "month", tier: PlusTier = "plus") {
  if (kind === "pass") return PRICES.pass;
  return plan === "year" ? yearPrice(TIER_PRICES[tier]) : TIER_PRICES[tier];
}

/* Цена со скидкой промокода — не меньше рубля, ЮKassa нулевых платежей не принимает. */
export function priceWithDiscount(amount: number, discount: number) {
  if (!discount) return amount;
  return Math.max(1, Math.round((amount * (100 - discount)) / 100));
}

export type PaymentPrices = {
  pass: number;
  plus: number;
  hype: number;
  /* Цена года одним платежом и размер скидки в процентах. */
  plusYear: number;
  hypeYear: number;
  yearDiscount: number;
};

export const paymentPrices = (): PaymentPrices => ({
  pass: PRICES.pass,
  plus: TIER_PRICES.plus,
  hype: TIER_PRICES.hype,
  plusYear: yearPrice(TIER_PRICES.plus),
  hypeYear: yearPrice(TIER_PRICES.hype),
  yearDiscount: YEAR_DISCOUNT,
});

export type PaymentRow = {
  id: string;
  user_id: string;
  login: string;
  kind: PaymentKind;
  amount: number;
  status: "created" | "pending" | "waiting_for_capture" | "succeeded" | "canceled" | "failed";
  provider_payment_id: string | null;
  /* yookassa или lava; у lava сумма — в валюте currency. */
  provider: string;
  currency: string;
  recurring: boolean;
  save_method_requested: boolean;
  payment_method_id: string | null;
  payment_method_title: string | null;
  cancellation_reason: string | null;
  test: boolean;
  applied_at: string | null;
  paid_at: string | null;
  created_at: string;
  updated_at: string;
  /* Подарок PLUS: платит user_id, подписку получает recipient_id. */
  recipient_id: string | null;
  recipient_login: string | null;
  /* Срок подписки (месяц или год), тариф и промокод с его скидкой. */
  plan: PaymentPlan;
  tier: PlusTier;
  promo_code: string | null;
  discount: number;
};
type SubscriptionRow = {
  user_id: string;
  login: string;
  /* Конец всей подписки (последний день PLUS или HYPE). */
  current_period_end: string;
  /* Конец отрезка HYPE; дальше до current_period_end идёт PLUS. */
  hype_until: string | null;
  /* Тариф, на который игрок сохранил карту, — его и продлевает автосписание. */
  renew_tier: PlusTier;
  hype_handled_at: string | null;
  reminded_for: string | null;
  stashed: { pony?: boolean; headerArt?: boolean } | null;
  auto_renew: boolean;
  payment_method_id: string | null;
  payment_method_title: string | null;
  failed_attempts: number;
  next_attempt_at: string | null;
  last_payment_id: string | null;
  expired_handled_at: string | null;
  canceled_at: string | null;
};
export type PaymentSettings = {
  payments_enabled: boolean;
  pass_required_since: string | null;
  plus_required_since: string | null;
  updated_at: string;
  updated_by: string | null;
};

const OPEN_STATUSES = ["created", "pending", "waiting_for_capture"];
const RETRY_HOURS = [24, 48, 72];

export class PaymentError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

const db = () => createSupabaseAdminClient();

export async function getPaymentSettings(): Promise<PaymentSettings> {
  const { data, error } = await db().from("pc_payment_settings").select("*").eq("id", true).maybeSingle();
  if (error || !data) {
    if (error) console.error("Payment settings read failed", error.message);
    return { payments_enabled: false, pass_required_since: null, plus_required_since: null, updated_at: new Date(0).toISOString(), updated_by: null };
  }
  return data as PaymentSettings;
}

export function paymentsAvailable(settings: PaymentSettings) {
  return settings.payments_enabled && yookassaConfigured();
}

type Application = { user_id: string; login: string; status: string; is_banned: boolean; is_deleted: boolean };

async function applicationFor(userId: string) {
  const { data, error } = await db().from("waitlist_applications")
    .select("user_id,login,status,is_banned,is_deleted")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data as Application | null;
}

const isApprovedApplication = (application: Application | null) =>
  Boolean(application && application.status === "approved" && !application.is_banned && !application.is_deleted);

/* ---- права ------------------------------------------------------------- */

/* pioneer — первооткрыватель (играл до запуска оплаты), founder — один из
   первых 10 игроков после запуска; оба — таблица pc_early_players. */
export type PassSource = "payment" | "legacy" | "admin" | "founder" | "pioneer";

async function passRow(userId: string) {
  const { data, error } = await db().from("pc_access_passes").select("source,granted_at").eq("user_id", userId).maybeSingle();
  if (error) throw error;
  return data as { source: PassSource; granted_at: string } | null;
}

export type EarlyKind = "pioneer" | "founder";

type EarlyPlayerRow = {
  user_id: string;
  login: string;
  kind: EarlyKind;
  position: number;
  approved_at: string | null;
  plus_gift_from: string | null;
  plus_gift_until: string | null;
  plus_granted_at: string | null;
  plus_granted_by: string | null;
  plus_revoked_at: string | null;
};

/* Первооткрыватели и первая десятка — дополнительная отметка: сбой чтения
   не должен ломать оплату. */
async function earlyPlayerRow(userId: string) {
  const { data, error } = await db().from("pc_early_players").select("*").eq("user_id", userId).is("released_at", null).maybeSingle();
  if (error) {
    console.error("Early player lookup failed", error.message);
    return null;
  }
  return data as EarlyPlayerRow | null;
}

const giftActive = (early: EarlyPlayerRow | null) =>
  Boolean(early?.plus_gift_until && Date.parse(early.plus_gift_until) > Date.now());

async function subscriptionRow(userId: string) {
  const { data, error } = await db().from("pc_plus_subscriptions").select("*").eq("user_id", userId).maybeSingle();
  if (error) throw error;
  return data as SubscriptionRow | null;
}

async function legacyRow(userId: string) {
  const { data, error } = await db().from("pc_plus_legacy").select("pony,header_art").eq("user_id", userId).maybeSingle();
  if (error) throw error;
  return data as { pony: boolean; header_art: boolean } | null;
}

const plusActive = (subscription: SubscriptionRow | null) =>
  Boolean(subscription && Date.parse(subscription.current_period_end) > Date.now());

/* Сейчас идёт отрезок HYPE. */
const hypeActive = (subscription: SubscriptionRow | null) =>
  Boolean(subscription?.hype_until && Date.parse(subscription.hype_until) > Date.now());

/* Тариф прямо сейчас: HYPE, пока идёт его отрезок, дальше PLUS. */
const subscriptionTier = (subscription: SubscriptionRow | null): PlusTier => (hypeActive(subscription) ? "hype" : "plus");

const renewTierOf = (subscription: SubscriptionRow | null): PlusTier => asTier(subscription?.renew_tier);

/* Когда автосписанию пора продлевать: конец отрезка своего тарифа. */
const renewalDue = (subscription: SubscriptionRow) =>
  renewTierOf(subscription) === "hype" ? subscription.hype_until ?? subscription.current_period_end : subscription.current_period_end;

/* Подписка действует и продлится сама. Если последнее автосписание не
   прошло, игрок может продлить вручную — иначе подписка просто закончится. */
const plusRenewsItself = (subscription: SubscriptionRow | null) =>
  Boolean(subscription && plusActive(subscription) && subscription.auto_renew && subscription.payment_method_id && subscription.failed_attempts === 0);

const longDate = (value: string) =>
  new Intl.DateTimeFormat("ru-RU", { dateStyle: "long", timeZone: "Europe/Moscow" }).format(new Date(value));

/* Пропуск продаётся только тогда, когда он нужен: владелец включил
   «пропуск обязателен», а у одобренного игрока его нет. Пока пропуск не
   обязателен, доступ открыт всем одобренным, а при включении старым
   игрокам пропуск выдаётся бесплатно — платить было бы не за что.
   Исключение — администратор в тестовом магазине: ему нужно проверить
   оплату пропуска. */
function passForSale(input: { approved: boolean; hasPass: boolean; settings: PaymentSettings; isAdmin?: boolean }) {
  if (!input.approved || input.hasPass) return false;
  return Boolean(input.settings.pass_required_since) || (yookassaTestMode() && Boolean(input.isAdmin));
}

/* Доступ к игровому серверу: одобренная анкета и, если владелец это включил, пропуск.
   При сбое чтения пропусков доступ не отбираем — игроков не выкидывает из-за базы. */
export async function hasServerAccess(userId: string, settings?: PaymentSettings) {
  const current = settings ?? await getPaymentSettings();
  if (!current.pass_required_since) return true;
  try {
    return Boolean(await passRow(userId));
  } catch (error) {
    console.error("Pass lookup failed", error);
    return true;
  }
}

export type Cosmetic = "pony" | "header_art";

export async function canUseCosmetic(userId: string, cosmetic: Cosmetic, settings?: PaymentSettings) {
  const current = settings ?? await getPaymentSettings();
  if (!current.plus_required_since) return true;
  try {
    const [subscription, legacy] = await Promise.all([subscriptionRow(userId), legacyRow(userId)]);
    /* Пони — возможность HYPE; шапку профиля даёт любая подписка. Тем, кто
       настроил их до запуска подписки, они остаются бесплатно. */
    if (legacy?.[cosmetic]) return true;
    return cosmetic === "pony" ? hypeActive(subscription) : plusActive(subscription);
  } catch (error) {
    console.error("Cosmetics lookup failed", error);
    return true;
  }
}

/* ---- сводка для игрока --------------------------------------------------- */

export type PaymentSummary = {
  available: boolean;
  /* Оплата картой не из России через lava.top (r103). */
  lava: boolean;
  test: boolean;
  prices: PaymentPrices;
  approved: boolean;
  passRequired: boolean;
  hasPass: boolean;
  passSource: PassSource | null;
  serverAccess: boolean;
  /* Можно ли этому игроку сейчас купить пропуск (см. passForSale). */
  passForSale: boolean;
  plusRequired: boolean;
  /* until — конец всей подписки, hypeUntil — конец отрезка HYPE (после него
     до until идёт PLUS), tier — тариф прямо сейчас, renewTier — тариф
     автопродления, renewsAt — когда оно спишет оплату. gift — сейчас идёт
     подаренный администрацией год PLUS. */
  plus: {
    active: boolean;
    until: string | null;
    hypeUntil: string | null;
    tier: PlusTier;
    renewTier: PlusTier;
    renewsAt: string | null;
    autoRenew: boolean;
    renewsItself: boolean;
    card: string | null;
    failedAttempts: number;
    gift: boolean;
  } | null;
  /* Первооткрыватель или один из первых 10 игроков. */
  early: { kind: EarlyKind; position: number; plusGiftUntil: string | null } | null;
  legacy: { pony: boolean; headerArt: boolean };
  /* recipientLogin — PLUS, оплаченный в подарок другому игроку. */
  history: Array<{ id: string; kind: PaymentKind; amount: number; status: PaymentRow["status"]; recurring: boolean; plan: PaymentPlan; tier: PlusTier; created_at: string; paid_at: string | null; recipientLogin: string | null }>;
  /* Месяцы PLUS, которые подарили этому игроку друзья. */
  giftsReceived: Array<{ from: string; at: string }>;
};

/* Короткая сводка для главной: что показывать на кнопках (lib/viewer-stage.ts).
   Для гостя userId = null. */
export async function viewerAccess(userId: string | null, options: { isAdmin?: boolean } = {}): Promise<ViewerAccess> {
  const settings = await getPaymentSettings();
  const base = {
    passRequired: Boolean(settings.pass_required_since),
    paymentsOpen: paymentsAvailable(settings) && (!yookassaTestMode() || Boolean(options.isAdmin)),
    test: yookassaTestMode(),
  };
  if (!userId) return { ...base, approved: false, serverAccess: false, passForSale: false, plus: null };
  const [application, pass, subscription] = await Promise.all([applicationFor(userId), passRow(userId), subscriptionRow(userId)]);
  const approved = isApprovedApplication(application);
  return {
    ...base,
    approved,
    serverAccess: approved && (!settings.pass_required_since || Boolean(pass)),
    passForSale: passForSale({ approved, hasPass: Boolean(pass), settings, isAdmin: options.isAdmin }),
    plus: subscription ? {
      active: plusActive(subscription),
      renewsItself: plusRenewsItself(subscription),
      tier: subscriptionTier(subscription),
      renewTier: renewTierOf(subscription),
    } : null,
  };
}

export async function paymentSummary(userId: string, options: { isAdmin?: boolean } = {}): Promise<PaymentSummary> {
  const settings = await getPaymentSettings();
  const [application, pass, subscriptionFound, legacy, history, early, gifts] = await Promise.all([
    applicationFor(userId),
    passRow(userId),
    subscriptionRow(userId),
    legacyRow(userId),
    db().from("pc_payments")
      .select("id,kind,amount,status,recurring,plan,tier,created_at,paid_at,recipient_login")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(24),
    earlyPlayerRow(userId),
    db().from("pc_payments")
      .select("login,paid_at,created_at")
      .eq("recipient_id", userId)
      .eq("status", "succeeded")
      .not("applied_at", "is", null)
      .order("created_at", { ascending: false })
      .limit(24),
  ]);
  if (history.error) throw history.error;
  if (gifts.error) console.error("Received gifts lookup failed", gifts.error.message);
  const approved = isApprovedApplication(application);
  /* Подарок отменили, а сам игрок не платил — подписки у него по сути не было. */
  const subscription = subscriptionFound && !subscriptionFound.last_payment_id && early?.plus_revoked_at && !plusActive(subscriptionFound)
    ? null
    : subscriptionFound;
  return {
    available: paymentsAvailable(settings) && (!yookassaTestMode() || Boolean(options.isAdmin)),
    lava: paymentsAvailable(settings) && (lavaPublic() || (Boolean(options.isAdmin) && lavaConfigured())),
    test: yookassaTestMode(),
    prices: paymentPrices(),
    approved,
    passRequired: Boolean(settings.pass_required_since),
    hasPass: Boolean(pass),
    passSource: pass?.source ?? null,
    serverAccess: approved && (!settings.pass_required_since || Boolean(pass)),
    passForSale: passForSale({ approved, hasPass: Boolean(pass), settings, isAdmin: options.isAdmin }),
    plusRequired: Boolean(settings.plus_required_since),
    plus: subscription ? {
      active: plusActive(subscription),
      until: subscription.current_period_end,
      hypeUntil: hypeActive(subscription) ? subscription.hype_until : null,
      tier: subscriptionTier(subscription),
      renewTier: renewTierOf(subscription),
      renewsAt: subscription.auto_renew && subscription.payment_method_id ? renewalDue(subscription) : null,
      autoRenew: subscription.auto_renew && Boolean(subscription.payment_method_id),
      renewsItself: plusRenewsItself(subscription),
      card: subscription.payment_method_id ? subscription.payment_method_title : null,
      failedAttempts: subscription.failed_attempts,
      gift: plusActive(subscription) && giftActive(early),
    } : null,
    early: early ? { kind: early.kind, position: early.position, plusGiftUntil: giftActive(early) ? early.plus_gift_until : null } : null,
    legacy: { pony: Boolean(legacy?.pony), headerArt: Boolean(legacy?.header_art) },
    history: ((history.data ?? []) as Array<Omit<PaymentSummary["history"][number], "recipientLogin"> & { recipient_login: string | null }>)
      .map(({ recipient_login, ...row }) => ({ ...row, amount: Number(row.amount), recipientLogin: recipient_login })),
    giftsReceived: ((gifts.data ?? []) as Array<{ login: string; paid_at: string | null; created_at: string }>)
      .map((row) => ({ from: row.login, at: row.paid_at ?? row.created_at })),
  };
}

/* ---- создание платежа ---------------------------------------------------- */

function description(kind: PaymentKind, login: string, recurring = false, giftTo: string | null = null, plan: PaymentPlan = "month", tier: PlusTier = "plus") {
  if (kind === "pass") return `Пропуск POPPERSCRAFT: доступ к серверу для ${login}`;
  const term = plan === "year" ? "1 год" : "1 месяц";
  const name = tier === "hype" ? "POPPERS HYPE" : "POPPERS+";
  if (giftTo) return `${name} на ${term} в подарок для ${giftTo} от ${login}`;
  return `${name} на ${term} для ${login}${recurring ? " (автопродление)" : ""}`;
}

/* Получатель подарка: одобренный игрок, не сам даритель; если пропуск
   обязателен — с пропуском (подписка надевается поверх него). */
async function giftRecipient(rawLogin: string, payerId: string, settings: PaymentSettings) {
  const login = rawLogin.trim().toLowerCase().replace(/^@/, "");
  if (!/^[a-z0-9_.-]{3,32}$/.test(login)) throw new PaymentError("Укажите ник игрока, которому дарите подписку.", 400);
  const { data, error } = await db().from("waitlist_applications")
    .select("user_id,login,status,is_banned,is_deleted")
    .eq("login", login)
    .eq("is_deleted", false)
    .not("user_id", "is", null)
    .limit(1);
  if (error) throw error;
  const application = (data?.[0] ?? null) as Application | null;
  if (!application || !isApprovedApplication(application)) throw new PaymentError("Такого игрока на сервере нет — подарить подписку можно только одобренному игроку.", 404);
  if (application.user_id === payerId) throw new PaymentError("Себе подписка оформляется обычной оплатой, без подарка.", 409);
  if (settings.pass_required_since && !(await passRow(application.user_id))) {
    throw new PaymentError(`У @${application.login} пока нет пропуска POPPERSCRAFT — подписка надевается поверх него.`, 409);
  }
  return { id: application.user_id, login: application.login };
}

async function insertPayment(row: Partial<PaymentRow> & Pick<PaymentRow, "user_id" | "login" | "kind" | "amount">) {
  const { data, error } = await db().from("pc_payments").insert({ ...row, test: yookassaTestMode() }).select("*").single();
  if (error || !data) throw error ?? new Error("payment-insert-failed");
  return data as PaymentRow;
}

async function updatePayment(id: string, patch: Partial<PaymentRow>) {
  const { data, error } = await db().from("pc_payments")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single();
  if (error || !data) throw error ?? new Error("payment-update-failed");
  return data as PaymentRow;
}

function mapStatus(payment: YooPayment): PaymentRow["status"] {
  return payment.status;
}

function providerPatch(payment: YooPayment, row: PaymentRow): Partial<PaymentRow> {
  verifyProviderPayment(row, payment);
  const method = payment.payment_method;
  const saved = Boolean(method?.saved && method.id);
  return {
    // Missing provider test information must never qualify for a real reward.
    test: row.test || payment.test !== false,
    provider_payment_id: payment.id,
    status: mapStatus(payment),
    payment_method_id: saved ? method!.id : null,
    payment_method_title: saved ? paymentMethodTitle(payment) : null,
    cancellation_reason: payment.cancellation_details?.reason?.slice(0, 80) ?? null,
    paid_at: payment.status === "succeeded" ? (payment.captured_at ?? new Date().toISOString()) : null,
  };
}

export async function startPayment(input: {
  userId: string;
  kind: PaymentKind;
  autoRenew: boolean;
  isAdmin?: boolean;
  giftTo?: string | null;
  /* Подписка сразу на год — одним платежом и без автопродления. */
  term?: PaymentPlan;
  /* Тариф подписки: plus или hype. */
  tier?: PlusTier | string | null;
  promo?: string | null;
  /* lava — карта не из России (lava.top), валюта счёта. */
  provider?: "yookassa" | "lava";
  currency?: LavaCurrency;
  language?: "RU" | "EN";
}) {
  const settings = await getPaymentSettings();
  const lava = input.provider === "lava";
  if (!paymentsAvailable(settings)) throw new PaymentError("Оплата сейчас закрыта.", 503);
  if (lava) {
    if (!lavaConfigured() || (!lavaPublic() && !input.isAdmin)) throw new PaymentError("Оплата картой не из России пока недоступна.", 503);
    if (input.giftTo) throw new PaymentError("Подарок картой не из России пока не оформить — только себе.", 400);
    if (input.promo) throw new PaymentError("Промокоды работают только при оплате российской картой.", 400);
  } else if (yookassaTestMode() && !input.isAdmin) {
    /* Тестовый магазин: платить тестовыми картами могут только администраторы. */
    throw new PaymentError("Оплата пока проверяется администрацией.", 503);
  }
  const application = await applicationFor(input.userId);
  if (!isApprovedApplication(application)) {
    throw new PaymentError("Оплатить можно после одобрения анкеты. Сначала подайте заявку в лист ожидания.", 403);
  }
  const login = application!.login;
  if (input.giftTo && input.kind !== "plus") throw new PaymentError("В подарок можно оформить только подписку.", 400);
  const recipient = input.giftTo ? await giftRecipient(input.giftTo, input.userId, settings) : null;
  const [pass, subscription] = await Promise.all([passRow(input.userId), subscriptionRow(input.userId)]);
  if (input.kind === "pass") {
    if (pass) throw new PaymentError("Пропуск у вас уже есть.", 409);
    if (!passForSale({ approved: true, hasPass: false, settings, isAdmin: input.isAdmin })) {
      throw new PaymentError("Сейчас пропуск не нужен: доступ к серверу у вас уже открыт. Если пропуск станет обязательным, вы получите его бесплатно.", 409);
    }
  }

  /* Срок: год бывает только у подписки и всегда без автопродления. */
  const term: PaymentPlan = input.kind === "plus" && input.term === "year" ? "year" : "month";
  const tier: PlusTier = input.kind === "plus" ? asTier(input.tier) : "plus";

  /* Своя подписка надевается поверх своего пропуска; подарок проверяет пропуск получателя. */
  if (input.kind === "plus" && !recipient) {
    if (settings.pass_required_since && !pass) throw new PaymentError("Подписка оформляется поверх пропуска: сначала оплатите пропуск POPPERSCRAFT.", 409);
    /* PLUS целиком входит в HYPE: пока HYPE идёт, покупать PLUS незачем. */
    if (tier === "plus" && hypeActive(subscription)) {
      throw new PaymentError(`У вас HYPE до ${longDate(subscription!.hype_until!)} — в него уже входит всё из PLUS. PLUS можно будет оформить, когда HYPE закончится.`, 409);
    }
    /* Тот же тариф уже продлевается сам — второй месяц сверху не нужен.
       Переход с PLUS на HYPE и оплата года разрешены всегда. */
    if (term === "month" && plusRenewsItself(subscription) && renewTierOf(subscription) === tier && (tier === "plus" || hypeActive(subscription))) {
      throw new PaymentError(`${TIER_LABEL[tier]} уже оформлен и продлевается сам. Управлять им можно в «Профиль → Подписка».`, 409);
    }
  }

  const amountBefore = basePrice(input.kind, term, tier);
  /* У годовой подписки и у подарка карта не сохраняется: платёж разовый. */
  const saveMethod = input.kind === "plus" && term === "month" && input.autoRenew && !recipient;
  const promoCode = input.promo ? normalizePromo(input.promo) : "";
  /* Для промокода покупка — пропуск, PLUS или HYPE. */
  const promoKind: PromoKind = input.kind === "pass" ? "pass" : tier;

  if (lava) return startLavaPayment({ userId: input.userId, login, kind: input.kind, term, tier, currency: input.currency ?? "USD", language: input.language ?? "EN" });

  /* Незавершённый такой же платёж (вид, тариф, срок, получатель, промокод)
     за последние 30 минут — ведём игрока туда же. Если ЮKassa его уже
     закрыла, сверяем: так освобождается занятая им активация промокода. */
  const since = new Date(Date.now() - 30 * 60_000).toISOString();
  let openQuery = db().from("pc_payments")
    .select("*")
    .eq("user_id", input.userId)
    .eq("kind", input.kind)
    .eq("tier", tier)
    .eq("recurring", false)
    .eq("plan", term)
    .eq("provider", "yookassa")
    .in("status", ["created", "pending"])
    .gte("created_at", since);
  openQuery = recipient ? openQuery.eq("recipient_id", recipient.id) : openQuery.is("recipient_id", null);
  openQuery = promoCode ? openQuery.eq("promo_code", promoCode) : openQuery.is("promo_code", null);
  const { data: open } = await openQuery.order("created_at", { ascending: false }).limit(1);
  const reusable = (open?.[0] ?? null) as PaymentRow | null;
  if (reusable?.provider_payment_id && reusable.save_method_requested === saveMethod
    && Number(reusable.amount) === priceWithDiscount(amountBefore, reusable.discount)) {
    const current = await getYooPayment(reusable.provider_payment_id).catch(() => null);
    if (current?.status === "pending" && current.confirmation?.confirmation_url) {
      return { paymentId: reusable.id, confirmationUrl: current.confirmation.confirmation_url };
    }
    if (current) await syncPayment(reusable).catch(() => null);
  }

  /* Промокод сначала проверяем, а занимаем — уже под созданный платёж. */
  const promo = promoCode ? await checkPromo(promoCode, input.userId, promoKind) : null;
  const amount = priceWithDiscount(amountBefore, promo?.discount ?? 0);

  let row = await insertPayment({
    user_id: input.userId,
    login,
    kind: input.kind,
    amount,
    plan: term,
    tier,
    promo_code: promo?.code ?? null,
    discount: promo?.discount ?? 0,
    save_method_requested: saveMethod,
    recipient_id: recipient?.id ?? null,
    recipient_login: recipient?.login ?? null,
  });
  /* Активация занимается здесь: если код разобрали, пока игрок думал,
     платёж дальше не пойдёт. */
  if (promo) {
    try {
      await reservePromo(promo.code, input.userId, login, row.id, promoKind);
    } catch (error) {
      await updatePayment(row.id, { status: "failed", cancellation_reason: "promo_failed" }).catch(() => null);
      throw error;
    }
  }
  const request = (save: boolean, key: string) => createYooPayment({
    amount,
    description: description(input.kind, login, false, recipient?.login ?? null, term, tier),
    metadata: { payment_id: row.id, kind: input.kind, login, plan: term, tier, ...(recipient ? { gift_to: recipient.login } : {}) },
    returnUrl: `${siteUrl()}/donation/return?payment=${row.id}`,
    savePaymentMethod: save,
  }, key);

  const create = async (): Promise<YooPayment> => {
    try {
      return await request(saveMethod, row.id);
    } catch (error) {
      /* Автоплатежи в магазине не включены — принимаем обычную оплату без сохранения карты. */
      const refusedToSave = saveMethod && error instanceof YooKassaError && error.status < 500
        && (error.parameter.includes("save_payment_method") || error.code === "forbidden");
      if (!refusedToSave) throw error;
      console.error("YooKassa refused to save the payment method; retrying without it");
      row = await updatePayment(row.id, { save_method_requested: false });
      return request(false, randomUUID());
    }
  };
  let payment: YooPayment;
  try {
    payment = await create();
  } catch (error) {
    await updatePayment(row.id, { status: "failed", cancellation_reason: "create_failed" }).catch(() => null);
    if (promo) await releasePromo(row.id);
    throw providerFailure(error);
  }
  await updatePayment(row.id, providerPatch(payment, row));
  const url = payment.confirmation?.confirmation_url;
  if (!url) throw new PaymentError("ЮKassa не вернула ссылку на оплату. Попробуйте ещё раз.", 502);
  return { paymentId: row.id, confirmationUrl: url };
}

function providerFailure(error: unknown) {
  if (error instanceof YooKassaError) {
    console.error("YooKassa request failed", { status: error.status, code: error.code, parameter: error.parameter, message: error.message });
    return new PaymentError("Не получилось создать платёж в ЮKassa. Попробуйте позже или напишите в @PoppersCraftAuthBot.", 502);
  }
  console.error("Payment creation crashed", error);
  return new PaymentError("Не получилось создать платёж. Попробуйте позже.", 500);
}

/* ---- lava.top: карты не из России (r103) ---------------------------------- */

async function startLavaPayment(input: { userId: string; login: string; kind: PaymentKind; term: PaymentPlan; tier: PlusTier; currency: LavaCurrency; language: "RU" | "EN" }) {
  const offerId = LAVA_OFFERS[lavaOfferKey(input.kind === "pass" ? "pass" : "plus", input.term, input.tier)];
  const [{ data: auth }, amount] = await Promise.all([
    db().auth.admin.getUserById(input.userId),
    lavaPrice(offerId, input.currency).catch((error) => { throw lavaFailure(error); }),
  ]);
  const email = auth?.user?.email ?? "";
  if (!email) throw new PaymentError("Для оплаты картой не из России нужна почта в аккаунте: «Профиль → Настройки → Аккаунт и почта».", 409);
  const { data, error } = await db().from("pc_payments").insert({
    user_id: input.userId,
    login: input.login,
    kind: input.kind,
    amount,
    currency: input.currency,
    provider: "lava",
    plan: input.term,
    tier: input.tier,
    test: false,
  }).select("*").single();
  if (error || !data) throw error ?? new Error("payment-insert-failed");
  const row = data as PaymentRow;
  try {
    const invoice = await createLavaInvoice({ email, offerId, currency: input.currency, language: input.language, returnUrl: `${siteUrl()}/donation/return?payment=${row.id}` });
    await updatePayment(row.id, { provider_payment_id: invoice.contractId, status: "pending" });
    return { paymentId: row.id, confirmationUrl: invoice.paymentUrl };
  } catch (caught) {
    await updatePayment(row.id, { status: "failed", cancellation_reason: "create_failed" }).catch(() => null);
    throw lavaFailure(caught);
  }
}

function lavaFailure(error: unknown) {
  if (error instanceof PaymentError) return error;
  console.error("lava.top request failed", error instanceof LavaError ? { status: error.status, message: error.message } : error);
  return new PaymentError("Не получилось создать платёж в lava.top. Попробуйте позже или напишите в @PoppersCraftAuthBot.", 502);
}

async function lavaRow(contractId: string) {
  const { data, error } = await db().from("pc_payments").select("*").eq("provider", "lava").eq("provider_payment_id", contractId).maybeSingle();
  if (error) throw error;
  return (data ?? null) as PaymentRow | null;
}

/* Вебхук lava.top: оплата, неудача, продление подписки, отмена, возврат. */
export async function handleLavaWebhook(event: LavaWebhook) {
  const type = event.eventType ?? event.event_type ?? "";
  const contractId = typeof event.contractId === "string" ? event.contractId : "";
  const now = new Date().toISOString();
  if (type === "payment.success" && contractId) {
    const row = await lavaRow(contractId);
    if (!row) return "unknown-contract";
    if (row.status !== "succeeded") {
      const updated = await updatePayment(row.id, { status: "succeeded", paid_at: now, ...(typeof event.amount === "number" ? { amount: event.amount } : {}) });
      return applyPayment(updated);
    }
    return row.applied_at ? "already" : applyPayment(row);
  }
  if (type === "payment.failed" && contractId) {
    const row = await lavaRow(contractId);
    if (row && OPEN_STATUSES.includes(row.status)) await updatePayment(row.id, { status: "failed", cancellation_reason: String(event.errorMessage ?? "failed").slice(0, 80) });
    return "failed";
  }
  if (type === "subscription.recurring.payment.success" && contractId && event.parentContractId) {
    if (await lavaRow(contractId)) return "already";
    const parent = await lavaRow(event.parentContractId);
    if (!parent) return "unknown-parent";
    const { data, error } = await db().from("pc_payments").insert({
      user_id: parent.user_id,
      login: parent.login,
      kind: parent.kind,
      amount: typeof event.amount === "number" ? event.amount : parent.amount,
      currency: event.currency ?? parent.currency,
      provider: "lava",
      provider_payment_id: contractId,
      plan: parent.plan,
      tier: parent.tier,
      recurring: true,
      status: "succeeded",
      paid_at: now,
      test: false,
    }).select("*").single();
    if (error || !data) throw error ?? new Error("payment-insert-failed");
    return applyPayment(data as PaymentRow);
  }
  /* Продление не прошло или подписку отменили в lava.top: время просто
     закончится в свой срок. Возврат и чарджбэк администрация смотрит сама. */
  console.info("lava.top webhook", { type, contractId, status: event.status ?? null });
  return "noted";
}

/* ---- сверка с ЮKassa ----------------------------------------------------- */

async function applyPayment(row: PaymentRow) {
  const { data, error } = await db().rpc("pc_apply_payment", { p_payment: row.id });
  if (error) throw error;
  const result = String(data);
  if (result === "recipient-missing") console.error("PLUS gift recipient is gone; refund needed", { payment: row.id });
  if (result === "applied" && row.kind === "plus") {
    await restoreCosmetics(row.recipient_id ?? row.user_id);
    if (row.recipient_id) {
      const tier = asTier(row.tier);
      const months = row.plan === "year" ? 12 : 1;
      await notifyGiftReceived(row.recipient_id, row.recipient_login ?? "", row.login, tier, months);
      /* Подарок встречает игрока торжественным окном при следующем заходе:
         с тарифом подарка и датой, до которой он действует. */
      const after = await subscriptionRow(row.recipient_id).catch(() => null);
      const until = tier === "hype" ? after?.hype_until : after?.current_period_end;
      await queueCelebration(row.recipient_id, { kind: "gift", from: row.login, months, tier, until: until ?? null });
    }
  }
  if (row.kind === "pass" && (result === "applied" || row.applied_at)) {
    // The database has already granted HYPE atomically. Restore any cosmetics
    // stashed when the inviter's previous subscription expired.
    try {
      const { data: reward, error: rewardError } = await db().from("pc_referrals")
        .select("inviter_user_id").eq("reward_payment_id", row.id).not("rewarded_at", "is", null).maybeSingle();
      if (rewardError) throw rewardError;
      if (reward?.inviter_user_id) await restoreCosmetics(String(reward.inviter_user_id));
    } catch (error) {
      console.error("Referral cosmetics restore failed", error instanceof Error ? error.message : error);
    }
  }
  return result;
}

/* Отмена автоплатежа из-за отозванного разрешения — карту больше не трогаем. */
async function handleRecurringCancel(row: PaymentRow) {
  const revoked = row.cancellation_reason === "permission_revoked";
  const subscription = await subscriptionRow(row.user_id);
  if (!subscription) return;
  const attempts = subscription.failed_attempts + 1;
  const giveUp = revoked || attempts >= RETRY_HOURS.length;
  await db().from("pc_plus_subscriptions").update({
    failed_attempts: attempts,
    next_attempt_at: giveUp ? null : new Date(Date.now() + RETRY_HOURS[attempts - 1] * 3_600_000).toISOString(),
    auto_renew: giveUp ? false : subscription.auto_renew,
    payment_method_id: revoked ? null : subscription.payment_method_id,
    updated_at: new Date().toISOString(),
  }).eq("user_id", row.user_id);
  if (giveUp) await notifyRenewalFailed(row.user_id, row.login, renewTierOf(subscription), subscription);
}

export async function syncPayment(row: PaymentRow) {
  /* Платёж lava.top обновляет вебхук; ЮKassa о нём ничего не знает. */
  if (row.provider && row.provider !== "yookassa") {
    if (row.status === "succeeded" && !row.applied_at) await applyPayment(row);
    return row;
  }
  if (!row.provider_payment_id || !OPEN_STATUSES.includes(row.status)) {
    if (row.status === "succeeded" && !row.applied_at) await applyPayment(row);
    return row;
  }
  const payment = await getYooPayment(row.provider_payment_id);
  const before = row.status;
  const updated = await updatePayment(row.id, providerPatch(payment, row));
  if (updated.status === "succeeded") await applyPayment(updated);
  if (updated.status === "canceled" && before !== "canceled" && updated.recurring) await handleRecurringCancel(updated);
  /* Платёж отменён — активация промокода возвращается другим игрокам. */
  if (updated.promo_code && (updated.status === "canceled" || updated.status === "failed") && OPEN_STATUSES.includes(before)) {
    await releasePromo(updated.id);
  }
  return updated;
}

export async function syncProviderPayment(providerPaymentId: string) {
  const { data, error } = await db().from("pc_payments").select("*").eq("provider_payment_id", providerPaymentId).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return syncPayment(data as PaymentRow);
}

export async function paymentForUser(paymentId: string, userId: string) {
  if (!/^[0-9a-f-]{36}$/.test(paymentId)) return null;
  const { data, error } = await db().from("pc_payments").select("*").eq("id", paymentId).eq("user_id", userId).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const row = data as PaymentRow;
  if (!OPEN_STATUSES.includes(row.status) && (row.status !== "succeeded" || row.applied_at)) return row;
  try {
    return await syncPayment(row);
  } catch (error) {
    console.error("Payment sync failed", error instanceof Error ? error.message : error);
    return row;
  }
}

/* ---- управление PLUS ----------------------------------------------------- */

export async function setAutoRenew(userId: string, enabled: boolean) {
  const subscription = await subscriptionRow(userId);
  if (!subscription) throw new PaymentError("Подписка ещё не оформлена.", 404);
  if (enabled && !subscription.payment_method_id) {
    throw new PaymentError("Карта не сохранена. Оформите подписку на месяц с автопродлением.", 409);
  }
  await db().from("pc_plus_subscriptions").update({
    auto_renew: enabled,
    canceled_at: enabled ? null : new Date().toISOString(),
    failed_attempts: 0,
    next_attempt_at: null,
    updated_at: new Date().toISOString(),
  }).eq("user_id", userId);
}

/* Отвязать карту: сохранённый способ оплаты больше не используется. */
export async function forgetCard(userId: string) {
  await db().from("pc_plus_subscriptions").update({
    auto_renew: false,
    payment_method_id: null,
    payment_method_title: null,
    canceled_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("user_id", userId);
}

/* ---- регулярная работа (cron) ------------------------------------------- */

export async function chargeDueSubscriptions() {
  const settings = await getPaymentSettings();
  if (!paymentsAvailable(settings)) return { charged: 0, skipped: "payments-disabled" };
  const horizon = new Date(Date.now() + 6 * 3_600_000).toISOString();
  /* Автопродление HYPE ждёт конца отрезка HYPE, автопродление PLUS — конца
     всей подписки (подаренный или выданный HYPE сдвигает его на своё время). */
  const renewing = () => db().from("pc_plus_subscriptions")
    .select("*")
    .eq("auto_renew", true)
    .not("payment_method_id", "is", null);
  const [byEnd, byHype] = await Promise.all([
    renewing().lte("current_period_end", horizon).limit(100),
    renewing().eq("renew_tier", "hype").lte("hype_until", horizon).limit(100),
  ]);
  if (byEnd.error) throw byEnd.error;
  if (byHype.error) throw byHype.error;
  const due = new Map<string, SubscriptionRow>();
  for (const row of [...(byEnd.data ?? []), ...(byHype.data ?? [])] as SubscriptionRow[]) due.set(row.user_id, row);
  let charged = 0;
  for (const subscription of due.values()) {
    if (Date.parse(renewalDue(subscription)) > Date.parse(horizon)) continue;
    if (subscription.next_attempt_at && Date.parse(subscription.next_attempt_at) > Date.now()) continue;
    /* Сбой чтения — пропускаем до следующего запуска; выключаем автопродление,
       только если анкеты правда нет или она не одобрена. */
    const application = await applicationFor(subscription.user_id).catch(() => undefined);
    if (application === undefined) continue;
    if (!isApprovedApplication(application)) {
      await setAutoRenew(subscription.user_id, false).catch(() => null);
      continue;
    }
    /* Уже есть незавершённое автосписание — ждём его. */
    const { data: pending } = await db().from("pc_payments").select("id")
      .eq("user_id", subscription.user_id).eq("kind", "plus").eq("recurring", true)
      .in("status", OPEN_STATUSES)
      .gte("created_at", new Date(Date.now() - 24 * 3_600_000).toISOString())
      .limit(1);
    if (pending?.length) continue;
    /* Списываем по тарифу, на который игрок сохранил карту: у HYPE своя цена. */
    const renewTier = renewTierOf(subscription);
    const renewAmount = basePrice("plus", "month", renewTier);
    const row = await insertPayment({
      user_id: subscription.user_id,
      login: application!.login,
      kind: "plus",
      amount: renewAmount,
      tier: renewTier,
      recurring: true,
    });
    /* Пока ответ не пришёл, следующая попытка не раньше чем через час. */
    await db().from("pc_plus_subscriptions").update({ next_attempt_at: new Date(Date.now() + 3_600_000).toISOString() }).eq("user_id", subscription.user_id);
    try {
      const payment = await createYooPayment({
        amount: renewAmount,
        description: description("plus", application!.login, true, null, "month", renewTier),
        metadata: { payment_id: row.id, kind: "plus", login: application!.login, tier: renewTier, recurring: "1" },
        paymentMethodId: subscription.payment_method_id!,
      }, row.id);
      const updated = await updatePayment(row.id, { ...providerPatch(payment, row), payment_method_id: null, payment_method_title: null });
      if (updated.status === "succeeded") await applyPayment(updated);
      if (updated.status === "canceled") await handleRecurringCancel(updated);
      charged += 1;
    } catch (caught) {
      console.error("Recurring charge failed", caught instanceof Error ? caught.message : caught);
      const failed = await updatePayment(row.id, { status: "failed", cancellation_reason: "create_failed" }).catch(() => null);
      if (failed) await handleRecurringCancel({ ...failed, cancellation_reason: "create_failed" });
    }
  }
  return { charged };
}

export async function syncOpenPayments() {
  const { data, error } = await db().from("pc_payments")
    .select("*")
    .or("status.in.(pending,waiting_for_capture),and(status.eq.succeeded,applied_at.is.null)")
    .lte("created_at", new Date(Date.now() - 5 * 60_000).toISOString())
    .gte("created_at", new Date(Date.now() - 3 * 24 * 3_600_000).toISOString())
    .limit(50);
  if (error) throw error;
  let synced = 0;
  for (const row of (data ?? []) as PaymentRow[]) {
    try {
      await syncPayment(row);
      synced += 1;
    } catch (caught) {
      console.error("Open payment sync failed", caught instanceof Error ? caught.message : caught);
    }
  }
  return { synced };
}

const ART_STASH_KEY = "profile_header_art_plus_stash";
type Stash = { pony?: boolean; headerArt?: boolean };

/* Пони в человека: пони — возможность HYPE. true — пони был надет и снят. */
async function stashPony(login: string) {
  const profile = await callModelService(login, {}, { timeoutMs: 8_000 });
  if (profile.mode !== "pony") return false;
  await callModelService(login, { mode: "human", revision: profile.revision }, { timeoutMs: 8_000 });
  return true;
}

/* Рисунок шапки — в запас: без подписки своей шапки нет. */
async function stashHeaderArt(userId: string) {
  const { data: auth, error: authError } = await db().auth.admin.getUserById(userId);
  if (authError) throw authError;
  const metadata = auth.user?.user_metadata ?? {};
  const art = parsePixelHeaderArt(metadata.profile_header_art);
  if (!art || !hasPixelHeaderArt(art)) return false;
  const { error: updateError } = await db().auth.admin.updateUserById(userId, {
    user_metadata: { ...metadata, [ART_STASH_KEY]: art, profile_header_art: { palette: [], pixels: ".".repeat(art.pixels.length) } },
  });
  if (updateError) throw updateError;
  return true;
}

const stashOrNull = (stash: Stash) => (stash.pony || stash.headerArt ? stash : null);

/* Подписка или её отрезок HYPE закончились: косметику, которой нет в
   «старых», снимаем, но не стираем. Кончился HYPE, а дни PLUS ещё идут —
   уходит только пони. Кончилась вся подписка — ещё и рисунок шапки.
   При продлении restoreCosmetics возвращает всё как было. */
export async function handleExpiredSubscriptions() {
  const settings = await getPaymentSettings();
  if (!settings.plus_required_since) return { expired: 0, hypeEnded: 0 };
  /* Автосписание ещё может пройти, только пока оплата открыта. */
  const retrying = paymentsAvailable(settings);
  const now = new Date().toISOString();
  const [ended, hypeEnded] = await Promise.all([
    db().from("pc_plus_subscriptions").select("*")
      .lte("current_period_end", now)
      .is("expired_handled_at", null)
      .limit(50),
    db().from("pc_plus_subscriptions").select("*")
      .lte("hype_until", now)
      .gt("current_period_end", now)
      .is("hype_handled_at", null)
      .limit(50),
  ]);
  if (ended.error) throw ended.error;
  if (hypeEnded.error) throw hypeEnded.error;
  const result = { expired: 0, hypeEnded: 0 };

  for (const subscription of (hypeEnded.data ?? []) as SubscriptionRow[]) {
    /* Автосписание HYPE ещё пробуют — подождём. */
    if (retrying && subscription.auto_renew && subscription.payment_method_id && renewTierOf(subscription) === "hype") continue;
    const legacy = await legacyRow(subscription.user_id).catch(() => null);
    const stash: Stash = { ...(subscription.stashed ?? {}) };
    try {
      if (!legacy?.pony && await stashPony(subscription.login)) stash.pony = true;
    } catch (caught) {
      console.error("Removing HYPE cosmetics failed", caught instanceof Error ? caught.message : caught);
      continue;
    }
    await db().from("pc_plus_subscriptions")
      .update({ hype_handled_at: new Date().toISOString(), stashed: stashOrNull(stash) })
      .eq("user_id", subscription.user_id);
    result.hypeEnded += 1;
  }

  for (const subscription of (ended.data ?? []) as SubscriptionRow[]) {
    /* Автосписание ещё пробуют — подождём. */
    if (retrying && subscription.auto_renew && subscription.payment_method_id) continue;
    const legacy = await legacyRow(subscription.user_id).catch(() => null);
    const stash: Stash = { ...(subscription.stashed ?? {}) };
    try {
      if (!legacy?.pony && await stashPony(subscription.login)) stash.pony = true;
      if (!legacy?.header_art && await stashHeaderArt(subscription.user_id)) stash.headerArt = true;
    } catch (caught) {
      console.error("Removing subscription cosmetics failed", caught instanceof Error ? caught.message : caught);
      continue;
    }
    await db().from("pc_plus_subscriptions")
      .update({ expired_handled_at: new Date().toISOString(), hype_handled_at: subscription.hype_handled_at ?? new Date().toISOString(), stashed: stashOrNull(stash) })
      .eq("user_id", subscription.user_id);
    result.expired += 1;
  }
  return result;
}

/* Вернуть снятое: пони — только если сейчас идёт HYPE (или пони был до
   подписки), шапку — при любой действующей подписке. Что вернуть пока
   нельзя, остаётся в запасе. */
async function restoreCosmetics(userId: string) {
  const { data, error } = await db().from("pc_plus_subscriptions")
    .select("login,stashed,current_period_end,hype_until")
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data?.stashed) return;
  const stash: Stash = { ...(data.stashed as Stash) };
  const active = Date.parse(String(data.current_period_end)) > Date.now();
  const hype = Boolean(data.hype_until && Date.parse(String(data.hype_until)) > Date.now());
  const legacy = await legacyRow(userId).catch(() => null);
  try {
    if (stash.pony && active && (hype || legacy?.pony)) {
      const profile = await callModelService(String(data.login), {}, { timeoutMs: 8_000 });
      if (profile.mode !== "pony" && profile.hasPony) {
        await callModelService(String(data.login), { mode: "pony", revision: profile.revision }, { timeoutMs: 8_000 });
      }
      delete stash.pony;
    }
    if (stash.headerArt && active) {
      const { data: auth, error: authError } = await db().auth.admin.getUserById(userId);
      if (authError) throw authError;
      const metadata = auth.user?.user_metadata ?? {};
      const saved = parsePixelHeaderArt(metadata[ART_STASH_KEY]);
      const current = parsePixelHeaderArt(metadata.profile_header_art);
      if (saved && !(current && hasPixelHeaderArt(current))) {
        const { error: updateError } = await db().auth.admin.updateUserById(userId, {
          user_metadata: { ...metadata, profile_header_art: saved, [ART_STASH_KEY]: null },
        });
        if (updateError) throw updateError;
      }
      delete stash.headerArt;
    }
  } catch (caught) {
    console.error("Restoring subscription cosmetics failed", caught instanceof Error ? caught.message : caught);
  }
  await db().from("pc_plus_subscriptions").update({ stashed: stashOrNull(stash) }).eq("user_id", userId);
}

/* Что даёт тариф — для писем. */
const TIER_PERKS_RU: Record<PlusTier, string> = {
  plus: "значок у ника, обводка профиля, темы карточки, своя пиксельная шапка, стикеры и шесть образов в гардеробе",
  hype: "всё из PLUS, а ещё скин пони, своя пластинка каждый день, анимированная шапка, радужная обводка, закреплённый пост и двенадцать образов в гардеробе",
};
const TIER_PERKS_EN: Record<PlusTier, string> = {
  plus: "a badge by your nickname, a profile outline, card themes, your own pixel header, stickers and six wardrobe slots",
  hype: "everything in PLUS plus the pony skin, your own records, an animated header, the rainbow outline, a pinned post and twelve wardrobe slots",
};
const termRu = (months: number) => (months === 12 ? "год" : months === 6 ? "полгода" : months === 3 ? "три месяца" : "месяц");
const termEn = (months: number) => (months === 12 ? "a year" : months === 6 ? "six months" : months === 3 ? "three months" : "a month");
const tierName = (tier: PlusTier) => TIER_NAME[tier];

async function notifyGiftReceived(userId: string, login: string, from: string, tier: PlusTier, months: number) {
  try {
    const { data } = await db().auth.admin.getUserById(userId);
    const email = data.user?.email;
    if (!email || !isRealEmail(email)) return;
    const locale = mailLocale(data.user?.user_metadata?.language);
    await sendSiteMail(locale === "en" ? {
      to: email, toName: login, locale,
      subject: `You got ${tierName(tier)} as a gift`,
      heading: `${TIER_LABEL[tier]} is a gift`,
      lines: [`Hi, ${login}!`, `@${from} gave you ${termEn(months)} of ${tierName(tier)}: ${TIER_PERKS_EN[tier]}.`, "It is already active — set it up in Profile → Edit profile."],
      button: { label: "Set up my look", url: `${siteUrl()}/profile?edit=1#plus-ring` },
    } : {
      to: email, toName: login, locale,
      subject: `Вам подарили ${tierName(tier)}`,
      heading: `${TIER_LABEL[tier]} в подарок`,
      lines: [`Привет, ${login}!`, `@${from} подарил(а) вам ${termRu(months)} ${tierName(tier)}: ${TIER_PERKS_RU[tier]}.`, "Подписка уже работает — настройте оформление в профиле."],
      button: { label: "Настроить оформление", url: `${siteUrl()}/profile?edit=1#plus-ring` },
    });
  } catch (error) {
    console.error("Gift mail failed", error instanceof Error ? error.message : error);
  }
}

async function notifyRenewalFailed(userId: string, login: string, tier: PlusTier, subscription: SubscriptionRow) {
  try {
    const { data } = await db().auth.admin.getUserById(userId);
    const email = data.user?.email;
    if (!email || !isRealEmail(email)) return;
    const locale = mailLocale(data.user?.user_metadata?.language);
    const format = (value: string) => new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "ru-RU", { dateStyle: "long", timeZone: "Europe/Moscow" }).format(new Date(value));
    const hypeUntil = hypeActive(subscription) ? subscription.hype_until : null;
    const end = format(subscription.current_period_end);
    /* HYPE закончится раньше — после него до конца подписки идёт PLUS. */
    const tail = hypeUntil && Date.parse(hypeUntil) < Date.parse(subscription.current_period_end);
    await sendSiteMail(locale === "en" ? {
      to: email, toName: login, locale,
      subject: `${TIER_LABEL[tier]} was not renewed — PoppersCraft`,
      heading: `${TIER_LABEL[tier]} was not renewed`,
      lines: [
        `Hi, ${login}!`,
        `We could not charge the saved card for ${tierName(tier)}, so automatic renewal is now off.`,
        hypeUntil
          ? `HYPE stays active until ${format(hypeUntil)}${tail ? `, then PLUS until ${end}` : ""}. To keep it, renew it on the donation page.`
          : `Your subscription stays active until ${end}. To keep it, renew it on the donation page.`,
      ],
      button: { label: "Renew", url: `${siteUrl()}/donation?plan=${tier}` },
    } : {
      to: email, toName: login, locale,
      subject: `${TIER_LABEL[tier]} не продлился — PoppersCraft`,
      heading: `${TIER_LABEL[tier]} не продлился`,
      lines: [
        `Привет, ${login}!`,
        `Не получилось списать оплату ${tierName(tier)} с сохранённой карты, поэтому автопродление выключено.`,
        hypeUntil
          ? `HYPE действует до ${format(hypeUntil)}${tail ? `, дальше до ${end} — PLUS` : ""}. Чтобы не потерять подписку, продлите её на странице доната.`
          : `Подписка действует до ${end}. Чтобы не потерять её, продлите подписку на странице доната.`,
      ],
      button: { label: "Продлить", url: `${siteUrl()}/donation?plan=${tier}` },
    });
  } catch (error) {
    console.error("Renewal failure mail failed", error instanceof Error ? error.message : error);
  }
}

/* Напоминание за три дня до конца подписки, которая сама не продлится
   (год, подарок, выдача, выключенное автопродление). Одно письмо на дату
   окончания: reminded_for помнит, о какой дате уже написали. */
export async function remindEndingSubscriptions() {
  const settings = await getPaymentSettings();
  /* Продлить можно, только когда оплата открыта игрокам. */
  if (!paymentsAvailable(settings) || yookassaTestMode()) return { reminded: 0, skipped: "payments-closed" };
  const now = Date.now();
  const { data, error } = await db().from("pc_plus_subscriptions")
    .select("*")
    .gt("current_period_end", new Date(now).toISOString())
    .lte("current_period_end", new Date(now + 3 * 24 * 3_600_000).toISOString())
    .limit(100);
  if (error) throw error;
  let reminded = 0;
  for (const subscription of (data ?? []) as SubscriptionRow[]) {
    if (subscription.auto_renew && subscription.payment_method_id) continue;
    if (subscription.reminded_for && Date.parse(subscription.reminded_for) === Date.parse(subscription.current_period_end)) continue;
    const application = await applicationFor(subscription.user_id).catch(() => null);
    if (!isApprovedApplication(application)) continue;
    await notifyEnding(subscription.user_id, application!.login, subscription);
    await db().from("pc_plus_subscriptions").update({ reminded_for: subscription.current_period_end }).eq("user_id", subscription.user_id);
    reminded += 1;
  }
  return { reminded };
}

async function notifyEnding(userId: string, login: string, subscription: SubscriptionRow) {
  try {
    const { data } = await db().auth.admin.getUserById(userId);
    const email = data.user?.email;
    if (!email || !isRealEmail(email)) return;
    const locale = mailLocale(data.user?.user_metadata?.language);
    const tier = subscriptionTier(subscription);
    const date = new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "ru-RU", { dateStyle: "long", timeZone: "Europe/Moscow" }).format(new Date(subscription.current_period_end));
    await sendSiteMail(locale === "en" ? {
      to: email, toName: login, locale,
      subject: "Your subscription ends soon — PoppersCraft",
      heading: `${TIER_LABEL[tier]} ends on ${date}`,
      lines: [`Hi, ${login}!`, `Your ${tierName(tier)} ends on ${date} and will not renew by itself.`, "After that the look is removed but your settings are kept — renew and everything comes back."],
      button: { label: "Renew", url: `${siteUrl()}/donation?plan=${tier}` },
    } : {
      to: email, toName: login, locale,
      subject: "Подписка скоро закончится — PoppersCraft",
      heading: `${TIER_LABEL[tier]} до ${date}`,
      lines: [`Привет, ${login}!`, `${tierName(tier)} закончится ${date} и сама не продлится.`, "После этого оформление снимется, но настройки сохранятся — продлите подписку, и всё вернётся."],
      button: { label: "Продлить", url: `${siteUrl()}/donation?plan=${tier}` },
    });
  } catch (error) {
    console.error("Ending reminder mail failed", error instanceof Error ? error.message : error);
  }
}

/* ---- администрирование --------------------------------------------------- */

async function approvedApplications() {
  const { data, error } = await db().from("waitlist_applications")
    .select("user_id,login")
    .eq("status", "approved")
    .eq("is_banned", false)
    .eq("is_deleted", false)
    .not("user_id", "is", null)
    .limit(5_000);
  if (error) throw error;
  return (data ?? []) as Array<{ user_id: string; login: string }>;
}

export async function updatePaymentSettings(patch: { paymentsEnabled?: boolean; passRequired?: boolean; plusRequired?: boolean }, by: string) {
  const settings = await getPaymentSettings();
  const now = new Date().toISOString();
  const next: Record<string, unknown> = { updated_at: now, updated_by: by.slice(0, 60) };
  let grandfathered = 0;
  if (patch.paymentsEnabled !== undefined) {
    if (patch.paymentsEnabled && !yookassaConfigured()) throw new PaymentError("Сначала добавьте ключи ЮKassa на сервер.", 409);
    next.payments_enabled = patch.paymentsEnabled;
  }
  if (patch.passRequired !== undefined) {
    if (patch.passRequired && !settings.pass_required_since) {
      /* Всем, кто уже играет, — пропуск бесплатно. */
      const players = await approvedApplications();
      if (players.length) {
        const { error } = await db().from("pc_access_passes").upsert(
          players.map((player) => ({ user_id: player.user_id, login: player.login, source: "legacy", granted_by: by.slice(0, 60) })),
          { onConflict: "user_id", ignoreDuplicates: true },
        );
        if (error) throw error;
      }
      grandfathered = players.length;
      next.pass_required_since = now;
    }
    if (!patch.passRequired) next.pass_required_since = null;
  }
  if (patch.plusRequired !== undefined) {
    if (patch.plusRequired && !settings.plus_required_since) {
      grandfathered += await grandfatherCosmetics();
      next.plus_required_since = now;
    }
    if (!patch.plusRequired) next.plus_required_since = null;
  }
  const { error } = await db().from("pc_payment_settings").update(next).eq("id", true);
  if (error) throw error;
  return { settings: await getPaymentSettings(), grandfathered };
}

/* Кто уже нарисовал шапку или сделал пони — сохраняет их без PLUS. */
async function grandfatherCosmetics() {
  const players = await approvedApplications();
  const rows: Array<{ user_id: string; login: string; pony: boolean; header_art: boolean }> = [];
  for (const player of players) {
    const [{ data: auth }, pony] = await Promise.all([
      db().auth.admin.getUserById(player.user_id),
      callModelService(player.login, {}, { timeoutMs: 6_000 }).then((profile) => Boolean(profile.hasPony)).catch(() => false),
    ]);
    const art = parsePixelHeaderArt(auth.user?.user_metadata?.profile_header_art);
    const headerArt = Boolean(art && hasPixelHeaderArt(art));
    if (pony || headerArt) rows.push({ user_id: player.user_id, login: player.login, pony, header_art: headerArt });
  }
  if (rows.length) {
    const { error } = await db().from("pc_plus_legacy").upsert(rows, { onConflict: "user_id", ignoreDuplicates: true });
    if (error) throw error;
  }
  return rows.length;
}

export async function grantPass(userId: string, by: string) {
  const application = await applicationFor(userId);
  if (!isApprovedApplication(application)) throw new PaymentError("Пропуск выдаётся только одобренному игроку.", 409);
  const { error } = await db().from("pc_access_passes").upsert(
    { user_id: userId, login: application!.login, source: "admin", granted_by: by.slice(0, 60) },
    { onConflict: "user_id", ignoreDuplicates: true },
  );
  if (error) throw error;
}

/* ---- промокоды ----------------------------------------------------------- */

/* Код создаёт владелец: скидка в процентах, срок действия и число активаций.
   Один игрок активирует код один раз; активация занимается в момент создания
   платежа и возвращается, если платёж не прошёл. На что действует код:
   any — на всё, pass — на пропуск, plus — на любую подписку (PLUS и HYPE),
   hype — только на HYPE. */
export type PromoScope = "any" | "plus" | "hype" | "pass";
export const PROMO_SCOPES: PromoScope[] = ["any", "plus", "hype", "pass"];

export type PromoRow = {
  code: string;
  discount: number;
  scope: PromoScope;
  activations: number;
  used: number;
  expires_at: string | null;
  note: string | null;
  created_at: string;
  created_by: string;
  disabled_at: string | null;
};

/* Что покупают: пропуск или тариф подписки. */
export type PromoKind = "pass" | PlusTier;

export type PromoCheck = { code: string; discount: number; expiresAt: string | null; left: number };

export const normalizePromo = (value: unknown) =>
  String(value ?? "").trim().toUpperCase().replace(/\s+/g, "").slice(0, 32);

const promoFits = (scope: PromoScope, kind: PromoKind) =>
  scope === "any" || scope === kind || (scope === "plus" && kind === "hype");

const PROMO_ERRORS: Record<string, string> = {
  "not-found": "Такого промокода нет. Проверьте написание.",
  disabled: "Этот промокод больше не действует.",
  expired: "Срок действия промокода закончился.",
  "used-up": "Все активации промокода уже использованы.",
  already: "Вы уже пользовались этим промокодом.",
  held: "Этот промокод уже применён к оплате, которую вы начали. Завершите её — или подождите около часа: неоплаченный платёж отменится, и код снова станет доступен.",
  "wrong-kind": "Этот промокод не подходит к такой покупке.",
};

/* Код занят своим же платежом, который ещё не оплачен. Сверяем его с
   ЮKassa: если платёж уже отменён, активация освобождается. */
async function promoHold(paymentId: string | null): Promise<"free" | "open" | "used"> {
  if (!paymentId) return "used";
  const { data, error } = await db().from("pc_payments").select("*").eq("id", paymentId).maybeSingle();
  if (error || !data) return "used";
  let row = data as PaymentRow;
  if (!OPEN_STATUSES.includes(row.status)) return row.status === "succeeded" ? "used" : "free";
  /* Платёж так и не дошёл до ЮKassa — он уже не оплатится. */
  if (!row.provider_payment_id && Date.parse(row.created_at) < Date.now() - 10 * 60_000) {
    await updatePayment(row.id, { status: "failed", cancellation_reason: "create_failed" }).catch(() => null);
    await releasePromo(row.id);
    return "free";
  }
  row = await syncPayment(row).catch(() => row);
  if (OPEN_STATUSES.includes(row.status)) return "open";
  return row.status === "succeeded" ? "used" : "free";
}

/* Проверка без занятия активации — для подсказки в окне оплаты. */
export async function checkPromo(rawCode: string, userId: string, kind: PromoKind): Promise<PromoCheck> {
  const code = normalizePromo(rawCode);
  if (!/^[A-Z0-9_-]{3,32}$/.test(code)) throw new PaymentError("Промокод состоит из латинских букв, цифр и знаков «-» или «_».", 400);
  const { data, error } = await db().from("pc_promo_codes").select("*").eq("code", code).maybeSingle();
  if (error) throw error;
  let promo = data as PromoRow | null;
  if (!promo) throw new PaymentError(PROMO_ERRORS["not-found"], 404);
  if (promo.disabled_at) throw new PaymentError(PROMO_ERRORS.disabled, 409);
  if (promo.expires_at && Date.parse(promo.expires_at) <= Date.now()) throw new PaymentError(PROMO_ERRORS.expired, 409);
  if (!promoFits(promo.scope, kind)) throw new PaymentError(PROMO_ERRORS["wrong-kind"], 409);
  const { data: mine, error: useError } = await db()
    .from("pc_promo_uses").select("released_at,payment_id").eq("code", code).eq("user_id", userId).maybeSingle();
  if (useError) throw useError;
  if (mine && !mine.released_at) {
    const hold = await promoHold(mine.payment_id ? String(mine.payment_id) : null);
    if (hold === "open") throw new PaymentError(PROMO_ERRORS.held, 409);
    if (hold === "used") throw new PaymentError(PROMO_ERRORS.already, 409);
    /* Активация вернулась — перечитываем счётчик. */
    const { data: fresh } = await db().from("pc_promo_codes").select("*").eq("code", code).maybeSingle();
    if (fresh) promo = fresh as PromoRow;
  }
  if (promo.used >= promo.activations) throw new PaymentError(PROMO_ERRORS["used-up"], 409);
  return { code, discount: promo.discount, expiresAt: promo.expires_at, left: promo.activations - promo.used };
}

async function reservePromo(code: string, userId: string, login: string, paymentId: string, kind: PromoKind) {
  const { data, error } = await db().rpc("pc_promo_reserve", {
    p_code: code, p_user: userId, p_login: login, p_payment: paymentId, p_kind: kind,
  });
  if (error) throw error;
  const result = String(data);
  const discount = Number(result);
  if (!Number.isFinite(discount)) throw new PaymentError(PROMO_ERRORS[result] ?? "Промокод не сработал.", 409);
  return discount;
}

/* Платёж не состоялся — активация возвращается в общий счёт. */
async function releasePromo(paymentId: string) {
  try {
    const { error } = await db().rpc("pc_promo_release", { p_payment: paymentId });
    if (error) throw error;
  } catch (error) {
    console.error("Promo release failed", error instanceof Error ? error.message : error);
  }
}

export async function listPromoCodes() {
  const { data, error } = await db().from("pc_promo_codes").select("*").order("created_at", { ascending: false }).limit(200);
  if (error) throw error;
  return (data ?? []) as PromoRow[];
}

export async function createPromoCode(input: {
  code: string;
  discount: number;
  activations: number;
  expiresAt: string | null;
  scope: PromoRow["scope"];
  note: string | null;
  by: string;
}) {
  const code = normalizePromo(input.code);
  if (!/^[A-Z0-9_-]{3,32}$/.test(code)) throw new PaymentError("Код: 3–32 символа, латиница, цифры, «-» или «_».", 400);
  const discount = Math.round(Number(input.discount));
  if (!Number.isFinite(discount) || discount < 1 || discount > 100) throw new PaymentError("Скидка — от 1 до 100 процентов.", 400);
  const activations = Math.round(Number(input.activations));
  if (!Number.isFinite(activations) || activations < 1 || activations > 100_000) throw new PaymentError("Число активаций — от 1 до 100 000.", 400);
  if (input.expiresAt && !Number.isFinite(Date.parse(input.expiresAt))) throw new PaymentError("Проверьте дату окончания.", 400);
  const scope: PromoScope = PROMO_SCOPES.includes(input.scope) ? input.scope : "any";
  const { error } = await db().from("pc_promo_codes").insert({
    code,
    discount,
    activations,
    scope,
    expires_at: input.expiresAt,
    note: input.note ? String(input.note).slice(0, 120) : null,
    created_by: input.by.slice(0, 60),
  });
  if (error) {
    if (String(error.code) === "23505") throw new PaymentError("Такой код уже есть.", 409);
    throw error;
  }
  return { code, discount, activations };
}

export async function setPromoDisabled(rawCode: string, disabled: boolean, by: string) {
  const code = normalizePromo(rawCode);
  const { data, error } = await db().from("pc_promo_codes")
    .update({ disabled_at: disabled ? new Date().toISOString() : null, disabled_by: disabled ? by.slice(0, 60) : null })
    .eq("code", code)
    .select("code")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new PaymentError("Такого промокода нет.", 404);
  return { code };
}

/* ---- ручная выдача PLUS -------------------------------------------------- */

/* Сроки, которые владелец выбирает в «Управление → Оплата». */
export const MANUAL_PLUS_MONTHS = [1, 3, 6, 12] as const;

/* Найти игрока по нику: и для выдачи, и для подсказок в поле ввода. */
export async function playerByLogin(login: string) {
  const { data, error } = await db()
    .from("waitlist_applications")
    .select("user_id,login,status,is_banned,is_deleted")
    .eq("login", login)
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as Application | null;
}

export async function searchPlayers(query: string, limit = 8) {
  const clean = query.trim().toLowerCase().replace(/^@/, "");
  if (!/^[a-z0-9_.-]{1,24}$/.test(clean)) return [];
  /* Экранируем шаблонные символы, иначе «%» в запросе вернёт всех подряд. */
  const pattern = `${clean.replace(/[%_\\]/g, (match) => `\\${match}`)}%`;
  const { data, error } = await db()
    .from("waitlist_applications")
    .select("login")
    .eq("status", "approved")
    .eq("is_banned", false)
    .eq("is_deleted", false)
    .ilike("login", pattern)
    .order("login")
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map((row) => String(row.login));
}

/* Выдать PLUS вручную любому игроку: срок встаёт после уже оплаченного
   времени, автопродление не включается — платить игроку не за что. */
export async function grantPlusManual(login: string, months: number, by: string, tier: string = "plus") {
  if (!MANUAL_PLUS_MONTHS.includes(months as (typeof MANUAL_PLUS_MONTHS)[number])) {
    throw new PaymentError("Выберите срок из списка.", 400);
  }
  const application = await playerByLogin(login);
  if (!application?.user_id) throw new PaymentError("Игрок не найден.", 404);
  if (!isApprovedApplication(application)) throw new PaymentError("Подписка выдаётся только одобренному игроку.", 409);
  const wanted = asTier(tier);
  const { data, error } = await db().rpc("pc_grant_plus_manual", {
    p_user: application.user_id,
    p_login: application.login,
    p_by: by.slice(0, 60),
    p_months: months,
    p_tier: wanted,
  });
  if (error) throw error;
  if (String(data) === "bad-months") throw new PaymentError("Выберите срок из списка.", 400);
  /* Косметику, снятую после прошлой подписки, возвращаем сразу. */
  await restoreCosmetics(application.user_id);
  await notifyPlusGranted(application.user_id, application.login, months, wanted);
  return { login: application.login, months, tier: wanted };
}

/* Снять последнюю выдачу: убирается только неиспользованный остаток. */
export async function revokePlusManual(login: string, by: string) {
  const application = await playerByLogin(login);
  if (!application?.user_id) throw new PaymentError("Игрок не найден.", 404);
  const { data, error } = await db().rpc("pc_revoke_plus_manual", {
    p_user: application.user_id,
    p_by: by.slice(0, 60),
  });
  if (error) throw error;
  const result = String(data);
  if (result === "not-granted") throw new PaymentError("Этому игроку подписку вручную не выдавали.", 409);
  if (result === "used") throw new PaymentError("Выданный срок уже прошёл — снимать нечего.", 409);
  return { login: application.login };
}

async function notifyPlusGranted(userId: string, login: string, months: number, tier: PlusTier = "plus") {
  try {
    const { data } = await db().auth.admin.getUserById(userId);
    const email = data.user?.email;
    if (!email || !isRealEmail(email)) return;
    const locale = mailLocale(data.user?.user_metadata?.language);
    await sendSiteMail(locale === "en" ? {
      to: email, toName: login, locale,
      subject: `${tierName(tier)} is yours`,
      heading: `${TIER_LABEL[tier]} from the team`,
      lines: [`Hi, ${login}!`, `The PoppersCraft team gave you ${termEn(months)} of ${tierName(tier)}: ${TIER_PERKS_EN[tier]}.`, "It is already active — open the site to see what it unlocks."],
      button: { label: "Set up my look", url: `${siteUrl()}/profile?edit=1#plus-ring` },
    } : {
      to: email, toName: login, locale,
      subject: `Вам выдали ${tierName(tier)}`,
      heading: `${TIER_LABEL[tier]} от команды`,
      lines: [`Привет, ${login}!`, `Команда PoppersCraft выдала вам ${termRu(months)} ${tierName(tier)}: ${TIER_PERKS_RU[tier]}.`, "Подписка уже работает — зайдите на сайт, там всё покажем."],
      button: { label: "Настроить оформление", url: `${siteUrl()}/profile?edit=1#plus-ring` },
    });
  } catch (error) {
    console.error("PLUS grant mail failed", error instanceof Error ? error.message : error);
  }
}

/* ---- первооткрыватели и первые 10 игроков ------------------------------- */

/* Первооткрыватели — игроки, которые были на сервере до запуска оплаты:
   отметка в профиле и бесплатный пропуск, PLUS — только если подарит владелец.
   Первые 10 одобренных после запуска (без владельцев) попадают в список в
   момент одобрения (триггер pc_founders_on_approval), но пропуск, как все,
   оплачивают сами (решение владельца 2026-10-03): бесплатный пропуск
   владелец дарит не больше чем троим из них, PLUS на год — не больше чем
   пятерым. Подарок PLUS — всегда год с момента выдачи. */
export const FOUNDER_SLOTS = 10;
export const FOUNDER_PLUS_GIFTS = 5;
export const FOUNDER_FREE_PASSES = 3;

/* Страховка к триггеру: занять свободные места, если одобрение прошло мимо него. */
export async function syncFounders() {
  const { data, error } = await db().rpc("pc_sync_founders");
  if (error) throw error;
  return { added: Number(data ?? 0) };
}

export async function setEarlyPlus(userId: string, grant: boolean, by: string) {
  const { data, error } = await db().rpc(grant ? "pc_grant_early_plus" : "pc_revoke_early_plus", { p_user: userId, p_by: by.slice(0, 60) });
  if (error) throw error;
  const result = String(data);
  if (result === "not-eligible") throw new PaymentError("PLUS в подарок получают только первооткрыватели и первые 10 игроков.", 404);
  if (result === "limit") throw new PaymentError(`В первой десятке PLUS уже подарен ${FOUNDER_PLUS_GIFTS} игрокам — больше нельзя.`, 409);
  if (result === "already") throw new PaymentError("У этого игрока подаренный PLUS ещё действует.", 409);
  if (result === "not-granted") throw new PaymentError("Этому игроку PLUS не дарили.", 409);
  if (result === "used") throw new PaymentError("Подаренный год уже закончился — отменять нечего.", 409);
  /* Косметику, снятую после прошлой подписки, возвращаем сразу. */
  if (grant) {
    await restoreCosmetics(userId);
    const early = await earlyPlayerRow(userId);
    await queueCelebration(userId, { kind: "admin", months: 12, tier: "plus", until: early?.plus_gift_until ?? null });
  }
  return result;
}

/* Подарить или забрать бесплатный пропуск у игрока первой десятки. Забрать
   можно только подаренный (source = 'founder'), оплаченный не трогаем. */
export async function setFounderPass(userId: string, grant: boolean, by: string) {
  const { data, error } = await db().rpc("pc_set_founder_pass", { p_user: userId, p_grant: grant, p_by: by.slice(0, 60) });
  if (error) throw error;
  const result = String(data);
  if (result === "not-eligible") throw new PaymentError("Пропуск в подарок получают только игроки первой десятки.", 404);
  if (result === "not-approved") throw new PaymentError("Анкета этого игрока сейчас закрыта — пропуск подарить нельзя.", 409);
  if (result === "limit") throw new PaymentError(`Пропуск уже подарен ${FOUNDER_FREE_PASSES} игрокам первой десятки — больше нельзя.`, 409);
  if (result === "already") throw new PaymentError("Этому игроку пропуск уже подарен.", 409);
  if (result === "has-pass") throw new PaymentError("У этого игрока уже есть пропуск.", 409);
  if (result === "not-granted") throw new PaymentError("У этого игрока нет пропуска.", 409);
  if (result === "not-gift") throw new PaymentError("Этот пропуск не подарок первой десятке — забрать его здесь нельзя.", 409);
  return result;
}

/* Освободить место в первой десятке: служебный или ошибочный аккаунт не
   должен занимать место живого игрока. Запись остаётся в базе с отметкой. */
export async function releaseEarlyPlayer(userId: string, by: string) {
  const { data, error } = await db().rpc("pc_release_early_player", { p_user: userId, p_by: by.slice(0, 60) });
  if (error) throw error;
  const result = String(data);
  if (result === "not-found") throw new PaymentError("Этого игрока нет в списке.", 404);
  if (result === "already") throw new PaymentError("Место уже освобождено.", 409);
  if (result === "has-gift") throw new PaymentError("Сначала отмените подаренный PLUS этого игрока.", 409);
  return result;
}

export type EarlyOverviewRow = {
  userId: string;
  login: string;
  kind: EarlyKind;
  position: number;
  approvedAt: string | null;
  approved: boolean;
  /* Хоть раз получал подарок (в первой десятке это место в лимите пяти). */
  gifted: boolean;
  /* Откуда пропуск: founder — подарен первой десятке (не больше трёх), null — пропуска нет. */
  pass: PassSource | null;
  giftUntil: string | null;
  /* Конец всей подписки и, если сейчас идёт HYPE, конец его отрезка. */
  plusUntil: string | null;
  hypeUntil: string | null;
};

const futureOrNull = (value: unknown) => {
  const text = value ? String(value) : null;
  return text && Date.parse(text) > Date.now() ? text : null;
};

async function earlyPlayersOverview(): Promise<EarlyOverviewRow[]> {
  const { data, error } = await db().from("pc_early_players").select("*").is("released_at", null).order("kind").order("position");
  if (error) throw error;
  const rows = (data ?? []) as EarlyPlayerRow[];
  if (!rows.length) return [];
  const ids = rows.map((row) => row.user_id);
  const [applications, subscriptions, passes] = await Promise.all([
    db().from("waitlist_applications").select("user_id,login,status,is_banned,is_deleted").in("user_id", ids),
    db().from("pc_plus_subscriptions").select("user_id,current_period_end,hype_until").in("user_id", ids),
    db().from("pc_access_passes").select("user_id,source").in("user_id", ids),
  ]);
  if (applications.error) throw applications.error;
  if (subscriptions.error) throw subscriptions.error;
  if (passes.error) throw passes.error;
  const applicationBy = new Map(((applications.data ?? []) as Application[]).map((row) => [row.user_id, row]));
  const subscriptionBy = new Map((subscriptions.data ?? []).map((row) => [String(row.user_id), row]));
  const passBy = new Map((passes.data ?? []).map((row) => [String(row.user_id), String(row.source) as PassSource]));
  return rows.map((row) => {
    const application = applicationBy.get(row.user_id) ?? null;
    const subscription = subscriptionBy.get(row.user_id);
    return {
      userId: row.user_id,
      login: application?.login ?? row.login,
      kind: row.kind,
      position: row.position,
      approvedAt: row.approved_at,
      approved: isApprovedApplication(application),
      gifted: Boolean(row.plus_granted_at),
      pass: passBy.get(row.user_id) ?? null,
      giftUntil: giftActive(row) ? row.plus_gift_until : null,
      plusUntil: futureOrNull(subscription?.current_period_end),
      hypeUntil: futureOrNull(subscription?.hype_until),
    };
  });
}

export async function adminPaymentOverview() {
  const [settings, payments, subscriptions, passes] = await Promise.all([
    getPaymentSettings(),
    db().from("pc_payments").select("id,login,kind,amount,currency,provider,status,recurring,test,created_at,paid_at,cancellation_reason,recipient_login,plan,tier,promo_code,discount").order("created_at", { ascending: false }).limit(200),
    db().from("pc_plus_subscriptions").select("login,current_period_end,hype_until,renew_tier,auto_renew,payment_method_id,payment_method_title,failed_attempts").order("current_period_end", { ascending: false }).limit(500),
    db().from("pc_access_passes").select("login,source,granted_at").order("granted_at", { ascending: false }).limit(500),
  ]);
  for (const result of [payments, subscriptions, passes]) if (result.error) throw result.error;
  const succeeded = (payments.data ?? []).filter((row) => row.status === "succeeded" && !row.test);
  /* Список ранних игроков не должен ронять всю панель оплаты. */
  let early: EarlyOverviewRow[] | null = null;
  try {
    early = await earlyPlayersOverview();
  } catch (error) {
    console.error("Early players overview failed", error instanceof Error ? error.message : error);
  }
  /* Тариф подписки считается по отрезкам, а автопродление — только с картой. */
  const rows = (subscriptions.data ?? []).map((row) => ({
    login: String(row.login),
    current_period_end: String(row.current_period_end),
    hype_until: futureOrNull(row.hype_until),
    tier: futureOrNull(row.hype_until) ? "hype" as const : "plus" as const,
    renew_tier: asTier(row.renew_tier),
    auto_renew: Boolean(row.auto_renew && row.payment_method_id),
    payment_method_title: row.payment_method_title ? String(row.payment_method_title) : null,
    failed_attempts: Number(row.failed_attempts) || 0,
  }));
  const active = rows.filter((row) => Date.parse(row.current_period_end) > Date.now());
  return {
    early,
    founderSlots: FOUNDER_SLOTS,
    founderGifts: FOUNDER_PLUS_GIFTS,
    founderPasses: FOUNDER_FREE_PASSES,
    settings,
    configured: yookassaConfigured(),
    test: yookassaTestMode(),
    totals: {
      /* Выручка — в рублях (ЮKassa); платежи lava.top в валюте считаются отдельно. */
      revenue: succeeded.filter((row) => !row.currency || row.currency === "RUB").reduce((sum, row) => sum + Number(row.amount), 0),
      payments: succeeded.length,
      activePlus: active.length,
      activeHype: active.filter((row) => row.tier === "hype").length,
      passes: (passes.data ?? []).length,
    },
    payments: payments.data ?? [],
    subscriptions: rows,
    passes: passes.data ?? [],
  };
}
