import "server-only";
import { mkdir, open, rename } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

// Durable intent before the database commit. The worker checks the committed
// publication itself; an unsuccessful save can never announce an unpublished article.
export async function queueWikiPublication(slug: string) {
  if (!/^[a-z0-9][a-z0-9-]{0,118}$/.test(slug)) throw new Error("Invalid wiki slug");
  const directory = process.env.WIKI_NOTIFICATION_DIR || "/home/stepan/popperscraft/wiki-notifications";
  await mkdir(directory, { recursive: true, mode: 0o750 });
  const id = randomUUID();
  const temporary = join(directory, `${id}.pending`);
  const file = await open(temporary, "wx", 0o640);
  try {
    await file.writeFile(JSON.stringify({ version: 1, slug, createdAt: new Date().toISOString() }));
    await file.sync();
  } finally { await file.close(); }
  await rename(temporary, join(directory, `${id}.json`));
  const folder = await open(directory, "r");
  try { await folder.sync(); } finally { await folder.close(); }
}
