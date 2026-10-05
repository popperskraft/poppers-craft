import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getAdminUser, listBugReports, sameOriginOrMissing } from "@/lib/waitlist";

export async function GET() {
  if (!(await getAdminUser())) {
    return NextResponse.json({ error: "Требуется вход администратора." }, { status: 401 });
  }
  return NextResponse.json({ bugReports: await listBugReports() });
}

export async function PATCH(request: Request) {
  if (!sameOriginOrMissing(request)) {
    return NextResponse.json({ error: "Запрос отклонён." }, { status: 403 });
  }
  if (!(await getAdminUser())) {
    return NextResponse.json({ error: "Требуется вход администратора." }, { status: 401 });
  }
  const body = await request.json().catch(() => null);
  const id = Number(body?.id);
  const status = String(body?.status ?? "");
  if (!Number.isSafeInteger(id) || id < 1 || !["new", "in_progress", "resolved"].includes(status)) {
    return NextResponse.json({ error: "Некорректные данные." }, { status: 400 });
  }
  const admin = createSupabaseAdminClient();
  const { data: report, error: readError } = await admin
    .from("site_updates")
    .select("body,source_key")
    .eq("id", id)
    .like("source_key", "__bug_report__:%")
    .maybeSingle();
  if (readError || !report) {
    return NextResponse.json({ error: "Баг-репорт не найден." }, { status: 404 });
  }
  let details: Record<string, unknown>;
  try {
    details = JSON.parse(report.body) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Баг-репорт повреждён." }, { status: 500 });
  }
  const { error } = await admin
    .from("site_updates")
    .update({ body: JSON.stringify({ ...details, status }), updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("source_key", report.source_key);
  if (error) {
    return NextResponse.json({ error: "Не удалось обновить баг-репорт." }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
