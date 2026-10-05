import { NextResponse } from "next/server";
import { sameOriginOrMissing } from "@/lib/waitlist";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  if (!sameOriginOrMissing(request)) {
    return NextResponse.json({ error: "Запрос отклонён." }, { status: 403 });
  }
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  return NextResponse.json({ ok: true });
}
