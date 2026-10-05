import { NextResponse } from "next/server";
import { getAdminUser, sameOriginOrMissing } from "@/lib/waitlist";
import { earlyAudiences, PlusPerkError, setEarlyAudience } from "@/lib/plus-perks";
import { EARLY_FEATURES } from "@/lib/plus-style";

export const dynamic = "force-dynamic";
const PRIVATE = { "Cache-Control": "no-store" };

/* Ранний доступ: кому открыта каждая новая функция. Меняет только владелец. */
export async function GET() {
  if (!(await getAdminUser())) return NextResponse.json({ error: "Требуется вход администратора." }, { status: 401, headers: PRIVATE });
  const audiences = await earlyAudiences();
  return NextResponse.json({ features: EARLY_FEATURES.map((feature) => ({ ...feature, audience: audiences[feature.key] })) }, { headers: PRIVATE });
}

export async function PUT(request: Request) {
  if (!sameOriginOrMissing(request)) return NextResponse.json({ error: "Запрос отклонён." }, { status: 403, headers: PRIVATE });
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Требуется вход администратора." }, { status: 401, headers: PRIVATE });
  if (admin.profile.role !== "owner") return NextResponse.json({ error: "Ранний доступ настраивает только владелец." }, { status: 403, headers: PRIVATE });
  const body = await request.json().catch(() => null) as { key?: unknown; audience?: unknown } | null;
  try {
    await setEarlyAudience(String(body?.key ?? ""), String(body?.audience ?? ""), admin.profile.display_name);
    return NextResponse.json({ ok: true }, { headers: PRIVATE });
  } catch (error) {
    if (error instanceof PlusPerkError) return NextResponse.json({ error: error.message }, { status: error.status, headers: PRIVATE });
    console.error("Early access update failed", error);
    return NextResponse.json({ error: "Не удалось сохранить." }, { status: 500, headers: PRIVATE });
  }
}
