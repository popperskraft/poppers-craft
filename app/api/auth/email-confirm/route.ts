import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { normalizeEmail, sameOriginOrMissing } from "@/lib/waitlist";
import { consumeRateLimit, rateLimitResponse } from "@/lib/request-security";
import { clearMailToken, consumeMailToken } from "@/lib/mail-tokens";
import { revokeAllAiTokens } from "@/lib/ai-connect/oauth";

function isEmailConflict(error: { code?: string; message?: string; status?: number } | null) {
  const code = String(error?.code ?? "").toLowerCase();
  const message = String(error?.message ?? "").toLowerCase();
  return code === "email_exists"
    || error?.status === 422
    || /already|registered|exists|duplicate|unique|email address.*used/.test(message);
}

function isProtectedAdminProfileError(error: { code?: string; message?: string } | null) {
  return error?.code === "42501" || /owner is protected/i.test(String(error?.message ?? ""));
}

/* Подтверждение приходит POST-запросом со страницы /mail, а не переходом по
   ссылке: почтовые антивирусы открывают ссылки сами и сожгли бы токен. */
export async function POST(request: Request) {
  if (!sameOriginOrMissing(request)) {
    return NextResponse.json({ error: "Запрос отклонён." }, { status: 403 });
  }
  const clientLimit = await consumeRateLimit(request, {
    scope: "email-confirm",
    limit: 30,
    windowSeconds: 60 * 60,
  });
  if (!clientLimit.allowed) {
    return rateLimitResponse(clientLimit, "Слишком много попыток. Попробуйте позже.");
  }

  const body = await request.json().catch(() => null);
  const userId = String(body?.u ?? "");
  const token = String(body?.t ?? "");

  /* Снятие 2FA по ссылке из письма: пароль уже проверен, когда письмо
     отправляли (app/api/profile/mfa/disable), ссылка — второе подтверждение. */
  if (String(body?.k ?? "") === "mfa") {
    const checked = await consumeMailToken(userId, "mfa_reset", token);
    if (!checked.ok) {
      return NextResponse.json({
        error: checked.reason === "expired"
          ? "Срок действия ссылки истёк. Запросите письмо заново на странице входа."
          : "Ссылка недействительна или уже использована.",
      }, { status: 400 });
    }
    const admin = createSupabaseAdminClient();
    const { data: factorData, error: listError } = await admin.auth.admin.mfa.listFactors({ userId: checked.user.id });
    if (listError) return NextResponse.json({ error: "Не удалось получить список аутентификаторов." }, { status: 500 });
    const results = await Promise.all(
      factorData.factors.map((factor) => admin.auth.admin.mfa.deleteFactor({ id: factor.id, userId: checked.user.id })),
    );
    if (results.some((result) => result.error)) {
      return NextResponse.json({ error: "Не все аутентификаторы удалось отключить. Откройте ссылку ещё раз." }, { status: 500 });
    }
    await clearMailToken(checked.user.id, "mfa_reset");
    /* Без 2FA прежние подключения нейросетей не остаются в силе. */
    await revokeAllAiTokens(checked.user.id).catch(() => undefined);
    return NextResponse.json({ ok: true, message: "2FA отключена. Войдите заново и, если нужно, подключите новый аутентификатор в профиле." });
  }

  const kind = String(body?.k ?? "") === "change" ? "email_change" : "email_verify";

  const checked = await consumeMailToken(userId, kind, token);
  if (!checked.ok) {
    return NextResponse.json(
      {
        error: checked.reason === "expired"
          ? "Срок действия ссылки истёк. Запросите письмо заново."
          : "Ссылка недействительна или уже использована.",
      },
      { status: 400 },
    );
  }

  const now = new Date().toISOString();
  if (kind === "email_verify") {
    await clearMailToken(checked.user.id, "email_verify", { email_verified_at: now });
    return NextResponse.json({ ok: true, message: "Почта подтверждена. Спасибо!" });
  }

  const email = normalizeEmail(checked.email ?? "");
  if (!email) {
    await clearMailToken(checked.user.id, "email_change");
    return NextResponse.json({ error: "Ссылка недействительна. Запросите письмо заново." }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();
  const { data: adminProfile } = await admin
    .from("admin_profiles")
    .select("id,email")
    .eq("user_id", checked.user.id)
    .maybeSingle();

  /* За сутки, пока письмо лежало в ящике, адрес мог занять другой аккаунт. */
  const [{ data: users, error: usersError }, { data: conflictingAdmin, error: adminConflictError }] = await Promise.all([
    admin.auth.admin.listUsers({ page: 1, perPage: 1_000 }),
    adminProfile
      ? admin.from("admin_profiles").select("id").eq("email", email).neq("id", adminProfile.id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (usersError || adminConflictError) {
    return NextResponse.json({ error: "База временно недоступна. Попробуйте позже." }, { status: 503 });
  }
  const emailOwner = users.users.find((user) => normalizeEmail(user.email ?? "") === email);
  if ((emailOwner && emailOwner.id !== checked.user.id) || conflictingAdmin) {
    await clearMailToken(checked.user.id, "email_change");
    return NextResponse.json({ error: "Эта почта уже используется другим аккаунтом." }, { status: 409 });
  }

  const currentEmail = normalizeEmail(checked.user.email ?? "");
  const { error: updateError } = await admin.auth.admin.updateUserById(checked.user.id, {
    email,
    email_confirm: true,
  });
  if (updateError) {
    const duplicate = isEmailConflict(updateError);
    console.error("email change apply failed", { code: updateError.code, status: updateError.status });
    return NextResponse.json(
      {
        error: duplicate
          ? "Эта почта уже используется другим аккаунтом."
          : "Не удалось изменить почту. Попробуйте ещё раз.",
      },
      { status: duplicate ? 409 : 500 },
    );
  }

  if (adminProfile && adminProfile.email !== email) {
    const { error: adminProfileError } = await admin
      .from("admin_profiles")
      .update({ email })
      .eq("id", adminProfile.id)
      .eq("user_id", checked.user.id);
    if (adminProfileError && !isProtectedAdminProfileError(adminProfileError)) {
      const { error: rollbackError } = await admin.auth.admin.updateUserById(checked.user.id, {
        email: currentEmail,
        email_confirm: true,
      });
      console.error("admin email profile sync failed", {
        code: adminProfileError.code,
        rollbackFailed: Boolean(rollbackError),
      });
      return NextResponse.json(
        { error: "Не удалось обновить почту администратора. Изменение отменено." },
        { status: 500 },
      );
    }
    if (adminProfileError) {
      console.warn("protected admin email kept in admin_profiles; access remains linked by user id");
    }
  }

  await clearMailToken(checked.user.id, "email_change", { email_verified_at: now });

  return NextResponse.json({
    ok: true,
    message: "Почта изменена и подтверждена. Теперь можно входить по новому адресу или игровому нику.",
  });
}
