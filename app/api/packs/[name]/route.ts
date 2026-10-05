import { readFile } from "node:fs/promises";
import path from "node:path";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/* Ресурс-пак игрового сервера с моделями FANKOPOP (r097). Пак лежит вне
   выпусков лаунчера (/home/stepan/popperscraft/resource-packs), чтобы новый
   выпуск лаунчера его не затёр; ссылку и sha1 указывает server.properties.
   Отдаются только файлы popperscraft-funko-<12 hex>.zip. */
const PACKS_DIR = process.env.POPPERSCRAFT_PACKS_DIR || "/home/stepan/popperscraft/resource-packs";
const NAME = /^popperscraft-funko-[0-9a-f]{12}\.zip$/;

export async function GET(_request: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  if (!NAME.test(name)) return new Response("Not found", { status: 404 });
  try {
    const data = await readFile(path.join(PACKS_DIR, name));
    return new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Length": String(data.byteLength),
        /* Имя содержит хэш — файл не меняется. */
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
