import { NextResponse } from "next/server";
import { getViewerIdentity, sameOriginOrMissing } from "@/lib/waitlist";
import { skinPreviewUrl } from "@/lib/skin-preview";
import { getCommunityViewer } from "@/lib/community";
import { markCelebrationSeen, pendingCelebration } from "@/lib/plus-celebration";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "private, no-store" };

/* Окно «вам подарили PLUS»: сайт спрашивает очередь при заходе игрока. */
export async function GET() {
  const identity = await getViewerIdentity();
  if (!identity || identity.needsMfa) return NextResponse.json({ celebration: null }, { headers: NO_STORE });
  try {
    const celebration = await pendingCelebration(identity.user.id);
    if (!celebration) return NextResponse.json({ celebration: null }, { headers: NO_STORE });
    const viewer = await getCommunityViewer({identity}).catch(() => null);
    const skin = viewer ? skinPreviewUrl(viewer.profile.login) : null;
    return NextResponse.json({ celebration: { ...celebration, skin } }, { headers: NO_STORE });
  } catch (error) {
    /* Поздравление не должно мешать сайту: при сбое просто не показываем. */
    console.error("PLUS celebration read failed", error);
    return NextResponse.json({ celebration: null }, { headers: NO_STORE });
  }
}

export async function POST(request: Request) {
  if (!sameOriginOrMissing(request)) return NextResponse.json({ error: "Запрос отклонён." }, { status: 403, headers: NO_STORE });
  const identity = await getViewerIdentity();
  if (!identity || identity.needsMfa) return NextResponse.json({ error: "Войдите в аккаунт." }, { status: 401, headers: NO_STORE });
  const body = await request.json().catch(() => null);
  const id = Number(body?.id);
  if (!Number.isSafeInteger(id) || id <= 0) return NextResponse.json({ error: "Некорректный запрос." }, { status: 400, headers: NO_STORE });
  try {
    await markCelebrationSeen(identity.user.id, id);
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  } catch (error) {
    console.error("PLUS celebration close failed", error);
    return NextResponse.json({ error: "Не удалось закрыть окно." }, { status: 500, headers: NO_STORE });
  }
}
