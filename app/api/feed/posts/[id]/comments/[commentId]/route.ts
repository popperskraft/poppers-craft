import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getViewerIdentity, sameOriginOrMissing } from "@/lib/waitlist";
import { moderatedCommentKey } from "@/lib/feed-comment-moderation";

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string; commentId: string }> }) {
  if (!sameOriginOrMissing(request)) return NextResponse.json({ error: "Недопустимый запрос." }, { status: 403 });
  try {
    const viewer = await getViewerIdentity();
    if (!viewer || viewer.needsMfa) return NextResponse.json({ error: "Войдите в аккаунт." }, { status: 401 });
    if (!viewer.adminProfile?.active) return NextResponse.json({ error: "Удалять чужие комментарии могут только администраторы." }, { status: 403 });
    const { id, commentId } = await params;
    const post = Number(id), comment = Number(commentId);
    if (!/^\d+$/.test(id) || !/^\d+$/.test(commentId) || !Number.isSafeInteger(post) || !Number.isSafeInteger(comment) || post <= 0 || comment <= 0) {
      return NextResponse.json({ error: "Недопустимый запрос." }, { status: 400 });
    }
    const admin = createSupabaseAdminClient();
    const { data: row, error: readError } = await admin.from("pc_feed_comments").select("id,post_id")
      .eq("id", comment).eq("post_id", post).maybeSingle();
    if (readError) throw readError;
    if (!row) return NextResponse.json({ error: "Комментарий не найден." }, { status: 404 });
    const now = new Date().toISOString();
    const { error } = await admin.from("site_updates").upsert({
      source_key: moderatedCommentKey(post, comment),
      title: `feed-comment-hidden:${post}`,
      body: JSON.stringify({ postId: post, commentId: comment, moderatedBy: viewer.user.id, moderatedAt: now }),
      badge: "MODERATION", color: "pink", published: false,
      author_admin_id: viewer.adminProfile.id, updated_at: now,
    }, { onConflict: "source_key", ignoreDuplicates: true });
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Не удалось удалить комментарий." }, { status: 500 });
  }
}
