import { NextResponse } from "next/server";
import { getAdminUser, sameOriginOrMissing } from "@/lib/waitlist";
import { createPromoCode, listPromoCodes, PaymentError, setPromoDisabled } from "@/lib/payments";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const PRIVATE = { "Cache-Control": "no-store" };

/* Промокоды: смотрят администраторы, создаёт и выключает только владелец. */
export async function GET() {
  if (!(await getAdminUser())) return NextResponse.json({ error: "Требуется вход администратора." }, { status: 401, headers: PRIVATE });
  try {
    return NextResponse.json({ codes: await listPromoCodes() }, { headers: PRIVATE });
  } catch (error) {
    console.error("Promo list failed", error);
    return NextResponse.json({ error: "Не удалось загрузить промокоды." }, { status: 500, headers: PRIVATE });
  }
}

export async function POST(request: Request) {
  if (!sameOriginOrMissing(request)) return NextResponse.json({ error: "Запрос отклонён." }, { status: 403, headers: PRIVATE });
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Требуется вход администратора." }, { status: 401, headers: PRIVATE });
  if (admin.profile.role !== "owner") return NextResponse.json({ error: "Промокоды создаёт только владелец." }, { status: 403, headers: PRIVATE });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  try {
    const created = await createPromoCode({
      code: String(body?.code ?? ""),
      discount: Number(body?.discount),
      activations: Number(body?.activations),
      /* Пустая дата — код без срока. */
      expiresAt: typeof body?.expiresAt === "string" && body.expiresAt ? new Date(body.expiresAt).toISOString() : null,
      scope: body?.scope === "plus" || body?.scope === "hype" || body?.scope === "pass" ? body.scope : "any",
      note: typeof body?.note === "string" ? body.note : null,
      by: admin.profile.display_name,
    });
    return NextResponse.json({ ok: true, ...created }, { headers: PRIVATE });
  } catch (error) {
    if (error instanceof PaymentError) return NextResponse.json({ error: error.message }, { status: error.status, headers: PRIVATE });
    console.error("Promo create failed", error);
    return NextResponse.json({ error: "Не удалось создать промокод." }, { status: 500, headers: PRIVATE });
  }
}

export async function PATCH(request: Request) {
  if (!sameOriginOrMissing(request)) return NextResponse.json({ error: "Запрос отклонён." }, { status: 403, headers: PRIVATE });
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Требуется вход администратора." }, { status: 401, headers: PRIVATE });
  if (admin.profile.role !== "owner") return NextResponse.json({ error: "Промокоды меняет только владелец." }, { status: 403, headers: PRIVATE });
  const body = await request.json().catch(() => null) as { code?: unknown; disabled?: unknown } | null;
  if (typeof body?.disabled !== "boolean") return NextResponse.json({ error: "Некорректный запрос." }, { status: 400, headers: PRIVATE });
  try {
    const result = await setPromoDisabled(String(body?.code ?? ""), body.disabled, admin.profile.display_name);
    return NextResponse.json({ ok: true, ...result }, { headers: PRIVATE });
  } catch (error) {
    if (error instanceof PaymentError) return NextResponse.json({ error: error.message }, { status: error.status, headers: PRIVATE });
    console.error("Promo update failed", error);
    return NextResponse.json({ error: "Не удалось изменить промокод." }, { status: 500, headers: PRIVATE });
  }
}
