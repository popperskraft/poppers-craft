"use client";

import Link from "next/link";
import { type ReactNode, useEffect, useState } from "react";
import "./payments.css";

/* «Профиль → Подписка»: пропуск, подписка (до какого числа, когда и сколько
   спишется, автопродление и карта) и история платежей. afterPlan — что
   показать сразу под подпиской (список «что даёт подписка»). */

type Summary = {
  available: boolean;
  test: boolean;
  isAdmin?: boolean;
  approved: boolean;
  passRequired: boolean;
  hasPass: boolean;
  passSource: "payment" | "legacy" | "admin" | "founder" | "pioneer" | null;
  serverAccess: boolean;
  passForSale?: boolean;
  plusRequired: boolean;
  /* until — конец всей подписки, hypeUntil — конец отрезка HYPE, renewTier —
     тариф автопродления, renewsAt — когда оно спишет оплату. */
  plus: {
    active: boolean;
    until: string | null;
    hypeUntil?: string | null;
    tier?: "plus" | "hype";
    renewTier?: "plus" | "hype";
    renewsAt?: string | null;
    autoRenew: boolean;
    renewsItself?: boolean;
    card: string | null;
    failedAttempts: number;
    gift?: boolean;
  } | null;
  prices?: { pass: number; plus: number; hype: number; plusYear: number; hypeYear: number; yearDiscount: number };
  early?: { kind: "pioneer" | "founder"; position: number; plusGiftUntil: string | null } | null;
  legacy: { pony: boolean; headerArt: boolean };
  history: Array<{ id: string; kind: "pass" | "plus"; amount: number; status: string; recurring: boolean; plan?: "month" | "year"; tier?: "plus" | "hype"; created_at: string; paid_at: string | null; recipientLogin?: string | null }>;
  giftsReceived?: Array<{ from: string; at: string }>;
};

const STATUS: Record<string, string> = {
  created: "создан",
  pending: "ждёт оплаты",
  waiting_for_capture: "обрабатывается",
  succeeded: "оплачен",
  canceled: "отменён",
  failed: "не прошёл",
};

const PASS_SOURCE: Record<string, string> = {
  payment: "оплачен",
  legacy: "выдан бесплатно — вы играли до запуска оплаты",
  admin: "выдан администрацией",
  founder: "выдан бесплатно — вы среди первых 10 игроков сервера",
  pioneer: "выдан бесплатно — вы первооткрыватель сервера",
};

const date = new Intl.DateTimeFormat("ru-RU", { dateStyle: "long" });
const dateTime = new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "short" });
const when = (value: string | null, format = date) => (value && Number.isFinite(Date.parse(value)) ? format.format(new Date(value)) : "—");

export function PaymentsPanel({ afterPlan }: { afterPlan?: ReactNode } = {}) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/payments", { cache: "no-store" })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
        setSummary(result as Summary);
      })
      .catch((caught) => setError(caught instanceof Error && caught.message ? caught.message : "Не удалось загрузить оплату."));
  }, []);

  async function manage(action: "auto-renew-off" | "auto-renew-on" | "forget-card", confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(action);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/payments/plus", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.error ?? "Не удалось сохранить изменения.");
      setSummary(result.summary as Summary);
      setMessage(action === "auto-renew-on" ? "Автопродление включено." : action === "forget-card" ? "Карта отвязана, автопродление выключено." : "Автопродление выключено. Подписка доработает до конца оплаченного срока.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось сохранить изменения.");
    } finally {
      setBusy("");
    }
  }

  if (!summary) return error ? <p className="form-message error-message">{error}</p> : <p>Загружаем…</p>;
  const plus = summary.plus;
  const needsPass = summary.approved && !summary.serverAccess;
  const prices = { pass: summary.prices?.pass ?? 499, plus: summary.prices?.plus ?? 199, hype: summary.prices?.hype ?? 599 };
  /* Тариф прямо сейчас, тариф автопродления и их цены — для подписей. */
  const active = Boolean(plus?.active);
  const tier = active ? plus?.tier ?? "plus" : "plus";
  const tierName = tier === "hype" ? "POPPERS HYPE" : "POPPERS+";
  const renewTier = plus?.renewTier ?? tier;
  const renewName = renewTier === "hype" ? "HYPE" : "PLUS";
  /* Продлевается сам — этот тариф продлевать вручную нечего (кроме случая,
     когда последнее автосписание не прошло). */
  const renewsItself = Boolean(active && (plus?.renewsItself ?? (plus?.autoRenew && !plus?.failedAttempts)));
  /* HYPE кончится раньше подписки — дальше до конца идёт PLUS. */
  const plusAfterHype = tier === "hype" && plus?.hypeUntil && plus.until && Date.parse(plus.hypeUntil) < Date.parse(plus.until);
  const canBuy = summary.available && summary.approved && !needsPass;

  return (
    <div className="payments-panel">
      {!summary.available ? <p className="payments-note">Оплата на сайте ещё не открыта. Когда откроется, здесь появятся пропуск и подписка.</p> : null}
      {summary.test && summary.available ? <p className="payments-note test">Тестовый режим: платежи не настоящие.</p> : null}

      <article className="payments-card">
        <small>ПРОПУСК POPPERSCRAFT</small>
        {summary.hasPass ? (
          <p><b>Есть ✓</b> — {PASS_SOURCE[summary.passSource ?? "payment"] ?? PASS_SOURCE.payment}.</p>
        ) : !summary.approved ? (
          /* Вошедший без одобренной анкеты: подать её из-под входа нельзя,
             поэтому ссылки «к анкете» здесь нет. */
          <p>{summary.isAdmin
            ? "У аккаунта администратора нет анкеты игрока — пропуск и подписка оформляются на игровой аккаунт."
            : "У аккаунта нет одобренной анкеты, поэтому пропуск недоступен. Если это ошибка — напишите в поддержку."}</p>
        ) : needsPass ? (
          <p><b>Нет.</b> Чтобы заходить на сервер, оплатите пропуск: {prices.pass} ₽ один раз. {summary.available ? <Link href="/donation?plan=pass">Оплатить →</Link> : "Оплата скоро откроется."}</p>
        ) : (
          <p><b>Доступ открыт ✓</b> Сейчас сервер открыт всем одобренным игрокам — платить за пропуск не нужно. Если пропуск станет обязательным, вы получите его бесплатно.</p>
        )}
      </article>

      <article className={tier === "hype" && active ? "payments-card plus is-hype" : "payments-card plus"}>
        <small>{active ? tierName : "ПОДПИСКА"}</small>
        {active && plus ? (
          <>
            <p>{tier === "hype"
              ? <><b>HYPE активен</b> до {when(plus.hypeUntil ?? plus.until)}{plusAfterHype ? <>, дальше до {when(plus.until)} — PLUS</> : null}.</>
              : <><b>PLUS активен</b> до {when(plus.until)}.</>}
              {plus.gift ? " Год PLUS подарила администрация — спасибо, что вы с нами!" : ""}</p>
            <p>{plus.autoRenew
              ? `Продлится автоматически: ${renewName} за ${renewTier === "hype" ? prices.hype : prices.plus} ₽ в месяц с карты ${plus.card ?? ""}${plus.renewsAt ? ` — следующее списание ${when(plus.renewsAt)}` : ""}.`
              : plus.gift ? "Платить ничего не нужно: после этой даты подписку можно будет продлить здесь же." : "Автопродление выключено — после этой даты подписка закончится. За три дня напомним на почту, если она указана."}</p>
            {plus.failedAttempts > 0 && plus.autoRenew ? <p className="form-message error-message">Последнее списание не прошло. Попробуем ещё раз{summary.available ? <>; можно и <Link href={`/donation?plan=${renewTier}`}>продлить вручную</Link></> : ""}.</p> : null}
            <p className="payments-note">{tier === "hype"
              ? <>Обводка, тема карточки, живая шапка и закреплённый пост настраиваются в <Link href="/profile?edit=1#plus-ring">редактировании профиля</Link>.</>
              : <>Обводка и тема карточки настраиваются в <Link href="/profile?edit=1#plus-ring">редактировании профиля</Link>. Пони, своя пластинка каждый день, живая шапка и радужная обводка — в HYPE.</>}</p>
          </>
        ) : plus ? (
          <p>Подписка закончилась {when(plus.until)}. {canBuy ? <Link href="/donation">Продлить →</Link> : <Link href="/donation">Подробнее →</Link>}</p>
        ) : (
          <p>
            Подписки нет. PLUS — оформление профиля (значок у ника, обводка, темы карточки, своя шапка, стикеры) за {prices.plus} ₽ в месяц.
            HYPE — всё это, гардероб в лаунчере на пять скинов человека и пять пони, префикс и цвет ника в чате, свои строки в списке серверов, сообщение о смерти, размер персонажа, своя пластинка каждый день, анимированная шапка и радужная обводка за {prices.hype} ₽ в месяц. <Link href="/donation">Подробнее →</Link>
          </p>
        )}
        {(summary.legacy.pony || summary.legacy.headerArt) && summary.plusRequired ? (
          <p className="payments-note">Вы настроили {[summary.legacy.pony ? "пони" : "", summary.legacy.headerArt ? "шапку профиля" : ""].filter(Boolean).join(" и ")} до запуска подписки — это остаётся с вами бесплатно.</p>
        ) : null}
        <div className="profile-actions payments-actions">
          {plus?.autoRenew ? (
            <button type="button" disabled={Boolean(busy)} onClick={() => void manage("auto-renew-off", `Отключить автопродление ${renewName}? Подписка доработает до конца оплаченного срока.`)}>
              {busy === "auto-renew-off" ? "ОТКЛЮЧАЕМ…" : "ОТКЛЮЧИТЬ АВТОПРОДЛЕНИЕ"}
            </button>
          ) : plus?.card && plus.active ? (
            <button type="button" disabled={Boolean(busy)} onClick={() => void manage("auto-renew-on", renewTier === "hype" && tier !== "hype"
              ? `Включить автопродление HYPE? HYPE уже закончился, поэтому ${prices.hype} ₽ спишутся с карты ${plus.card} в ближайшие минуты и HYPE продолжится ещё на месяц.`
              : `Включить автопродление ${renewName}: ${renewTier === "hype" ? prices.hype : prices.plus} ₽ в месяц с карты ${plus.card}?`)}>
              {busy === "auto-renew-on" ? "ВКЛЮЧАЕМ…" : `ВКЛЮЧИТЬ АВТОПРОДЛЕНИЕ ${renewName}`}
            </button>
          ) : null}
          {plus?.card ? (
            <button type="button" disabled={Boolean(busy)} onClick={() => void manage("forget-card", "Отвязать карту? Автопродление выключится.")}>
              {busy === "forget-card" ? "ОТВЯЗЫВАЕМ…" : "ОТВЯЗАТЬ КАРТУ"}
            </button>
          ) : null}
          {/* Кнопки покупки — только когда купить действительно можно: оплата
              открыта, пропуск не мешает, этот тариф не продлевается сам,
              а PLUS не предлагаем, пока идёт HYPE — он уже включает PLUS. */}
          {canBuy && !(active && tier === "hype") && !(renewsItself && renewTier === "plus") ? (
            <Link className="profile-primary-action" href="/donation?plan=plus">{active ? "ПРОДЛИТЬ PLUS" : "ОФОРМИТЬ PLUS"}</Link>
          ) : null}
          {canBuy && !(active && tier === "hype" && renewsItself && renewTier === "hype") ? (
            <Link className="profile-primary-action hype" href="/donation?plan=hype">{!active ? "ОФОРМИТЬ HYPE" : tier === "hype" ? "ПРОДЛИТЬ HYPE" : "ПЕРЕЙТИ НА HYPE"}</Link>
          ) : null}
          {summary.available && needsPass ? <Link className="profile-primary-action" href="/donation?plan=pass">ОПЛАТИТЬ ПРОПУСК</Link> : null}
        </div>
      </article>

      {message ? <p className="form-message success-message">{message}</p> : null}
      {error ? <p className="form-message error-message">{error}</p> : null}

      {afterPlan}

      <article className="payments-card">
        <small>ИСТОРИЯ ПЛАТЕЖЕЙ</small>
        {summary.history.length ? (
          <ul className="payments-history">
            {summary.history.map((item) => (
              <li key={item.id}>
                <span>{when(item.paid_at ?? item.created_at, dateTime)}</span>
                <span>{item.kind === "pass"
                  ? "Пропуск"
                  : `${item.tier === "hype" ? "HYPE" : "PLUS"}${item.plan === "year" ? ", год" : ""}${item.recipientLogin ? ` в подарок @${item.recipientLogin}` : item.recurring ? ", автопродление" : ""}`}</span>
                <span>{item.amount} ₽</span>
                <b className={item.status}>{STATUS[item.status] ?? item.status}</b>
              </li>
            ))}
          </ul>
        ) : <p>Платежей пока не было.</p>}
        {summary.giftsReceived?.length ? (
          <p className="payments-note">Подарки от друзей: {summary.giftsReceived.map((gift) => `@${gift.from} (${when(gift.at)})`).join(", ")}.</p>
        ) : null}
        <p className="payments-note">Вопросы по оплате и возвратам — <a href="https://t.me/PoppersCraftAuthBot" target="_blank" rel="noreferrer">@PoppersCraftAuthBot</a>. <Link href="/rules#payments">Условия оплаты</Link>.</p>
      </article>
    </div>
  );
}
