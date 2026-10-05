import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { getAdminUser, sameOriginOrMissing } from "@/lib/waitlist";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type CacheStatus = {
  activeBuildId: string | null;
  releaseCopies: number;
  runtimeCopies: number;
  protectedCopies: number;
};

async function countDirectories(path: string) {
  try {
    const entries = await readdir(path, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).length;
  } catch {
    return 0;
  }
}

async function getCacheStatus(): Promise<CacheStatus> {
  const releasesRoot = process.env.POPPERS_RELEASES_ROOT?.trim()
    || "/home/stepan/popperscraft/releases";
  const runtimesRoot = process.env.POPPERS_RUNTIMES_ROOT?.trim()
    || "/home/stepan/popperscraft/runtimes";
  const [releaseCopies, runtimeCopies, buildId] = await Promise.all([
    countDirectories(releasesRoot),
    countDirectories(runtimesRoot),
    readFile(join(process.cwd(), ".next", "BUILD_ID"), "utf8").catch(() => null),
  ]);

  return {
    activeBuildId: buildId?.trim() || null,
    releaseCopies,
    runtimeCopies,
    protectedCopies: releaseCopies + runtimeCopies,
  };
}

function noStoreJson(body: Record<string, unknown>, init?: { status?: number; clearCache?: boolean }) {
  const response = NextResponse.json(body, { status: init?.status });
  response.headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
  if (init?.clearCache) response.headers.set("Clear-Site-Data", '"cache"');
  return response;
}

export async function GET() {
  const admin = await getAdminUser();
  if (!admin) return noStoreJson({ error: "Нужен вход администратора." }, { status: 401 });
  return noStoreJson({ status: await getCacheStatus() });
}

export async function POST(request: Request) {
  if (!sameOriginOrMissing(request)) {
    return noStoreJson({ error: "Запрос отклонён." }, { status: 403 });
  }
  const admin = await getAdminUser();
  if (!admin) return noStoreJson({ error: "Нужен вход администратора." }, { status: 401 });

  revalidatePath("/", "layout");
  const purgedAt = new Date().toISOString();
  return noStoreJson(
    {
      message: "Серверный и браузерный кэш обновлены. Резервные копии не затронуты.",
      purgedAt,
      status: await getCacheStatus(),
    },
    { clearCache: true },
  );
}
