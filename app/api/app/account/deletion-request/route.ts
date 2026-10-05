import { NextResponse } from "next/server";
import { getCommunityViewer } from "@/lib/community";
import { consumeRateLimit, rateLimitResponse } from "@/lib/request-security";
import { notifySupportAdmins } from "@/lib/support-bridge";
import { getViewerIdentity, sameOriginOrMissing } from "@/lib/waitlist";

export const dynamic = "force-dynamic";

const PRIVATE = { "Cache-Control": "private, no-store" } as const;

/* Запрос на удаление аккаунта из приложения.

   Аккаунты на PoppersCraft создаются заявкой на сайте и удаляются админом
   вместе с заявкой (lib/player-account-deletion.ts), поэтому приложение не
   удаляет ничего само: оно отправляет запрос команде, а игрок видит, что
   запрос принят. Так удаление остаётся обратимым до подтверждения человеком. */

export async function POST(request: Request) {
  if (!sameOriginOrMissing(request)) {
    return NextResponse.json({ error: "Запрос отклонён." }, { status: 403, headers: PRIVATE });
  }
  const identity = await getViewerIdentity();
  if (!identity || identity.needsMfa) {
    return NextResponse.json({ error: "Войдите в аккаунт." }, { status: 401, headers: PRIVATE });
  }

  const limit = await consumeRateLimit(request, { scope: "app-account-deletion", limit: 3, windowSeconds: 24 * 60 * 60 });
  if (!limit.allowed) return rateLimitResponse(limit, "Запрос уже отправлен. Мы свяжемся с тобой.");

  const body = (await request.json().catch(() => null)) as { reason?: unknown } | null;
  const reason = typeof body?.reason === "string" ? body.reason.trim().slice(0, 500) : "";

  const viewer = await getCommunityViewer({ identity, allowAuthenticated: true }).catch(() => null);
  const login = viewer?.profile.login ?? String(identity.user.email ?? "").split("@")[0];
  const email = String(identity.user.email ?? "");

  await notifySupportAdmins(
    [
      "Запрос на удаление аккаунта (приложение iPhone)",
      `Ник: ${login}`,
      email.endsWith("@users.popperscraft.org") ? "Почта: не указана" : `Почта: ${email}`,
      `ID: ${identity.user.id}`,
      reason ? `Причина: ${reason}` : "Причина не указана",
      "Удалить можно в админке: заявки → удалить игрока.",
    ].join("\n"),
  );

  return NextResponse.json(
    { ok: true, message: "Запрос отправлен. Аккаунт удалят в течение 7 дней, на почту придёт подтверждение." },
    { headers: PRIVATE },
  );
}
