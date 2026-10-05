import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { ERROR_SESSION_COOKIE, recentSiteErrorLogIds, validErrorSessionId } from "@/lib/error-logs";
import { getViewerIdentity, sameOriginOrMissing } from "@/lib/waitlist";
import { consumeRateLimit, rateLimitResponse } from "@/lib/request-security";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: Request) {
  if (!sameOriginOrMissing(request)) {
    return NextResponse.json({ error: "Запрос отклонён." }, { status: 403 });
  }
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > 8 * 1024) {
    return NextResponse.json({ error: "Сообщение слишком большое." }, { status: 413 });
  }
  const limit = await consumeRateLimit(request, { scope: "bug-report", limit: 6, windowSeconds: 60 * 60 });
  if (!limit.allowed) return rateLimitResponse(limit, "Слишком много сообщений. Попробуйте позже.");
  const body = await request.json().catch(() => null);
  if (String(body?.website ?? "").trim()) {
    return NextResponse.json({ message: "Спасибо! Баг-репорт отправлен." });
  }
  const description = String(body?.description ?? "").trim();
  const suppliedEmail = String(body?.email ?? "").trim().toLowerCase();
  const page = String(body?.page ?? "/").slice(0, 1000);
  if (description.length < 10 || description.length > 600) {
    return NextResponse.json({ error: "Опишите ошибку чуть подробнее." }, { status: 400 });
  }
  if (suppliedEmail && !emailPattern.test(suppliedEmail)) {
    return NextResponse.json({ error: "Проверьте адрес электронной почты." }, { status: 400 });
  }
  const globalLimit = await consumeRateLimit(request, { scope: "bug-report-global", key: "global", limit: 200, windowSeconds: 24 * 60 * 60 });
  if (!globalLimit.allowed) return rateLimitResponse(globalLimit, "Приём баг-репортов временно занят. Попробуйте позже.");
  const viewer = await getViewerIdentity();
  const cookieStore = await cookies();
  let logIds: number[] = [];
  try {
    logIds = await recentSiteErrorLogIds({
      sessionId: validErrorSessionId(cookieStore.get(ERROR_SESSION_COOKIE)?.value),
      userId: viewer?.user.id ?? null,
      minutes: 30,
    });
  } catch (error) {
    console.error("recent site error lookup failed", error);
  }
  const safePage = (page.startsWith("/") ? page : "/").slice(0, 120);
  const storedPage = safePage.length >= 3 ? safePage : `PAGE: ${safePage}`;
  const sourceKey = `__bug_report__:${crypto.randomUUID()}`;
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("site_updates").insert({
    source_key: sourceKey,
    badge: "BUG",
    title: storedPage,
    body: JSON.stringify({
      description,
      email: suppliedEmail || viewer?.user.email?.toLowerCase() || null,
      userId: viewer?.user.id ?? null,
      userAgent: String(request.headers.get("user-agent") ?? "").slice(0, 140),
      logIds,
      status: "new",
    }),
    color: "yellow",
    published: false,
  });
  if (error) {
    console.error("bug report insert failed", {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
    });
    return NextResponse.json({ error: "Не удалось сохранить баг-репорт. Попробуйте позже." }, { status: 500 });
  }
  if (description === "Автоматическая проверка формы после публикации") {
    await admin.from("site_updates").delete().eq("source_key", sourceKey);
  }
  return NextResponse.json({
    message: logIds.length
      ? `Спасибо! Баг-репорт отправлен вместе с логами: ${logIds.map((id) => `LOG-${String(id).padStart(6, "0")}`).join(", ")}.`
      : "Спасибо! Баг-репорт отправлен администраторам.",
  });
}
