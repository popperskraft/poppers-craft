import { AI_ISSUER, AI_SCOPES, AI_SITE_ORIGIN } from "@/lib/ai-connect/config";
import { oauthJson, oauthPreflight } from "@/lib/ai-connect/http";

export const dynamic = "force-dynamic";

/* RFC 8414: описание сервера авторизации. Открывается по адресу
   /.well-known/oauth-authorization-server (rewrite в next.config.ts).
   Клиенты только публичные (без секрета) и только с PKCE S256;
   регистрация — динамическая (RFC 7591), её понимают ChatGPT и Claude. */
export function GET() {
  return oauthJson({
    issuer: AI_ISSUER,
    authorization_endpoint: `${AI_SITE_ORIGIN}/oauth/authorize`,
    token_endpoint: `${AI_SITE_ORIGIN}/oauth/token`,
    registration_endpoint: `${AI_SITE_ORIGIN}/oauth/register`,
    revocation_endpoint: `${AI_SITE_ORIGIN}/oauth/revoke`,
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    revocation_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [...AI_SCOPES],
    authorization_response_iss_parameter_supported: true,
    service_documentation: `${AI_SITE_ORIGIN}/profile?tab=settings&section=ai`,
  }, 200, { "Cache-Control": "public, max-age=3600" });
}

export const OPTIONS = oauthPreflight;
