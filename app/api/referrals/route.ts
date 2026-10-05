import { NextResponse } from "next/server";
import { getViewerIdentity, sameOriginOrMissing } from "@/lib/waitlist";
import { consumeRateLimit, rateLimitResponse } from "@/lib/request-security";
import { ReferralError, referralSummary, validateReferral } from "@/lib/referrals";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const PRIVATE = { "Cache-Control": "private, no-store" };

export async function GET() {
  try {
    const identity = await getViewerIdentity();
    if (!identity || identity.needsMfa) {
      return NextResponse.json({ authenticated: false, eligible: false }, { headers: PRIVATE });
    }
    return NextResponse.json({ authenticated: true, ...(await referralSummary(identity.user.id)) }, { headers: PRIVATE });
  } catch (error) {
    console.error("Referral summary failed", error instanceof Error ? error.message : "database error");
    return NextResponse.json({ error: "Не удалось загрузить приглашения. Попробуйте позже." }, { status: 503, headers: PRIVATE });
  }
}

export async function POST(request: Request) {
  if (!sameOriginOrMissing(request)) return NextResponse.json({ error: "Запрос отклонён." }, { status: 403, headers: PRIVATE });
  if (Number(request.headers.get("content-length") ?? 0) > 4096) {
    return NextResponse.json({ error: "Введите реферальную ссылку или код приглашения." }, { status: 413, headers: PRIVATE });
  }
  const limit = await consumeRateLimit(request, { scope: "referral-validate", limit: 30, windowSeconds: 60 });
  if (!limit.allowed) return rateLimitResponse(limit, "Слишком много проверок приглашения. Попробуйте позже.");
  let body: { code?: unknown } | null = null;
  const reader = request.body?.getReader();
  if (reader) {
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 4096) {
          await reader.cancel();
          return NextResponse.json({ error: "Введите реферальную ссылку или код приглашения." }, { status: 413, headers: PRIVATE });
        }
        chunks.push(value);
      }
      body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      body = null;
    } finally {
      reader.releaseLock();
    }
  }
  try {
    return NextResponse.json({ valid: true, ...(await validateReferral(body?.code)) }, { headers: PRIVATE });
  } catch (error) {
    if (error instanceof ReferralError) return NextResponse.json({ error: error.message }, { status: error.status, headers: PRIVATE });
    console.error("Referral check failed", error instanceof Error ? error.message : "database error");
    return NextResponse.json({ error: "Не удалось проверить приглашение. Попробуйте позже." }, { status: 503, headers: PRIVATE });
  }
}
