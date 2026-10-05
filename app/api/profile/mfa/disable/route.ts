import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { sameOriginOrMissing } from "@/lib/waitlist";
import { consumeRateLimit, rateLimitResponse } from "@/lib/request-security";
import { isRealEmail, mailEnabled, mailLocale, sendSiteMail, siteUrl } from "@/lib/mail";
import { mfaResetLetter } from "@/lib/mail-letters";
import { issueMailToken, MFA_RESET_TTL } from "@/lib/mail-tokens";
import { revokeAllAiTokens } from "@/lib/ai-connect/oauth";

/* Отключение 2FA.

   Если код уже введён (сеанс aal2) — это настройки профиля: достаточно
   пароля, все аутентификаторы удаляются сразу.

   Если код НЕ введён (человек застрял на странице ввода кода), одного пароля
   мало: иначе 2FA не защищала бы от украденного пароля. Тогда на почту
   аккаунта уходит одноразовая ссылка, и защита снимается только по ней
   (app/api/auth/email-confirm, k=mfa). Нет личной почты — только через
   поддержку. */

const maskEmail = (email: string) => {
  const [name, domain] = email.split("@");
  return `${name.slice(0, 2)}${"•".repeat(Math.max(1, name.length - 2))}@${domain}`;
};

export async function POST(request: Request) {
  if (!sameOriginOrMissing(request)) {
    return NextResponse.json({ error: "Запрос отклонён." }, { status: 403 });
  }
  const body = await request.json().catch(() => null);
  const password = String(body?.password ?? "");
  if (!password || password.length > 128) {
    return NextResponse.json({ error: "Введите текущий пароль." }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email) {
    return NextResponse.json({ error: "Сначала войдите в аккаунт." }, { status: 401 });
  }

  const limit = await consumeRateLimit(request, { scope: "mfa-disable", key: user.id, limit: 5, windowSeconds: 60 * 60 });
  if (!limit.allowed) return rateLimitResponse(limit, "Слишком много попыток. Попробуйте позже.");

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) {
    return NextResponse.json({ error: "Авторизация временно недоступна." }, { status: 503 });
  }

  const verifier = createClient(url, publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  const { data: verified, error: passwordError } = await verifier.auth.signInWithPassword({
    email: user.email,
    password,
  });
  if (passwordError || verified.user?.id !== user.id) {
    return NextResponse.json({ error: "Текущий пароль неверен." }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();
  const { data: factorData, error: listError } = await admin.auth.admin.mfa.listFactors({ userId: user.id });
  if (listError) {
    return NextResponse.json({ error: "Не удалось получить список аутентификаторов." }, { status: 500 });
  }

  const { data: assurance } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  const codeEntered = assurance?.currentLevel === "aal2" || assurance?.nextLevel !== "aal2";

  if (!codeEntered) {
    /* Кода нет — подтверждаем владение аккаунтом через почту. */
    const email = user.email.toLowerCase();
    if (!isRealEmail(email) || !mailEnabled()) {
      return NextResponse.json({
        error: "К аккаунту не привязана почта, поэтому снять 2FA без кода можно только через поддержку: @PoppersCraftAuthBot в Telegram.",
      }, { status: 403 });
    }
    const token = await issueMailToken(user.id, "mfa_reset", MFA_RESET_TTL);
    if (!token) return NextResponse.json({ error: "Не удалось подготовить письмо. Попробуйте ещё раз." }, { status: 500 });
    const login = String(user.user_metadata?.minecraft_login ?? user.user_metadata?.display_name ?? email.split("@")[0]);
    const sent = await sendSiteMail(mfaResetLetter({
      to: email,
      login,
      url: `${siteUrl()}/mail?k=mfa&u=${encodeURIComponent(user.id)}&t=${encodeURIComponent(token)}`,
      locale: mailLocale(user.user_metadata?.language),
    }));
    if (!sent.ok) return NextResponse.json({ error: "Письмо не удалось отправить. Попробуйте позже." }, { status: 502 });
    return NextResponse.json({
      ok: true,
      sent: true,
      message: `Мы отправили письмо на ${maskEmail(email)}. 2FA отключится, когда вы перейдёте по ссылке из письма. Нет письма — проверьте папку «Спам».`,
    });
  }

  const results = await Promise.all(
    factorData.factors.map((factor) => admin.auth.admin.mfa.deleteFactor({ id: factor.id, userId: user.id })),
  );
  if (results.some((result) => result.error)) {
    return NextResponse.json({ error: "Не все аутентификаторы удалось отключить. Повторите попытку." }, { status: 500 });
  }

  /* Вместе с сеансами обрываются и подключения нейросетей. */
  await revokeAllAiTokens(user.id).catch(() => undefined);
  await supabase.auth.signOut({ scope: "global" });
  return NextResponse.json({
    ok: true,
    message: factorData.factors.length
      ? "2FA отключена. Сейчас вы выйдете из аккаунта."
      : "2FA уже была отключена. Сейчас вы выйдете из аккаунта.",
  });
}
