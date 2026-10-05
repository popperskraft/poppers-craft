import { notFound, redirect } from "next/navigation";
import { loginPageUrl } from "@/lib/login-return";
import { WikiArticleEditor } from "../../../WikiArticleEditor";
import { getCommunityViewer } from "@/lib/community";
import { getViewerIdentity } from "@/lib/waitlist";
import { getWikiArticle } from "@/lib/wiki";

export const dynamic = "force-dynamic";

export default async function EditWikiArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const identity = await getViewerIdentity();
  if (!identity) redirect(loginPageUrl(`/wiki/articles/${encodeURIComponent(slug)}/edit`));
  if (identity.needsMfa) redirect(`/mfa?next=/wiki/articles/${encodeURIComponent(slug)}/edit`);
  const viewer = await getCommunityViewer({ identity, allowAuthenticated: true });
  /* Вход есть, но профиль сообщества не открылся — окно входа тут не поможет. */
  if (!viewer) redirect("/");
  const article = await getWikiArticle(slug, viewer);
  if (!article || !article.canEdit) notFound();

  return (
    <main className="wiki-page wiki-editor-page">
      <WikiArticleEditor userId={viewer.user.id} article={{
        id: article.id,
        slug: article.slug,
        title: article.title,
        summary: article.summary,
        category: article.category,
        tags: article.tags,
        content: article.content,
        coverArt: article.coverArt,
        status: article.status,
        updatedAt: article.updatedAt,
      }} />
    </main>
  );
}
