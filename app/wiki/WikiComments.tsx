"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition, type FormEvent } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { WikiComment } from "@/lib/wiki";
import { wikiThreads } from "@/lib/wiki-discussion";
import { loginPageUrl } from "@/lib/login-return";
import { WikiAuthor } from "./WikiAuthor";

export function WikiComments({ articleId, comments, canComment }: { articleId: number; comments: WikiComment[]; canComment: boolean }) {
  const router = useRouter(), path = usePathname();
  const threads = useMemo(() => wikiThreads(comments), [comments]);
  const [body, setBody] = useState("");
  const [replyTo, setReplyTo] = useState<number | null>(null);
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [opened, setOpened] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [refreshing, startTransition] = useTransition();
  const lock = useRef(false);
  const [message, setMessage] = useState("");
  const pendingFocus = useRef<number | null>(null);
  const disabled = busy || refreshing;
  const byId = useMemo(() => new Map(comments.map(comment => [comment.id, comment])), [comments]);

  useEffect(() => {
    const reveal = () => {
      const id = Number(window.location.hash.match(/^#comment-(\d+)$/)?.[1]);
      const thread = threads.find(item => item.root.id === id || item.replies.some(reply => reply.id === id));
      if (thread) setOpened(current => current.includes(thread.root.id) ? current : [...current, thread.root.id]);
    };
    reveal();
    window.addEventListener("hashchange", reveal);
    return () => window.removeEventListener("hashchange", reveal);
  }, [threads]);

  useEffect(() => {
    if (pendingFocus.current && byId.has(pendingFocus.current)) {
      document.getElementById(`comment-${pendingFocus.current}`)?.scrollIntoView({ block: "nearest" });
      pendingFocus.current = null;
    }
  }, [byId, opened]);

  async function mutate(url: string, method: string, data?: unknown) {
    if (lock.current) return null;
    lock.current = true; setBusy(true); setMessage("");
    try {
      const response = await fetch(url, { method, headers: { "content-type": "application/json" }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Не удалось выполнить действие. Попробуйте ещё раз.");
      startTransition(() => router.refresh());
      return result;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось выполнить действие. Попробуйте ещё раз.");
      return null;
    } finally { lock.current = false; setBusy(false); }
  }

  async function submit(event: FormEvent, parentId: number | null) {
    event.preventDefault();
    const text = (parentId === null ? body : drafts[parentId] ?? "").trim();
    if (text.length < 2 || text.length > 900 || disabled) return;
    const result = await mutate(`/api/wiki/articles/${articleId}/comments`, "POST", { body: text, parentId });
    if (!result) return;
    if (parentId === null) setBody("");
    else {
      setDrafts(current => ({ ...current, [parentId]: "" })); setReplyTo(null);
      const thread = threads.find(item => item.root.id === parentId || item.replies.some(reply => reply.id === parentId));
      if (thread) setOpened(current => [...new Set([...current, thread.root.id])]);
    }
    pendingFocus.current = result.id;
    setMessage("Комментарий опубликован.");
  }

  function compose(parentId: number | null) {
    const value = parentId === null ? body : drafts[parentId] ?? "";
    return <form className="wiki-discuss-compose" onSubmit={event => void submit(event, parentId)}>
      <label htmlFor={`wiki-reply-${parentId ?? "new"}`}>{parentId === null ? "ВАШ КОММЕНТАРИЙ" : <><span>Ответ для</span> <span translate="no">@{byId.get(parentId)?.author.login}</span></>}</label>
      <textarea id={`wiki-reply-${parentId ?? "new"}`} autoFocus={parentId !== null} value={value} maxLength={900} rows={3} required minLength={2} placeholder={parentId === null ? "Задайте вопрос или поделитесь своим опытом…" : "Напишите ответ…"} onChange={event => parentId === null ? setBody(event.target.value) : setDrafts(current => ({ ...current, [parentId]: event.target.value }))} onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} />
      <div className="wiki-discuss-compose-footer"><small>{value.length} / 900 · Ctrl / ⌘ + Enter</small><div>{parentId !== null ? <button className="wiki-button" type="button" disabled={disabled} onClick={() => setReplyTo(null)}>ОТМЕНА</button> : null}<button type="submit" className="wiki-button is-acid" disabled={disabled || value.trim().length < 2}>{busy ? "ОТПРАВЛЯЮ…" : parentId === null ? "ОТПРАВИТЬ" : "ОТВЕТИТЬ"}</button></div></div>
    </form>;
  }

  function card(comment: WikiComment, reply = false) {
    const parent = comment.parentId === null ? null : byId.get(comment.parentId);
    return <article id={`comment-${comment.id}`} key={comment.id} className={`wiki-discuss-message ${reply ? "is-reply" : ""}`} tabIndex={-1}>
      <header><WikiAuthor author={comment.author} compact /><a className="wiki-discuss-time" href={`#comment-${comment.id}`} title="Ссылка на комментарий"><time dateTime={comment.createdAt}>{new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(comment.createdAt))}</time></a></header>
      {parent ? <a className="wiki-discuss-parent" href={`#comment-${parent.id}`}><span>В ответ на</span> <span translate="no">@{parent.author.login}</span> ↑</a> : null}
      {comment.deleted ? <p className="wiki-discuss-deleted">Комментарий удалён. Ответы сохранены.</p> : <p className="wiki-discuss-body" translate="no">{comment.body}</p>}
      {!comment.deleted ? <div className="wiki-discuss-actions">
        <button className="wiki-button" type="button" disabled={!canComment || disabled} aria-pressed={comment.myLiked} onClick={() => void mutate(`/api/wiki/comments/${comment.id}/reaction`, "POST", { liked: !comment.myLiked })}><span>{comment.myLiked ? "НРАВИТСЯ" : "ЛАЙК"}</span> <span>{comment.likes}</span></button>
        {canComment ? <button className="wiki-button" type="button" disabled={disabled} aria-expanded={replyTo === comment.id} onClick={() => setReplyTo(replyTo === comment.id ? null : comment.id)}>ОТВЕТИТЬ</button> : null}
        {comment.canDelete ? <button className="wiki-button is-danger" type="button" disabled={disabled} onClick={() => { if (window.confirm("Удалить этот комментарий? Ответы других игроков останутся.")) void mutate(`/api/wiki/comments/${comment.id}`, "DELETE"); }}>УДАЛИТЬ</button> : null}
      </div> : null}
      {replyTo === comment.id && !comment.deleted ? compose(comment.id) : null}
    </article>;
  }

  return <section className="wiki-discuss" id="discussion" aria-labelledby="wiki-discuss-title" aria-busy={disabled}>
    <header className="wiki-discuss-heading"><div><p className="wiki-eyebrow">COMMUNITY / TALK</p><h2 id="wiki-discuss-title">ОБСУЖДЕНИЕ</h2><p>Обсуждайте статью и отвечайте друг другу.</p></div><span>{`Комментариев: ${comments.filter(comment => !comment.deleted).length}`}</span></header>
    {canComment ? compose(null) : <p className="wiki-notice"><Link href={loginPageUrl(path)}>Войти, чтобы оставить комментарий</Link></p>}
    {message ? <p className="wiki-notice" role="status">{message}</p> : null}
    <div className="wiki-discuss-threads">{threads.map(thread => <section className="wiki-discuss-thread" key={thread.root.id}>
      {card(thread.root)}
      {thread.replies.length ? <><button type="button" className="wiki-discuss-toggle wiki-button" aria-expanded={opened.includes(thread.root.id)} aria-controls={`thread-${thread.root.id}`} onClick={() => setOpened(current => current.includes(thread.root.id) ? current.filter(id => id !== thread.root.id) : [...current, thread.root.id])}>{opened.includes(thread.root.id) ? "СВЕРНУТЬ ТРЕД" : "ОТКРЫТЬ ВЕСЬ ТРЕД"} <span>({thread.replies.length})</span></button><div id={`thread-${thread.root.id}`} hidden={!opened.includes(thread.root.id)}>{thread.replies.map(comment => card(comment, true))}</div></> : null}
    </section>)}</div>
    {!comments.length ? <p className="wiki-library-empty">Обсуждение ещё не началось. Оставьте первый комментарий.</p> : null}
  </section>;
}
