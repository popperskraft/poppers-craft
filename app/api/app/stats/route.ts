import { NextResponse } from "next/server";
import { getCommunityViewer } from "@/lib/community";
import { getPlayerActivity, getPlayerGameStats, getServerStatus } from "@/lib/minecraft-stats";
import { getViewerIdentity } from "@/lib/waitlist";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/* Игровая статистика вошедшего игрока для главной приложения: в игре ли он
   сейчас, наигранное время, дни, алмазы и календарь активности за 20 недель. */
export async function GET() {
  const identity = await getViewerIdentity();
  if (!identity || identity.needsMfa) return NextResponse.json({ error: "Войдите в аккаунт." }, { status: 401 });
  const viewer = await getCommunityViewer({ identity, allowAuthenticated: true });
  if (!viewer) return NextResponse.json({ error: "Войдите в аккаунт." }, { status: 401 });

  const login = viewer.profile.login;
  const [server, stats, activity] = await Promise.all([
    getServerStatus(),
    getPlayerGameStats(login).catch(() => null),
    getPlayerActivity(login).catch(() => null),
  ]);
  const since = new Date(Date.now() - 20 * 7 * 86_400_000).toISOString().slice(0, 10);
  const days = Object.entries(activity?.days ?? {})
    .filter(([day]) => day >= since)
    .map(([date, minutes]) => ({ date, minutes }));

  return NextResponse.json(
    {
      login,
      online: server.online.includes(login),
      server: { reachable: server.reachable, onlineCount: server.onlineCount, maxPlayers: server.maxPlayers },
      playMinutes: Math.max(activity?.totalMinutes ?? 0, stats?.playMinutes ?? 0),
      activeDays: activity?.activeDays ?? 0,
      firstSeen: activity?.firstSeen ?? null,
      lastSeen: activity?.lastSeen ?? null,
      stats,
      days,
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
