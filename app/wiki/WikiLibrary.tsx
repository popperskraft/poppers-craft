/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import type { WikiArticleSummary } from "@/lib/wiki";
import { WIKI_ARTICLE_CATEGORIES } from "@/lib/wiki-content";
import { WikiAuthor } from "./WikiAuthor";
import { PixelStars } from "@/app/PixelStars";
import { compareArticleRatings } from "@/lib/star-rating";
import { WikiCover } from "./WikiCover";
import { hasPixelHeaderArt } from "@/lib/profile-header-art";

export function WikiLibrary({ articles, drafts = [], query = "", category = "", sort = "new", unavailable = false, createHref }: {
  articles: WikiArticleSummary[]; drafts?: WikiArticleSummary[]; query?: string; category?: string; sort?: string; unavailable?: boolean; createHref: string;
}) {
  const filtered = articles.filter(article => !category || article.category === category);
  if (sort === "rating") filtered.sort(compareArticleRatings);
  if (sort === "discussion") filtered.sort((a, b) => b.commentCount - a.commentCount);
  return <section className="wiki-library" aria-labelledby="articles-title">
    <header className="wiki-library-heading"><div><p className="wiki-eyebrow">WIKI / COMMUNITY</p><h1 id="articles-title">СТАТЬИ ИГРОКОВ</h1><p>Гайды, истории и идеи нашего сообщества.</p></div><Link className="wiki-button is-acid" href={createHref}>+ НАПИСАТЬ СТАТЬЮ</Link></header>
    {drafts.length ? <details className="wiki-library-drafts"><summary>МОИ ЧЕРНОВИКИ <span>({drafts.length})</span></summary><div>{drafts.map(draft => <Link href={`/wiki/articles/${draft.slug}/edit`} key={draft.id}><span translate="no">{draft.title}</span><span>ПРОДОЛЖИТЬ →</span></Link>)}</div></details> : null}
    <form className="wiki-library-filters" action="/wiki/articles" method="get">
      <label className="wiki-library-search">ПОИСК<input type="search" name="q" maxLength={80} defaultValue={query} placeholder="Название, автор или #тег" /></label>
      <label>РАЗДЕЛ<select name="category" defaultValue={category}><option value="">Все разделы</option>{WIKI_ARTICLE_CATEGORIES.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
      <label>ПОРЯДОК<select name="sort" defaultValue={sort}><option value="new">Сначала новые</option><option value="rating">Лучшие по оценке</option><option value="discussion">По обсуждению</option></select></label>
      <button className="wiki-button is-cyan" type="submit">НАЙТИ</button>
    </form>
    <div className="wiki-library-results"><span>{`Статей: ${filtered.length}`}</span>{query || category || sort !== "new" ? <Link href="/wiki/articles">СБРОСИТЬ ФИЛЬТРЫ</Link> : null}</div>
    <div className="wiki-library-grid">{filtered.map(article => <article className="wiki-library-card" key={article.id}>
      {hasPixelHeaderArt(article.coverArt ?? null) ? <Link className="wiki-library-painted-cover" href={`/wiki/articles/${article.slug}`} aria-label="Открыть статью"><WikiCover art={article.coverArt} /></Link> : article.coverUrl ? <Link className="wiki-library-cover" href={`/wiki/articles/${article.slug}`} aria-label="Открыть статью"><img src={article.coverUrl} alt="" /></Link> : null}
      <div className="wiki-library-card-body">
        <span className="wiki-category">{article.category}</span>
        <h2><Link href={`/wiki/articles/${article.slug}`} translate="no">{article.title}</Link></h2>
        {article.summary ? <p className="wiki-library-summary" translate="no">{article.summary}</p> : null}
        <WikiTags tags={article.tags} />
        <div className="wiki-library-card-author"><WikiAuthor author={article.author} compact /><time dateTime={article.publishedAt ?? article.updatedAt}>{new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric" }).format(new Date(article.publishedAt ?? article.updatedAt))}</time></div>
        <footer><Link className="wiki-card-rating" href={`/wiki/articles/${article.slug}#wiki-rating-title`}><PixelStars rating={article.rating.average} /><span>{article.rating.count ? `${article.rating.average.toFixed(1)} / 5 · Оценок: ${article.rating.count}` : "Нет оценок"}</span></Link><Link href={`/wiki/articles/${article.slug}#discussion`}>{`Комментариев: ${article.commentCount}`}</Link></footer>
      </div>
    </article>)}</div>
    {unavailable ? <p className="wiki-library-empty" role="status">НЕ УДАЛОСЬ ЗАГРУЗИТЬ СТАТЬИ. ПОПРОБУЙ ОБНОВИТЬ СТРАНИЦУ.</p> : !filtered.length ? <div className="wiki-library-empty"><h2>{query || category ? "Ничего не найдено" : "Здесь будет ваша история"}</h2><p>{query || category ? "Попробуйте другой запрос или выберите все разделы." : "Поделитесь полезным гайдом или расскажите о жизни сервера."}</p><Link className="wiki-button" href={query || category ? "/wiki/articles" : createHref}>{query || category ? "СБРОСИТЬ ФИЛЬТРЫ" : "+ НАПИСАТЬ СТАТЬЮ"}</Link></div> : null}
  </section>;
}

export function WikiTags({ tags }: { tags: string[] }) {
  return tags.length ? <ul className="wiki-tags" aria-label="Теги статьи">{tags.map(tag => <li key={tag}><Link href={`/wiki/articles?q=${encodeURIComponent(tag)}`} translate="no">#{tag}</Link></li>)}</ul> : null;
}
