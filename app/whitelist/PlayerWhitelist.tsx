"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { whitelistBadgeLabel } from "@/lib/site-navigation";
import { MinecraftIcon } from "@/app/MinecraftIcon";
import { MinecraftSkinPreview } from "@/app/MinecraftSkinPreview";
import type { PlayerApplicationRow, PlayerReview } from "@/lib/waitlist";

const dateFormatter = new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", year: "2-digit" });

function Stars({ rating, interactive = false, onChange }: { rating: number; interactive?: boolean; onChange?: (rating: number) => void }) {
  return (
    <div className={interactive ? "pixel-stars interactive" : "pixel-stars"} aria-label={`Оценка ${rating} из 5`}>
      {[1, 2, 3, 4, 5].map((star) => interactive ? (
        <button key={star} type="button" className={star <= rating ? "filled" : ""} aria-label={`${star} из 5`} onClick={() => onChange?.(star)}>★</button>
      ) : <span className={star <= Math.round(rating) ? "filled" : ""} key={star}>★</span>)}
    </div>
  );
}

export function PlayerWhitelist({
  initialApplications,
  canDeleteApplications,
}: {
  initialApplications: PlayerApplicationRow[];
  canDeleteApplications: boolean;
}) {
  const [applications, setApplications] = useState(initialApplications);
  const router = useRouter();
  /* Анкеты, где этого игрока ещё не слышали, — счётчик сверху и метка
     на карточке. */
  const waiting = applications.filter((application) => !application.my_player_vote).length;
  const [busy, setBusy] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [replyOpen, setReplyOpen] = useState<Record<string, boolean>>({});
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [drafts, setDrafts] = useState<Record<number, { rating: number; comment: string }>>(() =>
    Object.fromEntries(initialApplications.map((application) => [application.id, {
      rating: application.my_review?.rating ?? 5,
      comment: application.my_review?.comment ?? "",
    }])),
  );

  const vote = async (application: PlayerApplicationRow, nextVote: "approve" | "reject" | "clear") => {
    setBusy(application.id);
    setMessage("");
    const response = await fetch("/api/player-waitlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ applicationId: application.id, vote: nextVote }),
    });
    const result = await response.json();
    if (!response.ok) setMessage(result.error ?? "Не удалось проголосовать.");
    else {
      const oldVote = application.my_player_vote;
      setApplications((current) => current.map((item) => {
        if (item.id !== application.id) return item;
        return {
          ...item,
          my_player_vote: nextVote === "clear" ? null : nextVote,
          player_approvals: item.player_approvals + (oldVote === "approve" ? -1 : 0) + (nextVote === "approve" ? 1 : 0),
          player_rejections: item.player_rejections + (oldVote === "reject" ? -1 : 0) + (nextVote === "reject" ? 1 : 0),
        };
      }));
      setMessage(nextVote === "clear" ? "Голос снят." : "Голос сохранён. Последнее слово остаётся за администраторами.");
      /* Обновляет число у пункта «Вайтлист» в шапке. */
      router.refresh();
    }
    setBusy(null);
  };

  const review = async (event: FormEvent<HTMLFormElement>, application: PlayerApplicationRow) => {
    event.preventDefault();
    const draft = drafts[application.id] ?? { rating: 5, comment: "" };
    setBusy(application.id);
    setMessage("");
    const response = await fetch("/api/player-waitlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "review", applicationId: application.id, ...draft }),
    });
    const result = await response.json();
    if (!response.ok) setMessage(result.error ?? "Не удалось сохранить отзыв.");
    else {
      const saved = result.review as PlayerReview;
      setApplications((current) => current.map((item) => {
        if (item.id !== application.id) return item;
        const previous = item.reviews.find((entry) => entry.userId === saved.userId);
        const preservedReview = {
          ...saved,
          likes: previous?.likes ?? 0,
          dislikes: previous?.dislikes ?? 0,
          myReaction: previous?.myReaction ?? null,
          replies: previous?.replies ?? [],
          myReply: previous?.myReply ?? null,
        };
        const reviews = [...item.reviews.filter((entry) => entry.userId !== saved.userId), preservedReview];
        return {
          ...item,
          reviews,
          my_review: preservedReview,
          average_rating: reviews.reduce((sum, entry) => sum + entry.rating, 0) / reviews.length,
        };
      }));
      setMessage("Отзыв и оценка сохранены.");
    }
    setBusy(null);
  };

  const updateReview = (
    applicationId: number,
    reviewUserId: string,
    updater: (review: PlayerReview) => PlayerReview,
  ) => {
    setApplications((current) => current.map((application) => {
      if (application.id !== applicationId) return application;
      const reviews = application.reviews.map((entry) => entry.userId === reviewUserId ? updater(entry) : entry);
      const myReview = application.my_review?.userId === reviewUserId
        ? reviews.find((entry) => entry.userId === reviewUserId) ?? null
        : application.my_review;
      return { ...application, reviews, my_review: myReview };
    }));
  };

  const deleteReview = async (application: PlayerApplicationRow) => {
    if (!application.my_review || !window.confirm("Удалить свой отзыв?")) return;
    setBusy(application.id);
    setMessage("");
    const response = await fetch("/api/player-waitlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete_review", applicationId: application.id }),
    });
    const result = await response.json();
    if (!response.ok) setMessage(result.error ?? "Не удалось удалить отзыв.");
    else {
      const ownReviewId = application.my_review.userId;
      setApplications((current) => current.map((item) => {
        if (item.id !== application.id) return item;
        const reviews = item.reviews.filter((entry) => entry.userId !== ownReviewId);
        return {
          ...item,
          reviews,
          my_review: null,
          average_rating: reviews.length
            ? reviews.reduce((sum, entry) => sum + entry.rating, 0) / reviews.length
            : 0,
        };
      }));
      setDrafts((current) => ({ ...current, [application.id]: { rating: 5, comment: "" } }));
      setMessage("Ваш отзыв удалён.");
    }
    setBusy(null);
  };

  const deleteApplication = async (application: PlayerApplicationRow) => {
    const confirmed = window.confirm(
      `Удалить @${application.login} из вайтлиста? Заявка исчезнет, а вход кандидата будет отключён.`,
    );
    if (!confirmed) return;
    setBusy(application.id);
    setMessage("");
    const response = await fetch("/api/admin/applications", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: application.id }),
    });
    const result = await response.json();
    if (!response.ok) setMessage(result.error ?? "Не удалось удалить кандидата.");
    else {
      setApplications((current) => current.filter((item) => item.id !== application.id));
      setMessage(`@${application.login} удалён из вайтлиста.`);
    }
    setBusy(null);
  };

  const reactToReview = async (
    application: PlayerApplicationRow,
    entry: PlayerReview,
    reaction: "like" | "dislike",
  ) => {
    const nextReaction = entry.myReaction === reaction ? "clear" : reaction;
    setBusy(application.id);
    setMessage("");
    const response = await fetch("/api/player-waitlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "review_reaction",
        applicationId: application.id,
        reviewUserId: entry.userId,
        reaction: nextReaction,
      }),
    });
    const result = await response.json();
    if (!response.ok) setMessage(result.error ?? "Не удалось сохранить реакцию.");
    else {
      updateReview(application.id, entry.userId, (reviewEntry) => ({
        ...reviewEntry,
        likes: Number(result.likes) || 0,
        dislikes: Number(result.dislikes) || 0,
        myReaction: result.myReaction === "like" || result.myReaction === "dislike" ? result.myReaction : null,
      }));
      setMessage(nextReaction === "clear" ? "Реакция снята." : "Реакция сохранена.");
    }
    setBusy(null);
  };

  const replyToReview = async (
    event: FormEvent<HTMLFormElement>,
    application: PlayerApplicationRow,
    entry: PlayerReview,
  ) => {
    event.preventDefault();
    const key = `${application.id}:${entry.userId}`;
    const comment = (replyDrafts[key] ?? "").trim();
    setBusy(application.id);
    setMessage("");
    const response = await fetch("/api/player-waitlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "review_reply",
        applicationId: application.id,
        reviewUserId: entry.userId,
        comment,
      }),
    });
    const result = await response.json();
    if (!response.ok) setMessage(result.error ?? "Не удалось сохранить ответ.");
    else {
      const savedReply = result.reply;
      updateReview(application.id, entry.userId, (reviewEntry) => ({
        ...reviewEntry,
        replies: [...reviewEntry.replies.filter((reply) => reply.userId !== savedReply.userId), savedReply]
          .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt)),
        myReply: savedReply,
      }));
      setReplyOpen((current) => ({ ...current, [key]: false }));
      setMessage(entry.myReply ? "Ответ обновлён." : "Ответ опубликован.");
    }
    setBusy(null);
  };

  return (
    <div className="player-waitlist-list">
      {applications.length > 0 ? (
        <p className={waiting ? "whitelist-to-vote" : "whitelist-to-vote is-done"} role="status">
          {waiting ? `${whitelistBadgeLabel(waiting)}.` : "Вы проголосовали за все анкеты. Спасибо!"}
        </p>
      ) : null}
      {message ? <p className="form-message">{message}</p> : null}
      {applications.length === 0 ? <p className="empty-applications">Новых анкет пока нет.</p> : null}
      {applications.map((application) => (
        <article className="player-vote-card candidate-dossier" key={application.id}>
          <header className="candidate-titlebar">
            <span>КАНДИДАТ #{application.id}</span>
            <h2>@{application.login}</h2>
            {application.my_player_vote ? null : <b className="candidate-needs-vote">ЖДЁТ ВАШЕГО ГОЛОСА</b>}
            <time>{dateFormatter.format(new Date(application.created_at))}</time>
          </header>
          <div className="candidate-profile-grid">
            <aside className="candidate-avatar-column">
              <div className="candidate-skin"><MinecraftSkinPreview src={application.skin_url} alt={`Скин игрока ${application.login}`} /><b>СКИН</b></div>
              <div className="candidate-mini-card"><small>ОТКУДА</small><strong>{application.from_where}</strong></div>
              <div className="candidate-mini-card"><small>РЕЙТИНГ</small><Stars rating={application.average_rating} /><strong>{application.reviews.length ? application.average_rating.toFixed(1) : "НЕТ ОЦЕНОК"}</strong></div>
            </aside>
            <dl className="candidate-bio-column">
              <div className="candidate-bio"><dt>BIO</dt><dd>{application.who}</dd></div>
              <div><dt>ПОЧЕМУ POPPERSCRAFT</dt><dd>{application.why_server}</dd></div>
              <div><dt>ЧТО ДОБАВИТ В МИР</dt><dd>{application.why_you}</dd></div>
              <div className="candidate-media"><dt><MinecraftIcon name="record" size="sm" /> МУЗЫКА</dt><dd>{application.favorite_music || "Не указана"}</dd></div>
              <div><dt>ССЫЛКИ</dt><dd>{application.social_links || "Не указаны"}</dd></div>
            </dl>
            <aside className="candidate-vote-column">
              <div className="candidate-decision"><small>ГОЛОСОВАНИЕ</small><button type="button" className={`vote-yes ${application.my_player_vote === "approve" ? "selected" : ""}`} aria-pressed={application.my_player_vote === "approve"} disabled={busy === application.id} onClick={() => vote(application, "approve")}>ЗА {application.player_approvals}</button><button type="button" className={`vote-no ${application.my_player_vote === "reject" ? "selected" : ""}`} aria-pressed={application.my_player_vote === "reject"} disabled={busy === application.id} onClick={() => vote(application, "reject")}>ПРОТИВ {application.player_rejections}</button></div>
              <div className="candidate-vote-actions">
                {application.my_player_vote ? <button className="clear-vote" disabled={busy === application.id} onClick={() => vote(application, "clear")}>↺ СНЯТЬ ГОЛОС</button> : null}
                {canDeleteApplications ? (
                  <button className="admin-delete-candidate" type="button" disabled={busy === application.id} onClick={() => deleteApplication(application)}>
                    × УДАЛИТЬ ИЗ ВАЙТЛИСТА
                  </button>
                ) : null}
              </div>
            </aside>
          </div>
          <section className="candidate-reviews">
            <header><MinecraftIcon name="book" size="sm" /><h3>ОТЗЫВЫ ИГРОКОВ</h3><span>{application.reviews.length}</span></header>
            <form className="candidate-review-form" onSubmit={(event) => review(event, application)}>
              <label>ВАША ОЦЕНКА<Stars interactive rating={drafts[application.id]?.rating ?? 5} onChange={(rating) => setDrafts((current) => ({ ...current, [application.id]: { rating, comment: current[application.id]?.comment ?? "" } }))} /></label>
              <label>КОММЕНТАРИЙ<textarea minLength={2} maxLength={600} required value={drafts[application.id]?.comment ?? ""} onChange={(event) => setDrafts((current) => ({ ...current, [application.id]: { rating: current[application.id]?.rating ?? 5, comment: event.target.value } }))} placeholder="Напишите, почему вы за или против. Без оскорблений." /></label>
              <button type="submit" disabled={busy === application.id}>{application.my_review ? "ОБНОВИТЬ ОТЗЫВ" : "ОСТАВИТЬ ОТЗЫВ"}</button>
            </form>
            <div className="candidate-review-list">
              {application.reviews.length === 0 ? <p>Пока никто не оставил отзыв.</p> : application.reviews.map((entry) => {
                const isOwnReview = application.my_review?.userId === entry.userId;
                const replyKey = `${application.id}:${entry.userId}`;
                return (
                  <article key={entry.userId}>
                    <div><b>@{entry.author}</b><time>{dateFormatter.format(new Date(entry.createdAt))}</time><Stars rating={entry.rating} /></div>
                    <p>{entry.comment}</p>
                    <div className="candidate-review-actions">
                      {isOwnReview ? (
                        <button className="delete-review" type="button" disabled={busy === application.id} onClick={() => deleteReview(application)}>УДАЛИТЬ МОЙ ОТЗЫВ</button>
                      ) : (
                        <>
                          <button className={entry.myReaction === "like" ? "active like" : ""} type="button" disabled={busy === application.id} onClick={() => reactToReview(application, entry, "like")} aria-pressed={entry.myReaction === "like"}>▲ ЛАЙК {entry.likes}</button>
                          <button className={entry.myReaction === "dislike" ? "active dislike" : ""} type="button" disabled={busy === application.id} onClick={() => reactToReview(application, entry, "dislike")} aria-pressed={entry.myReaction === "dislike"}>▼ ДИЗЛАЙК {entry.dislikes}</button>
                          <button
                            type="button"
                            disabled={busy === application.id}
                            onClick={() => {
                              setReplyOpen((current) => ({ ...current, [replyKey]: !current[replyKey] }));
                              setReplyDrafts((current) => ({ ...current, [replyKey]: current[replyKey] ?? entry.myReply?.comment ?? "" }));
                            }}
                          >{entry.myReply ? "ИЗМЕНИТЬ ОТВЕТ" : "ОТВЕТИТЬ"}</button>
                        </>
                      )}
                    </div>
                    {entry.replies.length ? (
                      <div className="candidate-replies">
                        {entry.replies.map((reply) => (
                          <article key={reply.userId}>
                            <div><b>↳ @{reply.author}</b><time>{dateFormatter.format(new Date(reply.createdAt))}</time></div>
                            <p>{reply.comment}</p>
                          </article>
                        ))}
                      </div>
                    ) : null}
                    {!isOwnReview && replyOpen[replyKey] ? (
                      <form className="candidate-reply-form" onSubmit={(event) => replyToReview(event, application, entry)}>
                        <textarea
                          minLength={2}
                          maxLength={600}
                          required
                          value={replyDrafts[replyKey] ?? ""}
                          onChange={(event) => setReplyDrafts((current) => ({ ...current, [replyKey]: event.target.value }))}
                          placeholder={`Ответ для @${entry.author}`}
                        />
                        <button type="submit" disabled={busy === application.id}>{entry.myReply ? "ОБНОВИТЬ" : "ОТПРАВИТЬ"}</button>
                      </form>
                    ) : null}
                  </article>
                );
              })}
            </div>
          </section>
        </article>
      ))}
    </div>
  );
}
