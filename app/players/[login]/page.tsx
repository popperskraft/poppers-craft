import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { loginPageUrl } from "@/lib/login-return";
import { getCommunityViewer, getPublicProfile } from "@/lib/community";
import { getPlayerActivity, isPlayerOnline } from "@/lib/minecraft-stats";
import { FollowButton } from "./FollowButton";
import { getViewerIdentity } from "@/lib/waitlist";
import { BackButton } from "@/app/BackButton";
import { ProfileSkinViewer } from "../ProfileSkinViewer";
import { ProfileName } from "../ProfileName";
import { ProfileSocialLinks } from "@/app/ProfileSocialLinks";
import { ProfileReviews } from "./ProfileReviews";
import { PixelStars } from "@/app/PixelStars";
import { ProfileHeaderArt } from "@/app/ProfileHeaderArt";
import { PlayerPresence } from "../PlayerPresence";
import { PlayerStreak } from "../PlayerStreak";
import { getPlayerStreak } from "@/lib/player-streak";
import { MinecraftIcon } from "@/app/MinecraftIcon";
import { joinClasses, plusClass, tenureTier } from "@/lib/plus-style";
import "@/app/referrals.css";

export const dynamic = "force-dynamic";

export default async function PlayerProfilePage({ params }: { params: Promise<{ login: string }> }) {
  const identity = await getViewerIdentity();
  if (!identity) redirect(loginPageUrl(`/players/${encodeURIComponent((await params).login)}`));
  if (identity.needsMfa) redirect(`/mfa?next=/players/${encodeURIComponent((await params).login)}`);
  const participatingViewer = await getCommunityViewer({ identity });
  const viewer = participatingViewer ?? await getCommunityViewer({ identity, allowAuthenticated: true });
  /* Вход есть, но профиль сообщества не открылся — окно входа тут не поможет. */
  if (!viewer) redirect("/");
  const profile = await getPublicProfile((await params).login, viewer);
  if (!profile) notFound();
  const [inGame, activity, streak] = await Promise.all([
    isPlayerOnline(profile.login).catch(() => false),
    getPlayerActivity(profile.login).catch(() => null),
    getPlayerStreak(profile.login).catch(() => null),
  ]);
  /* Значок стажа виден, пока подписка активна; значок тарифа — PLUS или HYPE. */
  const tenure = profile.isPlus ? tenureTier(profile.plusTenure) : null;
  return (
    <main className="player-page">
      <div className="player-page-shell">
        <div className="player-page-toolbar">
          <nav className="player-page-nav" aria-label="Навигация по профилю игрока">
            <BackButton fallback="/feed" />
            {/* Главная и лента — в общей шапке сайта. */}
            <Link href="/players">СПИСОК ИГРОКОВ</Link>
          </nav>
          {profile.isSelf ? <Link className="player-settings-link" href="/profile?edit=1">РЕДАКТИРОВАТЬ ПРОФИЛЬ →</Link> : null}
        </div>
        <div className={joinClasses("paint-window player-card", plusClass(profile.isPlus, profile.plusRing, profile.plusTier), profile.cardTheme !== "classic" && `theme-${profile.cardTheme}`)}>
          <div className={`player-cover profile-flag flag-${profile.header_flag}`} style={{ backgroundColor: profile.header_color }}>
            {/* Кадры анимации — часть своего рисунка: при флаге или цвете их нет (r099). */}
            <ProfileHeaderArt art={profile.header_flag === "custom" ? profile.header_art : null} frames={profile.header_flag === "custom" ? profile.headerFrames : []} frameMs={profile.headerFrameMs} />
          </div>
          <div className="player-card-body">
          {/* Раскладка: имя и скин с рейтингом рядом, «о себе», музыка, фильмы
              и контакты — на всю ширину под ними (FANKOPOP с сайта убран, r100). */}
          <div className="player-identity-row">
            <div className="player-main-col">
              <div className="player-identity-copy">
                <p className="player-handle" translate="no">@{profile.login}</p>
                <ProfileName name={profile.display_name} />
                <PlayerPresence online={inGame} lastSeen={activity?.lastSeen} trailing={
                  <PlayerStreak key={profile.login} login={profile.login} initialStreak={streak} />
                } />
                {profile.isProjectCreator ? <div className="project-creator-badge">★ СОЗДАТЕЛЬ ПРОЕКТА</div> : null}
                {profile.isCofounder ? <div className="project-creator-badge cofounder-badge"><b aria-hidden="true">★</b> СООСНОВАТЕЛЬ POPPERSCRAFT<small>отметка платформы</small></div> : null}
                {profile.isPioneer ? <div className="project-creator-badge pioneer-badge"><b aria-hidden="true"><MinecraftIcon name="compass" size="sm" /></b> ПЕРВООТКРЫВАТЕЛЬ<small>с сервером с самого начала</small></div> : null}
                {profile.isPlus ? <div className={profile.plusTier === "hype" ? "project-creator-badge plus-badge is-hype" : "project-creator-badge plus-badge"}><b aria-hidden="true"><MinecraftIcon name={profile.plusTier === "hype" ? "totem_of_undying" : "nether_star"} size="sm" /></b> {profile.plusTier === "hype" ? "POPPERS HYPE" : "POPPERS+"}<small>поддерживает сервер</small></div> : null}
                {tenure ? <div className="project-creator-badge tenure-badge"><b aria-hidden="true"><MinecraftIcon name={tenure.icon} size="sm" /></b> {tenure.label}<small>стаж подписки</small></div> : null}
                <div className="player-stats">
                  <Link href={`/players/${profile.login}/connections/followers`}><b>{profile.followers}</b> подписчиков</Link>
                  <Link href={`/players/${profile.login}/connections/following`}><b>{profile.following}</b> подписок</Link>
                  {profile.isFriend ? <strong>★ ДРУЗЬЯ</strong> : null}
                </div>
                {!profile.isSelf ? <FollowButton login={profile.login} initiallyFollowing={profile.isFollowing} /> : null}
                {profile.isSelf && participatingViewer ? <Link className="player-referral-link" href="/profile?tab=settings&section=referrals"><MinecraftIcon name="cake" size="sm" /> ПРИГЛАСИТЬ ДРУГА</Link> : null}
                {/* Подарить подписку (PLUS или HYPE, месяц или год): платит даритель, подписку получает игрок. */}
                {!profile.isSelf && participatingViewer ? (
                  <Link className="gift-plus-link" href={`/donation?plan=gift&to=${encodeURIComponent(profile.login)}`}>
                    <MinecraftIcon name="cake" size="sm" /> ПОДАРИТЬ ПОДПИСКУ
                  </Link>
                ) : null}
              </div>
              <div className="player-identity-facts">
                <section><small>BIO.TXT</small><p>{profile.bio || "Игрок пока ничего о себе не написал."}</p></section>
                <div className="player-columns"><section><small>MUSIC.DAT</small><p>{profile.favorite_music || "—"}</p></section><section><small>FILMS.DAT</small><p>{profile.favorite_movies || "—"}</p></section></div>
              </div>
              <section className="player-socials">
                <small>CONTACTS.LNK</small>
                {/* Контакты видны всем (с r096). */}
                <ProfileSocialLinks value={profile.social_links} />
              </section>
            </div>
            <div className="player-side-col">
              <div className="player-skin-rating-column">
                <ProfileSkinViewer key={profile.login} src={profile.skin_url} model={profile.skin_model} pony={profile.pony} />
                <div className="player-rating-summary" aria-label={`Средний рейтинг ${profile.averageRating.toFixed(1)} из 5`}>
                  <small>РЕЙТИНГ ИГРОКА</small>
                  <div><PixelStars rating={profile.averageRating} /></div>
                  <b>{profile.reviews.length ? profile.averageRating.toFixed(1) : "—"}</b>
                  <span>{profile.reviews.length} оценок</span>
                </div>
              </div>
            </div>
          </div>
          {profile.pinnedPost ? (
            <section className="pinned-post">
              <small>ЗАКРЕПЛЁННЫЙ ПОСТ</small>
              <h3>{profile.pinnedPost.title}</h3>
              {profile.pinnedPost.imageUrl ? (
                profile.pinnedPost.mediaKind === "video"
                  ? <video src={profile.pinnedPost.imageUrl} autoPlay muted loop playsInline preload="metadata" aria-label="Беззвучное видео из закреплённого поста" />
                  /* eslint-disable-next-line @next/next/no-img-element */
                  : <img src={profile.pinnedPost.imageUrl} alt="Изображение из закреплённого поста" />
              ) : null}
              <p>{profile.pinnedPost.body}</p>
              <Link href={`/feed?q=${encodeURIComponent(profile.pinnedPost.title)}#post-${profile.pinnedPost.id}`}>ОТКРЫТЬ В ЛЕНТЕ →</Link>
            </section>
          ) : null}
          <ProfileReviews
            targetLogin={profile.login}
            isSelf={profile.isSelf}
            canInteract={Boolean(participatingViewer)}
            initialReviews={profile.reviews}
            initialMyReview={profile.myReview}
          />
          </div>
          <div className="status-bar"><span>PROFILE_LOADED</span><span>{profile.isFriend ? "FRIEND_ACCESS" : "PUBLIC_ACCESS"}</span></div>
        </div>
      </div>
    </main>
  );
}
