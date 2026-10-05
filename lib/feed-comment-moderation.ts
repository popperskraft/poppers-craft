import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const moderatedCommentKey = (postId: number, commentId: number) => `__feed_comment_hidden__:${postId}:${commentId}`;

// Internal, unpublished records follow the existing site_updates store pattern.
// Keep the original comment intact so an accidental moderation can be reversed.
// Filter on the server: hidden text must not reach either the website or app API.
export async function visibleFeedComments<T extends { id: number; post_id: number }>(comments: T[]): Promise<T[]> {
  if (!comments.length) return comments;
  const admin = createSupabaseAdminClient();
  const hidden = new Set<string>();
  const keys = comments.map(comment => moderatedCommentKey(comment.post_id, comment.id));
  for (let offset = 0; offset < keys.length; offset += 200) {
    const { data, error } = await admin.from("site_updates").select("source_key")
      .in("source_key", keys.slice(offset, offset + 200)).eq("published", false);
    // Fail closed if moderation state cannot be read; never re-expose hidden text.
    if (error) throw error;
    for (const row of data ?? []) if (row.source_key) hidden.add(row.source_key);
  }
  return comments.filter(comment => !hidden.has(moderatedCommentKey(comment.post_id, comment.id)));
}
