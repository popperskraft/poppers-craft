import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getCommunityViewer } from "@/lib/community";
import { consumeRateLimit, rateLimitResponse } from "@/lib/request-security";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { sameOriginOrMissing } from "@/lib/waitlist";
import { encodeWikiRecord, getWikiIndexById, readWikiContent, readWikiDocument, WIKI_BUCKET } from "@/lib/wiki";
import { wikiImageIds } from "@/lib/wiki-content";
import { parseWikiArticleInput } from "@/lib/wiki-input";
import { queueWikiPublication } from "@/lib/wiki-publication-notify";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!sameOriginOrMissing(request)) return NextResponse.json({ error: "Недопустимый запрос." }, { status: 403 });
  const viewer = await getCommunityViewer({ allowAuthenticated: true });
  if (!viewer) return NextResponse.json({ error: "Войдите в аккаунт." }, { status: 401 });
  const id = Number((await params).id);
  if (!Number.isSafeInteger(id)) return NextResponse.json({ error: "Статья не найдена." }, { status: 404 });
  const article = await getWikiIndexById(id);
  if (!article) return NextResponse.json({ error: "Статья не найдена." }, { status: 404 });
  if (article.payload.authorId !== viewer.user.id && !viewer.adminProfile) return NextResponse.json({ error: "Недостаточно прав." }, { status: 403 });
  const limit = await consumeRateLimit(request, { scope: "wiki-article-save", key: viewer.user.id, limit: 120, windowSeconds: 60 * 60 });
  if (!limit.allowed) return rateLimitResponse(limit, "Слишком много сохранений. Подождите немного.");
  const body = await request.json().catch(() => null);
  if (body?.expectedUpdatedAt !== article.row.updated_at) return NextResponse.json({ error: "Статья уже изменена в другой вкладке. Ваш текст в редакторе не потерян. Откройте свежую версию и сравните изменения." }, { status: 409 });
  const parsed = parseWikiArticleInput(body);
  if (!parsed.value) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const input = parsed.value;
  const oldDocument = await readWikiDocument(article.payload.contentPath, true).catch(() => null);
  if (!oldDocument) return NextResponse.json({ error: "Не удалось прочитать текущую статью. Сохранение отменено, чтобы не потерять данные. Попробуйте позже." }, { status: 503 });
  const oldImagePaths = new Set(wikiImageIds(oldDocument.blocks));
  const imagePaths = wikiImageIds(input.blocks);
  if (imagePaths.some((path) => !oldImagePaths.has(path) && !path.startsWith(`uploads/${viewer.user.id}/`))) {
    return NextResponse.json({ error: "Один из скриншотов недоступен. Загрузите его заново." }, { status: 400 });
  }
  const now = new Date().toISOString();
  const payload = {
    ...article.payload,
    summary: input.summary,
    category: input.category,
    tags: input.tags,
    status: input.status,
    contentPath: `articles/${article.payload.slug}/${randomUUID()}.json`,
    publishedAt: input.status === "published" ? article.payload.publishedAt ?? now : article.payload.publishedAt,
  };
  const encoded = encodeWikiRecord(payload);
  if (encoded.length > 1200) return NextResponse.json({ error: "Описание и теги статьи слишком длинные." }, { status: 400 });
  const admin = createSupabaseAdminClient();
  const content = new Blob([JSON.stringify({ version: 1, blocks: input.blocks, coverArt: input.coverArt === undefined ? oldDocument.coverArt : input.coverArt })], { type: "application/json" });
  const { error: contentError } = await admin.storage.from(WIKI_BUCKET).upload(payload.contentPath, content, { contentType: "application/json", upsert: false });
  if (contentError) return NextResponse.json({ error: "Не удалось сохранить содержимое статьи." }, { status: 500 });
  if (input.status === "published" && !article.payload.publishedAt) {
    try { await queueWikiPublication(article.payload.slug); }
    catch { return NextResponse.json({ error: "Не удалось подготовить уведомление сервера. Статья не опубликована. Попробуйте ещё раз." }, { status: 503 }); }
  }
  const { data: saved, error } = await admin.from("site_updates").update({ title: input.title, body: encoded, updated_at: now }).eq("id", id).eq("source_key", article.row.source_key).eq("updated_at", article.row.updated_at).select("updated_at").maybeSingle();
  if (error) return NextResponse.json({ error: "Не удалось сохранить статью." }, { status: 500 });
  if (!saved) return NextResponse.json({ error: "Статья уже изменена в другой вкладке. Ваш текст в редакторе не потерян. Откройте свежую версию и сравните изменения." }, { status: 409 });
  // Earlier content revisions and images remain recoverable.
  return NextResponse.json({ ok: true, article: { id, slug: payload.slug, status: input.status, updatedAt: saved.updated_at } });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!sameOriginOrMissing(request)) return NextResponse.json({ error: "Недопустимый запрос." }, { status: 403 });
  const viewer = await getCommunityViewer({ allowAuthenticated: true });
  if (!viewer) return NextResponse.json({ error: "Войдите в аккаунт." }, { status: 401 });
  const id = Number((await params).id);
  if (!Number.isSafeInteger(id)) return NextResponse.json({ error: "Статья не найдена." }, { status: 404 });
  const article = await getWikiIndexById(id);
  if (!article) return NextResponse.json({ error: "Статья не найдена." }, { status: 404 });
  if (article.payload.authorId !== viewer.user.id && !viewer.adminProfile) return NextResponse.json({ error: "Недостаточно прав." }, { status: 403 });
  const admin = createSupabaseAdminClient();
  const content = await readWikiContent(article.payload.contentPath);
  await admin.storage.from(WIKI_BUCKET).remove([article.payload.contentPath, ...wikiImageIds(content)]);
  const results = await Promise.all([
    admin.from("site_updates").delete().eq("id", id).eq("source_key", article.row.source_key),
    admin.from("site_updates").delete().eq("title", `wiki-comment:${id}`).eq("published", false),
    admin.from("site_updates").delete().eq("title", `wiki-like:${id}`).eq("published", false),
  ]);
  if (results.some((result) => result.error)) return NextResponse.json({ error: "Не удалось полностью удалить статью." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
