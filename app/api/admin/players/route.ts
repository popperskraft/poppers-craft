import { NextResponse } from "next/server";
import { getAdminUser, isProtectedOwnerUserId, isValidLogin, loginToEmail, normalizeLogin, sameOriginOrMissing } from "@/lib/waitlist";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { permanentlyDeletePlayerAccount } from "@/lib/player-account-deletion";

export async function POST(request: Request) {
  const adminUser = await getAdminUser();
  if (!adminUser || !sameOriginOrMissing(request)) {
    return NextResponse.json({ error: "Нет доступа." }, { status: 403 });
  }
  const body = await request.json().catch(() => null);
  const login = normalizeLogin(String(body?.login ?? ""));
  const displayName = String(body?.displayName ?? "").trim();
  const password = String(body?.password ?? "");
  if (!isValidLogin(login) || displayName.length < 2 || displayName.length > 120 || password.length < 8 || password.length > 128) {
    return NextResponse.json({ error: "Укажите ник, имя и пароль от 8 символов." }, { status: 400 });
  }

  const client = createSupabaseAdminClient();
  const { data: existing, error: existingError } = await client
    .from("waitlist_applications")
    .select("id,user_id,is_deleted")
    .eq("login", login)
    .maybeSingle();
  if (existingError) return NextResponse.json({ error: "Не удалось проверить игровой ник." }, { status: 500 });
  if (existing && !existing.is_deleted) return NextResponse.json({ error: "Такой игрок уже существует." }, { status: 409 });
  if (existing) {
    try {
      await permanentlyDeletePlayerAccount({ applicationId: existing.id, userId: existing.user_id });
    } catch (error) {
      console.error("Failed to purge a previously deleted player", error);
      return NextResponse.json({ error: "Не удалось очистить ранее удалённый аккаунт. Повторите попытку." }, { status: 500 });
    }
  }

  const { data: created, error: authError } = await client.auth.admin.createUser({
    email: loginToEmail(login),
    password,
    email_confirm: true,
    user_metadata: { minecraft_login: login, display_name: displayName },
  });
  if (authError || !created.user) {
    return NextResponse.json({ error: "Не удалось создать аккаунт игрока." }, { status: 500 });
  }
  const { data: application, error } = await client.from("waitlist_applications").insert({
    user_id: created.user.id,
    login,
    who: displayName,
    from_where: "Добавлен администрацией",
    why_server: "Добавлен напрямую администрацией",
    why_you: `Добавил: ${adminUser.profile.display_name}`,
    status: "approved",
    reviewed_at: new Date().toISOString(),
  }).select("id").single();
  if (error) {
    await client.auth.admin.deleteUser(created.user.id);
    return NextResponse.json({ error: "Не удалось сохранить игрока." }, { status: 500 });
  }
  return NextResponse.json({ ok: true, application });
}

export async function PATCH(request: Request) {
  const adminUser = await getAdminUser();
  if (!adminUser || !sameOriginOrMissing(request)) {
    return NextResponse.json({ error: "Нет доступа." }, { status: 403 });
  }
  const body = await request.json().catch(() => null);
  const applicationId = Number(body?.applicationId);
  /* Скрыть игрока из общего списка игроков или вернуть его туда. */
  if (typeof body?.hidden === "boolean") {
    if (!Number.isSafeInteger(applicationId)) return NextResponse.json({ error: "Некорректная анкета." }, { status: 400 });
    const database = createSupabaseAdminClient();
    const { data: target } = await database.from("waitlist_applications").select("user_id").eq("id", applicationId).maybeSingle();
    if (!target?.user_id) return NextResponse.json({ error: "Игрок не найден." }, { status: 404 });
    const { error: hideError } = await database.from("pc_member_profiles")
      .update({ hidden_from_directory: body.hidden, updated_at: new Date().toISOString() })
      .eq("user_id", target.user_id);
    if (hideError) return NextResponse.json({ error: "Не удалось изменить видимость игрока." }, { status: 500 });
    return NextResponse.json({ ok: true, hidden: body.hidden });
  }
  const restoreSelf = body?.restoreSelf === true;
  const login = normalizeLogin(String(body?.login ?? ""));
  if ((!restoreSelf && !Number.isSafeInteger(applicationId)) || !isValidLogin(login)) {
    return NextResponse.json({ error: "Проверьте новый игровой ник." }, { status: 400 });
  }

  const client = createSupabaseAdminClient();
  let applicationQuery = client
    .from("waitlist_applications")
    .select("id,user_id,login,status,reviewed_at,is_banned,is_deleted,deleted_at");
  applicationQuery = restoreSelf
    ? applicationQuery.eq("user_id", adminUser.user.id)
    : applicationQuery.eq("id", applicationId);
  const { data: application, error: applicationError } = await applicationQuery.maybeSingle();
  if (!application && restoreSelf && !applicationError) {
    const [{ data: memberProfile, error: memberProfileError }, { data: authData, error: authReadError }] = await Promise.all([
      client.from("pc_member_profiles").select("login,display_name").eq("user_id", adminUser.user.id).maybeSingle(),
      client.auth.admin.getUserById(adminUser.user.id),
    ]);
    const authUser = authData?.user;
    if (memberProfileError || !memberProfile || authReadError || !authUser?.email) {
      return NextResponse.json({ error: "Не удалось найти данные игрового профиля." }, { status: 404 });
    }

    const [{ data: loginOwner }, { data: profileOwner }] = await Promise.all([
      client.from("waitlist_applications").select("user_id").eq("login", login).maybeSingle(),
      client.from("pc_member_profiles").select("user_id").eq("login", login).maybeSingle(),
    ]);
    if ((loginOwner && loginOwner.user_id !== adminUser.user.id) || (profileOwner && profileOwner.user_id !== adminUser.user.id)) {
      return NextResponse.json({ error: "Такой ник уже занят." }, { status: 409 });
    }

    const previousEmail = authUser.email;
    const previousMetadata = authUser.user_metadata ?? {};
    const previousProfileLogin = String(memberProfile.login ?? "");
    const usesSyntheticLoginEmail = authUser.email.endsWith("@users.popperscraft.org");
    const { error: authError } = await client.auth.admin.updateUserById(
      adminUser.user.id,
      usesSyntheticLoginEmail
        ? {
            email: loginToEmail(login),
            email_confirm: true,
            user_metadata: { ...previousMetadata, minecraft_login: login },
          }
        : { user_metadata: { ...previousMetadata, minecraft_login: login } },
    );
    if (authError) return NextResponse.json({ error: "Не удалось изменить адрес входа." }, { status: 500 });

    const { error: profileUpdateError } = await client
      .from("pc_member_profiles")
      .update({ login, updated_at: new Date().toISOString() })
      .eq("user_id", adminUser.user.id);
    if (profileUpdateError) {
      await client.auth.admin.updateUserById(
        adminUser.user.id,
        usesSyntheticLoginEmail
          ? { email: previousEmail, email_confirm: true, user_metadata: previousMetadata }
          : { user_metadata: previousMetadata },
      );
      return NextResponse.json({ error: "Не удалось изменить ник профиля." }, { status: 500 });
    }

    const { data: restoredApplication, error: restoreError } = await client.from("waitlist_applications").insert({
      user_id: adminUser.user.id,
      login,
      who: memberProfile.display_name || adminUser.profile.display_name,
      from_where: "Восстановлен из профиля администратора",
      why_server: "Восстановлен после неполного удаления аккаунта",
      why_you: "Автоматическое восстановление",
      status: "approved",
      reviewed_at: new Date().toISOString(),
      is_banned: false,
      is_deleted: false,
    }).select("id").single();
    if (restoreError) {
      await Promise.all([
        client.from("pc_member_profiles").update({ login: previousProfileLogin, updated_at: new Date().toISOString() }).eq("user_id", adminUser.user.id),
        client.auth.admin.updateUserById(
          adminUser.user.id,
          usesSyntheticLoginEmail
            ? { email: previousEmail, email_confirm: true, user_metadata: previousMetadata }
            : { user_metadata: previousMetadata },
        ),
      ]);
      return NextResponse.json({ error: "Не удалось восстановить игровую анкету." }, { status: 500 });
    }

    return NextResponse.json({ ok: true, login, application: restoredApplication });
  }
  if (applicationError || !application?.user_id) {
    return NextResponse.json({ error: "Игрок не найден." }, { status: 404 });
  }
  const isSelf = application.user_id === adminUser.user.id;
  if (adminUser.profile.role !== "owner" && !isSelf) {
    return NextResponse.json({ error: "Чужой ник может изменить только владелец." }, { status: 403 });
  }
  if (restoreSelf && !isSelf) {
    return NextResponse.json({ error: "Можно восстановить только свой аккаунт." }, { status: 403 });
  }
  if (application.is_deleted && !restoreSelf) {
    return NextResponse.json({ error: "Сначала восстановите удалённый аккаунт." }, { status: 409 });
  }
  if (application.login === login && !restoreSelf) return NextResponse.json({ ok: true, login });

  const [{ data: loginOwner }, { data: profileOwner }, { data: authData, error: authReadError }] = await Promise.all([
    client.from("waitlist_applications").select("user_id").eq("login", login).maybeSingle(),
    client.from("pc_member_profiles").select("user_id").eq("login", login).maybeSingle(),
    client.auth.admin.getUserById(application.user_id),
  ]);
  if ((loginOwner && loginOwner.user_id !== application.user_id) || (profileOwner && profileOwner.user_id !== application.user_id)) {
    return NextResponse.json({ error: "Такой ник уже занят." }, { status: 409 });
  }
  const authUser = authData?.user;
  if (authReadError || !authUser?.email) {
    return NextResponse.json({ error: "Не удалось проверить адрес входа игрока." }, { status: 500 });
  }
  const usesSyntheticLoginEmail = authUser.email.endsWith("@users.popperscraft.org");
  if (!usesSyntheticLoginEmail && !isSelf) {
    return NextResponse.json({ error: "Нельзя менять адрес входа этого игрока." }, { status: 409 });
  }

  const previousLogin = application.login;
  const previousEmail = authUser.email;
  const previousMetadata = authUser.user_metadata ?? {};
  const { error: authError } = await client.auth.admin.updateUserById(
    application.user_id,
    usesSyntheticLoginEmail
      ? {
          email: loginToEmail(login),
          email_confirm: true,
          user_metadata: { ...previousMetadata, minecraft_login: login },
        }
      : { user_metadata: { ...previousMetadata, minecraft_login: login } },
  );
  if (authError) return NextResponse.json({ error: "Не удалось изменить адрес входа." }, { status: 500 });

  const applicationPatch = restoreSelf
    ? {
        login,
        status: "approved" as const,
        reviewed_at: application.reviewed_at ?? new Date().toISOString(),
        is_banned: false,
        is_deleted: false,
        deleted_at: null,
      }
    : { login };
  const { error: applicationUpdateError } = await client.from("waitlist_applications").update(applicationPatch).eq("id", application.id);
  if (applicationUpdateError) {
    await client.auth.admin.updateUserById(
      application.user_id,
      usesSyntheticLoginEmail
        ? { email: previousEmail, email_confirm: true, user_metadata: previousMetadata }
        : { user_metadata: previousMetadata },
    );
    return NextResponse.json({ error: "Не удалось изменить ник в анкете." }, { status: 500 });
  }

  const { error: profileUpdateError } = await client.from("pc_member_profiles").update({ login, updated_at: new Date().toISOString() }).eq("user_id", application.user_id);
  if (profileUpdateError) {
    await Promise.all([
      client.from("waitlist_applications").update({
        login: previousLogin,
        status: application.status,
        reviewed_at: application.reviewed_at,
        is_banned: application.is_banned,
        is_deleted: application.is_deleted,
        deleted_at: application.deleted_at,
      }).eq("id", application.id),
      client.auth.admin.updateUserById(
        application.user_id,
        usesSyntheticLoginEmail
          ? { email: previousEmail, email_confirm: true, user_metadata: previousMetadata }
          : { user_metadata: previousMetadata },
      ),
    ]);
    return NextResponse.json({ error: "Не удалось изменить ник профиля." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, login });
}

export async function DELETE(request: Request) {
  const adminUser = await getAdminUser();
  if (!adminUser || !sameOriginOrMissing(request)) {
    return NextResponse.json({ error: "Нет доступа." }, { status: 403 });
  }
  const body = await request.json().catch(() => null);
  const applicationId = Number(body?.applicationId);
  if (!Number.isSafeInteger(applicationId)) {
    return NextResponse.json({ error: "Игрок не найден." }, { status: 400 });
  }

  const client = createSupabaseAdminClient();
  const { data: application, error: applicationError } = await client
    .from("waitlist_applications")
    .select("id,user_id,login,status,reviewed_at,is_banned,is_deleted,deleted_at")
    .eq("id", applicationId)
    .maybeSingle();
  if (applicationError || !application) {
    return NextResponse.json({ error: "Игрок не найден." }, { status: 404 });
  }
  if (application.status === "pending") {
    return NextResponse.json({ error: "Кандидатов удаляйте во вкладке анкет." }, { status: 409 });
  }
  if (await isProtectedOwnerUserId(application.user_id)) {
    return NextResponse.json({ error: "Аккаунт владельца защищён от удаления." }, { status: 403 });
  }

  try {
    await permanentlyDeletePlayerAccount({ applicationId, userId: application.user_id });
  } catch (error) {
    console.error("Failed to permanently delete a player", error);
    return NextResponse.json({ error: "Не удалось полностью удалить аккаунт игрока." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, applicationId, login: application.login });
}
