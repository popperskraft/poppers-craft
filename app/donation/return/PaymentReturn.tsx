"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { resetTrail } from "@/lib/navigation-trail";
import { loginPageUrl } from "@/lib/login-return";

/* Страница после оплаты в ЮKassa: ждём подтверждения и рассказываем, что дальше.

   Это промежуточный шаг: кнопка «← НАЗАД» на других страницах сюда не
   ведёт (lib/navigation-trail.ts), а ссылки отсюда заменяют страницу в
   истории браузера. После успешной оплаты путь обнуляется — «Назад»
   дальше ведёт на главную, а не обратно к оплате. */

type Payment = {
  id: string;
  kind: "pass" | "plus";
  amount: number;
  status: "created" | "pending" | "waiting_for_capture" | "succeeded" | "canceled" | "failed";
  applied: boolean;
  autoRenew: boolean;
  cancellationReason: string | null;
  /* Подарок: ник игрока, которому досталась подписка. */
  recipientLogin: string | null;
  /* Тариф и срок подписки. */
  tier?: "plus" | "hype";
  plan?: "month" | "year";
};

const REASONS: Record<string, string> = {
  expired_on_confirmation: "время на оплату истекло",
  insufficient_funds: "на карте недостаточно средств",
  "3d_secure_failed": "не пройдена проверка 3-D Secure",
  card_expired: "у карты истёк срок действия",
  invalid_card_number: "неверный номер карты",
  invalid_csc: "неверный код CVC",
  general_decline: "банк отклонил платёж",
  call_issuer: "банк отклонил платёж — позвоните в банк",
  issuer_unavailable: "банк временно недоступен",
  payment_method_limit_exceeded: "превышен лимит по карте",
  payment_method_restricted: "операции по карте ограничены",
  country_forbidden: "оплата картой этой страны недоступна",
  fraud_suspected: "платёж заблокирован системой безопасности",
  canceled_by_merchant: "платёж отменён",
  internal_timeout: "ЮKassa не успела обработать платёж",
  create_failed: "не удалось создать платёж",
};

const POLL_MS = 2_500;
const POLL_LIMIT = 48;

export function PaymentReturn({ paymentId }: { paymentId: string }) {
  const [payment, setPayment] = useState<Payment | null>(null);
  const [error, setError] = useState("");
  const [loginRequired, setLoginRequired] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const finished = payment?.status === "succeeded" && payment.applied;

  useEffect(() => {
    if (finished) resetTrail(["/"]);
  }, [finished]);

  useEffect(() => {
    if (!paymentId) { setError("В ссылке нет номера платежа."); return; }
    let cancelled = false;
    let timer = 0;
    let count = 0;
    const load = async () => {
      try {
        const response = await fetch(`/api/payments/${encodeURIComponent(paymentId)}`, { cache: "no-store" });
        const result = await response.json().catch(() => null) as { payment?: Payment; error?: string; loginRequired?: boolean } | null;
        if (cancelled) return;
        if (!response.ok || !result?.payment) {
          setLoginRequired(Boolean(result?.loginRequired));
          setError(result?.error ?? "Не удалось проверить платёж.");
          return;
        }
        setPayment(result.payment);
        const done = (result.payment.status === "succeeded" && result.payment.applied)
          || result.payment.status === "canceled" || result.payment.status === "failed";
        count += 1;
        setAttempts(count);
        if (!done && count < POLL_LIMIT) timer = window.setTimeout(() => void load(), POLL_MS);
      } catch {
        if (!cancelled) timer = window.setTimeout(() => void load(), POLL_MS * 2);
      }
    };
    void load();
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [paymentId]);

  const home = <Link className="dp-buy dp-buy-link dp-return-home" href="/" replace>НА ГЛАВНУЮ</Link>;
  let tag = "ПРОВЕРЯЕМ";
  let title = "Проверяем оплату…";
  let text = "ЮKassa подтверждает платёж. Обычно это занимает несколько секунд. Можно не ждать: доступ появится сам, как только платёж подтвердится.";
  let actions = <>
    <Link className="dp-buy dp-buy-link" href="/donation" replace>← К ТАРИФАМ</Link>
    {home}
  </>;

  if (error) {
    tag = "ОШИБКА";
    title = "Не получилось проверить оплату";
    text = loginRequired
      ? "Войдите в аккаунт, с которого платили, — и мы покажем результат оплаты."
      : `${error} Если деньги списались, а доступ не появился, напишите в @PoppersCraftAuthBot — разберёмся.`;
    if (loginRequired) {
      actions = <>
        <Link className="dp-buy dp-buy-link" href={loginPageUrl(`/donation/return?payment=${encodeURIComponent(paymentId)}`)} replace>ВОЙТИ →</Link>
        {home}
      </>;
    }
  } else if (finished && payment) {
    tag = "ГОТОВО";
    if (payment.kind === "pass") {
      title = "Пропуск активирован!";
      text = "Доступ к серверу открыт. Скачайте лаунчер на компьютере, войдите тем же ником и паролем — и добро пожаловать в мир PoppersCraft.";
      actions = <>
        <Link className="dp-buy dp-buy-link" href="/launcher" replace>СКАЧАТЬ ЛАУНЧЕР →</Link>
        <Link className="dp-buy dp-buy-link blue" href="/donation" replace>ПОСМОТРЕТЬ ПОДПИСКУ</Link>
        {home}
      </>;
    } else if (payment.recipientLogin) {
      title = "Подарок отправлен!";
      text = `@${payment.recipientLogin} получил ${payment.plan === "year" ? "год" : "месяц"} ${payment.tier === "hype" ? "POPPERS HYPE" : "POPPERS+"}. При следующем заходе на сайт его встретит окно с поздравлением, а если у игрока указана почта, мы написали и туда.`;
      actions = <>
        <Link className="dp-buy dp-buy-link pink" href={`/players/${encodeURIComponent(payment.recipientLogin)}`} replace>К КАРТОЧКЕ ИГРОКА →</Link>
        {home}
      </>;
    } else {
      const hype = payment.tier === "hype";
      title = hype ? "HYPE активен!" : "PLUS активен!";
      text = payment.autoRenew
        ? "Спасибо за поддержку! Подписка будет продлеваться сама раз в месяц — отключить это можно в настройках профиля."
        : `Спасибо за поддержку! ${hype ? "HYPE" : "PLUS"} добавлен на ${payment.plan === "year" ? "год" : "месяц"}. Сама подписка не продлится — за три дня до конца напомним на почту, если она указана в профиле.`;
      actions = <>
        <Link className={hype ? "dp-buy dp-buy-link hype" : "dp-buy dp-buy-link pink"} href="/profile?edit=1#plus-ring" replace>НАСТРОИТЬ ОФОРМЛЕНИЕ →</Link>
        {/* Пони — возможность HYPE. */}
        {hype ? <Link className="dp-buy dp-buy-link" href="/models" replace>СДЕЛАТЬ ПОНИ</Link> : null}
        {home}
      </>;
    }
  } else if (payment?.status === "succeeded") {
    title = "Оплата прошла, выдаём доступ…";
    text = "Деньги получены, осталось несколько секунд.";
  } else if (payment && (payment.status === "canceled" || payment.status === "failed")) {
    tag = "НЕ ПРОШЛО";
    title = "Оплата не прошла";
    const reason = payment.cancellationReason ? REASONS[payment.cancellationReason] : "";
    text = `${reason ? `Причина: ${reason}. ` : ""}Деньги не списаны. Можно попробовать ещё раз или выбрать другой способ оплаты.`;
    actions = <>
      <Link className="dp-buy dp-buy-link" href={payment.recipientLogin ? `/donation?plan=gift&to=${encodeURIComponent(payment.recipientLogin)}${payment.tier === "hype" ? "&tier=hype" : ""}` : payment.kind === "pass" ? "/donation?plan=pass" : `/donation?plan=${payment.tier === "hype" ? "hype" : "plus"}`} replace>ПОПРОБОВАТЬ ЕЩЁ РАЗ →</Link>
      {home}
    </>;
  } else if (attempts >= POLL_LIMIT) {
    tag = "ЖДЁМ";
    title = "Платёж ещё обрабатывается";
    text = "ЮKassa пока не подтвердила оплату. Обновите страницу через пару минут. Если деньги списались, доступ появится автоматически.";
  }

  return (
    <main className="dp-page">
      <div className="dp-shell">
        <section className="dp-window dp-return" aria-live="polite">
          <div className="dp-bar"><span>payment_status.exe</span></div>
          <div className="dp-dialog-body">
            <span className="dp-tag small">{tag}</span>
            <h1>{title}</h1>
            <p>{text}</p>
            <div className="dp-return-actions">{actions}</div>
          </div>
        </section>
      </div>
    </main>
  );
}
