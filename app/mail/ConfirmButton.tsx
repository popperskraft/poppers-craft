"use client";

import { useState } from "react";
import Link from "next/link";

export function ConfirmButton({ kind, userId, token }: { kind: "change" | "verify" | "mfa"; userId: string; token: string }) {
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const confirm = async () => {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/auth/email-confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ k: kind, u: userId, t: token }),
      });
      const result = await response.json().catch(() => null) as { message?: string; error?: string } | null;
      setError(!response.ok);
      setMessage(result?.message ?? result?.error ?? (kind === "mfa" ? "Не удалось отключить 2FA." : "Не удалось подтвердить почту."));
      if (response.ok) setDone(true);
    } catch {
      setError(true);
      setMessage("Сервер не ответил. Проверьте соединение и попробуйте ещё раз.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="profile-password-form">
      {message ? (
        <p className={error ? "form-message error-message" : "form-message success-message"}>{message}</p>
      ) : null}
      {done ? (
        <Link className="profile-primary-action" href={kind === "mfa" ? "/" : "/profile?tab=settings&section=account"}>{kind === "mfa" ? "НА ГЛАВНУЮ →" : "В НАСТРОЙКИ →"}</Link>
      ) : (
        <button type="button" onClick={confirm} disabled={busy}>
          {busy ? "ПРОВЕРЯЕМ…" : kind === "mfa" ? "ОТКЛЮЧИТЬ 2FA" : "ПОДТВЕРДИТЬ ПОЧТУ"}
        </button>
      )}
    </div>
  );
}
