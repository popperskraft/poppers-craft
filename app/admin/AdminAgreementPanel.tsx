"use client";

import { useMemo, useState } from "react";
import { AGREEMENT_VERSION, type AgreementAcceptance } from "@/lib/user-agreement";

/* Журнал принятия пользовательского соглашения.

   Показывает, кто и когда принял, какую редакцию и с какого адреса. Именно
   это и есть доказательная часть: без журнала собранные согласия не имеют
   смысла. Записи создаются только сервером и здесь не редактируются. */

function formatMoment(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  }).format(date);
}

export function AdminAgreementPanel({
  initialAcceptances,
  registeredAccounts,
}: {
  initialAcceptances: AgreementAcceptance[];
  registeredAccounts: number;
}) {
  const [acceptances, setAcceptances] = useState(initialAcceptances);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");

  const current = useMemo(
    () => acceptances.filter((row) => row.version === AGREEMENT_VERSION).length,
    [acceptances],
  );

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return acceptances;
    return acceptances.filter((row) =>
      row.login.toLowerCase().includes(needle) || row.userId.toLowerCase().includes(needle));
  }, [acceptances, query]);

  async function refresh() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/admin/agreement", { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Не удалось обновить журнал.");
      setAcceptances(result.acceptances ?? []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось обновить журнал.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="admin-panel">
      <div className="admin-panel-heading">
        <div><small>AGREEMENT.LOG</small><h2>СОГЛАСИЯ</h2></div>
        <button type="button" onClick={() => void refresh()} disabled={busy}>
          {busy ? "ОБНОВЛЯЕМ…" : "ОБНОВИТЬ"}
        </button>
      </div>

      <div className="agreement-stats">
        <article className="communication-metric-card">
          <small>ТЕКУЩАЯ РЕДАКЦИЯ</small>
          <strong>{AGREEMENT_VERSION}</strong>
        </article>
        <article className="communication-metric-card">
          <small>ПРИНЯЛИ ТЕКУЩУЮ</small>
          <strong>{current}</strong>
        </article>
        <article className="communication-metric-card">
          <small>ВСЕГО АККАУНТОВ</small>
          <strong>{registeredAccounts}</strong>
        </article>
        <article className="communication-metric-card">
          <small>ЕЩЁ НЕ ПРИНЯЛИ</small>
          <strong>{Math.max(0, registeredAccounts - current)}</strong>
        </article>
      </div>

      {error ? <p className="form-message error-message">{error}</p> : null}

      <label className="agreement-search">
        ПОИСК ПО НИКУ
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          maxLength={40}
          placeholder="например, kirpich"
        />
      </label>

      {visible.length ? (
        <div className="agreement-log">
          {visible.map((row) => (
            <article key={row.userId} className={row.version === AGREEMENT_VERSION ? "" : "is-outdated"}>
              <b>{row.login || row.userId}</b>
              <span className="agreement-log-version">РЕДАКЦИЯ {row.version}</span>
              <time dateTime={row.acceptedAt}>{formatMoment(row.acceptedAt)}</time>
              <small>{row.ip || "адрес не записан"}</small>
            </article>
          ))}
        </div>
      ) : (
        <p className="communication-empty">
          {query ? "Никого не нашли." : "Пока никто не принял соглашение."}
        </p>
      )}
    </section>
  );
}
