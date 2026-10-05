"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { normalizeReferralCode } from "@/lib/referral-code";
import { captureReferralFromUrl, readReferralDraft, REFERRAL_CHANGED_EVENT, updateReferralDraft } from "./referral-storage";
import "./referrals.css";

type Validation = { state: "idle" | "checking" | "valid" | "invalid" | "unavailable"; message?: string; inviterLogin?: string };

function subscribeToReferral(update: () => void) {
  window.addEventListener(REFERRAL_CHANGED_EVENT, update);
  return () => window.removeEventListener(REFERRAL_CHANGED_EVENT, update);
}

export function ReferralField() {
  const value = useSyncExternalStore(subscribeToReferral, readReferralDraft, () => "");
  const [checked, setChecked] = useState<{ value: string; result: Validation } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const code = normalizeReferralCode(value);
  const validation: Validation = !value.trim() ? { state: "idle" }
    : !code ? { state: "invalid", message: "Проверь ссылку или код приглашения. Можно исправить поле или очистить его." }
    : checked?.value === value ? checked.result : { state: "checking" };

  useEffect(() => {
    captureReferralFromUrl();
    const form = inputRef.current?.form;
    const reset = () => updateReferralDraft("");
    form?.addEventListener("reset", reset);
    return () => {
      form?.removeEventListener("reset", reset);
    };
  }, []);

  useEffect(() => {
    if (!code) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch("/api/referrals", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code }),
          signal: controller.signal,
        });
        const result = await response.json();
        if (controller.signal.aborted) return;
        if (!response.ok || !result.valid) {
          setChecked({ value, result: { state: response.status >= 500 || response.status === 429 ? "unavailable" : "invalid", message: result.error ?? "Не удалось проверить приглашение. При отправке анкеты проверим ещё раз." } });
        } else {
          setChecked({ value, result: { state: "valid", inviterLogin: result.inviterLogin } });
        }
      } catch {
        if (!controller.signal.aborted) setChecked({ value, result: { state: "unavailable", message: "Не удалось проверить приглашение. При отправке анкеты проверим ещё раз." } });
      }
    }, 400);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [value, code]);

  return (
    <div className="referral-field">
      <label htmlFor="application-referral">
        <span>Кто тебя пригласил? (необязательно)</span>
        <input
          ref={inputRef}
          id="application-referral"
          name="referralCode"
          value={value}
          onChange={(event) => updateReferralDraft(event.target.value)}
          placeholder="Ссылка друга или код приглашения"
          autoComplete="off"
          maxLength={2048}
          autoCapitalize="none"
          spellCheck={false}
          aria-invalid={validation.state === "invalid"}
          aria-describedby="referral-help referral-validation"
        />
      </label>
      <p id="referral-help" className="form-field-help">После одобрения анкеты и твоей первой оплаты проходки друг получит 30 дней POPPERS HYPE. Приглашение закрепляется при отправке анкеты.</p>
      <div id="referral-validation" aria-live="polite">
        {validation.state === "checking" ? <p>Проверяем приглашение…</p> : null}
        {validation.state === "valid" ? <p className="referral-valid"><span>Пригласил:</span> <b translate="no">@{validation.inviterLogin}</b><span>. Приглашение будет сохранено с анкетой.</span></p> : null}
        {validation.message ? <p className={validation.state === "invalid" ? "form-message error-message" : "form-field-help"}>{validation.message}</p> : null}
      </div>
      {value ? <button type="button" className="referral-clear" onClick={() => { updateReferralDraft(""); inputRef.current?.focus(); }}>УБРАТЬ ПРИГЛАШЕНИЕ</button> : null}
    </div>
  );
}
