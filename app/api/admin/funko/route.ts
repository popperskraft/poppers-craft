import { NextResponse } from "next/server";
import { getAdminUser, sameOriginOrMissing } from "@/lib/waitlist";
import { addEventWin, awardFunko, FunkoError, isFunkoFigure, listEventWins, listFunko, redeliverFunko, revokeFunko } from "@/lib/funko";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const PRIVATE = { "Cache-Control": "no-store" };

/* «Управление → FANKOPOP»: список видят все администраторы, выдаёт и
   забирает фигурки только владелец. */
export async function GET() {
  if (!(await getAdminUser())) return NextResponse.json({ error: "Требуется вход администратора." }, { status: 401, headers: PRIVATE });
  try {
    const [figures, wins] = await Promise.all([listFunko(), listEventWins()]);
    return NextResponse.json({ figures, wins }, { headers: PRIVATE });
  } catch (error) {
    console.error("Admin funko list failed", error);
    return NextResponse.json({ error: "Не удалось загрузить фигурки." }, { status: 500, headers: PRIVATE });
  }
}

export async function POST(request: Request) {
  if (!sameOriginOrMissing(request)) return NextResponse.json({ error: "Запрос отклонён." }, { status: 403, headers: PRIVATE });
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Требуется вход администратора." }, { status: 401, headers: PRIVATE });
  if (admin.profile.role !== "owner") return NextResponse.json({ error: "Фигурки выдаёт только владелец." }, { status: 403, headers: PRIVATE });
  const body = await request.json().catch(() => null) as { action?: unknown; login?: unknown; figure?: unknown } | null;
  try {
    if (body?.action === "revoke") {
      if (!isFunkoFigure(body.figure)) return NextResponse.json({ error: "Некорректный запрос." }, { status: 400, headers: PRIVATE });
      await revokeFunko(body.figure, admin.profile.display_name);
      return NextResponse.json({ ok: true }, { headers: PRIVATE });
    }
    /* Победа в официальном ивенте — одно из заданий FANKOPOP. */
    if (body?.action === "event-win") {
      const login = String(body.login ?? "");
      if (!/^@?[a-z0-9_.-]{3,32}$/i.test(login)) return NextResponse.json({ error: "Укажите игровой ник." }, { status: 400, headers: PRIVATE });
      return NextResponse.json({ ok: true, ...(await addEventWin(login, String((body as { note?: unknown }).note ?? ""), admin.profile.display_name)) }, { headers: PRIVATE });
    }
    /* Предмет потерян — игрок снова получит его командой /fankopop. */
    if (body?.action === "redeliver") {
      if (!isFunkoFigure(body.figure)) return NextResponse.json({ error: "Некорректный запрос." }, { status: 400, headers: PRIVATE });
      await redeliverFunko(body.figure);
      return NextResponse.json({ ok: true }, { headers: PRIVATE });
    }
    if (body?.action === "award") {
      const login = String(body.login ?? "");
      if (!/^@?[a-z0-9_.-]{3,32}$/i.test(login)) return NextResponse.json({ error: "Укажите игровой ник." }, { status: 400, headers: PRIVATE });
      const figure = body.figure == null || body.figure === "" ? null : isFunkoFigure(body.figure) ? body.figure : undefined;
      if (figure === undefined) return NextResponse.json({ error: "Некорректный запрос." }, { status: 400, headers: PRIVATE });
      return NextResponse.json({ ok: true, ...(await awardFunko(login, admin.profile.display_name, figure)) }, { headers: PRIVATE });
    }
    return NextResponse.json({ error: "Некорректный запрос." }, { status: 400, headers: PRIVATE });
  } catch (error) {
    if (error instanceof FunkoError) return NextResponse.json({ error: error.message }, { status: error.status, headers: PRIVATE });
    console.error("Admin funko change failed", error);
    return NextResponse.json({ error: "Не удалось изменить фигурку." }, { status: 500, headers: PRIVATE });
  }
}
