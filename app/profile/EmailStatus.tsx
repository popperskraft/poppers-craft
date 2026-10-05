"use client";

import { useState } from "react";

/* Аккаунты, заведённые через Telegram, живут на служебном домене: подтверждать
   там нечего, человеку предлагается указать личную почту. */
function isServiceEmail(email: string) {
  return email.trim().toLowerCase().endsWith("@users.popperscraft.org");
}

export function EmailStatus({ email, confirmed }: { email: string; confirmed: boolean }) {
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!email || isServiceEmail(email)) {
    return (
      <p className="profile-email-state">
        ПОЧТА НЕ УКАЗАНА — БЕЗ НЕЁ ПАРОЛЬ НЕ ВОССТАНОВИТЬ
      </p>
    );
  }

  if (confirmed) {
    return <p className="profile-email-state is-confirmed">ПОЧТА ПОДТВЕРЖДЕНА</p>;
  }

  const resend = async () => {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/profile/email/verify", { method: "POST" });
      const result = await response.json().catch(() => null) as { message?: string; error?: string } | null;
      setError(!response.ok);
      setMessage(result?.message ?? result?.error ?? "Не удалось отправить письмо.");
    } catch {
      setError(true);
      setMessage("Сервер не ответил. Попробуйте ещё раз.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="profile-email-state">
      <span>ПОЧТА НЕ ПОДТВЕРЖДЕНА</span>
      <button type="button" onClick={resend} disabled={busy}>
        {busy ? "ОТПРАВЛЯЕМ…" : "ПРИСЛАТЬ ПИСЬМО"}
      </button>
      {message ? (
        <p className={error ? "form-message error-message" : "form-message success-message"}>{message}</p>
      ) : null}
    </div>
  );
}
