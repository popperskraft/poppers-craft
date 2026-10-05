"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export function EmailForm({ currentEmail }: { currentEmail: string }) {
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setMessage("");

    const form = event.currentTarget;
    const data = new FormData(form);
    const email = String(data.get("email") ?? "").trim().toLowerCase();
    const confirmation = String(data.get("confirmation") ?? "").trim().toLowerCase();

    if (email !== confirmation) {
      setError(true);
      setMessage("Адреса почты не совпадают.");
      setBusy(false);
      return;
    }
    if (email === currentEmail.trim().toLowerCase()) {
      setError(true);
      setMessage("Укажите новую почту.");
      setBusy(false);
      return;
    }

    try {
      const response = await fetch("/api/profile/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          currentPassword: data.get("currentPassword"),
        }),
      });
      const result = await response.json().catch(() => null) as { message?: string; error?: string } | null;
      setError(!response.ok);
      setMessage(result?.message ?? result?.error ?? "Не удалось изменить почту.");
      if (response.ok) {
        form.reset();
        router.refresh();
      }
    } catch {
      setError(true);
      setMessage("Сервер не ответил. Проверьте соединение и попробуйте ещё раз.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="profile-password-form" onSubmit={submit}>
      <p className="mail-spam-note">
        На новый адрес придёт письмо от noreply@popperscraft.org, и почта поменяется только после перехода
        по ссылке из него. Если письма нет во «Входящих» — проверьте папку «Спам».
      </p>
      <label>
        НОВАЯ ПОЧТА
        <input
          name="email"
          type="email"
          autoComplete="email"
          maxLength={254}
          required
        />
      </label>
      <label>
        ПОВТОРИТЕ НОВУЮ ПОЧТУ
        <input
          name="confirmation"
          type="email"
          autoComplete="email"
          maxLength={254}
          required
        />
      </label>
      <label>
        ТЕКУЩИЙ ПАРОЛЬ
        <input
          name="currentPassword"
          type="password"
          autoComplete="current-password"
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
        {busy ? "СОХРАНЯЕМ…" : "СМЕНИТЬ ПОЧТУ"}
      </button>
    </form>
  );
}
