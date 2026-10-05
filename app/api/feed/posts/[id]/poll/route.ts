import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getCommunityViewer } from "@/lib/community";
import { sameOriginOrMissing } from "@/lib/waitlist";
import { consumeRateLimit, rateLimitResponse } from "@/lib/request-security";
import { decodeFeedBody } from "@/lib/feed-content";
import { pollResponseKey, pollResponseTitle } from "@/lib/feed-polls";

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!sameOriginOrMissing(request)) return NextResponse.json({ error: "Недопустимый запрос." }, { status: 403 });
  const viewer = await getCommunityViewer();
  if (!viewer) return NextResponse.json({ error: "Войдите в аккаунт участника." }, { status: 401 });
  const id = Number((await params).id);
  if (!Number.isSafeInteger(id) || id <= 0) return NextResponse.json({ error: "Пост не найден." }, { status: 404 });
  if (Number(request.headers.get("content-length") ?? 0) > 8192) return NextResponse.json({ error: "Ответ слишком большой." }, { status: 413 });
  const limit = await consumeRateLimit(request, { scope: "feed-poll-answer", key: viewer.user.id, limit: 100, windowSeconds: 3600 });
  if (!limit.allowed) return rateLimitResponse(limit, "Слишком много ответов. Попробуйте позже.");
  let input;
  try { input = await request.json(); } catch { return NextResponse.json({ error: "Неверный ответ." }, { status: 400 }); }
  const answer = typeof input?.answer === "string" ? input.answer.trim() : "";
  const admin = createSupabaseAdminClient();
  const { data: post, error: readError } = await admin.from("pc_feed_posts").select("id,body").eq("id", id).maybeSingle();
  if (readError) return NextResponse.json({ error: "Не удалось открыть опрос." }, { status: 503 });
  const poll = post ? decodeFeedBody(post.body).poll : null;
  if (!poll) return NextResponse.json({ error: "Опрос не найден." }, { status: 404 });
  const index = Number(answer);
  if (poll.kind === "vote" ? !Number.isInteger(index) || String(index) !== answer || index < 0 || index >= poll.options.length : !answer || answer.length > 600) return NextResponse.json({ error: poll.kind === "vote" ? "Выберите один из вариантов." : "Ответ: от 1 до 600 символов." }, { status: 400 });
  // The unique source key makes repeated and concurrent submissions one answer per account.
  const { error } = await admin.from("site_updates").upsert({ source_key: pollResponseKey(id, viewer.user.id), title: pollResponseTitle(id), body: JSON.stringify({ answer, author: viewer.profile.login }), badge: "POLL", color: "cyan", published: false, updated_at: new Date().toISOString() }, { onConflict: "source_key" });
  if (error) return NextResponse.json({ error: "Не удалось сохранить ответ. Попробуйте ещё раз." }, { status: 503 });
  return NextResponse.json({ ok: true });
}
