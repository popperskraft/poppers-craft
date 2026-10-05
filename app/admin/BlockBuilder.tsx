"use client";

import { useState } from "react";
import { MinecraftIcon } from "@/app/MinecraftIcon";
import { minecraftIconChoices, minecraftItems, resolveMinecraftIcon } from "@/lib/minecraft-icons";
import { SiteBoard } from "@/app/SiteBoard";
import type { SiteBoardBlock, SiteBoardData, SiteUpdateRow } from "@/lib/waitlist";

const makeId = () => crypto.randomUUID().slice(0, 8);
const makeBlock = (type: SiteBoardBlock["type"], text?: string): SiteBoardBlock => ({ id: makeId(), type, text: text ?? (type === "heading" ? "ЗАГОЛОВОК" : type === "field" ? "Новый вопрос" : "Напишите текст"), emoji: type === "field" ? "book" : "grass", background: "paper", highlight: type === "callout" ? "lime" : "none", ...(type === "field" ? { fieldType: "short", required: true, options: [] } : {}) });
const presets: Record<NonNullable<SiteBoardData["template"]>, () => SiteBoardBlock[]> = {
  paint: () => [makeBlock("heading", "НОВОЕ ОКНО"), makeBlock("text", "Здесь может быть любой текст.")],
  form: () => [makeBlock("heading", "АНКЕТА"), makeBlock("text", "Ответьте на вопросы ниже."), makeBlock("field", "Как вас зовут?")],
  announcement: () => [makeBlock("heading", "ОБЪЯВЛЕНИЕ"), makeBlock("callout", "Короткий текст без лишнего.")],
  cards: () => [makeBlock("heading", "ПОДБОРКА"), makeBlock("callout", "Первая карточка"), makeBlock("callout", "Вторая карточка")],
};

type SavedResponse = { id: number; createdAt: string; submittedBy: string; answers: Record<string, string> };

export function BlockBuilder({ onCreated, savedBoards, onDelete }: { onCreated: (update: SiteUpdateRow) => void; savedBoards: SiteUpdateRow[]; onDelete: (id: number) => Promise<void> }) {
  const [template, setTemplate] = useState<NonNullable<SiteBoardData["template"]>>("paint");
  const [title, setTitle] = useState("Новый блок");
  const [windowTitle, setWindowTitle] = useState("new_block.paint");
  const [surface, setSurface] = useState<NonNullable<SiteBoardData["surface"]>>("paper");
  const [audience, setAudience] = useState<NonNullable<SiteBoardData["audience"]>>("everyone");
  const [submitLabel, setSubmitLabel] = useState("ОТПРАВИТЬ");
  const [blocks, setBlocks] = useState<SiteBoardBlock[]>(() => presets.paint());
  const [placement, setPlacement] = useState<SiteBoardData["placement"]>("after-overview");
  const [publishAt, setPublishAt] = useState("");
  const [dragged, setDragged] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [responsesFor, setResponsesFor] = useState<number | null>(null);
  const [responses, setResponses] = useState<SavedResponse[]>([]);

  const board: SiteBoardData = { kind: "board", title, windowTitle, template, surface, audience, submitLabel, placement, status: "draft", publishAt: null, blocks };
  const change = (index: number, patch: Partial<SiteBoardBlock>) => setBlocks((current) => current.map((block, i) => i === index ? { ...block, ...patch } : block));
  const chooseTemplate = (next: typeof template) => { setTemplate(next); setBlocks(presets[next]()); setWindowTitle(next === "form" ? "questionnaire.exe" : next === "paint" ? "new_block.paint" : "notice.txt"); };
  const submit = async (status: "draft" | "published" | "scheduled") => {
    if (status === "scheduled" && !publishAt) return setMessage("Сначала выберите дату и время.");
    setBusy(true); setMessage("");
    const response = await fetch("/api/admin/updates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...board, status, publishAt: status === "scheduled" ? new Date(publishAt).toISOString() : null }) });
    const result = await response.json(); setBusy(false);
    if (!response.ok) return setMessage(result.error ?? "Не получилось сохранить блок.");
    onCreated(result.update as SiteUpdateRow);
    setMessage(status === "draft" ? "Черновик сохранён." : status === "scheduled" ? "Блок появится в выбранное время." : "Блок опубликован.");
  };
  const loadResponses = async (id: number) => { setResponsesFor(id); const response = await fetch(`/api/admin/board-responses?boardId=${id}`, { cache: "no-store" }); const result = await response.json(); setResponses(response.ok ? result.responses : []); };

  return <section className="block-builder">
    <header className="block-builder-toolbar"><div><small>BLOCK_STUDIO.EXE</small><h2>КОНСТРУКТОР</h2><p>Соберите новый раздел так же, как остальные части сайта.</p></div></header>
    <div className="builder-template-picker">{(["paint", "form", "announcement", "cards"] as const).map((item) => <button className={template === item ? "selected" : ""} type="button" key={item} onClick={() => chooseTemplate(item)}><MinecraftIcon name={item === "form" ? "book" : item === "paint" ? "grass" : item === "cards" ? "chest" : "redstone"} size="sm" /><b>{item === "paint" ? "ОКНО PAINT" : item === "form" ? "АНКЕТА" : item === "announcement" ? "ОБЪЯВЛЕНИЕ" : "КАРТОЧКИ"}</b></button>)}</div>
    <div className="builder-workspace">
      <aside className="builder-settings">
        <h3>НАСТРОЙКИ РАЗДЕЛА</h3>
        <label>НАЗВАНИЕ В АДМИНКЕ<input value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} /></label>
        <label>ЗАГОЛОВОК ОКНА<input value={windowTitle} maxLength={80} onChange={(e) => setWindowTitle(e.target.value)} /></label>
        <label>ФОН РАЗДЕЛА<select value={surface} onChange={(e) => setSurface(e.target.value as typeof surface)}><option value="paper">БУМАГА</option><option value="grass">ТРАВА</option><option value="stone">КАМЕНЬ</option><option value="night">НОЧЬ</option><option value="pink">РОЗОВЫЙ</option><option value="cyan">ГОЛУБОЙ</option></select></label>
        <label>КТО УВИДИТ<select value={audience} onChange={(e) => setAudience(e.target.value as typeof audience)}><option value="everyone">ВСЕ</option><option value="guests">ТОЛЬКО БЕЗ ВХОДА</option><option value="members">ТОЛЬКО ИГРОКИ</option><option value="admins">ТОЛЬКО АДМИНЫ</option></select></label>
        <label>ГДЕ ПОКАЗАТЬ<select value={placement} onChange={(e) => setPlacement(e.target.value as typeof placement)}><option value="after-hero">ПОСЛЕ ПЕРВОГО ЭКРАНА</option><option value="after-overview">ПОСЛЕ ОБЗОРА</option><option value="after-waitlist">ПОСЛЕ ВАЙТЛИСТА</option><option value="updates">В ОБНОВЛЕНИЯХ</option><option value="after-donate">ПОСЛЕ ОБНОВЛЕНИЙ</option><option value="before-discord">ПЕРЕД ПОДВАЛОМ</option></select></label>
        {blocks.some((block) => block.type === "field") ? <label>ТЕКСТ КНОПКИ<input value={submitLabel} maxLength={40} onChange={(e) => setSubmitLabel(e.target.value)} /></label> : null}
      </aside>
      <div className="builder-preview"><div className="builder-preview-label">ТАК БЛОК БУДЕТ ВЫГЛЯДЕТЬ НА САЙТЕ</div><SiteBoard board={board} boardId={0} preview /></div>
    </div>
    <div className="builder-elements-head"><div><h3>СОДЕРЖИМОЕ</h3><p>Перетащите элемент, чтобы поменять порядок.</p></div><div className="builder-tools"><button type="button" onClick={() => setBlocks((b) => [...b, makeBlock("heading")])}>+ ЗАГОЛОВОК</button><button type="button" onClick={() => setBlocks((b) => [...b, makeBlock("text")])}>+ ТЕКСТ</button><button type="button" onClick={() => setBlocks((b) => [...b, makeBlock("callout")])}>+ КАРТОЧКА</button><button type="button" onClick={() => setBlocks((b) => [...b, makeBlock("field")])}>+ ВОПРОС</button></div></div>
    <div className="builder-timeline">{blocks.map((block, index) => <article className={`builder-block board-bg-${block.background}`} key={block.id} draggable onDragStart={() => setDragged(index)} onDragOver={(e) => e.preventDefault()} onDrop={() => { if (dragged === null || dragged === index) return; setBlocks((current) => { const next = [...current]; const [item] = next.splice(dragged, 1); next.splice(index, 0, item); return next; }); setDragged(null); }}>
      <div className="builder-drag">▦ {block.type === "heading" ? "ЗАГОЛОВОК" : block.type === "text" ? "ТЕКСТ" : block.type === "callout" ? "КАРТОЧКА" : "ВОПРОС"} <button type="button" onClick={() => setBlocks((b) => b.filter((_, i) => i !== index))}>×</button></div>
      <textarea value={block.text} maxLength={240} onChange={(e) => change(index, { text: e.target.value })} />
      {block.type === "field" ? <div className="builder-field-options"><label>ТИП<select value={block.fieldType} onChange={(e) => change(index, { fieldType: e.target.value as SiteBoardBlock["fieldType"] })}><option value="short">КОРОТКИЙ ОТВЕТ</option><option value="long">ДЛИННЫЙ ОТВЕТ</option><option value="choice">ВЫБОР ИЗ СПИСКА</option></select></label><label className="builder-required"><input type="checkbox" checked={block.required} onChange={(e) => change(index, { required: e.target.checked })} /> ОБЯЗАТЕЛЬНО</label>{block.fieldType === "choice" ? <label>ВАРИАНТЫ ЧЕРЕЗ ЗАПЯТУЮ<input value={block.options?.join(", ") ?? ""} onChange={(e) => change(index, { options: e.target.value.split(",").map((item) => item.trim()).filter(Boolean).slice(0, 5) })} /></label> : null}</div> : <div className="builder-block-options"><label>ФОН<select value={block.background} onChange={(e) => change(index, { background: e.target.value as SiteBoardBlock["background"] })}><option value="paper">БУМАГА</option><option value="grass">ТРАВА</option><option value="stone">КАМЕНЬ</option><option value="night">НОЧЬ</option><option value="pink">РОЗОВЫЙ</option><option value="cyan">ГОЛУБОЙ</option></select></label><label>ПОЛОСКА<select value={block.highlight} onChange={(e) => change(index, { highlight: e.target.value as SiteBoardBlock["highlight"] })}><option value="none">НЕТ</option><option value="lime">ЛАЙМ</option><option value="yellow">ЖЁЛТАЯ</option><option value="pink">РОЗОВАЯ</option><option value="cyan">ГОЛУБАЯ</option></select></label></div>}
      <div className="builder-emojis minecraft-item-picker" aria-label="Иконка блока">{minecraftIconChoices.map((icon) => <button className={resolveMinecraftIcon(block.emoji) === icon ? "selected" : ""} type="button" key={icon} title={minecraftItems[icon]} aria-label={minecraftItems[icon]} aria-pressed={resolveMinecraftIcon(block.emoji) === icon} onClick={() => change(index, { emoji: icon })}><MinecraftIcon name={icon} size="sm" /></button>)}</div>
    </article>)}</div>
    <div className="builder-publish"><label>ДАТА И ВРЕМЯ<input type="datetime-local" value={publishAt} onChange={(e) => setPublishAt(e.target.value)} /></label><div><button disabled={busy} type="button" onClick={() => submit("draft")}>СОХРАНИТЬ ЧЕРНОВИК</button><button disabled={busy} type="button" onClick={() => submit("scheduled")}>ОПУБЛИКОВАТЬ ПОЗЖЕ</button><button disabled={busy} type="button" onClick={() => submit("published")}>ОПУБЛИКОВАТЬ СЕЙЧАС →</button></div></div>
    {message ? <p className="form-message">{message}</p> : null}
    <div className="builder-saved"><h3>СОХРАНЁННЫЕ РАЗДЕЛЫ</h3>{!savedBoards.length ? <p>Пока ничего нет.</p> : savedBoards.map((update) => <article key={update.id}><div><b>{update.board?.title || update.title}</b><small>{update.board?.status === "draft" ? "ЧЕРНОВИК" : update.board?.status === "scheduled" ? "ПО РАСПИСАНИЮ" : "ОПУБЛИКОВАН"} · {update.board?.audience === "guests" ? "ГОСТИ" : update.board?.audience === "members" ? "ИГРОКИ" : update.board?.audience === "admins" ? "АДМИНЫ" : "ВСЕ"}</small></div><div className="builder-saved-actions">{update.board?.blocks.some((block) => block.type === "field") ? <button type="button" onClick={() => loadResponses(update.id)}>ОТВЕТЫ</button> : null}<button type="button" disabled={deletingId === update.id} onClick={async () => { if (!window.confirm("Удалить раздел и все ответы на его анкету?")) return; setDeletingId(update.id); await onDelete(update.id); setDeletingId(null); }}>{deletingId === update.id ? "УДАЛЯЕМ…" : "УДАЛИТЬ"}</button></div></article>)}</div>
    {responsesFor !== null ? <div className="builder-response-modal"><div className="paint-window"><div className="window-bar"><span>form_answers_{responsesFor}.txt</span><button onClick={() => setResponsesFor(null)}>×</button></div><div className="builder-response-list">{!responses.length ? <p>Ответов пока нет.</p> : responses.map((response) => <article key={response.id}><small>{new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "short" }).format(new Date(response.createdAt))} · {response.submittedBy}</small>{Object.entries(response.answers).map(([question, answer]) => <div key={question}><b>{question}</b><p>{answer || "—"}</p></div>)}</article>)}</div></div></div> : null}
  </section>;
}
