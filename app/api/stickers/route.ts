import { NextResponse } from "next/server";
import { getCommunityViewer } from "@/lib/community";
import { sameOriginOrMissing } from "@/lib/waitlist";
import { consumeRateLimit, rateLimitResponse } from "@/lib/request-security";
import { PlusPerkError, toggleSticker } from "@/lib/plus-perks";
import { isPlusSticker } from "@/lib/plus-style";

/* Поставить, заменить или убрать стикер под постом ленты или статьёй Wiki. */
export async function PUT(request: Request) {
  if (!sameOriginOrMissing(request)) return NextResponse.json({ error: "Недопустимый запрос." }, { status: 403 });
  const viewer = await getCommunityViewer();
  if (!viewer) return NextResponse.json({ error: "Стикеры ставят игроки сервера — войдите в аккаунт." }, { status: 401 });
  const limit = await consumeRateLimit(request, { scope: "plus-sticker", key: viewer.user.id, limit: 120, windowSeconds: 60 * 60 });
  if (!limit.allowed) return rateLimitResponse(limit, "Слишком много стикеров подряд. Попробуйте позже.");
  const body = await request.json().catch(() => null) as { kind?: unknown; id?: unknown; sticker?: unknown } | null;
  const kind = body?.kind === "feed_post" || body?.kind === "wiki_article" ? body.kind : null;
  const id = Number(body?.id);
  const sticker = body?.sticker;
  if (!kind || !Number.isSafeInteger(id) || !isPlusSticker(sticker)) {
    return NextResponse.json({ error: "Такого стикера нет." }, { status: 400 });
  }
  try {
    return NextResponse.json({ ok: true, ...(await toggleSticker(viewer.user.id, kind, id, sticker)) });
  } catch (error) {
    if (error instanceof PlusPerkError) return NextResponse.json({ error: error.message, plusRequired: error.plusRequired }, { status: error.status });
    console.error("Sticker toggle failed", error);
    return NextResponse.json({ error: "Не удалось поставить стикер." }, { status: 500 });
  }
}
