import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { sameOriginOrMissing } from "@/lib/waitlist";
import { consumeRateLimit, rateLimitResponse } from "@/lib/request-security";
import { clearMailToken, consumeMailToken } from "@/lib/mail-tokens";

export async function POST(request: Request) {
  if (!sameOriginOrMissing(request)) {
    return NextResponse.json({ error: "Запрос отклонён." }, { status: 403 });
  }
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > 8 * 1024) {
    return NextResponse.json({ error: "Запрос слишком большой." }, { status: 413 });
  }

  const clientLimit = await consumeRateLimit(request, {
    scope: "password-reset-confirm",
    limit: 20,
    windowSeconds: 60 * 60,
  });
  if (!clientLimit.allowed) {
    return rateLimitResponse(clientLimit, "Слишком много попыток. Попробуйте позже.");
  }

  const body = await request.json().catch(() => null);
  const userId = String(body?.u ?? "");
  const token = String(body?.t ?? "");
  const password = String(body?.password ?? "");
  if (password.length < 8 || password.length > 128) {
    return NextResponse.json({ error: "Пароль должен содержать от 8 до 128 символов." }, { status: 400 });
  }

  const checked = await consumeMailToken(userId, "password_reset", token);
  if (!checked.ok) {
    return NextResponse.json(
      {
        error: checked.reason === "expired"
          ? "Срок действия ссылки истёк. Запросите письмо заново."
          : "Ссылка недействительна. Запросите письмо заново.",
      },
      { status: 400 },
    );
  }

  const admin = createSupabaseAdminClient();
  const { error } = await admin.auth.admin.updateUserById(checked.user.id, { password });
  if (error) {
    console.error("password reset failed", { code: error.code, status: error.status });
    return NextResponse.json({ error: "Не удалось сменить пароль. Попробуйте ещё раз." }, { status: 500 });
  }

  /* Переход по ссылке доказывает доступ к ящику — заодно считаем почту
     подтверждённой и убираем использованный токен. */
  await clearMailToken(checked.user.id, "password_reset", { email_verified_at: new Date().toISOString() });

  return NextResponse.json({
    ok: true,
    message: "Пароль изменён. Теперь войдите с новым паролем.",
  });
}
