"use client";

import { MinecraftIcon } from "@/app/MinecraftIcon";
import { ProfileHeaderArt } from "@/app/ProfileHeaderArt";
import type { PixelHeaderArt } from "@/lib/profile-header-art";
import { joinClasses, plusClass, TIER_NAME, type PlusRing, type PlusTheme, type PlusTier } from "@/lib/plus-style";

/* Предпросмотр карточки игрока в разделе подписки: та же обводка, тема
   карточки, шапка и значок тарифа, что увидят другие. Меняется сразу, как
   только выбран цвет или тема. Без подписки показывает обычную карточку. */

export type PlusPreviewProfile = {
  login: string;
  displayName: string;
  headerColor: string;
  headerFlag: string;
  headerArt: PixelHeaderArt | null;
  headerFrames: PixelHeaderArt[];
  headerFrameMs: number;
};

export function PlusPreview({ profile, active, tier, ring, theme, tenureLabel }: {
  profile: PlusPreviewProfile;
  active: boolean;
  tier: PlusTier;
  ring: PlusRing;
  theme: PlusTheme;
  tenureLabel: string | null;
}) {
  const hype = active && tier === "hype";
  return (
    <figure className="plus-preview-frame">
      <figcaption>ТАК ВАС ВИДЯТ ДРУГИЕ</figcaption>
      <div className={joinClasses("player-card plus-preview", plusClass(active, ring, tier), active && theme !== "classic" && `theme-${theme}`)}>
        <div className={`player-cover profile-flag flag-${profile.headerFlag}`} style={{ backgroundColor: profile.headerColor }}>
          <ProfileHeaderArt
            art={profile.headerFlag === "custom" ? profile.headerArt : null}
            frames={hype && profile.headerFlag === "custom" ? profile.headerFrames : []}
            frameMs={profile.headerFrameMs}
          />
        </div>
        <div className="player-card-body">
          <p className="player-handle" translate="no">@{profile.login}</p>
          <strong className="plus-preview-name" translate="no">{profile.displayName}</strong>
          <div className="plus-preview-badges">
            {active ? (
              <span className={hype ? "plus-tag is-hype" : "plus-tag"}>
                <MinecraftIcon name={hype ? "totem_of_undying" : "nether_star"} size="sm" />
                {TIER_NAME[hype ? "hype" : "plus"]}
              </span>
            ) : <span className="plus-preview-plain">Без подписки: обычная карточка</span>}
            {active && tenureLabel ? <span className="plus-tag plus-preview-tenure">{tenureLabel}</span> : null}
          </div>
        </div>
      </div>
    </figure>
  );
}
