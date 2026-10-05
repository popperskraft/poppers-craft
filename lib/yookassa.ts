import "server-only";

/* Минимальный клиент API ЮKassa (https://yookassa.ru/developers/api).
   Магазин и секретный ключ берутся из YOOKASSA_SHOP_ID и YOOKASSA_SECRET_KEY.
   Чеки не передаются: с 29.12.2025 ЮKassa не регистрирует чеки самозанятых,
   доход регистрируется в «Мой налог» отдельно. */

const API = "https://api.yookassa.ru/v3";

export type YooPaymentStatus = "pending" | "waiting_for_capture" | "succeeded" | "canceled";

export type YooPayment = {
  id: string;
  status: YooPaymentStatus;
  paid: boolean;
  test?: boolean;
  amount: { value: string; currency: string };
  description?: string;
  created_at: string;
  captured_at?: string;
  confirmation?: { type: string; confirmation_url?: string };
  payment_method?: {
    type: string;
    id: string;
    saved: boolean;
    title?: string;
    card?: { last4?: string; card_type?: string };
  };
  cancellation_details?: { party?: string; reason?: string };
  metadata?: Record<string, string>;
};

export class YooKassaError extends Error {
  status: number;
  code: string;
  parameter: string;
  constructor(status: number, code: string, description: string, parameter = "") {
    super(description || code || `yookassa-${status}`);
    this.status = status;
    this.code = code;
    this.parameter = parameter;
  }
}

function credentials() {
  const shopId = (process.env.YOOKASSA_SHOP_ID ?? "").trim();
  const secretKey = (process.env.YOOKASSA_SECRET_KEY ?? "").trim();
  return { shopId, secretKey };
}

export function yookassaConfigured() {
  const { shopId, secretKey } = credentials();
  return /^\d{3,12}$/.test(shopId) && /^(?:test|live)_[A-Za-z0-9_-]{20,}$/.test(secretKey);
}

export function yookassaTestMode() {
  return credentials().secretKey.startsWith("test_");
}

export function isYooPaymentId(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

async function call<T>(path: string, init: { method?: "GET" | "POST"; body?: unknown; idempotenceKey?: string } = {}): Promise<T> {
  if (!yookassaConfigured()) throw new YooKassaError(503, "not_configured", "Оплата ещё не настроена.");
  const { shopId, secretKey } = credentials();
  const headers: Record<string, string> = {
    Authorization: `Basic ${Buffer.from(`${shopId}:${secretKey}`).toString("base64")}`,
    Accept: "application/json",
  };
  if (init.body !== undefined) headers["Content-Type"] = "application/json";
  if (init.idempotenceKey) headers["Idempotence-Key"] = init.idempotenceKey;
  let response: Response;
  try {
    response = await fetch(`${API}${path}`, {
      method: init.method ?? "GET",
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new YooKassaError(503, "network", "ЮKassa не ответила. Попробуйте ещё раз.");
  }
  const payload = await response.json().catch(() => null) as (T & { type?: string; code?: string; description?: string; parameter?: string }) | null;
  if (!response.ok || !payload || payload.type === "error") {
    throw new YooKassaError(response.status || 502, String(payload?.code ?? ""), String(payload?.description ?? ""), String(payload?.parameter ?? ""));
  }
  return payload as T;
}

export type CreatePaymentInput = {
  amount: number;
  description: string;
  metadata: Record<string, string>;
  returnUrl?: string;
  savePaymentMethod?: boolean;
  paymentMethodId?: string;
};

export function createYooPayment(input: CreatePaymentInput, idempotenceKey: string) {
  const body: Record<string, unknown> = {
    amount: { value: input.amount.toFixed(2), currency: "RUB" },
    capture: true,
    description: input.description.slice(0, 128),
    metadata: input.metadata,
  };
  if (input.paymentMethodId) {
    body.payment_method_id = input.paymentMethodId;
  } else {
    body.confirmation = { type: "redirect", return_url: input.returnUrl };
    if (input.savePaymentMethod) body.save_payment_method = true;
  }
  return call<YooPayment>("/payments", { method: "POST", body, idempotenceKey });
}

export function getYooPayment(id: string) {
  if (!isYooPaymentId(id)) throw new YooKassaError(400, "invalid_id", "Некорректный номер платежа.");
  return call<YooPayment>(`/payments/${id}`);
}

/* Название сохранённого способа оплаты для профиля: «Карта •• 4444». */
export function paymentMethodTitle(payment: YooPayment) {
  const method = payment.payment_method;
  if (!method) return null;
  if (method.card?.last4) return `${method.card.card_type ? `${method.card.card_type} ` : "Карта "}•• ${method.card.last4}`.slice(0, 60);
  return (method.title || method.type || "").slice(0, 60) || null;
}
