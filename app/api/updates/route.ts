import { NextResponse } from "next/server";
import { getApprovedMember, getViewerIdentity, listSiteUpdates } from "@/lib/waitlist";
import { isUpdateFlag } from "@/lib/update-styles";
import { listUpdateLikes } from "@/lib/update-likes";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [updates, viewer] = await Promise.all([listSiteUpdates(true), getViewerIdentity()]);
    const audience = !viewer ? "guests" : viewer.adminProfile ? "admins" : (await getApprovedMember()) ? "members" : "guests";
    const hidePrideFlags = !viewer || Boolean(viewer.user.app_metadata?.hide_pride_flags);
    const visibleUpdates = updates.filter((update) => !update.board || !update.board.audience || update.board.audience === "everyone" || update.board.audience === audience);
    /* Лайки приходят вместе с записями: отдельный запрос с главной был бы
       вторым обращением к базе ради одного числа. */
    const likes = await listUpdateLikes(viewer?.user.id);
    const withLikes = visibleUpdates.map((update) => ({
      ...(hidePrideFlags && isUpdateFlag(update.color) ? { ...update, color: "pink" } : update),
      likes: likes.counts[update.id] ?? 0,
      likedByMe: likes.mine.includes(update.id),
    }));
    return NextResponse.json({ updates: withLikes, canLike: Boolean(viewer) });
  } catch {
    return NextResponse.json(
      { error: "Не удалось загрузить обновления." },
      { status: 503 },
    );
  }
}
