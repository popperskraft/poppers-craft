import { NextRequest, NextResponse } from "next/server";
import { getCommunityViewer } from "@/lib/community";
import { serverCatalog } from "@/lib/server-catalog";
import { getViewerIdentity } from "@/lib/waitlist";
import { listWikiArticles } from "@/lib/wiki";
import { WIKI_ARTICLE_CATEGORIES } from "@/lib/wiki-content";
import { WIKI_HUB_SECTIONS } from "@/lib/wiki-hub";

export const dynamic = "force-dynamic";

/* Wiki для приложения PoppersCraft на iPhone: разделы справочника, статьи
   игроков (с поиском) и каталог модов — то же, что на /wiki, /wiki/articles
   и /wiki/mods. */
export async function GET(request: NextRequest) {
  const query = String(request.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 80);
  let canWrite = false;
  try {
    const identity = await getViewerIdentity();
    canWrite = Boolean(identity && !identity.needsMfa && await getCommunityViewer({ identity, allowAuthenticated: true }));
  } catch {
    canWrite = false;
  }
  try {
    const articles = await listWikiArticles(query);
    return NextResponse.json(
      { sections: WIKI_HUB_SECTIONS, categories: WIKI_ARTICLE_CATEGORIES, articles, mods: serverCatalog, canWrite },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    console.error("App wiki failed", error);
    return NextResponse.json({ error: "Wiki временно недоступна." }, { status: 503 });
  }
}
