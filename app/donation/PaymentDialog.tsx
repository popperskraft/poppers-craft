"use client";

import Link from "next/link";
import { type ReactNode, useEffect, useState } from "react";
import { SUPPORT_BOT_URL } from "@/lib/viewer-stage";

/* Окно оплаты на странице доната. Показывает то, что нужно именно этому
   игроку: войти, сначала анкету, сначала пропуск — или саму оплату с
   согласием на условия и (для подписки) на автопродление. Если покупать
   нечего (доступ уже открыт, тариф продлевается сам), окно только
   объясняет это и ничего не предлагает оплатить.

   Время подписки идёт двумя отрезками: сначала HYPE, потом PLUS. HYPE
   включается сразу и сдвигает оставшиеся дни PLUS, PLUS встаёт в конец. */

export type Plan = "pass" | "plus" | "hype";

export type PaymentSummary = {
  authenticated: boolean;
  available: boolean;
  /* Оплата картой не из России через lava.top (r103). */
  lava?: boolean;
  needsMfa?: boolean;
  isAdmin?: boolean;
  test?: boolean;
  prices?: { pass: number; plus: number; hype?: number; plusYear?: number; hypeYear?: number; yearDiscount?: number };
  approved?: boolean;
  passRequired?: boolean;
  hasPass?: boolean;
  passSource?: "payment" | "legacy" | "admin" | "founder" | "pioneer" | null;
  serverAccess?: boolean;
  passForSale?: boolean;
  plus?: {
    active: boolean;
    until: string | null;
    hypeUntil?: string | null;
    tier?: "plus" | "hype";
    renewTier?: "plus" | "hype";
    autoRenew: boolean;
    renewsItself?: boolean;
    card: string | null;
    failedAttempts?: number;
  } | null;
};

const TITLES: Record<Plan, string> = { pass: "ПРОПУСК POPPERSCRAFT", plus: "POPPERS+", hype: "POPPERS HYPE" };

/* Откуда у игрока пропуск — текст окна «Пропуск уже есть». */
const PASS_NOTES: Record<string, string> = {
  payment: "Доступ к серверу открыт. Заходите через лаунчер.",
  legacy: "Вы играли до запуска оплаты — пропуск выдан бесплатно. Спасибо, что с нами!",
  pioneer: "Вы первооткрыватель сервера — пропуск выдан бесплатно. Спасибо, что с нами с самого начала!",
  founder: "Вы среди первых 10 игроков сервера — пропуск выдан бесплатно. Спасибо, что пришли одними из первых!",
  admin: "Пропуск выдан администрацией. Заходите через лаунчер.",
};

const dateFormat = new Intl.DateTimeFormat("ru-RU", { dateStyle: "long" });
const formatDate = (value: string | null | undefined) => (value && Number.isFinite(Date.parse(value)) ? dateFormat.format(new Date(value)) : "");

/* Что даёт тариф — одна строка для окна покупки и подарка. */
const TIER_PERKS: Record<"plus" | "hype", string> = {
  plus: "значок у ника, обводка профиля, темы карточки, своя пиксельная шапка и стикеры",
  hype: "всё из PLUS и сверху гардероб в лаунчере на пять скинов человека и пять скинов пони, префикс в чате, цвет ника с градиентом и флаг, две свои строки в списке серверов, своё сообщение о смерти, размер персонажа от 25% до 300%, своя пластинка каждый день, анимированная шапка до восьми кадров, радужная обводка, закреплённый пост и новые функции раньше остальных",
};

export function PaymentDialog({ plan, summary, giftTo = null, onClose, onLogin, onSwitch, onGiftTier }: {
  plan: Plan;
  summary: PaymentSummary;
  /* Ник игрока, которому дарят подписку. */
  giftTo?: string | null;
  onClose: () => void;
  onLogin: () => void;
  onSwitch: (plan: Plan) => void;
  /* Сменить тариф подарка, не теряя получателя. */
  onGiftTier?: (plan: "plus" | "hype") => void;
}) {
  const [consent, setConsent] = useState(false);
  const [autoRenew, setAutoRenew] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  /* Срок PLUS: месяц или год со скидкой. */
  const [term, setTerm] = useState<"month" | "year">("month");
  const [promoInput, setPromoInput] = useState("");
  const [promo, setPromo] = useState<{ code: string; discount: number } | null>(null);
  const [promoNote, setPromoNote] = useState("");
  const [promoBusy, setPromoBusy] = useState(false);
  const plus = summary.plus;
  /* Тариф окна: PLUS или HYPE. Цены приходят с сервера. */
  const tier = plan === "hype" ? "hype" : "plus";
  const activeTier = plus?.active ? plus.tier ?? "plus" : null;
  const renewTier = plus?.renewTier ?? activeTier ?? "plus";
  /* Своё автопродление этого тарифа уже идёт. */
  const renewsThis = Boolean(plus?.renewsItself) && renewTier === tier;
  /* Отрезок HYPE кончается раньше подписки — после него идут дни PLUS. */
  const plusAfterHype = activeTier === "hype" && plus?.hypeUntil && plus.until && Date.parse(plus.hypeUntil) < Date.parse(plus.until);
  const yearPrice = (tier === "hype" ? summary.prices?.hypeYear : summary.prices?.plusYear) ?? (tier === "hype" ? 5750 : 1910);
  const yearDiscount = summary.prices?.yearDiscount ?? 20;
  const monthPrice = (tier === "hype" ? summary.prices?.hype : summary.prices?.plus) ?? (tier === "hype" ? 599 : 199);
  const base = plan === "pass" ? summary.prices?.pass ?? 499 : term === "year" ? yearPrice : monthPrice;
  const price = promo ? Math.max(1, Math.round((base * (100 - promo.discount)) / 100)) : base;

  /* Смена срока меняет и цену — промокод проверяем заново при оплате. */
  async function applyPromo() {
    const code = promoInput.trim().toUpperCase();
    if (!code || promoBusy) return;
    setPromoBusy(true);
    setPromoNote("");
    try {
      const response = await fetch(`/api/payments/promo?code=${encodeURIComponent(code)}&kind=${plan}`, { cache: "no-store" });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.error ?? "Промокод не подошёл.");
      setPromo({ code: result.code, discount: result.discount });
      setPromoNote(`Промокод ${result.code}: −${result.discount}%`);
    } catch (caught) {
      setPromo(null);
      setPromoNote(caught instanceof Error ? caught.message : "Промокод не подошёл.");
    } finally {
      setPromoBusy(false);
    }
  }

  /* Вернулись со страницы ЮKassa кнопкой браузера «Назад», и страница
     восстановилась из кэша: окно не должно остаться в «ОТКРЫВАЕМ ОПЛАТУ…». */
  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) setBusy(false);
    };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  async function pay(foreign?: "USD" | "EUR") {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          /* На сервере вид оплаты — пропуск или подписка, а тариф отдельно. */
          plan: plan === "pass" ? "pass" : "plus",
          tier,
          consent,
          autoRenew: plan !== "pass" && !giftTo && term === "month" && autoRenew,
          gift: giftTo ?? undefined,
          term: plan === "pass" ? "month" : term,
          promo: foreign ? undefined : promo?.code,
          ...(foreign ? { provider: "lava", currency: foreign, language: document.documentElement.lang === "ru" ? "RU" : "EN" } : {}),
        }),
      });
      const result = await response.json().catch(() => null) as { confirmationUrl?: string; error?: string; loginRequired?: boolean } | null;
      if (result?.loginRequired) { onLogin(); return; }
      if (!response.ok || !result?.confirmationUrl) throw new Error(result?.error ?? "Не получилось начать оплату.");
      /* Страница оплаты ЮKassa; после неё вернёмся на /donation/return. */
      window.location.assign(result.confirmationUrl);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не получилось начать оплату.");
      setBusy(false);
    }
  }

  /* Переключатель срока и поле промокода — общие для покупки и подарка. */
  const termSwitch = (
    <div className="dp-terms" role="group" aria-label="Срок подписки">
      <button type="button" className={term === "month" ? "on" : ""} onClick={() => { setTerm("month"); setPromo(null); setPromoNote(""); }}>
        МЕСЯЦ · {monthPrice} ₽
      </button>
      <button type="button" className={term === "year" ? "on" : ""} onClick={() => { setTerm("year"); setPromo(null); setPromoNote(""); }}>
        ГОД · {yearPrice} ₽ <b>−{yearDiscount}%</b>
      </button>
    </div>
  );

  const promoField = (
    <div className="dp-promo">
      <label>
        ПРОМОКОД
        <input
          value={promoInput}
          onChange={(event) => { setPromoInput(event.target.value.toUpperCase()); setPromo(null); setPromoNote(""); }}
          placeholder="если есть"
          maxLength={32}
          autoComplete="off"
          spellCheck={false}
        />
      </label>
      <button type="button" disabled={!promoInput.trim() || promoBusy} onClick={() => void applyPromo()}>
        {promoBusy ? "ПРОВЕРЯЕМ…" : "ПРИМЕНИТЬ"}
      </button>
      {promoNote ? <small className={promo ? "ok" : "bad"}>{promoNote}</small> : null}
    </div>
  );

  /* Подарок другу: своя подписка и свой пропуск тут ни при чём —
     проверяем только вход, анкету и то, что оплата открыта. */
  const gift = giftTo ? giftTo.replace(/^@/, "") : null;
  const tierName = tier === "hype" ? "POPPERS HYPE" : "POPPERS+";
  let body: ReactNode;
  if (gift && summary.authenticated && summary.approved && summary.available) {
    body = <>
      <h2 id="dp-dialog-title">Подарить подписку</h2>
      {/* Тариф подарка — PLUS или HYPE; получатель остаётся тем же. */}
      <div className="dp-terms" role="group" aria-label="Тариф подарка">
        {(["plus", "hype"] as const).map((option) => (
          <button type="button" key={option} className={tier === option ? "on" : ""} onClick={() => { setPromo(null); setPromoNote(""); onGiftTier?.(option); }}>
            {option === "hype" ? "HYPE" : "PLUS"}
          </button>
        ))}
      </div>
      <p className="dp-dialog-price">
        <b>{price} ₽</b> подарок{promo ? <span className="dp-old-price">{base} ₽</span> : null}
      </p>
      {termSwitch}
      <p>@{gift} получит {term === "year" ? "год" : "месяц"} {tierName}: {TIER_PERKS[tier]}. Автопродления у подарка нет. Если у @{gift} уже есть подписка, подаренное время добавится к ней и не пропадёт.</p>
      {promoField}
      <label className="dp-check">
        <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />
        <span>Я принимаю <Link href="/rules#payments" target="_blank">условия оплаты</Link> и прошу выдать {tier === "hype" ? "HYPE" : "PLUS"} игроку @{gift} сразу после оплаты.</span>
      </label>
      {summary.test ? <p className="dp-dialog-test">Тестовый режим: настоящие деньги не списываются.</p> : null}
      {error ? <p className="form-message error-message">{error}</p> : null}
      <button className={tier === "hype" ? "dp-buy hype" : "dp-buy pink"} type="button" disabled={!consent || busy} onClick={() => void pay()}>
        {busy ? "ОТКРЫВАЕМ ОПЛАТУ…" : `ПОДАРИТЬ ЗА ${price} ₽ →`}
      </button>
      <p className="dp-fine">Оплата проходит на защищённой странице ЮKassa. Данные карты мы не видим и не храним.</p>
    </>;
  } else if (!summary.authenticated && summary.needsMfa) {
    body = <>
      <h2 id="dp-dialog-title">Подтвердите вход</h2>
      <p>Вы вошли, но ещё не ввели код двухфакторной защиты. После подтверждения окно оплаты откроется снова.</p>
      <Link className="dp-buy dp-buy-link" href={`/mfa?next=${encodeURIComponent(`/donation?plan=${plan}`)}`}>ВВЕСТИ КОД →</Link>
    </>;
  } else if (!summary.authenticated) {
    body = <>
      <h2 id="dp-dialog-title">Сначала войдите</h2>
      <p>Оплата привязывается к аккаунту игрока. Войдите — и окно оплаты откроется снова.</p>
      <button className="dp-buy" type="button" onClick={onLogin}>ВОЙТИ →</button>
      <div className="dp-dialog-links"><Link href="/#waitlist">Ещё не на сервере? Подать анкету</Link></div>
    </>;
  } else if (!summary.approved) {
    /* Вошедший без одобренной анкеты — это администратор без игрового
       аккаунта или закрытый аккаунт. Анкету из-под входа не подать,
       поэтому ссылка «к анкете» здесь никуда бы не вела. */
    body = summary.isAdmin ? <>
      <h2 id="dp-dialog-title">Нужен аккаунт игрока</h2>
      <p>У этого аккаунта администратора нет анкеты игрока. Пропуск и подписка оформляются на игровой аккаунт — войдите под ним.</p>
      <button className="dp-buy" type="button" onClick={onClose}>ПОНЯТНО</button>
    </> : <>
      <h2 id="dp-dialog-title">Оплата недоступна</h2>
      <p>У этого аккаунта нет одобренной анкеты, поэтому оплатить пропуск или подписку нельзя. Если это ошибка — напишите в поддержку.</p>
      <a className="dp-buy dp-buy-link" href={SUPPORT_BOT_URL} target="_blank" rel="noreferrer">ПОДДЕРЖКА ↗</a>
    </>;
  } else if (gift) {
    /* Подарок, а оплата закрыта: своя подписка и свой пропуск тут ни при чём. */
    body = <>
      <h2 id="dp-dialog-title">Подарок чуть позже</h2>
      <p>Оплата на сайте сейчас не принимается, поэтому подарить подписку @{gift} пока нельзя. Загляните позже — кнопка на карточке игрока никуда не денется.</p>
      <button className="dp-buy" type="button" onClick={onClose}>ПОНЯТНО</button>
    </>;
  } else if (plan === "pass" && summary.hasPass) {
    body = <>
      <h2 id="dp-dialog-title">Пропуск уже есть</h2>
      <p>{PASS_NOTES[summary.passSource ?? "payment"] ?? PASS_NOTES.payment}</p>
      <button className="dp-buy blue" type="button" onClick={() => onSwitch("plus")}>ПОСМОТРЕТЬ ПОДПИСКУ →</button>
    </>;
  } else if (plan === "pass" && !summary.passForSale) {
    body = <>
      <h2 id="dp-dialog-title">Пропуск не нужен</h2>
      <p>Сейчас сервер открыт всем одобренным игрокам — доступ у вас уже есть, платить не за что. Если пропуск станет обязательным, вы получите его бесплатно.</p>
      <button className="dp-buy blue" type="button" onClick={() => onSwitch("plus")}>ПОСМОТРЕТЬ ПОДПИСКУ →</button>
    </>;
  } else if (plan !== "pass" && summary.passRequired && !summary.hasPass) {
    body = <>
      <h2 id="dp-dialog-title">Сначала пропуск</h2>
      <p>Подписка работает поверх пропуска POPPERSCRAFT. Оплатите пропуск, а потом возвращайтесь за оформлением.</p>
      <button className="dp-buy" type="button" onClick={() => onSwitch("pass")}>К ПРОПУСКУ →</button>
    </>;
  } else if (plan === "plus" && activeTier === "hype") {
    body = <>
      <h2 id="dp-dialog-title">У вас HYPE</h2>
      <p>Тариф HYPE включает всё из PLUS, отдельно оформлять его не нужно. HYPE действует до {formatDate(plus?.hypeUntil ?? plus?.until)}{plusAfterHype ? `, а после него до ${formatDate(plus?.until)} — PLUS` : ""}. Оформить PLUS можно будет, когда HYPE закончится.</p>
      <Link className="dp-buy dp-buy-link blue" href="/profile?tab=subscription">УПРАВЛЯТЬ ПОДПИСКОЙ →</Link>
    </>;
  } else if (plan !== "pass" && plus?.active && activeTier === tier && ((renewsThis && term === "month") || !summary.available)) {
    const tierUntil = tier === "hype" ? plus.hypeUntil ?? plus.until : plus.until;
    body = <>
      <h2 id="dp-dialog-title">{tier === "hype" ? "HYPE уже с вами" : "PLUS уже с вами"}</h2>
      <p>{renewsThis
        ? `${tier === "hype" ? "HYPE" : "Подписка"} действует до ${formatDate(tierUntil)} и продлится сама${plus.card ? ` (${plus.card})` : ""}. Отключить автопродление можно в настройках профиля; оплатить сразу год можно и сейчас — тогда помесячное продление выключится.`
        : `${tier === "hype" ? "HYPE" : "Подписка"} действует до ${formatDate(tierUntil)}. Продлить можно будет здесь, когда оплата снова откроется.`}</p>
      {renewsThis && summary.available ? (
        <button className={tier === "hype" ? "dp-buy hype" : "dp-buy blue"} type="button" onClick={() => setTerm("year")}>ОПЛАТИТЬ ГОД →</button>
      ) : null}
      <Link className="dp-buy dp-buy-link blue" href="/profile?tab=subscription">УПРАВЛЯТЬ ПОДПИСКОЙ →</Link>
    </>;
  } else if (!summary.available) {
    body = <>
      <h2 id="dp-dialog-title">Оплата закрыта</h2>
      <p>Оплата на сайте сейчас не принимается. Загляните позже — или напишите в поддержку.</p>
      <button className="dp-buy" type="button" onClick={onClose}>ПОНЯТНО</button>
    </>;
  } else {
    const renewal = plan !== "pass" && Boolean(plus?.active) && activeTier === tier;
    const upgrade = plan === "hype" && Boolean(plus?.active) && activeTier === "plus";
    const failed = renewal && Boolean(plus?.failedAttempts);
    const name = tier === "hype" ? "HYPE" : "PLUS";
    const termWord = term === "year" ? "год" : "месяц";
    /* Своё автопродление уже идёт: что с ним станет после этой оплаты. */
    const renewing = Boolean(plus?.renewsItself);
    const autoNote = plan === "pass" || !renewing
      ? ""
      : term === "year"
        ? " Год оплачивается одним платежом, поэтому помесячное автопродление выключится."
        : renewTier !== tier && autoRenew
          ? ` Автопродление ${renewTier === "hype" ? "HYPE" : "PLUS"} заменится автопродлением ${name}.`
          : renewTier !== tier
            ? ` Автопродление ${renewTier === "hype" ? "HYPE" : "PLUS"} сохранится и сработает, когда закончатся оплаченные дни.`
            : "";
    const whatYouGet = tier === "hype"
      ? `Всё из PLUS и сверху то, что видно в игре: гардероб в лаунчере на пять скинов человека и пять скинов пони, префикс в чате, цвет ника с градиентом и флаг, две свои строки в списке серверов, своё сообщение о смерти, размер персонажа от 25% до 300%, своя пластинка каждый день, анимированная шапка, радужная обводка, закреплённый пост и новые функции раньше остальных — на ${termWord}.`
      : `Оформление профиля на ${termWord}: значок у ника, обводка профиля, темы карточки, своя шапка и стикеры.`;
    const timing = upgrade
      ? ` HYPE включится сразу, а оставшиеся дни PLUS (до ${formatDate(plus?.until)}) не сгорят — они перенесутся на время после HYPE.`
      : renewal && tier === "hype"
        ? ` Сейчас HYPE действует до ${formatDate(plus?.hypeUntil ?? plus?.until)} — ${termWord} добавится к этой дате${plusAfterHype ? ", а дни PLUS после него сдвинутся" : ""}.`
        : renewal
          ? ` Сейчас подписка действует до ${formatDate(plus?.until)} — ${termWord} добавится к этой дате.`
          : "";
    body = <>
      <h2 id="dp-dialog-title">{plan === "pass" ? "Пропуск на сервер" : upgrade ? "Перейти на HYPE" : renewal ? `Продлить ${name}` : `Оформить ${name}`}</h2>
      <p className="dp-dialog-price">
        <b>{price} ₽</b> {plan === "pass" ? "один раз" : term === "year" ? "за год" : "за месяц"}
        {promo ? <span className="dp-old-price">{base} ₽</span> : null}
      </p>
      {plan !== "pass" ? termSwitch : null}
      <p>{plan === "pass"
        ? "Открывает вход на сервер для вашего аккаунта без срока действия — пока работает сервер и аккаунт не заблокирован за нарушение правил. Игровых преимуществ пропуск не даёт."
        : `${whatYouGet}${timing}${autoNote}`}</p>
      {plan !== "pass" && term === "year" ? (
        <p className="dp-dialog-test">Год дешевле на {yearDiscount}%: {monthPrice * 12} ₽ помесячно против {yearPrice} ₽ одним платежом. Автопродления у годовой подписки нет — за три дня до конца напомним на почту из профиля.</p>
      ) : null}
      {failed ? <p className="form-message error-message">Последнее автосписание не прошло. Оплатите вручную, чтобы подписка не закончилась.</p> : null}
      {plan === "pass" && summary.serverAccess ? <p className="dp-dialog-test">Проверка оплаты: доступ у вас уже есть, этот тестовый платёж только проверяет покупку пропуска.</p> : null}
      {promoField}
      {plan !== "pass" && term === "month" ? (
        <label className="dp-check">
          <input type="checkbox" checked={autoRenew} onChange={(event) => setAutoRenew(event.target.checked)} />
          <span>Продлевать автоматически: {monthPrice} ₽ раз в месяц с этой же карты. Отключить можно в любой момент в настройках профиля.</span>
        </label>
      ) : null}
      <label className="dp-check">
        <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />
        <span>Я принимаю <Link href="/rules#payments" target="_blank">условия оплаты</Link>, прошу открыть доступ сразу после оплаты{plan !== "pass" && term === "month" && autoRenew ? " и согласен на автоматические списания" : ""}.</span>
      </label>
      {summary.test ? <p className="dp-dialog-test">Тестовый режим: настоящие деньги не списываются.</p> : null}
      {error ? <p className="form-message error-message">{error}</p> : null}
      <button className={plan === "hype" ? "dp-buy hype" : plan === "plus" ? "dp-buy blue" : "dp-buy"} type="button" disabled={!consent || busy} onClick={() => void pay()}>
        {busy ? "ОТКРЫВАЕМ ОПЛАТУ…" : `ОПЛАТИТЬ ${price} ₽ →`}
      </button>
      <p className="dp-fine">Оплата проходит на защищённой странице ЮKassa. Данные карты мы не видим и не храним.</p>
      {/* Карта не из России — lava.top, в долларах или евро (r103). Промокод там не действует. */}
      {summary.lava ? (
        <div className="dp-foreign">
          <span>Карта не из России?</span>
          <button type="button" disabled={!consent || busy} onClick={() => void pay("USD")}>ОПЛАТИТЬ В $ ↗</button>
          <button type="button" disabled={!consent || busy} onClick={() => void pay("EUR")}>ОПЛАТИТЬ В € ↗</button>
          <small>Через lava.top: Visa и Mastercard из 95+ стран.{plan !== "pass" && term === "month" ? " Месяц продлевается сам, отменить можно в письме от lava.top." : ""}{promo ? " Промокод тут не действует." : ""}</small>
        </div>
      ) : null}
    </>;
  }

  return (
    <div className="dp-dialog-backdrop" role="presentation" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="dp-window dp-dialog" role="dialog" aria-modal="true" aria-labelledby="dp-dialog-title">
        <div className="dp-bar">
          <span>checkout.exe</span>
          <button className="dp-dialog-close" type="button" aria-label="Закрыть окно" onClick={onClose}>×</button>
        </div>
        <div className="dp-dialog-body">
          <span className="dp-tag small">{gift ? `${tier === "hype" ? "HYPE" : "PLUS"} В ПОДАРОК` : TITLES[plan]}</span>
          {body}
        </div>
      </section>
    </div>
  );
}
