import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { siteUrl } from "@/lib/mail";
import { normalizeReferralCode, REFERRAL_REWARD_DAYS } from "@/lib/referral-code";

export class ReferralError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
    this.name = "ReferralError";
  }
}

export function referralInsertError(error: { message?: string }): string | null {
  if (error.message?.includes("referral-invalid")) return "Приглашение недоступно. Проверьте ссылку или уберите её из анкеты.";
  if (error.message?.includes("referral-self")) return "Нельзя пригласить самого себя.";
  if (error.message?.includes("referral-locked")) return "Приглашение уже сохранено и не может быть изменено.";
  return null;
}

/* Validate before creating an auth account; the INSERT trigger checks again
   and saves the attribution in the same transaction as the application. */
export async function validateReferral(value: unknown, inviteeUserId?: string) {
  const code = normalizeReferralCode(value);
  if (!code) throw new ReferralError("Введите реферальную ссылку или код приглашения.");
  const { data, error } = await createSupabaseAdminClient().rpc("pc_validate_referral", {
    p_code: code,
    p_invitee: inviteeUserId ?? null,
  });
  if (error) {
    const message = referralInsertError(error);
    if (message) throw new ReferralError(message);
    console.error("Referral validation failed", error.code);
    throw new ReferralError("Не удалось проверить приглашение. Попробуйте позже.", 503);
  }
  if (typeof data !== "string" || !data) {
    throw new ReferralError("Приглашение недоступно. Проверьте ссылку или уберите её из анкеты.");
  }
  return { code, inviterLogin: data };
}

export async function referralSummary(userId: string) {
  const admin = createSupabaseAdminClient();
  const { data: code, error } = await admin.rpc("pc_get_referral_code", { p_user: userId });
  if (error) throw error;
  const eligible = typeof code === "string" && Boolean(code);
  if (!eligible) return { eligible: false, code: null, url: null, invited: 0, rewarded: 0, rewardDays: REFERRAL_REWARD_DAYS };
  const [invited, rewarded] = await Promise.all([
    admin.from("pc_referrals").select("invitee_user_id", { count: "exact", head: true }).eq("inviter_user_id", userId),
    admin.from("pc_referrals").select("invitee_user_id", { count: "exact", head: true }).eq("inviter_user_id", userId).not("rewarded_at", "is", null),
  ]);
  if (invited.error) throw invited.error;
  if (rewarded.error) throw rewarded.error;
  return {
    eligible: true,
    code: String(code),
    url: `${siteUrl()}/?ref=${encodeURIComponent(String(code))}#waitlist`,
    invited: invited.count ?? 0,
    rewarded: rewarded.count ?? 0,
    rewardDays: REFERRAL_REWARD_DAYS,
  };
}
