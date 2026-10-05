import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { decodeFeedBody, type FeedPollResults } from "@/lib/feed-content";

export const pollResponseKey = (postId: number, userId: string) => `__feed_poll_response__:${postId}:${userId}`;
export const pollResponseTitle = (postId: number) => `feed-poll-response:${postId}`;

export async function listFeedPollResults(posts: { id: number; body: string }[], viewerId: string) {
  const results = new Map<number, FeedPollResults>();
  const polls = posts.flatMap(post => {
    const poll = decodeFeedBody(post.body).poll;
    if (!poll) return [];
    results.set(post.id, { ...poll, counts: poll.options.map(() => 0), total: 0, myAnswer: null, answers: [] });
    return [post.id];
  });
  if (!polls.length) return results;
  const admin = createSupabaseAdminClient();
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await admin.from("site_updates").select("source_key,title,body").in("title", polls.map(pollResponseTitle)).eq("published", false).order("id").range(offset, offset + 499);
    if (error) throw error;
    for (const row of data ?? []) {
      const id = Number(row.title.slice("feed-poll-response:".length));
      const poll = results.get(id);
      if (!poll || !row.source_key?.startsWith(`__feed_poll_response__:${id}:`)) continue;
      try {
        const value = JSON.parse(row.body);
        if (typeof value.answer !== "string") continue;
        if (poll.kind === "vote") {
          const index = Number(value.answer);
          if (!Number.isInteger(index) || String(index) !== value.answer || index < 0 || index >= poll.options.length) continue;
          poll.counts[index]++;
        } else {
          if (!value.answer.trim() || value.answer.length > 600) continue;
          poll.answers.push({ author: typeof value.author === "string" ? value.author : "Игрок", text: value.answer });
        }
        poll.total++;
        if (row.source_key === pollResponseKey(id, viewerId)) poll.myAnswer = value.answer;
      } catch { /* Ignore unrelated or malformed legacy records. */ }
    }
    if (!data || data.length < 500) break;
  }
  return results;
}
