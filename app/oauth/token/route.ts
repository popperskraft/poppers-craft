import { oauthJson, oauthPreflight } from "@/lib/ai-connect/http";
import { exchangeCode, OAuthError, refreshTokens } from "@/lib/ai-connect/oauth";
import { consumeRateLimit } from "@/lib/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* Обмен кода на токены и обновление токенов. Тело — form-urlencoded
   (RFC 6749), но JSON тоже принимаем. */
async function readParams(request: Request) {
  const type = request.headers.get("content-type") ?? "";
  if (type.includes("application/json")) {
    const body = await request.json().catch(() => ({}));
    return new URLSearchParams(Object.entries(body ?? {}).map(([key, value]) => [key, String(value)]));
  }
  return new URLSearchParams(await request.text());
}

export async function POST(request: Request) {
  const limit = await consumeRateLimit(request, { scope: "ai-token", limit: 120, windowSeconds: 60 * 60 });
  if (!limit.allowed) return oauthJson({ error: "slow_down", error_description: "Слишком много запросов." }, 429);
  const params = await readParams(request);
  const grant = params.get("grant_type");
  const clientId = params.get("client_id") ?? "";
  const resource = params.get("resource");
  try {
    if (grant === "authorization_code") {
      return oauthJson(await exchangeCode({
        code: params.get("code") ?? "",
        clientId,
        redirectUri: params.get("redirect_uri") ?? "",
        verifier: params.get("code_verifier") ?? "",
        resource,
      }));
    }
    if (grant === "refresh_token") {
      return oauthJson(await refreshTokens({ refreshToken: params.get("refresh_token") ?? "", clientId, resource }));
    }
    return oauthJson({ error: "unsupported_grant_type", error_description: "Поддерживаются authorization_code и refresh_token." }, 400);
  } catch (error) {
    if (error instanceof OAuthError) return oauthJson({ error: error.code, error_description: error.description }, error.status);
    return oauthJson({ error: "server_error", error_description: "Попробуйте ещё раз." }, 500);
  }
}

export const OPTIONS = oauthPreflight;
