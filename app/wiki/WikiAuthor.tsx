import Link from "next/link";
import { ProfileHeaderArt } from "@/app/ProfileHeaderArt";
import type { WikiAuthor as Author } from "@/lib/wiki";
import { plusClass } from "@/lib/plus-style";

export function WikiAuthor({ author, compact = false }: { author: Author; compact?: boolean }) {
  return <Link href={`/players/${encodeURIComponent(author.login)}`} className={`wiki-person ${compact ? "is-compact" : ""}`}>
    <span className={`wiki-person-art profile-flag flag-${author.headerFlag ?? "none"}`} style={{ backgroundColor: author.headerColor }} aria-hidden="true">
      {/* Анимация шапки — только в профиле игрока. */}
      <ProfileHeaderArt art={author.headerFlag === "custom" ? author.headerArt ?? null : null} playing={false} />
    </span>
    <span className="wiki-person-name" translate="no"><strong className={plusClass(author.plus, author.ring, author.tier) || undefined}>{author.displayName || author.login}</strong><small>@{author.login}</small></span>
  </Link>;
}
