"use client";

import { useEffect, useMemo, useState } from "react";
import "./admin-poppers.css";

/* «Управление → Попперс»: обращения, с которыми Попперс не справился.
   Хороший ответ оператора можно поправить и отправить в базу знаний —
   Попперс будет отвечать так сам. Всё выгружается текстовым файлом. */

type KnowledgeStatus = "new" | "approved" | "skipped";
type Transcript = {
  thread_id: string;
  created_at: string;
  status: "open" | "resolved";
  resolved_by: string | null;
  page_url: string;
  question: string;
  poppers_answer: string;
  messages: Array<{ role: "visitor" | "operator"; text: string; at: string; by?: string }>;
  knowledge_status: KnowledgeStatus;
  knowledge_question: string;
  knowledge_answer: string;
  reviewed_by: string | null;
  suggested_answer: string;
};

type Filter = "new" | "approved" | "skipped" | "all";

const FILTERS: Array<[Filter, string]> = [
  ["new", "НЕ РАЗОБРАНЫ"],
  ["approved", "В БАЗЕ ЗНАНИЙ"],
  ["skipped", "ПРОПУЩЕНЫ"],
  ["all", "ВСЕ"],
];

const dateFormat = new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "short" });

function when(value: string) {
  const time = Date.parse(value);
  return Number.isFinite(time) ? dateFormat.format(new Date(time)) : "";
}

export function AdminPoppersPanel() {
  const [items, setItems] = useState<Transcript[] | null>(null);
  const [filter, setFilter] = useState<Filter>("new");
  const [drafts, setDrafts] = useState<Record<string, { question: string; answer: string }>>({});
  const [busyId, setBusyId] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function load() {
    setError("");
    try {
      const response = await fetch("/api/admin/poppers-learning", { cache: "no-store" });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.error ?? "Не удалось загрузить обращения.");
      setItems(result.transcripts as Transcript[]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось загрузить обращения.");
      setItems((current) => current ?? []);
    }
  }

  useEffect(() => { void load(); }, []);

  const counts = useMemo(() => {
    const list = items ?? [];
    return {
      new: list.filter((item) => item.knowledge_status === "new").length,
      approved: list.filter((item) => item.knowledge_status === "approved").length,
      skipped: list.filter((item) => item.knowledge_status === "skipped").length,
      all: list.length,
    } satisfies Record<Filter, number>;
  }, [items]);

  const visible = (items ?? []).filter((item) => filter === "all" || item.knowledge_status === filter);

  function draftFor(item: Transcript) {
    return drafts[item.thread_id] ?? {
      question: item.knowledge_question || item.question,
      answer: item.knowledge_answer || item.suggested_answer,
    };
  }

  function editDraft(item: Transcript, patch: Partial<{ question: string; answer: string }>) {
    setDrafts((current) => ({ ...current, [item.thread_id]: { ...draftFor(item), ...patch } }));
  }

  async function review(item: Transcript, status: KnowledgeStatus) {
    setBusyId(item.thread_id);
    setError("");
    setMessage("");
    const draft = draftFor(item);
    try {
      const response = await fetch("/api/admin/poppers-learning", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadId: item.thread_id, status, question: draft.question, answer: draft.answer }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.error ?? "Не удалось сохранить решение.");
      const updated = result.transcript as Transcript;
      setItems((current) => (current ?? []).map((entry) => entry.thread_id === updated.thread_id ? updated : entry));
      setDrafts((current) => {
        const next = { ...current };
        delete next[item.thread_id];
        return next;
      });
      setMessage(status === "approved" ? "Ответ добавлен в базу знаний — Попперс начнёт им пользоваться." : status === "skipped" ? "Обращение пропущено." : "Ответ убран из базы знаний.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось сохранить решение.");
    } finally {
      setBusyId("");
    }
  }

  return (
    <section className="admin-panel poppers-learning">
      <div className="admin-panel-heading poppers-learning-heading">
        <div><small>POPPERS_LEARNING.LOG</small><h2>ПОППЕРС</h2></div>
        <div className="poppers-learning-actions">
          <a href="/api/admin/poppers-learning/export?kind=all" download>⇩ ВСЯ ПЕРЕПИСКА .TXT</a>
          <a href="/api/admin/poppers-learning/export?kind=knowledge" download>⇩ БАЗА ЗНАНИЙ .TXT</a>
          <button type="button" className="communication-refresh" onClick={() => { setItems(null); void load(); }}>↻ ОБНОВИТЬ</button>
        </div>
      </div>
      <p className="poppers-learning-intro">
        Здесь обращения, с которыми Попперс не справился и позвал команду: вопрос, ответ Попперса, уточнения посетителя и ответы операторов.
        Почта и телефоны вырезаны. Поправьте формулировку и нажмите «В базу знаний» — Попперс начнёт отвечать на похожие вопросы сам.
      </p>
      {error ? <p className="form-message error-message">{error}</p> : null}
      {message ? <p className="form-message success-message">{message}</p> : null}
      <nav className="poppers-learning-filters" aria-label="Фильтр обращений">
        {FILTERS.map(([value, label]) => (
          <button key={value} type="button" className={filter === value ? "active" : ""} aria-pressed={filter === value} onClick={() => setFilter(value)}>
            {label} <i>{counts[value]}</i>
          </button>
        ))}
      </nav>
      {items === null ? <p className="communication-empty">Загружаем обращения…</p> : null}
      {items !== null && !visible.length ? <p className="communication-empty">{filter === "new" ? "Все обращения разобраны." : "Здесь пока пусто."}</p> : null}
      <div className="poppers-learning-list">
        {visible.map((item) => {
          const draft = draftFor(item);
          const busy = busyId === item.thread_id;
          return (
            <article className={`poppers-learning-card ${item.knowledge_status}`} key={item.thread_id}>
              <header>
                <small>{when(item.created_at)} · {item.page_url || "страница не указана"}</small>
                <span>{item.status === "open" ? "ОТКРЫТО" : `РЕШЕНО${item.resolved_by ? ` · ${item.resolved_by}` : ""}`}</span>
              </header>
              <ol className="poppers-learning-chat">
                <li className="visitor"><b>ПОСЕТИТЕЛЬ</b><p>{item.question}</p></li>
                {item.poppers_answer ? <li className="poppers"><b>ПОППЕРС</b><p>{item.poppers_answer}</p></li> : null}
                {item.messages.map((entry, index) => (
                  <li className={entry.role} key={`${entry.at}-${index}`}>
                    <b>{entry.role === "operator" ? `ОПЕРАТОР${entry.by ? ` · ${entry.by}` : ""}` : "ПОСЕТИТЕЛЬ"}</b>
                    <p>{entry.text}</p>
                    <small>{when(entry.at)}</small>
                  </li>
                ))}
                {!item.messages.some((entry) => entry.role === "operator") ? <li className="note"><p>Оператор ещё не ответил.</p></li> : null}
              </ol>
              <div className="poppers-learning-form">
                <label>ВОПРОС ДЛЯ БАЗЫ ЗНАНИЙ
                  <input value={draft.question} maxLength={500} onChange={(event) => editDraft(item, { question: event.target.value })} />
                </label>
                <label>ОТВЕТ, КОТОРЫЙ ДОЛЖЕН ДАВАТЬ ПОППЕРС
                  <textarea value={draft.answer} maxLength={2000} rows={4} onChange={(event) => editDraft(item, { answer: event.target.value })} placeholder="Напишите ответ своими словами, без личных данных посетителя." />
                </label>
                <div className="poppers-learning-buttons">
                  <button type="button" className="approve" disabled={busy} onClick={() => void review(item, "approved")}>
                    {busy ? "СОХРАНЯЕМ…" : item.knowledge_status === "approved" ? "ОБНОВИТЬ В БАЗЕ" : "В БАЗУ ЗНАНИЙ"}
                  </button>
                  {item.knowledge_status === "approved"
                    ? <button type="button" disabled={busy} onClick={() => void review(item, "new")}>УБРАТЬ ИЗ БАЗЫ</button>
                    : item.knowledge_status === "skipped"
                      ? <button type="button" disabled={busy} onClick={() => void review(item, "new")}>ВЕРНУТЬ В РАЗБОР</button>
                      : <button type="button" disabled={busy} onClick={() => void review(item, "skipped")}>НЕ НУЖНО</button>}
                </div>
                {item.knowledge_status === "approved" && item.reviewed_by ? <small>В базе знаний · добавил {item.reviewed_by}</small> : null}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
