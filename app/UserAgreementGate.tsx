"use client";

import { useState } from "react";
import Link from "next/link";
import { resetTrail } from "@/lib/navigation-trail";
import {
  AGREEMENT_CHANGES,
  AGREEMENT_DATE,
  AGREEMENT_SECTIONS,
  AGREEMENT_SUMMARY,
  AGREEMENT_VERSION,
} from "@/lib/user-agreement";

/* Разовое окно принятия пользовательского соглашения.

   Показывается только вошедшему пользователю, который ещё не принял текущую
   редакцию. Факт принятия хранится на сервере, поэтому окно не появится
   заново ни после очистки браузера, ни на другом устройстве.

   Окно намеренно модальное и без крестика: пользоваться Платформой, не приняв
   условия, нельзя. Отказ — это выход из аккаунта, что честнее, чем кнопка
   «позже», которая ничего не решает. */

export function UserAgreementGate({ needsAcceptance }: { needsAcceptance: boolean }) {
  const [open, setOpen] = useState(needsAcceptance);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (!open) return null;

  const accept = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/agreement", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version: AGREEMENT_VERSION }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Не удалось сохранить согласие.");
      setOpen(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось сохранить согласие.");
      setBusy(false);
    }
  };

  const decline = async () => {
    if (busy) return;
    setBusy(true);
    await fetch("/api/logout", { method: "POST" }).catch(() => undefined);
    resetTrail();
    window.location.href = "/";
  };

  return (
    <div className="agreement-gate-backdrop" role="presentation">
      <section
        className="paint-window agreement-gate"
        role="dialog"
        aria-modal="true"
        aria-labelledby="agreement-gate-title"
      >
        <div className="window-bar"><span>user_agreement.txt</span></div>
        <div className="agreement-gate-body">
          <p className="kicker">РЕДАКЦИЯ {AGREEMENT_VERSION} ОТ {AGREEMENT_DATE.toUpperCase()}</p>
          <h2 id="agreement-gate-title">ПОЛЬЗОВАТЕЛЬСКОЕ СОГЛАШЕНИЕ</h2>
          <p>Мы оформили условия использования PoppersCraft. Чтобы продолжить пользоваться аккаунтом, их нужно принять.</p>

          {/* Что нового в этой редакции — тем, кто уже принимал прошлую. */}
          <div className="agreement-gate-changes">
            <strong>НОВОЕ В РЕДАКЦИИ {AGREEMENT_VERSION}</strong>
            <ul>{AGREEMENT_CHANGES.map((line) => <li key={line}>{line}</li>)}</ul>
          </div>

          <ul className="agreement-gate-summary">
            {AGREEMENT_SUMMARY.map((line) => <li key={line}>{line}</li>)}
          </ul>

          {/* Полный текст доступен прямо здесь: соглашаться вслепую
              пользователь не должен. */}
          <div className="agreement-gate-text" tabIndex={0} role="region" aria-label="Полный текст соглашения">
            {AGREEMENT_SECTIONS.map((section) => (
              <section key={section.heading}>
                <h3>{section.heading}</h3>
                {section.paragraphs?.map((text) => <p key={text}>{text}</p>)}
                {section.items ? (
                  <ul>{section.items.map((text) => <li key={text}>{text}</li>)}</ul>
                ) : null}
              </section>
            ))}
          </div>

          <p className="agreement-gate-note">
            Полный текст также доступен на странице <Link href="/rules#agreement">правил</Link>.
          </p>

          {error ? <p className="form-message error-message" role="alert">{error}</p> : null}

          <div className="agreement-gate-actions">
            <button type="button" onClick={decline} disabled={busy}>НЕ ПРИНИМАЮ, ВЫЙТИ</button>
            <button type="button" className="agreement-gate-accept" onClick={accept} disabled={busy}>
              {busy ? "СОХРАНЯЕМ…" : "ПРИНИМАЮ"}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
