import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { canFullyEditCommunityProfile, getCommunityViewer } from "@/lib/community";
import { HEADER_FLAG_VALUES, normalizeHeaderFlag } from "@/lib/header-flags";
import { hasPixelHeaderArt, parsePixelHeaderArt } from "@/lib/profile-header-art";
import { canUseCosmetic } from "@/lib/payments";
import { plusState, readPlusProfile, savePlusProfile } from "@/lib/plus-perks";
import { DEFAULT_FRAME_MS, headerFramesFor, MAX_HEADER_FRAMES_HYPE } from "@/lib/plus-style";
import type { PixelHeaderArt } from "@/lib/profile-header-art";
import { collectSocialLinks, socialLinksError } from "@/lib/social-links";
import { getViewerIdentity, isValidLogin, loginToEmail, normalizeLogin, sameOriginOrMissing } from "@/lib/waitlist";

/* Кадры 2–8 анимированной шапки приходят из формы строкой JSON;
   null — строку не удалось разобрать. */
function parseHeaderFramesInput(value: unknown): PixelHeaderArt[] | null {
  if (value === undefined || value === null || value === "") return [];
  let raw = value;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(raw)) return null;
  /* Кадров сверх лимита тарифа не берём: у HYPE их вдвое больше. */
  const frames = raw.slice(0, MAX_HEADER_FRAMES_HYPE - 1).map((frame) => parsePixelHeaderArt(frame));
  return frames.some((frame) => !frame) ? null : frames as PixelHeaderArt[];
}

export async function PATCH(request: Request) {
  if (!sameOriginOrMissing(request)) return NextResponse.json({ error: "Недопустимый запрос." }, { status: 403 });
  const identity = await getViewerIdentity();
  const viewer = identity
    ? await getCommunityViewer({ identity, allowAuthenticated: true })
    : null;
  if (!viewer) return NextResponse.json({ error: "Войдите в аккаунт." }, { status: 401 });
  const input = await request.json();
  const canEditLogin = canFullyEditCommunityProfile(viewer);
  const login = canEditLogin ? normalizeLogin(String(input.login ?? viewer.profile.login)) : viewer.profile.login;
  const displayName = String(input.displayName ?? "").trim();
  const bio = String(input.bio ?? "").trim();
  const favoriteMusic = String(input.favoriteMusic ?? "").trim();
  const favoriteMovies = String(input.favoriteMovies ?? "").trim();
  const socialLinks = collectSocialLinks(input);
  const contactError = socialLinksError(socialLinks, viewer.profile.social_links);
  if (contactError) return NextResponse.json({ error: contactError }, { status: 400 });
  const headerColor = String(input.headerColor ?? "");
  const rawHeaderFlag = String(input.headerFlag ?? "none");
  const headerFlag = normalizeHeaderFlag(rawHeaderFlag);
  const headerArt = parsePixelHeaderArt(input.headerArt);
  const hidePrideFlags = input.hidePrideFlags === true;
  if (!isValidLogin(login) || displayName.length < 2 || displayName.length > 80 || bio.length > 1200 || favoriteMusic.length > 500 || favoriteMovies.length > 500 || socialLinks.length > 1000 || !/^#[0-9a-f]{6}$/i.test(headerColor) || !HEADER_FLAG_VALUES.has(rawHeaderFlag) || !headerArt) {
    return NextResponse.json({ error: "Проверьте длину полей и оформление профиля." }, { status: 400 });
  }
  /* Новая пиксельная шапка — косметика подписки (когда владелец включил ограничение). */
  const previousArt = parsePixelHeaderArt(viewer.user.user_metadata?.profile_header_art);
  const artChanged = JSON.stringify(headerArt) !== JSON.stringify(previousArt);
  if (artChanged && hasPixelHeaderArt(headerArt) && !(await canUseCosmetic(viewer.user.id, "header_art"))) {
    return NextResponse.json({ error: "Своя пиксельная шапка доступна с подпиской PLUS или HYPE. Остальные поля можно сохранить, если очистить рисунок.", plusRequired: true }, { status: 403 });
  }
  /* Остальные кадры шапки — анимация, возможность HYPE. Без HYPE редактор
     их не показывает и присылает пустой список: сохранённые раньше кадры
     при этом не трогаем — они вернутся вместе с HYPE. */
  const headerFrames = parseHeaderFramesInput(input.headerFrames);
  if (headerFrames === null) return NextResponse.json({ error: "Кадры шапки не сохранились. Попробуйте ещё раз." }, { status: 400 });
  const headerFrameMs = Number(input.headerFrameMs) || DEFAULT_FRAME_MS;
  const previousFrames = (await readPlusProfile(viewer.user.id)).headerFrames;
  let framesChanged = JSON.stringify(headerFrames) !== JSON.stringify(previousFrames);
  if (framesChanged) {
    const state = await plusState(viewer.user.id);
    if (!state.hype) {
      if (headerFrames.length) {
        return NextResponse.json({ error: "Анимированная шапка входит в тариф HYPE.", plusRequired: true }, { status: 403 });
      }
      framesChanged = false;
    } else {
      /* Лишние кадры просто не сохраняем. */
      headerFrames.length = Math.min(headerFrames.length, headerFramesFor(state.tier) - 1);
    }
  }
  const admin = createSupabaseAdminClient();
  const previousLogin = viewer.profile.login;
  if (login !== previousLogin) {
    const [{ data: profileOwner }, { data: applicationOwner }] = await Promise.all([
      admin.from("pc_member_profiles").select("user_id").eq("login", login).maybeSingle(),
      admin.from("waitlist_applications").select("user_id").eq("login", login).maybeSingle(),
    ]);
    if ((profileOwner && profileOwner.user_id !== viewer.user.id) || (applicationOwner && applicationOwner.user_id !== viewer.user.id)) {
      return NextResponse.json({ error: "Такой ник уже занят." }, { status: 409 });
    }
  }
  const legacyHeaderFlag = headerFlag === "rainbow" || headerFlag === "transgender" ? headerFlag : "none";
  const { error } = await admin.from("pc_member_profiles").update({ login, display_name: displayName, bio, favorite_music: favoriteMusic, favorite_movies: favoriteMovies, social_links: socialLinks, header_color: headerColor, header_flag: legacyHeaderFlag, updated_at: new Date().toISOString() }).eq("user_id", viewer.user.id);
  if (error) return NextResponse.json({ error: "Не удалось сохранить профиль." }, { status: 500 });
  if (login !== previousLogin) {
    const { error: applicationError } = await admin.from("waitlist_applications").update({ login }).eq("user_id", viewer.user.id);
    if (applicationError) {
      await admin.from("pc_member_profiles").update({ login: previousLogin }).eq("user_id", viewer.user.id);
      return NextResponse.json({ error: "Не удалось изменить ник в анкете." }, { status: 500 });
    }
  }
  const generatedEmail = viewer.user.email?.endsWith("@users.popperscraft.org");
  const { error: metadataError } = await admin.auth.admin.updateUserById(viewer.user.id, {
    ...(login !== previousLogin && generatedEmail ? { email: loginToEmail(login), email_confirm: true } : {}),
    app_metadata: { ...viewer.user.app_metadata, hide_pride_flags: hidePrideFlags },
    user_metadata: {
      ...viewer.user.user_metadata,
      minecraft_login: login,
      display_name: displayName,
      favorite_music: favoriteMusic,
      social_links: socialLinks,
      profile_header_flag: headerFlag,
      profile_header_art: headerArt,
    },
  });
  if (metadataError) {
    if (login !== previousLogin) {
      await Promise.all([
        admin.from("pc_member_profiles").update({ login: previousLogin }).eq("user_id", viewer.user.id),
        admin.from("waitlist_applications").update({ login: previousLogin }).eq("user_id", viewer.user.id),
      ]);
    }
    return NextResponse.json({ error: "Профиль сохранён, но настройки входа не обновились." }, { status: 500 });
  }
  if (framesChanged || headerFrames.length) {
    try {
      await savePlusProfile(viewer.user.id, { headerFrames, headerFrameMs });
    } catch (error) {
      console.error("Header frames save failed", error);
      return NextResponse.json({ error: "Профиль сохранён, но кадры анимации не записались." }, { status: 500 });
    }
  }
  return NextResponse.json({ ok: true });
}
