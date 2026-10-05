import { NextResponse } from "next/server";
import { getViewerIdentity, sameOriginOrMissing } from "@/lib/waitlist";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { readLooks } from "@/lib/player-looks";
import {
  earlyAccessFor,
  earlyAudiences,
  plusState,
  plusTenureMonths,
  PlusPerkError,
  PLUS_ONLY_MESSAGE,
  HYPE_ONLY_MESSAGE,
  readPlusProfile,
  savePlusProfile,
} from "@/lib/plus-perks";
import { EARLY_FEATURES, isPlusRing, isPlusTheme, LOOKS_LIMIT, looksLimitFor } from "@/lib/plus-style";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const PRIVATE = { "Cache-Control": "private, no-store" };
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: PRIVATE });

/* «Настройки профиля → Оформление PLUS»: всё, что даёт подписка, по тарифам. */
export async function GET() {
  const identity = await getViewerIdentity();
  if (!identity || identity.needsMfa) return reply({ error: "Войдите в аккаунт.", loginRequired: true }, 401);
  const userId = identity.user.id;
  const isAdmin = Boolean(identity.adminProfile);
  try {
    const [plus, tenure, profile, audiences, open] = await Promise.all([
      plusState(userId),
      plusTenureMonths(userId),
      readPlusProfile(userId),
      earlyAudiences(),
      earlyAccessFor({ userId, isAdmin }),
    ]);
    let pinnedPost: { id: number; title: string } | null = null;
    if (profile.pinnedPostId) {
      const { data } = await createSupabaseAdminClient().from("pc_feed_posts").select("id,title").eq("id", profile.pinnedPostId).maybeSingle();
      if (data) pinnedPost = { id: Number(data.id), title: String(data.title) };
    }
    const ownPosts = plus.hype
      ? await createSupabaseAdminClient().from("pc_feed_posts").select("id,title").eq("author_id", userId).order("id", { ascending: false }).limit(100)
      : { data: [], error: null };
    return reply({
      plus,
      tenure,
      ring: profile.ring,
      theme: profile.theme,
      pinnedPost,
      ownPosts: ownPosts.error ? null : (ownPosts.data ?? []).map(post => ({ id: Number(post.id), title: String(post.title) })),
      /* Кадры сохранены; показываются они только с HYPE. */
      animatedHeader: profile.headerFrames.length > 0,
      pinnedSaved: Boolean(profile.pinnedPostId),
      looks: { used: readLooks(identity.user.user_metadata).length, limit: plus.active ? looksLimitFor(plus.tier) : LOOKS_LIMIT },
      tier: plus.tier,
      hype: plus.hype,
      early: EARLY_FEATURES.map((feature) => ({ ...feature, audience: audiences[feature.key], open: open.includes(feature.key) })),
    });
  } catch (error) {
    console.error("PLUS studio load failed", error);
    return reply({ error: "Не удалось загрузить оформление PLUS." }, 500);
  }
}

/* Сохранить цвет обводки и тему карточки или открепить пост. */
export async function PUT(request: Request) {
  if (!sameOriginOrMissing(request)) return reply({ error: "Запрос отклонён." }, 403);
  const identity = await getViewerIdentity();
  if (!identity || identity.needsMfa) return reply({ error: "Войдите в аккаунт.", loginRequired: true }, 401);
  const body = await request.json().catch(() => null) as { ring?: unknown; theme?: unknown; unpin?: unknown } | null;
  const rawRing = body?.ring;
  const rawTheme = body?.theme;
  if ((rawRing !== undefined && !isPlusRing(rawRing)) || (rawTheme !== undefined && !isPlusTheme(rawTheme))) {
    return reply({ error: "Такого оформления нет." }, 400);
  }
  const ring = isPlusRing(rawRing) ? rawRing : undefined;
  const theme = isPlusTheme(rawTheme) ? rawTheme : undefined;
  try {
    if (body?.unpin === true) {
      await savePlusProfile(identity.user.id, { pinnedPostId: null });
      return reply({ ok: true });
    }
    if (ring === undefined && theme === undefined) return reply({ error: "Нечего сохранять." }, 400);
    const state = await plusState(identity.user.id);
    if (!state.active) return reply({ error: PLUS_ONLY_MESSAGE, plusRequired: true }, 403);
    /* Радужная обводка — возможность HYPE. */
    if (ring === "rainbow" && !state.hype) return reply({ error: HYPE_ONLY_MESSAGE, plusRequired: true }, 403);
    await savePlusProfile(identity.user.id, { ring, theme });
    return reply({ ok: true });
  } catch (error) {
    if (error instanceof PlusPerkError) return reply({ error: error.message, plusRequired: error.plusRequired }, error.status);
    console.error("PLUS studio save failed", error);
    return reply({ error: "Не удалось сохранить оформление." }, 500);
  }
}
