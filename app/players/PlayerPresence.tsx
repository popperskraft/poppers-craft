"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import styles from "./PlayerPresence.module.css";

const subscribeToHydration = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;

export function PlayerPresence({ online, lastSeen, trailing }: { online: boolean; lastSeen?: string | null; trailing?: ReactNode }) {
  const timestamp = lastSeen && Number.isFinite(Date.parse(lastSeen)) ? lastSeen : null;
  // Stable UTC markup for SSR; then show the visitor's local date and time zone.
  const hydrated = useSyncExternalStore(subscribeToHydration, clientSnapshot, serverSnapshot);
  const localTime = hydrated && timestamp ? new Intl.DateTimeFormat(document.documentElement.lang === "en" ? "en-GB" : "ru-RU", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "short",
  }).format(new Date(timestamp)) : "";
  if (online) return <div className={styles.online}><span className="pc-online-badge">В ИГРЕ</span>{trailing}</div>;
  return <div className={`player-last-seen ${styles.presence}`}>
    <div className={styles.statusLine}>
      <span>{timestamp ? "Последний раз в игре:" : "Нет данных о последней игре"}</span>
      {trailing}
    </div>
    {timestamp ? <time dateTime={timestamp} translate="no">{localTime || `${new Date(timestamp).toISOString().slice(0, 16).replace("T", " ")} UTC`}</time> : null}
  </div>;
}
