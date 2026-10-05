import { NextResponse } from "next/server";
import { getCommunityViewer } from "@/lib/community";
import { getViewerIdentity, sameOriginOrMissing } from "@/lib/waitlist";
import { consumeRateLimit, rateLimitResponse } from "@/lib/request-security";
import {
  dropLookPayload,
  looksLimit,
  newLookId,
  normalizeLookName,
  readLookPayload,
  readLooks,
  saveLooksIndex,
  writeLookPayload,
  type LookEntry,
  type LookKind,
} from "@/lib/player-looks";
import { ModelServiceError, callModelService } from "@/lib/model-service";
import { activeHumanSkin, downloadWardrobeSkin } from "@/lib/skin-wardrobe";
import { plusState } from "@/lib/plus-perks";
import { LOOKS_LIMIT, LOOKS_LIMIT_HYPE, LOOKS_LIMIT_PLUS } from "@/lib/plus-style";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "private, no-store" };
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: NO_STORE });

async function owner() {
  const identity = await getViewerIdentity();
  if (!identity || identity.needsMfa) return null;
  return getCommunityViewer({ identity, allowAuthenticated: true });
}

const KIND_LABEL: Record<LookKind, string> = { human: "Человек", pony: "Пони" };

/* Сбой проверки подписки не должен ломать гардероб — считаем, что подписки нет. */
const subscription = async (userId: string) =>
  await plusState(userId).catch(() => ({ active: false, tier: "plus" as const, hype: false }));

export async function GET() {
  const viewer = await owner();
  if (!viewer) return reply({ error: "Войдите в аккаунт PoppersCraft.", loginRequired: true }, 401);

  const entries = readLooks(viewer.user.user_metadata);
  const looks = await Promise.all(entries.map(async (entry) => ({
    ...entry,
    payload: await readLookPayload(viewer.user.id, entry.id),
  })));

  let mode: string | null = null;
  try {
    mode = (await callModelService(viewer.profile.login)).mode;
  } catch {
    /* Сервер моделей мог быть недоступен — список образов от этого не зависит. */
  }

  const state = await subscription(viewer.user.id);
  const max = state.active ? looksLimit(state.tier) : LOOKS_LIMIT;
  /* Образы сверх лимита остаются, но надеть их нельзя. */
  return reply({
    looks: looks.map((look, index) => ({ ...look, locked: index >= max })).filter((look) => look.payload),
    max,
    plus: state.active,
    tier: state.active ? state.tier : null,
    mode,
  });
}

export async function POST(request: Request) {
  if (!sameOriginOrMissing(request)) return reply({ error: "Запрос отклонён." }, 403);
  const viewer = await owner();
  if (!viewer) return reply({ error: "Войдите в аккаунт PoppersCraft.", loginRequired: true }, 401);

  const limit = await consumeRateLimit(request, {
    scope: "player-looks-save",
    key: viewer.user.id,
    limit: 30,
    windowSeconds: 60 * 60,
  });
  if (!limit.allowed) return rateLimitResponse(limit, "Слишком много сохранений. Попробуйте позже.");

  const body = await request.json().catch(() => null);
  const kind: LookKind = body?.kind === "human" ? "human" : "pony";
  const entries = readLooks(viewer.user.user_metadata);
  const state = await subscription(viewer.user.id);
  const maxLooks = state.active ? looksLimit(state.tier) : LOOKS_LIMIT;
  if (entries.length >= maxLooks) {
    return reply({
      error: state.hype
        ? `Сохранено уже ${maxLooks} образов — это максимум. Удалите один, чтобы освободить место.`
        : state.active
          ? `Сохранено уже ${maxLooks} образов. С тарифом HYPE мест вдвое больше — ${LOOKS_LIMIT_HYPE}.`
          : `Сохранено уже ${entries.length} образа. С подпиской можно хранить ${LOOKS_LIMIT_PLUS}, а с HYPE — ${LOOKS_LIMIT_HYPE}.`,
      plusRequired: !state.hype,
    }, 409);
  }

  const id = newLookId();
  const name = normalizeLookName(body?.name, `${KIND_LABEL[kind]} ${entries.length + 1}`);
  const entry: LookEntry = { id, name, kind, updatedAt: new Date().toISOString() };

  try {
    if (kind === "human") {
      const profile=await callModelService(viewer.profile.login),skin=activeHumanSkin(profile);
      if(!skin)return reply({error:"У аккаунта пока нет сохранённого скина человека."},400);
      const bytes=await downloadWardrobeSkin(skin.skinUrl);
      entry.model=skin.model??"classic";
      await writeLookPayload(viewer.user.id, id, { kind, skinBase64: Buffer.from(bytes).toString("base64") });
    } else {
      const profile = await callModelService(viewer.profile.login);
      if (!profile.pixelsBase64) return reply({ error: "У аккаунта пока нет сохранённого пони." }, 400);
      entry.race = profile.race;
      entry.size = profile.size;
      /* Длина хвоста и форма мордочки приходят вместе с профилем — без них
         надетый образ вернулся бы к значениям по умолчанию. */
      entry.tailLength = (profile as { tailLength?: string }).tailLength;
      entry.snout = (profile as { snout?: string }).snout;
      await writeLookPayload(viewer.user.id, id, { kind, pixelsBase64: profile.pixelsBase64 });
    }

    await saveLooksIndex(viewer.user.id, viewer.user.user_metadata, [...entries, entry]);
  } catch (error) {
    if (error instanceof ModelServiceError) return reply({ error: error.message }, error.status);
    const message = error instanceof Error && /^(Скин|Размер|Загрузите|Образ|Пони)/.test(error.message)
      ? error.message
      : "Не удалось сохранить образ.";
    return reply({ error: message }, 500);
  }

  return reply({ ok: true, id, message: `Образ «${name}» сохранён.` });
}

export async function DELETE(request: Request) {
  if (!sameOriginOrMissing(request)) return reply({ error: "Запрос отклонён." }, 403);
  const viewer = await owner();
  if (!viewer) return reply({ error: "Войдите в аккаунт PoppersCraft.", loginRequired: true }, 401);

  const id = new URL(request.url).searchParams.get("id") ?? "";
  const entries = readLooks(viewer.user.user_metadata);
  const kept = entries.filter((entry) => entry.id !== id);
  if (kept.length === entries.length) return reply({ error: "Такой образ не найден." }, 404);

  try {
    await saveLooksIndex(viewer.user.id, viewer.user.user_metadata, kept);
    await dropLookPayload(viewer.user.id, id);
  } catch {
    return reply({ error: "Не удалось удалить образ. Попробуйте ещё раз." }, 500);
  }
  return reply({ ok: true, message: "Образ удалён." });
}
