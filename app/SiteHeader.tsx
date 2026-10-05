"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { ProfileMenu } from "@/app/ProfileMenu";
import { LanguageSwitch } from "@/app/profile/LanguageSwitch";
import { loginPageUrl } from "@/lib/login-return";
import { hasSiteHeader, isCurrentNavItem, mainNavItems, whitelistBadgeLabel, type NavViewer } from "@/lib/site-navigation";
import { WhitelistNudge } from "@/app/WhitelistNudge";

/* Шапка внутренних страниц — та же, что на главной (пункты в
   lib/site-navigation.ts), только стоит в начале страницы, а не
   закреплена: у многих страниц ниже есть своя липкая панель. */
export function SiteHeader({ viewer }: { viewer: NavViewer | null }) {
  const pathname = usePathname() || "/";
  const [menuOpen, setMenuOpen] = useState(false);

  /* Меню закрывается и при переходе кнопками браузера. */
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  if (!hasSiteHeader(pathname)) return null;
  const items = mainNavItems(viewer);
  const closeMenu = () => setMenuOpen(false);
  const hasBadge = items.some((item) => item.badge);
  /* В самом вайтлисте полоска не нужна. */
  const showNudge = Boolean(viewer?.whitelistToVote) && !pathname.startsWith("/whitelist");

  return (
    <>
    <header className="site-header site-header-inner">
      <Link className="mini-logo" href="/" aria-label="PoppersCraft — на главную">
        <span>POPPERSCRAFT</span>
        <Image className="platform-logo" src="/popperscraft-p.svg" alt="" width={38} height={38} />
      </Link>
      <button
        className="mobile-menu-button win-button"
        type="button"
        aria-label="Открыть меню"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((value) => !value)}
      >
        меню
        {hasBadge ? <span className="nav-badge-dot" aria-hidden="true" /> : null}
      </button>
      <nav className={menuOpen ? "main-nav is-open" : "main-nav"} aria-label="Основное меню">
        {items.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={item.badge ? "has-nav-badge" : undefined}
            title={item.badge ? whitelistBadgeLabel(item.badge) : undefined}
            aria-current={isCurrentNavItem(item, pathname) ? "page" : undefined}
            onClick={closeMenu}
          >
            {item.label}
            {item.badge ? <span className="nav-badge" aria-label={whitelistBadgeLabel(item.badge)}>{item.badge}</span> : null}
          </Link>
        ))}
        <LanguageSwitch compact />
      </nav>
      {viewer?.authenticated ? (
        <ProfileMenu approved={viewer.approved || viewer.admin} needsMfa={viewer.needsMfa} />
      ) : (
        <Link className="header-login-button" href={loginPageUrl(pathname)}>ВХОД →</Link>
      )}
    </header>
    {showNudge ? <WhitelistNudge count={viewer?.whitelistToVote ?? 0} latestId={viewer?.whitelistLatestId ?? 0} /> : null}
    </>
  );
}
