"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { MinecraftIcon } from "@/app/MinecraftIcon";
import { whitelistBadgeLabel } from "@/lib/site-navigation";

const CLOSED_KEY = "pc_whitelist_nudge_closed";

/* Полоска под шапкой: в вайтлисте есть анкеты, за которые игрок ещё не
   голосовал. Владелец попросил, чтобы игроки поняли, что новичков
   оценивают они (2026-10-02). Закрытая полоска не возвращается, пока не
   придёт анкета новее (номер хранится в браузере). Показывается после
   загрузки страницы: до этого неизвестно, закрывал ли её игрок. */
export function WhitelistNudge({ count, latestId }: { count: number; latestId: number }) {
  const [closedId, setClosedId] = useState<number | null>(null);

  useEffect(() => {
    try {
      setClosedId(Number(window.localStorage.getItem(CLOSED_KEY)) || 0);
    } catch {
      setClosedId(0);
    }
  }, []);

  if (closedId === null || count < 1 || latestId <= closedId) return null;

  const close = () => {
    try {
      window.localStorage.setItem(CLOSED_KEY, String(latestId));
    } catch {
      // Без хранилища полоска просто скроется до перезагрузки.
    }
    setClosedId(latestId);
  };

  /* Полоса под полоской — продолжение шапки (site-nav.css): фон страницы
     начинается под ней и не съезжает. */
  return (
    <div className="whitelist-nudge-band">
    <aside className="whitelist-nudge" aria-label="Голосование в вайтлисте">
      <MinecraftIcon name="writable_book" size="md" />
      <p>
        <b>{`${whitelistBadgeLabel(count)}.`}</b>{" "}
        <span>Прочитайте анкету новичка и нажмите «ЗА» или «ПРОТИВ». Администрация смотрит на голоса игроков, когда решает, пускать ли его на сервер.</span>
      </p>
      <Link className="whitelist-nudge-link" href="/whitelist">ГОЛОСОВАТЬ →</Link>
      <button className="whitelist-nudge-close" type="button" onClick={close} aria-label="Скрыть до новой анкеты" title="Скрыть до новой анкеты">×</button>
    </aside>
    </div>
  );
}
