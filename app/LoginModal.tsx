"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { MinecraftIcon } from "./MinecraftIcon";
import { TelegramLoginButton } from "./TelegramLoginButton";
import { MinecraftCaptcha } from "./MinecraftCaptcha";
import { loginReturnTarget } from "@/lib/login-return";

export function LoginModal({
  open,
  onClose,
  successRedirect,
}: {
  open: boolean;
  onClose: () => void;
  successRedirect?: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [captchaKey, setCaptchaKey] = useState(0);
  const [recovery, setRecovery] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  /* Закрытое окно возвращается к обычному входу: иначе в следующий раз оно
     откроется на форме восстановления. */
  useEffect(() => {
    if (open) return;
    setRecovery(false);
    setMessage("");
    setError(false);
  }, [open]);

  const switchMode = (toRecovery: boolean) => {
    setRecovery(toRecovery);
    setMessage("");
    setError(false);
    setCaptchaKey((value) => value + 1);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    const data = new FormData(event.currentTarget);
    const response = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.fromEntries(data)),
    });
    const result = await response.json();
    setCaptchaKey((value) => value + 1);
    setError(!response.ok);
    if (response.ok) {
      window.location.href = loginReturnTarget(result.redirectTo, successRedirect);
      return;
    }
    setMessage(result.error ?? "Не удалось войти.");
    setBusy(false);
  };

  const submitRecovery = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    const data = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/auth/password-reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Object.fromEntries(data)),
      });
      const result = await response.json().catch(() => null) as { message?: string; error?: string } | null;
      setCaptchaKey((value) => value + 1);
      setError(!response.ok);
      setMessage(result?.message ?? result?.error ?? "Не удалось отправить письмо.");
    } catch {
      setError(true);
      setMessage("Сервер не ответил. Проверьте соединение и попробуйте ещё раз.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <dialog
      className="login-dialog"
      ref={dialogRef}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === dialogRef.current) onClose();
      }}
    >
      <div className="paint-window login-window login-modal-window">
        <div className="window-bar">
          <span className="window-title-with-icon">
            <MinecraftIcon name="key" size="sm" /> {recovery ? "password_recovery.exe" : "login.exe"}
          </span>
          <button type="button" aria-label="Закрыть окно входа" onClick={onClose}>×</button>
        </div>
        {recovery ? (
          <form className="login-form" onSubmit={submitRecovery}>
            <div className="login-pixel-face" aria-hidden="true">:|</div>
            <h3>ЗАБЫЛИ<br />ПАРОЛЬ?</h3>
            <p>Укажите игровой логин или почту аккаунта — пришлём ссылку для смены пароля.</p>
            <p className="mail-spam-note">Письмо придёт с адреса noreply@popperscraft.org. Если его нет во «Входящих» — загляните в папку «Спам».</p>
            <label><span>Логин или почта</span><input name="login" autoComplete="username" required autoFocus /></label>
            <MinecraftCaptcha active={open} refreshKey={captchaKey} />
            {message ? <p className={error ? "form-message error-message" : "form-message success-message"}>{message}</p> : null}
            <button type="submit" disabled={busy}>{busy ? "ОТПРАВЛЯЕМ…" : "ПРИСЛАТЬ ССЫЛКУ →"}</button>
            <button className="login-text-link" type="button" onClick={() => switchMode(false)}>← ВЕРНУТЬСЯ КО ВХОДУ</button>
          </form>
        ) : (
          <form className="login-form" onSubmit={submit}>
            <div className="login-pixel-face" aria-hidden="true">:)</div>
            <h3>ВХОД В<br />АККАУНТ</h3>
            <p>Введите игровой логин или почту администратора.</p>
            <label><span>Логин или почта</span><input name="login" autoComplete="username" required autoFocus /></label>
            <label><span>Пароль</span><input name="password" type="password" autoComplete="current-password" required /></label>
            <MinecraftCaptcha active={open} refreshKey={captchaKey} />
            {message ? <p className={error ? "form-message error-message" : "form-message success-message"}>{message}</p> : null}
            <button type="submit" disabled={busy}>{busy ? "ПРОВЕРЯЕМ…" : "ВОЙТИ →"}</button>
            <button className="login-text-link" type="button" onClick={() => switchMode(true)}>ЗАБЫЛИ ПАРОЛЬ?</button>
            <div className="telegram-login-placeholder">
              <span>ИЛИ</span>
              <TelegramLoginButton successRedirect={successRedirect} />
            </div>
          </form>
        )}
      </div>
    </dialog>
  );
}
