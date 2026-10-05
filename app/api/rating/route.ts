import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { consumeRateLimit, rateLimitResponse } from "@/lib/request-security";
import { getSiteSettings, getViewerIdentity, sameOriginOrMissing } from "@/lib/waitlist";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!sameOriginOrMissing(request)) {
    return NextResponse.json({ error: "Запрос отклонён." }, { status: 403 });
  }
  const limit = await consumeRateLimit(request, {
    scope: "site-rating",
    limit: 5,
    windowSeconds: 24 * 60 * 60,
  });
  if (!limit.allowed) return rateLimitResponse(limit, "Оценка уже принята.");

  const body = await request.json().catch(() => null);
  const stars = Number(body?.stars);
  const feedback = String(body?.feedback ?? "").trim();
  const promptId = String(body?.promptId ?? "").trim();
  const pageUrl = String(body?.pageUrl ?? "").trim().slice(0, 300);
  if (!Number.isInteger(stars) || stars < 1 || stars > 5 || feedback.length > 800 || !/^[a-zA-Z0-9-]{10,100}$/.test(promptId)) {
    return NextResponse.json({ error: "Проверьте оценку и текст." }, { status: 400 });
  }

  const settings = await getSiteSettings();
  if (!settings.ratingPromptId || settings.ratingPromptId !== promptId) {
    return NextResponse.json({ error: "Этот опрос уже закрыт." }, { status: 409 });
  }

  const viewer = await getViewerIdentity().catch(() => null);
  const stored = JSON.stringify({
    stars,
    feedback,
    pageUrl,
    userId: viewer?.user.id ?? null,
    email: viewer?.user.email ?? null,
    promptId,
  });
  const { error } = await createSupabaseAdminClient().from("site_updates").insert({
    source_key: `__site_rating:${promptId}:${randomUUID()}`,
    badge: "RATING",
    title: `Оценка сайта: ${stars}/5`,
    body: stored,
    color: stars <= 2 ? "pink" : "lime",
    published: false,
  });
  if (error) {
    return NextResponse.json({ error: "Не удалось сохранить оценку." }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
