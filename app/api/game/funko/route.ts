import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { claimFunko, funkoProgress, FunkoError, listFunko } from "@/lib/funko";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const PRIVATE = { "Cache-Control": "private, no-store, max-age=0" };

/* Для игровых модов (poppersfunko, будущая плитка FANKOPOP в меню):
   GET — фигурки и их владельцы; GET ?login=ник — ещё и задания игрока с
   прогрессом; POST { login } — забрать фигурку (выданную владельцем или
   случайную за выполненные задания), ответ — какие предметы выдать.
   Ключ тот же, что у /api/launcher/membership. */
function authorized(request: Request) {
  const expected = process.env.POPPERSCRAFT_BROWSER_SECRET ?? "";
  const supplied = request.headers.get("x-popperscraft-browser-key") ?? "";
  if (expected.length < 32 || expected.length !== supplied.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(supplied));
}

const validLogin = (value: string) => /^@?[a-z0-9_.-]{3,32}$/i.test(value);

export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: PRIVATE });
  const login = new URL(request.url).searchParams.get("login") ?? "";
  try {
    const figures = (await listFunko()).map((item) => ({ figure: item.figure, number: item.number, title: item.title, owner: item.ownerLogin, awardedAt: item.awardedAt }));
    if (!login) return NextResponse.json({ figures }, { headers: PRIVATE });
    if (!validLogin(login)) return NextResponse.json({ error: "Invalid login" }, { status: 400, headers: PRIVATE });
    const progress = await funkoProgress(login);
    const { userId: _userId, ...visible } = progress;
    void _userId;
    return NextResponse.json({ figures, progress: visible }, { headers: PRIVATE });
  } catch (error) {
    if (error instanceof FunkoError) return NextResponse.json({ error: error.message }, { status: error.status, headers: PRIVATE });
    console.error("Game funko lookup failed", error);
    return NextResponse.json({ error: "Lookup failed" }, { status: 503, headers: PRIVATE });
  }
}

export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: PRIVATE });
  const body = await request.json().catch(() => null) as { login?: unknown } | null;
  const login = String(body?.login ?? "");
  if (!validLogin(login)) return NextResponse.json({ error: "Invalid login" }, { status: 400, headers: PRIVATE });
  try {
    return NextResponse.json({ ok: true, ...(await claimFunko(login)) }, { headers: PRIVATE });
  } catch (error) {
    if (error instanceof FunkoError) return NextResponse.json({ error: error.message }, { status: error.status, headers: PRIVATE });
    console.error("Game funko claim failed", error);
    return NextResponse.json({ error: "Claim failed" }, { status: 500, headers: PRIVATE });
  }
}
