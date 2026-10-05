import { NextResponse } from "next/server";
import { getAdminUser, sameOriginOrMissing } from "@/lib/waitlist";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { adminPaymentOverview, grantPass, grantPlusManual, PaymentError, releaseEarlyPlayer, revokePlusManual, setEarlyPlus, setFounderPass, updatePaymentSettings } from "@/lib/payments";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const PRIVATE = { "Cache-Control": "no-store" };

export async function GET() {
  if (!(await getAdminUser())) return NextResponse.json({ error: "Требуется вход администратора." }, { status: 401, headers: PRIVATE });
  try {
    return NextResponse.json(await adminPaymentOverview(), { headers: PRIVATE });
  } catch (error) {
    console.error("Admin payments overview failed", error);
    return NextResponse.json({ error: "Не удалось загрузить оплату." }, { status: 500, headers: PRIVATE });
  }
}

/* Переключатели оплаты — только владелец. */
export async function PATCH(request: Request) {
  if (!sameOriginOrMissing(request)) return NextResponse.json({ error: "Запрос отклонён." }, { status: 403, headers: PRIVATE });
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Требуется вход администратора." }, { status: 401, headers: PRIVATE });
  if (admin.profile.role !== "owner") return NextResponse.json({ error: "Настройки оплаты меняет только владелец." }, { status: 403, headers: PRIVATE });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const flag = (key: string) => (typeof body?.[key] === "boolean" ? body[key] as boolean : undefined);
  try {
    const result = await updatePaymentSettings({
      paymentsEnabled: flag("paymentsEnabled"),
      passRequired: flag("passRequired"),
      plusRequired: flag("plusRequired"),
    }, admin.profile.display_name);
    return NextResponse.json(result, { headers: PRIVATE });
  } catch (error) {
    if (error instanceof PaymentError) return NextResponse.json({ error: error.message }, { status: error.status, headers: PRIVATE });
    console.error("Payment settings update failed", error);
    return NextResponse.json({ error: "Не удалось сохранить настройки." }, { status: 500, headers: PRIVATE });
  }
}

/* Выдать пропуск вручную (например, оплатили переводом) или — владельцу —
   подарить/отменить PLUS на год первооткрывателю или игроку первой десятки. */
export async function POST(request: Request) {
  if (!sameOriginOrMissing(request)) return NextResponse.json({ error: "Запрос отклонён." }, { status: 403, headers: PRIVATE });
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Требуется вход администратора." }, { status: 401, headers: PRIVATE });
  const body = await request.json().catch(() => null) as { login?: unknown; action?: unknown; userId?: unknown; grant?: unknown; months?: unknown; tier?: unknown } | null;
  /* Выдать или снять подписку (PLUS или HYPE) вручную любому игроку — только владелец. */
  if (body?.action === "plus-grant" || body?.action === "plus-revoke") {
    if (admin.profile.role !== "owner") return NextResponse.json({ error: "Подписку выдаёт только владелец." }, { status: 403, headers: PRIVATE });
    const target = String(body?.login ?? "").trim().toLowerCase().replace(/^@/, "");
    if (!/^[a-z0-9_.-]{3,24}$/.test(target)) return NextResponse.json({ error: "Укажите игровой ник." }, { status: 400, headers: PRIVATE });
    try {
      if (body.action === "plus-revoke") {
        const revoked = await revokePlusManual(target, admin.profile.display_name);
        return NextResponse.json({ ok: true, ...revoked }, { headers: PRIVATE });
      }
      const granted = await grantPlusManual(target, Number(body?.months), admin.profile.display_name, body?.tier === "hype" ? "hype" : "plus");
      return NextResponse.json({ ok: true, ...granted }, { headers: PRIVATE });
    } catch (error) {
      if (error instanceof PaymentError) return NextResponse.json({ error: error.message }, { status: error.status, headers: PRIVATE });
      console.error("Manual PLUS change failed", error);
      return NextResponse.json({ error: "Не удалось изменить подписку." }, { status: 500, headers: PRIVATE });
    }
  }
  /* Освободить место в первой десятке (служебный или ошибочный аккаунт). */
  if (body?.action === "early-release") {
    if (admin.profile.role !== "owner") return NextResponse.json({ error: "Места меняет только владелец." }, { status: 403, headers: PRIVATE });
    const userId = typeof body.userId === "string" && /^[0-9a-f-]{36}$/i.test(body.userId) ? body.userId : "";
    if (!userId) return NextResponse.json({ error: "Некорректный запрос." }, { status: 400, headers: PRIVATE });
    try {
      await releaseEarlyPlayer(userId, admin.profile.display_name);
      return NextResponse.json({ ok: true }, { headers: PRIVATE });
    } catch (error) {
      if (error instanceof PaymentError) return NextResponse.json({ error: error.message }, { status: error.status, headers: PRIVATE });
      console.error("Early slot release failed", error);
      return NextResponse.json({ error: "Не удалось освободить место." }, { status: 500, headers: PRIVATE });
    }
  }
  /* Подарить или забрать бесплатный пропуск у игрока первой десятки (не больше трёх). */
  if (body?.action === "founder-pass") {
    if (admin.profile.role !== "owner") return NextResponse.json({ error: "Пропуск в подарок выдаёт только владелец." }, { status: 403, headers: PRIVATE });
    const userId = typeof body.userId === "string" && /^[0-9a-f-]{36}$/i.test(body.userId) ? body.userId : "";
    if (!userId || typeof body.grant !== "boolean") return NextResponse.json({ error: "Некорректный запрос." }, { status: 400, headers: PRIVATE });
    try {
      const result = await setFounderPass(userId, body.grant, admin.profile.display_name);
      return NextResponse.json({ ok: true, result }, { headers: PRIVATE });
    } catch (error) {
      if (error instanceof PaymentError) return NextResponse.json({ error: error.message }, { status: error.status, headers: PRIVATE });
      console.error("Founder pass change failed", error);
      return NextResponse.json({ error: "Не удалось изменить пропуск." }, { status: 500, headers: PRIVATE });
    }
  }
  if (body?.action === "gift-plus") {
    if (admin.profile.role !== "owner") return NextResponse.json({ error: "PLUS в подарок выдаёт только владелец." }, { status: 403, headers: PRIVATE });
    const userId = typeof body.userId === "string" && /^[0-9a-f-]{36}$/i.test(body.userId) ? body.userId : "";
    if (!userId || typeof body.grant !== "boolean") return NextResponse.json({ error: "Некорректный запрос." }, { status: 400, headers: PRIVATE });
    try {
      const result = await setEarlyPlus(userId, body.grant, admin.profile.display_name);
      return NextResponse.json({ ok: true, result }, { headers: PRIVATE });
    } catch (error) {
      if (error instanceof PaymentError) return NextResponse.json({ error: error.message }, { status: error.status, headers: PRIVATE });
      console.error("PLUS gift change failed", error);
      return NextResponse.json({ error: "Не удалось изменить подарок." }, { status: 500, headers: PRIVATE });
    }
  }
  const login = String(body?.login ?? "").trim().toLowerCase().replace(/^@/, "");
  if (!/^[a-z0-9_.-]{3,24}$/.test(login)) return NextResponse.json({ error: "Укажите игровой ник." }, { status: 400, headers: PRIVATE });
  try {
    const { data } = await createSupabaseAdminClient().from("waitlist_applications").select("user_id").eq("login", login).maybeSingle();
    if (!data?.user_id) return NextResponse.json({ error: "Игрок не найден." }, { status: 404, headers: PRIVATE });
    await grantPass(String(data.user_id), admin.profile.display_name);
    return NextResponse.json({ ok: true }, { headers: PRIVATE });
  } catch (error) {
    if (error instanceof PaymentError) return NextResponse.json({ error: error.message }, { status: error.status, headers: PRIVATE });
    console.error("Manual pass grant failed", error);
    return NextResponse.json({ error: "Не удалось выдать пропуск." }, { status: 500, headers: PRIVATE });
  }
}
