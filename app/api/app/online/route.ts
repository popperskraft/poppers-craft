import { NextResponse } from "next/server";
import { getCommunityViewer } from "@/lib/community";
import { getServerStatus } from "@/lib/minecraft-stats";
import { getViewerIdentity } from "@/lib/waitlist";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/* Кто сейчас на сервере — для отметок «В ИГРЕ» в приложении. Только для игроков. */
export async function GET() {
  const identity = await getViewerIdentity();
  if (!identity || identity.needsMfa) return NextResponse.json({ error: "Войдите в аккаунт." }, { status: 401 });
  const viewer = await getCommunityViewer({ identity, allowAuthenticated: true });
  if (!viewer) return NextResponse.json({ error: "Войдите в аккаунт." }, { status: 401 });
  const server = await getServerStatus();
  return NextResponse.json(
    { players: server.online, onlineCount: server.onlineCount, maxPlayers: server.maxPlayers, reachable: server.reachable },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
