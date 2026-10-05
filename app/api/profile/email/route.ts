import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getViewerIdentity, isValidEmail, normalizeEmail, sameOriginOrMissing } from "@/lib/waitlist";
import { consumeRateLimit, rateLimitResponse } from "@/lib/request-security";
import { mailEnabled, mailLocale, sendSiteMail, siteUrl } from "@/lib/mail";
import { emailChangeLetter } from "@/lib/mail-letters";
import { EMAIL_CONFIRM_TTL, issueMailToken } from "@/lib/mail-tokens";

export async function POST(request: Request) {
  if (!sameOriginOrMissing(request)) {
    return NextResponse.json({ error: "Запрос отклонён." }, { status: 403 });
  }
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > 8 * 1024) {
    return NextResponse.json({ error: "Запрос слишком большой." }, { status: 413 });
  }

  const identity = await getViewerIdentity();
  if (!identity) {
    return NextResponse.json({ error: "Сначала войдите в аккаунт." }, { status: 401 });
  }
  if (identity.needsMfa) {
    return NextResponse.json({ error: "Сначала подтвердите вход через 2FA." }, { status: 403 });
  }
  const body = await request.json().catch(() => null);
  const email = normalizeEmail(String(body?.email ?? ""));
  const currentPassword = String(body?.currentPassword ?? "");
  if (!isValidEmail(email) || email.endsWith("@users.popperscraft.org")) {
    return NextResponse.json({ error: "Введите действующую личную почту." }, { status: 400 });
  }
  if (!currentPassword || currentPassword.length > 128) {
    return NextResponse.json({ error: "Введите текущий пароль." }, { status: 400 });
  }
  const currentEmail = normalizeEmail(identity.user.email ?? "");
  if (!currentEmail) {
    return NextResponse.json({ error: "У аккаунта не найдена текущая почта." }, { status: 400 });
  }
  if (email === currentEmail) {
    return NextResponse.json({ error: "Новая почта совпадает с текущей." }, { status: 400 });
  }

  const [clientLimit, accountLimit] = await Promise.all([
    consumeRateLimit(request, { scope: "profile-email-client", limit: 12, windowSeconds: 60 * 60 }),
    consumeRateLimit(request, {
      scope: "profile-email-account",
      key: identity.user.id,
      limit: 5,
      windowSeconds: 60 * 60,
    }),
  ]);
  if (!clientLimit.allowed) {
    return rateLimitResponse(clientLimit, "Слишком много попыток смены почты. Попробуйте позже.");
  }
  if (!accountLimit.allowed) {
    return rateLimitResponse(accountLimit, "Слишком много попыток для этого аккаунта. Попробуйте позже.");
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) {
    return NextResponse.json({ error: "Авторизация временно недоступна." }, { status: 503 });
  }

  const verifier = createClient(url, publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  const { data: verified, error: passwordError } = await verifier.auth.signInWithPassword({
    email: currentEmail,
    password: currentPassword,
  });
  if (passwordError || verified.user?.id !== identity.user.id) {
    return NextResponse.json({ error: "Текущий пароль неверен." }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();
  const [{ data: users, error: usersError }, { data: conflictingAdmin, error: adminConflictError }] = await Promise.all([
    admin.auth.admin.listUsers({ page: 1, perPage: 1_000 }),
    identity.adminProfile
      ? admin
          .from("admin_profiles")
          .select("id")
          .eq("email", email)
          .neq("id", identity.adminProfile.id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (usersError || adminConflictError) {
    return NextResponse.json({ error: "Не удалось проверить новую почту. Попробуйте ещё раз." }, { status: 503 });
  }
  const emailOwner = users.users.find((user) => normalizeEmail(user.email ?? "") === email);
  if ((emailOwner && emailOwner.id !== identity.user.id) || conflictingAdmin) {
    return NextResponse.json({ error: "Эта почта уже используется другим аккаунтом." }, { status: 409 });
  }

  /* Адрес меняется не сразу: сначала письмо на новый ящик. Иначе опечатка или
     чужая почта отрезали бы человека от аккаунта. Сама замена — в
     app/api/auth/email-confirm. */
  if (!mailEnabled()) {
    return NextResponse.json(
      { error: "Отправка писем временно недоступна. Напишите в поддержку в Telegram." },
      { status: 503 },
    );
  }

  const token = await issueMailToken(identity.user.id, "email_change", EMAIL_CONFIRM_TTL, email);
  if (!token) {
    return NextResponse.json({ error: "Не удалось подготовить письмо. Попробуйте ещё раз." }, { status: 500 });
  }

  const displayLogin = String(
    identity.user.user_metadata?.minecraft_login
      ?? identity.user.user_metadata?.display_name
      ?? currentEmail.split("@")[0],
  );
  const sent = await sendSiteMail(
    emailChangeLetter({
      to: email,
      login: displayLogin,
      url: `${siteUrl()}/mail?k=change&u=${encodeURIComponent(identity.user.id)}&t=${encodeURIComponent(token)}`,
      locale: mailLocale(identity.user.user_metadata?.language),
    }),
  );
  if (!sent.ok) {
    return NextResponse.json(
      { error: "Письмо не удалось отправить. Проверьте адрес или попробуйте позже." },
      { status: 502 },
    );
  }

  return NextResponse.json({
    ok: true,
    message: "Письмо отправлено на новый адрес. Почта аккаунта поменяется, когда вы перейдёте по ссылке из письма. Нет письма — проверьте папку «Спам».",
  });
}
