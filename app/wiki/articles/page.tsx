import type { Metadata } from "next";
import Link from "next/link";
import { loginPageUrl } from "@/lib/login-return";
import { BackButton } from "@/app/BackButton";
import { MinecraftIcon } from "@/app/MinecraftIcon";
import { getCommunityViewer } from "@/lib/community";
import { getViewerIdentity } from "@/lib/waitlist";
import { listWikiArticles, listWikiDrafts } from "@/lib/wiki";
import { WikiLibrary } from "../WikiLibrary";
import "../wiki-navigation.css";
import "../wiki-community.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Статьи игроков — Wiki PoppersCraft",
  description: "Статьи игроков PoppersCraft: гайды, строительство и история сообщества.",
};

export default async function WikiArticlesPage({ searchParams }: { searchParams: Promise<{ q?: string; category?: string; sort?: string }> }) {
  const params = await searchParams;
  const query = String(params.q ?? "").trim().replace(/^#/, "").slice(0, 80);
  let viewer = null;
  let articles: Awaited<ReturnType<typeof listWikiArticles>> = [];
  let drafts: Awaited<ReturnType<typeof listWikiDrafts>> = [];
  let unavailable = false;
  try {
    const identity = await getViewerIdentity();
    viewer = identity && !identity.needsMfa ? await getCommunityViewer({ identity, allowAuthenticated: true }) : null;
  } catch (error) { console.error("Wiki viewer is temporarily unavailable", error); }
  try { articles = await listWikiArticles(query, viewer); }
  catch (error) { unavailable = true; console.error("Wiki articles are temporarily unavailable", error); }
  if (viewer) {
    try { drafts = await listWikiDrafts(viewer); }
    catch (error) { console.error("Wiki drafts are temporarily unavailable", error); }
  }
  return <main className="wiki-page wiki-articles-page" id="top">
    <article className="paint-window wiki-window">
      <div className="window-bar"><span className="window-title-with-icon"><MinecraftIcon name="book" size="sm" /> player_articles.exe</span><BackButton fallback="/wiki" /><Link href="/wiki" aria-label="Вернуться в Wiki">×</Link></div>
      <WikiLibrary articles={articles} drafts={drafts} query={query} category={String(params.category ?? "")} sort={String(params.sort ?? "new")} unavailable={unavailable} createHref={viewer ? "/wiki/new" : loginPageUrl("/wiki/new")} />
      <footer className="wiki-footer"><Link href="/wiki">← В WIKI</Link><a href="#top">НАВЕРХ ↑</a></footer>
    </article>
  </main>;
}

