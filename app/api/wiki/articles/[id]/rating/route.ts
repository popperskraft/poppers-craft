import { NextResponse } from "next/server";
import { getCommunityViewer } from "@/lib/community";
import { consumeRateLimit, rateLimitResponse } from "@/lib/request-security";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { sameOriginOrMissing } from "@/lib/waitlist";
import { getWikiIndexById, wikiRatings } from "@/lib/wiki";
import { validWikiRating, WIKI_RATING_PREFIX } from "@/lib/wiki-discussion";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!sameOriginOrMissing(request)) return NextResponse.json({ error: "Недопустимый запрос." }, { status: 403 });
  const viewer = await getCommunityViewer({ allowAuthenticated: true });
  if (!viewer) return NextResponse.json({ error: "Войдите в аккаунт." }, { status: 401 });
  const id = Number((await params).id);
  const score = (await request.json().catch(() => null))?.score;
  if (!Number.isSafeInteger(id) || id <= 0 || !validWikiRating(score)) return NextResponse.json({ error: "Выберите оценку от 0,5 до 5 с шагом 0,5." }, { status: 400 });
  const article = await getWikiIndexById(id);
  if (!article || article.payload.status !== "published") return NextResponse.json({ error: "Статья не найдена или ещё не опубликована." }, { status: 404 });
  const limit = await consumeRateLimit(request, { scope: "wiki-rating", key: viewer.user.id, limit: 120, windowSeconds: 3600 });
  if (!limit.allowed) return rateLimitResponse(limit, "Слишком много оценок. Попробуйте позже.");
  const { error } = await createSupabaseAdminClient().from("site_updates").upsert({
    source_key: `${WIKI_RATING_PREFIX}${id}:${viewer.user.id}`, badge: "RATING", title: `wiki-rating:${id}`,
    body: `rating:${score}`, color: "yellow", published: false, updated_at: new Date().toISOString(),
  }, { onConflict: "source_key" });
  if (error) return NextResponse.json({ error: "Не удалось сохранить оценку." }, { status: 500 });
  return NextResponse.json({ ok: true, rating: (await wikiRatings([id], viewer.user.id)).get(id) });
}
