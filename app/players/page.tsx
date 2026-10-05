import { redirect } from "next/navigation";
import { loginPageUrl } from "@/lib/login-return";
import { BackButton } from "@/app/BackButton";
import { getCommunityViewer, listPlayerDirectory } from "@/lib/community";
import { getServerStatus } from "@/lib/minecraft-stats";
import { getViewerIdentity } from "@/lib/waitlist";
import { PlayerDirectory } from "./PlayerDirectory";

export const dynamic = "force-dynamic";

export default async function PlayersPage() {
  const identity = await getViewerIdentity();
  if (!identity) redirect(loginPageUrl("/players"));
  if (identity.needsMfa) redirect("/mfa?next=/players");
  const viewer = await getCommunityViewer({ identity, allowAuthenticated: true });
  /* Вход есть, но профиль сообщества не открылся — окно входа тут не поможет. */
  if (!viewer) redirect("/");
  const [players, server] = await Promise.all([listPlayerDirectory(viewer), getServerStatus()]);

  return (
    <main className="community-page player-directory-page">
      <header className="community-topbar">
        {/* Главная, лента и свой профиль — в общей шапке сайта. */}
        <nav className="player-directory-nav" aria-label="Навигация по списку игроков">
          <BackButton fallback="/feed" />
        </nav>
        <strong>СПИСОК ИГРОКОВ</strong>
      </header>
      <PlayerDirectory players={players} online={server.online} />
    </main>
  );
}
