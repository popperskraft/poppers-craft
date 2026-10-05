"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { PoppersRichText } from "./PoppersRichText";

/* Ответ администратора помнит своё обращение (threadId): когда обращение
   решено, такие сообщения убираются из чата. */
type Message = {
  role: "user" | "assistant";
  text: string;
  key?: string;
  threadId?: string;
  author?: string;
  kind?: "admin" | "note";
};
type SupportThread = { id: string; replies: Array<{ id: string; text: string; at: string; by: string }> };

function visiblePageText() {
  const main = document.querySelector("main");
  return String((main as HTMLElement | null)?.innerText ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 12_000);
}

export function PoppersAssistant() {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<Message[]>([
    { role: "assistant", text: "Привет. Я Попперс. Спроси меня о сервере или об этой странице." },
  ]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [openThread, setOpenThread] = useState<string | null>(null);
  const [closingThread, setClosingThread] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  /* В приложении для iPhone помощник открывается отдельным окном
     (html[data-pc-app-view="assistant"]) — сразу разворачиваем панель. */
  useEffect(() => {
    if (document.documentElement.dataset.pcAppView === "assistant") setOpen(true);
  }, []);

  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, []);

  useEffect(() => {
    if (!open) return;

    let secondFrame = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        const log = logRef.current;
        if (log) log.scrollTop = log.scrollHeight;
      });
    });
    const finalLayoutCheck = window.setTimeout(() => {
      const log = logRef.current;
      if (log) log.scrollTop = log.scrollHeight;
    }, 160);

    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
      window.clearTimeout(finalLayoutCheck);
    };
  }, [messages, busy, open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const loadReplies = async () => {
      try {
        const response = await fetch("/api/poppers/replies", { cache: "no-store" });
        /* При сбое ничего не трогаем: иначе ответы исчезли бы, будто вопрос решён. */
        if (!response.ok) return;
        const result = await response.json();
        if (cancelled || !Array.isArray(result.threads)) return;
        const threads = result.threads as SupportThread[];
        const openIds = new Set(threads.map((thread) => thread.id));
        setOpenThread(threads.at(-1)?.id ?? null);
        setMessages((current) => {
          /* Решённые обращения: их ответы убираются из чата. */
          const resolved = new Set(current.flatMap((message) => (message.threadId && !openIds.has(message.threadId) ? [message.threadId] : [])));
          let next = resolved.size ? current.filter((message) => !(message.threadId && resolved.has(message.threadId))) : current;
          if (resolved.size) next = [...next, { role: "assistant", kind: "note", text: "Администратор отметил вопрос решённым. Спрашивайте Попперса, если появится что-то ещё." }];
          /* Новые ответы открытых обращений. */
          const known = new Set(next.flatMap((message) => (message.key ? [message.key] : [])));
          const fresh: Message[] = threads.flatMap((thread) => thread.replies
            .filter((reply) => !known.has(`${thread.id}:${reply.id}`))
            .map((reply) => ({ role: "assistant" as const, kind: "admin" as const, key: `${thread.id}:${reply.id}`, threadId: thread.id, author: reply.by, text: reply.text })));
          if (!resolved.size && !fresh.length) return current;
          return [...next, ...fresh];
        });
      } catch {
        // The bridge keeps polling; a temporary network error needs no UI warning.
      }
    };
    void loadReplies();
    const timer = window.setInterval(() => void loadReplies(), 4_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [open]);

  async function ask(includePage: boolean) {
    const cleanQuestion = question.trim();
    if (!cleanQuestion || busy) return;
    setBusy(true);
    setError("");
    setMessages((current) => [...current, { role: "user", text: cleanQuestion }]);
    setQuestion("");
    try {
      const response = await fetch("/api/poppers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: cleanQuestion,
          pageTitle: document.title,
          pageUrl: window.location.pathname,
          pageText: includePage ? visiblePageText() : "",
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Попперс сейчас не отвечает.");
      setMessages((current) => [...current, { role: "assistant", text: String(result.answer) }]);
      if (typeof result.supportThreadId === "string") setOpenThread(result.supportThreadId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Попперс сейчас не отвечает.");
    } finally {
      setBusy(false);
    }
  }

  /* Посетитель сам завершает обращение — например, вопрос решился сам. */
  async function finishSupportThread() {
    if (closingThread) return;
    setClosingThread(true);
    setError("");
    try {
      const response = await fetch("/api/poppers/replies", { method: "POST" });
      if (!response.ok) throw new Error();
      const closedId = openThread;
      setOpenThread(null);
      setMessages((current) => [
        ...current.filter((message) => !(closedId && message.threadId === closedId)),
        { role: "assistant", kind: "note", text: "Обращение завершено. Я снова на связи — спрашивайте." },
      ]);
    } catch {
      setError("Не получилось завершить обращение. Попробуйте ещё раз.");
    } finally {
      setClosingThread(false);
    }
  }

  return (
    <>
      <button className="poppers-assistant-button" type="button" onClick={() => setOpen(true)} aria-label="Открыть помощника Попперса" aria-expanded={open}>
        <Image src="/poppers-villager.png" width={64} height={64} alt="" />
        <span>ПОППЕРС</span>
      </button>
      <aside className={open ? "poppers-assistant-panel is-open" : "poppers-assistant-panel"} aria-hidden={!open} aria-label="Помощник Попперс">
        <div className="window-bar">
          <span>poppers_ai.exe</span>
          <button type="button" onClick={() => setOpen(false)} aria-label="Закрыть помощника">×</button>
        </div>
        <div className="poppers-assistant-head">
          <Image src="/poppers-villager.png" width={72} height={72} alt="Мирный житель Попперс" />
          <div><small>ПОМОЩНИК СЕРВЕРА</small><h2>ПОППЕРС</h2></div>
        </div>
        <div className="poppers-assistant-log" ref={logRef} aria-live="polite">
          {messages.map((message, index) => message.role === "assistant" && !message.kind ? (
            /* Ответ Попперса — с заголовками и списками вместо звёздочек (PoppersRichText). */
            <div className="assistant" key={message.key ?? `${message.role}-${index}`}>
              <b>ПОППЕРС</b>
              <PoppersRichText text={message.text} />
            </div>
          ) : (
            <p className={message.kind ? `${message.role} ${message.kind}` : message.role} key={message.key ?? `${message.role}-${index}`}>
              <b>{message.role === "user" ? "ВЫ" : message.kind === "admin" ? `АДМИНИСТРАТОР${message.author ? ` · ${message.author}` : ""}` : "ПОППЕРС"}</b>
              {message.text}
            </p>
          ))}
          {busy ? <p className="assistant"><b>ПОППЕРС</b>Думаю…</p> : null}
        </div>
        <form className="poppers-assistant-form" onSubmit={(event) => { event.preventDefault(); void ask(false); }}>
          {openThread ? (
            <div className="poppers-support-banner">
              <span>Открыто обращение к администратору — ваши сообщения получает команда. Переписку мы сохраняем без почты и телефонов, чтобы Попперс учился отвечать сам.</span>
              <button type="button" onClick={() => void finishSupportThread()} disabled={closingThread}>ЗАВЕРШИТЬ</button>
            </div>
          ) : null}
          <label htmlFor="poppers-question">ВОПРОС</label>
          <textarea id="poppers-question" data-grammar="off" value={question} onChange={(event) => setQuestion(event.target.value)} maxLength={500} rows={3} placeholder="Например: как попасть на сервер?" required />
          {error ? <p className="poppers-assistant-error">{error}</p> : null}
          <div>
            <button type="submit" disabled={busy}>СПРОСИТЬ</button>
            <button type="button" disabled={busy || !question.trim()} onClick={() => void ask(true)}>ПО ЭТОЙ СТРАНИЦЕ</button>
          </div>
          <small>При втором варианте видимый текст страницы отправится в Gemini. Поля форм и пароли не отправляются.</small>
        </form>
      </aside>
    </>
  );
}
