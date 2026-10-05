import { NextResponse } from "next/server";
import { getViewerIdentity, normalizeEmail, sameOriginOrMissing } from "@/lib/waitlist";
import { consumeRateLimit, rateLimitResponse } from "@/lib/request-security";
import { isRealEmail, mailEnabled, mailLocale, sendSiteMail, siteUrl } from "@/lib/mail";
import { emailVerifyLetter } from "@/lib/mail-letters";
import { EMAIL_CONFIRM_TTL, issueMailToken } from "@/lib/mail-tokens";

/* Повторная отправка письма с подтверждением текущего адреса. */
export async function POST(request: Request) {
  if (!sameOriginOrMissing(request)) {
    return NextResponse.json({ error: "Запрос отклонён." }, { status: 403 });
  }
  const identity = await getViewerIdentity();
  if (!identity) {
    return NextResponse.json({ error: "Сначала войдите в аккаунт." }, { status: 401 });
  }
  if (identity.needsMfa) {
    return NextResponse.json({ error: "Сначала подтвердите вход через 2FA." }, { status: 403 });
  }

  const limit = await consumeRateLimit(request, {
    scope: "email-verify-resend",
    key: identity.user.id,
    limit: 3,
    windowSeconds: 60 * 60,
  });
  if (!limit.allowed) {
    return rateLimitResponse(limit, "Письмо уже отправляли. Проверьте почту и папку «Спам».");
  }

  const email = normalizeEmail(identity.user.email ?? "");
  if (!isRealEmail(email)) {
    return NextResponse.json(
      { error: "У аккаунта нет личной почты. Укажите её в поле «Новая почта»." },
      { status: 400 },
    );
  }
  if (!mailEnabled()) {
    return NextResponse.json({ error: "Отправка писем временно недоступна." }, { status: 503 });
  }

  const token = await issueMailToken(identity.user.id, "email_verify", EMAIL_CONFIRM_TTL);
  if (!token) {
    return NextResponse.json({ error: "Не удалось подготовить письмо. Попробуйте ещё раз." }, { status: 500 });
  }

  const sent = await sendSiteMail(
    emailVerifyLetter({
      to: email,
      login: String(
        identity.user.user_metadata?.minecraft_login
          ?? identity.user.user_metadata?.display_name
          ?? email.split("@")[0],
      ),
      url: `${siteUrl()}/mail?k=verify&u=${encodeURIComponent(identity.user.id)}&t=${encodeURIComponent(token)}`,
      locale: mailLocale(identity.user.user_metadata?.language),
    }),
  );
  if (!sent.ok) {
    return NextResponse.json({ error: "Письмо не удалось отправить. Попробуйте позже." }, { status: 502 });
  }

  return NextResponse.json({ ok: true, message: "Письмо отправлено. Проверьте почту и папку «Спам»." });
}
