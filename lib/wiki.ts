import "server-only";

import { deflateRawSync, inflateRawSync } from "node:zlib";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { CommunityViewer } from "@/lib/community";
import { playerMarks } from "@/lib/player-marks";
import type { PlayerMarks } from "@/lib/player-marks";
import { isPrideHeaderFlag, normalizeHeaderFlag, type HeaderFlag } from "@/lib/header-flags";
import { parsePixelHeaderArt, type PixelHeaderArt } from "@/lib/profile-header-art";
import { EMPTY_WIKI_RATING, summarizeWikiRatings, type WikiRating } from "@/lib/wiki-discussion";
import { stickerSummaries } from "@/lib/plus-perks";
import type { PlusRing, PlusSticker, PlusTier, StickerCount } from "@/lib/plus-style";
import {
  normalizeWikiBlocks,
  wikiImageIds,
  type WikiArticleBlock,
  type WikiArticleCategory,
} from "@/lib/wiki-content";

export const WIKI_BUCKET = "pc-wiki-images";
export const WIKI_ARTICLE_PREFIX = "__wiki_article__:";
export const WIKI_COMMENT_PREFIX = "__wiki_comment__:";
export const WIKI_LIKE_PREFIX = "__wiki_comment_like__:";

export type WikiAuthor = {
  userId: string;
  login: string;
  displayName: string;
  headerColor: string;
  headerFlag?: HeaderFlag;
  headerArt?: PixelHeaderArt | null;
  headerFrames?: PixelHeaderArt[];
  headerFrameMs?: number;
  /* Подписчик: обводка у имени, её цвет и тариф (у HYPE — радужная и ярче). */
  plus?: boolean;
  ring?: PlusRing;
  tier?: PlusTier;
};

export type WikiArticleSummary = {
  id: number;
  slug: string;
  title: string;
  summary: string;
  category: WikiArticleCategory;
  tags: string[];
  status: "draft" | "published";
  coverUrl: string | null;
  coverArt?: PixelHeaderArt | null;
  commentCount: number;
  rating: WikiRating;
  publishedAt: string | null;
  updatedAt: string;
  author: WikiAuthor;
};

export type WikiComment = {
  id: number;
  parentId: number | null;
  body: string;
  createdAt: string;
  likes: number;
  myLiked: boolean;
  canDelete: boolean;
  deleted: boolean;
  author: WikiAuthor;
};

export type WikiArticleDetail = WikiArticleSummary & {
  content: WikiArticleBlock[];
  comments: WikiComment[];
  canEdit: boolean;
  /* Стикеры PLUS под статьёй. */
  stickers: StickerCount[];
  mySticker: PlusSticker | null;
};

export type WikiArticleIndexPayload = {
  version: 1;
  slug: string;
  authorId: string;
  summary: string;
  category: WikiArticleCategory;
  tags: string[];
  status: "draft" | "published";
  contentPath: string;
  publishedAt: string | null;
};

export type WikiCommentPayload = {
  version: 1;
  articleId: number;
  authorId: string;
  parentId: number | null;
  body: string;
  deletedAt?: string;
};

type WikiIndexRow = {
  id: number;
  source_key: string | null;
  title: string;
  body: string;
  created_at: string;
  updated_at: string;
};

export function encodeWikiRecord(value: WikiArticleIndexPayload | WikiCommentPayload) {
  return `z:${deflateRawSync(Buffer.from(JSON.stringify(value))).toString("base64url")}`;
}

export function decodeWikiRecord<T>(value: string): T {
  const json = value.startsWith("z:")
    ? inflateRawSync(Buffer.from(value.slice(2), "base64url")).toString()
    : value;
  return JSON.parse(json) as T;
}

export function parseWikiArticleRow(row: WikiIndexRow) {
  if (!row.source_key?.startsWith(WIKI_ARTICLE_PREFIX)) return null;
  try {
    const payload = decodeWikiRecord<WikiArticleIndexPayload>(row.body);
    if (payload.version !== 1 || payload.slug !== row.source_key.slice(WIKI_ARTICLE_PREFIX.length)) return null;
    return { row, payload };
  } catch {
    return null;
  }
}

export function parseWikiCommentRow(row: WikiIndexRow) {
  if (!row.source_key?.startsWith(WIKI_COMMENT_PREFIX)) return null;
  try {
    const payload = decodeWikiRecord<WikiCommentPayload>(row.body);
    if (payload.version !== 1) return null;
    return { row, payload };
  } catch {
    return null;
  }
}

type AuthorProfile = { user_id: string; login: string; display_name: string; header_color: string; header_flag?: unknown };

function profileToAuthor(profile: AuthorProfile, mark?: PlayerMarks, metadata?: Record<string, unknown>, hidePrideFlags = false): WikiAuthor {
  const flag = normalizeHeaderFlag(metadata?.profile_header_flag ?? profile.header_flag);
  return {
    userId: profile.user_id,
    login: profile.login,
    displayName: profile.display_name,
    headerColor: profile.header_color,
    headerFlag: hidePrideFlags && isPrideHeaderFlag(flag) ? "none" : flag,
    headerArt: parsePixelHeaderArt(metadata?.profile_header_art),
    headerFrames: mark?.headerFrames ?? [],
    headerFrameMs: mark?.headerFrameMs,
    plus: Boolean(mark?.plus),
    ring: mark?.ring,
    tier: mark?.tier,
  };
}

async function wikiAuthors(profiles: AuthorProfile[], viewer: CommunityViewer | null = null) {
  const admin = createSupabaseAdminClient();
  const marks = await playerMarks(profiles.map(profile => profile.user_id), { frames: true });
  const authors = new Map<string, WikiAuthor>();
  // Fetch only the article's authors, in bounded batches; never expose auth metadata.
  for (let start = 0; start < profiles.length; start += 12) {
    await Promise.all(profiles.slice(start, start + 12).map(async profile => {
      const result = await admin.auth.admin.getUserById(profile.user_id);
      if (result.error) console.error("Wiki author artwork lookup failed", result.error.message);
      authors.set(profile.user_id, profileToAuthor(profile, marks.get(profile.user_id), result.data.user?.user_metadata, Boolean(viewer?.user.app_metadata?.hide_pride_flags)));
    }));
  }
  return authors;
}

// Supabase caps a response at 1,000 rows; a whole discussion/rating must not stop there.
async function wikiRowsByTitle(titles: string[]) {
  const rows: WikiIndexRow[] = [];
  const admin = createSupabaseAdminClient();
  for (let start = 0; start < titles.length; start += 50) {
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await admin.from("site_updates").select("id,source_key,title,body,created_at,updated_at")
        .in("title", titles.slice(start, start + 50)).eq("published", false).order("id").range(offset, offset + 499);
      if (error) throw error;
      rows.push(...(data ?? []) as WikiIndexRow[]);
      if (!data || data.length < 500) break;
    }
  }
  return rows;
}

export async function wikiRatings(ids: number[], viewerId?: string | null) {
  const rows = await wikiRowsByTitle(ids.map(id => `wiki-rating:${id}`));
  return new Map(ids.map(id => [id, summarizeWikiRatings(rows, id, viewerId)]));
}

async function signedImageMap(paths: string[]) {
  const uniquePaths = [...new Set(paths.filter(Boolean))];
  const urls = new Map<string, string>();
  if (!uniquePaths.length) return urls;
  const { data } = await createSupabaseAdminClient().storage.from(WIKI_BUCKET).createSignedUrls(uniquePaths, 3600);
  data?.forEach((item, index) => {
    if (item.signedUrl) urls.set(uniquePaths[index], item.signedUrl);
  });
  return urls;
}

export async function ensureWikiBucket() {
  const admin = createSupabaseAdminClient();
  const allowedMimeTypes = ["image/jpeg", "image/png", "image/webp", "application/json"];
  const { data } = await admin.storage.getBucket(WIKI_BUCKET);
  if (!data) {
    const { error } = await admin.storage.createBucket(WIKI_BUCKET, {
      public: false,
      fileSizeLimit: "8MB",
      allowedMimeTypes,
    });
    if (error && !/already exists/i.test(error.message)) throw error;
    return;
  }
  if (data.public || allowedMimeTypes.some((type) => !data.allowed_mime_types?.includes(type))) {
    const { error } = await admin.storage.updateBucket(WIKI_BUCKET, {
      public: false,
      fileSizeLimit: "8MB",
      allowedMimeTypes,
    });
    if (error) throw error;
  }
}

export async function readWikiDocument(path: string, strict = false): Promise<{ blocks: WikiArticleBlock[]; coverArt: PixelHeaderArt | null }> {
  const { data, error } = await createSupabaseAdminClient().storage.from(WIKI_BUCKET).download(path);
  if (error || !data) {
    if (strict) throw new Error("Wiki content unavailable");
    return { blocks: [], coverArt: null };
  }
  try {
    const payload = JSON.parse(await data.text()) as { blocks?: unknown; coverArt?: unknown };
    return { blocks: normalizeWikiBlocks(payload.blocks), coverArt: parsePixelHeaderArt(payload.coverArt) };
  } catch {
    if (strict) throw new Error("Wiki content unreadable");
    return { blocks: [], coverArt: null };
  }
}

export async function readWikiContent(path: string) {
  return (await readWikiDocument(path)).blocks;
}

async function articleRows() {
  const { data, error } = await createSupabaseAdminClient()
    .from("site_updates")
    .select("id,source_key,title,body,created_at,updated_at")
    .gte("source_key", WIKI_ARTICLE_PREFIX)
    .lt("source_key", `${WIKI_ARTICLE_PREFIX}\uffff`)
    .eq("published", false)
    .order("updated_at", { ascending: false })
    .limit(300);
  if (error) throw error;
  return ((data ?? []) as WikiIndexRow[]).flatMap((row) => {
    const parsed = parseWikiArticleRow(row);
    return parsed ? [parsed] : [];
  });
}

async function commentCounts(articleIds: number[]) {
  const counts = new Map<number, number>();
  if (!articleIds.length) return counts;
  const admin = createSupabaseAdminClient();
  await Promise.all(articleIds.map(async (articleId) => {
    const { count } = await admin.from("site_updates").select("id", { count: "exact", head: true }).eq("title", `wiki-comment:${articleId}`).eq("published", false);
    counts.set(articleId, count ?? 0);
  }));
  return counts;
}

export async function listWikiArticles(query = "", viewer: CommunityViewer | null = null): Promise<WikiArticleSummary[]> {
  const records = (await articleRows()).filter(({ payload }) => payload.status === "published");
  if (!records.length) return [];
  const admin = createSupabaseAdminClient();
  const authorIds = [...new Set(records.map(({ payload }) => payload.authorId))];
  const [{ data: profiles, error: profileError }, counts, ratings] = await Promise.all([
    admin.from("pc_member_profiles").select("user_id,login,display_name,header_color,header_flag").in("user_id", authorIds),
    commentCounts(records.map(({ row }) => row.id)),
    wikiRatings(records.map(({ row }) => row.id)),
  ]);
  if (profileError) throw profileError;
  const profileMap = await wikiAuthors(profiles ?? [], viewer);
  const contents = await Promise.all(records.map(({ payload }) => readWikiDocument(payload.contentPath)));
  const coverPaths = contents.map(({ blocks }) => wikiImageIds(blocks)[0] ?? null);
  const urlMap = await signedImageMap(coverPaths.filter((path): path is string => Boolean(path)));
  const needle = query.trim().toLocaleLowerCase("ru").slice(0, 80);

  return records.flatMap(({ row, payload }, index) => {
    const author = profileMap.get(payload.authorId);
    if (!author) return [];
    const result: WikiArticleSummary = {
      id: row.id,
      slug: payload.slug,
      title: row.title,
      summary: payload.summary,
      category: payload.category,
      tags: payload.tags,
      status: payload.status,
      coverUrl: coverPaths[index] ? urlMap.get(coverPaths[index] as string) ?? null : null,
      coverArt: contents[index].coverArt,
      commentCount: counts.get(row.id) ?? 0,
      rating: ratings.get(row.id) ?? EMPTY_WIKI_RATING,
      publishedAt: payload.publishedAt,
      updatedAt: row.updated_at,
      author,
    };
    if (!needle) return [result];
    const haystack = [row.title, payload.summary, payload.category, ...payload.tags, author.login, author.displayName].join(" ").toLocaleLowerCase("ru");
    return haystack.includes(needle) ? [result] : [];
  }).sort((left, right) => Date.parse(right.publishedAt ?? right.updatedAt) - Date.parse(left.publishedAt ?? left.updatedAt));
}

export async function listWikiDrafts(viewer: CommunityViewer): Promise<WikiArticleSummary[]> {
  return (await articleRows()).flatMap(({ row, payload }) => payload.authorId === viewer.user.id && payload.status === "draft" ? [{
    id: row.id,
    slug: payload.slug,
    title: row.title,
    summary: payload.summary,
    category: payload.category,
    tags: payload.tags,
    status: payload.status,
    coverUrl: null,
    commentCount: 0,
    rating: EMPTY_WIKI_RATING,
    publishedAt: payload.publishedAt,
    updatedAt: row.updated_at,
    author: {
      userId: viewer.user.id,
      login: viewer.profile.login,
      displayName: viewer.profile.display_name,
      headerColor: viewer.profile.header_color,
    },
  } satisfies WikiArticleSummary] : []);
}

export async function getWikiIndexById(id: number) {
  const { data, error } = await createSupabaseAdminClient().from("site_updates").select("id,source_key,title,body,created_at,updated_at").eq("id", id).eq("published", false).maybeSingle();
  if (error) throw error;
  return data ? parseWikiArticleRow(data as WikiIndexRow) : null;
}

export async function getWikiArticle(slug: string, viewer: CommunityViewer | null): Promise<WikiArticleDetail | null> {
  const normalizedSlug = slug.toLowerCase().slice(0, 120);
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.from("site_updates").select("id,source_key,title,body,created_at,updated_at").eq("source_key", `${WIKI_ARTICLE_PREFIX}${normalizedSlug}`).eq("published", false).maybeSingle();
  if (error) throw error;
  const parsed = data ? parseWikiArticleRow(data as WikiIndexRow) : null;
  if (!parsed) return null;
  const { row, payload } = parsed;
  const canEdit = Boolean(viewer && (viewer.user.id === payload.authorId || viewer.adminProfile));
  if (payload.status !== "published" && !canEdit) return null;

  const [profileResult, document] = await Promise.all([
    admin.from("pc_member_profiles").select("user_id,login,display_name,header_color,header_flag").eq("user_id", payload.authorId).maybeSingle(),
    readWikiDocument(payload.contentPath),
  ]);
  if (profileResult.error) throw profileResult.error;
  if (!profileResult.data) return null;
  const content = document.blocks;
  const imagePaths = wikiImageIds(content);
  const urlMap = await signedImageMap(imagePaths);
  const hydratedContent = content.map((block) => block.type === "image" && block.imageId ? { ...block, imageUrl: urlMap.get(block.imageId) ?? null } : block);

  const rawComments = payload.status === "published" ? await wikiRowsByTitle([`wiki-comment:${row.id}`]) : [];
  const comments = ((rawComments ?? []) as WikiIndexRow[]).flatMap((commentRow) => {
    const comment = parseWikiCommentRow(commentRow);
    return comment && comment.payload.articleId === row.id ? [comment] : [];
  });
  const authorIds = [...new Set(comments.map(({ payload: comment }) => comment.authorId))];
  const commentIds = comments.map(({ row: commentRow }) => commentRow.id);
  const [{ data: commentProfiles, error: commentProfileError }, rawLikes, ratings, stickers] = await Promise.all([
    authorIds.length ? admin.from("pc_member_profiles").select("user_id,login,display_name,header_color,header_flag").in("user_id", authorIds) : Promise.resolve({ data: [], error: null }),
    commentIds.length ? wikiRowsByTitle([`wiki-like:${row.id}`]) : Promise.resolve([]),
    wikiRatings([row.id], viewer?.user.id),
    stickerSummaries("wiki_article", [row.id], viewer?.user.id ?? null),
  ]);
  if (commentProfileError) throw commentProfileError;
  const commentProfileMap = await wikiAuthors([...new Map([profileResult.data, ...(commentProfiles ?? [])].map(profile => [profile.user_id, profile])).values()], viewer);
  const likes = rawLikes ?? [];

  return {
    id: row.id,
    slug: payload.slug,
    title: row.title,
    summary: payload.summary,
    category: payload.category,
    tags: payload.tags,
    status: payload.status,
    coverUrl: hydratedContent.find((block) => block.type === "image" && block.imageUrl)?.imageUrl ?? null,
    coverArt: document.coverArt,
    commentCount: comments.length,
    rating: ratings.get(row.id) ?? EMPTY_WIKI_RATING,
    publishedAt: payload.publishedAt,
    updatedAt: row.updated_at,
    author: commentProfileMap.get(payload.authorId)!,
    content: hydratedContent,
    comments: comments.flatMap(({ row: commentRow, payload: comment }) => {
      const author = commentProfileMap.get(comment.authorId);
      if (!author) return [];
      const likePrefix = `${WIKI_LIKE_PREFIX}${commentRow.id}:`;
      const commentLikes = likes.filter((like) => like.source_key?.startsWith(likePrefix) && like.body === "like");
      return [{
        id: commentRow.id,
        parentId: comment.parentId,
        body: comment.deletedAt ? "" : comment.body,
        deleted: Boolean(comment.deletedAt),
        createdAt: commentRow.created_at,
        likes: commentLikes.length,
        myLiked: Boolean(viewer && commentLikes.some((like) => like.source_key === `${likePrefix}${viewer.user.id}`)),
        canDelete: !comment.deletedAt && Boolean(viewer && (viewer.user.id === comment.authorId || viewer.adminProfile)),
        author,
      } satisfies WikiComment];
    }),
    canEdit,
    stickers: stickers.get(row.id)?.counts ?? [],
    mySticker: stickers.get(row.id)?.mine ?? null,
  };
}
