import { NextResponse } from "next/server";
import { approveLauncher, validLauncherToken } from "@/lib/launcher-authorize";
import { consumeRateLimit, rateLimitResponse } from "@/lib/request-security";
import { getApprovedMember, sameOriginOrMissing } from "@/lib/waitlist";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const PRIVATE = { "Cache-Control": "private, no-store" };

/* Игрок нажал «Подтвердить вход» на странице /launcher/authorize. Раньше
   вход подтверждался сам при открытии страницы — тогда чужая ссылка,
   открытая в браузере с активным входом, впускала в чужой лаунчер. Теперь
   нужно явное нажатие, а сеанс должен быть полным (с кодом 2FA, если он
   включён) — это проверяет getApprovedMember. */
export async function POST(request: Request) {
  if (!sameOriginOrMissing(request)) return NextResponse.json({ error: "Запрос отклонён." }, { status: 403, headers: PRIVATE });
  const member = await getApprovedMember();
  if (!member) return NextResponse.json({ error: "Войдите в аккаунт игрока, чтобы подтвердить вход." }, { status: 401, headers: PRIVATE });
  const limit = await consumeRateLimit(request, { scope: "launcher-authorize", key: member.userId, limit: 20, windowSeconds: 60 * 60 });
  if (!limit.allowed) return rateLimitResponse(limit, "Слишком много попыток. Попробуйте позже.");
  const body = await request.json().catch(() => null) as { request?: unknown; code?: unknown } | null;
  const requestId = String(body?.request ?? "");
  const approvalToken = String(body?.code ?? "");
  if (!validLauncherToken(requestId) || !validLauncherToken(approvalToken)) {
    return NextResponse.json({ error: "Ссылка недействительна. Нажмите «Войти через сайт» в лаунчере ещё раз." }, { status: 400, headers: PRIVATE });
  }
  const result = await approveLauncher({ requestId, approvalToken, approved: true, login: member.login });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 502, headers: PRIVATE });
  return NextResponse.json({ ok: true, login: member.login }, { headers: PRIVATE });
}
