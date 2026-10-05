import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { ensureFeedBucket, FEED_BUCKET, getCommunityViewer } from "@/lib/community";
import { sameOriginOrMissing } from "@/lib/waitlist";
import { consumeRateLimit, rateLimitResponse } from "@/lib/request-security";
import { encodeFeedBody, validatePoll } from "@/lib/feed-content";

export const runtime = "nodejs";

async function hasExpectedSignature(file: File, mimeType: string) {
  const bytes = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const ascii = String.fromCharCode(...bytes);
  if (mimeType === "image/jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mimeType === "image/png") return bytes.slice(0, 8).every((value, index) => value === [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a][index]);
  if (mimeType === "image/gif") return ascii.startsWith("GIF87a") || ascii.startsWith("GIF89a");
  if (mimeType === "image/webp") return ascii.startsWith("RIFF") && ascii.slice(8, 12) === "WEBP";
  if (mimeType === "video/mp4") return ascii.slice(4, 8) === "ftyp";
  if (mimeType === "video/webm") return bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3;
  return false;
}

export async function POST(request: Request) {
  if (!sameOriginOrMissing(request)) return NextResponse.json({ error: "Недопустимый запрос." }, { status: 403 });
  const viewer = await getCommunityViewer();
  if (!viewer) return NextResponse.json({ error: "Войдите в аккаунт." }, { status: 401 });
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 10 * 1024 * 1024) return NextResponse.json({ error: "Файл слишком большой." }, { status: 413 });
  const postLimit = await consumeRateLimit(request, { scope: "feed-post", key: viewer.user.id, limit: 20, windowSeconds: 60 * 60 });
  if (!postLimit.allowed) return rateLimitResponse(postLimit, "Слишком много постов. Попробуйте позже.");

  const form = await request.formData();
  const title = String(form.get("title") ?? "").trim();
  const body = String(form.get("body") ?? "").trim();
  let storedBody: string;
  try {
    const poll = validatePoll(JSON.parse(String(form.get("poll") ?? "null")));
    if (poll?.kind === "text") return NextResponse.json({ error: "Выберите обычный пост или голосование с вариантами." }, { status: 400 });
    if (!body && !poll) return NextResponse.json({ error: "Добавьте текст или опрос." }, { status: 400 });
    storedBody = encodeFeedBody(body, poll);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Проверьте опрос." }, { status: 400 });
  }
  const image = form.get("image");
  if (title.length < 3 || title.length > 120) return NextResponse.json({ error: "Заголовок: от 3 до 120 символов." }, { status: 400 });
  if (body.length > 1600) return NextResponse.json({ error: "Текст: до 1600 символов." }, { status: 400 });
  const globalPostLimit = await consumeRateLimit(request, { scope: "feed-post-global", key: "global", limit: 2_000, windowSeconds: 60 * 60 });
  if (!globalPostLimit.allowed) return rateLimitResponse(globalPostLimit, "Публикация временно занята. Попробуйте позже.");

  const admin = createSupabaseAdminClient();
  let imagePath: string | null = null;
  if (image instanceof File && image.size > 0) {
    const mimeType = image.type.split(";")[0].toLowerCase();
    const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/gif", "video/mp4", "video/webm"];
    const maximumBytes = mimeType.startsWith("video/") || mimeType === "image/gif" ? 4 * 1024 * 1024 : 8 * 1024 * 1024;
    if (image.size > maximumBytes || !allowedTypes.includes(mimeType)) {
      return NextResponse.json({ error: "Можно загрузить JPG, PNG или WEBP до 8 МБ либо беззвучное MP4/WEBM до 4 МБ." }, { status: 400 });
    }
    if (!(await hasExpectedSignature(image, mimeType))) {
      return NextResponse.json({ error: "Файл не соответствует выбранному формату." }, { status: 400 });
    }
    const mediaLimit = await consumeRateLimit(request, { scope: "feed-media-mb", key: viewer.user.id, limit: 160, windowSeconds: 24 * 60 * 60, cost: Math.max(1, Math.ceil(image.size / 1024 / 1024)) });
    if (!mediaLimit.allowed) return rateLimitResponse(mediaLimit, "Дневной лимит загрузок исчерпан.");
    await ensureFeedBucket();
    const extension = mimeType === "image/png" ? "png" : mimeType === "image/webp" ? "webp" : mimeType === "image/gif" ? "gif" : mimeType === "video/mp4" ? "mp4" : mimeType === "video/webm" ? "webm" : "jpg";
    imagePath = `${viewer.user.id}/${randomUUID()}.${extension}`;
    const { error } = await admin.storage.from(FEED_BUCKET).upload(imagePath, image, { contentType: mimeType, upsert: false });
    if (error) return NextResponse.json({ error: "Не удалось загрузить изображение или видео." }, { status: 500 });
  }

  const { error } = await admin.from("pc_feed_posts").insert({ author_id: viewer.user.id, title, body: storedBody, image_path: imagePath });
  if (error) {
    if (imagePath) await admin.storage.from(FEED_BUCKET).remove([imagePath]);
    return NextResponse.json({ error: "Не удалось опубликовать пост." }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
