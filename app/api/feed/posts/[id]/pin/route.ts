import { NextResponse } from "next/server";
import { getCommunityViewer } from "@/lib/community";
import { sameOriginOrMissing } from "@/lib/waitlist";
import { PlusPerkError, togglePinnedPost } from "@/lib/plus-perks";

/* Закрепить свой пост в профиле или открепить его (HYPE). */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!sameOriginOrMissing(request)) return NextResponse.json({ error: "Недопустимый запрос." }, { status: 403 });
  const viewer = await getCommunityViewer();
  if (!viewer) return NextResponse.json({ error: "Войдите в аккаунт." }, { status: 401 });
  const id = Number((await params).id);
  if (!Number.isSafeInteger(id)) return NextResponse.json({ error: "Пост не найден." }, { status: 404 });
  try {
    return NextResponse.json({ ok: true, ...(await togglePinnedPost(viewer.user.id, id)) });
  } catch (error) {
    if (error instanceof PlusPerkError) return NextResponse.json({ error: error.message, plusRequired: error.plusRequired }, { status: error.status });
    console.error("Pin toggle failed", error);
    return NextResponse.json({ error: "Не удалось закрепить пост." }, { status: 500 });
  }
}
