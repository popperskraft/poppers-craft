import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getCommunityViewer } from "@/lib/community";
import { sameOriginOrMissing } from "@/lib/waitlist";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!sameOriginOrMissing(request)) return NextResponse.json({ error: "Недопустимый запрос." }, { status: 403 });
  const viewer = await getCommunityViewer();
  if (!viewer) return NextResponse.json({ error: "Войдите в аккаунт." }, { status: 401 });
  const id = Number((await params).id);
  if (!Number.isSafeInteger(id)) return NextResponse.json({ error: "Пост не найден." }, { status: 404 });

  const admin = createSupabaseAdminClient();
  const { data: post } = await admin.from("pc_feed_posts").select("id").eq("id", id).maybeSingle();
  if (!post) return NextResponse.json({ error: "Пост не найден." }, { status: 404 });

  const { data: currentUser } = await admin.auth.admin.getUserById(viewer.user.id);
  const currentMetadata = currentUser.user?.app_metadata ?? viewer.user.app_metadata;
  const existing = (Array.isArray(currentMetadata?.feed_seen_posts)
    ? currentMetadata.feed_seen_posts
    : [])
    .map(Number)
    .filter(Number.isSafeInteger);
  const feedSeenPosts = [id, ...existing.filter((postId) => postId !== id)].slice(0, 200);
  const { error } = await admin.auth.admin.updateUserById(viewer.user.id, {
    app_metadata: { ...currentMetadata, feed_seen_posts: feedSeenPosts },
  });
  if (error) return NextResponse.json({ error: "Не удалось сохранить просмотр." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
