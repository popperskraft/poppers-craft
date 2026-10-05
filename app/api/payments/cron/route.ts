import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { chargeDueSubscriptions, handleExpiredSubscriptions, remindEndingSubscriptions, syncFounders, syncOpenPayments } from "@/lib/payments";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/* Вызывается с сервера по расписанию (bin/payments-cron.sh): автосписания
   подписки, сверка зависших платежей, окончание подписок и отрезков HYPE,
   письма «подписка скоро закончится» и места первых 10 игроков
   (страховка к триггеру в базе). */
export async function POST(request: Request) {
  const expected = process.env.PAYMENTS_CRON_SECRET ?? "";
  const supplied = request.headers.get("x-cron-key") ?? "";
  if (expected.length < 32 || expected.length !== supplied.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(supplied))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const result: Record<string, unknown> = {};
  for (const [name, task] of [
    ["sync", syncOpenPayments],
    ["renew", chargeDueSubscriptions],
    ["expire", handleExpiredSubscriptions],
    ["remind", remindEndingSubscriptions],
    ["founders", syncFounders],
  ] as const) {
    try {
      result[name] = await task();
    } catch (error) {
      console.error(`Payments cron ${name} failed`, error instanceof Error ? error.message : error);
      result[name] = { error: true };
    }
  }
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}
