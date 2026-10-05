"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { FeedPollResults } from "@/lib/feed-content";

export function FeedPollCard({ postId, poll }: { postId: number; poll: FeedPollResults }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const answer = String(new FormData(event.currentTarget).get("answer") ?? "");
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/feed/posts/${postId}/poll`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ answer }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Не удалось сохранить ответ.");
      setMessage("Ответ сохранён.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Нет связи с сервером. Попробуйте ещё раз.");
    } finally { setBusy(false); }
  }
  return <section className="feed-poll" aria-label={poll.kind === "vote" ? "Голосование" : "Текстовый опрос"}>
    <div className="window-bar"><span>{poll.kind === "vote" ? "vote.exe — ГОЛОСОВАНИЕ" : "survey.txt — ОПРОС"}</span></div>
    <h3>{poll.question}</h3>
    <form onSubmit={submit} key={poll.myAnswer ?? "unanswered"}>
      {poll.kind === "vote" ? <fieldset disabled={busy}>
        <legend>Выберите один вариант. Свой выбор можно изменить.</legend>
        {poll.options.map((option, index) => {
          const percent = poll.total ? Math.round(poll.counts[index] / poll.total * 100) : 0;
          return <label className="feed-poll-option" key={index}>
            <span className="feed-poll-progress" style={{ width: `${percent}%` }} aria-hidden="true" />
            <input type="radio" name="answer" value={index} defaultChecked={poll.myAnswer === String(index)} required />
            <span>{option}</span><b>{percent}% · {poll.counts[index]}</b>
          </label>;
        })}
      </fieldset> : <label className="feed-survey-input">ВАШ ОТВЕТ<textarea name="answer" rows={3} required maxLength={600} defaultValue={poll.myAnswer ?? ""} disabled={busy} /><small>До 600 символов. Ответы видны участникам ленты.</small></label>}
      <div className="feed-poll-actions"><button type="submit" disabled={busy}>{busy ? "СОХРАНЯЕМ…" : poll.myAnswer !== null ? "ИЗМЕНИТЬ ОТВЕТ" : poll.kind === "vote" ? "ПРОГОЛОСОВАТЬ" : "ОТВЕТИТЬ"}</button><span>Ответов: {poll.total}</span></div>
    </form>
    {message ? <p role="status">{message}</p> : null}
    {poll.kind === "text" && poll.answers.length ? <details className="feed-survey-answers"><summary>ОТВЕТЫ ИГРОКОВ ({poll.total})</summary>{poll.answers.map((answer, index) => <div key={index}><b>@{answer.author}</b><p>{answer.text}</p></div>)}</details> : null}
  </section>;
}
