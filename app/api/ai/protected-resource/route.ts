import { AI_ISSUER, AI_SCOPES, AI_SITE_ORIGIN, resourceFor } from "@/lib/ai-connect/config";
import { oauthJson, oauthPreflight } from "@/lib/ai-connect/http";

export const dynamic = "force-dynamic";

/* RFC 9728: описание MCP-ресурса. Открывается по адресу
   /.well-known/oauth-protected-resource (rewrite в next.config.ts). */
export function GET(request: Request) {
  return oauthJson({
    resource: resourceFor(request),
    authorization_servers: [AI_ISSUER],
    scopes_supported: [...AI_SCOPES],
    bearer_methods_supported: ["header"],
    resource_name: "PoppersCraft",
    resource_documentation: `${AI_SITE_ORIGIN}/profile?tab=settings&section=ai`,
  }, 200, { "Cache-Control": "public, max-age=3600", Vary: "Host" });
}

export const OPTIONS = oauthPreflight;
