"use client";

import { useMemo, useState } from "react";
import type { SiteErrorLog } from "@/lib/error-logs";

function logNumber(id: number) {
  return `LOG-${String(id).padStart(6, "0")}`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "medium" }).format(new Date(value));
}

export function AdminErrorLogsPanel({ initialLogs, initialLoadedAt }: { initialLogs: SiteErrorLog[]; initialLoadedAt: string }) {
  const [logs, setLogs] = useState(initialLogs);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loadedAt, setLoadedAt] = useState(initialLoadedAt);
  const categories = useMemo(() => Array.from(new Set(logs.map((log) => log.category))).sort(), [logs]);
  const recentSince = Date.parse(loadedAt) - 30 * 60_000;
  const recentCount = logs.filter((log) => Date.parse(log.created_at) >= recentSince).length;
  const serverCount = logs.filter((log) => log.category === "server" || (log.status_code ?? 0) >= 500).length;
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("ru-RU");
    return logs.filter((log) => {
      if (category !== "all" && log.category !== category) return false;
      if (!needle) return true;
      return [logNumber(log.id), log.message, log.page, log.source, log.stack, log.user_agent]
        .some((value) => value.toLocaleLowerCase("ru-RU").includes(needle));
    });
  }, [category, logs, query]);

  async function refresh() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/admin/error-logs", { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Не удалось обновить журнал.");
      setLogs(result.logs as SiteErrorLog[]);
      setLoadedAt(String(result.generatedAt));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось обновить журнал.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="admin-panel error-log-dashboard">
      <div className="admin-panel-heading error-log-heading">
        <div><small>SITE_ERRORS.LOG</small><h2>ЛОГИ</h2></div>
        <button type="button" className="communication-refresh" disabled={busy} onClick={() => void refresh()}>{busy ? "ОБНОВЛЯЕМ…" : "↻ ОБНОВИТЬ"}</button>
      </div>
      <p className="communication-intro">Автоматический журнал ошибок сайта. Номер каждой записи постоянный. Баг-репорт сам получает номера логов того же пользователя за предыдущие 30 минут.</p>
      {error ? <p className="form-message error-message">{error}</p> : null}
      <div className="error-log-stats">
        <article><small>ВСЕГО В ЖУРНАЛЕ</small><strong>{logs.length}</strong></article>
        <article><small>ЗА 30 МИНУТ</small><strong>{recentCount}</strong></article>
        <article><small>СЕРВЕР / API 500</small><strong>{serverCount}</strong></article>
      </div>
      <div className="error-log-filters">
        <label>ПОИСК<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Номер, страница или текст ошибки" /></label>
        <label>ТИП<select value={category} onChange={(event) => setCategory(event.target.value)}><option value="all">ВСЕ ТИПЫ</option>{categories.map((item) => <option value={item} key={item}>{item.toUpperCase()}</option>)}</select></label>
        <span>{filtered.length} ЗАПИСЕЙ</span>
      </div>
      <div className="error-log-list">
        {filtered.length ? filtered.map((log) => (
          <article className={`error-log-card category-${log.category}`} id={`log-${log.id}`} key={log.id}>
            <header><code>{logNumber(log.id)}</code><span>{log.category.toUpperCase()}</span><time>{formatDate(log.created_at)}</time></header>
            <h3>{log.message}</h3>
            <dl>
              <div><dt>СТРАНИЦА</dt><dd>{log.page}</dd></div>
              {log.method ? <div><dt>ЗАПРОС</dt><dd>{log.method}{log.status_code ? ` · ${log.status_code}` : ""}</dd></div> : null}
              {log.source ? <div><dt>ИСТОЧНИК</dt><dd>{log.source}</dd></div> : null}
              {log.digest ? <div><dt>DIGEST</dt><dd>{log.digest}</dd></div> : null}
            </dl>
            {log.stack ? <details><summary>ТЕХНИЧЕСКИЕ ДЕТАЛИ</summary><pre>{log.stack}</pre></details> : null}
            {log.user_agent ? <small>{log.user_agent}</small> : null}
          </article>
        )) : <p className="communication-empty">Подходящих записей нет.</p>}
      </div>
    </section>
  );
}
