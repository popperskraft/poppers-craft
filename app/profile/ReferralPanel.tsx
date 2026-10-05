"use client";

import { useEffect, useRef, useState } from "react";
import { MinecraftIcon } from "@/app/MinecraftIcon";
import "../referrals.css";

type ReferralSummary = {
  authenticated: boolean;
  eligible: boolean;
  code: string | null;
  url: string | null;
  invited: number;
  rewarded: number;
  rewardDays: number;
};

export function ReferralPanel() {
  const [summary, setSummary] = useState<ReferralSummary | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [sharing, setSharing] = useState(false);
  const linkRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/referrals", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? "Не удалось загрузить приглашения.");
        if (!controller.signal.aborted) setSummary(result as ReferralSummary);
      })
      .catch((caught) => {
        if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "Не удалось загрузить приглашения.");
      });
    return () => controller.abort();
  }, [attempt]);

  const copy = async () => {
    if (!summary?.url) return;
    setMessage("");
    try {
      await navigator.clipboard.writeText(summary.url);
      setMessage("Ссылка скопирована. Отправь её другу!");
    } catch {
      linkRef.current?.focus();
      linkRef.current?.select();
      setMessage("Не удалось скопировать автоматически. Выдели и скопируй ссылку из поля.");
    }
  };

  const share = async () => {
    if (!summary?.url || sharing) return;
    setSharing(true);
    setMessage("");
    try {
      if (navigator.share) {
        await navigator.share({ title: "PoppersCraft", url: summary.url });
        setMessage("Приглашение готово. Ждём друга на сервере!");
      } else {
        await copy();
      }
    } catch (caught) {
      if (!(caught instanceof Error && caught.name === "AbortError")) await copy();
    } finally {
      setSharing(false);
    }
  };

  return (
    <section className="referral-panel" aria-labelledby="referrals-title">
      <div className="referral-heading"><MinecraftIcon name="cake" size="lg" /><div><small>FRIENDS.EXE</small><h2 id="referrals-title">ПРИГЛАСИ ДРУГА</h2></div></div>
      <p className="referral-reward">ТЕБЕ — 30 ДНЕЙ POPPERS HYPE</p>
      <p>Поделись своей ссылкой. Друг заполняет анкету, получает одобрение и впервые оплачивает проходку — тебе автоматически добавляются 30 дней HYPE.</p>
      <p className="referral-note">За каждого нового друга — ещё 30 дней. Награды складываются, уже оплаченные PLUS и HYPE сохраняются. Самоприглашения и бесплатные проходки не учитываются.</p>
      {error ? <div role="alert"><p className="form-message error-message">{error}</p><button className="referral-button" type="button" onClick={() => { setError(""); setAttempt((value) => value + 1); }}>ПОПРОБОВАТЬ ЕЩЁ РАЗ</button></div> : !summary ? <p role="status">Загружаем приглашение…</p> : summary.eligible && summary.url ? (
        <>
          <label className="referral-link-label"><span>Твоя ссылка приглашения</span><input ref={linkRef} readOnly value={summary.url} onFocus={(event) => event.currentTarget.select()} spellCheck={false} aria-label="Твоя ссылка приглашения" /></label>
          <div className="referral-actions">
            <button type="button" className="referral-button primary" disabled={sharing} onClick={() => void share()}><MinecraftIcon name="cake" size="sm" /><span>{sharing ? "ОТКРЫВАЕМ…" : "ПРИГЛАСИТЬ ДРУГА"}</span></button>
            <button type="button" className="referral-button" onClick={() => void copy()}>КОПИРОВАТЬ ССЫЛКУ</button>
          </div>
          <dl className="referral-stats"><div><dt>АНКЕТ ПО ПРИГЛАШЕНИЮ</dt><dd>{summary.invited}</dd></div><div><dt>ДРУЗЕЙ С ОПЛАЧЕННОЙ ПРОХОДКОЙ</dt><dd>{summary.rewarded}</dd></div><div><dt>ДНЕЙ HYPE В НАГРАДУ</dt><dd>{summary.rewarded * summary.rewardDays}</dd></div></dl>
        </>
      ) : <p>Приглашать друзей могут игроки с одобренной анкетой и доступом на сервер.</p>}
      {message ? <p className="form-message" role="status">{message}</p> : null}
    </section>
  );
}
