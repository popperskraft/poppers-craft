import { NextResponse } from "next/server";
import { getPlayerWaitlistViewer, listPlayerWaitlist, sameOriginOrMissing } from "@/lib/waitlist";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { forgetWhitelistToVote } from "@/lib/whitelist-to-vote";

export async function GET() {
  const viewer = await getPlayerWaitlistViewer();
  if (!viewer) return NextResponse.json({ error: "Доступ только для игроков и администраторов." }, { status: 403 });
  return NextResponse.json({ applications: await listPlayerWaitlist(viewer.userId) });
}

export async function POST(request: Request) {
  const member = await getPlayerWaitlistViewer();
  if (!member || !sameOriginOrMissing(request)) {
    return NextResponse.json({ error: "Доступ только для игроков и администраторов." }, { status: 403 });
  }
  const body = await request.json().catch(() => null);
  const applicationId = Number(body?.applicationId);
  const requestedAction = String(body?.action ?? "vote");
  const action = ["review", "delete_review", "review_reaction", "review_reply"].includes(requestedAction)
    ? requestedAction
    : "vote";
  if (!Number.isInteger(applicationId)) {
    return NextResponse.json({ error: "Некорректная заявка." }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();
  const { data: application } = await admin
    .from("waitlist_applications")
    .select("id,status,is_deleted")
    .eq("id", applicationId)
    .maybeSingle();
  if (!application || application.status !== "pending" || application.is_deleted) {
    return NextResponse.json({ error: "Эта заявка уже закрыта." }, { status: 409 });
  }

  if (action === "review") {
    const rating = Number(body?.rating);
    const comment = String(body?.comment ?? "").trim();
    if (!Number.isInteger(rating) || rating < 1 || rating > 5 || comment.length < 2 || comment.length > 600) {
      return NextResponse.json({ error: "Поставьте от 1 до 5 звёзд и напишите комментарий до 600 символов." }, { status: 400 });
    }
    const sourceKey = `__player_review__:${applicationId}:${member.userId}`;
    const { error } = await admin.from("site_updates").upsert({
      source_key: sourceKey,
      badge: "REVIEW",
      title: `review:${applicationId}`,
      body: JSON.stringify({ rating, comment, author: member.login }),
      color: "cyan",
      published: false,
      updated_at: new Date().toISOString(),
    }, { onConflict: "source_key" });
    if (error) return NextResponse.json({ error: "Не удалось сохранить отзыв." }, { status: 500 });
    return NextResponse.json({ ok: true, review: { userId: member.userId, author: member.login, rating, comment, createdAt: new Date().toISOString(), likes: 0, dislikes: 0, myReaction: null, replies: [], myReply: null } });
  }

  if (action === "delete_review") {
    const reviewSourceKey = `__player_review__:${applicationId}:${member.userId}`;
    const { data: relatedRows, error: relatedError } = await admin
      .from("site_updates")
      .select("id,source_key")
      .in("title", [`review-reaction:${applicationId}`, `review-reply:${applicationId}`])
      .eq("published", false);
    if (relatedError) return NextResponse.json({ error: "Не удалось удалить отзыв." }, { status: 500 });
    const relatedIds = (relatedRows ?? [])
      .filter((row) => row.source_key?.startsWith(`__player_review_reaction__:${applicationId}:${member.userId}:`) || row.source_key?.startsWith(`__player_review_reply__:${applicationId}:${member.userId}:`))
      .map((row) => row.id);
    const deletions = [admin.from("site_updates").delete().eq("source_key", reviewSourceKey)];
    if (relatedIds.length) deletions.push(admin.from("site_updates").delete().in("id", relatedIds));
    const results = await Promise.all(deletions);
    if (results.some((result) => result.error)) return NextResponse.json({ error: "Не удалось удалить отзыв." }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (action === "review_reaction") {
    const reviewUserId = String(body?.reviewUserId ?? "").trim();
    const reaction = String(body?.reaction ?? "");
    if (!reviewUserId || reviewUserId === member.userId || !["like", "dislike", "clear"].includes(reaction)) {
      return NextResponse.json({ error: "Некорректная реакция на отзыв." }, { status: 400 });
    }
    const reviewSourceKey = `__player_review__:${applicationId}:${reviewUserId}`;
    const { data: review } = await admin.from("site_updates").select("source_key").eq("source_key", reviewSourceKey).maybeSingle();
    if (!review) return NextResponse.json({ error: "Отзыв уже удалён." }, { status: 404 });
    const reactionSourceKey = `__player_review_reaction__:${applicationId}:${reviewUserId}:${member.userId}`;
    const { error } = reaction === "clear"
      ? await admin.from("site_updates").delete().eq("source_key", reactionSourceKey)
      : await admin.from("site_updates").upsert({
          source_key: reactionSourceKey,
          badge: "REACTION",
          title: `review-reaction:${applicationId}`,
          body: reaction,
          color: reaction === "like" ? "lime" : "pink",
          published: false,
          updated_at: new Date().toISOString(),
        }, { onConflict: "source_key" });
    if (error) return NextResponse.json({ error: "Не удалось сохранить реакцию." }, { status: 500 });
    const prefix = `__player_review_reaction__:${applicationId}:${reviewUserId}:`;
    const { data: reactionRows, error: reactionError } = await admin
      .from("site_updates")
      .select("source_key,body")
      .eq("title", `review-reaction:${applicationId}`)
      .eq("published", false);
    if (reactionError) return NextResponse.json({ error: "Реакция сохранена, но счётчик не обновился." }, { status: 500 });
    const reactions = (reactionRows ?? []).filter((row) => row.source_key?.startsWith(prefix));
    return NextResponse.json({
      ok: true,
      likes: reactions.filter((row) => row.body === "like").length,
      dislikes: reactions.filter((row) => row.body === "dislike").length,
      myReaction: reaction === "clear" ? null : reaction,
    });
  }

  if (action === "review_reply") {
    const reviewUserId = String(body?.reviewUserId ?? "").trim();
    const comment = String(body?.comment ?? "").trim();
    if (!reviewUserId || reviewUserId === member.userId || comment.length < 2 || comment.length > 600) {
      return NextResponse.json({ error: "Ответ должен содержать от 2 до 600 символов." }, { status: 400 });
    }
    const reviewSourceKey = `__player_review__:${applicationId}:${reviewUserId}`;
    const { data: review } = await admin.from("site_updates").select("source_key").eq("source_key", reviewSourceKey).maybeSingle();
    if (!review) return NextResponse.json({ error: "Отзыв уже удалён." }, { status: 404 });
    const replySourceKey = `__player_review_reply__:${applicationId}:${reviewUserId}:${member.userId}`;
    const createdAt = new Date().toISOString();
    const { error } = await admin.from("site_updates").upsert({
      source_key: replySourceKey,
      badge: "REPLY",
      title: `review-reply:${applicationId}`,
      body: JSON.stringify({ author: member.login, comment }),
      color: "cyan",
      published: false,
      updated_at: createdAt,
    }, { onConflict: "source_key" });
    if (error) return NextResponse.json({ error: "Не удалось сохранить ответ." }, { status: 500 });
    return NextResponse.json({ ok: true, reply: { userId: member.userId, author: member.login, comment, createdAt } });
  }

  const vote = String(body?.vote ?? "");
  if (!["approve", "reject", "clear"].includes(vote)) {
    return NextResponse.json({ error: "Некорректный голос." }, { status: 400 });
  }
  const sourceKey = `__player_vote__:${applicationId}:${member.userId}`;
  if (vote === "clear") {
    const { error } = await admin.from("site_updates").delete().eq("source_key", sourceKey);
    if (error) return NextResponse.json({ error: "Не удалось снять голос." }, { status: 500 });
  } else {
    const { error } = await admin.from("site_updates").upsert({
      source_key: sourceKey,
      badge: "PVOTE",
      title: `application:${applicationId}`,
      body: vote,
      color: vote === "approve" ? "lime" : "pink",
      published: false,
      updated_at: new Date().toISOString(),
    }, { onConflict: "source_key" });
    if (error) return NextResponse.json({ error: "Не удалось сохранить голос." }, { status: 500 });
  }
  forgetWhitelistToVote(member.userId);
  return NextResponse.json({ ok: true });
}
