import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { playerMarks } from "@/lib/player-marks";
import { validStarRating } from "@/lib/star-rating";
import type { PlusRing, PlusTier } from "@/lib/plus-style";

/* authorPlus — у автора подписка: обводка у ника её цвета, у HYPE — ярче. */
export type ProfileReviewReply = {
  userId: string;
  author: string;
  authorPlus?: boolean;
  authorRing?: PlusRing;
  authorTier?: PlusTier;
  comment: string;
  createdAt: string;
};

export type ProfileReview = {
  userId: string;
  author: string;
  authorPlus?: boolean;
  authorRing?: PlusRing;
  authorTier?: PlusTier;
  rating: number;
  comment: string;
  createdAt: string;
  likes: number;
  myLiked: boolean;
  replies: ProfileReviewReply[];
  myReply: ProfileReviewReply | null;
};

export function profileReviewTitle(targetUserId: string) {
  return `profile-review:${targetUserId}`;
}

export function profileReviewReactionTitle(targetUserId: string) {
  return `profile-review-reaction:${targetUserId}`;
}

export function profileReviewReplyTitle(targetUserId: string) {
  return `profile-review-reply:${targetUserId}`;
}

export function profileReviewKey(targetUserId: string, reviewerUserId: string) {
  return `__profile_review__:${targetUserId}:${reviewerUserId}`;
}

export function profileReviewReactionKey(targetUserId: string, reviewerUserId: string, reactorUserId: string) {
  return `__profile_review_reaction__:${targetUserId}:${reviewerUserId}:${reactorUserId}`;
}

export function profileReviewReplyKey(targetUserId: string, reviewerUserId: string, replyUserId: string) {
  return `__profile_review_reply__:${targetUserId}:${reviewerUserId}:${replyUserId}`;
}

export async function listProfileReviews(targetUserId: string, viewerUserId: string) {
  const reviewTitle = profileReviewTitle(targetUserId);
  const reactionTitle = profileReviewReactionTitle(targetUserId);
  const replyTitle = profileReviewReplyTitle(targetUserId);
  const { data: rows, error } = await createSupabaseAdminClient()
    .from("site_updates")
    .select("title,body,source_key,created_at,updated_at")
    .in("title", [reviewTitle, reactionTitle, replyTitle])
    .eq("published", false);
  if (error) throw error;

  const reviews: ProfileReview[] = (rows ?? []).flatMap((row) => {
    const reviewPrefix = `__profile_review__:${targetUserId}:`;
    if (row.title !== reviewTitle || !row.source_key?.startsWith(reviewPrefix)) return [];
    try {
      const parsed = JSON.parse(row.body) as { rating?: number; comment?: string; author?: string };
      const reviewerUserId = row.source_key.slice(reviewPrefix.length);
      const rating = parsed.rating;
      if (!reviewerUserId || !validStarRating(rating) || typeof parsed.comment !== "string" || !parsed.comment.trim()) return [];

      const reactionPrefix = `__profile_review_reaction__:${targetUserId}:${reviewerUserId}:`;
      const reactions = (rows ?? []).filter((candidate) =>
        candidate.title === reactionTitle && candidate.source_key?.startsWith(reactionPrefix) && candidate.body === "like",
      );
      const replyPrefix = `__profile_review_reply__:${targetUserId}:${reviewerUserId}:`;
      const replies = (rows ?? []).flatMap((candidate) => {
        if (candidate.title !== replyTitle || !candidate.source_key?.startsWith(replyPrefix)) return [];
        try {
          const parsedReply = JSON.parse(candidate.body) as { author?: string; comment?: string };
          const replyUserId = candidate.source_key.slice(replyPrefix.length);
          if (!replyUserId || typeof parsedReply.comment !== "string" || !parsedReply.comment.trim()) return [];
          return [{
            userId: replyUserId,
            author: String(parsedReply.author ?? "Игрок"),
            comment: parsedReply.comment,
            createdAt: candidate.updated_at ?? candidate.created_at,
          } satisfies ProfileReviewReply];
        } catch {
          return [];
        }
      }).sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt));

      return [{
        userId: reviewerUserId,
        author: String(parsed.author ?? "Игрок"),
        rating,
        comment: parsed.comment,
        createdAt: row.updated_at ?? row.created_at,
        likes: reactions.length,
        myLiked: reactions.some((reaction) => reaction.source_key === profileReviewReactionKey(targetUserId, reviewerUserId, viewerUserId)),
        replies,
        myReply: replies.find((reply) => reply.userId === viewerUserId) ?? null,
      } satisfies ProfileReview];
    } catch {
      return [];
    }
  }).sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));

  const marks = await playerMarks(reviews.flatMap((review) => [review.userId, ...review.replies.map((reply) => reply.userId)]));
  for (const review of reviews) {
    review.authorPlus = Boolean(marks.get(review.userId)?.plus);
    review.authorRing = marks.get(review.userId)?.ring;
    review.authorTier = marks.get(review.userId)?.tier;
    for (const reply of review.replies) {
      reply.authorPlus = Boolean(marks.get(reply.userId)?.plus);
      reply.authorRing = marks.get(reply.userId)?.ring;
      reply.authorTier = marks.get(reply.userId)?.tier;
    }
  }

  const totalRating = reviews.reduce((sum, review) => sum + review.rating, 0);
  return {
    reviews,
    averageRating: reviews.length ? totalRating / reviews.length : 0,
    myReview: reviews.find((review) => review.userId === viewerUserId) ?? null,
  };
}
