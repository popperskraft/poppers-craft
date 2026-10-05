import Link from "next/link";
import { ProfileHeaderArt } from "@/app/ProfileHeaderArt";
import { ProfileSocialLinks } from "@/app/ProfileSocialLinks";
import { MinecraftIcon } from "@/app/MinecraftIcon";
import { ProfileSkinViewer } from "@/app/players/ProfileSkinViewer";
import { ProfileName } from "@/app/players/ProfileName";
import { joinClasses, plusClass, tenureTier } from "@/lib/plus-style";
import type { ProfileCardData } from "@/lib/profile-card";

/* Карточка игрока так, как её видят другие (те же стили, что у
   /players/<ник>). Используется в предпросмотре «Профиля» и как живая
   карточка в студии редактирования — без серверного кода, поэтому годится
   и туда, и туда. */
export function ProfileCard({ card, className }: { card: ProfileCardData; className?: string }) {
  const tenure = card.isPlus ? tenureTier(card.plusTenure) : null;
  return (
    <div className={joinClasses("paint-window player-card profile-overview-card", className, plusClass(card.isPlus, card.plusRing, card.plusTier), card.cardTheme !== "classic" && `theme-${card.cardTheme}`)}>
      <div className={`player-cover profile-flag flag-${card.header_flag}`} style={{ backgroundColor: card.header_color }}>
        <ProfileHeaderArt art={card.header_flag === "custom" ? card.header_art : null} frames={card.header_flag === "custom" ? card.headerFrames : []} frameMs={card.headerFrameMs} />
      </div>
      <div className="player-card-body">
        {/* Раскладка: имя и скин рядом, «о себе», музыка, фильмы и контакты —
            на всю ширину под ними (FANKOPOP с сайта убран, r100). */}
        <div className="player-identity-row">
          <div className="player-main-col">
            <div className="player-identity-copy">
              <p className="player-handle" translate="no">@{card.login}</p>
              <ProfileName name={card.display_name} />
              {card.isProjectCreator ? <div className="project-creator-badge">★ СОЗДАТЕЛЬ ПРОЕКТА</div> : null}
              {card.isCofounder ? <div className="project-creator-badge cofounder-badge"><b aria-hidden="true">★</b> СООСНОВАТЕЛЬ POPPERSCRAFT<small>отметка платформы</small></div> : null}
              {card.isPioneer ? <div className="project-creator-badge pioneer-badge"><b aria-hidden="true"><MinecraftIcon name="compass" size="sm" /></b> ПЕРВООТКРЫВАТЕЛЬ<small>с сервером с самого начала</small></div> : null}
              {card.isPlus ? <div className={card.plusTier === "hype" ? "project-creator-badge plus-badge is-hype" : "project-creator-badge plus-badge"}><b aria-hidden="true"><MinecraftIcon name={card.plusTier === "hype" ? "totem_of_undying" : "nether_star"} size="sm" /></b> {card.plusTier === "hype" ? "POPPERS HYPE" : "POPPERS+"}<small>поддерживает сервер</small></div> : null}
              {tenure ? <div className="project-creator-badge tenure-badge"><b aria-hidden="true"><MinecraftIcon name={tenure.icon} size="sm" /></b> {tenure.label}<small>стаж подписки</small></div> : null}
              <div className="player-stats">
                <Link href={`/players/${card.login}/connections/followers`}><b>{card.followers}</b> подписчиков</Link>
                <Link href={`/players/${card.login}/connections/following`}><b>{card.following}</b> подписок</Link>
              </div>
            </div>
            <div className="player-identity-facts">
              <section><small>BIO.TXT</small><p>{card.bio || "Вы пока ничего о себе не написали."}</p></section>
              <div className="player-columns"><section><small>MUSIC.DAT</small><p>{card.favorite_music || "—"}</p></section><section><small>FILMS.DAT</small><p>{card.favorite_movies || "—"}</p></section></div>
            </div>
            <section className="player-socials">
              <small>CONTACTS.LNK</small>
              <ProfileSocialLinks value={card.social_links} />
            </section>
          </div>
          <div className="player-side-col">
            <div className="player-skin-rating-column">
              <ProfileSkinViewer key={`${card.login}:${card.skin_url ?? ""}`} src={card.skin_url} model={card.skin_model} pony={card.pony} />
            </div>
          </div>
        </div>
        {card.pinnedPostTitle ? (
          <section className="pinned-post">
            <small>ЗАКРЕПЛЁННЫЙ ПОСТ</small>
            <h3>{card.pinnedPostTitle}</h3>
          </section>
        ) : null}
      </div>
    </div>
  );
}
