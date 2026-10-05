import { NextRequest, NextResponse } from "next/server";
import { getCommunityViewer, listFeed } from "@/lib/community";
import { getServerStatus } from "@/lib/minecraft-stats";
import { getViewerIdentity } from "@/lib/waitlist";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PAGE_SIZE = 40;
const MAX_PAGES = 25;

/* Лента для приложения PoppersCraft на iPhone — те же данные, что у страницы
   /feed (listFeed), только в JSON. Действия с постами идут через обычные
   /api/feed/posts/*: они уже принимают запросы приложения. */
export async function GET(request: NextRequest) {
  const identity = await getViewerIdentity();
  if (!identity || identity.needsMfa) {
    return NextResponse.json({ error: "Войдите в аккаунт." }, { status: 401, headers: { "Cache-Control": "private, no-store" } });
  }
  const viewer = await getCommunityViewer({ identity, allowAuthenticated: true });
  if (!viewer) return NextResponse.json({ error: "Лента доступна игрокам сервера." }, { status: 403 });

  const params = request.nextUrl.searchParams;
  const query = String(params.get("q") ?? "").slice(0, 120);
  const sortParam = params.get("sort") ?? "";
  const sort = ["newest", "oldest", "nick"].includes(sortParam) ? sortParam : "newest";
  const page = Math.min(MAX_PAGES, Math.max(1, Math.floor(Number(params.get("page")) || 1)));

  try {
    const [posts, server] = await Promise.all([
      listFeed(viewer, { query, sort, limit: page * PAGE_SIZE }),
      getServerStatus(),
    ]);
    return NextResponse.json(
      {
        posts,
        page,
        hasMore: posts.length >= page * PAGE_SIZE && page < MAX_PAGES,
        isAdmin: Boolean(viewer.adminProfile),
        myLogin: viewer.profile.login,
        online: server.online,
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    console.error("App feed failed", error);
    return NextResponse.json({ error: "Не удалось загрузить ленту." }, { status: 503 });
  }
}
