"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { MinecraftIcon } from "@/app/MinecraftIcon";
import { MinecraftCaptcha } from "@/app/MinecraftCaptcha";
import { BackButton } from "@/app/BackButton";

export function AdminLogin() {
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [captchaKey, setCaptchaKey] = useState(0);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    const data = new FormData(event.currentTarget);
    const response = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: data.get("email"),
        password: data.get("password"),
        captchaAnswer: data.get("captchaAnswer"),
      }),
    });
    const result = await response.json();
    setCaptchaKey((value) => value + 1);
    setError(!response.ok);
    if (response.ok) {
      window.location.href = result.redirectTo ?? "/admin";
      return;
    }
    setMessage(result.error ?? "Что-то пошло не так.");
    setBusy(false);
  };

  return (
    <main className="access-denied">
      <div className="paint-window access-denied-window admin-login-window">
        <div className="window-bar">
          <span className="window-title-with-icon">
            <MinecraftIcon name="key" size="sm" /> admin_login.exe
          </span>
          <BackButton />
        </div>
        <div>
          <h1>ВХОД ДЛЯ АДМИНА</h1>
          <p>Введите почту и пароль, которые выдал владелец.</p>
          <form className="admin-login-form" onSubmit={submit}>
            <label>
              ПОЧТА
              <input
                name="email"
                type="email"
                autoComplete="email"
                required
                placeholder="owner@example.com"
              />
            </label>
            <MinecraftCaptcha refreshKey={captchaKey} />
            <label>
              ПАРОЛЬ
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                minLength={8}
                maxLength={128}
                required
              />
            </label>
            <p className="auto-login-note">
              <MinecraftIcon name="redstone" size="sm" /> Автовход включён на этом устройстве
            </p>
            <button type="submit" disabled={busy}>
              {busy ? "ПРОВЕРЯЕМ…" : "ВОЙТИ В УПРАВЛЕНИЕ"}
            </button>
          </form>
          {message ? (
            <p className={error ? "form-message error-message" : "form-message"}>
              {message}
            </p>
          ) : null}
          <Link href="/">← Вернуться на сайт</Link>
        </div>
      </div>
    </main>
  );
}
