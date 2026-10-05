import { NextResponse } from "next/server";
import { consumeRateLimit, rateLimitResponse } from "@/lib/request-security";
import { AGREEMENT_VERSION } from "@/lib/user-agreement";
import { getAcceptedAgreementVersion, recordAgreementAcceptance } from "@/lib/user-agreement-store";
import { getViewerIdentity, sameOriginOrMissing } from "@/lib/waitlist";

export const dynamic = "force-dynamic";

/* Принятие пользовательского соглашения.

   Согласие может дать только вошедший пользователь и только за себя:
   идентификатор берётся из сессии, а не из тела запроса, поэтому подписать
   соглашение за другого нельзя. */
export async function POST(request: Request) {
  if (!sameOriginOrMissing(request)) {
    return NextResponse.json({ error: "Недопустимый запрос." }, { status: 403 });
  }
  const viewer = await getViewerIdentity();
  if (!viewer) return NextResponse.json({ error: "Войдите в аккаунт." }, { status: 401 });

  const limit = await consumeRateLimit(request, {
    scope: "agreement-accept",
    key: viewer.user.id,
    limit: 12,
    windowSeconds: 60 * 60,
  });
  if (!limit.allowed) return rateLimitResponse(limit, "Слишком много попыток. Подождите немного.");

  let version = AGREEMENT_VERSION;
  try {
    const body = await request.json();
    /* Версия из запроса принимается только если совпадает с текущей: иначе
       можно было бы записать согласие с несуществующей редакцией. */
    if (body?.version && body.version !== AGREEMENT_VERSION) {
      return NextResponse.json({ error: "Текст соглашения обновился. Обновите страницу." }, { status: 409 });
    }
    version = AGREEMENT_VERSION;
  } catch {
    version = AGREEMENT_VERSION;
  }

  const forwarded = request.headers.get("x-forwarded-for") ?? "";
  /* Берётся последнее значение: его добавляет Caddy, и клиент подделать его
     не может, в отличие от первого. */
  const parts = forwarded.split(",").map((part) => part.trim()).filter(Boolean);
  const ip = parts.length ? parts[parts.length - 1] : "unknown";

  const login = String(
    viewer.user.user_metadata?.minecraft_login
    ?? viewer.user.email?.split("@")[0]
    ?? "",
  );

  try {
    const stored = await recordAgreementAcceptance({
      userId: viewer.user.id,
      login,
      version,
      ip,
      userAgent: request.headers.get("user-agent") ?? "",
    });
    return NextResponse.json({ ok: true, version: stored.version, acceptedAt: stored.acceptedAt });
  } catch {
    return NextResponse.json({ error: "Не удалось сохранить согласие." }, { status: 500 });
  }
}

/* Текущее состояние: какую редакцию принял пользователь. */
export async function GET() {
  const viewer = await getViewerIdentity();
  if (!viewer) return NextResponse.json({ accepted: false, version: null });
  const accepted = await getAcceptedAgreementVersion(viewer.user.id);
  return NextResponse.json({
    accepted: accepted === AGREEMENT_VERSION,
    version: accepted,
    current: AGREEMENT_VERSION,
  }, { headers: { "Cache-Control": "private, no-store" } });
}
