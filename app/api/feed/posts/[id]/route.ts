import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { FEED_BUCKET, getCommunityViewer } from "@/lib/community";
import { forgetFeedMedia } from "@/lib/feed-media";
import { sameOriginOrMissing } from "@/lib/waitlist";

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!sameOriginOrMissing(request)) return NextResponse.json({ error: "Недопустимый запрос." }, { status: 403 });
  const viewer = await getCommunityViewer();
  if (!viewer) return NextResponse.json({ error: "Войдите в аккаунт." }, { status: 401 });
  const id = Number((await params).id);
  if (!Number.isSafeInteger(id)) return NextResponse.json({ error: "Пост не найден." }, { status: 404 });

  const admin = createSupabaseAdminClient();
  const { data: post } = await admin.from("pc_feed_posts").select("author_id,image_path").eq("id", id).maybeSingle();
  if (!post) return NextResponse.json({ error: "Пост не найден." }, { status: 404 });
  const isAuthor = post.author_id === viewer.user.id;
  if (!isAuthor && !viewer.adminProfile) {
    return NextResponse.json({ error: "Чужие посты могут удалять только администраторы." }, { status: 403 });
  }
  const { error } = await admin.from("pc_feed_posts").delete().eq("id", id);
  if (error) return NextResponse.json({ error: "Не удалось удалить пост." }, { status: 500 });
  if (post.image_path) {
    forgetFeedMedia([post.image_path]);
    await admin.storage.from(FEED_BUCKET).remove([post.image_path]);
  }
  /* Стикеры удалённого поста больше некуда показывать. */
  await admin.from("pc_sticker_reactions").delete().eq("target_kind", "feed_post").eq("target_id", id);
  return NextResponse.json({ ok: true, moderated: !isAuthor });
}
