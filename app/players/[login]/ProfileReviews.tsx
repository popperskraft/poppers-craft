"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { ProfileReview } from "@/lib/profile-reviews";
import { joinClasses, plusClass } from "@/lib/plus-style";
import { PixelStars, StarRatingPicker } from "@/app/PixelStars";

const dateFormatter = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "2-digit",
  year: "2-digit",
});

function ReviewStars({
  rating,
  interactive = false,
  onChange,
}: {
  rating: number;
  interactive?: boolean;
  onChange?: (rating: number) => void;
}) {
  return interactive ? <StarRatingPicker value={rating} onChange={value => onChange?.(value)} />
    : <span aria-label={`Оценка ${rating} из 5`}><PixelStars rating={rating} /></span>;
}

export function ProfileReviews({
  targetLogin,
  isSelf,
  canInteract,
  initialReviews,
  initialMyReview,
}: {
  targetLogin: string;
  isSelf: boolean;
  canInteract: boolean;
  initialReviews: ProfileReview[];
  initialMyReview: ProfileReview | null;
}) {
  const router = useRouter();
  const [reviews, setReviews] = useState(initialReviews);
  const [myReview, setMyReview] = useState(initialMyReview);
  const [rating, setRating] = useState(initialMyReview?.rating ?? 5);
  const [comment, setComment] = useState(initialMyReview?.comment ?? "");
  const [replyOpen, setReplyOpen] = useState<Record<string, boolean>>({});
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");

  const send = async (payload: Record<string, unknown>) => {
    const response = await fetch(`/api/profiles/${encodeURIComponent(targetLogin)}/reviews`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "Действие не выполнено.");
    return result;
  };

  const saveReview = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy("review");
    setMessage("");
    try {
      const result = await send({ action: "review", rating, comment });
      const saved = result.review as ProfileReview;
      const previous = reviews.find((entry) => entry.userId === saved.userId);
      const merged = {
        ...saved,
        likes: previous?.likes ?? 0,
        myLiked: previous?.myLiked ?? false,
        replies: previous?.replies ?? [],
        myReply: previous?.myReply ?? null,
      };
      setReviews((current) => [merged, ...current.filter((entry) => entry.userId !== saved.userId)]);
      setMyReview(merged);
      setMessage(myReview ? "Отзыв обновлён." : "Отзыв опубликован.");
      router.refresh();
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Не удалось сохранить отзыв.");
    } finally {
      setBusy("");
    }
  };

  const deleteReview = async () => {
    if (!myReview || !window.confirm("Удалить свой отзыв об этом игроке?")) return;
    setBusy("review");
    setMessage("");
    try {
      await send({ action: "delete_review" });
      setReviews((current) => current.filter((entry) => entry.userId !== myReview.userId));
      setMyReview(null);
      setRating(5);
      setComment("");
      setMessage("Ваш отзыв удалён.");
      router.refresh();
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Не удалось удалить отзыв.");
    } finally {
      setBusy("");
    }
  };

  const toggleLike = async (review: ProfileReview) => {
    const key = `like:${review.userId}`;
    setBusy(key);
    setMessage("");
    try {
      const result = await send({ action: "reaction", reviewUserId: review.userId, liked: !review.myLiked });
      setReviews((current) => current.map((entry) => entry.userId === review.userId ? {
        ...entry,
        likes: Number(result.likes) || 0,
        myLiked: Boolean(result.myLiked),
      } : entry));
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Не удалось поставить лайк.");
    } finally {
      setBusy("");
    }
  };

  const saveReply = async (event: FormEvent<HTMLFormElement>, review: ProfileReview) => {
    event.preventDefault();
    const key = review.userId;
    setBusy(`reply:${key}`);
    setMessage("");
    try {
      const result = await send({ action: "reply", reviewUserId: review.userId, comment: replyDrafts[key] ?? "" });
      const savedReply = result.reply;
      setReviews((current) => current.map((entry) => entry.userId === review.userId ? {
        ...entry,
        replies: [...entry.replies.filter((reply) => reply.userId !== savedReply.userId), savedReply]
          .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt)),
        myReply: savedReply,
      } : entry));
      setReplyOpen((current) => ({ ...current, [key]: false }));
      setMessage(review.myReply ? "Ответ обновлён." : "Ответ опубликован.");
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Не удалось сохранить ответ.");
    } finally {
      setBusy("");
    }
  };

  return (
    <section className="profile-reviews">
      <header className="profile-reviews-heading">
        <div><small>PLAYER_REVIEWS.DAT</small><h2>ОТЗЫВЫ ОБ ИГРОКЕ</h2></div>
        <span>{reviews.length}</span>
      </header>

      {canInteract && !isSelf ? (
        <form className="profile-review-editor" onSubmit={saveReview}>
          <div><strong>ВАША ОЦЕНКА</strong><ReviewStars interactive rating={rating} onChange={setRating} /><p>{`Ваша оценка: ${rating} из 5`}</p><small>Левая половина звезды — половина балла, правая — целый балл.</small></div>
          <label>КОММЕНТАРИЙ<textarea minLength={2} maxLength={600} required value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Напишите отзыв об игроке" /></label>
          <button type="submit" disabled={busy === "review"}>{myReview ? "ОБНОВИТЬ ОТЗЫВ" : "ОПУБЛИКОВАТЬ ОТЗЫВ"}</button>
        </form>
      ) : (
        <p className="profile-review-note">{isSelf ? "Собственный профиль нельзя оценивать, но вы можете отвечать на отзывы других игроков." : "Оставлять отзывы могут одобренные игроки и администраторы."}</p>
      )}

      {message ? <p className="profile-review-message">{message}</p> : null}

      <div className="profile-review-list">
        {reviews.length === 0 ? <p className="profile-reviews-empty">Отзывов пока нет.</p> : reviews.map((review) => {
          const isOwnReview = myReview?.userId === review.userId;
          return (
            <article key={review.userId}>
              <header><Link className={joinClasses("review-author-link", plusClass(review.authorPlus, review.authorRing, review.authorTier))} href={`/players/${encodeURIComponent(review.author)}`} translate="no">@{review.author}</Link><time>{dateFormatter.format(new Date(review.createdAt))}</time><ReviewStars rating={review.rating} /></header>
              <p>{review.comment}</p>
              {canInteract ? (
                <div className="profile-review-actions">
                  {isOwnReview ? (
                    <button className="delete" type="button" disabled={busy === "review"} onClick={deleteReview}>УДАЛИТЬ МОЙ ОТЗЫВ</button>
                  ) : (
                    <>
                      <button className={review.myLiked ? "active" : ""} type="button" disabled={busy === `like:${review.userId}`} onClick={() => toggleLike(review)} aria-pressed={review.myLiked}>♥ НРАВИТСЯ {review.likes}</button>
                      <button
                        type="button"
                        disabled={busy === `reply:${review.userId}`}
                        onClick={() => {
                          setReplyOpen((current) => ({ ...current, [review.userId]: !current[review.userId] }));
                          setReplyDrafts((current) => ({ ...current, [review.userId]: current[review.userId] ?? review.myReply?.comment ?? "" }));
                        }}
                      >{review.myReply ? "ИЗМЕНИТЬ ОТВЕТ" : "ОТВЕТИТЬ"}</button>
                    </>
                  )}
                </div>
              ) : null}
              {review.replies.length ? (
                <div className="profile-review-replies">
                  {review.replies.map((reply) => (
                    <div key={reply.userId}><header><span aria-hidden="true">↳ </span><Link className={joinClasses("review-author-link", plusClass(reply.authorPlus, reply.authorRing, reply.authorTier))} href={`/players/${encodeURIComponent(reply.author)}`} translate="no">@{reply.author}</Link><time>{dateFormatter.format(new Date(reply.createdAt))}</time></header><p>{reply.comment}</p></div>
                  ))}
                </div>
              ) : null}
              {canInteract && !isOwnReview && replyOpen[review.userId] ? (
                <form className="profile-review-reply-form" onSubmit={(event) => saveReply(event, review)}>
                  <textarea minLength={2} maxLength={600} required value={replyDrafts[review.userId] ?? ""} onChange={(event) => setReplyDrafts((current) => ({ ...current, [review.userId]: event.target.value }))} placeholder={`Ответ для @${review.author}`} />
                  <button type="submit" disabled={busy === `reply:${review.userId}`}>{review.myReply ? "ОБНОВИТЬ" : "ОТПРАВИТЬ"}</button>
                </form>
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}
