import "server-only";
import { decodeFeedBody, matchesFeedSearch, type FeedPollResults } from "@/lib/feed-content";
import { listFeedPollResults } from "@/lib/feed-polls";
import { visibleFeedComments } from "@/lib/feed-comment-moderation";

import type { User } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { feedMediaUrl } from "@/lib/feed-media";
import { activeHumanModel, skinPreviewUrl } from "@/lib/skin-preview";
import { createPlayerSkinSignedUrl } from "@/lib/player-skins";
import { callModelService } from "@/lib/model-service";
import { profilePony } from "@/lib/profile-pony";
import { listProfileReviews } from "@/lib/profile-reviews";
import { playerMarks } from "@/lib/player-marks";
import { plusTenureMonths, readPlusProfile, stickerSummaries } from "@/lib/plus-perks";
import { DEFAULT_FRAME_MS, DEFAULT_RING, type PlusRing, type PlusSticker, type PlusTier, type StickerCount } from "@/lib/plus-style";
import { isPrideHeaderFlag, normalizeHeaderFlag, type HeaderFlag } from "@/lib/header-flags";
import { parsePixelHeaderArt, type PixelHeaderArt } from "@/lib/profile-header-art";
import {
  getViewerIdentity,
  isProtectedOwnerEmail,
  normalizeLogin,
  PROJECT_CREATOR_EMAIL,
  PROTECTED_OWNER_EMAIL,
  type AdminProfile,
  type ViewerIdentity,
} from "@/lib/waitlist";

export const FEED_BUCKET = "pc-feed-images";

export type { HeaderFlag } from "@/lib/header-flags";
export type CommunityProfile = {
  user_id: string;
  login: string;
  display_name: string;
  bio: string;
  favorite_music: string;
  favorite_movies: string;
  social_links: string | null;
  header_color: string;
  header_flag: HeaderFlag;
  header_art: PixelHeaderArt | null;
  skin_url: string | null;
  created_at: string;
};

type CommunityProfileRow = Omit<CommunityProfile, "skin_url" | "header_art">;

export type CommunityViewer = {
  user: User;
  adminProfile: AdminProfile | null;
  profile: CommunityProfile;
};

/* Полное редактирование профиля — это в первую очередь право менять ник.
   Раньше оно было у владельца и у двух администраторов, перечисленных по
   логину прямо в коде. Теперь право есть у любого действующего администратора:
   список в коде устаревал при каждой смене состава команды.

   Смена ника остаётся безопасной и без этого списка: сам обработчик
   PATCH /api/profile/community проверяет ник на занятость, переносит его в
   анкету и в учётные данные входа, а при ошибке откатывает всё обратно. */
export function canFullyEditCommunityProfile(viewer: CommunityViewer) {
  return isProtectedOwnerEmail(viewer.user.email)
    || viewer.adminProfile?.role === "owner"
    || Boolean(viewer.adminProfile?.active);
}

export type PlayerDirectoryEntry = {
  user_id: string;
  login: string;
  display_name: string;
  header_color: string;
  header_flag: HeaderFlag;
  header_art: PixelHeaderArt | null;
  skin_url: string | null;
  /* Подписчик — обводка карточки (tier — его тариф); первооткрыватель — метка. */
  plus: boolean;
  pioneer: boolean;
  ring: PlusRing;
  tier: PlusTier;
  headerFrames: PixelHeaderArt[];
  headerFrameMs: number;
};

type FeedAuthor = Pick<CommunityProfile, "login" | "display_name" | "header_color" | "header_flag" | "header_art"> & {
  plus?: boolean;
  /* Цвет обводки, тариф и кадры анимированной шапки подписчика. */
  ring?: PlusRing;
  tier?: PlusTier;
  headerFrames?: PixelHeaderArt[];
  headerFrameMs?: number;
};

export type FeedComment = {
  id: number;
  body: string;
  createdAt: string;
  author: FeedAuthor;
};

export type FeedPost = {
  poll: FeedPollResults | null;
  id: number;
  title: string;
  body: string;
  imageUrl: string | null;
  mediaKind: "image" | "video" | null;
  createdAt: string;
  author: FeedAuthor;
  comments: FeedComment[];
  likes: number;
  dislikes: number | null;
  myReaction: "like" | "dislike" | null;
  canDelete: boolean;
  deleteAsAdmin: boolean;
  followed: boolean;
  seen: boolean;
  /* Стикеры PLUS под постом. */
  stickers: StickerCount[];
  mySticker: PlusSticker | null;
};

function fallbackLogin(user: User) {
  const candidate = normalizeLogin(String(user.email ?? "player").split("@")[0])
    .replace(/[^a-z0-9_.-]/g, "")
    .slice(0, 32);
  return candidate.length >= 3 ? candidate : `player-${user.id.slice(0, 8)}`;
}

function effectiveHeaderFlag(user: User | null | undefined, fallback: unknown): HeaderFlag {
  return normalizeHeaderFlag(user?.user_metadata?.profile_header_flag ?? fallback);
}

function visibleHeaderFlag(user: User | null | undefined, fallback: unknown, hidePrideFlags: boolean): HeaderFlag {
  const flag = effectiveHeaderFlag(user, fallback);
  return hidePrideFlags && isPrideHeaderFlag(flag) ? "none" : flag;
}

function effectiveHeaderArt(user: User | null | undefined): PixelHeaderArt | null {
  return parsePixelHeaderArt(user?.user_metadata?.profile_header_art);
}

export async function ensureFeedBucket() {
  const admin = createSupabaseAdminClient();
  const { data } = await admin.storage.getBucket(FEED_BUCKET);
  const allowedMimeTypes = ["image/jpeg", "image/png", "image/webp", "image/gif", "video/mp4", "video/webm"];
  if (!data) {
    const { error } = await admin.storage.createBucket(FEED_BUCKET, {
      public: false,
      fileSizeLimit: "8MB",
      allowedMimeTypes,
    });
    if (error && !/already exists/i.test(error.message)) throw error;
  } else if (data.allowed_mime_types && allowedMimeTypes.some((type) => !data.allowed_mime_types?.includes(type))) {
    const { error } = await admin.storage.updateBucket(FEED_BUCKET, {
      public: false,
      fileSizeLimit: "8MB",
      allowedMimeTypes: [...new Set([...data.allowed_mime_types, ...allowedMimeTypes])],
    });
    if (error) throw error;
  }
}

export async function getCommunityViewer({
  identity: suppliedIdentity,
  allowAuthenticated = false,
}: {
  identity?: ViewerIdentity;
  allowAuthenticated?: boolean;
} = {}): Promise<CommunityViewer | null> {
  const identity = suppliedIdentity ?? await getViewerIdentity();
  if (!identity || identity.needsMfa) return null;

  const admin = createSupabaseAdminClient();
  const { data: application } = await admin
    .from("waitlist_applications")
    .select("login,who,status,is_banned,is_deleted")
    .eq("user_id", identity.user.id)
    .maybeSingle();

  if (
    !allowAuthenticated &&
    !identity.adminProfile &&
    (!application || application.status !== "approved" || application.is_banned || application.is_deleted)
  ) {
    return null;
  }
  /* Даже там, где хватает простого входа, заблокированный, удалённый и
     «ничей» аккаунт (без анкеты и без прав администратора) — не участник:
     у него может остаться живой сеанс, но писать в Wiki, менять профиль и
     загружать файлы он не должен. */
  if (!identity.adminProfile && (!application || application.is_banned || application.is_deleted)) {
    return null;
  }

  const { data: existing, error: existingError } = await admin
    .from("pc_member_profiles")
    .select("user_id,login,display_name,bio,favorite_music,favorite_movies,social_links,header_color,header_flag,created_at")
    .eq("user_id", identity.user.id)
    .maybeSingle();
  if (existingError) throw existingError;

  let profile = existing as CommunityProfileRow | null;
  const metadataFavoriteMusic = String(identity.user.user_metadata?.favorite_music ?? "").slice(0, 500);
  const metadataSocialLinks = String(identity.user.user_metadata?.social_links ?? "").slice(0, 1000);
  if (!profile) {
    const preferredLogin = normalizeLogin(application?.login || fallbackLogin(identity.user));
    const { data: loginOwner, error: loginOwnerError } = await admin
      .from("pc_member_profiles")
      .select("user_id")
      .eq("login", preferredLogin)
      .maybeSingle();
    if (loginOwnerError) throw loginOwnerError;
    const userSuffix = identity.user.id.replaceAll("-", "").slice(0, 8);
    const login = !loginOwner || loginOwner.user_id === identity.user.id
      ? preferredLogin
      : `${preferredLogin.slice(0, 31)}-${userSuffix}`;
    const displayName = String(
      identity.adminProfile?.display_name || application?.login || identity.user.user_metadata?.display_name || login,
    ).slice(0, 80);
    const { data: created, error } = await admin
      .from("pc_member_profiles")
      .insert({
        user_id: identity.user.id,
        login,
        display_name: displayName,
        bio: String(application?.who ?? "").slice(0, 1200),
        favorite_music: metadataFavoriteMusic,
        social_links: metadataSocialLinks,
      })
      .select("user_id,login,display_name,bio,favorite_music,favorite_movies,social_links,header_color,header_flag,created_at")
      .single();
    if (error) throw error;
    profile = created as CommunityProfileRow;
  } else {
    const importedFields: Partial<Pick<CommunityProfileRow, "favorite_music" | "social_links">> = {};
    if (!profile.favorite_music && metadataFavoriteMusic) importedFields.favorite_music = metadataFavoriteMusic;
    if (!profile.social_links && metadataSocialLinks) importedFields.social_links = metadataSocialLinks;
    if (Object.keys(importedFields).length) {
      const { error } = await admin
        .from("pc_member_profiles")
        .update({ ...importedFields, updated_at: new Date().toISOString() })
        .eq("user_id", identity.user.id);
      if (error) throw error;
      profile = { ...profile, ...importedFields };
    }
  }

  return {
    user: identity.user,
    adminProfile: identity.adminProfile,
    profile: {
      ...profile,
      header_flag: effectiveHeaderFlag(identity.user, profile.header_flag),
      header_art: effectiveHeaderArt(identity.user),
      skin_url: application?.status === "approved" ? skinPreviewUrl(profile.login) : await createPlayerSkinSignedUrl(identity.user.id, identity.user.user_metadata),
    },
  };
}

export async function listFeed(viewer: CommunityViewer, filter: { query?: string; sort?: string; limit?: number } = {}): Promise<FeedPost[]> {
  const admin = createSupabaseAdminClient();
  const { data: posts, error } = await admin
    .from("pc_feed_posts")
    .select("id,author_id,title,body,image_path,created_at")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(0, 499);
  if (error) throw error;
  if (!posts?.length) return [];

  // Search and sorting include older posts, not only the first feed page.
  for (let offset = 500; posts.length === offset; offset += 500) {
    const result = await admin.from("pc_feed_posts").select("id,author_id,title,body,image_path,created_at").order("created_at", { ascending: false }).order("id", { ascending: false }).range(offset, offset + 499);
    if (result.error) throw result.error;
    posts.push(...(result.data ?? []));
  }
  const { data: searchProfiles, error: searchError } = await admin.from("pc_member_profiles").select("user_id,login,display_name").order("user_id").range(0, 499);
  if (searchError) throw searchError;
  if (searchProfiles) for (let offset = 500; searchProfiles.length === offset; offset += 500) {
    const result = await admin.from("pc_member_profiles").select("user_id,login,display_name").order("user_id").range(offset, offset + 499);
    if (result.error) throw result.error;
    searchProfiles.push(...(result.data ?? []));
  }
  const searchAuthors = new Map((searchProfiles ?? []).map(p => [p.user_id, p]));
  const matching = posts.filter(post => {
    const p = searchAuthors.get(post.author_id);
    const content = decodeFeedBody(post.body);
    return matchesFeedSearch(filter.query ?? "", [p?.login ?? "", p?.display_name ?? "", post.title, content.body, content.poll?.question ?? "", ...(content.poll?.options ?? [])]);
  });
  const sort = filter.sort ?? "newest";
  matching.sort((a, b) => {
    const date = Date.parse(b.created_at) - Date.parse(a.created_at) || b.id - a.id;
    if (sort === "oldest") return -date;
    if (sort === "nick") return (searchAuthors.get(a.author_id)?.login ?? "").localeCompare(searchAuthors.get(b.author_id)?.login ?? "", "ru", { numeric: true, sensitivity: "base" }) || date;
    return date;
  });
  posts.splice(0, posts.length, ...matching.slice(0, filter.limit ?? 80));
  if (!posts.length) return [];

  const postIds = posts.map((post) => post.id);
  const pollResults = await listFeedPollResults(posts, viewer.user.id);
  const authorIds = [...new Set(posts.map((post) => post.author_id))];
  const [{ data: profiles }, { data: storedComments, error: commentsError }, { data: reactions }, { data: follows }] = await Promise.all([
    admin.from("pc_member_profiles").select("user_id,login,display_name,header_color,header_flag").in("user_id", authorIds),
    admin.from("pc_feed_comments").select("id,post_id,author_id,body,created_at").in("post_id", postIds).order("created_at"),
    admin.from("pc_feed_reactions").select("post_id,user_id,reaction").in("post_id", postIds),
    admin.from("pc_profile_follows").select("following_id").eq("follower_id", viewer.user.id),
  ]);

  if (commentsError) throw commentsError;
  const comments = await visibleFeedComments(storedComments ?? []);

  const commentAuthorIds = [...new Set((comments ?? []).map((comment) => comment.author_id))];
  const missingIds = commentAuthorIds.filter((id) => !authorIds.includes(id));
  let commentProfiles: typeof profiles = [];
  if (missingIds.length) {
    const result = await admin.from("pc_member_profiles").select("user_id,login,display_name,header_color,header_flag").in("user_id", missingIds);
    commentProfiles = result.data ?? [];
  }
  const people = [...(profiles ?? []), ...(commentProfiles ?? [])];
  const [{ data: authUsers, error: authError }, marks, stickers] = await Promise.all([
    admin.auth.admin.listUsers({ page: 1, perPage: 1_000 }),
    playerMarks(people.map((profile) => profile.user_id), { frames: true }),
    stickerSummaries("feed_post", postIds, viewer.user.id),
  ]);
  if (authError) throw authError;
  const authUserMap = new Map(authUsers.users.map((user) => [user.id, user]));
  const hidePrideFlags = Boolean(viewer.user.app_metadata?.hide_pride_flags);
  const profileMap = new Map(people.map((profile) => [profile.user_id, {
    ...profile,
    header_flag: visibleHeaderFlag(authUserMap.get(profile.user_id), profile.header_flag, hidePrideFlags),
    header_art: effectiveHeaderArt(authUserMap.get(profile.user_id)),
    plus: Boolean(marks.get(profile.user_id)?.plus),
    ring: marks.get(profile.user_id)?.ring,
    tier: marks.get(profile.user_id)?.tier,
    headerFrames: marks.get(profile.user_id)?.headerFrames ?? [],
    headerFrameMs: marks.get(profile.user_id)?.headerFrameMs,
  }]));
  const followedIds = new Set((follows ?? []).map((follow) => follow.following_id));
  const seenPostIds = new Set(
    (Array.isArray(viewer.user.app_metadata?.feed_seen_posts) ? viewer.user.app_metadata.feed_seen_posts : [])
      .map(Number)
      .filter(Number.isSafeInteger),
  );
  return posts
    .map((post): FeedPost | null => {
      const author = profileMap.get(post.author_id);
      if (!author) return null;
      const postReactions = (reactions ?? []).filter((reaction) => reaction.post_id === post.id);
      return {
        id: post.id,
        title: post.title,
        body: decodeFeedBody(post.body).body,
        poll: pollResults.get(post.id) ?? null,
        imageUrl: post.image_path ? feedMediaUrl(post.image_path) : null,
        mediaKind: post.image_path ? (/\.(?:mp4|webm)$/i.test(post.image_path) ? "video" : "image") : null,
        createdAt: post.created_at,
        author,
        comments: (comments ?? []).filter((comment) => comment.post_id === post.id).flatMap((comment) => {
          const commentAuthor = profileMap.get(comment.author_id);
          return commentAuthor ? [{ id: comment.id, body: comment.body, createdAt: comment.created_at, author: commentAuthor }] : [];
        }),
        likes: postReactions.filter((reaction) => reaction.reaction === "like").length,
        dislikes: viewer.adminProfile ? postReactions.filter((reaction) => reaction.reaction === "dislike").length : null,
        myReaction: (postReactions.find((reaction) => reaction.user_id === viewer.user.id)?.reaction as "like" | "dislike" | undefined) ?? null,
        canDelete: post.author_id === viewer.user.id || Boolean(viewer.adminProfile),
        deleteAsAdmin: post.author_id !== viewer.user.id && Boolean(viewer.adminProfile),
        followed: followedIds.has(post.author_id),
        seen: seenPostIds.has(post.id),
        stickers: stickers.get(post.id)?.counts ?? [],
        mySticker: stickers.get(post.id)?.mine ?? null,
      };
    })
    .filter((post): post is FeedPost => Boolean(post));
}

export async function getPublicProfile(login: string, viewer: CommunityViewer) {
  const admin = createSupabaseAdminClient();
  const { data: profile, error } = await admin
    .from("pc_member_profiles")
    .select("user_id,login,display_name,bio,favorite_music,favorite_movies,social_links,header_color,header_flag,created_at")
    .eq("login", normalizeLogin(login))
    .maybeSingle();
  if (error) throw error;
  if (!profile) return null;

  const [{ data: following }, { data: followedBack }, { count: followers }, { count: followingCount }, { data: targetAuth }, reviewSummary, modelProfile, marks, plusProfile, plusTenure] = await Promise.all([
    admin.from("pc_profile_follows").select("following_id").eq("follower_id", viewer.user.id).eq("following_id", profile.user_id).maybeSingle(),
    admin.from("pc_profile_follows").select("following_id").eq("follower_id", profile.user_id).eq("following_id", viewer.user.id).maybeSingle(),
    admin.from("pc_profile_follows").select("following_id", { count: "exact", head: true }).eq("following_id", profile.user_id),
    admin.from("pc_profile_follows").select("following_id", { count: "exact", head: true }).eq("follower_id", profile.user_id),
    admin.auth.admin.getUserById(profile.user_id),
    listProfileReviews(profile.user_id, viewer.user.id),
    // No mode/revision supplied: this is a read, including a saved but unequipped pony.
    callModelService(profile.login, {}, { timeoutMs: 4000 }).catch(() => null),
    playerMarks([profile.user_id], { frames: true }),
    readPlusProfile(profile.user_id),
    plusTenureMonths(profile.user_id).catch(() => 0),
  ]);
  const isSelf = viewer.user.id === profile.user_id;
  const isFriend = Boolean(following && followedBack);
  const hidePrideFlags = Boolean(viewer.user.app_metadata?.hide_pride_flags);
  const plus = Boolean(marks.get(profile.user_id)?.plus);
  /* Закреплённый пост и живая шапка — возможности HYPE. */
  const hype = plus && marks.get(profile.user_id)?.tier === "hype";
  return {
    ...(profile as CommunityProfileRow),
    skin_url: skinPreviewUrl(profile.login),
    skin_model: activeHumanModel(modelProfile,targetAuth.user?.user_metadata?.minecraft_skin_model),
    pony: modelProfile ? profilePony(modelProfile) : null,
    header_flag: visibleHeaderFlag(targetAuth.user, profile.header_flag, hidePrideFlags),
    header_art: effectiveHeaderArt(targetAuth.user),
    /* Соцсети и контакты видны всем, кто открывает карточку (решение
       владельца 2026-10-03; раньше — только друзьям). contactsLocked остаётся
       в ответе для приложения, но всегда false. */
    social_links: profile.social_links ?? "",
    contactsLocked: false,
    isSelf,
    isFollowing: Boolean(following),
    isFriend,
    followers: followers ?? 0,
    following: followingCount ?? 0,
    reviews: reviewSummary.reviews,
    averageRating: reviewSummary.averageRating,
    myReview: reviewSummary.myReview,
    isProjectCreator: targetAuth.user?.email?.trim().toLowerCase() === PROJECT_CREATOR_EMAIL
      || ["platon", "plitle"].includes(normalizeLogin(profile.login)),
    /* Метку сооснователя ставит сама платформа по аккаунту владельца — вписать
       её себе в профиль нельзя. */
    isCofounder: targetAuth.user?.email?.trim().toLowerCase() === PROTECTED_OWNER_EMAIL
      || normalizeLogin(profile.login) === "step",
    /* Подписчик и первооткрыватель — отметки из оплаты, их тоже ставит сайт. */
    isPlus: plus,
    isPioneer: Boolean(marks.get(profile.user_id)?.pioneer),
    /* Оформление показывается, только пока нужный тариф активен. */
    plusRing: marks.get(profile.user_id)?.ring,
    plusTier: marks.get(profile.user_id)?.tier ?? "plus",
    headerFrames: hype ? marks.get(profile.user_id)?.headerFrames ?? [] : [],
    headerFrameMs: marks.get(profile.user_id)?.headerFrameMs,
    cardTheme: plus ? plusProfile.theme : "classic",
    plusTenure: plus ? plusTenure : 0,
    pinnedPost: hype ? await pinnedPostFor(profile.user_id, plusProfile.pinnedPostId) : null,
  };
}

/* Закреплённый пост в карточке игрока: только свой и только с HYPE. */
async function pinnedPostFor(userId: string, postId: number | null) {
  if (!postId) return null;
  const admin = createSupabaseAdminClient();
  const { data } = await admin.from("pc_feed_posts").select("id,author_id,title,body,image_path,created_at").eq("id", postId).maybeSingle();
  if (!data || data.author_id !== userId) return null;
  return {
    id: Number(data.id),
    title: String(data.title),
    body: decodeFeedBody(String(data.body)).body,
    imageUrl: data.image_path ? feedMediaUrl(String(data.image_path)) : null,
    mediaKind: data.image_path ? (/\.(?:mp4|webm)$/i.test(String(data.image_path)) ? "video" as const : "image" as const) : null,
    createdAt: String(data.created_at),
  };
}

export async function listPlayerDirectory(viewer: CommunityViewer): Promise<PlayerDirectoryEntry[]> {
  const admin = createSupabaseAdminClient();
  const { data: approvedApplications, error: applicationError } = await admin
    .from("waitlist_applications")
    .select("user_id")
    .eq("status", "approved")
    .eq("is_banned", false)
    .eq("is_deleted", false)
    .limit(1_000);
  if (applicationError) throw applicationError;

  const approvedUserIds = (approvedApplications ?? [])
    .map((application) => application.user_id)
    .filter((userId): userId is string => typeof userId === "string" && Boolean(userId));
  if (!approvedUserIds.length) return [];

  const [{ data: profiles, error: profileError }, { data: authUsers, error: authError }] = await Promise.all([
    admin
      .from("pc_member_profiles")
      .select("user_id,login,display_name,header_color,header_flag")
      .in("user_id", approvedUserIds)
      /* Администратор может убрать игрока из общего списка (например,
         служебный тестовый аккаунт). Карточка по прямой ссылке остаётся. */
      .eq("hidden_from_directory", false)
      .order("login")
      .limit(1_000),
    admin.auth.admin.listUsers({ page: 1, perPage: 1_000 }),
  ]);
  if (profileError) throw profileError;
  if (authError) throw authError;

  const authUserMap = new Map(authUsers.users.map((user) => [user.id, user]));
  const marks=await playerMarks((profiles ?? []).map((profile) => profile.user_id), { frames: true });
  const hidePrideFlags = Boolean(viewer.user.app_metadata?.hide_pride_flags);

  return (profiles ?? []).map((profile) => ({
    ...profile,
    header_flag: visibleHeaderFlag(authUserMap.get(profile.user_id), profile.header_flag, hidePrideFlags),
    header_art: effectiveHeaderArt(authUserMap.get(profile.user_id)),
    skin_url: skinPreviewUrl(profile.login),
    plus: Boolean(marks.get(profile.user_id)?.plus),
    pioneer: Boolean(marks.get(profile.user_id)?.pioneer),
    ring: marks.get(profile.user_id)?.ring ?? DEFAULT_RING,
    tier: marks.get(profile.user_id)?.tier ?? "plus",
    headerFrames: marks.get(profile.user_id)?.headerFrames ?? [],
    headerFrameMs: marks.get(profile.user_id)?.headerFrameMs ?? DEFAULT_FRAME_MS,
  }));
}

export async function getProfileConnections(
  login: string,
  kind: "followers" | "following",
  viewer: CommunityViewer,
) {
  const admin = createSupabaseAdminClient();
  const { data: owner, error: ownerError } = await admin
    .from("pc_member_profiles")
    .select("user_id,login,display_name")
    .eq("login", normalizeLogin(login))
    .maybeSingle();
  if (ownerError) throw ownerError;
  if (!owner) return null;

  const { data: relations, error: relationsError } = kind === "followers"
    ? await admin
        .from("pc_profile_follows")
        .select("follower_id,created_at")
        .eq("following_id", owner.user_id)
        .order("created_at", { ascending: false })
    : await admin
        .from("pc_profile_follows")
        .select("following_id,created_at")
        .eq("follower_id", owner.user_id)
        .order("created_at", { ascending: false });
  if (relationsError) throw relationsError;

  const userIds = (relations ?? []).map((relation) =>
    kind === "followers"
      ? (relation as { follower_id: string }).follower_id
      : (relation as { following_id: string }).following_id,
  );
  if (!userIds.length) return { owner, profiles: [] };

  const [{ data: profiles, error: profilesError }, { data: authUsers, error: authError }, marks] = await Promise.all([
    admin
      .from("pc_member_profiles")
      .select("user_id,login,display_name,header_color,header_flag")
      .in("user_id", userIds),
    admin.auth.admin.listUsers({ page: 1, perPage: 1_000 }),
    playerMarks(userIds),
  ]);
  if (profilesError) throw profilesError;
  if (authError) throw authError;

  const profileMap = new Map((profiles ?? []).map((profile) => [profile.user_id, profile]));
  const authUserMap = new Map(authUsers.users.map((user) => [user.id, user]));
  const hidePrideFlags = Boolean(viewer.user.app_metadata?.hide_pride_flags);
  return {
    owner,
    profiles: userIds.flatMap((userId) => {
      const profile = profileMap.get(userId);
      if (!profile) return [];
      return [{
        ...profile,
        header_flag: visibleHeaderFlag(authUserMap.get(userId), profile.header_flag, hidePrideFlags),
        header_art: effectiveHeaderArt(authUserMap.get(userId)),
        plus: Boolean(marks.get(userId)?.plus),
        ring: marks.get(userId)?.ring ?? DEFAULT_RING,
        tier: marks.get(userId)?.tier ?? "plus",
      }];
    }),
  };
}
