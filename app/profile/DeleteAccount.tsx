"use client";

import { type FormEvent, useState } from "react";
import { resetTrail } from "@/lib/navigation-trail";

/* «Настройки → Аккаунт и почта → Удаление аккаунта» (соглашение 1.2).
   Подтверждение — пароль или шестизначный код из письма; без галочки
   «понимаю, что это нельзя отменить» кнопка не сработает. */
export function DeleteAccount({ hasEmail, staff }: { hasEmail: boolean; staff: boolean }) {
  const [open, setOpen] = useState(false);
  const [method, setMethod] = useState<"password" | "code">("password");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [deleted, setDeleted] = useState(false);

  if (staff) {
    return <p className="delete-account-note">Аккаунт администрации нельзя удалить самому — его удаляет владелец сайта.</p>;
  }

  async function post(payload: Record<string, unknown>) {
    const response = await fetch("/api/profile/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok) throw new Error(result?.error ?? "Не удалось выполнить запрос.");
    return result as { ok: true; message?: string };
  }

  async function sendCode() {
    setBusy("code"); setError(""); setMessage("");
    try {
      const result = await post({ action: "send-code" });
      setMessage(result.message ?? "Код отправлен на почту.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось отправить код.");
    } finally { setBusy(""); }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!confirm) { setError("Отметьте, что понимаете: удаление нельзя отменить."); return; }
    setBusy("delete"); setError(""); setMessage("");
    try {
      await post({ action: "delete", method, password: method === "password" ? password : undefined, code: method === "code" ? code : undefined, confirm: true });
      setDeleted(true);
      resetTrail();
      window.setTimeout(() => window.location.assign("/"), 2500);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось удалить аккаунт.");
    } finally { setBusy(""); }
  }

  if (deleted) {
    return <p className="form-message success-message" role="status">Аккаунт удалён. Спасибо, что были с нами. Сейчас откроется главная страница.</p>;
  }

  return (
    <div className="delete-account">
      <ul className="delete-account-list">
        <li>Удаляются профиль, анкета, посты, комментарии, отзывы, подписки на игроков, скин и образы.</li>
        <li>Пропуск и подписка пропадут; автопродление выключится, карта отвяжется. Если хотите вернуть деньги за неиспользованные дни, сначала напишите в <a href="https://t.me/PoppersCraftAuthBot" target="_blank" rel="noreferrer">@PoppersCraftAuthBot</a>.</li>
        <li>Удаление нельзя отменить. Вернуться на сервер можно будет только с новой анкетой.</li>
      </ul>
      {!open ? (
        <div className="profile-actions">
          <button className="delete-account-start" type="button" onClick={() => setOpen(true)}>УДАЛИТЬ АККАУНТ…</button>
        </div>
      ) : (
        <form className="profile-password-form delete-account-form" onSubmit={submit}>
          <fieldset className="delete-account-methods">
            <legend>ПОДТВЕРЖДЕНИЕ</legend>
            <label><input type="radio" name="delete-method" checked={method === "password"} onChange={() => setMethod("password")} /> Паролем от аккаунта</label>
            <label><input type="radio" name="delete-method" checked={method === "code"} disabled={!hasEmail} onChange={() => setMethod("code")} /> Кодом из письма{hasEmail ? "" : " — у аккаунта нет почты"}</label>
          </fieldset>
          {method === "password" ? (
            <label>ПАРОЛЬ<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} maxLength={128} required /></label>
          ) : (
            <>
              <div className="profile-actions"><button type="button" disabled={Boolean(busy)} onClick={() => void sendCode()}>{busy === "code" ? "ОТПРАВЛЯЕМ…" : "ПРИСЛАТЬ КОД НА ПОЧТУ"}</button></div>
              <label>КОД ИЗ ПИСЬМА<input inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="000000" required /></label>
            </>
          )}
          <label className="delete-account-confirm"><input type="checkbox" checked={confirm} onChange={(event) => setConfirm(event.target.checked)} /> Я понимаю, что аккаунт удалится навсегда и это нельзя отменить</label>
          <div className="profile-actions">
            <button className="delete-account-submit" type="submit" disabled={Boolean(busy) || !confirm}>{busy === "delete" ? "УДАЛЯЕМ…" : "УДАЛИТЬ АККАУНТ НАВСЕГДА"}</button>
            <button type="button" disabled={Boolean(busy)} onClick={() => { setOpen(false); setError(""); setMessage(""); }}>ОТМЕНА</button>
          </div>
          <p className="delete-account-note">Нет ни пароля, ни почты (например, входили только через Telegram)? Напишите в <a href="https://t.me/PoppersCraftAuthBot" target="_blank" rel="noreferrer">@PoppersCraftAuthBot</a> — удалим вручную.</p>
        </form>
      )}
      {message ? <p className="form-message success-message" role="status">{message}</p> : null}
      {error ? <p className="form-message error-message" role="alert">{error}</p> : null}
    </div>
  );
}
