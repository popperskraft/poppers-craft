"use client";

import { FormEvent, useState } from "react";

export function PasswordForm() {
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    const form = event.currentTarget;
    const data = new FormData(form);
    const newPassword = String(data.get("newPassword") ?? "");
    const confirmation = String(data.get("confirmation") ?? "");
    if (newPassword !== confirmation) {
      setError(true);
      setMessage("Новые пароли не совпадают.");
      setBusy(false);
      return;
    }

    const response = await fetch("/api/profile/password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        currentPassword: data.get("currentPassword"),
        newPassword,
      }),
    });
    const result = await response.json();
    setError(!response.ok);
    setMessage(result.message ?? result.error ?? "Не удалось изменить пароль.");
    if (response.ok) form.reset();
    setBusy(false);
  };

  return (
    <form className="profile-password-form" onSubmit={submit}>
      <label>
        ТЕКУЩИЙ ПАРОЛЬ
        <input
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          required
        />
      </label>
      <label>
        НОВЫЙ ПАРОЛЬ
        <input
          name="newPassword"
          type="password"
          autoComplete="new-password"
          minLength={8}
          maxLength={128}
          required
        />
      </label>
      <label>
        ПОВТОРИТЕ НОВЫЙ ПАРОЛЬ
        <input
          name="confirmation"
          type="password"
          autoComplete="new-password"
          minLength={8}
          maxLength={128}
          required
        />
      </label>
      {message ? (
        <p className={error ? "form-message error-message" : "form-message success-message"}>
          {message}
        </p>
      ) : null}
      <button type="submit" disabled={busy}>
        {busy ? "СОХРАНЯЕМ…" : "СМЕНИТЬ ПАРОЛЬ"}
      </button>
    </form>
  );
}
