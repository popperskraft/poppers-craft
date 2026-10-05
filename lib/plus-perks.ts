import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { parseHeaderFrames } from "@/lib/player-marks";
import type { PixelHeaderArt } from "@/lib/profile-header-art";
import { yookassaTestMode } from "@/lib/yookassa";
import {
  DEFAULT_FRAME_MS,
  DEFAULT_RING,
  DEFAULT_THEME,
  EARLY_FEATURES,
  isPlusRing,
  isPlusSticker,
  isPlusTheme,
  type PlusTier,
  PLUS_STICKERS,
  type EarlyAudience,
  type EarlyFeatureKey,
  type PlusRing,
  type PlusSticker,
  type PlusTheme,
  type StickerCount,
  type StickerTarget,
} from "@/lib/plus-style";

/* Возможности подписчиков: оформление профиля, стикеры и стаж — с любой
   подпиской; закреплённый пост, радужная обводка, живая шапка и ранний
   доступ — с HYPE. Только внешний вид — в игре подписка ничего не даёт.
   Настройки хранятся и после окончания подписки, но действуют, только
   пока нужный тариф активен. */

const db = () => createSupabaseAdminClient();

export class PlusPerkError extends Error {
  status: number;
  plusRequired: boolean;
  constructor(message: string, status = 400, plusRequired = false) {
    super(message);
    this.status = status;
    this.plusRequired = plusRequired;
  }
}

export const PLUS_ONLY_MESSAGE = "Это возможность подписки. Оформить её можно в «Профиль → Подписка».";
export const HYPE_ONLY_MESSAGE = "Это возможность тарифа HYPE. Перейти на него можно в «Профиль → Подписка».";

export async function plusState(userId: string) {
  const { data, error } = await db().from("pc_plus_subscriptions").select("current_period_end,hype_until").eq("user_id", userId).maybeSingle();
  if (error) throw error;
  const until = data?.current_period_end ? String(data.current_period_end) : null;
  const active = Boolean(until && Date.parse(until) > Date.now());
  /* Время подписки — сначала отрезок HYPE, потом PLUS (lib/payments.ts). */
  const hypeUntil = data?.hype_until ? String(data.hype_until) : null;
  const hype = active && Boolean(hypeUntil && Date.parse(hypeUntil) > Date.now());
  const tier: PlusTier = hype ? "hype" : "plus";
  return { active, until, hypeUntil: hype ? hypeUntil : null, tier, hype };
}

export async function requirePlus(userId: string) {
  if (!(await plusState(userId)).active) throw new PlusPerkError(PLUS_ONLY_MESSAGE, 403, true);
}

/* Возможности тарифа HYPE: живая шапка, радужная обводка, закреплённый пост. */
export async function requireHype(userId: string) {
  const state = await plusState(userId);
  if (!state.active) throw new PlusPerkError(PLUS_ONLY_MESSAGE, 403, true);
  if (!state.hype) throw new PlusPerkError(HYPE_ONLY_MESSAGE, 403, true);
}

/* ---- оформление -------------------------------------------------------- */

export type PlusProfile = {
  ring: PlusRing;
  theme: PlusTheme;
  pinnedPostId: number | null;
  headerFrames: PixelHeaderArt[];
  headerFrameMs: number;
};

const DEFAULT_PROFILE: PlusProfile = { ring: DEFAULT_RING, theme: DEFAULT_THEME, pinnedPostId: null, headerFrames: [], headerFrameMs: DEFAULT_FRAME_MS };

export async function readPlusProfile(userId: string): Promise<PlusProfile> {
  const { data, error } = await db().from("pc_plus_profile").select("*").eq("user_id", userId).maybeSingle();
  if (error) {
    console.error("PLUS profile read failed", error.message);
    return DEFAULT_PROFILE;
  }
  if (!data) return DEFAULT_PROFILE;
  return {
    ring: isPlusRing(data.ring) ? data.ring : DEFAULT_RING,
    theme: isPlusTheme(data.card_theme) ? data.card_theme : DEFAULT_THEME,
    pinnedPostId: data.pinned_post_id === null ? null : Number(data.pinned_post_id),
    headerFrames: parseHeaderFrames(data.header_frames),
    headerFrameMs: Number(data.header_frame_ms) || DEFAULT_FRAME_MS,
  };
}

export async function savePlusProfile(userId: string, patch: {
  ring?: PlusRing;
  theme?: PlusTheme;
  pinnedPostId?: number | null;
  headerFrames?: PixelHeaderArt[];
  headerFrameMs?: number;
}) {
  const row: Record<string, unknown> = { user_id: userId, updated_at: new Date().toISOString() };
  if (patch.ring !== undefined) row.ring = patch.ring;
  if (patch.theme !== undefined) row.card_theme = patch.theme;
  if (patch.pinnedPostId !== undefined) row.pinned_post_id = patch.pinnedPostId;
  if (patch.headerFrames !== undefined) row.header_frames = patch.headerFrames;
  if (patch.headerFrameMs !== undefined) row.header_frame_ms = Math.min(1500, Math.max(120, Math.round(patch.headerFrameMs)));
  const { error } = await db().from("pc_plus_profile").upsert(row, { onConflict: "user_id" });
  if (error) throw error;
}

/* ---- закреплённый пост ------------------------------------------------- */

export type PinnedPost = { id: number; title: string; body: string; imageUrl: string | null; mediaKind: "image" | "video" | null; createdAt: string };

export async function togglePinnedPost(userId: string, postId: number) {
  /* Закреплённый пост — возможность HYPE. */
  await requireHype(userId);
  const { data: post, error } = await db().from("pc_feed_posts").select("author_id").eq("id", postId).maybeSingle();
  if (error) throw error;
  if (!post) throw new PlusPerkError("Пост не найден.", 404);
  if (post.author_id !== userId) throw new PlusPerkError("Закрепить можно только свой пост.", 403);
  const current = await readPlusProfile(userId);
  const pinned = current.pinnedPostId !== postId;
  await savePlusProfile(userId, { pinnedPostId: pinned ? postId : null });
  return { pinned };
}

/* ---- стикеры ------------------------------------------------------------ */

export type StickerSummary = { counts: StickerCount[]; mine: PlusSticker | null };

export async function stickerSummaries(kind: StickerTarget, targetIds: number[], viewerId: string | null): Promise<Map<number, StickerSummary>> {
  const result = new Map<number, StickerSummary>();
  const ids = [...new Set(targetIds.filter(Number.isSafeInteger))];
  if (!ids.length) return result;
  const { data, error } = await db().from("pc_sticker_reactions")
    .select("target_id,user_id,sticker")
    .eq("target_kind", kind)
    .in("target_id", ids.slice(0, 500))
    .limit(10_000);
  if (error) {
    console.error("Sticker lookup failed", error.message);
    return result;
  }
  const order = new Map(PLUS_STICKERS.map((sticker, index) => [sticker.id as string, index]));
  for (const id of ids) {
    const rows = (data ?? []).filter((row) => Number(row.target_id) === id && isPlusSticker(row.sticker));
    const counts = new Map<PlusSticker, number>();
    for (const row of rows) counts.set(row.sticker as PlusSticker, (counts.get(row.sticker as PlusSticker) ?? 0) + 1);
    const mine = rows.find((row) => row.user_id === viewerId)?.sticker;
    result.set(id, {
      counts: [...counts].map(([sticker, count]) => ({ sticker, count }))
        .sort((left, right) => right.count - left.count || (order.get(left.sticker) ?? 0) - (order.get(right.sticker) ?? 0)),
      mine: isPlusSticker(mine) ? mine : null,
    });
  }
  return result;
}

/* Тот же стикер ещё раз — убрать, другой — заменить. Убрать можно и без PLUS. */
export async function toggleSticker(userId: string, kind: StickerTarget, targetId: number, sticker: PlusSticker) {
  const { data: current, error } = await db().from("pc_sticker_reactions")
    .select("sticker")
    .eq("target_kind", kind).eq("target_id", targetId).eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (current?.sticker === sticker) {
    const { error: removeError } = await db().from("pc_sticker_reactions")
      .delete()
      .eq("target_kind", kind).eq("target_id", targetId).eq("user_id", userId);
    if (removeError) throw removeError;
    return { sticker: null };
  }
  await requirePlus(userId);
  await ensureStickerTarget(kind, targetId);
  const { error: saveError } = await db().from("pc_sticker_reactions").upsert(
    { target_kind: kind, target_id: targetId, user_id: userId, sticker, created_at: new Date().toISOString() },
    { onConflict: "target_kind,target_id,user_id" },
  );
  if (saveError) throw saveError;
  return { sticker };
}

async function ensureStickerTarget(kind: StickerTarget, targetId: number) {
  const query = kind === "feed_post"
    ? db().from("pc_feed_posts").select("id").eq("id", targetId)
    : db().from("site_updates").select("id").eq("id", targetId).like("source_key", "__wiki_article__:%").eq("published", false);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  if (!data) throw new PlusPerkError("Запись не найдена.", 404);
}

/* ---- стаж ---------------------------------------------------------------- */

/* Месяцы с подпиской: своя оплата или подарок друга — месяц (годовая
   оплата — 12), каждый подаренный администрацией год — 12, ручная выдача —
   столько, на сколько выдана (если её не сняли). В тестовом магазине
   считаются и тестовые платежи, иначе — только настоящие. */
export async function plusTenureMonths(userId: string) {
  const tests = yookassaTestMode() ? [true, false] : [false];
  const [payments, early, grants] = await Promise.all([
    db().from("pc_payments")
      .select("plan")
      .eq("kind", "plus")
      .eq("status", "succeeded")
      .not("applied_at", "is", null)
      .in("test", tests)
      .or(`and(user_id.eq.${userId},recipient_id.is.null),recipient_id.eq.${userId}`)
      .limit(1_000),
    db().from("pc_early_players").select("plus_gifts").eq("user_id", userId).maybeSingle(),
    db().from("pc_plus_admin_grants").select("months").eq("user_id", userId).is("revoked_at", null).limit(1_000),
  ]);
  if (payments.error) console.error("PLUS tenure lookup failed", payments.error.message);
  if (early.error) console.error("PLUS gift tenure lookup failed", early.error.message);
  if (grants.error) console.error("PLUS grant tenure lookup failed", grants.error.message);
  const paid = (payments.data ?? []).reduce((sum, row) => sum + (row.plan === "year" ? 12 : 1), 0);
  const granted = (grants.data ?? []).reduce((sum, row) => sum + (Number(row.months) || 0), 0);
  return paid + granted + 12 * Number(early.data?.plus_gifts ?? 0);
}

/* ---- ранний доступ -------------------------------------------------------- */

const AUDIENCES: EarlyAudience[] = ["admins", "plus", "all"];

export async function earlyAudiences(): Promise<Record<EarlyFeatureKey, EarlyAudience>> {
  const audiences = Object.fromEntries(EARLY_FEATURES.map((feature) => [feature.key, "plus"])) as Record<EarlyFeatureKey, EarlyAudience>;
  const { data, error } = await db().from("pc_early_features").select("key,audience");
  if (error) {
    console.error("Early features read failed", error.message);
    return audiences;
  }
  for (const row of data ?? []) {
    if (row.key in audiences && AUDIENCES.includes(row.audience as EarlyAudience)) {
      audiences[row.key as EarlyFeatureKey] = row.audience as EarlyAudience;
    }
  }
  return audiences;
}

/* Какие новые функции уже открыты этому зрителю. */
export async function earlyAccessFor(viewer: { userId: string | null; isAdmin: boolean }): Promise<EarlyFeatureKey[]> {
  const audiences = await earlyAudiences();
  const needsPlus = EARLY_FEATURES.some((feature) => audiences[feature.key] === "plus");
  /* Ранний доступ входит в HYPE. */
  const plus = !viewer.isAdmin && needsPlus && viewer.userId ? (await plusState(viewer.userId).catch(() => ({ hype: false }))).hype : false;
  return EARLY_FEATURES
    .filter((feature) => {
      const audience = audiences[feature.key];
      return viewer.isAdmin || audience === "all" || (audience === "plus" && plus);
    })
    .map((feature) => feature.key);
}

export async function setEarlyAudience(key: string, audience: string, by: string) {
  if (!EARLY_FEATURES.some((feature) => feature.key === key)) throw new PlusPerkError("Такой функции нет.", 404);
  if (!AUDIENCES.includes(audience as EarlyAudience)) throw new PlusPerkError("Выберите, кому открыть функцию.", 400);
  const { error } = await db().from("pc_early_features").upsert(
    { key, audience, updated_at: new Date().toISOString(), updated_by: by.slice(0, 60) },
    { onConflict: "key" },
  );
  if (error) throw error;
}
