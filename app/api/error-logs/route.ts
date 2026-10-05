import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ERROR_SESSION_COOKIE, validErrorSessionId, writeSiteErrorLog } from "@/lib/error-logs";
import { consumeRateLimit, rateLimitResponse } from "@/lib/request-security";
import { getViewerIdentity, sameOriginOrMissing } from "@/lib/waitlist";

const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  maxAge: 30 * 24 * 60 * 60,
  path: "/",
};

async function errorSession() {
  const cookieStore = await cookies();
  const current = validErrorSessionId(cookieStore.get(ERROR_SESSION_COOKIE)?.value);
  return { cookieStore, id: current || randomUUID(), isNew: !current };
}

export async function GET() {
  const session = await errorSession();
  const response = NextResponse.json({ ok: true });
  if (session.isNew) response.cookies.set(ERROR_SESSION_COOKIE, session.id, cookieOptions);
  return response;
}

export async function POST(request: Request) {
  if (!sameOriginOrMissing(request)) return NextResponse.json({ error: "Запрос отклонён." }, { status: 403 });
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > 12 * 1024) {
    return NextResponse.json({ error: "Запись слишком большая." }, { status: 413 });
  }

  const limit = await consumeRateLimit(request, { scope: "site-error-log", limit: 60, windowSeconds: 30 * 60 });
  if (!limit.allowed) return rateLimitResponse(limit, "Слишком много записей журнала.");
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Некорректная запись." }, { status: 400 });

  const session = await errorSession();
  let userId: string | null = null;
  try {
    userId = (await getViewerIdentity())?.user.id ?? null;
  } catch {
    // The logging endpoint must still work for guests and during auth outages.
  }

  try {
    const log = await writeSiteErrorLog({
      ...body,
      sessionId: session.id,
      userId,
      userAgent: request.headers.get("user-agent"),
    });
    const response = NextResponse.json({ ok: true, logId: log.id });
    if (session.isNew) response.cookies.set(ERROR_SESSION_COOKIE, session.id, cookieOptions);
    return response;
  } catch (error) {
    console.error("site error log insert failed", error);
    return NextResponse.json({ error: "Не удалось записать ошибку." }, { status: 500 });
  }
}
