import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/* Лайки на записях в «Обновлениях». Одна отметка от аккаунта: повторное
   нажатие её снимает. */

export type UpdateLikes = {
  counts: Record<number, number>;
  mine: number[];
};

export async function listUpdateLikes(userId?: string | null): Promise<UpdateLikes> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("site_update_likes")
    .select("update_id,user_id")
    .limit(20_000);
  if (error || !data) return { counts: {}, mine: [] };

  const counts: Record<number, number> = {};
  const mine: number[] = [];
  for (const row of data) {
    const id = Number(row.update_id);
    counts[id] = (counts[id] ?? 0) + 1;
    if (userId && row.user_id === userId) mine.push(id);
  }
  return { counts, mine };
}

export async function toggleUpdateLike(updateId: number, userId: string) {
  const admin = createSupabaseAdminClient();
  const { data: existing, error: readError } = await admin
    .from("site_update_likes")
    .select("update_id")
    .eq("update_id", updateId)
    .eq("user_id", userId)
    .maybeSingle();
  if (readError) throw readError;

  if (existing) {
    const { error } = await admin
      .from("site_update_likes")
      .delete()
      .eq("update_id", updateId)
      .eq("user_id", userId);
    if (error) throw error;
  } else {
    const { error } = await admin
      .from("site_update_likes")
      .insert({ update_id: updateId, user_id: userId });
    /* Двойное нажатие подряд не должно превращаться в ошибку. */
    if (error && !/duplicate|unique/i.test(error.message)) throw error;
  }

  const { count } = await admin
    .from("site_update_likes")
    .select("update_id", { count: "exact", head: true })
    .eq("update_id", updateId);

  return { liked: !existing, count: count ?? 0 };
}
