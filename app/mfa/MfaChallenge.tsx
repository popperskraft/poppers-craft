"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { MfaPasswordDisable } from "@/app/profile/MfaPasswordDisable";

type Factor = { id: string; friendly_name?: string; status: string };

export function MfaChallenge({ next }: { next: string }) {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [factor, setFactor] = useState<Factor | null>(null);
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  /* Страница, восстановленная из кэша браузера кнопкой «Назад», загружается
     заново: если вход уже подтверждён, сервер сразу уведёт дальше. */
  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) window.location.reload();
    };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  useEffect(() => {
    supabase.auth.mfa.listFactors().then(({ data }) => {
      setFactor(((data?.totp ?? []) as Factor[]).find((item) => item.status === "verified") ?? null);
    });
  }, [supabase]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!factor || !/^\d{6}$/.test(code)) {
      setMessage("Введите шестизначный код.");
      return;
    }
    setBusy(true);
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
    if (error) {
      setMessage("Неверный или устаревший код.");
      setBusy(false);
      return;
    }
    /* replace, а не переход: запись /mfa исчезает из истории, и «Назад» из
       профиля ведёт туда, откуда пришли на вход, а не к вводу кода. */
    window.location.replace(next);
  };

  return (
    <div className="mfa-challenge-form">
      <form className="mfa-code-form" onSubmit={submit}>
        <span>SECURITY LEVEL: AAL2</span>
        <h1>ПОДТВЕРДИ<br />ВХОД</h1>
        <p>Откройте приложение с кодами и введите текущий код.</p>
        <label>ШЕСТИЗНАЧНЫЙ КОД<input value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" autoFocus /></label>
        {message ? <p className="form-message error-message">{message}</p> : null}
        <button type="submit" disabled={busy || !factor}>{busy ? "ПРОВЕРЯЕМ…" : "ПОДТВЕРДИТЬ →"}</button>
      </form>
      <div className="mfa-recovery-divider"><span>ИЛИ</span></div>
      <MfaPasswordDisable compact />
    </div>
  );
}
