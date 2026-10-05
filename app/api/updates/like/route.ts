import { NextResponse } from "next/server";
import { getViewerIdentity, sameOriginOrMissing } from "@/lib/waitlist";
import { consumeRateLimit, rateLimitResponse } from "@/lib/request-security";
import { toggleUpdateLike } from "@/lib/update-likes";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!sameOriginOrMissing(request)) {
    return NextResponse.json({ error: "Запрос отклонён." }, { status: 403 });
  }
  const identity = await getViewerIdentity();
  if (!identity || identity.needsMfa) {
    return NextResponse.json({ error: "Войдите в аккаунт, чтобы поставить лайк.", loginRequired: true }, { status: 401 });
  }

  const limit = await consumeRateLimit(request, {
    scope: "update-like",
    key: identity.user.id,
    limit: 120,
    windowSeconds: 60 * 60,
  });
  if (!limit.allowed) return rateLimitResponse(limit, "Слишком много отметок. Попробуйте позже.");

  const body = await request.json().catch(() => null);
  const id = Number(body?.id);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "Запись не найдена." }, { status: 400 });
  }

  try {
    return NextResponse.json(await toggleUpdateLike(id, identity.user.id));
  } catch (error) {
    /* Без записи в лог такая ошибка видна только как молча гаснущее сердечко. */
    const detail = error as { code?: string; message?: string } | null;
    console.error("update like failed", { id, code: detail?.code, message: detail?.message });
    return NextResponse.json({ error: "Не удалось сохранить лайк. Попробуйте ещё раз." }, { status: 500 });
  }
}
