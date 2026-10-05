"use client";

import { useState } from "react";

/* Отметка «нравится» на записи в обновлениях. Гость видит счётчик, но ставить
   лайк может только вошедший — иначе одну запись можно накрутить из вкладок. */
export function UpdateLike({
  id,
  count,
  liked,
  canLike,
}: {
  id: number;
  count: number;
  liked: boolean;
  canLike: boolean;
}) {
  const [state, setState] = useState({ count, liked });
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState("");

  const toggle = async () => {
    if (busy) return;
    if (!canLike) {
      setHint("Войдите, чтобы поставить лайк.");
      return;
    }
    setBusy(true);
    setHint("");
    /* Счётчик меняется сразу: ответ сервера потом поправит его при расхождении. */
    setState((value) => ({ liked: !value.liked, count: value.count + (value.liked ? -1 : 1) }));
    try {
      const response = await fetch("/api/updates/like", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const result = await response.json().catch(() => null) as { liked?: boolean; count?: number; error?: string } | null;
      if (!response.ok || typeof result?.count !== "number") {
        setState({ count, liked });
        setHint(result?.error ?? "Не удалось сохранить лайк.");
        return;
      }
      setState({ count: result.count, liked: Boolean(result.liked) });
    } catch {
      setState({ count, liked });
      setHint("Сервер не ответил. Попробуйте ещё раз.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      className={state.liked ? "update-like is-liked" : "update-like"}
      onClick={toggle}
      disabled={busy}
      aria-pressed={state.liked}
      title={hint || (state.liked ? "Убрать лайк" : "Нравится")}
    >
      <b aria-hidden="true">{state.liked ? "♥" : "♡"}</b>
      <span>{state.count}</span>
    </button>
  );
}
