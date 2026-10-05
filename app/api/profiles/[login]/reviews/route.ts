import { NextResponse } from "next/server";
import { validStarRating } from "@/lib/star-rating";
import { getCommunityViewer } from "@/lib/community";
import {
  profileReviewKey,
  profileReviewReactionKey,
  profileReviewReactionTitle,
  profileReviewReplyKey,
  profileReviewReplyTitle,
  profileReviewTitle,
} from "@/lib/profile-reviews";
import { marksFor } from "@/lib/player-marks";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { normalizeLogin, sameOriginOrMissing } from "@/lib/waitlist";

export async function POST(request: Request, { params }: { params: Promise<{ login: string }> }) {
  if (!sameOriginOrMissing(request)) {
    return NextResponse.json({ error: "Недопустимый запрос." }, { status: 403 });
  }
  const viewer = await getCommunityViewer();
  if (!viewer) {
    return NextResponse.json({ error: "Отзывы доступны игрокам и администраторам." }, { status: 403 });
  }
  const marks = await marksFor(viewer.user.id);

  const body = await request.json().catch(() => null);
  const action = String(body?.action ?? "review");
  const admin = createSupabaseAdminClient();
  const { data: target, error: targetError } = await admin
    .from("pc_member_profiles")
    .select("user_id,login")
    .eq("login", normalizeLogin((await params).login))
    .maybeSingle();
  if (targetError || !target) {
    return NextResponse.json({ error: "Профиль не найден." }, { status: targetError ? 500 : 404 });
  }

  const targetUserId = target.user_id;
  if (action === "review") {
    const rating = body?.rating;
    const comment = String(body?.comment ?? "").trim();
    if (targetUserId === viewer.user.id) {
      return NextResponse.json({ error: "Нельзя оценивать собственный профиль." }, { status: 400 });
    }
    if (!validStarRating(rating) || comment.length < 2 || comment.length > 600) {
      return NextResponse.json({ error: "Поставьте от 0,5 до 5 звёзд с шагом 0,5 и напишите комментарий до 600 символов." }, { status: 400 });
    }
    const createdAt = new Date().toISOString();
    const { error } = await admin.from("site_updates").upsert({
      source_key: profileReviewKey(targetUserId, viewer.user.id),
      badge: "PROFILE",
      title: profileReviewTitle(targetUserId),
      body: JSON.stringify({ rating, comment, author: viewer.profile.login }),
      color: "cyan",
      published: false,
      updated_at: createdAt,
    }, { onConflict: "source_key" });
    if (error) return NextResponse.json({ error: "Не удалось сохранить отзыв." }, { status: 500 });
    return NextResponse.json({
      ok: true,
      review: {
        userId: viewer.user.id,
        author: viewer.profile.login,
        authorPlus: marks.plus,
        authorRing: marks.ring,
        rating,
        comment,
        createdAt,
        likes: 0,
        myLiked: false,
        replies: [],
        myReply: null,
      },
    });
  }

  if (action === "delete_review") {
    const reviewSourceKey = profileReviewKey(targetUserId, viewer.user.id);
    const reactionPrefix = `__profile_review_reaction__:${targetUserId}:${viewer.user.id}:`;
    const replyPrefix = `__profile_review_reply__:${targetUserId}:${viewer.user.id}:`;
    const { data: relatedRows, error: relatedError } = await admin
      .from("site_updates")
      .select("id,source_key")
      .in("title", [profileReviewReactionTitle(targetUserId), profileReviewReplyTitle(targetUserId)])
      .eq("published", false);
    if (relatedError) return NextResponse.json({ error: "Не удалось удалить отзыв." }, { status: 500 });
    const relatedIds = (relatedRows ?? [])
      .filter((row) => row.source_key?.startsWith(reactionPrefix) || row.source_key?.startsWith(replyPrefix))
      .map((row) => row.id);
    const deletions = [admin.from("site_updates").delete().eq("source_key", reviewSourceKey)];
    if (relatedIds.length) deletions.push(admin.from("site_updates").delete().in("id", relatedIds));
    const results = await Promise.all(deletions);
    if (results.some((result) => result.error)) {
      return NextResponse.json({ error: "Не удалось удалить отзыв." }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  const reviewUserId = String(body?.reviewUserId ?? "").trim();
  if (!reviewUserId || reviewUserId === viewer.user.id) {
    return NextResponse.json({ error: "Нельзя взаимодействовать со своим комментарием." }, { status: 400 });
  }
  const reviewSourceKey = profileReviewKey(targetUserId, reviewUserId);
  const { data: review } = await admin
    .from("site_updates")
    .select("source_key")
    .eq("source_key", reviewSourceKey)
    .maybeSingle();
  if (!review) return NextResponse.json({ error: "Комментарий уже удалён." }, { status: 404 });

  if (action === "reaction") {
    const liked = Boolean(body?.liked);
    const reactionSourceKey = profileReviewReactionKey(targetUserId, reviewUserId, viewer.user.id);
    const { error } = liked
      ? await admin.from("site_updates").upsert({
          source_key: reactionSourceKey,
          badge: "LIKE",
          title: profileReviewReactionTitle(targetUserId),
          body: "like",
          color: "lime",
          published: false,
          updated_at: new Date().toISOString(),
        }, { onConflict: "source_key" })
      : await admin.from("site_updates").delete().eq("source_key", reactionSourceKey);
    if (error) return NextResponse.json({ error: "Не удалось сохранить лайк." }, { status: 500 });

    const reactionPrefix = `__profile_review_reaction__:${targetUserId}:${reviewUserId}:`;
    const { data: reactionRows, error: reactionError } = await admin
      .from("site_updates")
      .select("source_key,body")
      .eq("title", profileReviewReactionTitle(targetUserId))
      .eq("published", false);
    if (reactionError) return NextResponse.json({ error: "Лайк сохранён, но счётчик не обновился." }, { status: 500 });
    const likes = (reactionRows ?? []).filter((row) => row.source_key?.startsWith(reactionPrefix) && row.body === "like").length;
    return NextResponse.json({ ok: true, likes, myLiked: liked });
  }

  if (action === "reply") {
    const comment = String(body?.comment ?? "").trim();
    if (comment.length < 2 || comment.length > 600) {
      return NextResponse.json({ error: "Ответ должен содержать от 2 до 600 символов." }, { status: 400 });
    }
    const createdAt = new Date().toISOString();
    const { error } = await admin.from("site_updates").upsert({
      source_key: profileReviewReplyKey(targetUserId, reviewUserId, viewer.user.id),
      badge: "REPLY",
      title: profileReviewReplyTitle(targetUserId),
      body: JSON.stringify({ author: viewer.profile.login, comment }),
      color: "cyan",
      published: false,
      updated_at: createdAt,
    }, { onConflict: "source_key" });
    if (error) return NextResponse.json({ error: "Не удалось сохранить ответ." }, { status: 500 });
    return NextResponse.json({
      ok: true,
      reply: { userId: viewer.user.id, author: viewer.profile.login, authorPlus: marks.plus, authorRing: marks.ring, comment, createdAt },
    });
  }

  return NextResponse.json({ error: "Неизвестное действие." }, { status: 400 });
}
