import "server-only";

import { FEED_BUCKET } from "@/lib/community";
import { forgetFeedMedia } from "@/lib/feed-media";
import { removePlayerSkin } from "@/lib/player-skins";
import {
  profileReviewReactionTitle,
  profileReviewReplyTitle,
  profileReviewTitle,
} from "@/lib/profile-reviews";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

function authUserMissing(error: { status?: number; code?: string } | null) {
  return error?.status === 404 || error?.code === "user_not_found";
}

export async function permanentlyDeletePlayerAccount({
  applicationId,
  userId,
}: {
  applicationId: number;
  userId: string | null;
}) {
  const client = createSupabaseAdminClient();
  const feedPaths: string[] = [];

  if (userId) {
    const { data: posts, error: postsError } = await client
      .from("pc_feed_posts")
      .select("image_path")
      .eq("author_id", userId);
    if (postsError) throw postsError;
    for (const post of posts ?? []) if (post.image_path) feedPaths.push(post.image_path);

    const { data: authData, error: authReadError } = await client.auth.admin.getUserById(userId);
    if (authReadError && !authUserMissing(authReadError)) throw authReadError;
    if (authData?.user) {
      // The second argument must stay false: true is a soft delete and keeps
      // the synthetic login email reserved in Supabase Auth.
      const { error: authDeleteError } = await client.auth.admin.deleteUser(userId, false);
      if (authDeleteError && !authUserMissing(authDeleteError)) throw authDeleteError;
    }
  }

  const { data: deletedApplication, error: applicationDeleteError } = await client
    .from("waitlist_applications")
    .delete()
    .eq("id", applicationId)
    .select("id")
    .maybeSingle();
  if (applicationDeleteError) throw applicationDeleteError;
  if (!deletedApplication) throw new Error("Application was not deleted.");

  const applicationTitles = [
    `application:${applicationId}`,
    `review:${applicationId}`,
    `review-reaction:${applicationId}`,
    `review-reply:${applicationId}`,
  ];
  const cleanup = [client.from("site_updates").delete().in("title", applicationTitles)];

  if (userId) {
    cleanup.push(
      client.from("site_updates").delete().in("title", [
        profileReviewTitle(userId),
        profileReviewReactionTitle(userId),
        profileReviewReplyTitle(userId),
      ]),
      client.from("site_updates").delete().like("source_key", `%:${userId}`),
    );
  }

  forgetFeedMedia(feedPaths);
  await Promise.all([
    ...cleanup,
    userId ? removePlayerSkin(userId).catch(() => undefined) : Promise.resolve(),
    feedPaths.length ? client.storage.from(FEED_BUCKET).remove(feedPaths) : Promise.resolve(),
  ]);
}
