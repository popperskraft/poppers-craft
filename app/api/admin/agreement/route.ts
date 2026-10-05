import { NextResponse } from "next/server";
import { listAgreementAcceptances } from "@/lib/user-agreement-store";
import { getAdminUser } from "@/lib/waitlist";

export const dynamic = "force-dynamic";

/* Журнал принятия соглашения. Доступен только администраторам: записи
   содержат IP-адреса и являются персональными данными. */
export async function GET() {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Нет доступа." }, { status: 403 });
  try {
    return NextResponse.json(
      { acceptances: await listAgreementAcceptances() },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch {
    return NextResponse.json({ error: "Не удалось загрузить журнал согласий." }, { status: 500 });
  }
}
