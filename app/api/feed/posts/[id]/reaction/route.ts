import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getCommunityViewer } from "@/lib/community";
import { sameOriginOrMissing } from "@/lib/waitlist";

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!sameOriginOrMissing(request)) return NextResponse.json({ error: "Недопустимый запрос." }, { status: 403 });
  const viewer = await getCommunityViewer();
  if (!viewer) return NextResponse.json({ error: "Войдите в аккаунт." }, { status: 401 });
  const id = Number((await params).id);
  const reaction = String((await request.json()).reaction);
  if (!Number.isSafeInteger(id) || !["like", "dislike"].includes(reaction)) return NextResponse.json({ error: "Некорректная реакция." }, { status: 400 });
  const admin = createSupabaseAdminClient();
  const { data: current } = await admin.from("pc_feed_reactions").select("reaction").eq("post_id", id).eq("user_id", viewer.user.id).maybeSingle();
  const query = current?.reaction === reaction
    ? admin.from("pc_feed_reactions").delete().eq("post_id", id).eq("user_id", viewer.user.id)
    : admin.from("pc_feed_reactions").upsert({ post_id: id, user_id: viewer.user.id, reaction, updated_at: new Date().toISOString() });
  const { error } = await query;
  if (error) return NextResponse.json({ error: "Не удалось сохранить реакцию." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
