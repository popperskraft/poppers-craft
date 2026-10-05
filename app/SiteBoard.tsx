"use client";

import { FormEvent, useState } from "react";
import { MinecraftIcon } from "./MinecraftIcon";
import { isMinecraftIconName } from "@/lib/minecraft-icons";
import type { SiteBoardBlock, SiteBoardData } from "@/lib/waitlist";

function BoardElement({ block, preview }: { block: SiteBoardBlock; preview: boolean }) {
  const icon = isMinecraftIconName(block.emoji) ? <MinecraftIcon name={block.emoji} size="sm" /> : null;
  if (block.type === "field") {
    const field = block.fieldType === "long"
      ? <textarea name={block.id} required={block.required} maxLength={500} disabled={preview} />
      : block.fieldType === "choice"
        ? <select name={block.id} required={block.required} disabled={preview}><option value="">Выбрать</option>{block.options?.map((option) => <option key={option}>{option}</option>)}</select>
        : <input name={block.id} required={block.required} maxLength={180} disabled={preview} />;
    return <label className={`site-board-field board-bg-${block.background}`}>{icon}<span>{block.text}{block.required ? " *" : ""}</span>{field}</label>;
  }
  return <div className={`site-board-block board-${block.type} board-bg-${block.background} board-highlight-${block.highlight}`}>{icon}{block.type === "heading" ? <h3>{block.text}</h3> : <p>{block.text}</p>}</div>;
}

export function SiteBoard({ board, boardId, preview = false }: { board: SiteBoardData; boardId: number; preview?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const hasFields = board.blocks.some((block) => block.type === "field");
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (preview) return;
    setBusy(true); setMessage("");
    const data = new FormData(event.currentTarget);
    const answers = Object.fromEntries(board.blocks.filter((block) => block.type === "field").map((block) => [block.id, String(data.get(block.id) ?? "")]));
    const response = await fetch("/api/board-responses", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ boardId, answers, website: data.get("website") }) });
    const result = await response.json(); setBusy(false);
    setMessage(result.message ?? result.error ?? "Не получилось отправить.");
    if (response.ok) event.currentTarget.reset();
  };
  const content = <>{board.blocks.map((block) => <BoardElement block={block} preview={preview} key={block.id} />)}{hasFields ? <><input className="board-honeypot" name="website" tabIndex={-1} autoComplete="off" />{message ? <p className="board-form-message">{message}</p> : null}<button className="board-submit" type="submit" disabled={busy || preview}>{busy ? "ОТПРАВЛЯЕМ…" : board.submitLabel || "ОТПРАВИТЬ"}</button></> : null}</>;
  return (
    <article className={`site-board site-board-${board.template ?? "paint"} board-surface-${board.surface ?? "paper"}`} aria-label={board.title || "Блок PoppersCraft"}>
      {board.template === "paint" || board.template === "form" ? <div className="site-board-window-bar"><MinecraftIcon name={board.template === "form" ? "book" : "grass"} size="sm" /><span>{board.windowTitle || "new_block.paint"}</span><i>_ □ ×</i></div> : null}
      <form className="site-board-content" onSubmit={submit}>{content}</form>
    </article>
  );
}
