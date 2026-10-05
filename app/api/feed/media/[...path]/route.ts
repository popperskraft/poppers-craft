import { loadFeedMedia, verifyFeedMediaUrl } from "@/lib/feed-media";
import { parseByteRange } from "@/lib/http-range";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* Картинки и видео ленты по подписанной ссылке (lib/feed-media.ts). */

async function serve(request: Request, segments: string[], withBody: boolean) {
  const path = segments.join("/");
  const url = new URL(request.url);
  if (!verifyFeedMediaUrl(path, url.searchParams.get("e"), url.searchParams.get("s"))) {
    return new Response("Not found", { status: 404 });
  }
  const media = await loadFeedMedia(path);
  if (!media) return new Response("Not found", { status: 404 });

  const size = media.body.byteLength;
  const range = parseByteRange(request.headers.get("range"), size);
  if (range === "invalid") {
    return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
  }

  const headers = new Headers({
    "Content-Type": media.type,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=3600",
    "X-Content-Type-Options": "nosniff",
  });

  if (range) {
    headers.set("Content-Range", `bytes ${range.start}-${range.end}/${size}`);
    headers.set("Content-Length", String(range.end - range.start + 1));
    return new Response(withBody ? media.body.slice(range.start, range.end + 1) : null, { status: 206, headers });
  }

  headers.set("Content-Length", String(size));
  return new Response(withBody ? media.body : null, { status: 200, headers });
}

export async function GET(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  return serve(request, (await params).path, true);
}

export async function HEAD(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  return serve(request, (await params).path, false);
}
