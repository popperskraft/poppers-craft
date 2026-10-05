import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const PLAYER_SKINS_BUCKET = "pc-player-skins";
export const MAX_PLAYER_SKIN_BYTES = 256 * 1024;
export type PlayerSkinModel = "classic" | "slim";

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

export function playerSkinPath(userId: string) {
  return `${userId}/skin.png`;
}

export function getPlayerSkinPath(
  userId: string,
  metadata: Record<string, unknown> | null | undefined,
) {
  const expected = playerSkinPath(userId);
  return metadata?.minecraft_skin_path === expected ? expected : null;
}

export function getPlayerSkinModel(
  metadata: Record<string, unknown> | null | undefined,
): PlayerSkinModel {
  return metadata?.minecraft_skin_model === "slim" ? "slim" : "classic";
}

export function getPlayerSkinUpdatedAt(
  metadata: Record<string, unknown> | null | undefined,
  fallback: string,
) {
  const value = metadata?.minecraft_skin_updated_at;
  return typeof value === "string" && value ? value : fallback;
}

export function parsePlayerSkinData(value: unknown) {
  if (typeof value !== "string" || value.length > Math.ceil(MAX_PLAYER_SKIN_BYTES * 4 / 3) + 64) {
    throw new Error("Скин слишком большой.");
  }
  const match = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) throw new Error("Загрузите скин в формате PNG.");
  const bytes = Buffer.from(match[1], "base64");
  validatePlayerSkin(bytes);
  return bytes;
}

export function validatePlayerSkin(bytes: Uint8Array) {
  const buffer = Buffer.from(bytes);
  if (!buffer.length || buffer.length > MAX_PLAYER_SKIN_BYTES) {
    throw new Error("Размер скина должен быть не больше 256 КБ.");
  }
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error("Загрузите настоящий PNG-файл.");
  }
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  if (width !== 64 || ![32, 64].includes(height)) {
    throw new Error("Скин должен иметь размер 64×64 или 64×32 пикселя.");
  }
}

export async function ensurePlayerSkinBucket() {
  const admin = createSupabaseAdminClient();
  const { data } = await admin.storage.getBucket(PLAYER_SKINS_BUCKET);
  if (!data) {
    const { error } = await admin.storage.createBucket(PLAYER_SKINS_BUCKET, {
      public: false,
      fileSizeLimit: "256KB",
      allowedMimeTypes: ["image/png"],
    });
    if (error && !/already exists/i.test(error.message)) throw error;
  }
}

export async function savePlayerSkin({
  userId,
  currentMetadata,
  bytes,
  model,
}: {
  userId: string;
  currentMetadata: Record<string, unknown> | null | undefined;
  bytes: Uint8Array;
  model?: PlayerSkinModel;
}) {
  validatePlayerSkin(bytes);
  await ensurePlayerSkinBucket();
  const admin = createSupabaseAdminClient();
  const path = playerSkinPath(userId);
  const { error: uploadError } = await admin.storage.from(PLAYER_SKINS_BUCKET).upload(path, bytes, {
    contentType: "image/png",
    cacheControl: "0",
    upsert: true,
  });
  if (uploadError) throw uploadError;

  const updatedAt = new Date().toISOString();
  const resolvedModel = model ?? getPlayerSkinModel(currentMetadata);
  const metadata = {
    ...(currentMetadata ?? {}),
    minecraft_skin_path: path,
    minecraft_skin_model: resolvedModel,
    minecraft_skin_updated_at: updatedAt,
  };
  const { error: metadataError } = await admin.auth.admin.updateUserById(userId, {
    user_metadata: metadata,
  });
  if (metadataError) {
    await admin.storage.from(PLAYER_SKINS_BUCKET).remove([path]);
    throw metadataError;
  }
  return { path, model: resolvedModel, updatedAt, metadata };
}

export async function removePlayerSkin(userId: string) {
  await createSupabaseAdminClient().storage
    .from(PLAYER_SKINS_BUCKET)
    .remove([playerSkinPath(userId)]);
}

export async function createPlayerSkinSignedUrl(
  userId: string,
  metadata: Record<string, unknown> | null | undefined,
) {
  const path = getPlayerSkinPath(userId, metadata);
  if (!path) return null;
  const { data, error } = await createSupabaseAdminClient().storage
    .from(PLAYER_SKINS_BUCKET)
    .createSignedUrl(path, 60 * 60);
  return error ? null : data.signedUrl;
}

export async function createPlayerSkinSignedUrls(
  players: Array<{
    userId: string;
    metadata: Record<string, unknown> | null | undefined;
  }>,
) {
  const entries = players.flatMap((player) => {
    const path = getPlayerSkinPath(player.userId, player.metadata);
    return path ? [{ userId: player.userId, path }] : [];
  });
  if (!entries.length) return new Map<string, string>();

  const { data } = await createSupabaseAdminClient().storage
    .from(PLAYER_SKINS_BUCKET)
    .createSignedUrls(entries.map((entry) => entry.path), 60 * 60);
  const urls = new Map<string, string>();
  data?.forEach((signed, index) => {
    if (signed.signedUrl) urls.set(entries[index].userId, signed.signedUrl);
  });
  return urls;
}

/* Сколько раз игрок загружал готовый файл скина. Готовый файл загружается
   один раз — тот, что был при регистрации; дальше скин рисуется в редакторе
   или меняется с тарифом HYPE. Счётчик лежит в app_metadata: user_metadata
   игрок может переписать сам через API Supabase и обнулить его. Если
   счётчика нет, а скин есть, считаем, что одна загрузка уже была. */
export function skinUploadsUsed(
  userId: string,
  metadata: Record<string, unknown> | null | undefined,
  appMetadata: Record<string, unknown> | null | undefined,
) {
  const stored = Number(appMetadata?.skin_uploads);
  if (Number.isFinite(stored) && stored >= 0) return stored;
  return getPlayerSkinPath(userId, metadata) ? 1 : 0;
}

/* Записать счётчик загрузок туда, где его не поменять без сервера. */
export async function recordSkinUpload(userId: string, appMetadata: Record<string, unknown> | null | undefined, used: number) {
  const { error } = await createSupabaseAdminClient().auth.admin.updateUserById(userId, {
    app_metadata: { ...(appMetadata ?? {}), skin_uploads: used },
  });
  if (error) console.error("Skin upload counter was not saved", error.message);
}
