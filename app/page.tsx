import HomePage, { type HomeViewer } from "./HomePage";
import { MaintenancePage } from "./MaintenancePage";
import { getSiteSettings, getViewerIdentity } from "@/lib/waitlist";
import { viewerAccess } from "@/lib/payments";
import { loginNextTarget } from "@/lib/login-return";
import { whitelistToVote } from "@/lib/whitelist-to-vote";

export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<{ login?: string; next?: string }> }) {
  const [settings, viewer, params] = await Promise.all([
    getSiteSettings(),
    getViewerIdentity(),
    searchParams,
  ]);
  const isOwner = viewer?.adminProfile?.role === "owner" && !viewer.needsMfa;

  if (settings.maintenanceMode && !isOwner) {
    return <MaintenancePage endsAt={settings.endsAt} />;
  }

  /* Кнопки главной зависят от того, кто зашёл: гость, игрок без пропуска,
     игрок с доступом или администратор. Считаем это на сервере, чтобы
     надписи не менялись на глазах после загрузки. Если база не ответила,
     главная сама спросит /api/session, как раньше. */
  let initialViewer: HomeViewer | null = null;
  try {
    const isAdmin = Boolean(viewer?.adminProfile && !viewer.needsMfa);
    const access = await viewerAccess(viewer && !viewer.needsMfa ? viewer.user.id : null, { isAdmin });
    initialViewer = {
      authenticated: Boolean(viewer),
      needsMfa: Boolean(viewer?.needsMfa),
      isAdmin,
      isMember: access.approved,
      hidePrideFlags: !viewer || Boolean(viewer.user.app_metadata?.hide_pride_flags),
      access,
    };
    if (viewer && !viewer.needsMfa && (access.approved || isAdmin)) {
      const toVote = await whitelistToVote(viewer.user.id).catch(() => null);
      if (toVote?.count) initialViewer.whitelistToVote = toVote.count;
    }
  } catch (error) {
    console.error("Home viewer state failed", error instanceof Error ? error.message : error);
  }

  return (
    <HomePage
      initialViewer={initialViewer}
      openLogin={params.login === "1"}
      loginNext={loginNextTarget(params.next)}
    />
  );
}
