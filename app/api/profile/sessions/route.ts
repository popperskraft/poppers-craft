import { NextResponse } from "next/server";
import { getViewerIdentity, sameOriginOrMissing } from "@/lib/waitlist";
import { consumeRateLimit, rateLimitResponse } from "@/lib/request-security";
import { currentSessionId, endSessions, listDevices } from "@/lib/session-devices";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* Активные устройства игрока: список и завершение чужих сеансов.
   Из текущего браузера выходят обычной кнопкой «Выйти». Нужен полный вход
   (с кодом 2FA, если он включён). */
async function viewer() {
  const identity = await getViewerIdentity();
  if (!identity || identity.needsMfa) return null;
  return { userId: identity.user.id, sessionId: await currentSessionId(identity.user.id).catch(() => null) };
}

export async function GET() {
  const current = await viewer();
  if (!current) return NextResponse.json({ error: "Войдите в аккаунт." }, { status: 401 });
  try {
    return NextResponse.json({ devices: await listDevices(current.userId, current.sessionId) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось загрузить устройства." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  if (!sameOriginOrMissing(request)) return NextResponse.json({ error: "Запрос отклонён." }, { status: 403 });
  const current = await viewer();
  if (!current) return NextResponse.json({ error: "Войдите в аккаунт." }, { status: 401 });
  const limit = await consumeRateLimit(request, { scope: "end-sessions", key: current.userId, limit: 20, windowSeconds: 60 * 60 });
  if (!limit.allowed) return rateLimitResponse(limit, "Слишком много действий. Попробуйте позже.");
  const body = await request.json().catch(() => null) as { action?: unknown; id?: unknown } | null;
  try {
    const devices = await listDevices(current.userId, current.sessionId);
    const others = devices.filter((device) => !device.current).map((device) => device.id);
    const targets = body?.action === "end-others"
      ? others
      : body?.action === "end" && typeof body.id === "string" && others.includes(body.id)
        ? [body.id]
        : null;
    if (!targets) return NextResponse.json({ error: "Этот сеанс уже завершён или это текущее устройство." }, { status: 400 });
    const ended = await endSessions(current.userId, targets, current.sessionId);
    return NextResponse.json({ ended, devices: await listDevices(current.userId, current.sessionId) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось завершить сеанс." }, { status: 503 });
  }
}
