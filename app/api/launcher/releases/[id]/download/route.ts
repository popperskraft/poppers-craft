import { Readable } from "node:stream";
import { getActiveLauncherRelease, launcherReleaseFile } from "@/lib/launcher-releases";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function contentDisposition(fileName: string) {
  const ascii = fileName.replace(/[^a-zA-Z0-9._-]/g, "_") || "PoppersCraft-Launcher";
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

function parseRange(value: string | null, size: number) {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match) return { invalid: true } as const;
  const startText = match[1];
  const endText = match[2];
  if (!startText && !endText) return { invalid: true } as const;
  const start = startText ? Number(startText) : Math.max(0, size - Number(endText));
  let end = endText ? Number(endText) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || start >= size) {
    return { invalid: true } as const;
  }
  end = Math.min(end, size - 1);
  return { start, end, invalid: false } as const;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const release = await getActiveLauncherRelease((await params).id);
  if (!release) return new Response("Версия не найдена или снята с публикации.", { status: 404 });

  try {
    const file = await launcherReleaseFile(release);
    const size = file.fileStat.size;
    const range = parseRange(request.headers.get("range"), size);
    if (range?.invalid) {
      return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    }

    const start = range?.start;
    const end = range?.end;
    const length = start === undefined || end === undefined ? size : end - start + 1;
    const nodeStream = file.stream(start, end);
    const headers = new Headers({
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, max-age=0, must-revalidate",
      "Content-Disposition": contentDisposition(release.originalName),
      "Content-Length": String(length),
      "Content-Type": release.contentType,
      ETag: `"${release.sha256}"`,
      "X-Content-Type-Options": "nosniff",
    });
    if (start !== undefined && end !== undefined) headers.set("Content-Range", `bytes ${start}-${end}/${size}`);
    return new Response(Readable.toWeb(nodeStream) as ReadableStream, {
      status: range ? 206 : 200,
      headers,
    });
  } catch {
    return new Response("Файл этой версии временно недоступен.", { status: 404 });
  }
}
