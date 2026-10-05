import { NextResponse } from "next/server";
import { getCommunityViewer } from "@/lib/community";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { sameOriginOrMissing } from "@/lib/waitlist";
import { encodeWikiRecord, parseWikiCommentRow } from "@/lib/wiki";

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!sameOriginOrMissing(request)) return NextResponse.json({ error: "Недопустимый запрос." }, { status: 403 });
  const viewer = await getCommunityViewer({ allowAuthenticated: true });
  if (!viewer) return NextResponse.json({ error: "Войдите в аккаунт." }, { status: 401 });
  const id = Number((await params).id);
  if (!Number.isSafeInteger(id)) return NextResponse.json({ error: "Комментарий не найден." }, { status: 404 });
  const admin = createSupabaseAdminClient();
  const { data: row, error: rowError } = await admin.from("site_updates").select("id,source_key,title,body,created_at,updated_at").eq("id", id).maybeSingle();
  const comment = row ? parseWikiCommentRow(row) : null;
  if (rowError || !comment) return NextResponse.json({ error: "Комментарий не найден." }, { status: rowError ? 500 : 404 });
  if (comment.payload.authorId !== viewer.user.id && !viewer.adminProfile) return NextResponse.json({ error: "Можно удалить только собственный комментарий." }, { status: 403 });
  if (comment.payload.deletedAt) return NextResponse.json({ ok: true });
  // A tombstone preserves other people's replies and keeps the thread navigable.
  // Original content stays private and is never returned by getWikiArticle.
  const { error } = await admin.from("site_updates").update({
    body: encodeWikiRecord({ ...comment.payload, deletedAt: new Date().toISOString() }),
  }).eq("id", id).eq("source_key", row!.source_key);
  if (error) return NextResponse.json({ error: "Не удалось удалить комментарий." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
