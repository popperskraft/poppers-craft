import { NextResponse } from "next/server";
import { getAdminUser, getCommunicationOverview } from "@/lib/waitlist";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await getAdminUser())) {
    return NextResponse.json({ error: "Требуется вход администратора." }, { status: 401 });
  }

  return NextResponse.json({ communication: await getCommunicationOverview() });
}
