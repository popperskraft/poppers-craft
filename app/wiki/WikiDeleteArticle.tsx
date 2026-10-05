"use client";

import { useState } from "react";

/* «Удалить статью» — автору и администраторам (просьба владельца, 2026-10-03).
   Сервер проверяет права сам (DELETE /api/wiki/articles/[id]). */
export function WikiDeleteArticle({ articleId, title }: { articleId: number; title: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function remove() {
    if (busy || !window.confirm(`Удалить статью «${title}» навсегда? Вместе с ней удалятся комментарии и оценки. Вернуть её будет нельзя.`)) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/wiki/articles/${articleId}`, { method: "DELETE" });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.error ?? "Не удалось удалить статью.");
      window.location.assign("/wiki");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось удалить статью.");
      setBusy(false);
    }
  }

  return (
    <>
      <button className="wiki-delete-article" type="button" disabled={busy} onClick={() => void remove()}>
        {busy ? "УДАЛЯЕМ…" : "УДАЛИТЬ СТАТЬЮ"}
      </button>
      {error ? <span className="wiki-delete-error" role="alert">{error}</span> : null}
    </>
  );
}
