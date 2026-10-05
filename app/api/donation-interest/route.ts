import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getApprovedMember, getViewerIdentity, sameOriginOrMissing } from "@/lib/waitlist";
import { consumeRateLimit, rateLimitResponse } from "@/lib/request-security";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: Request) {
  if (!sameOriginOrMissing(request)) {
    return NextResponse.json({ error: "Запрос отклонён." }, { status: 403 });
  }
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > 4 * 1024) {
    return NextResponse.json({ error: "Запрос слишком большой." }, { status: 413 });
  }
  const limit = await consumeRateLimit(request, { scope: "donation-interest", limit: 5, windowSeconds: 60 * 60 });
  if (!limit.allowed) return rateLimitResponse(limit, "Слишком много заявок. Попробуйте позже.");
  const body = await request.json().catch(() => null);
  const email = String(body?.email ?? "").trim().toLowerCase();
  if (email.length > 254 || !emailPattern.test(email)) {
    return NextResponse.json({ error: "Проверьте адрес электронной почты." }, { status: 400 });
  }
  const globalLimit = await consumeRateLimit(request, { scope: "donation-interest-global", key: "global", limit: 200, windowSeconds: 24 * 60 * 60 });
  if (!globalLimit.allowed) return rateLimitResponse(globalLimit, "Приём адресов временно занят. Попробуйте позже.");

  const [viewer, member] = await Promise.all([getViewerIdentity(), getApprovedMember()]);
  const status = member ? "member" : viewer ? "account" : "guest";
  const account = member?.login ?? viewer?.user.email ?? "без аккаунта";
  const { error } = await createSupabaseAdminClient().from("site_updates").upsert({
    source_key: `__donation_interest:${email}`,
    badge: "DONATE",
    title: email,
    body: JSON.stringify({ account, status }),
    color: "yellow",
    published: false,
    updated_at: new Date().toISOString(),
  }, { onConflict: "source_key" });

  if (error) {
    return NextResponse.json({ error: "Не удалось сохранить почту. Попробуйте позже." }, { status: 500 });
  }
  return NextResponse.json({ message: "Готово! Мы напишем на эту почту, когда донат откроется." });
}
