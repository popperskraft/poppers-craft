import { NextResponse } from "next/server";
import { MCP_RESOURCE } from "@/lib/ai-connect/config";
import { listActivity, listConnections, revokeClientForUser } from "@/lib/ai-connect/oauth";
import { getCommunityViewer } from "@/lib/community";
import { getViewerIdentity, sameOriginOrMissing } from "@/lib/waitlist";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" };

async function owner() {
  const identity = await getViewerIdentity();
  if (!identity || identity.needsMfa) return null;
  return getCommunityViewer({ identity });
}

/* Настройки профиля → «Нейросети»: подключения, журнал действий, отключение. */
export async function GET() {
  const viewer = await owner();
  if (!viewer) return NextResponse.json({ error: "Войдите в аккаунт." }, { status: 401, headers: NO_STORE });
  const [connections, activity] = await Promise.all([listConnections(viewer.user.id), listActivity(viewer.user.id)]);
  const names = new Map(connections.map((connection) => [connection.clientId, connection.name]));
  return NextResponse.json({
    mcpUrl: MCP_RESOURCE,
    connections,
    activity: activity.map((entry) => ({ ...entry, clientName: entry.clientId ? names.get(entry.clientId) ?? "Нейросеть (отключена)" : "Нейросеть" })),
  }, { headers: NO_STORE });
}

export async function POST(request: Request) {
  if (!sameOriginOrMissing(request)) return NextResponse.json({ error: "Недопустимый запрос." }, { status: 403 });
  const viewer = await owner();
  if (!viewer) return NextResponse.json({ error: "Войдите в аккаунт." }, { status: 401 });
  const body = await request.json().catch(() => null);
  const clientId = typeof body?.clientId === "string" ? body.clientId : "";
  if (!/^pcc_[A-Za-z0-9_-]{43}$/.test(clientId)) return NextResponse.json({ error: "Не выбрано подключение." }, { status: 400 });
  await revokeClientForUser(viewer.user.id, clientId);
  return NextResponse.json({ ok: true, message: "Нейросеть отключена. Чтобы вернуть доступ, подключите её заново." });
}
