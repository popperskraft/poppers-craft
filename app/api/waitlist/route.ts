import { NextResponse } from "next/server";
import {
  isProtectedAdminEmail,
  isValidEmail,
  isValidLogin,
  normalizeEmail,
  normalizeLogin,
  sameOriginOrMissing,
} from "@/lib/waitlist";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { CAPTCHA_COOKIE, verifyAndConsumeCaptcha } from "@/lib/captcha";
import { consumeRateLimit, rateLimitResponse } from "@/lib/request-security";
import { notifySupportAdmins } from "@/lib/support-bridge";
import {
  parsePlayerSkinData,
  removePlayerSkin,
  savePlayerSkin,
} from "@/lib/player-skins";
import { collectSocialLinks } from "@/lib/social-links";
import { isRealEmail, mailEnabled, sendSiteMail, siteUrl } from "@/lib/mail";
import { emailVerifyLetter } from "@/lib/mail-letters";
import { EMAIL_CONFIRM_TTL, issueMailToken } from "@/lib/mail-tokens";
import { ReferralError, referralInsertError, validateReferral } from "@/lib/referrals";

const MAX_TEXT_LENGTH = 1200;

export async function POST(request: Request) {
  if (!sameOriginOrMissing(request)) {
    return NextResponse.json({ error: "Запрос отклонён." }, { status: 403 });
  }
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > 512 * 1024) {
    return NextResponse.json({ error: "Анкета слишком большая." }, { status: 413 });
  }

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const waitlistLimit = await consumeRateLimit(request, { scope: "waitlist", limit: 5, windowSeconds: 60 * 60 });
  if (!waitlistLimit.allowed) return rateLimitResponse(waitlistLimit, "Слишком много анкет с этого устройства. Попробуйте позже.");
  if (!(await verifyAndConsumeCaptcha(request, String(body?.captchaAnswer ?? "")))) {
    const response = NextResponse.json({ error: "Пройдите проверку игрока ещё раз." }, { status: 400 });
    response.cookies.delete(CAPTCHA_COOKIE);
    return response;
  }
  const login = normalizeLogin(String(body?.login ?? ""));
  const email = normalizeEmail(String(body?.email ?? ""));
  const password = String(body?.password ?? "");
  const who = String(body?.who ?? "").trim();
  const fromWhere = String(body?.fromWhere ?? "").trim();
  const whyServer = String(body?.whyServer ?? "").trim();
  const whyYou = String(body?.whyYou ?? "").trim();
  const favoriteMusic = String(body?.favoriteMusic ?? "").trim();
  const socialLinks = collectSocialLinks(body);
  const acceptedRules = body?.acceptRules === true || body?.acceptRules === "on";
  let skinBytes: Buffer;
  try {
    skinBytes = parsePlayerSkinData(body?.skinData);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Добавьте PNG-скин Minecraft." },
      { status: 400 },
    );
  }

  if (!isValidLogin(login)) {
    return NextResponse.json(
      { error: "Логин: 3–24 символа, латиница, цифры, точка, тире или _." },
      { status: 400 },
    );
  }
  if (!isValidEmail(email)) {
    return NextResponse.json(
      { error: "Введите корректную почту." },
      { status: 400 },
    );
  }
  if (password.length < 8 || password.length > 128) {
    return NextResponse.json(
      { error: "Пароль должен содержать от 8 до 128 символов." },
      { status: 400 },
    );
  }
  const answers = [who, fromWhere, whyServer, whyYou];
  if (answers.some((answer) => answer.length < 3 || answer.length > MAX_TEXT_LENGTH)) {
    return NextResponse.json(
      { error: "Ответьте на все вопросы. Каждый ответ — до 1200 символов." },
      { status: 400 },
    );
  }
  if (favoriteMusic.length > 300 || socialLinks.length > 1000) {
    return NextResponse.json({ error: "Музыка или ссылки указаны слишком длинно." }, { status: 400 });
  }
  if (!acceptedRules) {
    return NextResponse.json(
      { error: "Перед отправкой анкеты нужно принять правила PoppersCraft." },
      { status: 400 },
    );
  }

  const rulesAcceptedAt = new Date().toISOString();

  const admin = createSupabaseAdminClient();
  /* Почта администрации занята за ней: анкета не проверяет ящик (r104). */
  const { data: staffEmail } = await admin.from("admin_profiles").select("id").eq("email", email).maybeSingle();
  if (staffEmail || isProtectedAdminEmail(email)) {
    return NextResponse.json(
      { error: "Аккаунт с таким ником или почтой уже существует. Проверьте статус через вход." },
      { status: 409 },
    );
  }
  const { data: existing, error: existingError } = await admin
    .from("waitlist_applications")
    .select("status")
    .eq("login", login)
    .maybeSingle();
  if (existingError) {
    return NextResponse.json(
      { error: "База временно недоступна. Попробуйте позже." },
      { status: 503 },
    );
  }
  if (existing) {
    return NextResponse.json(
      { error: "Такой логин уже используется. Проверьте статус через вход." },
      { status: 409 },
    );
  }

  // Check before creating an account. Database triggers validate again and
  // commit the invitation together with the application, never separately.
  let referralCode: string | null = null;
  if (body?.referralCode !== undefined && body.referralCode !== null && body.referralCode !== "") {
    try {
      referralCode = (await validateReferral(body.referralCode)).code;
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof ReferralError ? error.message : "Не удалось проверить приглашение. Попробуйте позже." },
        { status: error instanceof ReferralError ? error.status : 503 },
      );
    }
  }

  const globalRegistrationLimit = await consumeRateLimit(request, {
    scope: "waitlist-registration-global",
    key: "global",
    limit: 100,
    windowSeconds: 24 * 60 * 60,
  });
  if (!globalRegistrationLimit.allowed) {
    return rateLimitResponse(globalRegistrationLimit, "Приём анкет временно перегружен. Попробуйте завтра.");
  }

  const { data: created, error: authError } =
    await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        minecraft_login: login,
        display_name: login,
        favorite_music: favoriteMusic,
        social_links: socialLinks,
        rules_accepted_at: rulesAcceptedAt,
        rules_version: "2026-08-13",
      },
    });

  if (authError || !created.user) {
    const duplicate = authError?.message.toLowerCase().includes("already");
    return NextResponse.json(
      {
        error: duplicate
          ? "Аккаунт с таким ником или почтой уже существует. Проверьте статус через вход."
          : "Не удалось создать заявку. Попробуйте ещё раз.",
      },
      { status: duplicate ? 409 : 500 },
    );
  }

  try {
    await savePlayerSkin({
      userId: created.user.id,
      currentMetadata: created.user.user_metadata,
      bytes: skinBytes,
    });
  } catch {
    await admin.auth.admin.deleteUser(created.user.id);
    return NextResponse.json(
      { error: "Не удалось сохранить скин. Попробуйте отправить анкету ещё раз." },
      { status: 500 },
    );
  }

  const { error: insertError } = await admin
    .from("waitlist_applications")
    .insert({
      user_id: created.user.id,
      login,
      who,
      from_where: fromWhere,
      why_server: whyServer,
      why_you: whyYou,
      status: "pending",
      referral_code: referralCode,
    });

  if (insertError) {
    await removePlayerSkin(created.user.id);
    await admin.auth.admin.deleteUser(created.user.id);
    return NextResponse.json(
      { error: referralInsertError(insertError) ?? "Не удалось сохранить заявку. Попробуйте ещё раз." },
      { status: referralInsertError(insertError) ? 400 : 500 },
    );
  }

  try {
    await notifySupportAdmins([
      "НОВАЯ АНКЕТА В ВАЙТЛИСТЕ",
      "",
      `Игровой ник: @${login}`,
      `Отправлена: ${new Intl.DateTimeFormat("ru-RU", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Europe/Moscow",
      }).format(new Date())} (МСК)`,
      "",
      "Откройте на сайте: Управление → Анкеты.",
      "https://www.popperscraft.org/admin",
      "Пароль и ответы анкеты в Telegram не отправляются.",
    ].join("\n"));
  } catch (error) {
    console.error("Waitlist Telegram notification failed", error);
  }

  /* Письмо с подтверждением почты. Анкета уже сохранена, поэтому сбой отправки
     ничего не отменяет — подтвердить адрес можно позже из профиля. */
  let mailed = false;
  if (mailEnabled() && isRealEmail(email)) {
    try {
      const token = await issueMailToken(created.user.id, "email_verify", EMAIL_CONFIRM_TTL);
      if (token) {
        const sent = await sendSiteMail(
          emailVerifyLetter({
            to: email,
            login,
            url: `${siteUrl()}/mail?k=verify&u=${encodeURIComponent(created.user.id)}&t=${encodeURIComponent(token)}`,
            locale: "ru",
          }),
        );
        mailed = sent.ok;
      }
    } catch (error) {
      console.error("Waitlist confirmation email failed", error);
    }
  }

  return NextResponse.json({
    ok: true,
    message: mailed
      ? "Анкета отправлена. Сохраните логин и пароль, а на почту пришло письмо — подтвердите адрес, чтобы можно было восстановить пароль. Нет письма — проверьте папку «Спам»."
      : "Анкета отправлена. Сохраните логин и пароль — они понадобятся после одобрения.",
  });
}
