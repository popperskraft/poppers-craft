import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getCommunityViewer } from "@/lib/community";
import { consumeRateLimit, rateLimitResponse } from "@/lib/request-security";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { sameOriginOrMissing } from "@/lib/waitlist";
import { encodeWikiRecord, ensureWikiBucket, WIKI_ARTICLE_PREFIX, WIKI_BUCKET, type WikiArticleIndexPayload } from "@/lib/wiki";
import { wikiImageIds } from "@/lib/wiki-content";
import { parseWikiArticleInput, wikiSlugBase } from "@/lib/wiki-input";
import { queueWikiPublication } from "@/lib/wiki-publication-notify";

export async function POST(request: Request) {
  if (!sameOriginOrMissing(request)) return NextResponse.json({ error: "Недопустимый запрос." }, { status: 403 });
  const viewer = await getCommunityViewer({ allowAuthenticated: true });
  if (!viewer) return NextResponse.json({ error: "Войдите в аккаунт." }, { status: 401 });
  const limit = await consumeRateLimit(request, { scope: "wiki-article-create", key: viewer.user.id, limit: 30, windowSeconds: 24 * 60 * 60 });
  if (!limit.allowed) return rateLimitResponse(limit, "Сегодня создано слишком много статей. Попробуйте позже.");
  const parsed = parseWikiArticleInput(await request.json().catch(() => null));
  if (!parsed.value) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const input = parsed.value;
  const imagePaths = wikiImageIds(input.blocks);
  if (imagePaths.some((path) => !path.startsWith(`uploads/${viewer.user.id}/`))) {
    return NextResponse.json({ error: "Один из скриншотов недоступен. Загрузите его заново." }, { status: 400 });
  }

  const slug = `${wikiSlugBase(input.title)}-${randomUUID().replaceAll("-", "").slice(0, 8)}`.slice(0, 119);
  const contentPath = `articles/${slug}.json`;
  const now = new Date().toISOString();
  const payload: WikiArticleIndexPayload = {
    version: 1,
    slug,
    authorId: viewer.user.id,
    summary: input.summary,
    category: input.category,
    tags: input.tags,
    status: input.status,
    contentPath,
    publishedAt: input.status === "published" ? now : null,
  };
  const encoded = encodeWikiRecord(payload);
  if (encoded.length > 1200) return NextResponse.json({ error: "Описание и теги статьи слишком длинные." }, { status: 400 });
  const admin = createSupabaseAdminClient();
  await ensureWikiBucket();
  const content = new Blob([JSON.stringify({ version: 1, blocks: input.blocks, coverArt: input.coverArt ?? null })], { type: "application/json" });
  const { error: contentError } = await admin.storage.from(WIKI_BUCKET).upload(contentPath, content, { contentType: "application/json", upsert: false });
  if (contentError) return NextResponse.json({ error: "Не удалось сохранить содержимое статьи." }, { status: 500 });
  if (input.status === "published") {
    try { await queueWikiPublication(slug); }
    catch { return NextResponse.json({ error: "Не удалось подготовить уведомление сервера. Статья не опубликована. Попробуйте ещё раз." }, { status: 503 }); }
  }
  const { data: article, error } = await admin.from("site_updates").insert({
    source_key: `${WIKI_ARTICLE_PREFIX}${slug}`,
    badge: "WIKI",
    title: input.title,
    body: encoded,
    color: "cyan",
    published: false,
    updated_at: now,
  }).select("id,source_key,updated_at").single();
  if (error) {
    return NextResponse.json({ error: "Не удалось сохранить статью." }, { status: 500 });
  }
  return NextResponse.json({ ok: true, article: { id: article.id, slug, status: input.status, updatedAt: article.updated_at } });
}
