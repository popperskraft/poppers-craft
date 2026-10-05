import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getCommunityViewer } from "@/lib/community";
import { consumeRateLimit, rateLimitResponse } from "@/lib/request-security";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { sameOriginOrMissing } from "@/lib/waitlist";
import { ensureWikiBucket, WIKI_BUCKET } from "@/lib/wiki";

export const runtime = "nodejs";

async function hasExpectedSignature(file: File, mimeType: string) {
  const bytes = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const ascii = String.fromCharCode(...bytes);
  if (mimeType === "image/jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mimeType === "image/png") return bytes.slice(0, 8).every((value, index) => value === [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a][index]);
  if (mimeType === "image/webp") return ascii.startsWith("RIFF") && ascii.slice(8, 12) === "WEBP";
  return false;
}

export async function POST(request: Request) {
  if (!sameOriginOrMissing(request)) return NextResponse.json({ error: "Недопустимый запрос." }, { status: 403 });
  const viewer = await getCommunityViewer({ allowAuthenticated: true });
  if (!viewer) return NextResponse.json({ error: "Войдите в аккаунт." }, { status: 401 });
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 9 * 1024 * 1024) return NextResponse.json({ error: "Скриншот слишком большой." }, { status: 413 });
  const limit = await consumeRateLimit(request, { scope: "wiki-image-mb", key: viewer.user.id, limit: 128, windowSeconds: 24 * 60 * 60, cost: Math.max(1, Math.ceil(contentLength / 1024 / 1024)) });
  if (!limit.allowed) return rateLimitResponse(limit, "Дневной лимит загрузки скриншотов исчерпан.");

  const form = await request.formData();
  const image = form.get("image");
  if (!(image instanceof File) || !image.size) return NextResponse.json({ error: "Выберите скриншот." }, { status: 400 });
  const mimeType = image.type.split(";")[0].toLowerCase();
  if (image.size > 8 * 1024 * 1024 || !["image/jpeg", "image/png", "image/webp"].includes(mimeType)) {
    return NextResponse.json({ error: "Можно загрузить PNG, JPEG или WEBP размером до 8 МБ." }, { status: 400 });
  }
  if (!(await hasExpectedSignature(image, mimeType))) return NextResponse.json({ error: "Файл не соответствует выбранному формату." }, { status: 400 });

  const extension = mimeType === "image/png" ? "png" : mimeType === "image/webp" ? "webp" : "jpg";
  const storagePath = `uploads/${viewer.user.id}/${new Date().toISOString().slice(0, 10)}/${randomUUID()}.${extension}`;
  const admin = createSupabaseAdminClient();
  await ensureWikiBucket();
  const { error } = await admin.storage.from(WIKI_BUCKET).upload(storagePath, image, { contentType: mimeType, upsert: false });
  if (error) return NextResponse.json({ error: "Не удалось загрузить скриншот." }, { status: 500 });
  const { data: signed } = await admin.storage.from(WIKI_BUCKET).createSignedUrl(storagePath, 3600);
  return NextResponse.json({ image: { id: storagePath, url: signed?.signedUrl ?? null } });
}
