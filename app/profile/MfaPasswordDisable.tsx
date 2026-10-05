"use client";

import { FormEvent, useState } from "react";

export function MfaPasswordDisable({ compact = false }: { compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    const response = await fetch("/api/profile/mfa/disable", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    const result = await response.json().catch(() => ({}));
    setError(!response.ok);
    setMessage(result.message ?? result.error ?? "Не удалось отключить 2FA.");
    if (response.ok && result.sent) {
      /* Письмо ушло: 2FA снимется по ссылке из него. */
      setPassword("");
      setBusy(false);
      return;
    }
    if (response.ok) {
      setPassword("");
      window.setTimeout(() => { window.location.href = "/"; }, 1200);
      return;
    }
    setBusy(false);
  };

  if (!open) {
    return (
      <button className="mfa-force-toggle" type="button" onClick={() => setOpen(true)}>
        {compact ? "НЕТ ДОСТУПА К КОДУ?" : "ОТКЛЮЧИТЬ 2FA ПО ПАРОЛЮ"}
      </button>
    );
  }

  return (
    <form className="mfa-force-disable" onSubmit={submit}>
      <strong>ПРИНУДИТЕЛЬНОЕ ОТКЛЮЧЕНИЕ 2FA</strong>
      <p>{compact
        ? "Введите пароль — мы пришлём на почту аккаунта ссылку, по которой 2FA отключится. Без доступа к почте поможет только поддержка."
        : "Введите пароль. Мы отключим все аутентификаторы и завершим активные сеансы."}</p>
      <label>
        ТЕКУЩИЙ ПАРОЛЬ
        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          minLength={1}
          maxLength={128}
          autoComplete="current-password"
          autoFocus
          required
        />
      </label>
      {message ? <p className={error ? "form-message error-message" : "form-message success-message"}>{message}</p> : null}
      <div>
        <button type="submit" disabled={busy}>{busy ? "ОТКЛЮЧАЕМ…" : "ПОДТВЕРДИТЬ ОТКЛЮЧЕНИЕ"}</button>
        <button type="button" disabled={busy} onClick={() => { setOpen(false); setMessage(""); setPassword(""); }}>ОТМЕНА</button>
      </div>
    </form>
  );
}
