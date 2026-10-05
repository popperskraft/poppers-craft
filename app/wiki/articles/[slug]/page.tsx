import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BackButton } from "@/app/BackButton";
import { MinecraftIcon } from "@/app/MinecraftIcon";
import { getCommunityViewer } from "@/lib/community";
import { getViewerIdentity } from "@/lib/waitlist";
import { getWikiArticle } from "@/lib/wiki";
import { marksFor } from "@/lib/player-marks";
import { WikiAuthor } from "../../WikiAuthor";
import { WikiTags } from "../../WikiLibrary";
import { WikiRating } from "../../WikiRating";
import { WikiCover } from "../../WikiCover";
import "../../wiki-community.css";
import { StickerBar } from "@/app/StickerBar";
import { WikiArticleContent } from "../../WikiArticleContent";
import { WikiComments } from "../../WikiComments";
import { WikiDeleteArticle } from "../../WikiDeleteArticle";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const article = await getWikiArticle((await params).slug, null);
  if (!article) return { title: "Статья не найдена — Wiki PoppersCraft" };
  return {
    title: `${article.title} — Wiki PoppersCraft`,
    description: article.summary || `Статья игрока @${article.author.login} в Wiki PoppersCraft.`,
    openGraph: {
      title: article.title,
      description: article.summary || `Статья игрока @${article.author.login}`,
      images: article.coverUrl ? [{ url: article.coverUrl, alt: article.title }] : [],
    },
    twitter: {
      card: article.coverUrl ? "summary_large_image" : "summary",
      title: article.title,
      description: article.summary || `Статья игрока @${article.author.login}`,
      images: article.coverUrl ? [article.coverUrl] : [],
    },
  };
}

function dateLabel(value: string | null) {
  return value ? new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "long", year: "numeric" }).format(new Date(value)) : "НЕ ОПУБЛИКОВАНО";
}

export default async function WikiArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const identity = await getViewerIdentity();
  const viewer = identity && !identity.needsMfa ? await getCommunityViewer({ identity, allowAuthenticated: true }) : null;
  const article = await getWikiArticle(slug, viewer);
  if (!article) notFound();
  /* Стикеры под статьёй ставят подписчики PLUS. */
  const viewerPlus = viewer ? (await marksFor(viewer.user.id)).plus : false;

  return (
    <main className="wiki-page wiki-reader-page" id="top">
      <article className="paint-window wiki-reader-window">
        <div className="window-bar">
          <span className="window-title-with-icon"><MinecraftIcon name="book" size="sm" /> {article.slug}.wiki</span>
          <BackButton fallback="/wiki" />
          <Link href="/wiki" aria-label="Закрыть статью">×</Link>
        </div>
        <WikiCover art={article.coverArt} />
        <header className="wiki-reader-header">
          <div className="wiki-reader-badges"><span>{article.category}</span>{article.status === "draft" ? <b>ЧЕРНОВИК</b> : null}</div>
          <h1 translate="no">{article.title}</h1>
          {article.summary ? <p translate="no">{article.summary}</p> : null}
          <div className="wiki-reader-credits">
            <WikiAuthor author={article.author} />
            <span>ОПУБЛИКОВАНО<br /><b>{dateLabel(article.publishedAt)}</b></span>
            {article.canEdit ? <Link href={`/wiki/articles/${article.slug}/edit`}>РЕДАКТИРОВАТЬ →</Link> : null}
            {/* Удалить может тот же круг, что и редактировать: автор и администраторы. */}
            {article.canEdit ? <WikiDeleteArticle articleId={article.id} title={article.title} /> : null}
          </div>
          <WikiTags tags={article.tags} />
        </header>
        <div className="wiki-reader-content">
          {article.content.some(block => block.type === "heading") ? <nav className="wiki-toc" aria-label="Содержание статьи"><details><summary>СОДЕРЖАНИЕ</summary><ol>{article.content.filter(block => block.type === "heading").map(block => <li key={block.id}><a href={`#section-${block.id}`} translate="no">{block.text}</a></li>)}</ol></details></nav> : null}
          <WikiArticleContent blocks={article.content} />
        </div>
        {article.status === "published" ? <WikiRating articleId={article.id} initial={article.rating} canRate={Boolean(viewer)} /> : null}
        {article.status === "published" ? (
          <StickerBar className="sticker-bar wiki-sticker-bar" kind="wiki_article" id={article.id} counts={article.stickers} mine={article.mySticker} canAdd={viewerPlus} />
        ) : null}
        {article.status === "published" ? <WikiComments articleId={article.id} comments={article.comments} canComment={Boolean(viewer)} /> : <p className="wiki-draft-note">Комментарии появятся после публикации статьи.</p>}
        <footer className="wiki-footer"><Link href="/wiki/articles">← КО ВСЕМ СТАТЬЯМ</Link><a href="#top">НАВЕРХ ↑</a></footer>
      </article>
    </main>
  );
}
