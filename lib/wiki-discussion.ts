import { validStarRating } from "./star-rating";
export const WIKI_RATING_PREFIX = "__wiki_article_rating__:";
export type WikiRating = { average: number; count: number; mine: number | null };
export const EMPTY_WIKI_RATING: WikiRating = { average: 0, count: 0, mine: null };

export function validWikiRating(value: unknown): value is number {
  return validStarRating(value);
}

export function summarizeWikiRatings(rows: Array<{ source_key: string | null; body: string }>, articleId: number, viewerId?: string | null): WikiRating {
  const prefix = `${WIKI_RATING_PREFIX}${articleId}:`;
  const votes = new Map<string, number>();
  for (const row of rows) {
    if (!row.source_key?.startsWith(prefix) || !/^rating:(?:0\.5|[1-4](?:\.5)?|5)$/.test(row.body)) continue;
    const userId = row.source_key.slice(prefix.length);
    if (userId) votes.set(userId, Number(row.body.slice(7)));
  }
  return {
    average: votes.size ? [...votes.values()].reduce((sum, score) => sum + score, 0) / votes.size : 0,
    count: votes.size,
    mine: viewerId ? votes.get(viewerId) ?? null : null,
  };
}

// Flatten each thread without recursive rendering or ever-growing mobile indents.
// Old orphaned replies (including replies left by the previous delete API) stay visible.
export function wikiThreads<T extends { id: number; parentId: number | null }>(comments: T[]): Array<{ root: T; replies: T[] }> {
  const byId = new Map(comments.map(comment => [comment.id, comment]));
  const rootOf = new Map<number, number>();
  for (const comment of comments) {
    let current = comment;
    const seen = new Set<number>();
    while (current.parentId !== null && byId.has(current.parentId) && !rootOf.has(current.id)) {
      if (seen.has(current.id)) break;
      seen.add(current.id);
      current = byId.get(current.parentId)!;
    }
    const rootId = rootOf.get(current.id) ?? current.id;
    rootOf.set(comment.id, rootId);
    for (const id of seen) rootOf.set(id, rootId);
  }
  const groups = new Map<number, { root: T; replies: T[] }>();
  for (const comment of comments) {
    const rootId = rootOf.get(comment.id)!;
    const group = groups.get(rootId) ?? { root: byId.get(rootId)!, replies: [] };
    if (comment.id !== rootId) group.replies.push(comment);
    groups.set(rootId, group);
  }
  return [...groups.values()];
}
