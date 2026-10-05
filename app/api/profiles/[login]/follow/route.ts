import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getCommunityViewer } from "@/lib/community";
import { normalizeLogin, sameOriginOrMissing } from "@/lib/waitlist";

export async function POST(request: Request, { params }: { params: Promise<{ login: string }> }) {
  if (!sameOriginOrMissing(request)) return NextResponse.json({ error: "Недопустимый запрос." }, { status: 403 });
  const viewer = await getCommunityViewer();
  if (!viewer) return NextResponse.json({ error: "Войдите в аккаунт." }, { status: 401 });
  const admin = createSupabaseAdminClient();
  const { data: target } = await admin.from("pc_member_profiles").select("user_id").eq("login", normalizeLogin((await params).login)).maybeSingle();
  if (!target || target.user_id === viewer.user.id) return NextResponse.json({ error: "Профиль не найден." }, { status: 404 });
  const { data: current } = await admin.from("pc_profile_follows").select("following_id").eq("follower_id", viewer.user.id).eq("following_id", target.user_id).maybeSingle();
  const query = current
    ? admin.from("pc_profile_follows").delete().eq("follower_id", viewer.user.id).eq("following_id", target.user_id)
    : admin.from("pc_profile_follows").insert({ follower_id: viewer.user.id, following_id: target.user_id });
  const { error } = await query;
  if (error) return NextResponse.json({ error: "Не удалось изменить подписку." }, { status: 500 });
  return NextResponse.json({ ok: true, following: !current });
}
