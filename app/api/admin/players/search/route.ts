import { NextResponse } from "next/server";
import { getAdminUser } from "@/lib/waitlist";
import { searchPlayers } from "@/lib/payments";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/* Подсказки ников для полей выдачи пропуска и PLUS. */
export async function GET(request: Request) {
  if (!(await getAdminUser())) {
    return NextResponse.json({ error: "Требуется вход администратора." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  const query = new URL(request.url).searchParams.get("q") ?? "";
  try {
    return NextResponse.json({ logins: await searchPlayers(query) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Player search failed", error);
    return NextResponse.json({ logins: [] }, { headers: { "Cache-Control": "no-store" } });
  }
}
