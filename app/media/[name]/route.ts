import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { parseByteRange } from "@/lib/http-range";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* Тяжёлые файлы (видео-инструкции) лежат вне релизов, в одной папке на сервере:
   иначе каждый новый релиз копировал бы их заново. Отдаются кусками по Range,
   поэтому видео начинает играть сразу, а остальное браузер догружает по ходу. */
const MEDIA_DIR = process.env.POPPERSCRAFT_MEDIA_DIR || "/home/stepan/popperscraft/media";

const FILES: Record<string, string> = {
  "launcher-install-macos.mp4": "video/mp4",
  "launcher-install-macos.jpg": "image/jpeg",
  "launcher-install-windows.mp4": "video/mp4",
  "launcher-install-windows.jpg": "image/jpeg",
};

const CACHE = "public, max-age=604800, stale-while-revalidate=86400";

async function serve(request: Request, name: string, withBody: boolean) {
  const type = FILES[name];
  if (!type) return new Response("Not found", { status: 404 });

  const filePath = path.join(MEDIA_DIR, name);
  let size: number;
  try {
    size = (await stat(filePath)).size;
  } catch {
    return new Response("Not found", { status: 404 });
  }

  const range = parseByteRange(request.headers.get("range"), size);
  if (range === "invalid") {
    return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
  }

  const headers = new Headers({
    "Content-Type": type,
    "Accept-Ranges": "bytes",
    "Cache-Control": CACHE,
    "X-Content-Type-Options": "nosniff",
  });

  if (range) {
    headers.set("Content-Range", `bytes ${range.start}-${range.end}/${size}`);
    headers.set("Content-Length", String(range.end - range.start + 1));
    const body = withBody
      ? (Readable.toWeb(createReadStream(filePath, { start: range.start, end: range.end })) as ReadableStream)
      : null;
    return new Response(body, { status: 206, headers });
  }

  headers.set("Content-Length", String(size));
  const body = withBody ? (Readable.toWeb(createReadStream(filePath)) as ReadableStream) : null;
  return new Response(body, { status: 200, headers });
}

export async function GET(request: Request, { params }: { params: Promise<{ name: string }> }) {
  return serve(request, (await params).name, true);
}

export async function HEAD(request: Request, { params }: { params: Promise<{ name: string }> }) {
  return serve(request, (await params).name, false);
}
