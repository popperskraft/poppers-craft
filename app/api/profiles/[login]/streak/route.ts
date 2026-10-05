import { NextResponse } from "next/server";
import { getCommunityViewer } from "@/lib/community";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getPlayerStreak } from "@/lib/player-streak";
import { normalizeLogin } from "@/lib/waitlist";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

export async function GET(_request: Request, { params }: { params: Promise<{ login: string }> }) {
  // Same viewing access as /players/[login], including MFA/banned-account checks.
  const viewer = await getCommunityViewer({ allowAuthenticated: true });
  if (!viewer) return NextResponse.json({ error: "Войдите в аккаунт." }, { status: 401, headers });
  const login = normalizeLogin((await params).login);
  if (!/^[a-z0-9_.-]{1,32}$/.test(login)) {
    return NextResponse.json({ error: "Профиль не найден." }, { status: 404, headers });
  }
  const { data, error } = await createSupabaseAdminClient().from("pc_member_profiles")
    .select("login").eq("login", login).maybeSingle();
  if (error) return NextResponse.json({ error: "Не удалось загрузить ударный режим." }, { status: 503, headers });
  if (!data) return NextResponse.json({ error: "Профиль не найден." }, { status: 404, headers });
  const streak = await getPlayerStreak(data.login);
  return NextResponse.json({ streak }, { status: streak ? 200 : 503, headers });
}
