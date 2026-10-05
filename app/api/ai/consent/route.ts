import { NextResponse } from "next/server";
import { checkAuthorizeRequest, redirectWith } from "@/lib/ai-connect/authorize";
import { AI_CONNECT_CLOSED_MESSAGE, canUseAiConnect } from "@/lib/ai-connect/config";
import { createAuthorizationCode } from "@/lib/ai-connect/oauth";
import { getCommunityViewer } from "@/lib/community";
import { consumeRateLimit, rateLimitResponse } from "@/lib/request-security";
import { getViewerIdentity, sameOriginOrMissing } from "@/lib/waitlist";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* Решение игрока на экране /oauth/authorize. Запрос проверяется заново:
   клиент, адрес возврата, PKCE и права — ничего не берётся на веру. */
export async function POST(request: Request) {
  if (!sameOriginOrMissing(request)) return NextResponse.json({ error: "Недопустимый запрос." }, { status: 403 });
  const identity = await getViewerIdentity();
  if (!identity || identity.needsMfa) return NextResponse.json({ error: "Войдите в аккаунт и подтвердите вход кодом 2FA." }, { status: 401 });
  const viewer = await getCommunityViewer({ identity });
  if (!viewer) return NextResponse.json({ error: "Подключать нейросеть могут игроки с одобренной анкетой." }, { status: 403 });
  if (!canUseAiConnect(viewer.user.id)) return NextResponse.json({ error: AI_CONNECT_CLOSED_MESSAGE }, { status: 403 });
  const limit = await consumeRateLimit(request, { scope: "ai-consent", key: viewer.user.id, limit: 30, windowSeconds: 60 * 60 });
  if (!limit.allowed) return rateLimitResponse(limit, "Слишком много подключений. Попробуйте позже.");

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Пустой запрос." }, { status: 400 });
  const input = Object.fromEntries(Object.entries(body as Record<string, unknown>).map(([key, value]) => [key, typeof value === "string" ? value : undefined]));
  const check = await checkAuthorizeRequest({ ...input, response_type: "code", code_challenge_method: "S256" });
  if (check.kind === "fatal") return NextResponse.json({ error: check.message }, { status: 400 });
  if (check.kind === "redirect") return NextResponse.json({ redirect: check.url });

  const { request: auth } = check;
  if (input.decision !== "allow") {
    return NextResponse.json({ redirect: redirectWith(auth.redirectUri, { error: "access_denied", error_description: "The player declined access", state: auth.state }) });
  }
  const code = await createAuthorizationCode({
    clientId: auth.clientId,
    userId: viewer.user.id,
    redirectUri: auth.redirectUri,
    codeChallenge: auth.codeChallenge,
    scopes: auth.scopes,
    resource: auth.resource,
  });
  return NextResponse.json({ redirect: redirectWith(auth.redirectUri, { code, state: auth.state }) });
}
