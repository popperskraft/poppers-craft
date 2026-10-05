import { NextResponse } from "next/server";
import { getCommunityViewer } from "@/lib/community";
import { getViewerIdentity } from "@/lib/waitlist";
import { getWikiArticle } from "@/lib/wiki";

export const dynamic = "force-dynamic";

/* Одна статья Wiki для приложения: блоки содержимого, комментарии и право
   редактирования — как на странице /wiki/articles/[slug]. */
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  let viewer = null;
  try {
    const identity = await getViewerIdentity();
    viewer = identity && !identity.needsMfa ? await getCommunityViewer({ identity, allowAuthenticated: true }) : null;
  } catch {
    viewer = null;
  }
  try {
    const article = await getWikiArticle(slug, viewer);
    if (!article) return NextResponse.json({ error: "Статья не найдена." }, { status: 404 });
    return NextResponse.json({ article, signedIn: Boolean(viewer) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("App wiki article failed", error);
    return NextResponse.json({ error: "Статья временно недоступна." }, { status: 503 });
  }
}
