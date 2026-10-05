"use client";

import { useDeferredValue, useMemo, useState } from "react";
import Link from "next/link";
import type { PlayerDirectoryEntry } from "@/lib/community";
import { MinecraftSkinPreview } from "@/app/MinecraftSkinPreview";
import { ProfileHeaderArt } from "@/app/ProfileHeaderArt";
import { joinClasses, plusClass } from "@/lib/plus-style";

function normalizeSearch(value: string) {
  return value.trim().replace(/^@/, "").toLocaleLowerCase("ru-RU");
}

export function PlayerDirectory({ players, online = [] }: { players: PlayerDirectoryEntry[]; online?: string[] }) {
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(normalizeSearch(query));
  const filteredPlayers = useMemo(() => {
    if (!deferredQuery) return players;
    const searchParts = deferredQuery.split(/\s+/).filter(Boolean);
    return players
      .filter((player) => {
        const searchable = `${player.login} ${player.display_name}`.toLocaleLowerCase("ru-RU");
        return searchParts.every((part) => searchable.includes(part));
      })
      .sort((left, right) => {
        const leftLogin = left.login.toLocaleLowerCase("ru-RU");
        const rightLogin = right.login.toLocaleLowerCase("ru-RU");
        const score = (login: string) => login === deferredQuery ? 0 : login.startsWith(deferredQuery) ? 1 : 2;
        return score(leftLogin) - score(rightLogin) || leftLogin.localeCompare(rightLogin);
      });
  }, [deferredQuery, players]);

  return (
    <div className="paint-window player-directory-window">
      <div className="window-bar"><span>players_list.exe</span><span>□</span></div>
      <header className="player-directory-search">
        <p>УМНЫЙ ПОИСК ПО НИКУ</p>
        <div>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value.slice(0, 80))}
            placeholder="Начни вводить ник игрока…"
            autoComplete="off"
            autoFocus
            aria-label="Поиск игрока по нику"
          />
          {query ? <button type="button" onClick={() => setQuery("")} aria-label="Очистить поиск">×</button> : null}
        </div>
        <span>{deferredQuery ? `НАЙДЕНО: ${filteredPlayers.length}` : `ВСЕГО ИГРОКОВ: ${players.length}`}</span>
      </header>
      <div className="player-directory-grid" aria-live="polite">
        {filteredPlayers.map((player) => (
          <PlayerDirectoryCard key={player.user_id} player={player} online={online.includes(player.login.toLowerCase())} />
        ))}
        {!filteredPlayers.length ? <p className="player-directory-empty">ИГРОКИ НЕ НАЙДЕНЫ.<br />ПОПРОБУЙ ДРУГОЙ НИК.</p> : null}
      </div>
      <div className="status-bar"><span>PLAYERS_LOADED</span><span>{filteredPlayers.length} RECORDS</span></div>
    </div>
  );
}

/* Анимированные шапки и радужная обводка в списке оживают только под
   курсором или при фокусе с клавиатуры: когда игроков много, всё сразу
   двигаться не должно (решение владельца, 2026-10-02). */
function PlayerDirectoryCard({ player, online }: { player: PlayerDirectoryEntry; online: boolean }) {
  const [active, setActive] = useState(false);
  return (
    <Link
      className={joinClasses("player-directory-card", plusClass(player.plus, player.ring, player.tier))}
      href={`/players/${player.login}`}
      onMouseEnter={() => setActive(true)}
      onMouseLeave={() => setActive(false)}
      onFocus={() => setActive(true)}
      onBlur={() => setActive(false)}
    >
      {/* Плашки подписки и «Первооткрывателя» — только в самом профиле:
          в общем списке они превращались в визуальный шум. Подписчика
          здесь и так видно по обводке карточки. */}
      <div className="player-directory-skin-slot">
        <MinecraftSkinPreview src={player.skin_url} className="player-directory-skin" alt={`Скин игрока ${player.login}`} />
        {online ? <span className="pc-online-badge">В ИГРЕ</span> : null}
      </div>
      <div className={`player-directory-header profile-flag flag-${player.header_flag}`} style={{ backgroundColor: player.header_color }}>
        <ProfileHeaderArt art={player.header_flag === "custom" ? player.header_art : null} frames={player.plus && player.header_flag === "custom" ? player.headerFrames : []} frameMs={player.headerFrameMs} playing={active} />
        <div className="player-directory-names">
          <strong title={player.display_name} translate="no">{player.display_name}</strong>
          <span title={`@${player.login}`} translate="no">@{player.login}</span>
        </div>
      </div>
    </Link>
  );
}
