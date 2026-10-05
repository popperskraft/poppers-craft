import { NextResponse } from "next/server";
import {
  listLauncherReleases,
  setLauncherReleaseArchived,
  storeLauncherRelease,
} from "@/lib/launcher-releases";
import { getAdminUser, sameOriginOrMissing } from "@/lib/waitlist";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await getAdminUser())) {
    return NextResponse.json({ error: "Нужен вход администратора." }, { status: 401 });
  }
  return NextResponse.json({ releases: await listLauncherReleases({ includeArchived: true }) });
}

export async function POST(request: Request) {
  const admin = await getAdminUser();
  if (!admin || !sameOriginOrMissing(request)) {
    return NextResponse.json({ error: "Нет доступа." }, { status: 403 });
  }
  /* Файл лаунчера скачивают все игроки — выкладывать и снимать версии
     может только владелец. */
  if (admin.profile.role !== "owner") {
    return NextResponse.json({ error: "Версии лаунчера меняет только владелец." }, { status: 403 });
  }

  const url = new URL(request.url);
  const contentLength = request.headers.get("content-length");
  try {
    const release = await storeLauncherRelease({
      platform: url.searchParams.get("platform") ?? "",
      installer: url.searchParams.get("installer") ?? "",
      version: url.searchParams.get("version") ?? "",
      notes: url.searchParams.get("notes") ?? "",
      originalName: url.searchParams.get("filename") ?? "",
      body: request.body,
      createdBy: `${admin.profile.display_name} (${admin.user.email ?? admin.user.id})`,
      declaredSize: contentLength ? Number(contentLength) : null,
    });
    return NextResponse.json({ release }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось загрузить файл.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function PATCH(request: Request) {
  const admin = await getAdminUser();
  if (!admin || !sameOriginOrMissing(request)) {
    return NextResponse.json({ error: "Нет доступа." }, { status: 403 });
  }
  /* Файл лаунчера скачивают все игроки — выкладывать и снимать версии
     может только владелец. */
  if (admin.profile.role !== "owner") {
    return NextResponse.json({ error: "Версии лаунчера меняет только владелец." }, { status: 403 });
  }
  const body = await request.json().catch(() => null);
  const id = String(body?.id ?? "").trim();
  const action = String(body?.action ?? "");
  if (!id || !["archive", "restore"].includes(action)) {
    return NextResponse.json({ error: "Некорректное действие." }, { status: 400 });
  }
  const release = await setLauncherReleaseArchived(
    id,
    action === "archive",
    `${admin.profile.display_name} (${admin.user.email ?? admin.user.id})`,
  );
  if (!release) return NextResponse.json({ error: "Версия не найдена." }, { status: 404 });
  return NextResponse.json({ release });
}
