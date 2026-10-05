import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getAdminUser } from "@/lib/waitlist";

export async function GET(request: Request) {
  if (!(await getAdminUser())) return NextResponse.json({ error: "Нет доступа." }, { status: 403 });
  const boardId = Number(new URL(request.url).searchParams.get("boardId"));
  if (!Number.isSafeInteger(boardId)) return NextResponse.json({ error: "Некорректный блок." }, { status: 400 });
  const { data, error } = await createSupabaseAdminClient().from("site_updates").select("id,body,created_at").like("source_key", `__board_response:${boardId}:%`).order("created_at", { ascending: false }).limit(100);
  if (error) return NextResponse.json({ error: "Не получилось загрузить ответы." }, { status: 500 });
  const responses = (data ?? []).flatMap((row) => { try { return [{ id: row.id, createdAt: row.created_at, ...JSON.parse(row.body) }]; } catch { return []; } });
  return NextResponse.json({ responses });
}
