"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CommunityProfile } from "@/lib/community";
import type { PixelHeaderArt } from "@/lib/profile-header-art";
import type { PlusTier } from "@/lib/plus-style";
import type { ProfileCardData } from "@/lib/profile-card";
import { CommunityProfileEditor, type ProfilePreviewPatch } from "./CommunityProfileEditor";
import { PlusStudio, type PlusLookPreview } from "./PlusStudio";
import { SkinForm } from "./SkinForm";
import { ProfileCard } from "./ProfileCard";

/* Студия «Редактировать профиль» (просьба владельца, 2026-10-02): слева
   живая карточка — так её увидят другие, справа «О себе», соцсети и шапка.
   Под карточкой — обводка, фон, пост, скин и модели (2026-10-03: чтобы под
   карточкой не пустовало). Имя, «о себе», музыка, фильмы, соцсети, цвет, флаг
   и рисунок шапки меняются на карточке сразу, ещё до сохранения; обводка и
   фон — по клику (они сохраняются сами); скин — после сохранения (страница
   обновляет данные). Гардероб скинов теперь в лаунчере, на сайте его нет. */

type EditorProps = {
  profile: CommunityProfile;
  hidePrideFlags: boolean;
  canEditLogin: boolean;
  plus: boolean;
  tier: PlusTier;
  ring: string;
  headerFrames: PixelHeaderArt[];
  headerFrameMs: number;
  canUploadSkin: boolean;
  hype: boolean;
};

const SECTIONS = [
  ["community-profile", "О СЕБЕ И ШАПКА"],
  ["plus-ring", "ОБВОДКА"],
  ["plus-theme", "ФОН"],
  ["plus-pinned", "ПОСТ"],
  ["plus-skin", "СКИН"],
  ["plus-models", "МОДЕЛИ"],
] as const;

const SAVED_FIELDS = ["display_name", "bio", "favorite_music", "favorite_movies", "social_links", "header_color", "header_flag", "header_art", "headerFrames"] as const;
const LOOK_FIELDS = ["isPlus", "plusTier", "plusRing", "cardTheme"] as const;

export function ProfileEditStudio({ card: savedCard, editor }: { card: ProfileCardData; editor: EditorProps }) {
  const [card, setCard] = useState(savedCard);
  /* Адрес скина постоянный — после загрузки или смены образа меняем версию, чтобы карточка взяла новый. */
  const [skinVersion, setSkinVersion] = useState(0);
  const bumpSkin = useCallback(() => setSkinVersion((value) => value + 1), []);
  const shown = skinVersion && card.skin_url ? { ...card, skin_url: `${card.skin_url}${card.skin_url.includes("?") ? "&" : "?"}v=${skinVersion}` } : card;

  /* Страница присылает свежие данные после сохранения профиля — тогда
     карточка берёт их целиком. После смены скина или образа обновляется всё,
     кроме того, что игрок сейчас правит, — набранное, но не сохранённое
     остаётся на карточке. Обводку и тему всегда ведёт PlusStudio. */
  const profileSaved = useRef(false);
  const onProfileSaved = useCallback(() => { profileSaved.current = true; }, []);
  const savedKey = JSON.stringify(savedCard);
  useEffect(() => {
    const next = JSON.parse(savedKey) as ProfileCardData;
    const keepFields = profileSaved.current ? LOOK_FIELDS : [...SAVED_FIELDS, ...LOOK_FIELDS];
    profileSaved.current = false;
    setCard((current) => {
      const merged = { ...next } as Record<string, unknown>;
      for (const field of keepFields) merged[field] = current[field];
      return merged as ProfileCardData;
    });
  }, [savedKey]);

  const hype = editor.hype;
  const onProfilePreview = useCallback((patch: ProfilePreviewPatch) => {
    /* Кадры анимации на карточке видны только с HYPE — как у всех остальных. */
    setCard((current) => ({ ...current, ...patch, ...(hype ? {} : { headerFrames: [] }) } as ProfileCardData));
  }, [hype]);
  const onLookPreview = useCallback((look: PlusLookPreview) => {
    setCard((current) => ({
      ...current,
      isPlus: look.active,
      plusTier: look.hype ? "hype" : "plus",
      plusRing: look.ring,
      cardTheme: look.active ? look.theme : "classic",
    } as ProfileCardData));
  }, []);

  /* Есть ли то, что видно на карточке, но ещё не сохранено кнопкой «Сохранить профиль». */
  const unsaved = useMemo(
    () => SAVED_FIELDS.some((field) => JSON.stringify(card[field] ?? null) !== JSON.stringify(savedCard[field] ?? null)),
    [card, savedCard],
  );

  return (
    <div className="profile-studio">
      <aside className="profile-studio-preview" aria-label="Живой предпросмотр карточки">
        <div className="profile-studio-preview-head">
          <small>ТАК ВАС УВИДЯТ ДРУГИЕ</small>
          {unsaved ? <b className="profile-studio-unsaved">НЕ СОХРАНЕНО</b> : <b className="profile-studio-saved">СОХРАНЕНО ✓</b>}
        </div>
        <ProfileCard card={shown} className="profile-studio-card" />
        {unsaved ? <p className="profile-studio-note">Изменения видны только вам, пока вы не нажмёте «Сохранить профиль» в блоке «О себе и шапка».</p> : null}
      </aside>

      <div className="profile-studio-panel profile-studio-main">
        <div className="profile-edit-head">
          <Link className="profile-edit-back" href="/profile">← ГОТОВО, К ПРОФИЛЮ</Link>
          <h2>РЕДАКТИРОВАНИЕ ПРОФИЛЯ</h2>
          <p>Меняйте здесь и под карточкой — она сразу показывает результат. Обводка, фон и закреплённый пост — с подпиской.</p>
          <nav className="plus-page-sections" aria-label="Что изменить">
            {SECTIONS.map(([id, label]) => <a key={id} href={`#${id}`}>{label}</a>)}
          </nav>
        </div>
        <CommunityProfileEditor
          profile={editor.profile}
          hidePrideFlags={editor.hidePrideFlags}
          canEditLogin={editor.canEditLogin}
          plus={editor.plus}
          tier={editor.tier}
          ring={editor.ring}
          headerFrames={editor.headerFrames}
          headerFrameMs={editor.headerFrameMs}
          initialAppearance
          hidePreview
          onPreview={onProfilePreview}
          onSaved={onProfileSaved}
        />
        <div className="profile-actions profile-edit-done"><Link className="profile-primary-action" href="/profile">ГОТОВО, К ПРОФИЛЮ</Link></div>
      </div>

      <div className="profile-studio-panel profile-studio-extras">
        <PlusStudio integrated login={editor.profile.login} parts={["ring", "theme", "pinned"]} onPreview={onLookPreview} />
        <section className="profile-password" id="plus-skin">
          <p>PLAYER_SKIN.PNG</p>
          <h2>СМЕНА СКИНА</h2>
          <SkinForm currentSkinUrl={editor.profile.skin_url} canUpload={editor.canUploadSkin} unlimited={editor.hype} onSaved={bumpSkin} />
        </section>
        <section className="profile-password" id="plus-models">
          <p>CHARACTER_MODELS.EXE</p>
          <h2>МОДЕЛИ ПЕРСОНАЖЕЙ</h2>
          <p>Выберите человека или создайте пони в 3D-редакторе. Раса и размер меняют только внешность.</p>
          <div className="profile-actions"><Link className="profile-primary-action" href="/models">ОТКРЫТЬ РЕДАКТОР →</Link></div>
        </section>
      </div>
    </div>
  );
}
