import { NextResponse } from "next/server";
import {
  getAdminUser,
  getSiteSettings,
  sameOriginOrMissing,
  setCrashMode,
  setMaintenanceMode,
  setOpeningCountdown,
  triggerSiteRatingPrompt,
} from "@/lib/waitlist";

export async function GET() {
  const user = await getAdminUser();
  if (!user) {
    return NextResponse.json({ error: "Нужен вход администратора." }, { status: 401 });
  }
  return NextResponse.json({ settings: await getSiteSettings() });
}

export async function PATCH(request: Request) {
  if (!sameOriginOrMissing(request)) {
    return NextResponse.json({ error: "Запрос отклонён." }, { status: 403 });
  }
  const user = await getAdminUser();
  if (!user) {
    return NextResponse.json({ error: "Нужен вход администратора." }, { status: 401 });
  }
  const body = await request.json().catch(() => null);
  if (body?.triggerRatingPrompt === true) {
    return NextResponse.json({ settings: await triggerSiteRatingPrompt(user.profile.id) });
  }

  if (user.profile.role !== "owner") {
    return NextResponse.json(
      { error: "Технический режим может менять только владелец." },
      { status: 403 },
    );
  }

  /* Обратный отсчёт до открытия: строка — запуск, null — остановка. */
  if (body && "openingAt" in body) {
    if (body.openingAt === null) {
      return NextResponse.json({ settings: await setOpeningCountdown(null, user.profile.id) });
    }
    const opensAt = typeof body.openingAt === "string" ? Date.parse(body.openingAt) : NaN;
    const now = Date.now();
    /* Запас в 5 секунд оставлен ради проверки: отсчёт можно запустить на
       полминуты и посмотреть церемонию целиком. */
    if (!Number.isFinite(opensAt) || opensAt < now + 5_000 || opensAt > now + 366 * 24 * 60 * 60_000) {
      return NextResponse.json({ error: "Время открытия должно быть хотя бы через 5 секунд и не дальше, чем через год." }, { status: 400 });
    }
    return NextResponse.json({ settings: await setOpeningCountdown(new Date(opensAt).toISOString(), user.profile.id) });
  }

  if (typeof body?.crashMode === "boolean") {
    const settings = await setCrashMode(body.crashMode, user.profile.id);
    return NextResponse.json({ settings });
  }

  if (typeof body?.maintenanceMode !== "boolean") {
    return NextResponse.json({ error: "Некорректное значение." }, { status: 400 });
  }

  const settings = await setMaintenanceMode(
    body.maintenanceMode,
    user.profile.id,
    typeof body?.endsAt === "string" && body.endsAt
      ? new Date(body.endsAt).toISOString()
      : null,
  );
  return NextResponse.json({ settings });
}
