import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { asTier, type PlusTier } from "@/lib/plus-style";

/* Торжественное окно про подписку.

   Когда PLUS или HYPE достаётся игроку не за его собственную оплату —
   подарил друг или выдала команда, — сайт ставит запись в очередь. При
   следующем заходе игрок один раз видит окно с поздравлением и коротким
   гидом по тому тарифу, который ему достался. Записи не удаляются:
   показанные помечаются seen_at. */

export type CelebrationKind = "gift" | "admin";

export type PlusCelebration = {
  id: number;
  kind: CelebrationKind;
  from: string | null;
  months: number;
  until: string | null;
  tier: PlusTier;
};

const db = () => createSupabaseAdminClient();

export async function queueCelebration(
  userId: string,
  input: { kind: CelebrationKind; from?: string | null; months?: number; until?: string | null; tier?: PlusTier },
) {
  /* Поздравление — приятная мелочь: сбой очереди не должен ронять оплату. */
  try {
    const { error } = await db().from("pc_plus_celebrations").insert({
      user_id: userId,
      kind: input.kind,
      from_login: input.from ? String(input.from).slice(0, 24) : null,
      months: Math.min(24, Math.max(1, Math.round(input.months ?? 1))),
      until: input.until ?? null,
      tier: asTier(input.tier),
    });
    if (error) throw error;
  } catch (error) {
    console.error("PLUS celebration queue failed", error instanceof Error ? error.message : error);
  }
}

export async function pendingCelebration(userId: string): Promise<PlusCelebration | null> {
  const { data, error } = await db()
    .from("pc_plus_celebrations")
    .select("id,kind,from_login,months,until,tier")
    .eq("user_id", userId)
    .is("seen_at", null)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    id: Number(data.id),
    kind: data.kind === "gift" ? "gift" : "admin",
    from: data.from_login ? String(data.from_login) : null,
    months: Number(data.months) || 1,
    until: data.until ? String(data.until) : null,
    tier: asTier(data.tier),
  };
}

/* Окно показано — больше не всплывает. Помечаем по владельцу записи, чтобы
   чужой идентификатор ничего не закрыл. */
export async function markCelebrationSeen(userId: string, id: number) {
  const { error } = await db()
    .from("pc_plus_celebrations")
    .update({ seen_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", userId)
    .is("seen_at", null);
  if (error) throw error;
}
