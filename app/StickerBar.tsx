"use client";

import Link from "next/link";
import { useState } from "react";
import { MinecraftIcon } from "@/app/MinecraftIcon";
import { PLUS_STICKERS, type PlusSticker, type StickerCount, type StickerTarget } from "@/lib/plus-style";

/* Стикеры под постом ленты или статьёй Wiki. Ставят подписчики PLUS,
   видят все; свой стикер снимается повторным нажатием. */

const LABELS = new Map<string, string>(PLUS_STICKERS.map((sticker) => [sticker.id, sticker.label]));

function withSticker(counts: StickerCount[], previous: PlusSticker | null, next: PlusSticker | null) {
  const map = new Map(counts.map((entry) => [entry.sticker, entry.count]));
  if (previous) map.set(previous, Math.max(0, (map.get(previous) ?? 0) - 1));
  if (next) map.set(next, (map.get(next) ?? 0) + 1);
  return [...map]
    .filter(([, count]) => count > 0)
    .map(([sticker, count]) => ({ sticker, count }))
    .sort((left, right) => right.count - left.count);
}

export function StickerBar({
  kind,
  id,
  counts,
  mine,
  canAdd,
  className = "sticker-bar",
}: {
  kind: StickerTarget;
  id: number;
  counts: StickerCount[];
  mine: PlusSticker | null;
  canAdd: boolean;
  className?: string;
}) {
  const [state, setState] = useState({ counts, mine });
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function toggle(sticker: PlusSticker) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/stickers", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, id, sticker }),
      });
      const result = await response.json().catch(() => null) as { sticker?: PlusSticker | null; error?: string } | null;
      if (!response.ok) throw new Error(result?.error ?? "Не удалось поставить стикер.");
      const next = result?.sticker ?? null;
      setState((current) => ({ counts: withSticker(current.counts, current.mine, next), mine: next }));
      setOpen(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось поставить стикер.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={className}>
      {state.counts.map((entry) => (
        <button
          className={state.mine === entry.sticker ? "mine" : ""}
          type="button"
          key={entry.sticker}
          disabled={busy || (!canAdd && state.mine !== entry.sticker)}
          title={LABELS.get(entry.sticker) ?? entry.sticker}
          onClick={() => void toggle(entry.sticker)}
        >
          <MinecraftIcon name={entry.sticker} size="sm" />
          {entry.count}
        </button>
      ))}
      {canAdd ? (
        <button type="button" disabled={busy} aria-expanded={open} onClick={() => setOpen((value) => !value)}>
          {open ? "× ЗАКРЫТЬ" : state.mine ? "СМЕНИТЬ СТИКЕР" : "+ СТИКЕР"}
        </button>
      ) : (
        <span className="sticker-hint">Стикеры — с <Link href="/donation?plan=plus">PLUS</Link></span>
      )}
      {open ? (
        <div className="sticker-picker" role="group" aria-label="Выбор стикера">
          {PLUS_STICKERS.map((sticker) => (
            <button
              className={state.mine === sticker.id ? "mine" : ""}
              type="button"
              key={sticker.id}
              disabled={busy}
              title={sticker.label}
              onClick={() => void toggle(sticker.id)}
            >
              <MinecraftIcon name={sticker.id} size="sm" />
            </button>
          ))}
        </div>
      ) : null}
      {error ? <span className="sticker-hint">{error}</span> : null}
    </div>
  );
}
