/* Общие заголовки для адресов OAuth: их вызывают серверы ChatGPT и Claude,
   а не страницы сайта, поэтому куки и CSRF здесь ни при чём. */
export const OAUTH_CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Mcp-Protocol-Version",
};

export function oauthJson(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...OAUTH_CORS, "Content-Type": "application/json", "Cache-Control": "no-store", Pragma: "no-cache", ...extra },
  });
}

export function oauthPreflight() {
  return new Response(null, { status: 204, headers: OAUTH_CORS });
}
