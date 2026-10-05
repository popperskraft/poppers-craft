import { NextResponse } from "next/server";
import {
  getAdminUser,
  isProtectedAdminEmail,
  listAdmins,
  sameOriginOrMissing,
} from "@/lib/waitlist";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export async function GET() {
  if (!(await getAdminUser())) {
    return NextResponse.json({ error: "Нет доступа." }, { status: 403 });
  }
  return NextResponse.json({ admins: await listAdmins() });
}

export async function POST(request: Request) {
  const owner = await getAdminUser();
  if (
    !owner ||
    owner.profile.role !== "owner" ||
    !sameOriginOrMissing(request)
  ) {
    return NextResponse.json({ error: "Только владелец может добавлять админов." }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const email = String(body?.email ?? "").trim().toLowerCase();
  const displayName = String(body?.displayName ?? "").trim();
  const password = String(body?.password ?? "");
  if (isProtectedAdminEmail(email)) {
    return NextResponse.json(
      { error: "Защищённый аккаунт владельца нельзя заменить или перенастроить." },
      { status: 403 },
    );
  }
  if (
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    displayName.length < 2 ||
    displayName.length > 80 ||
    password.length < 8 ||
    password.length > 128
  ) {
    return NextResponse.json(
      { error: "Укажите имя, корректную почту и пароль от 8 символов." },
      { status: 400 },
    );
  }

  const client = createSupabaseAdminClient();
  const { data: existingProfile } = await client
    .from("admin_profiles")
    .select("id,role")
    .eq("email", email)
    .maybeSingle();
  if (existingProfile?.role === "owner") {
    return NextResponse.json(
      { error: "Профиль владельца нельзя заменить администратором." },
      { status: 400 },
    );
  }

  const { data: authUsers, error: authUsersError } =
    await client.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (authUsersError) {
    return NextResponse.json(
      { error: "Не удалось проверить аккаунт администратора." },
      { status: 500 },
    );
  }

  let authUser = authUsers.users.find(
    (candidate) => candidate.email?.toLowerCase() === email,
  );
  let createdUserId: string | null = null;
  if (authUser) {
    const { data: updated, error: updateError } =
      await client.auth.admin.updateUserById(authUser.id, {
        password,
        email_confirm: true,
        user_metadata: {
          ...authUser.user_metadata,
          display_name: displayName,
        },
      });
    if (updateError || !updated.user) {
      return NextResponse.json(
        { error: "Не удалось задать пароль администратора." },
        { status: 500 },
      );
    }
    authUser = updated.user;
  } else {
    const { data: created, error: createError } =
      await client.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { display_name: displayName },
      });
    if (createError || !created.user) {
      return NextResponse.json(
        { error: "Не удалось создать аккаунт администратора." },
        { status: 500 },
      );
    }
    authUser = created.user;
    createdUserId = created.user.id;
  }

  const { data, error } = await client
    .from("admin_profiles")
    .upsert(
      {
        user_id: authUser.id,
        email,
        display_name: displayName,
        role: "admin",
        active: true,
        created_by: owner.profile.id,
      },
      { onConflict: "email" },
    )
    .select("id,user_id,email,display_name,role,active,created_at")
    .single();
  if (error) {
    if (createdUserId) {
      await client.auth.admin.deleteUser(createdUserId);
    }
    return NextResponse.json(
      { error: "Не удалось добавить администратора." },
      { status: 500 },
    );
  }

  return NextResponse.json({ admin: data });
}

export async function PUT(request: Request) {
  const owner = await getAdminUser();
  if (!owner || owner.profile.role !== "owner" || !sameOriginOrMissing(request)) {
    return NextResponse.json({ error: "Только владелец может назначать админов." }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const applicationId = Number(body?.applicationId);
  if (!Number.isSafeInteger(applicationId)) {
    return NextResponse.json({ error: "Игрок не найден." }, { status: 400 });
  }

  const client = createSupabaseAdminClient();
  const { data: application, error: applicationError } = await client
    .from("waitlist_applications")
    .select("id,user_id,login,who,status,is_banned,is_deleted")
    .eq("id", applicationId)
    .maybeSingle();
  if (
    applicationError ||
    !application?.user_id ||
    application.status !== "approved" ||
    application.is_banned ||
    application.is_deleted
  ) {
    return NextResponse.json({ error: "Назначить можно только активного игрока." }, { status: 404 });
  }

  const [{ data: authData, error: authError }, { data: memberProfile }] = await Promise.all([
    client.auth.admin.getUserById(application.user_id),
    client.from("pc_member_profiles").select("display_name").eq("user_id", application.user_id).maybeSingle(),
  ]);
  const authUser = authData?.user;
  const email = authUser?.email?.trim().toLowerCase();
  if (authError || !authUser || !email) {
    return NextResponse.json({ error: "Не удалось проверить аккаунт игрока." }, { status: 500 });
  }

  const displayName = String(memberProfile?.display_name || application.who || application.login).slice(0, 80);
  const { data: existingByUserId, error: existingByUserIdError } = await client
    .from("admin_profiles")
    .select("id,role")
    .eq("user_id", application.user_id)
    .maybeSingle();
  if (existingByUserIdError) {
    return NextResponse.json({ error: "Не удалось проверить права игрока." }, { status: 500 });
  }

  let existing = existingByUserId;
  if (!existing) {
    const { data: existingByEmail, error: existingByEmailError } = await client
      .from("admin_profiles")
      .select("id,role")
      .eq("email", email)
      .maybeSingle();
    if (existingByEmailError) {
      return NextResponse.json({ error: "Не удалось проверить права игрока." }, { status: 500 });
    }
    existing = existingByEmail;
  }
  if (existing?.role === "owner") {
    return NextResponse.json({ error: "Этот аккаунт уже является владельцем." }, { status: 409 });
  }

  const query = existing
    ? client.from("admin_profiles").update({
        user_id: application.user_id,
        email,
        display_name: displayName,
        role: "admin",
        active: true,
      }).eq("id", existing.id)
    : client.from("admin_profiles").insert({
        user_id: application.user_id,
        email,
        display_name: displayName,
        role: "admin",
        active: true,
        created_by: owner.profile.id,
      });
  const { data, error } = await query
    .select("id,user_id,email,display_name,role,active,created_at")
    .single();
  if (error || !data) {
    return NextResponse.json({ error: "Не удалось назначить администратора." }, { status: 500 });
  }

  return NextResponse.json({ admin: { ...data, is_protected: isProtectedAdminEmail(data.email) } });
}

export async function PATCH(request: Request) {
  const owner = await getAdminUser();
  if (
    !owner ||
    owner.profile.role !== "owner" ||
    !sameOriginOrMissing(request)
  ) {
    return NextResponse.json({ error: "Только владелец может менять админов." }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const id = Number(body?.id);
  const active = Boolean(body?.active);
  if (!Number.isInteger(id) || id === owner.profile.id) {
    return NextResponse.json(
      { error: "Нельзя отключить собственный профиль." },
      { status: 400 },
    );
  }

  const client = createSupabaseAdminClient();
  const { data: target, error: targetError } = await client
    .from("admin_profiles")
    .select("id,email,role")
    .eq("id", id)
    .maybeSingle();
  if (targetError) {
    return NextResponse.json({ error: "Не удалось проверить профиль." }, { status: 500 });
  }
  if (!target) {
    return NextResponse.json({ error: "Профиль администратора не найден." }, { status: 404 });
  }
  if (target.role === "owner" || isProtectedAdminEmail(target.email)) {
    return NextResponse.json(
      { error: "Защищённый профиль владельца нельзя отключить." },
      { status: 403 },
    );
  }

  const { data, error } = await client
    .from("admin_profiles")
    .update({ active })
    .eq("id", id)
    .eq("role", "admin")
    .select("id")
    .maybeSingle();
  if (error || !data) {
    return NextResponse.json(
      { error: "Профиль администратора не найден." },
      { status: error ? 500 : 404 },
    );
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const owner = await getAdminUser();
  if (!owner || owner.profile.role !== "owner" || !sameOriginOrMissing(request)) {
    return NextResponse.json({ error: "Только владелец может удалять админов." }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const id = Number(body?.id);
  if (!Number.isInteger(id) || id === owner.profile.id) {
    return NextResponse.json({ error: "Нельзя удалить собственный доступ." }, { status: 400 });
  }

  const client = createSupabaseAdminClient();
  const { data: target, error: targetError } = await client
    .from("admin_profiles")
    .select("id,email,display_name,role")
    .eq("id", id)
    .maybeSingle();
  if (targetError || !target) {
    return NextResponse.json({ error: "Администратор не найден." }, { status: targetError ? 500 : 404 });
  }
  if (target.role === "owner" || isProtectedAdminEmail(target.email)) {
    return NextResponse.json({ error: "Этот аккаунт защищён от удаления." }, { status: 403 });
  }

  const { data: revoked, error } = await client
    .from("admin_profiles")
    .update({ active: false })
    .eq("id", target.id)
    .eq("role", "admin")
    .select("id")
    .maybeSingle();
  if (error || !revoked) {
    return NextResponse.json({ error: "Не удалось отозвать доступ администратора." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, id: target.id, displayName: target.display_name });
}
