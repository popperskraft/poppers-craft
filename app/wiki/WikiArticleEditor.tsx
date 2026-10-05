/* eslint-disable @next/next/no-img-element */
/* eslint-disable react-hooks/set-state-in-effect -- Hydrate account-scoped localStorage after SSR, never during render. */
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { WikiArticleContent } from "./WikiArticleContent";
import { WIKI_ARTICLE_CATEGORIES, wikiBlockLabel, type WikiArticleBlock, type WikiBlockType } from "@/lib/wiki-content";
import { parseWikiLocalDraft, wikiDocumentKey, type WikiEditorDocument, type WikiLocalDraft } from "@/lib/wiki-editor";
import { PixelHeaderEditor } from "@/app/profile/PixelHeaderEditor";
import { emptyPixelHeaderArt, hasPixelHeaderArt, type PixelHeaderArt } from "@/lib/profile-header-art";
import { WikiCover } from "./WikiCover";
import "./wiki-community.css";

export type EditableArticle = {
  id: number; slug: string; title: string; summary: string; category: string; tags: string[];
  content: WikiArticleBlock[]; status: "draft" | "published"; updatedAt: string;
  coverArt?: PixelHeaderArt | null;
};
function block(type: WikiBlockType, id = crypto.randomUUID()): WikiArticleBlock {
  return { id, type, text: "", font: "pixel", color: "#161616", ...(type === "heading" ? { level: 2 } : {}), ...(type === "list" ? { listStyle: "bullet" } : {}) };
}

export function WikiArticleEditor({ article, userId }: { article?: EditableArticle; userId: string }) {
  const router = useRouter();
  const initial: WikiEditorDocument = { title: article?.title ?? "", summary: article?.summary ?? "", category: article?.category ?? "ГАЙДЫ", tags: article?.tags.join(", ") ?? "", blocks: article?.content.length ? article.content : [block("paragraph", "intro")], coverArt: article?.coverArt ?? null };
  const [history, setHistory] = useState<{ past: WikiEditorDocument[]; current: WikiEditorDocument; future: WikiEditorDocument[] }>({ past: [], current: initial, future: [] });
  const doc = history.current;
  const [source, setSource] = useState(article ? { id: article.id, slug: article.slug, status: article.status, updatedAt: article.updatedAt } : null);
  const [savedKey, setSavedKey] = useState(() => wikiDocumentKey(initial));
  const dirty = wikiDocumentKey(doc) !== savedKey;
  const [selected, setSelected] = useState(doc.blocks[0]?.id ?? "");
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const locked = busy || Boolean(uploading);
  const requestLock = useRef(false);
  const editGroup = useRef("");
  const painting = useRef(false);
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);
  const [localMessage, setLocalMessage] = useState("");
  const [ready, setReady] = useState(false);
  const [recovery, setRecovery] = useState<WikiLocalDraft | null>(null);
  const storageKey = `pc-wiki-draft:v1:${userId}:${source?.id ?? "new"}`;
  const mountedKey = useRef(storageKey);
  const [conflict, setConflict] = useState(false);

  function change(transform: (value: WikiEditorDocument) => WikiEditorDocument, group = "") {
    setMessage("");
    const coalesce = Boolean(group && editGroup.current === group);
    editGroup.current = group;
    setHistory(current => ({ past: coalesce ? current.past : [...current.past, current.current].slice(-60), current: transform(current.current), future: [] }));
  }
  function undo(redo = false) {
    editGroup.current = "";
    setHistory(current => {
      if (redo) return current.future.length ? { past: [...current.past, current.current], current: current.future[0], future: current.future.slice(1) } : current;
      return current.past.length ? { past: current.past.slice(0, -1), current: current.past[current.past.length - 1], future: [current.current, ...current.future] } : current;
    });
  }
  function update(id: string, patch: Partial<WikiArticleBlock>, group = "") {
    change(value => ({ ...value, blocks: value.blocks.map(item => item.id === id ? { ...item, ...patch } : item) }), group);
  }
  function add(type: WikiBlockType) {
    if (doc.blocks.length >= 60 || locked) return;
    const item = block(type);
    change(value => {
      const index = value.blocks.findIndex(candidate => candidate.id === selected);
      const next = [...value.blocks]; next.splice(index >= 0 ? index + 1 : next.length, 0, item);
      return { ...value, blocks: next };
    });
    setSelected(item.id);
    setTimeout(() => document.getElementById(`write-${item.id}`)?.scrollIntoView({ block: "center", behavior: "smooth" }), 0);
  }

  useEffect(() => {
    let stored: WikiLocalDraft | null = null;
    try { stored = parseWikiLocalDraft(localStorage.getItem(mountedKey.current), userId); }
    catch { setLocalMessage("Локальная копия недоступна. Сохраняйте черновик на сайте."); }
    if (stored && wikiDocumentKey(stored.document) !== savedKey) {
      if (stored.updatedAt === (article?.updatedAt ?? null)) {
        setHistory({ past: [initial], current: stored.document, future: [] });
        setLocalMessage("Восстановлена локальная копия. Сохраните её на сайте.");
      } else setRecovery(stored);
    }
    setReady(true);
    // Load once per editor mount; a server refresh must never replace unsaved typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!ready || recovery || !dirty) return;
    const persist = () => {
      try {
        localStorage.setItem(storageKey, JSON.stringify({ version: 1, userId, updatedAt: source?.updatedAt ?? null, savedAt: new Date().toISOString(), document: doc } satisfies WikiLocalDraft));
        setLocalMessage("Локальная копия сохранена в этом браузере.");
        return true;
      } catch { setLocalMessage("Локальная копия недоступна. Сохраняйте черновик на сайте."); return false; }
    };
    persist();
    const leave = (event: BeforeUnloadEvent) => { if (!persist()) event.preventDefault(); };
    const hidden = () => { if (document.visibilityState === "hidden") persist(); };
    window.addEventListener("beforeunload", leave); document.addEventListener("visibilitychange", hidden);
    return () => { window.removeEventListener("beforeunload", leave); document.removeEventListener("visibilitychange", hidden); };
  }, [doc, dirty, ready, recovery, storageKey, source, userId]);

  async function refreshImages(document: WikiEditorDocument) {
    const paths = document.blocks.filter(item => item.imageId).map(item => item.imageId);
    if (!paths.length) return document;
    try {
      const response = await fetch("/api/wiki/images/refresh", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ paths, articleId: source?.id }) });
      const result = await response.json();
      if (response.ok) return { ...document, blocks: document.blocks.map(item => item.imageId ? { ...item, imageUrl: result.urls?.[item.imageId] ?? null } : item) };
    } catch { /* The saved image IDs remain intact even if previews cannot load. */ }
    return document;
  }
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    void refreshImages(doc).then(restored => {
      if (!cancelled) setHistory(current => ({ ...current, current: { ...current.current, blocks: current.current.blocks.map(item => ({ ...item, imageUrl: restored.blocks.find(candidate => candidate.id === item.id && candidate.imageId === item.imageId)?.imageUrl ?? item.imageUrl })) } }));
    });
    return () => { cancelled = true; };
    // Refresh recovered signed URLs once, without touching the user's text/history.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  async function uploadImage(id: string, file: File | undefined) {
    if (!file || requestLock.current) return;
    if (file.size > 8 * 1024 * 1024 || !["image/png", "image/jpeg", "image/webp"].includes(file.type)) { setMessage("Можно загрузить PNG, JPEG или WEBP размером до 8 МБ."); setIsError(true); return; }
    requestLock.current = true; setUploading(id); setMessage("ЗАГРУЖАЮ СКРИНШОТ..."); setIsError(false);
    try {
      const data = new FormData(); data.append("image", file);
      const response = await fetch("/api/wiki/images", { method: "POST", body: data });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Не удалось загрузить скриншот.");
      update(id, { imageId: result.image.id, imageUrl: result.image.url });
      setMessage("СКРИНШОТ ЗАГРУЖЕН.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Не удалось загрузить скриншот."); setIsError(true); }
    finally { setUploading(null); requestLock.current = false; }
  }

  async function save(status: "draft" | "published") {
    if (requestLock.current || recovery) return;
    if (doc.title.trim().length < 3) { setMessage("Название должно содержать от 3 до 120 символов."); setIsError(true); document.getElementById("wiki-title")?.focus(); return; }
    requestLock.current = true; setBusy(true); setIsError(false); setConflict(false);
    setMessage("СОХРАНЯЮ СТАТЬЮ…");
    try {
      const response = await fetch(source ? `/api/wiki/articles/${source.id}` : "/api/wiki/articles", {
        method: source ? "PATCH" : "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...doc, status, expectedUpdatedAt: source?.updatedAt }),
      });
      const result = await response.json();
      if (!response.ok) { setConflict(response.status === 409); throw new Error(result.error || "Не удалось сохранить статью."); }
      setSource(result.article); setSavedKey(wikiDocumentKey(doc));
      try { localStorage.removeItem(storageKey); localStorage.removeItem(`pc-wiki-draft:v1:${userId}:${result.article.id}`); } catch { /* Server save succeeded. */ }
      setLocalMessage("");
      setMessage(status === "published" ? "СТАТЬЯ ОПУБЛИКОВАНА." : "ЧЕРНОВИК СОХРАНЁН. ОН ВИДЕН ТОЛЬКО ВАМ И АДМИНИСТРАТОРАМ.");
      if (!source) router.replace(`/wiki/articles/${result.article.slug}/edit`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Не удалось сохранить статью."); setIsError(true); }
    finally { requestLock.current = false; setBusy(false); }
  }

  async function restore() {
    if (!recovery) return;
    const restored = await refreshImages(recovery.document);
    change(() => restored); setRecovery(null);
    setLocalMessage("Восстановлена локальная копия. Сохраните её на сайте.");
  }
  const exit = (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (locked || (dirty && !window.confirm("Выйти из редактора? Не забудьте сохранить изменения на сайте."))) event.preventDefault();
  };
  const count = doc.blocks.reduce((total, item) => total + item.text.length, 0);

  return <section className="wiki-write" onKeyDown={event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") { event.preventDefault(); if (!locked) void save(source?.status ?? "draft"); }
  }}>
    <header className="wiki-write-header"><div><p className="wiki-eyebrow">WIKI / EDITOR</p><h1>{article ? "РЕДАКТОР СТАТЬИ" : "НОВАЯ СТАТЬЯ"}</h1></div><Link className="wiki-button" href="/wiki/articles" onClick={exit}>← К СТАТЬЯМ</Link></header>
    {recovery ? <aside className="wiki-notice wiki-write-recovery"><strong>В браузере есть несохранённая копия, но статья на сайте уже обновилась.</strong><p>Можно восстановить свой текст или продолжить с текущей версией сайта.</p><details><summary>ПОСМОТРЕТЬ ЛОКАЛЬНУЮ КОПИЮ</summary><h3 translate="no">{recovery.document.title}</h3><div><WikiArticleContent blocks={recovery.document.blocks} /></div></details><div><button type="button" className="wiki-button is-acid" onClick={() => void restore()}>ВОССТАНОВИТЬ МОЙ ТЕКСТ</button><button type="button" className="wiki-button" onClick={() => { setRecovery(null); try { localStorage.removeItem(storageKey); } catch {} }}>ОСТАВИТЬ ВЕРСИЮ САЙТА</button></div></aside> : null}
    <div className="wiki-write-toolbar"><div role="group" aria-label="Режим редактора"><button type="button" className="wiki-button" aria-pressed={!preview} onClick={() => setPreview(false)}>НАПИСАТЬ</button><button type="button" className="wiki-button" aria-pressed={preview} onClick={() => setPreview(true)}>ПРЕДПРОСМОТР</button></div><div><button type="button" className="wiki-button" disabled={locked || !history.past.length} onClick={() => undo()} title="Отменить последнее изменение">↶ <span>НАЗАД</span></button><button type="button" className="wiki-button" disabled={locked || !history.future.length} onClick={() => undo(true)} title="Повторить изменение">↷ <span>ВПЕРЁД</span></button></div></div>
    <fieldset disabled={locked || Boolean(recovery)} className="wiki-write-layout">
      <div className="wiki-write-paper">
        {preview ? <div className="wiki-write-preview"><WikiCover art={doc.coverArt} /><span className="wiki-category">{doc.category}</span>{doc.title ? <h2 translate="no">{doc.title}</h2> : <h2>Название статьи</h2>}{doc.summary ? <p translate="no">{doc.summary}</p> : null}<WikiArticleContent blocks={doc.blocks} /></div> : <>
          <label className="wiki-write-title" htmlFor="wiki-title">НАЗВАНИЕ СТАТЬИ<input id="wiki-title" value={doc.title} maxLength={120} placeholder="О чём вы хотите рассказать?" onChange={event => change(value => ({ ...value, title: event.target.value }), "title")} /><small>{doc.title.length} / 120</small></label>
          <section className="wiki-cover-editor" aria-label="Шапка статьи" inert={locked || Boolean(recovery)}>
            <WikiCover art={doc.coverArt} />
            <details><summary>{hasPixelHeaderArt(doc.coverArt ?? null) ? "ИЗМЕНИТЬ ШАПКУ СТАТЬИ" : "+ НАРИСОВАТЬ ШАПКУ СТАТЬИ"}</summary>
              <PixelHeaderEditor context="article" art={doc.coverArt ?? emptyPixelHeaderArt()}
                onChange={art => change(value => ({ ...value, coverArt: art }), painting.current ? "cover-stroke" : "")}
                onActivate={() => {}} canUndo={Boolean(history.past.length)} canRedo={Boolean(history.future.length)}
                onUndo={() => undo()} onRedo={() => undo(true)}
                onEditStart={() => { painting.current = true; editGroup.current = ""; }}
                onEditEnd={() => { painting.current = false; editGroup.current = ""; }} />
            </details>
            {hasPixelHeaderArt(doc.coverArt ?? null) ? <button className="wiki-button" type="button" onClick={() => change(value => ({ ...value, coverArt: null }))}>УБРАТЬ ШАПКУ</button> : <p>Шапка необязательна. Можно добавить её позже.</p>}
          </section>
          <p className="wiki-write-hint">Начните с текста. Добавляйте заголовки, картинки и другие блоки по мере необходимости.</p>
          <div className="wiki-write-blocks">{doc.blocks.map((item, index) => <section className={`wiki-write-block ${selected === item.id ? "is-selected" : ""}`} id={`write-${item.id}`} key={item.id} onFocus={() => setSelected(item.id)}>
            <header><span>{String(index + 1).padStart(2, "0")} / <span>{wikiBlockLabel(item.type)}</span></span><details className="wiki-write-block-menu"><summary aria-label="Действия с блоком">•••</summary><div>
              <button type="button" disabled={index === 0} onClick={() => change(value => { const next = [...value.blocks]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; return { ...value, blocks: next }; })}>↑ ВЫШЕ</button>
              <button type="button" disabled={index === doc.blocks.length - 1} onClick={() => change(value => { const next = [...value.blocks]; [next[index], next[index + 1]] = [next[index + 1], next[index]]; return { ...value, blocks: next }; })}>↓ НИЖЕ</button>
              <button type="button" disabled={doc.blocks.length >= 60} onClick={() => { const copy = { ...item, id: crypto.randomUUID() }; change(value => ({ ...value, blocks: [...value.blocks.slice(0, index + 1), copy, ...value.blocks.slice(index + 1)] })); setSelected(copy.id); }}>СОЗДАТЬ КОПИЮ</button>
              <button type="button" className="is-danger" onClick={() => { change(value => ({ ...value, blocks: value.blocks.filter(candidate => candidate.id !== item.id) })); setMessage("Блок убран. Его можно вернуть кнопкой «Назад»."); setIsError(false); }}>УБРАТЬ БЛОК</button>
            </div></details></header>
            {item.type === "image" ? <div className="wiki-write-image">
              {item.imageUrl ? <img src={item.imageUrl} alt={item.alt || "Скриншот из статьи"} /> : <p>{item.imageId ? "Изображение сохранено. Предпросмотр временно недоступен." : "Добавьте скриншот к своей истории."}</p>}
              <label className="wiki-button is-cyan wiki-write-file"><span>{uploading === item.id ? "ЗАГРУЖАЮ…" : item.imageId ? "ЗАМЕНИТЬ ИЗОБРАЖЕНИЕ" : "ДОБАВИТЬ ИЗОБРАЖЕНИЕ"}</span><input type="file" accept="image/png,image/jpeg,image/webp" onChange={event => { void uploadImage(item.id, event.target.files?.[0]); event.target.value = ""; }} /></label>
              <small>PNG, JPEG или WEBP · до 8 МБ</small>
              <label>ПОДПИСЬ<input value={item.caption ?? ""} maxLength={300} placeholder="Что изображено на скриншоте?" onChange={event => update(item.id, { caption: event.target.value }, `caption-${item.id}`)} /></label>
              <details className="wiki-write-options"><summary>ОПИСАНИЕ ДЛЯ ДОСТУПНОСТИ</summary><label>АЛЬТЕРНАТИВНЫЙ ТЕКСТ<input value={item.alt ?? ""} maxLength={180} onChange={event => update(item.id, { alt: event.target.value }, `alt-${item.id}`)} /></label></details>
            </div> : item.type === "divider" ? <hr /> : <>
              <textarea className={item.type === "heading" ? "is-heading" : undefined} rows={item.type === "heading" ? 2 : item.type === "paragraph" ? 6 : 4} aria-label={`Содержимое блока ${index + 1}`} value={item.text} maxLength={item.type === "heading" ? 180 : item.type === "code" ? 12000 : 6000} placeholder={item.type === "heading" ? "Название раздела" : item.type === "list" ? "Каждый пункт — с новой строки" : item.type === "code" ? "/команда или фрагмент кода" : "Напишите здесь свой текст…"} onChange={event => update(item.id, { text: event.target.value }, `text-${item.id}`)} />
              <details className="wiki-write-options"><summary>ОФОРМЛЕНИЕ</summary><div>
                {item.type === "heading" ? <label>УРОВЕНЬ<select value={item.level ?? 2} onChange={event => update(item.id, { level: Number(event.target.value) as 2 | 3 })}><option value={2}>Раздел</option><option value={3}>Подраздел</option></select></label> : null}
                {item.type === "list" ? <label>ТИП СПИСКА<select value={item.listStyle ?? "bullet"} onChange={event => update(item.id, { listStyle: event.target.value as "bullet" | "number" })}><option value="bullet">Маркеры</option><option value="number">Нумерация</option></select></label> : null}
                {item.type !== "code" ? <label>ЦВЕТ ТЕКСТА<input type="color" value={item.color} onChange={event => update(item.id, { color: event.target.value }, `color-${item.id}`)} /></label> : null}
                {item.font !== "pixel" ? <button type="button" className="wiki-button" onClick={() => update(item.id, { font: "pixel" })}>ПИКСЕЛЬНЫЙ ШРИФТ</button> : null}
              </div></details>
            </>}
          </section>)}</div>
          <div className="wiki-write-insert"><strong>ДОБАВИТЬ ПОСЛЕ ВЫБРАННОГО БЛОКА</strong><div>{(["paragraph", "heading", "image", "list"] as WikiBlockType[]).map(type => <button className="wiki-button" type="button" key={type} disabled={doc.blocks.length >= 60} onClick={() => add(type)}>+ <span>{wikiBlockLabel(type)}</span></button>)}<details><summary className="wiki-button">ЕЩЁ</summary><div>{(["quote", "notice", "code", "divider"] as WikiBlockType[]).map(type => <button className="wiki-button" type="button" key={type} disabled={doc.blocks.length >= 60} onClick={() => add(type)}>{wikiBlockLabel(type)}</button>)}</div></details></div>{doc.blocks.length >= 60 ? <p>Достигнут лимит: 60 блоков.</p> : null}</div>
        </>}
      </div>
      <aside className="wiki-write-sidebar">
        <h2>О СТАТЬЕ</h2>
        <label>КРАТКОЕ ОПИСАНИЕ<textarea rows={4} value={doc.summary} maxLength={500} placeholder="Одно-два предложения для карточки статьи" onChange={event => change(value => ({ ...value, summary: event.target.value }), "summary")} /><small>{doc.summary.length} / 500</small></label>
        <label>РАЗДЕЛ<select value={doc.category} onChange={event => change(value => ({ ...value, category: event.target.value }))}>{WIKI_ARTICLE_CATEGORIES.map(category => <option key={category} value={category}>{category}</option>)}</select></label>
        <label>ТЕГИ<input value={doc.tags} maxLength={220} placeholder="ферма, редстоун, новичкам" onChange={event => change(value => ({ ...value, tags: event.target.value }), "tags")} /><small>До 8 тегов через запятую, до 24 символов каждый.</small></label>
        <div className="wiki-write-checklist"><strong>ПЕРЕД ПУБЛИКАЦИЕЙ</strong><p>{doc.title.trim().length >= 3 ? "✓" : "□"} <span>У статьи есть название</span></p><p>{doc.blocks.some(item => item.type === "image" ? item.imageId : item.type !== "divider" && item.text.trim()) ? "✓" : "□"} <span>Добавлен текст или скриншот</span></p><p>{doc.summary.trim() ? "✓" : "□"} <span>Описание помогает понять тему</span></p></div>
        <small>{`Блоков: ${doc.blocks.length} / 60`}</small><small>{`Символов: ${count} / 50 000`}</small>
        <p className="wiki-write-hint">Нарисованная шапка станет обложкой. Без неё используем первый скриншот или текстовую карточку.</p>
      </aside>
    </fieldset>
    <footer className="wiki-write-savebar">
      <div className="wiki-write-save-state"><strong>{source?.status === "published" ? "ОПУБЛИКОВАНО" : "ЧЕРНОВИК"}{dirty ? " · *" : ""}</strong><small>{localMessage || (dirty ? "Есть несохранённые изменения" : "Изменений нет")}</small></div>
      <div className="wiki-write-save-actions">{source?.status === "published" ? <Link href={`/wiki/articles/${source.slug}`} onClick={exit} className="wiki-button">ОТКРЫТЬ СТАТЬЮ ↗</Link> : <button type="button" className="wiki-button" disabled={locked || Boolean(recovery)} onClick={() => void save("draft")}>СОХРАНИТЬ ЧЕРНОВИК</button>}<button type="button" className="wiki-button is-green" disabled={locked || Boolean(recovery)} onClick={() => void save("published")}>{busy ? "СОХРАНЯЮ…" : source?.status === "published" ? "СОХРАНИТЬ ИЗМЕНЕНИЯ" : "ОПУБЛИКОВАТЬ →"}</button></div>
      {message ? <div className={`wiki-write-feedback wiki-notice ${isError ? "is-error" : ""}`} role={isError ? "alert" : "status"}><p>{message}</p>{conflict && source ? <a className="wiki-button" href={`/wiki/articles/${source.slug}/edit`} target="_blank" rel="noopener noreferrer">ОТКРЫТЬ СВЕЖУЮ ВЕРСИЮ ↗</a> : null}</div> : null}
    </footer>
  </section>;
}
