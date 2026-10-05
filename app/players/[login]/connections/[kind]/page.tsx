import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { loginPageUrl } from "@/lib/login-return";
import { BackButton } from "@/app/BackButton";
import { getCommunityViewer, getProfileConnections } from "@/lib/community";
import { getViewerIdentity } from "@/lib/waitlist";
import { joinClasses, plusClass } from "@/lib/plus-style";

export const dynamic = "force-dynamic";

export default async function ProfileConnectionsPage({
  params,
}: {
  params: Promise<{ login: string; kind: string }>;
}) {
  const { login, kind: rawKind } = await params;
  if (rawKind !== "followers" && rawKind !== "following") notFound();
  const kind: "followers" | "following" = rawKind;

  const identity = await getViewerIdentity();
  if (!identity) redirect(loginPageUrl(`/players/${encodeURIComponent(login)}/connections/${encodeURIComponent(rawKind)}`));
  if (identity.needsMfa) {
    redirect(`/mfa?next=${encodeURIComponent(`/players/${login}/connections/${kind}`)}`);
  }
  const viewer = await getCommunityViewer({ identity, allowAuthenticated: true });
  /* Вход есть, но профиль сообщества не открылся — окно входа тут не поможет. */
  if (!viewer) redirect("/");

  const data = await getProfileConnections(login, kind, viewer);
  if (!data) notFound();
  const title = kind === "followers" ? "ПОДПИСЧИКИ" : "ПОДПИСКИ";
  const description = kind === "followers"
    ? `Подписаны на @${data.owner.login}`
    : `На кого подписан @${data.owner.login}`;

  return (
    <main className="player-page connections-page">
      <div className="paint-window connections-window">
        <div className="window-bar">
          <span>{kind === "followers" ? "followers.exe" : "following.exe"}</span>
          <BackButton fallback={`/players/${data.owner.login}`} />
        </div>
        <div className="connections-content">
          <p className="player-handle">@{data.owner.login}</p>
          <h1>{title}</h1>
          <p className="connections-description">{description}</p>
          <nav className="connections-tabs" aria-label="Подписки профиля">
            <Link
              className={kind === "followers" ? "active" : ""}
              href={`/players/${data.owner.login}/connections/followers`}
            >
              ПОДПИСЧИКИ
            </Link>
            <Link
              className={kind === "following" ? "active" : ""}
              href={`/players/${data.owner.login}/connections/following`}
            >
              ПОДПИСКИ
            </Link>
          </nav>
          {data.profiles.length ? (
            <div className="connections-list">
              {data.profiles.map((profile) => (
                <Link
                  className={joinClasses("connection-row", plusClass(profile.plus, profile.ring, profile.tier))}
                  href={`/players/${profile.login}`}
                  key={profile.user_id}
                  style={{ backgroundColor: profile.header_color }}
                  title={profile.plus ? (profile.tier === "hype" ? "Подписчик HYPE" : "Подписчик PLUS") : undefined}
                >
                  <strong>{profile.display_name}</strong>
                  <span>@{profile.login}</span>
                  <i aria-hidden="true">→</i>
                </Link>
              ))}
            </div>
          ) : (
            <p className="connections-empty">
              {kind === "followers" ? "ПОКА НЕТ ПОДПИСЧИКОВ" : "ПОКА НЕТ ПОДПИСОК"}
            </p>
          )}
        </div>
        <div className="status-bar">
          <span>{data.profiles.length} PLAYERS</span>
          <span>PROFILE_CONNECTIONS</span>
        </div>
      </div>
    </main>
  );
}
