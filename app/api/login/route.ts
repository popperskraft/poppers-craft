import { NextResponse } from "next/server";
import {
  isProtectedOwnerEmail,
  normalizeLogin,
  resolveLoginIdentifierToEmail,
  sameOriginOrMissing,
} from "@/lib/waitlist";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { CAPTCHA_COOKIE, verifyAndConsumeCaptcha } from "@/lib/captcha";
import { clientAddress, consumeRateLimit, rateLimitResponse } from "@/lib/request-security";
import { rememberDevice, sessionIdFromAccessToken } from "@/lib/session-devices";

export async function POST(request: Request) {
  if (!sameOriginOrMissing(request)) {
    return NextResponse.json({ error: "Запрос отклонён." }, { status: 403 });
  }
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > 16 * 1024) {
    return NextResponse.json({ error: "Запрос слишком большой." }, { status: 413 });
  }

  const body = await request.json().catch(() => null);
  const login = normalizeLogin(String(body?.login ?? ""));
  const password = String(body?.password ?? "");
  const clientLimit = await consumeRateLimit(request, { scope: "login-client", limit: 30, windowSeconds: 15 * 60 });
  if (!clientLimit.allowed) return rateLimitResponse(clientLimit, "Слишком много попыток входа. Подождите немного.");
  if (!(await verifyAndConsumeCaptcha(request, String(body?.captchaAnswer ?? "")))) {
    const response = NextResponse.json({ error: "Капча не пройдена или уже использована. Выберите новый блок." }, { status: 400 });
    response.cookies.delete(CAPTCHA_COOKIE);
    return response;
  }
  const [accountLimit, globalLimit] = await Promise.all([
    consumeRateLimit(request, { scope: "login-account", key: login || "empty", limit: 8, windowSeconds: 15 * 60 }),
    consumeRateLimit(request, { scope: "login-global", key: "global", limit: 1_000, windowSeconds: 60 * 60 }),
  ]);
  if (!accountLimit.allowed) return rateLimitResponse(accountLimit, "Слишком много попыток входа в этот аккаунт. Подождите немного.");
  if (!globalLimit.allowed) return rateLimitResponse(globalLimit, "Вход временно занят. Попробуйте позже.");
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: await resolveLoginIdentifierToEmail(login),
    password,
  });

  if (error || !data.user) {
    const response = NextResponse.json(
      { error: "Неверный логин или пароль." },
      { status: 401 },
    );
    response.cookies.delete(CAPTCHA_COOKIE);
    return response;
  }

  /* Устройство для «Профиль → Настройки → Активные устройства». Через этот
     же вход приходит лаунчер — его сайт узнаёт по подписи запроса. */
  await rememberDevice({
    sessionId: sessionIdFromAccessToken(data.session?.access_token, data.user.id),
    userId: data.user.id,
    userAgent: request.headers.get("user-agent") ?? "",
    ip: clientAddress(request),
  }).catch(() => undefined);

  const adminClient = createSupabaseAdminClient();
  const destinationWithMfa = async (destination: string) => {
    const { data: assurance } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    const needsMfa = assurance?.nextLevel === "aal2" && assurance.currentLevel !== "aal2";
    return needsMfa
      ? `/mfa?next=${encodeURIComponent(destination)}`
      : destination;
  };
  const email = data.user.email?.toLowerCase();
  if (isProtectedOwnerEmail(email)) {
    const { data: ownerProfile, error: ownerProfileError } = await adminClient
      .from("admin_profiles")
      .select("id,user_id,display_name")
      .eq("email", email)
      .maybeSingle();
    if (ownerProfileError || (ownerProfile?.user_id && ownerProfile.user_id !== data.user.id)) {
      await supabase.auth.signOut();
      return NextResponse.json({ error: "Защищённый профиль владельца требует проверки." }, { status: 403 });
    }
    const { error: repairError } = await adminClient
      .from("admin_profiles")
      .upsert(
        {
          ...(ownerProfile?.id ? { id: ownerProfile.id } : {}),
          user_id: data.user.id,
          email,
          display_name: ownerProfile?.display_name ?? String(data.user.user_metadata?.display_name ?? "Владелец"),
          role: "owner",
          active: true,
        },
        { onConflict: "email" },
      );
    if (repairError) {
      await supabase.auth.signOut();
      return NextResponse.json({ error: "Не удалось восстановить профиль владельца." }, { status: 500 });
    }
    return NextResponse.json({ ok: true, redirectTo: await destinationWithMfa("/admin") });
  }

  const { data: linkedAdminProfile } = await adminClient
    .from("admin_profiles")
    .select("id,user_id")
    .eq("user_id", data.user.id)
    .eq("active", true)
    .maybeSingle();
  const { data: emailAdminProfile } = !linkedAdminProfile && email
    ? await adminClient
        .from("admin_profiles")
        .select("id,user_id")
        .eq("email", email)
        .eq("active", true)
        .maybeSingle()
    : { data: null };
  const adminProfile = linkedAdminProfile ?? emailAdminProfile;
  /* Профиль администратора по одной почте не привязывается (r105): почта
     аккаунта не доказывает владение ящиком. */
  if (adminProfile && adminProfile.user_id === data.user.id) {
    return NextResponse.json({ ok: true, redirectTo: await destinationWithMfa("/admin") });
  }

  const { data: application, error: applicationError } =
    await adminClient
      .from("waitlist_applications")
      .select("status,is_banned,is_deleted")
      .eq("user_id", data.user.id)
      .maybeSingle();

  if (applicationError || !application) {
    await supabase.auth.signOut();
    return NextResponse.json(
      { error: "Заявка для этого аккаунта не найдена." },
      { status: 403 },
    );
  }
  if (application.is_banned) {
    await supabase.auth.signOut();
    return NextResponse.json(
      { error: "Аккаунт заблокирован администрацией.", status: "banned" },
      { status: 403 },
    );
  }
  if (application.is_deleted) {
    await supabase.auth.signOut();
    return NextResponse.json(
      { error: "Аккаунт удалён.", status: "deleted" },
      { status: 403 },
    );
  }
  if (application.status === "pending") {
    await supabase.auth.signOut();
    return NextResponse.json(
      { error: "Анкета ещё на рассмотрении.", status: "pending" },
      { status: 403 },
    );
  }
  if (application.status === "rejected") {
    await supabase.auth.signOut();
    return NextResponse.json(
      {
        error: "Анкета не одобрена. Если есть вопросы — напишите в поддержку: @PoppersCraftAuthBot в Telegram.",
        status: "rejected",
      },
      { status: 403 },
    );
  }
  return NextResponse.json({ ok: true, redirectTo: await destinationWithMfa("/members") });
}
