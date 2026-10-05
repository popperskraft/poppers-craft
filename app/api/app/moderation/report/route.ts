import { NextResponse } from "next/server";
import { getCommunityViewer } from "@/lib/community";
import { consumeRateLimit, rateLimitResponse } from "@/lib/request-security";
import { notifySupportAdmins } from "@/lib/support-bridge";
import { getViewerIdentity, sameOriginOrMissing } from "@/lib/waitlist";

export const dynamic = "force-dynamic";

const PRIVATE = { "Cache-Control": "private, no-store" } as const;

const KINDS: Record<string, string> = {
  post: "Пост",
  comment: "Комментарий",
  profile: "Профиль",
  message: "Сообщение",
};

/* Жалоба на чужой материал из приложения.

   App Store требует, чтобы в приложении с лентой была кнопка «пожаловаться»,
   а команда отвечала на жалобы. Жалоба уходит админам в Telegram тем же ботом,
   что и обращения в поддержку, — отдельная очередь не нужна. */

export async function POST(request: Request) {
  if (!sameOriginOrMissing(request)) {
    return NextResponse.json({ error: "Запрос отклонён." }, { status: 403, headers: PRIVATE });
  }
  const identity = await getViewerIdentity();
  if (!identity || identity.needsMfa) {
    return NextResponse.json({ error: "Войдите в аккаунт." }, { status: 401, headers: PRIVATE });
  }

  const limit = await consumeRateLimit(request, { scope: "app-report", limit: 20, windowSeconds: 24 * 60 * 60 });
  if (!limit.allowed) return rateLimitResponse(limit, "Слишком много жалоб за сутки. Попробуй позже.");

  const body = (await request.json().catch(() => null)) as
    | { kind?: unknown; id?: unknown; login?: unknown; reason?: unknown }
    | null;
  const kind = KINDS[String(body?.kind ?? "")] ?? "Материал";
  const target = String(body?.id ?? "").slice(0, 64);
  const about = String(body?.login ?? "").slice(0, 64);
  const reason = String(body?.reason ?? "").trim().slice(0, 700);
  if (!target && !about) {
    return NextResponse.json({ error: "Непонятно, на что жалоба." }, { status: 400, headers: PRIVATE });
  }

  const viewer = await getCommunityViewer({ identity, allowAuthenticated: true }).catch(() => null);
  const from = viewer?.profile.login ?? String(identity.user.email ?? "").split("@")[0];

  await notifySupportAdmins(
    [
      `Жалоба из приложения: ${kind}`,
      about ? `На кого: ${about}` : null,
      target ? `ID материала: ${target}` : null,
      `От кого: ${from}`,
      reason ? `Причина: ${reason}` : "Причина не указана",
      "Посмотреть можно в ленте сайта.",
    ]
      .filter(Boolean)
      .join("\n"),
  );

  return NextResponse.json(
    { ok: true, message: "Жалоба отправлена. Команда посмотрит её в ближайшее время." },
    { headers: PRIVATE },
  );
}
