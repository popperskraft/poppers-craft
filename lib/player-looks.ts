import "server-only";

import { randomUUID } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { validatePlayerSkin } from "@/lib/player-skins";
import { LOOKS_LIMIT, LOOKS_LIMIT_HYPE, looksLimitFor, type PlusTier } from "@/lib/plus-style";

/* Сохранённые образы игрока: три без подписки, шесть с PLUS и двенадцать
   с HYPE. Сам рисунок лежит в хранилище
   отдельным файлом, а короткий список — в метаданных аккаунта, чтобы страница
   профиля не тянула картинки ради одних названий. */

export const LOOKS_BUCKET = "pc-player-looks";
/* Хранится до лимита старшего тарифа: после окончания подписки лишние
   образы остаются, но надеть их можно только с подпиской. */
export const MAX_STORED_LOOKS = LOOKS_LIMIT_HYPE;
/* Сколько образов можно держать: без подписки, с PLUS и с HYPE (вдвое больше). */
export const looksLimit = (tier: PlusTier | null | undefined) => (tier ? looksLimitFor(tier) : LOOKS_LIMIT);
export const MAX_LOOK_BYTES = 400 * 1024;

export type LookKind = "human" | "pony";

export type LookEntry = {
  id: string;
  name: string;
  kind: LookKind;
  updatedAt: string;
  model?: "classic" | "slim";
  race?: string;
  size?: string;
  tailLength?: string;
  snout?: string;
};

export type LookPayload = {
  kind: LookKind;
  skinBase64?: string;
  pixelsBase64?: string;
};

export function readLooks(metadata: Record<string, unknown> | null | undefined): LookEntry[] {
  const raw = metadata?.player_looks;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((entry): entry is LookEntry =>
      Boolean(entry)
      && typeof entry === "object"
      && typeof (entry as LookEntry).id === "string"
      && ((entry as LookEntry).kind === "human" || (entry as LookEntry).kind === "pony"))
    .slice(0, MAX_STORED_LOOKS);
}

export function normalizeLookName(value: unknown, fallback: string) {
  const name = String(value ?? "").replace(/\s+/g, " ").trim().slice(0, 40);
  return name || fallback;
}

export function newLookId() {
  return randomUUID();
}

function lookPath(userId: string, id: string) {
  return `${userId}/${id}.json`;
}

async function ensureBucket() {
  const admin = createSupabaseAdminClient();
  const { data } = await admin.storage.getBucket(LOOKS_BUCKET);
  if (data) return;
  const { error } = await admin.storage.createBucket(LOOKS_BUCKET, {
    public: false,
    fileSizeLimit: `${MAX_LOOK_BYTES}`,
    allowedMimeTypes: ["application/json"],
  });
  if (error && !/already exists/i.test(error.message)) throw error;
}

export function validateLookPayload(payload: LookPayload) {
  if (payload.kind === "human") {
    if (!payload.skinBase64) throw new Error("Скин не найден.");
    validatePlayerSkin(Buffer.from(payload.skinBase64, "base64"));
    return;
  }
  if (!payload.pixelsBase64) throw new Error("Пони-образ не найден.");
  /* Текстура пони — ровно 64×64 пикселя RGBA. */
  if (Buffer.from(payload.pixelsBase64, "base64").length !== 16_384) {
    throw new Error("Пони-образ повреждён.");
  }
}

export async function writeLookPayload(userId: string, id: string, payload: LookPayload) {
  validateLookPayload(payload);
  await ensureBucket();
  const body = Buffer.from(JSON.stringify(payload));
  if (body.length > MAX_LOOK_BYTES) throw new Error("Образ слишком большой.");
  const { error } = await createSupabaseAdminClient().storage
    .from(LOOKS_BUCKET)
    .upload(lookPath(userId, id), body, { contentType: "application/json", upsert: true });
  if (error) throw error;
}

export async function readLookPayload(userId: string, id: string): Promise<LookPayload | null> {
  const { data, error } = await createSupabaseAdminClient().storage
    .from(LOOKS_BUCKET)
    .download(lookPath(userId, id));
  if (error || !data) return null;
  try {
    const payload = JSON.parse(await data.text()) as LookPayload;
    validateLookPayload(payload);
    return payload;
  } catch {
    return null;
  }
}

export async function dropLookPayload(userId: string, id: string) {
  await createSupabaseAdminClient().storage.from(LOOKS_BUCKET).remove([lookPath(userId, id)]);
}

export async function saveLooksIndex(
  userId: string,
  metadata: Record<string, unknown> | null | undefined,
  looks: LookEntry[],
) {
  const { error } = await createSupabaseAdminClient().auth.admin.updateUserById(userId, {
    user_metadata: { ...(metadata ?? {}), player_looks: looks.slice(0, MAX_STORED_LOOKS) },
  });
  if (error) throw error;
}
