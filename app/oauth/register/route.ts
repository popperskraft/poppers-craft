import { oauthJson, oauthPreflight } from "@/lib/ai-connect/http";
import { OAuthError, registerClient } from "@/lib/ai-connect/oauth";
import { clientAddress, consumeRateLimit } from "@/lib/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* RFC 7591: нейросеть регистрируется сама. Регистрация ещё ничего не
   разрешает — доступ даёт только игрок на экране /oauth/authorize. */
export async function POST(request: Request) {
  const limit = await consumeRateLimit(request, { scope: "ai-register", limit: 30, windowSeconds: 60 * 60 });
  if (!limit.allowed) return oauthJson({ error: "slow_down", error_description: "Слишком много регистраций." }, 429);
  const input = await request.json().catch(() => null);
  if (!input || typeof input !== "object") return oauthJson({ error: "invalid_client_metadata", error_description: "Ожидается JSON." }, 400);
  try {
    const client = await registerClient(input as Record<string, unknown>, clientAddress(request));
    return oauthJson({
      client_id: client.id,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      client_name: client.name,
      redirect_uris: client.redirect_uris,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    }, 201);
  } catch (error) {
    if (error instanceof OAuthError) return oauthJson({ error: error.code, error_description: error.description }, error.status);
    return oauthJson({ error: "server_error", error_description: "Не удалось зарегистрировать клиента." }, 500);
  }
}

export const OPTIONS = oauthPreflight;
