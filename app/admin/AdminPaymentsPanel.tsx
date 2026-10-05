"use client";

import { FormEvent, useEffect, useState } from "react";
import "./admin-payments.css";

/* «Управление → Оплата»: ЮKassa, переключатели, платежи, подписки и пропуска. */

type Settings = { payments_enabled: boolean; pass_required_since: string | null; plus_required_since: string | null; updated_at: string; updated_by: string | null };
type Overview = {
  settings: Settings;
  configured: boolean;
  test: boolean;
  totals: { revenue: number; payments: number; activePlus: number; activeHype?: number; passes: number };
  payments: Array<{ id: string; login: string; kind: "pass" | "plus"; amount: number; status: string; recurring: boolean; test: boolean; created_at: string; paid_at: string | null; cancellation_reason: string | null; recipient_login?: string | null; plan?: "month" | "year"; tier?: "plus" | "hype"; promo_code?: string | null; discount?: number; currency?: string; provider?: string }>;
  /* tier — тариф сейчас; hype_until — до какого дня идёт HYPE (дальше PLUS); renew_tier — тариф автопродления. */
  subscriptions: Array<{ login: string; current_period_end: string; hype_until?: string | null; tier?: "plus" | "hype"; renew_tier?: "plus" | "hype"; auto_renew: boolean; payment_method_title: string | null; failed_attempts: number }>;
  passes: Array<{ login: string; source: string; granted_at: string }>;
  /* null — список не загрузился (например, база ещё без таблицы ранних игроков). */
  early?: EarlyPlayer[] | null;
  founderSlots?: number;
  founderGifts?: number;
  founderPasses?: number;
};
/* Первооткрыватель (pioneer) или один из первых 10 игроков (founder). */
type EarlyPlayer = {
  userId: string;
  login: string;
  kind: "pioneer" | "founder";
  position: number;
  approvedAt: string | null;
  approved: boolean;
  gifted: boolean;
  /* Откуда пропуск: founder — подарен первой десятке, null — пропуска нет. */
  pass?: string | null;
  giftUntil: string | null;
  plusUntil: string | null;
  hypeUntil?: string | null;
};

const WEBHOOK_URL = "https://popperscraft.org/api/payments/yookassa";
const STATUS: Record<string, string> = { created: "создан", pending: "ждёт оплаты", waiting_for_capture: "обработка", succeeded: "оплачен", canceled: "отменён", failed: "ошибка" };
const SOURCE: Record<string, string> = { payment: "оплата", legacy: "бесплатно (играл до оплаты)", admin: "выдал админ", founder: "подарок первой десятке", pioneer: "первооткрыватель" };
/* Пропуск игрока в списках первооткрывателей и первой десятки. */
const EARLY_PASS: Record<string, string> = { payment: "пропуск оплачен ✓", legacy: "пропуск бесплатно ✓", admin: "пропуск выдан вручную ✓", founder: "пропуск подарен ✓", pioneer: "пропуск ✓" };
const dt = new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "short" });
const when = (value: string | null) => (value && Number.isFinite(Date.parse(value)) ? dt.format(new Date(value)) : "—");
const money = new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0 });

type EarlyFeature = { key: string; title: string; description: string; audience: string };

/* Промокод: скидка в процентах, число активаций и срок действия. */
type PromoCode = {
  code: string;
  discount: number;
  scope: "any" | "plus" | "hype" | "pass";
  activations: number;
  used: number;
  expires_at: string | null;
  note: string | null;
  created_at: string;
  created_by: string;
  disabled_at: string | null;
};

const SCOPES: Record<string, string> = { any: "всё", plus: "подписка (PLUS и HYPE)", hype: "только HYPE", pass: "только пропуск" };

/* Сроки ручной выдачи подписки — те же, что принимает сервер. */
const PLUS_TERMS = [
  { months: 1, label: "1 месяц" },
  { months: 3, label: "3 месяца" },
  { months: 6, label: "полгода" },
  { months: 12, label: "1 год" },
];

/* Поле ника с подсказками: список одобренных игроков подгружается по мере
   ввода, поэтому «p» сразу показывает platon. */
function LoginField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const [options, setOptions] = useState<string[]>([]);

  useEffect(() => {
    const query = value.trim().replace(/^@/, "");
    if (!query) {
      setOptions([]);
      return;
    }
    let active = true;
    const timer = window.setTimeout(() => {
      fetch(`/api/admin/players/search?q=${encodeURIComponent(query)}`, { cache: "no-store" })
        .then((response) => (response.ok ? response.json() : null))
        .then((result) => { if (active) setOptions(Array.isArray(result?.logins) ? result.logins : []); })
        .catch(() => { /* Подсказки — необязательная помощь. */ });
    }, 180);
    return () => { active = false; window.clearTimeout(timer); };
  }, [value]);

  return (
    <label>
      {label}
      <input
        list={`${id}-options`}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="игровой ник"
        maxLength={25}
        autoComplete="off"
        spellCheck={false}
        required
      />
      <datalist id={`${id}-options`}>
        {options.map((login) => <option key={login} value={login} />)}
      </datalist>
    </label>
  );
}

export function AdminPaymentsPanel() {
  const [data, setData] = useState<Overview | null>(null);
  const [features, setFeatures] = useState<EarlyFeature[]>([]);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [passLogin, setPassLogin] = useState("");
  const [plusLogin, setPlusLogin] = useState("");
  const [plusMonths, setPlusMonths] = useState(1);
  const [plusTier, setPlusTier] = useState("plus");
  const [promos, setPromos] = useState<PromoCode[]>([]);
  const [promoForm, setPromoForm] = useState({ code: "", discount: "20", activations: "10", expiresAt: "", scope: "any", note: "" });

  async function load() {
    setError("");
    try {
      const [payments, early, promo] = await Promise.all([
        fetch("/api/admin/payments", { cache: "no-store" }),
        fetch("/api/admin/early-access", { cache: "no-store" }),
        fetch("/api/admin/promo", { cache: "no-store" }),
      ]);
      const result = await payments.json().catch(() => null);
      if (!payments.ok) throw new Error(result?.error ?? "Не удалось загрузить оплату.");
      setData(result as Overview);
      const earlyResult = await early.json().catch(() => null);
      if (early.ok) setFeatures((earlyResult?.features ?? []) as EarlyFeature[]);
      const promoResult = await promo.json().catch(() => null);
      if (promo.ok) setPromos((promoResult?.codes ?? []) as PromoCode[]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось загрузить оплату.");
    }
  }

  /* Кому открыта новая функция: администраторам, подписчикам или всем. */
  async function setAudience(key: string, audience: string) {
    setBusy(`early-${key}`);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/admin/early-access", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, audience }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.error ?? "Не удалось сохранить.");
      setMessage("Ранний доступ обновлён.");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось сохранить.");
    } finally {
      setBusy("");
    }
  }

  useEffect(() => { void load(); }, []);

  async function toggle(key: "paymentsEnabled" | "passRequired" | "plusRequired", value: boolean, confirmText: string) {
    if (!window.confirm(confirmText)) return;
    setBusy(key);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/admin/payments", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [key]: value }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.error ?? "Не удалось сохранить.");
      setMessage(result.grandfathered ? `Сохранено. Бесплатно сохранили доступ или косметику: ${result.grandfathered}.` : "Сохранено.");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось сохранить.");
    } finally {
      setBusy("");
    }
  }

  async function grant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const login = passLogin.trim().replace(/^@/, "");
    setBusy("grant");
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/admin/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ login }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.error ?? "Не удалось выдать пропуск.");
      setMessage(`Пропуск выдан: @${login}.`);
      setPassLogin("");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось выдать пропуск.");
    } finally {
      setBusy("");
    }
  }

  /* Ручная выдача подписки любому игроку: HYPE включается сразу и сдвигает
     оставшиеся дни PLUS, PLUS встаёт после всего оплаченного времени. Игрок
     при следующем заходе увидит торжественное окно своего тарифа. */
  async function managePlus(action: "plus-grant" | "plus-revoke") {
    const login = plusLogin.trim().replace(/^@/, "").toLowerCase();
    if (!login) {
      setError("Укажите игровой ник.");
      return;
    }
    const term = PLUS_TERMS.find((row) => row.months === plusMonths)?.label ?? `${plusMonths} мес.`;
    const tierName = plusTier === "hype" ? "HYPE" : "PLUS";
    const question = action === "plus-grant"
      ? (plusTier === "hype"
        ? `Выдать @${login} HYPE на ${term}? HYPE включится сразу, а оставшиеся дни PLUS, если они есть, сдвинутся на время после него.`
        : `Выдать @${login} PLUS на ${term}? Если подписка уже есть, срок добавится после неё.`)
      : `Снять у @${login} последнюю ручную выдачу подписки? Уберётся только неиспользованный остаток.`;
    if (!window.confirm(question)) return;
    setBusy(action);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/admin/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, login, months: plusMonths, tier: plusTier }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.error ?? "Не удалось изменить подписку.");
      setMessage(action === "plus-grant" ? `@${login}: ${tierName} выдан на ${term}.` : `@${login}: ручная выдача снята.`);
      if (action === "plus-revoke") setPlusLogin("");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось изменить подписку.");
    } finally {
      setBusy("");
    }
  }

  async function giftPlus(player: EarlyPlayer, grant: boolean) {
    const question = grant
      ? `Подарить @${player.login} PLUS на год? ${player.plusUntil ? "Год добавится после уже оплаченного PLUS." : "Год начнётся сейчас."}`
      : `Отменить подарок @${player.login}? С подписки снимется оставшаяся часть подаренного года.`;
    if (!window.confirm(question)) return;
    setBusy(`gift-${player.userId}`);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/admin/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "gift-plus", userId: player.userId, grant }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.error ?? "Не удалось изменить подарок.");
      setMessage(grant ? `@${player.login}: PLUS на год подарен.` : `@${player.login}: подарок отменён.`);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось изменить подарок.");
    } finally {
      setBusy("");
    }
  }

  /* Подарить или забрать бесплатный пропуск у игрока первой десятки. */
  async function founderPass(player: EarlyPlayer, grant: boolean) {
    const question = grant
      ? `Подарить @${player.login} пропуск? Он сможет играть без оплаты.`
      : `Забрать подаренный пропуск у @${player.login}? Пока он его не оплатит, лаунчер не пустит его на сервер.`;
    if (!window.confirm(question)) return;
    setBusy(`pass-${player.userId}`);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/admin/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "founder-pass", userId: player.userId, grant }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.error ?? "Не удалось изменить пропуск.");
      setMessage(grant ? `@${player.login}: пропуск подарен.` : `@${player.login}: пропуск забран — теперь его нужно оплатить.`);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось изменить пропуск.");
    } finally {
      setBusy("");
    }
  }

  /* Освободить место в первой десятке (служебный или ошибочный аккаунт). */
  async function releaseSlot(player: EarlyPlayer) {
    if (!window.confirm(`Освободить место @${player.login}? Место займёт следующий одобренный игрок.${player.pass ? ` Пропуск у @${player.login} останется.` : ""}`)) return;
    setBusy(`release-${player.userId}`);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/admin/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "early-release", userId: player.userId }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.error ?? "Не удалось освободить место.");
      setMessage(`Место @${player.login} свободно.`);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось освободить место.");
    } finally {
      setBusy("");
    }
  }

  async function createPromo(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("promo-create");
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/admin/promo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: promoForm.code,
          discount: Number(promoForm.discount),
          activations: Number(promoForm.activations),
          /* Дата из поля — до конца выбранного дня. */
          expiresAt: promoForm.expiresAt ? `${promoForm.expiresAt}T23:59:59` : null,
          scope: promoForm.scope,
          note: promoForm.note,
        }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.error ?? "Не удалось создать промокод.");
      setMessage(`Промокод ${result.code} создан: −${result.discount}%, активаций ${result.activations}.`);
      setPromoForm({ code: "", discount: "20", activations: "10", expiresAt: "", scope: "any", note: "" });
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось создать промокод.");
    } finally {
      setBusy("");
    }
  }

  async function togglePromo(code: string, disabled: boolean) {
    if (disabled && !window.confirm(`Выключить промокод ${code}? Уже начатые оплаты не тронем.`)) return;
    setBusy(`promo-${code}`);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/admin/promo", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, disabled }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.error ?? "Не удалось изменить промокод.");
      setMessage(disabled ? `Промокод ${code} выключен.` : `Промокод ${code} снова работает.`);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось изменить промокод.");
    } finally {
      setBusy("");
    }
  }

  function giftRow(player: EarlyPlayer, limitReached: boolean, passLimitReached = false) {
    const working = busy === `gift-${player.userId}`;
    const passWorking = busy === `pass-${player.userId}`;
    const passLabel = player.pass ? EARLY_PASS[player.pass] ?? "пропуск ✓" : "без пропуска — оплачивает сам";
    const hype = player.hypeUntil ? `HYPE до ${when(player.hypeUntil)}, ` : "";
    const plusState = player.giftUntil
      ? `${hype}подписка до ${when(player.plusUntil)} — в ней подаренный год PLUS`
      : player.plusUntil
        ? `${hype}подписка до ${when(player.plusUntil)}`
        : player.gifted ? "подаренный год закончился" : "подписки нет";
    return (
      <li className={player.giftUntil ? "gift" : ""} key={player.userId}>
        <b>{player.position}.</b>
        <strong>@{player.login}{player.approved ? "" : " · анкета сейчас закрыта"}</strong>
        <span>{player.kind === "founder" ? `одобрен ${when(player.approvedAt)} · ` : ""}{passLabel}</span>
        <span>{plusState}</span>
        {player.giftUntil ? (
          <button type="button" className="undo" disabled={Boolean(busy)} onClick={() => void giftPlus(player, false)}>
            {working ? "ОТМЕНЯЕМ…" : "ОТМЕНИТЬ ПОДАРОК"}
          </button>
        ) : (
          <button type="button" disabled={Boolean(busy) || !player.approved || limitReached} onClick={() => void giftPlus(player, true)}>
            {working ? "ДАРИМ…" : player.gifted ? "ПОДАРИТЬ ЕЩЁ ГОД" : "ПОДАРИТЬ PLUS НА ГОД"}
          </button>
        )}
        {player.kind === "founder" && player.pass === "founder" ? (
          <button type="button" className="undo" disabled={Boolean(busy)} onClick={() => void founderPass(player, false)}>
            {passWorking ? "ЗАБИРАЕМ…" : "ЗАБРАТЬ ПРОПУСК"}
          </button>
        ) : player.kind === "founder" && !player.pass ? (
          <button type="button" disabled={Boolean(busy) || !player.approved || passLimitReached} onClick={() => void founderPass(player, true)}>
            {passWorking ? "ДАРИМ…" : "ПОДАРИТЬ ПРОПУСК"}
          </button>
        ) : null}
        <button type="button" className="undo" disabled={Boolean(busy)} onClick={() => void releaseSlot(player)}>
          {busy === `release-${player.userId}` ? "ОСВОБОЖДАЕМ…" : "ОСВОБОДИТЬ МЕСТО"}
        </button>
      </li>
    );
  }

  const s = data?.settings;
  const slots = data?.founderSlots ?? 10;
  const giftLimit = data?.founderGifts ?? 5;
  const passLimit = data?.founderPasses ?? 3;
  const pioneers = (data?.early ?? []).filter((player) => player.kind === "pioneer");
  const founders = (data?.early ?? []).filter((player) => player.kind === "founder");
  const giftedFounders = founders.filter((founder) => founder.gifted).length;
  const passFounders = founders.filter((founder) => founder.pass === "founder").length;
  return (
    <section className="admin-panel admin-payments">
      <div className="admin-panel-heading">
        <div><small>PAYMENTS.EXE</small><h2>ОПЛАТА</h2></div>
        <button type="button" className="communication-refresh" onClick={() => void load()}>↻ ОБНОВИТЬ</button>
      </div>
      {error ? <p className="form-message error-message">{error}</p> : null}
      {message ? <p className="form-message success-message">{message}</p> : null}
      {!data ? <p className="communication-empty">Загружаем…</p> : (
        <>
          <div className="admin-payments-status">
            <article className={data.configured ? "ok" : "warn"}>
              <small>ЮKASSA</small>
              <strong>{data.configured ? (data.test ? "ТЕСТОВЫЙ МАГАЗИН" : "БОЕВОЙ МАГАЗИН") : "КЛЮЧИ НЕ ДОБАВЛЕНЫ"}</strong>
              {data.test ? <span>Пока магазин тестовый, окно оплаты видят только администраторы: игроки видят окно «Оплата закрыта». Платите тестовыми картами ЮKassa (список — в документации ЮKassa, раздел «Тестирование»). Пропуск администратор может оплатить для проверки, даже если он сейчас не обязателен: ссылка «Тест для администратора» — в карточке пропуска на странице тарифов (/donation).</span> : null}
              <span>HTTP-уведомления в кабинете ЮKassa: <code>{WEBHOOK_URL}</code> — события payment.succeeded, payment.canceled, refund.succeeded.</span>
            </article>
            <article><small>ВЫРУЧКА (БЕЗ ТЕСТОВ)</small><strong>{money.format(data.totals.revenue)}</strong><span>{data.totals.payments} платежей</span></article>
            <article><small>ПОДПИСКА АКТИВНА</small><strong>{data.totals.activePlus}</strong><span>подписчиков{data.totals.activeHype ? `, из них HYPE: ${data.totals.activeHype}` : ""}</span></article>
            <article><small>ПРОПУСКОВ</small><strong>{data.totals.passes}</strong><span>всего выдано</span></article>
          </div>

          <div className="admin-payments-toggles">
            <article>
              <div>
                <h3>ПРИЁМ ОПЛАТЫ</h3>
                <p>Кнопки на странице доната открывают оплату через ЮKassa. Выключено — кнопки открывают окно «Оплата закрыта».</p>
              </div>
              <button type="button" className={s?.payments_enabled ? "on" : ""} disabled={Boolean(busy)} onClick={() => void toggle("paymentsEnabled", !s?.payments_enabled, s?.payments_enabled ? "Выключить приём оплаты?" : "Включить приём оплаты на сайте?")}>
                {s?.payments_enabled ? "ВКЛЮЧЕНО" : "ВЫКЛЮЧЕНО"}
              </button>
            </article>
            <article>
              <div>
                <h3>ПРОПУСК ОБЯЗАТЕЛЕН</h3>
                <p>Без пропуска лаунчер не пустит на сервер. При включении все уже одобренные игроки получат пропуск бесплатно. Пока выключено, пропуск не продаётся: сервер открыт всем одобренным.{s?.pass_required_since ? ` Включено ${when(s.pass_required_since)}.` : ""}</p>
              </div>
              <button type="button" className={s?.pass_required_since ? "on" : ""} disabled={Boolean(busy)} onClick={() => void toggle("passRequired", !s?.pass_required_since, s?.pass_required_since
                ? "Выключить требование пропуска? Сервер снова пустит всех одобренных игроков."
                : "Включить требование пропуска? Все уже одобренные игроки получат пропуск бесплатно, новые — после оплаты.")}>
                {s?.pass_required_since ? "ВКЛЮЧЕНО" : "ВЫКЛЮЧЕНО"}
              </button>
            </article>
            <article>
              <div>
                <h3>КОСМЕТИКА ТОЛЬКО С ПОДПИСКОЙ</h3>
                <p>Новые пиксельные шапки — только с подпиской (PLUS или HYPE), пони — только с HYPE. Когда тариф заканчивается, пони и шапка снимаются, но не удаляются и возвращаются при продлении. У тех, кто настроил их раньше, они останутся. Проверка занимает до минуты.{s?.plus_required_since ? ` Включено ${when(s.plus_required_since)}.` : ""}</p>
              </div>
              <button type="button" className={s?.plus_required_since ? "on" : ""} disabled={Boolean(busy)} onClick={() => void toggle("plusRequired", !s?.plus_required_since, s?.plus_required_since
                ? "Снять ограничение? Пони и шапки снова станут доступны всем."
                : "Закрыть косметику за подписку? Шапка — с PLUS или HYPE, пони — с HYPE. Уже настроенные пони и шапки останутся у игроков.")}>
                {busy === "plusRequired" ? "ПРОВЕРЯЕМ…" : s?.plus_required_since ? "ВКЛЮЧЕНО" : "ВЫКЛЮЧЕНО"}
              </button>
            </article>
            {s?.updated_by ? <small>Последнее изменение: {s.updated_by}, {when(s.updated_at)}. Переключатели меняет только владелец.</small> : <small>Переключатели меняет только владелец.</small>}
          </div>

          {data.early === undefined || data.early === null ? (
            <section className="admin-payments-founders">
              <h3>ПЕРВООТКРЫВАТЕЛИ И ПЕРВЫЕ {slots} ИГРОКОВ</h3>
              <p className="form-message error-message">Список пока недоступен — обновите страницу позже.</p>
            </section>
          ) : (
            <>
              <section className="admin-payments-founders">
                <h3>ПЕРВООТКРЫВАТЕЛИ</h3>
                <p>Игроки, которые были на сервере до запуска оплаты. У них отметка «Первооткрыватель» в профиле и бесплатный пропуск. PLUS сам не выдаётся — подарите, если решите: подарок — год PLUS, он встаёт после уже оплаченного времени подписки. Дарит и отменяет только владелец. HYPE выдаётся формой «Выдать подписку вручную» ниже.</p>
                {pioneers.length ? <ol>{pioneers.map((player) => giftRow(player, false))}</ol> : <p className="communication-empty">Первооткрывателей нет.</p>}
              </section>
              <section className="admin-payments-founders">
                <h3>ПЕРВЫЕ {slots} ИГРОКОВ</h3>
                <p>Следующие {slots} одобренных игроков (без владельцев и первооткрывателей) — место занимается само в момент одобрения и потом не меняется. Пропуск они оплачивают сами, как все: бесплатно — только тем {passLimit}, кому вы его подарите. PLUS на год можно подарить {giftLimit} из них.</p>
                <p><b>Пропуск подарен: {passFounders} из {passLimit} · PLUS подарен: {giftedFounders} из {giftLimit}</b></p>
                <ol>
                  {Array.from({ length: slots }, (_, index) => {
                    const founder = founders.find((row) => row.position === index + 1);
                    return founder
                      ? giftRow(founder, !founder.gifted && giftedFounders >= giftLimit, passFounders >= passLimit)
                      : <li className="empty" key={`slot-${index}`}><b>{index + 1}.</b><span>Место свободно — его займёт следующий одобренный игрок.</span></li>;
                  })}
                </ol>
              </section>
            </>
          )}

          <section className="admin-payments-founders">
            <h3>РАННИЙ ДОСТУП HYPE</h3>
            <p>Новые функции сайта можно сначала открыть подписчикам HYPE (это возможность тарифа), а потом всем. Администраторы видят их всегда. Меняет только владелец.</p>
            <ol>
              {features.map((feature) => (
                <li key={feature.key}>
                  <strong>{feature.title}</strong>
                  <span>{feature.description}</span>
                  <select
                    value={feature.audience}
                    disabled={Boolean(busy)}
                    aria-label={`Кому открыта функция «${feature.title}»`}
                    onChange={(event) => void setAudience(feature.key, event.target.value)}
                  >
                    <option value="admins">Только администраторы</option>
                    <option value="plus">Подписчики HYPE</option>
                    <option value="all">Все игроки</option>
                  </select>
                </li>
              ))}
            </ol>
          </section>

          <section className="admin-payments-founders admin-promo">
            <h3>ПРОМОКОДЫ</h3>
            <p>Скидка действует на то, что выбрано в поле «На что»: всё, только пропуск, любую подписку (PLUS и HYPE, месяц и год, в том числе подарок) или только HYPE. Один игрок пользуется кодом один раз; если оплата не прошла, активация возвращается. Создаёт и выключает только владелец.</p>
            <form className="admin-promo-form" onSubmit={createPromo}>
              <label>КОД<input
                value={promoForm.code}
                onChange={(event) => setPromoForm({ ...promoForm, code: event.target.value.toUpperCase() })}
                placeholder="ЛЕТО2026"
                maxLength={32}
                autoComplete="off"
                spellCheck={false}
                required
              /></label>
              <label>СКИДКА, %<input
                type="number" min={1} max={100}
                value={promoForm.discount}
                onChange={(event) => setPromoForm({ ...promoForm, discount: event.target.value })}
                required
              /></label>
              <label>АКТИВАЦИЙ<input
                type="number" min={1} max={100000}
                value={promoForm.activations}
                onChange={(event) => setPromoForm({ ...promoForm, activations: event.target.value })}
                required
              /></label>
              <label>ДЕЙСТВУЕТ ДО<input
                type="date"
                value={promoForm.expiresAt}
                onChange={(event) => setPromoForm({ ...promoForm, expiresAt: event.target.value })}
              /></label>
              <label>НА ЧТО<select
                value={promoForm.scope}
                onChange={(event) => setPromoForm({ ...promoForm, scope: event.target.value })}
              >
                <option value="any">Всё: пропуск и подписка</option>
                <option value="plus">Подписка: PLUS и HYPE</option>
                <option value="hype">Только HYPE</option>
                <option value="pass">Только пропуск</option>
              </select></label>
              <label className="admin-promo-note">ЗАМЕТКА<input
                value={promoForm.note}
                onChange={(event) => setPromoForm({ ...promoForm, note: event.target.value })}
                placeholder="для кого этот код"
                maxLength={120}
              /></label>
              <button type="submit" disabled={Boolean(busy)}>{busy === "promo-create" ? "СОЗДАЁМ…" : "СОЗДАТЬ КОД"}</button>
            </form>
            {promos.length ? (
              <table className="admin-promo-table">
                <thead><tr><th>Код</th><th>Скидка</th><th>Использован</th><th>До</th><th>На что</th><th /></tr></thead>
                <tbody>
                  {promos.map((promo) => (
                    <tr key={promo.code} className={promo.disabled_at ? "off" : ""}>
                      <td><b>{promo.code}</b>{promo.note ? <><br /><small>{promo.note}</small></> : null}</td>
                      <td>−{promo.discount}%</td>
                      <td>{promo.used} из {promo.activations}</td>
                      <td>{promo.expires_at ? when(promo.expires_at) : "без срока"}</td>
                      <td>{SCOPES[promo.scope] ?? promo.scope}</td>
                      <td>
                        <button type="button" disabled={Boolean(busy)} onClick={() => void togglePromo(promo.code, !promo.disabled_at)}>
                          {busy === `promo-${promo.code}` ? "…" : promo.disabled_at ? "ВКЛЮЧИТЬ" : "ВЫКЛЮЧИТЬ"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <p className="communication-empty">Промокодов пока нет.</p>}
          </section>

          <form className="admin-payments-grant" onSubmit={grant}>
            <LoginField id="pass-grant" label="ВЫДАТЬ ПРОПУСК ВРУЧНУЮ" value={passLogin} onChange={setPassLogin} />
            <button type="submit" disabled={Boolean(busy)}>{busy === "grant" ? "ВЫДАЁМ…" : "ВЫДАТЬ"}</button>
          </form>

          <form
            className="admin-payments-grant plus"
            onSubmit={(event) => { event.preventDefault(); void managePlus("plus-grant"); }}
          >
            <LoginField id="plus-grant" label="ВЫДАТЬ ПОДПИСКУ ВРУЧНУЮ" value={plusLogin} onChange={setPlusLogin} />
            <label className="admin-payments-term">
              ТАРИФ
              <select value={plusTier} disabled={Boolean(busy)} onChange={(event) => setPlusTier(event.target.value)}>
                <option value="plus">PLUS</option>
                <option value="hype">HYPE</option>
              </select>
            </label>
            <label className="admin-payments-term">
              СРОК
              <select value={plusMonths} disabled={Boolean(busy)} onChange={(event) => setPlusMonths(Number(event.target.value))}>
                {PLUS_TERMS.map((row) => <option key={row.months} value={row.months}>{row.label}</option>)}
              </select>
            </label>
            <button type="submit" disabled={Boolean(busy)}>{busy === "plus-grant" ? "ВЫДАЁМ…" : "ВЫДАТЬ"}</button>
            <button type="button" className="undo" disabled={Boolean(busy)} onClick={() => void managePlus("plus-revoke")}>
              {busy === "plus-revoke" ? "СНИМАЕМ…" : "СНЯТЬ"}
            </button>
            <p>
              Работает для любого одобренного игрока. Деньги не списываются, автопродление не включается.
              HYPE включается сразу и сдвигает оставшиеся дни PLUS на время после себя, PLUS встаёт в конец подписки.
              Игрок при следующем заходе увидит окно с поздравлением и коротким гидом по выданному тарифу.
              «Снять» убирает только неиспользованный остаток последней выдачи — оплаченные месяцы остаются.
            </p>
          </form>

          <div className="admin-payments-tables">
            <section>
              <h3>ПЛАТЕЖИ</h3>
              {data.payments.length ? <table>
                <thead><tr><th>Когда</th><th>Игрок</th><th>Что</th><th>Сумма</th><th>Статус</th></tr></thead>
                <tbody>{data.payments.map((row) => (
                  <tr key={row.id}>
                    <td>{when(row.paid_at ?? row.created_at)}</td>
                    <td>@{row.login}</td>
                    <td>{row.kind === "pass"
                      ? "Пропуск"
                      : `${row.tier === "hype" ? "HYPE" : "PLUS"}${row.plan === "year" ? ", год" : ""}${row.recipient_login ? ` → @${row.recipient_login}` : row.recurring ? " (авто)" : ""}`}
                      {row.promo_code ? ` · ${row.promo_code} −${row.discount ?? 0}%` : ""}{row.test ? " · тест" : ""}</td>
                    <td>{Number(row.amount)} {row.currency === "USD" ? "$" : row.currency === "EUR" ? "€" : "₽"}{row.provider === "lava" ? " · lava" : ""}</td>
                    <td className={row.status}>{STATUS[row.status] ?? row.status}{row.cancellation_reason ? ` · ${row.cancellation_reason}` : ""}</td>
                  </tr>
                ))}</tbody>
              </table> : <p className="communication-empty">Платежей пока нет.</p>}
            </section>
            <section>
              <h3>ПОДПИСКИ</h3>
              {data.subscriptions.length ? <table>
                <thead><tr><th>Игрок</th><th>Тариф</th><th>До</th><th>Автопродление</th></tr></thead>
                <tbody>{data.subscriptions.map((row) => (
                  <tr key={row.login}>
                    <td>@{row.login}</td>
                    <td>{row.tier === "hype" ? "HYPE" : "PLUS"}</td>
                    <td>{row.hype_until ? `HYPE до ${when(row.hype_until)}${Date.parse(row.hype_until) < Date.parse(row.current_period_end) ? `, PLUS до ${when(row.current_period_end)}` : ""}` : when(row.current_period_end)}</td>
                    <td>{row.auto_renew ? `${row.renew_tier === "hype" ? "HYPE" : "PLUS"}${row.payment_method_title ? ` · ${row.payment_method_title}` : ""}` : "нет"}{row.failed_attempts ? ` · ошибок: ${row.failed_attempts}` : ""}</td>
                  </tr>
                ))}</tbody>
              </table> : <p className="communication-empty">Подписчиков пока нет.</p>}
              <h3>ПРОПУСКА</h3>
              {data.passes.length ? <table>
                <thead><tr><th>Игрок</th><th>Как</th><th>Когда</th></tr></thead>
                <tbody>{data.passes.map((row) => (
                  <tr key={row.login}><td>@{row.login}</td><td>{SOURCE[row.source] ?? row.source}</td><td>{when(row.granted_at)}</td></tr>
                ))}</tbody>
              </table> : <p className="communication-empty">Пропусков пока нет.</p>}
            </section>
          </div>
        </>
      )}
    </section>
  );
}
