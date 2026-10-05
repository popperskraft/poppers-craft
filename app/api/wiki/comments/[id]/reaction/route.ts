import { NextResponse } from "next/server";
import { getCommunityViewer } from "@/lib/community";
import { consumeRateLimit, rateLimitResponse } from "@/lib/request-security";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { sameOriginOrMissing } from "@/lib/waitlist";
import { getWikiIndexById, parseWikiCommentRow, WIKI_LIKE_PREFIX } from "@/lib/wiki";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!sameOriginOrMissing(request)) return NextResponse.json({ error: "Недопустимый запрос." }, { status: 403 });
  const viewer = await getCommunityViewer({ allowAuthenticated: true });
  if (!viewer) return NextResponse.json({ error: "Войдите в аккаунт." }, { status: 401 });
  const id = Number((await params).id);
  const liked = Boolean((await request.json().catch(() => null))?.liked);
  if (!Number.isSafeInteger(id)) return NextResponse.json({ error: "Комментарий не найден." }, { status: 404 });
  const limit = await consumeRateLimit(request, { scope: "wiki-comment-like", key: viewer.user.id, limit: 300, windowSeconds: 60 * 60 });
  if (!limit.allowed) return rateLimitResponse(limit, "Слишком много реакций. Попробуйте позже.");
  const admin = createSupabaseAdminClient();
  const { data: row, error: rowError } = await admin.from("site_updates").select("id,source_key,title,body,created_at,updated_at").eq("id", id).maybeSingle();
  const comment = row ? parseWikiCommentRow(row) : null;
  if (rowError || !comment) return NextResponse.json({ error: "Комментарий не найден." }, { status: rowError ? 500 : 404 });
  const article = await getWikiIndexById(comment.payload.articleId);
  if (!article || article.payload.status !== "published" || comment.payload.deletedAt) return NextResponse.json({ error: "Комментарий не найден." }, { status: 404 });
  const sourceKey = `${WIKI_LIKE_PREFIX}${id}:${viewer.user.id}`;
  const { error } = await admin.from("site_updates").upsert({ source_key: sourceKey, badge: "LIKE", title: `wiki-like:${comment.payload.articleId}`, body: liked ? "like" : "unlike", color: "pink", published: false }, { onConflict: "source_key" });
  if (error) return NextResponse.json({ error: "Не удалось сохранить лайк." }, { status: 500 });
  return NextResponse.json({ ok: true, liked });
}
