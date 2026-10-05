import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getCommunityViewer } from "@/lib/community";
import { consumeRateLimit, rateLimitResponse } from "@/lib/request-security";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { sameOriginOrMissing } from "@/lib/waitlist";
import { encodeWikiRecord, getWikiIndexById, parseWikiCommentRow, WIKI_COMMENT_PREFIX, type WikiCommentPayload } from "@/lib/wiki";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!sameOriginOrMissing(request)) return NextResponse.json({ error: "Недопустимый запрос." }, { status: 403 });
  const viewer = await getCommunityViewer({ allowAuthenticated: true });
  if (!viewer) return NextResponse.json({ error: "Войдите в аккаунт." }, { status: 401 });
  const articleId = Number((await params).id);
  const input = await request.json().catch(() => null);
  const body = String(input?.body ?? "").trim();
  const parentId = input?.parentId === null || input?.parentId === undefined ? null : Number(input.parentId);
  if (!Number.isSafeInteger(articleId) || body.length < 2 || body.length > 900 || (parentId !== null && !Number.isSafeInteger(parentId))) {
    return NextResponse.json({ error: "Комментарий должен содержать от 2 до 900 символов." }, { status: 400 });
  }
  const limit = await consumeRateLimit(request, { scope: "wiki-comment", key: viewer.user.id, limit: 100, windowSeconds: 60 * 60 });
  if (!limit.allowed) return rateLimitResponse(limit, "Слишком много комментариев. Попробуйте позже.");
  const article = await getWikiIndexById(articleId);
  if (!article || article.payload.status !== "published") return NextResponse.json({ error: "Статья не найдена или ещё не опубликована." }, { status: 404 });
  const admin = createSupabaseAdminClient();
  if (parentId !== null) {
    const { data: parentRow, error } = await admin.from("site_updates").select("id,source_key,title,body,created_at,updated_at").eq("id", parentId).eq("title", `wiki-comment:${articleId}`).maybeSingle();
    const parent = parentRow ? parseWikiCommentRow(parentRow) : null;
    if (error || !parent || parent.payload.articleId !== articleId || parent.payload.deletedAt) return NextResponse.json({ error: "Этот комментарий недоступен для ответа." }, { status: 400 });
  }
  const payload: WikiCommentPayload = { version: 1, articleId, authorId: viewer.user.id, parentId, body };
  const encoded = encodeWikiRecord(payload);
  if (encoded.length > 1200) return NextResponse.json({ error: "Комментарий слишком длинный." }, { status: 400 });
  const { data: comment, error } = await admin.from("site_updates").insert({
    source_key: `${WIKI_COMMENT_PREFIX}${articleId}:${randomUUID()}`,
    badge: "COMMENT",
    title: `wiki-comment:${articleId}`,
    body: encoded,
    color: "yellow",
    published: false,
  }).select("id").single();
  if (error) return NextResponse.json({ error: "Не удалось добавить комментарий." }, { status: 500 });
  return NextResponse.json({ ok: true, id: comment.id });
}
