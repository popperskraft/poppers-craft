"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { loginPageUrl } from "@/lib/login-return";

export function ResetForm({ userId, token }: { userId: string; token: string }) {
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    const form = event.currentTarget;
    const data = new FormData(form);
    const password = String(data.get("password") ?? "");
    if (password !== String(data.get("confirmation") ?? "")) {
      setError(true);
      setMessage("Пароли не совпадают.");
      setBusy(false);
      return;
    }

    try {
      const response = await fetch("/api/auth/password-reset/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ u: userId, t: token, password }),
      });
      const result = await response.json().catch(() => null) as { message?: string; error?: string } | null;
      setError(!response.ok);
      setMessage(result?.message ?? result?.error ?? "Не удалось сменить пароль.");
      if (response.ok) {
        form.reset();
        setDone(true);
      }
    } catch {
      setError(true);
      setMessage("Сервер не ответил. Проверьте соединение и попробуйте ещё раз.");
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div className="profile-password-form">
        <p className="form-message success-message">{message}</p>
        <Link className="profile-primary-action" href={loginPageUrl()}>ВОЙТИ →</Link>
      </div>
    );
  }

  return (
    <form className="profile-password-form" onSubmit={submit}>
      <label>
        НОВЫЙ ПАРОЛЬ
        <input name="password" type="password" autoComplete="new-password" minLength={8} maxLength={128} required autoFocus />
      </label>
      <label>
        ПОВТОРИТЕ НОВЫЙ ПАРОЛЬ
        <input name="confirmation" type="password" autoComplete="new-password" minLength={8} maxLength={128} required />
      </label>
      {message ? (
        <p className={error ? "form-message error-message" : "form-message success-message"}>{message}</p>
      ) : null}
      <button type="submit" disabled={busy}>{busy ? "СОХРАНЯЕМ…" : "СМЕНИТЬ ПАРОЛЬ"}</button>
    </form>
  );
}
