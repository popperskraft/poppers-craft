/* eslint-disable @next/next/no-img-element */
import type { Metadata } from "next";
import Link from "next/link";
import { loginPageUrl } from "@/lib/login-return";
import { MinecraftIcon } from "@/app/MinecraftIcon";
import { BackButton } from "@/app/BackButton";
import { getCommunityViewer } from "@/lib/community";
import { getViewerIdentity } from "@/lib/waitlist";
import { redirect } from "next/navigation";
import { WIKI_HUB_SECTIONS as wikiSections } from "@/lib/wiki-hub";
import "./metro-card.css";
import "./wiki-navigation.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Wiki PoppersCraft",
  description: "Справочник сервера и статьи игроков PoppersCraft: гайды, механики, строительство и история сообщества.",
};


export default async function WikiPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const query = String((await searchParams).q ?? "").trim().slice(0, 80);
  if (query) redirect(`/wiki/articles?q=${encodeURIComponent(query)}`);
  let viewer = null;
  try {
    const identity = await getViewerIdentity();
    viewer = identity && !identity.needsMfa ? await getCommunityViewer({ identity, allowAuthenticated: true }) : null;
  } catch (error) {
    console.error("Community Wiki is temporarily unavailable", error);
  }

  return (
    <main className="wiki-page">
      <article className="paint-window wiki-window">
        <div className="window-bar">
          <span className="window-title-with-icon"><MinecraftIcon name="book" size="sm" /> popperscraft_wiki.exe</span>
          <BackButton />
          <Link href="/" aria-label="Закрыть Wiki и вернуться на главную">×</Link>
        </div>
        <header className="wiki-hero">
          <p>СПРАВОЧНИК СЕРВЕРА</p>
          <h1>POPPERSCRAFT WIKI</h1>
          <p>pedik warning*</p>
          <div className="wiki-quick-actions">
            <span>PLAY.POPPERSCRAFT.ORG</span>
            <a href="https://map.popperscraft.org" target="_blank" rel="noreferrer">ОТКРЫТЬ КАРТУ ↗</a>
            <Link className="wiki-articles-action" href="/wiki/articles">СТАТЬИ ИГРОКОВ →</Link>
            {viewer ? <Link href="/wiki/new">+ СОЗДАТЬ СТАТЬЮ</Link> : <Link href={loginPageUrl("/wiki/new")}>ВОЙТИ И НАПИСАТЬ СТАТЬЮ</Link>}
          </div>
        </header>
        <nav className="wiki-index" aria-label="Разделы Wiki">
          {wikiSections.map((section, index) => <a key={section.id} href={`#${section.id}`}>{String(index + 1).padStart(2, "0")} / {section.title}</a>)}
          <Link href="/wiki/articles">08 / СТАТЬИ ИГРОКОВ</Link>
        </nav>
        <div className="wiki-grid">
          {wikiSections.map((section) => section.id === "metro" ? (
            <Link id="metro" className="wiki-card wiki-metro-card" href="/wiki/metro" key={section.id} aria-labelledby="wiki-metro-title">
              <div><MinecraftIcon name={section.icon} size="md" /><h2 id="wiki-metro-title">{section.title}</h2></div>
              <p>{section.lines[0]}</p>
              <span className="wiki-metro-card-action">ЧИТАТЬ ПОДРОБНЫЙ ГАЙД <span aria-hidden="true">→</span></span>
            </Link>
          ) : (
            <section id={section.id} className={`wiki-card wiki-card-${section.id}`} key={section.id}>
              <div><MinecraftIcon name={section.icon} size="md" /><h2>{section.title}</h2></div>
              {section.lines.length ? <ul>{section.lines.map((line) => <li key={line}>{line}</li>)}</ul> : null}
              {section.id === "start" ? (viewer ? <Link href="/members">ИГРАТЬ →</Link> : <Link href="/#waitlist">ПОДАТЬ ЗАЯВКУ →</Link>) : null}
              {section.id === "mods" ? <Link href="/wiki/mods">ОТКРЫТЬ ПОЛНЫЙ СПИСОК →</Link> : null}
              {section.id === "map" ? <a href="https://map.popperscraft.org" target="_blank" rel="noreferrer">ОТКРЫТЬ КАРТУ ↗</a> : null}
              {section.id === "community" ? <div className="wiki-card-links"><Link href="/feed">ОТКРЫТЬ ЛЕНТУ →</Link><Link href="/players">СПИСОК ИГРОКОВ →</Link></div> : null}
              {section.id === "help" ? <div className="wiki-card-links"><Link href="/rules">ЧИТАТЬ ПРАВИЛА</Link><a href="https://t.me/PoppersCraftAuthBot" target="_blank" rel="noreferrer">НАПИСАТЬ В TELEGRAM ↗</a></div> : null}
            </section>
          ))}
        </div>

        <section className="wiki-community wiki-library-link" id="player-articles">
          <div className="wiki-community-heading">
            <div><p>COMMUNITY_LIBRARY.DAT</p><h2>СТАТЬИ ИГРОКОВ</h2></div>
            <Link href="/wiki/articles">ОТКРЫТЬ ВСЕ СТАТЬИ →</Link>
          </div>
        </section>
        <footer className="wiki-footer"><Link href="/">← НА ГЛАВНУЮ</Link><a href="#start">НАВЕРХ ↑</a></footer>
      </article>
    </main>
  );
}
