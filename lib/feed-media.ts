import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { siteUrl } from "@/lib/mail";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/* Картинки и видео ленты.

   Раньше страница получала подписанную ссылку прямо в Supabase Storage, и
   каждый просмотр скачивал файл оттуда заново. Видео в ленте и в карточке
   игрока запускается само, так что один ролик на 3–4 МБ съедал месячный
   лимит трафика бесплатного тарифа. Теперь файлы отдаёт сам сайт: из
   хранилища файл скачивается один раз и дальше лежит в памяти процесса.

   Ссылки подписаны ключом сервера и живут 1–2 часа, как прежние ссылки
   Supabase: смотреть можно только по ссылке, выданной участнику на странице.
   В пределах часа ссылка одна и та же, поэтому браузер берёт файл из кэша. */

const BUCKET = "pc-feed-images"; // FEED_BUCKET из lib/community.ts

const TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  mp4: "video/mp4",
  webm: "video/webm",
};

// Такие пути создаёт app/api/feed/posts: «<id игрока>/<uuid>.<расширение>».
const PATH_PATTERN = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|png|webp|gif|mp4|webm)$/;

const HOUR = 60 * 60;
const MAX_TOTAL_BYTES = 96 * 1024 * 1024;
const MAX_FILE_BYTES = 12 * 1024 * 1024;

type FeedMedia = { body: ArrayBuffer; type: string };

const cache = new Map<string, FeedMedia>(); // порядок вставки = давность использования
const pending = new Map<string, Promise<FeedMedia | null>>();
// Файлы удалённых постов: пути уникальны, поэтому больше их не отдаём.
const forgotten = new Set<string>();
let cachedBytes = 0;

function signingKey() {
  const secret = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error("Supabase server environment variables are missing.");
  return createHmac("sha256", secret).update("pc-feed-media:v1").digest();
}

function signature(path: string, expires: number) {
  return createHmac("sha256", signingKey()).update(`${path}\n${expires}`).digest("base64url");
}

export function feedMediaUrl(path: string) {
  const expires = (Math.floor(Date.now() / 1000 / HOUR) + 2) * HOUR;
  // Полный адрес: приложение на iPhone не умеет относительные ссылки.
  return `${siteUrl()}/api/feed/media/${path}?e=${expires}&s=${signature(path, expires)}`;
}

export function verifyFeedMediaUrl(path: string, expires: string | null, given: string | null) {
  if (!PATH_PATTERN.test(path) || !expires || !given) return false;
  const expiresAt = Number(expires);
  const now = Date.now() / 1000;
  if (!Number.isSafeInteger(expiresAt) || expiresAt < now || expiresAt > now + 3 * HOUR) return false;
  const expected = Buffer.from(signature(path, expiresAt));
  const received = Buffer.from(given);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

function remember(path: string, media: FeedMedia) {
  if (media.body.byteLength > MAX_FILE_BYTES) return;
  cache.set(path, media);
  cachedBytes += media.body.byteLength;
  for (const [key, old] of cache) {
    if (cachedBytes <= MAX_TOTAL_BYTES) break;
    cache.delete(key);
    cachedBytes -= old.body.byteLength;
  }
}

async function download(path: string): Promise<FeedMedia | null> {
  const { data, error } = await createSupabaseAdminClient().storage.from(BUCKET).download(path);
  if (error || !data) return null;
  const media = { body: await data.arrayBuffer(), type: TYPES[path.slice(path.lastIndexOf(".") + 1)] };
  if (forgotten.has(path)) return null;
  remember(path, media);
  return media;
}

export async function loadFeedMedia(path: string): Promise<FeedMedia | null> {
  if (forgotten.has(path)) return null;
  const hit = cache.get(path);
  if (hit) {
    cache.delete(path);
    cache.set(path, hit);
    return hit;
  }
  let job = pending.get(path);
  if (!job) {
    job = download(path).finally(() => pending.delete(path));
    pending.set(path, job);
  }
  return job;
}

export function forgetFeedMedia(paths: string[]) {
  for (const path of paths) {
    forgotten.add(path);
    const entry = cache.get(path);
    if (!entry) continue;
    cache.delete(path);
    cachedBytes -= entry.body.byteLength;
  }
}
