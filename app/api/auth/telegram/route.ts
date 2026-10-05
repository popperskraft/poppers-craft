import { cookies } from "next/headers";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getViewerIdentity, sameOriginOrMissing } from "@/lib/waitlist";
import { consumeRateLimit, rateLimitResponse } from "@/lib/request-security";

const telegramJwks = createRemoteJWKSet(new URL("https://oauth.telegram.org/.well-known/jwks.json"));

function sameTelegramAccount(
  metadata: Record<string, unknown> | undefined,
  telegramSub: string,
  telegramId: string | null,
) {
  if (!metadata) return false;
  const storedSub = typeof metadata.telegram_sub === "string" ? metadata.telegram_sub : "";
  const storedId = typeof metadata.telegram_id === "string" ? metadata.telegram_id : "";
  return storedSub === telegramSub || Boolean(telegramId && (storedId === telegramId || storedSub === telegramId));
}

export async function POST(request: Request) {
  if (!sameOriginOrMissing(request)) return NextResponse.json({ error: "Запрос отклонён." }, { status: 403 });
  const clientLimit = await consumeRateLimit(request, { scope: "telegram-auth-client", limit: 20, windowSeconds: 15 * 60 });
  if (!clientLimit.allowed) return rateLimitResponse(clientLimit, "Слишком много попыток входа через Telegram.");

  const clientId = process.env.TELEGRAM_CLIENT_ID ?? process.env.NEXT_PUBLIC_TELEGRAM_CLIENT_ID;
  if (!clientId) return NextResponse.json({ error: "Telegram Login ещё не настроен владельцем." }, { status: 503 });

  const body = await request.json().catch(() => null);
  const idToken = typeof body?.idToken === "string" ? body.idToken : "";
  const mode = body?.mode === "link" ? "link" : "login";
  const cookieStore = await cookies();
  const expectedNonce = cookieStore.get("telegram_login_nonce")?.value;

  if (!idToken || !expectedNonce) {
    return NextResponse.json({ error: "Сеанс Telegram устарел. Попробуйте ещё раз." }, { status: 401 });
  }

  let telegramSub = "";
  let telegramId: string | null = null;
  try {
    const { payload } = await jwtVerify(idToken, telegramJwks, {
      algorithms: ["RS256"],
      issuer: "https://oauth.telegram.org",
      audience: clientId,
      maxTokenAge: "5m",
      clockTolerance: 5,
    });
    if (typeof payload.sub !== "string" || payload.nonce !== expectedNonce) throw new Error("Invalid Telegram claims");
    telegramSub = payload.sub;
    if (typeof payload.id === "number" || typeof payload.id === "string") telegramId = String(payload.id);
  } catch {
    return NextResponse.json({ error: "Telegram не подтвердил подлинность входа." }, { status: 401 });
  }
  const globalLimit = await consumeRateLimit(request, { scope: "telegram-auth-global", key: "global", limit: 500, windowSeconds: 60 * 60 });
  if (!globalLimit.allowed) return rateLimitResponse(globalLimit, "Вход через Telegram временно занят.");

  cookieStore.delete("telegram_login_nonce");
  const admin = createSupabaseAdminClient();
  const { data: usersData, error: usersError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (usersError) return NextResponse.json({ error: "Не удалось проверить аккаунты." }, { status: 500 });

  if (mode === "link") {
    const viewer = await getViewerIdentity();
    if (!viewer) return NextResponse.json({ error: "Сначала войдите обычным способом." }, { status: 401 });
    if (viewer.needsMfa) return NextResponse.json({ error: "Сначала подтвердите вход кодом 2FA." }, { status: 403 });

    const alreadyLinked = usersData.users.find(
      (candidate) => candidate.id !== viewer.user.id && sameTelegramAccount(candidate.app_metadata, telegramSub, telegramId),
    );
    if (alreadyLinked) return NextResponse.json({ error: "Этот Telegram уже привязан к другому аккаунту." }, { status: 409 });

    const { error } = await admin.auth.admin.updateUserById(viewer.user.id, {
      app_metadata: {
        ...viewer.user.app_metadata,
        telegram_sub: telegramSub,
        ...(telegramId ? { telegram_id: telegramId } : {}),
      },
    });
    if (error) return NextResponse.json({ error: "Не удалось привязать Telegram." }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  const user = usersData.users.find((candidate) => sameTelegramAccount(candidate.app_metadata, telegramSub, telegramId));
  if (!user?.email) {
    return NextResponse.json(
      { error: "Этот Telegram ещё не привязан. Войдите по паролю и привяжите его в профиле." },
      { status: 403 },
    );
  }

  const normalizedEmail = user.email.toLowerCase();
  const [{ data: activeAdmin }, { data: application, error: applicationError }] = await Promise.all([
    admin.from("admin_profiles").select("id,user_id").eq("email", normalizedEmail).eq("active", true).maybeSingle(),
    admin.from("waitlist_applications").select("status,is_banned,is_deleted").eq("user_id", user.id).maybeSingle(),
  ]);
  /* Только уже привязанный профиль администратора (r105). */
  const adminAllowed = Boolean(activeAdmin?.user_id === user.id);
  const memberAllowed = Boolean(application && application.status === "approved" && !application.is_banned && !application.is_deleted);
  if (applicationError || (!adminAllowed && !memberAllowed)) {
    return NextResponse.json({ error: "Этот аккаунт сейчас не имеет доступа к серверу." }, { status: 403 });
  }

  const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: "magiclink", email: user.email });
  const tokenHash = link?.properties?.hashed_token;
  if (linkError || !tokenHash) return NextResponse.json({ error: "Не удалось создать безопасный вход." }, { status: 500 });

  const supabase = await createSupabaseServerClient();
  const { error: verifyError } = await supabase.auth.verifyOtp({ type: "magiclink", token_hash: tokenHash });
  if (verifyError) return NextResponse.json({ error: "Не удалось завершить вход." }, { status: 500 });

  const destination = adminAllowed ? "/admin" : "/members";
  const { data: assurance } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  const needsMfa = assurance?.nextLevel === "aal2" && assurance.currentLevel !== "aal2";
  return NextResponse.json({ ok: true, redirectTo: needsMfa ? `/mfa?next=${encodeURIComponent(destination)}` : destination });
}

export async function DELETE(request: Request) {
  if (!sameOriginOrMissing(request)) {
    return NextResponse.json({ error: "Запрос отклонён." }, { status: 403 });
  }
  const viewer = await getViewerIdentity();
  if (!viewer) {
    return NextResponse.json({ error: "Сначала войдите в аккаунт." }, { status: 401 });
  }
  if (viewer.needsMfa) {
    return NextResponse.json({ error: "Сначала подтвердите вход кодом 2FA." }, { status: 403 });
  }

  const remainingMetadata = { ...(viewer.user.app_metadata ?? {}) };
  delete remainingMetadata.telegram_sub;
  delete remainingMetadata.telegram_id;
  const { error } = await createSupabaseAdminClient().auth.admin.updateUserById(
    viewer.user.id,
    { app_metadata: remainingMetadata },
  );
  if (error) {
    return NextResponse.json({ error: "Не удалось отвязать Telegram." }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
