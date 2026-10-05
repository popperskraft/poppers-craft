import { NextResponse } from "next/server";
import {
  getAdminUser,
  isProtectedOwnerUserId,
  listApplications,
  sameOriginOrMissing,
  type AdminVote,
  type ApplicationStatus,
} from "@/lib/waitlist";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { permanentlyDeletePlayerAccount } from "@/lib/player-account-deletion";
import { hasServerAccess } from "@/lib/payments";

async function reconcileApplication(applicationId: number) {
  const admin = createSupabaseAdminClient();
  const { data: protectedTarget, error: protectedTargetError } = await admin
    .from("waitlist_applications")
    .select("user_id")
    .eq("id", applicationId)
    .maybeSingle();
  if (protectedTargetError || !protectedTarget) throw protectedTargetError ?? new Error();
  if (await isProtectedOwnerUserId(protectedTarget.user_id)) {
    const reviewedAt = new Date().toISOString();
    const { error: protectError } = await admin
      .from("waitlist_applications")
      .update({ status: "approved", reviewed_at: reviewedAt, is_banned: false, is_deleted: false })
      .eq("id", applicationId);
    if (protectError) throw protectError;
    return { status: "approved" as const, approvals: 2, rejections: 0 };
  }

  const { data: votes, error } = await admin
    .from("application_votes")
    .select("vote")
    .eq("application_id", applicationId);
  if (error) throw error;

  const approvals = (votes ?? []).filter((vote) => vote.vote === "approve").length;
  const rejections = (votes ?? []).filter((vote) => vote.vote === "reject").length;
  let status: ApplicationStatus = "pending";
  if (rejections >= 2) status = "rejected";
  else if (approvals >= 2 && rejections <= 1) status = "approved";

  const reviewedAt = status === "pending" ? null : new Date().toISOString();
  const { error: updateError } = await admin
    .from("waitlist_applications")
    .update({ status, reviewed_at: reviewedAt })
    .eq("id", applicationId)
    .eq("is_deleted", false);
  if (updateError) throw updateError;

  return { status, approvals, rejections };
}

export async function GET() {
  const admin = await getAdminUser();
  if (!admin) {
    return NextResponse.json({ error: "Нет доступа." }, { status: 403 });
  }
  return NextResponse.json({
    applications: await listApplications(admin.profile.id),
  });
}

export async function PATCH(request: Request) {
  const adminUser = await getAdminUser();
  if (!adminUser || !sameOriginOrMissing(request)) {
    return NextResponse.json({ error: "Нет доступа." }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const id = Number(body?.id);
  const action = String(body?.action ?? "");
  const vote = String(body?.vote ?? "") as AdminVote | "clear";
  if (Number.isInteger(id) && action === "force_approve") {
    const { data, error } = await createSupabaseAdminClient()
      .from("waitlist_applications")
      .update({ status: "approved", reviewed_at: new Date().toISOString() })
      .eq("id", id)
      .eq("is_deleted", false)
      .select("id,user_id")
      .maybeSingle();
    if (error || !data) {
      return NextResponse.json({ error: "Не удалось принять игрока сразу." }, { status: error ? 500 : 404 });
    }
    /* Кнопка заменяет только голосование: если пропуск обязателен, играть
       игрок сможет после его оплаты (решение владельца 2026-10-03). */
    const needsPass = data.user_id ? !(await hasServerAccess(String(data.user_id))) : false;
    return NextResponse.json({ ok: true, status: "approved", needsPass });
  }
  if (
    !Number.isInteger(id) ||
    !["approve", "reject", "clear"].includes(vote)
  ) {
    return NextResponse.json(
      { error: "Некорректные данные." },
      { status: 400 },
    );
  }

  const client = createSupabaseAdminClient();
  const { data: application, error: applicationError } = await client
    .from("waitlist_applications")
    .select("id,user_id,is_deleted")
    .eq("id", id)
    .maybeSingle();
  if (applicationError) {
    return NextResponse.json(
      { error: "Не удалось проверить анкету." },
      { status: 500 },
    );
  }
  if (!application || application.is_deleted) {
    return NextResponse.json({ error: "Анкета не найдена." }, { status: 404 });
  }
  if (await isProtectedOwnerUserId(application.user_id)) {
    return NextResponse.json(
      { error: "Аккаунт владельца не участвует в голосованиях." },
      { status: 403 },
    );
  }

  const result =
    vote === "clear"
      ? await client
          .from("application_votes")
          .delete()
          .eq("application_id", id)
          .eq("admin_id", adminUser.profile.id)
      : await client.from("application_votes").upsert(
          {
            application_id: id,
            admin_id: adminUser.profile.id,
            vote,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "application_id,admin_id" },
        );

  if (result.error) {
    return NextResponse.json(
      { error: "Не удалось сохранить голос." },
      { status: 500 },
    );
  }

  try {
    return NextResponse.json({
      ok: true,
      ...(await reconcileApplication(id)),
      my_vote: vote === "clear" ? null : vote,
    });
  } catch {
    return NextResponse.json(
      { error: "Голос сохранён, но статус не пересчитан." },
      { status: 500 },
    );
  }
}

export async function DELETE(request: Request) {
  const adminUser = await getAdminUser();
  if (!adminUser || !sameOriginOrMissing(request)) {
    return NextResponse.json({ error: "Нет доступа." }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const id = Number(body?.id);
  if (!Number.isSafeInteger(id)) {
    return NextResponse.json({ error: "Некорректная заявка." }, { status: 400 });
  }

  const client = createSupabaseAdminClient();
  const { data: application, error: applicationError } = await client
    .from("waitlist_applications")
    .select("id,user_id,login,status,is_deleted")
    .eq("id", id)
    .maybeSingle();
  if (applicationError) {
    return NextResponse.json({ error: "Не удалось проверить заявку." }, { status: 500 });
  }
  if (!application || application.is_deleted) {
    return NextResponse.json({ error: "Заявка уже удалена." }, { status: 404 });
  }
  if (application.status !== "pending") {
    return NextResponse.json({ error: "Этой кнопкой можно удалить только кандидата из текущего вайтлиста." }, { status: 409 });
  }
  if (await isProtectedOwnerUserId(application.user_id)) {
    return NextResponse.json({ error: "Аккаунт владельца защищён от удаления." }, { status: 403 });
  }

  try {
    await permanentlyDeletePlayerAccount({ applicationId: id, userId: application.user_id });
  } catch (error) {
    console.error("Failed to permanently delete a candidate", error);
    return NextResponse.json({ error: "Не удалось полностью удалить кандидата." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, id, login: application.login });
}
