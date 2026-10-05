import { NextResponse } from "next/server";
import {
  getAdminUser,
  isProtectedOwnerUserId,
  listModerationProposals,
  sameOriginOrMissing,
  type AdminVote,
  type ModerationAction,
} from "@/lib/waitlist";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { permanentlyDeletePlayerAccount } from "@/lib/player-account-deletion";

export async function GET() {
  const admin = await getAdminUser();
  if (!admin) {
    return NextResponse.json({ error: "Нет доступа." }, { status: 403 });
  }
  return NextResponse.json({
    proposals: await listModerationProposals(admin.profile.id),
  });
}

async function reconcileProposal(proposalId: number) {
  const client = createSupabaseAdminClient();
  const [{ data: proposal, error }, { data: votes, error: votesError }] =
    await Promise.all([
      client
        .from("moderation_proposals")
        .select("id,application_id,action,reason,status")
        .eq("id", proposalId)
        .maybeSingle(),
      client
        .from("moderation_votes")
        .select("vote")
        .eq("proposal_id", proposalId),
    ]);
  if (error || votesError || !proposal) throw error ?? votesError ?? new Error();

  const approvals = (votes ?? []).filter((vote) => vote.vote === "approve").length;
  const rejections = (votes ?? []).filter((vote) => vote.vote === "reject").length;
  const { data: application, error: applicationError } = await client
    .from("waitlist_applications")
    .select("id,user_id")
    .eq("id", proposal.application_id)
    .maybeSingle();
  if (applicationError || !application) throw applicationError ?? new Error();

  if (await isProtectedOwnerUserId(application.user_id)) {
    if (proposal.status === "pending") {
      const { error: protectError } = await client
        .from("moderation_proposals")
        .update({ status: "rejected", resolved_at: new Date().toISOString() })
        .eq("id", proposalId)
        .eq("status", "pending");
      if (protectError) throw protectError;
    }
    return { status: "rejected", approvals, rejections };
  }

  if (proposal.status !== "pending") {
    return { status: proposal.status, approvals, rejections };
  }

  if (rejections >= 2) {
    const { error: rejectError } = await client
      .from("moderation_proposals")
      .update({ status: "rejected", resolved_at: new Date().toISOString() })
      .eq("id", proposalId)
      .eq("status", "pending");
    if (rejectError) throw rejectError;
    return { status: "rejected", approvals, rejections };
  }

  if (approvals < 2 || rejections > 1) {
    return { status: "pending", approvals, rejections };
  }

  const { data: claimed, error: claimError } = await client
    .from("moderation_proposals")
    .update({ status: "executed", resolved_at: new Date().toISOString() })
    .eq("id", proposalId)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();
  if (claimError) throw claimError;
  if (!claimed) return { status: "executed", approvals, rejections };

  if (proposal.action === "ban") {
    const { error: banError } = await client
      .from("waitlist_applications")
      .update({
        is_banned: true,
        ban_reason: proposal.reason,
        banned_at: new Date().toISOString(),
        status: "rejected",
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", application.id);
    if (banError) throw banError;
  } else {
    try {
      await permanentlyDeletePlayerAccount({ applicationId: application.id, userId: application.user_id });
    } catch (error) {
      await client
        .from("moderation_proposals")
        .update({ status: "pending", resolved_at: null })
        .eq("id", proposalId);
      throw error;
    }
  }

  return { status: "executed", approvals, rejections };
}

export async function POST(request: Request) {
  const admin = await getAdminUser();
  if (!admin || !sameOriginOrMissing(request)) {
    return NextResponse.json({ error: "Нет доступа." }, { status: 403 });
  }
  const body = await request.json().catch(() => null);
  const applicationId = Number(body?.applicationId);
  const action = String(body?.action ?? "") as ModerationAction;
  const reason = String(body?.reason ?? "").trim();
  if (
    !Number.isInteger(applicationId) ||
    !["ban", "delete"].includes(action) ||
    reason.length < 3 ||
    reason.length > 500
  ) {
    return NextResponse.json(
      { error: "Укажите действие и причину." },
      { status: 400 },
    );
  }

  const client = createSupabaseAdminClient();
  const { data: application } = await client
    .from("waitlist_applications")
    .select("id,user_id,is_deleted")
    .eq("id", applicationId)
    .maybeSingle();
  if (!application || application.is_deleted) {
    return NextResponse.json({ error: "Пользователь не найден." }, { status: 404 });
  }
  if (await isProtectedOwnerUserId(application.user_id)) {
    return NextResponse.json(
      { error: "Аккаунт владельца защищён от бана и удаления." },
      { status: 403 },
    );
  }

  let { data: proposal, error } = await client
    .from("moderation_proposals")
    .select("id")
    .eq("application_id", applicationId)
    .eq("action", action)
    .eq("status", "pending")
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: "Не удалось проверить решение." }, { status: 500 });
  }

  if (!proposal) {
    const created = await client
      .from("moderation_proposals")
      .insert({
        application_id: applicationId,
        action,
        reason,
        created_by: admin.profile.id,
      })
      .select("id")
      .single();
    proposal = created.data;
    error = created.error;
  }
  if (error || !proposal) {
    return NextResponse.json({ error: "Не удалось создать голосование." }, { status: 500 });
  }

  const { error: voteError } = await client.from("moderation_votes").upsert(
    {
      proposal_id: proposal.id,
      admin_id: admin.profile.id,
      vote: "approve",
      updated_at: new Date().toISOString(),
    },
    { onConflict: "proposal_id,admin_id" },
  );
  if (voteError) {
    return NextResponse.json({ error: "Не удалось сохранить голос." }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    proposalId: proposal.id,
    ...(await reconcileProposal(proposal.id)),
  });
}

export async function PATCH(request: Request) {
  const admin = await getAdminUser();
  if (!admin || !sameOriginOrMissing(request)) {
    return NextResponse.json({ error: "Нет доступа." }, { status: 403 });
  }
  const body = await request.json().catch(() => null);
  const proposalId = Number(body?.proposalId);
  const vote = String(body?.vote ?? "") as AdminVote | "clear";
  if (
    !Number.isInteger(proposalId) ||
    !["approve", "reject", "clear"].includes(vote)
  ) {
    return NextResponse.json({ error: "Некорректный голос." }, { status: 400 });
  }

  const client = createSupabaseAdminClient();
  const { data: proposalTarget, error: proposalTargetError } = await client
    .from("moderation_proposals")
    .select("application_id")
    .eq("id", proposalId)
    .maybeSingle();
  if (proposalTargetError || !proposalTarget) {
    return NextResponse.json(
      { error: "Решение не найдено." },
      { status: proposalTargetError ? 500 : 404 },
    );
  }
  const { data: targetApplication, error: targetApplicationError } = await client
    .from("waitlist_applications")
    .select("user_id")
    .eq("id", proposalTarget.application_id)
    .maybeSingle();
  if (targetApplicationError || !targetApplication) {
    return NextResponse.json(
      { error: "Пользователь не найден." },
      { status: targetApplicationError ? 500 : 404 },
    );
  }
  if (await isProtectedOwnerUserId(targetApplication.user_id)) {
    return NextResponse.json(
      { error: "Голосование против владельца запрещено." },
      { status: 403 },
    );
  }
  const result =
    vote === "clear"
      ? await client
          .from("moderation_votes")
          .delete()
          .eq("proposal_id", proposalId)
          .eq("admin_id", admin.profile.id)
      : await client.from("moderation_votes").upsert(
          {
            proposal_id: proposalId,
            admin_id: admin.profile.id,
            vote,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "proposal_id,admin_id" },
        );
  if (result.error) {
    return NextResponse.json({ error: "Не удалось сохранить голос." }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    ...(await reconcileProposal(proposalId)),
    my_vote: vote === "clear" ? null : vote,
  });
}
