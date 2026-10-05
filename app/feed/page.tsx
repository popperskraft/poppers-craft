import { redirect } from "next/navigation";
import { loginPageUrl } from "@/lib/login-return";
import { FeedClient } from "./FeedClient";
import { getCommunityViewer, listFeed } from "@/lib/community";
import { getServerStatus } from "@/lib/minecraft-stats";
import { getViewerIdentity } from "@/lib/waitlist";
import { marksFor } from "@/lib/player-marks";
import { earlyAccessFor, readPlusProfile } from "@/lib/plus-perks";
import { BackButton } from "@/app/BackButton";
import "./feed-toolbar.css";

export const dynamic = "force-dynamic";

export default async function FeedPage({ searchParams }: { searchParams: Promise<{ q?: string; sort?: string; page?: string }> }) {
  const params = await searchParams;
  const query = String(params.q ?? "").slice(0, 120);
  const sort = ["newest", "oldest", "nick"].includes(params.sort ?? "") ? params.sort! : "newest";
  const page = Math.min(25, Math.max(1, Math.floor(Number(params.page) || 1)));
  const identity = await getViewerIdentity();
  if (!identity) redirect(loginPageUrl("/feed"));
  if (identity.needsMfa) redirect("/mfa?next=/feed");
  const viewer = await getCommunityViewer({ identity, allowAuthenticated: true });
  /* Вход есть, но профиль сообщества не открылся — окно входа тут не поможет. */
  if (!viewer) redirect("/");
  const [posts, server, marks, plusProfile, earlyAccess] = await Promise.all([
    listFeed(viewer, { query, sort, limit: page * 40 }),
    getServerStatus(),
    marksFor(viewer.user.id),
    readPlusProfile(viewer.user.id),
    earlyAccessFor({ userId: viewer.user.id, isAdmin: Boolean(viewer.adminProfile) }),
  ]);
  return (
    <main className="community-page">
      <header className="community-topbar">
        <BackButton />
        <strong>ЛЕНТА ИГРОКОВ</strong>
      </header>
      <FeedClient
        posts={posts}
        isAdmin={Boolean(viewer.adminProfile)}
        query={query}
        sort={sort}
        page={page}
        online={server.online}
        viewerPlus={marks.plus}
        viewerHype={marks.plus && marks.tier === "hype"}
        pinnedPostId={plusProfile.pinnedPostId}
        earlyAccess={earlyAccess}
      />
    </main>
  );
}
