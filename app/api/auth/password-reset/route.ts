import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { normalizeEmail, normalizeLogin, resolveLoginIdentifierToEmail, sameOriginOrMissing } from "@/lib/waitlist";
import { consumeRateLimit, rateLimitResponse } from "@/lib/request-security";
import { CAPTCHA_COOKIE, verifyAndConsumeCaptcha } from "@/lib/captcha";
import { isRealEmail, mailEnabled, mailLocale, sendSiteMail, siteUrl } from "@/lib/mail";
import { passwordResetLetter } from "@/lib/mail-letters";
import { PASSWORD_RESET_TTL, issueMailToken } from "@/lib/mail-tokens";

/* Ответ одинаковый и когда аккаунт найден, и когда его нет: иначе форма
   превращается в способ проверять, кто зарегистрирован на сайте. */
const NEUTRAL = {
  ok: true,
  message: "Если такой аккаунт существует, письмо со ссылкой уже отправлено. Проверьте почту и папку «Спам».",
};

export async function POST(request: Request) {
  if (!sameOriginOrMissing(request)) {
    return NextResponse.json({ error: "Запрос отклонён." }, { status: 403 });
  }
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > 8 * 1024) {
    return NextResponse.json({ error: "Запрос слишком большой." }, { status: 413 });
  }

  const body = await request.json().catch(() => null);
  const login = normalizeLogin(String(body?.login ?? ""));
  if (!login || login.length > 254) {
    return NextResponse.json({ error: "Введите логин или почту." }, { status: 400 });
  }

  const clientLimit = await consumeRateLimit(request, {
    scope: "password-reset-client",
    limit: 5,
    windowSeconds: 60 * 60,
  });
  if (!clientLimit.allowed) {
    return rateLimitResponse(clientLimit, "Слишком много запросов. Попробуйте позже.");
  }
  if (!(await verifyAndConsumeCaptcha(request, String(body?.captchaAnswer ?? "")))) {
    const response = NextResponse.json(
      { error: "Капча не пройдена или уже использована. Выберите новый блок." },
      { status: 400 },
    );
    response.cookies.delete(CAPTCHA_COOKIE);
    return response;
  }
  const [accountLimit, globalLimit] = await Promise.all([
    consumeRateLimit(request, {
      scope: "password-reset-account",
      key: login,
      limit: 3,
      windowSeconds: 60 * 60,
    }),
    consumeRateLimit(request, {
      scope: "password-reset-global",
      key: "global",
      limit: 120,
      windowSeconds: 24 * 60 * 60,
    }),
  ]);
  if (!accountLimit.allowed) {
    return rateLimitResponse(accountLimit, "Для этого аккаунта письмо уже отправляли. Подождите час.");
  }
  if (!globalLimit.allowed) {
    return rateLimitResponse(globalLimit, "Восстановление пароля временно перегружено. Попробуйте позже.");
  }

  if (!mailEnabled()) {
    return NextResponse.json(
      { error: "Отправка писем временно недоступна. Напишите в поддержку в Telegram." },
      { status: 503 },
    );
  }

  const email = normalizeEmail(await resolveLoginIdentifierToEmail(login));
  /* Аккаунты входа через Telegram живут на служебном домене: письма им слать
     некуда, пароль они восстанавливают через сам Telegram. */
  if (!isRealEmail(email)) return NextResponse.json(NEUTRAL);

  const admin = createSupabaseAdminClient();
  const { data: users, error: usersError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1_000 });
  if (usersError) {
    return NextResponse.json({ error: "База временно недоступна. Попробуйте позже." }, { status: 503 });
  }
  const user = users.users.find((candidate) => normalizeEmail(candidate.email ?? "") === email);
  if (!user) return NextResponse.json(NEUTRAL);

  const token = await issueMailToken(user.id, "password_reset", PASSWORD_RESET_TTL);
  if (!token) {
    return NextResponse.json({ error: "Не удалось подготовить ссылку. Попробуйте ещё раз." }, { status: 500 });
  }

  const displayLogin = String(
    user.user_metadata?.minecraft_login ?? user.user_metadata?.display_name ?? email.split("@")[0],
  );
  const url = `${siteUrl()}/reset?u=${encodeURIComponent(user.id)}&t=${encodeURIComponent(token)}`;
  const sent = await sendSiteMail(
    passwordResetLetter({
      to: email,
      login: displayLogin,
      url,
      locale: mailLocale(user.user_metadata?.language),
    }),
  );
  if (!sent.ok) {
    return NextResponse.json(
      { error: "Письмо не удалось отправить. Попробуйте позже или напишите в поддержку." },
      { status: 502 },
    );
  }

  return NextResponse.json(NEUTRAL);
}
