import { NextResponse } from "next/server";
import { getCommunityViewer } from "@/lib/community";
import { sameOriginOrMissing } from "@/lib/waitlist";
import { consumeRateLimit, rateLimitResponse } from "@/lib/request-security";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getWikiIndexById, readWikiContent, WIKI_BUCKET } from "@/lib/wiki";
import { isWikiImagePath, wikiImageIds } from "@/lib/wiki-content";

export async function POST(request: Request) {
  if (!sameOriginOrMissing(request)) return NextResponse.json({ error: "Недопустимый запрос." }, { status: 403 });
  const viewer = await getCommunityViewer({ allowAuthenticated: true });
  if (!viewer) return NextResponse.json({ error: "Войдите в аккаунт." }, { status: 401 });
  const limit = await consumeRateLimit(request, { scope: "wiki-image-preview", key: viewer.user.id, limit: 120, windowSeconds: 3600 });
  if (!limit.allowed) return rateLimitResponse(limit, "Слишком много запросов. Попробуйте позже.");
  const body = await request.json().catch(() => null);
  const paths = Array.isArray(body?.paths) ? [...new Set(body.paths.filter((path: unknown): path is string => typeof path === "string" && path.length <= 180))].slice(0, 60) as string[] : [];
  const allowed = new Set<string>();
  if (Number.isSafeInteger(body?.articleId)) {
    const article = await getWikiIndexById(body.articleId);
    if (article && (article.payload.authorId === viewer.user.id || viewer.adminProfile)) {
      wikiImageIds(await readWikiContent(article.payload.contentPath)).forEach(path => allowed.add(path));
    }
  }
  if (paths.some(path => !isWikiImagePath(path) || (!allowed.has(path) && !path.startsWith(`uploads/${viewer.user.id}/`)))) return NextResponse.json({ error: "Недостаточно прав." }, { status: 403 });
  if (!paths.length) return NextResponse.json({ urls: {} });
  const { data, error } = await createSupabaseAdminClient().storage.from(WIKI_BUCKET).createSignedUrls(paths, 3600);
  if (error) return NextResponse.json({ error: "Не удалось загрузить скриншот." }, { status: 500 });
  return NextResponse.json({ urls: Object.fromEntries((data ?? []).map((item, index) => [paths[index], item.signedUrl ?? null])) });
}
