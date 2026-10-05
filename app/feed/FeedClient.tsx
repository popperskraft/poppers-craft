"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import type { FeedPost } from "@/lib/community";
import { ProfileHeaderArt } from "@/app/ProfileHeaderArt";
import { videoFileToSilentLoop } from "./video-to-silent-loop";
import { FeedPollCard } from "./FeedPollCard";
import { validatePoll } from "@/lib/feed-content";
import { StickerBar } from "@/app/StickerBar";
import { joinClasses, plusClass } from "@/lib/plus-style";

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

export function FeedClient({
  posts,
  isAdmin,
  query,
  sort,
  page,
  online = [],
  viewerPlus = false,
  viewerHype = false,
  pinnedPostId = null,
  earlyAccess = [],
}: {
  posts: FeedPost[];
  isAdmin: boolean;
  query: string;
  sort: string;
  page: number;
  online?: string[];
  /* Подписка зрителя: стикеры — с любой, закреп поста — с HYPE. */
  viewerPlus?: boolean;
  viewerHype?: boolean;
  pinnedPostId?: number | null;
  earlyAccess?: string[];
}) {
  const router = useRouter();
  const [pinned, setPinned] = useState<number | null>(pinnedPostId);
  /* Ранний доступ: вид ленты запоминается в браузере. */
  const [compact, setCompact] = useState(false);
  const [dark, setDark] = useState(false);

  useEffect(() => {
    try {
      setCompact(window.localStorage.getItem("popperscraft:feed-compact") === "1");
      setDark(window.localStorage.getItem("popperscraft:feed-dark") === "1");
    } catch {
      /* Приватный режим — просто оставляем обычный вид. */
    }
  }, []);

  const rememberMode = (key: string, value: boolean) => {
    try {
      window.localStorage.setItem(`popperscraft:${key}`, value ? "1" : "0");
    } catch {
      /* Не сохранилось — вид всё равно переключится до перезагрузки. */
    }
  };

  async function togglePin(postId: number) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/feed/posts/${postId}/pin`, { method: "PUT" });
      const result = await response.json().catch(() => null) as { pinned?: boolean; error?: string } | null;
      if (!response.ok) throw new Error(result?.error ?? "Не удалось закрепить пост.");
      setPinned(result?.pinned ? postId : null);
      setMessage(result?.pinned ? "Пост закреплён в профиле." : "Пост откреплён.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось закрепить пост.");
    } finally {
      setBusy(false);
    }
  }

  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [removedComments, setRemovedComments] = useState<Set<number>>(() => new Set());
  const [pendingComment, setPendingComment] = useState<number | null>(null);
  const [bodyLength, setBodyLength] = useState(0);
  const [slayPostId, setSlayPostId] = useState<number | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  /* Панель поиска прячется, пока её не позвали: в ленте она занимала место
     сверху у всех, хотя нужна редко. С активным запросом остаётся открытой. */
  const [searchOpen, setSearchOpen] = useState(Boolean(query));
  const [mediaStatus, setMediaStatus] = useState("");
  const [postKind, setPostKind] = useState<"none" | "vote">("none");
  const [mediaName, setMediaName] = useState("");
  const [pollOptions, setPollOptions] = useState(["", ""]);
  const slayTimer = useRef<number | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, 10_000);
    return () => window.clearInterval(timer);
  }, [router]);

  useEffect(() => () => {
    if (slayTimer.current) window.clearTimeout(slayTimer.current);
  }, []);

  useEffect(() => {
    const pending = new Map<Element, number>();
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const postId = Number(entry.target.getAttribute("data-post-id"));
        const post = posts.find((item) => item.id === postId);
        if (!post || post.seen) continue;
        if (entry.isIntersecting) {
          if (!pending.has(entry.target)) {
            const timer = window.setTimeout(() => {
              fetch(`/api/feed/posts/${postId}/view`, { method: "POST" }).catch(() => undefined);
              observer.unobserve(entry.target);
              pending.delete(entry.target);
            }, 1200);
            pending.set(entry.target, timer);
          }
        } else {
          const timer = pending.get(entry.target);
          if (timer) window.clearTimeout(timer);
          pending.delete(entry.target);
        }
      }
    }, { threshold: 0.6 });
    document.querySelectorAll(".feed-post[data-post-id]").forEach((post) => observer.observe(post));
    return () => {
      observer.disconnect();
      pending.forEach((timer) => window.clearTimeout(timer));
    };
  }, [posts]);

  async function submitPost(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setBusy(true); setMessage("");
    try {
      const formData = new FormData(form);
      const poll = validatePoll(postKind === "none" ? null : { kind: postKind, question: String(formData.get("pollQuestion") ?? ""), options: pollOptions });
      formData.set("poll", JSON.stringify(poll));
      const media = formData.get("media");
      formData.delete("media");
      if (media instanceof File && media.size > 0) {
        if (media.type.startsWith("video/")) {
          const silentVideo = await videoFileToSilentLoop(media, setMediaStatus);
          formData.set("image", silentVideo);
          setMediaStatus("ВИДЕО ГОТОВО. ЗАГРУЖАЕМ…");
        } else if (["image/jpeg", "image/png", "image/webp"].includes(media.type)) {
          formData.set("image", media);
          setMediaStatus("ЗАГРУЖАЕМ СКРИНШОТ…");
        } else {
          throw new Error("Выберите скриншот или видео из Minecraft.");
        }
      }
      const response = await fetch("/api/feed/posts", { method: "POST", body: formData });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error ?? "Не удалось опубликовать пост.");
      form.reset();
      setBodyLength(0);
      setPostKind("none");
      setPollOptions(["", ""]);
      setMediaStatus("");
      setMediaName("");
      setMessage("Пост опубликован.");
      setComposerOpen(false);
      router.refresh();
      window.setTimeout(() => router.refresh(), 350);
    } catch (error) {
      const text = error instanceof Error ? error.message : "Не удалось опубликовать пост.";
      setMessage(text);
      setMediaStatus(text);
    } finally {
      setBusy(false);
    }
  }

  async function action(url: string, init: RequestInit, fallback: string) {
    setBusy(true); setMessage("");
    try {
    const response = await fetch(url, init);
    const result = await response.json();
    setBusy(false);
    if (!response.ok) {
      setMessage(result.error ?? fallback);
      return false;
    }
    router.refresh();
    return true;
    } catch {
      setMessage("Нет связи с сервером. Попробуйте ещё раз.");
      return false;
    } finally { setBusy(false); }
  }

  async function addComment(event: FormEvent<HTMLFormElement>, postId: number) {
    event.preventDefault();
    const form = event.currentTarget;
    const body = String(new FormData(form).get("body") ?? "");
    await action(`/api/feed/posts/${postId}/comments`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body }) }, "Не удалось отправить комментарий.");
    form.reset();
  }

  async function deleteComment(postId: number, commentId: number) {
    const ok = await action(`/api/feed/posts/${postId}/comments/${commentId}`, { method: "DELETE" }, "Не удалось удалить комментарий.");
    if (ok) {
      setRemovedComments(previous => new Set([...previous, commentId]));
      setMessage("Комментарий удалён.");
      setPendingComment(null);
    }
  }

  return (
      <div className={composerOpen ? "feed-layout" : "feed-layout composer-closed"}>
      {/* Верх ленты — одна панель шириной ленты: действия слева, переход к
          списку игроков справа, ниже — вид ленты. Раньше кнопки стояли по
          краям широкой полосы, а режимы вида — отдельной строкой у левого края. */}
      <div className="feed-toolbar">
        <div className="feed-entry-actions">
          <button className="feed-open-composer" type="button" onClick={() => setComposerOpen((value) => !value)}>{composerOpen ? "× ЗАКРЫТЬ" : "+ СОЗДАТЬ ПОСТ"}</button>
          <button className="feed-open-search" type="button" aria-expanded={searchOpen} onClick={() => setSearchOpen((value) => !value)}>{searchOpen ? "× ЗАКРЫТЬ ПОИСК" : "ПОИСК"}</button>
          <Link className="feed-open-finder" href="/players">СПИСОК ИГРОКОВ →</Link>
        </div>
        {earlyAccess.length ? (
          <div className="feed-modes" role="group" aria-label="Вид ленты">
            <span className="feed-modes-label">ВИД ЛЕНТЫ</span>
            {earlyAccess.includes("feed-compact") ? (
              <button className={compact ? "active" : ""} type="button" aria-pressed={compact} onClick={() => { setCompact((value) => { rememberMode("feed-compact", !value); return !value; }); }}>▤ КОМПАКТНО</button>
            ) : null}
            {earlyAccess.includes("feed-dark") ? (
              <button className={dark ? "active" : ""} type="button" aria-pressed={dark} onClick={() => { setDark((value) => { rememberMode("feed-dark", !value); return !value; }); }}>☾ ТЁМНАЯ</button>
            ) : null}
            <span className="feed-modes-note">РАННИЙ ДОСТУП HYPE</span>
          </div>
        ) : null}
      </div>
      {searchOpen ? <form className="feed-search-bar" action="/feed" method="get" role="search" key={`${query}:${sort}`}>
        <label>ПОИСК В ЛЕНТЕ<input name="q" type="search" defaultValue={query} maxLength={120} placeholder="Ник, заголовок, текст или вопрос…" /></label>
        <label>СОРТИРОВКА<select name="sort" defaultValue={sort} onChange={event => event.currentTarget.form?.requestSubmit()}><option value="newest">Сначала новые</option><option value="oldest">Сначала старые</option><option value="nick">По нику А–Я / A–Z</option></select></label>
        <button type="submit">НАЙТИ</button>
        {query ? <Link href={`/feed?sort=${sort}`}>СБРОСИТЬ</Link> : null}
        <small>Поиск по всем постам: ник, имя, текст и опросы. Регистр, @ и е/ё не важны; небольшие опечатки допустимы.</small>
      </form> : null}
      {composerOpen ? <aside className="paint-window feed-composer">
        <div className="window-bar"><span>new_post.txt</span><span>×</span></div>
        <button className="feed-close-composer" type="button" onClick={() => setComposerOpen(false)} aria-label="Закрыть редактор">×</button>
        <form onSubmit={submitPost}>
          <label>ЗАГОЛОВОК<input name="title" required minLength={3} maxLength={120} /></label>
          <label>ТИП ПОСТА<select value={postKind} onChange={event => setPostKind(event.target.value as typeof postKind)} disabled={busy}><option value="none">Обычный пост</option><option value="vote">Голосование с вариантами</option></select></label>
          <label>ТЕКСТ{postKind !== "none" ? " (НЕОБЯЗАТЕЛЬНО)" : ""}<textarea name="body" required={postKind === "none"} maxLength={1600} rows={6} onChange={(event) => setBodyLength(event.target.value.length)} /><small className="feed-counter">{bodyLength} / 1600</small></label>
          {postKind === "vote" ? <fieldset className="feed-poll-editor" disabled={busy}><legend>ГОЛОСОВАНИЕ</legend><label>ВОПРОС<input name="pollQuestion" required minLength={3} maxLength={200} placeholder="Что хотите спросить?" /></label><small>От 2 до 10 вариантов. Каждый игрок выбирает один.</small>{pollOptions.map((option, index) => <div className="feed-option-editor" key={index}><input aria-label={`Вариант ${index + 1}`} value={option} required maxLength={120} placeholder={`Вариант ${index + 1}`} onChange={event => setPollOptions(values => values.map((value, i) => i === index ? event.target.value : value))} /><button type="button" disabled={pollOptions.length <= 2} aria-label={`Убрать вариант ${index + 1}`} onClick={() => setPollOptions(values => values.filter((_, i) => i !== index))}>×</button></div>)}<button type="button" disabled={pollOptions.length >= 10} onClick={() => setPollOptions(values => [...values, ""])}>+ ВАРИАНТ</button></fieldset> : null}
          <label className="feed-file">СКРИНШОТ ИЛИ ВИДЕО ИЗ ИГРЫ (НЕОБЯЗАТЕЛЬНО)<span className="feed-file-picker"><span>ДОБАВИТЬ ФАЙЛ</span><input aria-label="Добавить файл" name="media" type="file" disabled={busy} accept="image/jpeg,image/png,image/webp,video/mp4,video/webm,video/quicktime,video/*" onChange={(event) => { const file = event.target.files?.[0]; setMediaName(file?.name ?? ""); setMediaStatus(file?.type.startsWith("video/") ? "ПЕРВЫЕ 5 СЕКУНД СОХРАНЯТСЯ БЕЗ ЗВУКА" : ""); }} /></span>{mediaName ? <span className="feed-file-name" translate="no">{mediaName}</span> : null}<small>Только материалы из Minecraft. Видео сохраняется в хорошем цвете, без аудиодорожки и зацикливается при показе.</small>{mediaStatus ? <strong className="feed-media-status" role="status">{mediaStatus}</strong> : null}</label>
          <button disabled={busy}>{busy ? "ГОТОВИМ ПОСТ…" : "ОПУБЛИКОВАТЬ"}</button>
        </form>
        <p className="feed-hint">Скриншот — до 8 МБ, готовое беззвучное видео — до 4 МБ.</p>
        <Link className="feed-my-profile" href="/profile?edit=1">РЕДАКТИРОВАТЬ ПРОФИЛЬ →</Link>
      </aside> : null}
      <section className={joinClasses("feed-stream", compact && "is-compact", dark && "is-dark")} aria-label="Публикации игроков">
        {message ? <p className="feed-message" role="status">{message}</p> : null}
        {!posts.length ? <div className="feed-empty">{query ? "НИЧЕГО НЕ НАЙДЕНО. ПОПРОБУЙТЕ ДРУГОЙ ЗАПРОС." : "ПОКА НЕТ ПОСТОВ. МОЖНО БЫТЬ ПЕРВЫМ."}</div> : null}
        {posts.map((post) => (
          <article className={post.followed && !post.seen ? "feed-post is-followed" : "feed-post"} key={post.id} id={`post-${post.id}`} data-post-id={post.id}>
            <header>
              <Link href={`/players/${post.author.login}`} className={joinClasses("profile-flag", `flag-${post.author.header_flag}`, plusClass(post.author.plus, post.author.ring, post.author.tier))} style={{ backgroundColor: post.author.header_color }}>
                {/* В ленте шапки неподвижны: анимация — только в профиле игрока. */}
                <ProfileHeaderArt art={post.author.header_flag === "custom" ? post.author.header_art : null} playing={false} />
                {post.author.plus ? <i className="plus-ring" aria-hidden="true" /> : null}
                <span>{post.author.display_name}</span><small>@{post.author.login}</small>
                {post.author.plus ? <span className={post.author.tier === "hype" ? "plus-tag is-hype" : "plus-tag"}>{post.author.tier === "hype" ? "HYPE" : "PLUS"}</span> : null}
                {online.includes(post.author.login) ? <em className="pc-online-badge">В ИГРЕ</em> : null}
              </Link>
              <div><time>{formatDate(post.createdAt)}</time>{post.followed ? <b>ПОДПИСКА</b> : null}</div>
            </header>
            <h2>{post.title}</h2>
            <p className="feed-post-body">{post.body}</p>
            {post.poll ? <FeedPollCard postId={post.id} poll={post.poll} /> : null}
            {post.imageUrl ? post.mediaKind === "video" ? <video className="feed-post-image feed-post-video" src={post.imageUrl} autoPlay muted loop playsInline preload="metadata" tabIndex={0} aria-label="Беззвучное видео из публикации. Нажмите, чтобы поставить на паузу или продолжить." title="Нажмите, чтобы поставить на паузу" onClick={(event) => { if (event.currentTarget.paused) void event.currentTarget.play(); else event.currentTarget.pause(); }} onKeyDown={(event) => { if (event.key !== " " && event.key !== "Enter") return; event.preventDefault(); if (event.currentTarget.paused) void event.currentTarget.play(); else event.currentTarget.pause(); }} /> : <Image className="feed-post-image" src={post.imageUrl} alt="Изображение из публикации" width={1200} height={900} sizes="(max-width: 820px) 100vw, 760px" unoptimized /> : null}
            <div className="feed-reactions">
              <button className={post.myReaction === "like" ? "active" : ""} disabled={busy} onClick={async () => { const addedLike = post.myReaction !== "like"; const ok = await action(`/api/feed/posts/${post.id}/reaction`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reaction: "like" }) }, "Не удалось поставить лайк."); if (ok && addedLike) { if (slayTimer.current) window.clearTimeout(slayTimer.current); setSlayPostId(post.id); slayTimer.current = window.setTimeout(() => setSlayPostId(null), 3000); } }}>▲ НРАВИТСЯ {post.likes}</button>
              {slayPostId === post.id ? <div className="slay-like-badge" role="status" aria-live="polite"><div className="slay-flight" aria-hidden="true"><div className="slay-comet"><i className="rainbow-tail"><b /><b /><b /><b /><b /></i><i className="happy-star"><b className="star-eye left" /><b className="star-eye right" /><em /></i><span className="star-spark one">✦</span><span className="star-spark two">✦</span></div></div><strong>SLAY DIVA</strong></div> : null}
              <button className={post.myReaction === "dislike" ? "active dislike" : ""} disabled={busy} onClick={() => action(`/api/feed/posts/${post.id}/reaction`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reaction: "dislike" }) }, "Не удалось сохранить реакцию.")}>▼ НЕ НРАВИТСЯ {isAdmin && post.dislikes !== null ? post.dislikes : ""}</button>
              {/* Свой пост можно закрепить в карточке профиля — это HYPE. */}
              {viewerHype && post.canDelete && !post.deleteAsAdmin ? (
                <button type="button" disabled={busy} onClick={() => void togglePin(post.id)}>
                  {pinned === post.id ? "ОТКРЕПИТЬ ОТ ПРОФИЛЯ" : "ЗАКРЕПИТЬ В ПРОФИЛЕ"}
                </button>
              ) : null}
              {post.canDelete ? <button className={post.deleteAsAdmin ? "delete admin-delete" : "delete"} disabled={busy} onClick={() => { const prompt = post.deleteAsAdmin ? `Удалить чужой пост @${post.author.login} как администратор?` : "Удалить этот пост?"; if (window.confirm(prompt)) action(`/api/feed/posts/${post.id}`, { method: "DELETE" }, "Не удалось удалить пост."); }}>{post.deleteAsAdmin ? "УДАЛИТЬ КАК АДМИН" : "УДАЛИТЬ"}</button> : null}
            </div>
            <StickerBar kind="feed_post" id={post.id} counts={post.stickers} mine={post.mySticker} canAdd={viewerPlus} />
            <div className="feed-comments">
              {post.comments.filter(comment => !removedComments.has(comment.id)).map((comment) => (
                <div key={comment.id}>
                  <Link href={`/players/${comment.author.login}`} className={plusClass(comment.author.plus, comment.author.ring, comment.author.tier) || undefined}>{comment.author.display_name}</Link>
                  <p>{comment.body}</p><time>{formatDate(comment.createdAt)}</time>
                  {isAdmin ? pendingComment === comment.id ? (
                    <div className="feed-comment-confirm" role="group" aria-label="Удалить комментарий как администратор">
                      <p>Удалить этот комментарий как администратор?</p>
                      <button type="button" className="feed-comment-delete" disabled={busy} onClick={() => deleteComment(post.id, comment.id)}>ДА, УДАЛИТЬ</button>
                      <button type="button" className="feed-comment-cancel" disabled={busy} autoFocus onClick={() => setPendingComment(null)}>ОТМЕНА</button>
                    </div>
                  ) : <button type="button" className="feed-comment-delete" disabled={busy} aria-label="Удалить комментарий как администратор" onClick={() => setPendingComment(comment.id)}>УДАЛИТЬ</button> : null}
                </div>
              ))}
              <form onSubmit={(event) => addComment(event, post.id)}><input name="body" required maxLength={1200} placeholder="Написать комментарий..." /><button disabled={busy}>ОТПРАВИТЬ</button></form>
            </div>
          </article>
        ))}
        {posts.length >= page * 40 && page < 25 ? <Link className="feed-load-more" href={`/feed?${new URLSearchParams({ q: query, sort, page: String(page + 1) })}`} scroll={false}>ПОКАЗАТЬ ЕЩЁ</Link> : null}
      </section>
      </div>
  );
}
