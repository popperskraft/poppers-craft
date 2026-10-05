import { NextResponse } from "next/server";
import { getApprovedMember, getViewerIdentity } from "@/lib/waitlist";
import { hasServerAccess } from "@/lib/payments";

export const dynamic = "force-dynamic";

/* isMember — доступ к игровому серверу: его проверяет лаунчер при входе и
   продлении сессии. Когда владелец включил «пропуск обязателен», одобренной
   анкеты мало — нужен пропуск. isApproved — одобренная анкета (лента,
   вайтлист и остальные разделы сайта). */
export async function GET() {
  const [viewer, member] = await Promise.all([getViewerIdentity(), getApprovedMember()]);
  const serverAccess = member ? await hasServerAccess(member.userId) : false;

  return NextResponse.json(
    {
      authenticated: Boolean(viewer),
      isAdmin: Boolean(viewer?.adminProfile && !viewer.needsMfa),
      isMember: Boolean(member) && serverAccess,
      isApproved: Boolean(member),
      hidePrideFlags: !viewer || Boolean(viewer.user.app_metadata?.hide_pride_flags),
    },
    {
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
      },
    },
  );
}
