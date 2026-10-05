import { NextResponse } from "next/server";
import { listSiteErrorLogs } from "@/lib/error-logs";
import { getAdminUser } from "@/lib/waitlist";

export async function GET() {
  if (!(await getAdminUser())) {
    return NextResponse.json({ error: "Требуется вход администратора." }, { status: 401 });
  }
  try {
    return NextResponse.json({ logs: await listSiteErrorLogs(), generatedAt: new Date().toISOString() });
  } catch (error) {
    console.error("admin error logs read failed", error);
    return NextResponse.json({ error: "Не удалось загрузить журнал ошибок." }, { status: 500 });
  }
}
