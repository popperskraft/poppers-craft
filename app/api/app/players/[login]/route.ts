import { NextResponse } from "next/server";
import { getCommunityViewer, getPublicProfile } from "@/lib/community";
import { getPlayerActivity, getPlayerGameStats, isPlayerOnline } from "@/lib/minecraft-stats";
import { SOCIAL_LINK_FIELDS, otherSocialUrl, parseSocialLinks, socialProfileUrl } from "@/lib/social-links";
import { getViewerIdentity } from "@/lib/waitlist";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/* Профиль игрока для приложения — те же данные, что на /players/[login].
   Контакты отдаются уже разобранными, со ссылками, чтобы приложение не
   повторяло правила lib/social-links. Подписка и отзывы — через
   /api/profiles/[login]/follow и /api/profiles/[login]/reviews. */
export async function GET(_request: Request, { params }: { params: Promise<{ login: string }> }) {
  const identity = await getViewerIdentity();
  if (!identity || identity.needsMfa) return NextResponse.json({ error: "Войдите в аккаунт." }, { status: 401 });
  const viewer = await getCommunityViewer({ identity });
  if (!viewer) return NextResponse.json({ error: "Профили доступны игрокам сервера." }, { status: 403 });

  try {
    const profile = await getPublicProfile((await params).login, viewer);
    if (!profile) return NextResponse.json({ error: "Игрок не найден." }, { status: 404 });
    const [isOnline, gameStats, activity] = await Promise.all([
      isPlayerOnline(profile.login).catch(() => false),
      getPlayerGameStats(profile.login).catch(() => null),
      getPlayerActivity(profile.login).catch(() => null),
    ]);
    const parsed = parseSocialLinks(profile.social_links);
    const socials = [
      ...SOCIAL_LINK_FIELDS.filter((field) => parsed[field.key]).map((field) => ({
        key: field.key,
        label: field.label,
        value: parsed[field.key],
        url: socialProfileUrl(field.key, parsed[field.key]),
      })),
      ...parsed.other.split(/\r?\n/).map((item) => item.trim()).filter(Boolean).map((item) => ({
        key: "other",
        label: "Другое",
        value: item,
        url: otherSocialUrl(item),
      })),
    ];
    return NextResponse.json(
      {
        profile: {
          login: profile.login,
          displayName: profile.display_name,
          bio: profile.bio,
          favoriteMusic: profile.favorite_music,
          favoriteMovies: profile.favorite_movies,
          headerColor: profile.header_color,
          headerFlag: profile.header_flag,
          skinUrl: profile.skin_url,
          createdAt: profile.created_at,
          isSelf: profile.isSelf,
          isFollowing: profile.isFollowing,
          isFriend: profile.isFriend,
          followers: profile.followers,
          following: profile.following,
          averageRating: profile.averageRating,
          reviews: profile.reviews,
          myReview: profile.myReview,
          isProjectCreator: profile.isProjectCreator,
          isPlus: profile.isPlus,
          /* Тариф подписки: PLUS или HYPE. */
          plusTier: profile.isPlus ? profile.plusTier : null,
          isPioneer: profile.isPioneer,
          socials,
          /* С r096 контакты видны всем; поле оставлено для старых версий приложения. */
          contactsLocked: profile.contactsLocked,
          isOnline,
          game: {
            playMinutes: Math.max(activity?.totalMinutes ?? 0, gameStats?.playMinutes ?? 0),
            activeDays: activity?.activeDays ?? 0,
            firstSeen: activity?.firstSeen ?? null,
            lastSeen: activity?.lastSeen ?? null,
            diamondsMined: gameStats?.diamondsMined ?? 0,
            diamondsCollected: gameStats?.diamondsCollected ?? 0,
          },
        },
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    console.error("App player profile failed", error);
    return NextResponse.json({ error: "Профиль временно недоступен." }, { status: 503 });
  }
}
