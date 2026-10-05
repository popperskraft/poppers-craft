"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { MinecraftIcon } from "./MinecraftIcon";

export function BugReport() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) window.setTimeout(() => descriptionRef.current?.focus(), 0);
  }, [open]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form));
    const response = await fetch("/api/bug-reports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...values, page: `${window.location.pathname}${window.location.search}` }),
    });
    const result = await response.json().catch(() => ({}));
    setError(!response.ok);
    setMessage(result.message ?? result.error ?? "Не удалось отправить сообщение.");
    if (response.ok) form.reset();
    setBusy(false);
  };

  return (
    <>
      <button className="bug-report-button" type="button" onClick={() => setOpen(true)} aria-label="Сообщить о баге">
        <span aria-hidden="true">⚠</span><b>СООБЩИТЬ О БАГЕ</b>
      </button>
      {open ? (
        <div className="bug-report-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setOpen(false);
        }}>
          <section className="paint-window bug-report-window" role="dialog" aria-modal="true" aria-labelledby="bug-report-title">
            <div className="window-bar">
              <MinecraftIcon name="redstone" size="sm" />
              <span>BUG_REPORT.EXE</span>
              <button type="button" aria-label="Закрыть" onClick={() => setOpen(false)}>×</button>
            </div>
            <form className="bug-report-form" onSubmit={submit}>
              <h2 id="bug-report-title">НАШЁЛ<br />БАГ?</h2>
              <p>Напишите, что сломалось и что вы делали перед этим. Страницу и устройство мы добавим сами.</p>
              <label>
                ЧТО СЛОМАЛОСЬ?
                <textarea ref={descriptionRef} name="description" minLength={10} maxLength={600} required />
              </label>
              <label>
                EMAIL ДЛЯ ОТВЕТА (НЕОБЯЗАТЕЛЬНО)
                <input name="email" type="email" maxLength={254} autoComplete="email" />
              </label>
              <label className="bug-report-honeypot" aria-hidden="true">
                НЕ ЗАПОЛНЯТЬ<input name="website" tabIndex={-1} autoComplete="off" />
              </label>
              {message ? <p className={error ? "form-message error-message" : "form-message success-message"}>{message}</p> : null}
              <button type="submit" disabled={busy}>{busy ? "ОТПРАВЛЯЕМ…" : "ОТПРАВИТЬ БАГ-РЕПОРТ →"}</button>
            </form>
          </section>
        </div>
      ) : null}
    </>
  );
}
