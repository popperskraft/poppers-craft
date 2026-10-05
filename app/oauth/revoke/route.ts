import { OAUTH_CORS, oauthPreflight } from "@/lib/ai-connect/http";
import { revokeByToken } from "@/lib/ai-connect/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* RFC 7009: отзыв токена. Ответ всегда 200 — даже если токен неизвестен. */
export async function POST(request: Request) {
  const params = new URLSearchParams(await request.text());
  const token = params.get("token") ?? "";
  if (/^pc[ar]_[A-Za-z0-9_-]{43}$/.test(token)) await revokeByToken(token).catch(() => undefined);
  return new Response(null, { status: 200, headers: { ...OAUTH_CORS, "Cache-Control": "no-store" } });
}

export const OPTIONS = oauthPreflight;
