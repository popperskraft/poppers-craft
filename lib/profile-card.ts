import type { getPublicProfile } from "@/lib/community";

/* Данные карточки игрока для предпросмотра в окне профиля и живой карточки
   в студии редактирования (app/profile/ProfileCard.tsx). Только то, что
   видно на карточке, — без отзывов и служебных полей, чтобы не гонять
   лишнее в браузер. */
type PublicProfile = NonNullable<Awaited<ReturnType<typeof getPublicProfile>>>;

export type ProfileCardData = Pick<PublicProfile,
  | "login" | "display_name" | "bio" | "favorite_music" | "favorite_movies" | "social_links"
  | "header_color" | "header_flag" | "header_art" | "headerFrames" | "headerFrameMs"
  | "isPlus" | "plusRing" | "plusTier" | "cardTheme" | "plusTenure"
  | "isProjectCreator" | "isCofounder" | "isPioneer" | "followers" | "following"
  | "skin_url" | "skin_model" | "pony"
> & { pinnedPostTitle: string | null };

export function toProfileCardData(profile: PublicProfile): ProfileCardData {
  return {
    login: profile.login,
    display_name: profile.display_name,
    bio: profile.bio,
    favorite_music: profile.favorite_music,
    favorite_movies: profile.favorite_movies,
    social_links: profile.social_links,
    header_color: profile.header_color,
    header_flag: profile.header_flag,
    header_art: profile.header_art,
    headerFrames: profile.headerFrames,
    headerFrameMs: profile.headerFrameMs,
    isPlus: profile.isPlus,
    plusRing: profile.plusRing,
    plusTier: profile.plusTier,
    cardTheme: profile.cardTheme,
    plusTenure: profile.plusTenure,
    isProjectCreator: profile.isProjectCreator,
    isCofounder: profile.isCofounder,
    isPioneer: profile.isPioneer,
    followers: profile.followers,
    following: profile.following,
    skin_url: profile.skin_url,
    skin_model: profile.skin_model,
    pony: profile.pony,
    pinnedPostTitle: profile.pinnedPost?.title ?? null,
  };
}
