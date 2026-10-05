import { NextResponse } from "next/server";
import { getCommunityViewer } from "@/lib/community";
import { getViewerIdentity, sameOriginOrMissing } from "@/lib/waitlist";
import { consumeRateLimit, rateLimitResponse } from "@/lib/request-security";
import { looksLimit, readLookPayload, readLooks } from "@/lib/player-looks";
import { applyLookWardrobe } from "@/lib/apply-look-wardrobe";
import { ModelServiceError, callModelService } from "@/lib/model-service";
import { canUseCosmetic } from "@/lib/payments";
import { plusState } from "@/lib/plus-perks";
import { LOOKS_LIMIT } from "@/lib/plus-style";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "private, no-store" };
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: NO_STORE });

/* «Надеть» выбирает сохранённый скин или добавляет образ в свободное место. */
export async function POST(request: Request) {
  if (!sameOriginOrMissing(request)) return reply({ error: "Запрос отклонён." }, 403);
  const identity = await getViewerIdentity();
  if (!identity || identity.needsMfa) {
    return reply({ error: "Войдите в аккаунт PoppersCraft.", loginRequired: true }, 401);
  }
  const viewer = await getCommunityViewer({ identity, allowAuthenticated: true });
  if (!viewer) return reply({ error: "Войдите в аккаунт PoppersCraft.", loginRequired: true }, 401);

  const limit = await consumeRateLimit(request, {
    scope: "player-looks-apply",
    key: viewer.user.id,
    limit: 20,
    windowSeconds: 60 * 60,
  });
  if (!limit.allowed) return rateLimitResponse(limit, "Слишком частая смена образа. Попробуйте позже.");

  const body = await request.json().catch(() => null);
  const id = String(body?.id ?? "");
  const looks = readLooks(viewer.user.user_metadata);
  const index = looks.findIndex((look) => look.id === id);
  const entry = looks[index];
  if (!entry) return reply({ error: "Такой образ не найден." }, 404);
  /* Места после третьего открывает подписка: с PLUS их шесть, с HYPE — вдвое больше. */
  const state = await plusState(viewer.user.id).catch(() => ({ active: false, tier: "plus" as const }));
  const allowed = state.active ? looksLimit(state.tier) : LOOKS_LIMIT;
  if (index >= allowed) {
    return reply({
      error: state.active
        ? `Этот образ за пределами вашего тарифа: сейчас доступно ${allowed}. С HYPE мест вдвое больше.`
        : "Этот образ хранится в месте из подписки — надеть его можно с PLUS. Первые три образа доступны всегда.",
      plusRequired: true,
    }, 403);
  }

  const payload = await readLookPayload(viewer.user.id, id);
  if (!payload) return reply({ error: "Файл образа не найден. Сохраните образ заново." }, 404);
  if (payload.kind !== "human" && !(await canUseCosmetic(viewer.user.id, "pony"))) {
    return reply({ error: "Скин пони входит в тариф HYPE. Оформить его можно в «Профиль → Подписка».", plusRequired: true }, 403);
  }

  try {
    const profile = await callModelService(viewer.profile.login);

    await applyLookWardrobe(viewer.profile.login, entry, payload, profile);
    return reply({
      ok: true,
      message: `Надет образ «${entry.name}». Внешность обновится в игре в течение нескольких секунд.`,
    });
  } catch (error) {
    if (error instanceof ModelServiceError) return reply({ error: error.message }, error.status);
    return reply({ error: "Не удалось надеть образ. Попробуйте ещё раз." }, 500);
  }
}
