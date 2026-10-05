import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/* Сколько анкет в вайтлисте ждут голоса игрока — для значка у пункта
   «Вайтлист» и полоски под шапкой. Голоса игроков лежат в site_updates
   с ключом __player_vote__:<анкета>:<игрок> (app/api/player-waitlist).
   Ответ хранится минуту на игрока, чтобы не спрашивать базу на каждой
   странице (лимиты Supabase); после голоса значение сбрасывается. */
export type WhitelistToVote = { count: number; latestId: number };

const TTL_MS = 60_000;
const cache = new Map<string, { value: WhitelistToVote; until: number }>();

export async function whitelistToVote(userId: string): Promise<WhitelistToVote> {
  const hit = cache.get(userId);
  if (hit && hit.until > Date.now()) return hit.value;
  const admin = createSupabaseAdminClient();
  const [pending, votes] = await Promise.all([
    admin.from("waitlist_applications").select("id,user_id").eq("status", "pending").eq("is_deleted", false),
    admin.from("site_updates").select("source_key").eq("published", false).like("source_key", `__player_vote__:%:${userId}`),
  ]);
  if (pending.error || votes.error) return { count: 0, latestId: 0 };
  const voted = new Set(
    (votes.data ?? [])
      .map((row) => String(row.source_key ?? ""))
      .filter((key) => key.startsWith("__player_vote__:") && key.endsWith(`:${userId}`))
      .map((key) => Number(key.split(":")[1])),
  );
  const waiting = (pending.data ?? [])
    .filter((row) => row.user_id !== userId && !voted.has(Number(row.id)))
    .map((row) => Number(row.id));
  const value = { count: waiting.length, latestId: waiting.length ? Math.max(...waiting) : 0 };
  if (cache.size > 2000) cache.clear();
  cache.set(userId, { value, until: Date.now() + TTL_MS });
  return value;
}

export function forgetWhitelistToVote(userId: string) {
  cache.delete(userId);
}
