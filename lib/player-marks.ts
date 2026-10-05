import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { parsePixelHeaderArt, type PixelHeaderArt } from "@/lib/profile-header-art";
import { DEFAULT_FRAME_MS, DEFAULT_RING, MAX_HEADER_FRAMES_HYPE, hasHypeFeature, isPlusRing, type PlusRing, type PlusTier } from "@/lib/plus-style";

/* Отметки игроков на сайте: обводка подписчика (цвет выбирает сам игрок,
   тариф — по отрезку HYPE в подписке), кадры анимированной шапки и статус
   «Первооткрыватель»
   (lib/payments.ts, таблица pc_early_players). Это украшение: если база
   не ответила, страница показывается без них. */

export type PlayerMarks = {
  plus: boolean;
  pioneer: boolean;
  /* Тариф подписки: обводка HYPE светится ярче, радужная — только у него. */
  tier: PlusTier;
  ring: PlusRing;
  /* Кадры 2–8 анимированной шапки — только у HYPE, если просили frames. */
  headerFrames: PixelHeaderArt[];
  headerFrameMs: number;
};

const NO_MARKS: PlayerMarks = { plus: false, pioneer: false, tier: "plus", ring: DEFAULT_RING, headerFrames: [], headerFrameMs: DEFAULT_FRAME_MS };

/* Длинный список id не влезает в адрес запроса — тогда берём всех
   подписчиков и первооткрывателей сразу: их немного. */
const MAX_FILTERED_IDS = 100;

export function parseHeaderFrames(value: unknown): PixelHeaderArt[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, MAX_HEADER_FRAMES_HYPE - 1).flatMap((frame) => {
    const art = parsePixelHeaderArt(frame);
    return art ? [art] : [];
  });
}

export async function playerMarks(userIds: string[], options: { frames?: boolean } = {}): Promise<Map<string, PlayerMarks>> {
  const ids = [...new Set(userIds.filter(Boolean))];
  const marks = new Map<string, PlayerMarks>();
  if (!ids.length) return marks;
  const db = createSupabaseAdminClient();
  const filtered = ids.length <= MAX_FILTERED_IDS;
  const plusQuery = db.from("pc_plus_subscriptions").select("user_id,hype_until").gt("current_period_end", new Date().toISOString());
  const pioneerQuery = db.from("pc_early_players").select("user_id").eq("kind", "pioneer").is("released_at", null);
  const [subscriptions, pioneers] = await Promise.all([
    (filtered ? plusQuery.in("user_id", ids) : plusQuery).limit(10_000),
    (filtered ? pioneerQuery.in("user_id", ids) : pioneerQuery).limit(10_000),
  ]);
  if (subscriptions.error) console.error("PLUS marks lookup failed", subscriptions.error.message);
  if (pioneers.error) console.error("Pioneer marks lookup failed", pioneers.error.message);
  const requested = new Set(ids);
  const plusRows = ((subscriptions.data ?? []) as Array<{ user_id: unknown; hype_until?: unknown }>).filter((row) => requested.has(String(row.user_id)));
  const plus = new Set(plusRows.map((row) => String(row.user_id)));
  /* Тариф нужен для радужной обводки и живой шапки — они только у HYPE.
     HYPE идёт, пока не кончился его отрезок подписки (hype_until). */
  const tiers = new Map(plusRows.map((row): [string, PlusTier] => [
    String(row.user_id),
    row.hype_until && Date.parse(String(row.hype_until)) > Date.now() ? "hype" : "plus",
  ]));
  const pioneer = new Set((pioneers.data ?? []).map((row) => String(row.user_id)));

  /* Оформление нужно только подписчикам — их обычно единицы. */
  const styles = new Map<string, { ring: PlusRing; headerFrames: PixelHeaderArt[]; headerFrameMs: number }>();
  if (plus.size) {
    const { data, error } = await db.from("pc_plus_profile")
      .select(options.frames ? "user_id,ring,header_frames,header_frame_ms" : "user_id,ring")
      .in("user_id", [...plus].slice(0, 500));
    if (error) console.error("PLUS style lookup failed", error.message);
    for (const row of (data ?? []) as unknown as Array<{ user_id: string; ring: unknown; header_frames?: unknown; header_frame_ms?: unknown }>) {
      styles.set(String(row.user_id), {
        ring: isPlusRing(row.ring) ? row.ring : DEFAULT_RING,
        headerFrames: options.frames ? parseHeaderFrames(row.header_frames) : [],
        headerFrameMs: Number(row.header_frame_ms) || DEFAULT_FRAME_MS,
      });
    }
  }

  for (const id of ids) {
    const style = plus.has(id) ? styles.get(id) : undefined;
    const tier = tiers.get(id) ?? "plus";
    const hype = plus.has(id) && hasHypeFeature(tier);
    /* Радужная обводка и живая шапка сохраняются, но работают только с HYPE. */
    const ring = style?.ring ?? DEFAULT_RING;
    marks.set(id, {
      plus: plus.has(id),
      pioneer: pioneer.has(id),
      tier,
      ring: ring === "rainbow" && !hype ? DEFAULT_RING : ring,
      headerFrames: hype ? style?.headerFrames ?? [] : [],
      headerFrameMs: style?.headerFrameMs ?? DEFAULT_FRAME_MS,
    });
  }
  return marks;
}

export async function marksFor(userId: string, options: { frames?: boolean } = {}) {
  return (await playerMarks([userId], options)).get(userId) ?? NO_MARKS;
}
