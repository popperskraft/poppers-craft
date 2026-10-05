import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getCommunityViewer } from "@/lib/community";
import { sameOriginOrMissing } from "@/lib/waitlist";
import { consumeRateLimit, rateLimitResponse } from "@/lib/request-security";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!sameOriginOrMissing(request)) return NextResponse.json({ error: "Недопустимый запрос." }, { status: 403 });
  const viewer = await getCommunityViewer();
  if (!viewer) return NextResponse.json({ error: "Войдите в аккаунт." }, { status: 401 });
  const limit = await consumeRateLimit(request, { scope: "feed-comment", key: viewer.user.id, limit: 100, windowSeconds: 60 * 60 });
  if (!limit.allowed) return rateLimitResponse(limit, "Слишком много комментариев. Попробуйте позже.");
  const id = Number((await params).id);
  const body = String((await request.json()).body ?? "").trim();
  if (!Number.isSafeInteger(id) || !body || body.length > 1200) return NextResponse.json({ error: "Комментарий должен быть короче 1200 символов." }, { status: 400 });
  const globalLimit = await consumeRateLimit(request, { scope: "feed-comment-global", key: "global", limit: 10_000, windowSeconds: 60 * 60 });
  if (!globalLimit.allowed) return rateLimitResponse(globalLimit, "Комментарии временно заняты. Попробуйте позже.");
  const { error } = await createSupabaseAdminClient().from("pc_feed_comments").insert({ post_id: id, author_id: viewer.user.id, body });
  if (error) return NextResponse.json({ error: "Не удалось добавить комментарий." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
