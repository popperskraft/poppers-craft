import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { crc32 } from "node:zlib";
import { readCaptcha } from "@/lib/captcha";
import { minecraftIconChoices } from "@/lib/minecraft-icons";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const allowed = new Set<string>(minecraftIconChoices);
const cache = new Map<string, Buffer>();

/* Каждый ответ получает свой служебный кусок со случайными байтами: пиксели те
   же, а файл каждый раз другой, поэтому картинку не опознать простым
   сравнением контрольной суммы с эталоном из /minecraft-items. */
function withRandomChunk(png: Buffer) {
  const iendAt = png.length - 12;
  if (iendAt <= 8 || png.toString("latin1", iendAt + 4, iendAt + 8) !== "IEND") return png;
  const keyword = Buffer.from("Comment\0", "latin1");
  const data = Buffer.concat([keyword, randomBytes(24)]);
  const chunk = Buffer.alloc(data.length + 12);
  chunk.writeUInt32BE(data.length, 0);
  chunk.write("tEXt", 4, "latin1");
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(chunk.subarray(4, 8 + data.length)) >>> 0, 8 + data.length);
  return Buffer.concat([png.subarray(0, iendAt), chunk, png.subarray(iendAt)]);
}

export async function GET(request: Request) {
  const option = new URL(request.url).searchParams.get("o") ?? "";
  const parsed = readCaptcha(request);
  const name = option && parsed?.icons ? parsed.icons[option] : undefined;
  if (!name || !allowed.has(name) || Number(parsed?.exp) <= Date.now()) {
    return new Response("Not found", { status: 404, headers: { "Cache-Control": "private, no-store" } });
  }

  let png = cache.get(name);
  if (!png) {
    try {
      png = await readFile(path.join(process.cwd(), "public", "minecraft-items", `${name}.png`));
    } catch {
      return new Response("Not found", { status: 404, headers: { "Cache-Control": "private, no-store" } });
    }
    cache.set(name, png);
  }

  const body = withRandomChunk(png);
  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Type": "image/png",
      "Content-Length": String(body.length),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
