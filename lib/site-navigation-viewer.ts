import "server-only";

import type { NavViewer } from "@/lib/site-navigation";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { ViewerIdentity } from "@/lib/waitlist";
import { whitelistToVote } from "@/lib/whitelist-to-vote";

/* Кто смотрит страницу — для пунктов общей шапки. Вход уже проверен в
   layout; здесь один короткий запрос о статусе анкеты. */
export async function navViewerFor(identity: ViewerIdentity | null): Promise<NavViewer> {
  if (!identity) return { authenticated: false, approved: false, admin: false };
  if (identity.needsMfa) return { authenticated: true, needsMfa: true, approved: false, admin: false };
  const { data } = await createSupabaseAdminClient()
    .from("waitlist_applications")
    .select("status,is_banned,is_deleted")
    .eq("user_id", identity.user.id)
    .maybeSingle();
  const approved = data?.status === "approved" && !data.is_banned && !data.is_deleted;
  const admin = Boolean(identity.adminProfile);
  /* Игрокам и администраторам — сколько анкет ждут их голоса. Сбой
     подсчёта не должен ломать шапку. */
  const toVote = approved || admin ? await whitelistToVote(identity.user.id).catch(() => null) : null;
  return {
    authenticated: true,
    approved,
    admin,
    ...(toVote?.count ? { whitelistToVote: toVote.count, whitelistLatestId: toVote.latestId } : {}),
  };
}
