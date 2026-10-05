import Link from "next/link";
import { redirect } from "next/navigation";
import { MinecraftIcon } from "@/app/MinecraftIcon";
import { getPlayerWaitlistViewer, getViewerIdentity, listPlayerWaitlist } from "@/lib/waitlist";
import { PlayerWhitelist } from "./PlayerWhitelist";
import { BackButton } from "@/app/BackButton";
import { WhitelistAccess } from "./WhitelistAccess";

export const dynamic = "force-dynamic";

export default async function WhitelistPage({ searchParams }: { searchParams: Promise<{ application?: string }> }) {
  const { application } = await searchParams;
  const applicationId = typeof application === "string" && /^[1-9]\d*$/.test(application) && Number.isSafeInteger(Number(application)) ? Number(application) : null;
  const target = applicationId ? `/whitelist?application=${applicationId}` : "/whitelist";
  const viewer = await getPlayerWaitlistViewer();
  if (!viewer) {
    const identity = await getViewerIdentity();
    if (identity?.needsMfa) redirect(`/mfa?next=${encodeURIComponent(target)}`);
    return <WhitelistAccess target={target} signedIn={Boolean(identity)} />;
  }
  const applications = await listPlayerWaitlist(viewer.userId);
  const visibleApplications = application !== undefined ? applications.filter((item) => item.id === applicationId) : applications;
  return (
    <main className="admin-shell player-whitelist-page">
      <header className="admin-header">
        <div><p>POPPERSCRAFT COMMUNITY VOTE</p><h1>ВАЙТЛИСТ</h1><span>{viewer.isAdmin ? "АДМИНИСТРАТОР" : "ГОЛОС ИГРОКА"}: @{viewer.login}</span></div>
        <div className="admin-header-links">{application !== undefined ? <Link href="/whitelist">ВСЕ АНКЕТЫ</Link> : null}<BackButton fallback={application !== undefined ? "/whitelist" : "/"} /></div>
      </header>
      {/* Владелец просил объяснить игрокам, зачем сюда заходить (2026-10-02). */}
      <div className="admin-rule-banner whitelist-how"><MinecraftIcon name="book" size="sm" /><span><b>Кого пустить на сервер, решаем вместе.</b> Прочитайте анкету новичка и нажмите «ЗА» или «ПРОТИВ», а если есть что сказать — оставьте отзыв. Голоса игроков помогают администрации понять мнение сообщества, но не заменяют решение админов.</span></div>
      {application !== undefined && !visibleApplications.length ? <p className="empty-applications">{applicationId ? "Эта анкета уже рассмотрена или больше недоступна для голосования." : "Некорректная ссылка на анкету."} <Link href="/whitelist">ОТКРЫТЬ ВСЕ АНКЕТЫ →</Link></p> : <PlayerWhitelist key={applicationId ?? "all"} initialApplications={visibleApplications} canDeleteApplications={viewer.isAdmin} />}
    </main>
  );
}
