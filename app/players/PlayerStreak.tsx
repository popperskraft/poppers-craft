"use client";

import { useEffect, useState } from "react";
import type { PlayerStreakData } from "@/lib/player-streak";
import { formatStreakDays } from "@/lib/streak";
import styles from "./PlayerStreak.module.css";

const POLL_MS = 60_000;

export function PlayerStreak({ login, initialStreak }: {
  login: string;
  initialStreak: PlayerStreakData | null;
}) {
  const [streak, setStreak] = useState(initialStreak);

  useEffect(() => {
    let cancelled = false;
    let inFlight: AbortController | null = null;
    const refresh = async () => {
      if (document.visibilityState === "hidden" || inFlight) return;
      const controller = new AbortController();
      inFlight = controller;
      const timeout = window.setTimeout(() => controller.abort(), 10_000);
      try {
        const response = await fetch(`/api/profiles/${encodeURIComponent(login)}/streak`, {
          cache: "no-store", signal: controller.signal,
        });
        if (!response.ok) throw new Error("Streak request failed");
        const result = await response.json() as { streak: PlayerStreakData | null };
        if (!cancelled) setStreak(result.streak ?? null);
      } catch {
        // An unavailable server is not a lost streak. Never substitute zero.
        if (!cancelled) setStreak(null);
      } finally {
        window.clearTimeout(timeout);
        if (inFlight === controller) inFlight = null;
      }
    };
    const onVisibilityChange = () => { if (document.visibilityState === "visible") void refresh(); };
    const timer = window.setInterval(() => void refresh(), POLL_MS);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      cancelled = true;
      inFlight?.abort();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [login]);

  // No inactive card, catalogue or future milestones. Only the current flame.
  if (!streak || streak.currentDays < 1 || !streak.flameSrc) return null;
  const label = `Ударный режим: ${formatStreakDays(streak.currentDays)}`;

  return (
    <span className={styles.streak} role="img" aria-label={label} title={label}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={streak.flameSrc} width="24" height="24" alt="" aria-hidden="true" className={styles.flame} />
      <span className={styles.count} aria-hidden="true" translate="no">{streak.currentDays}</span>
    </span>
  );
}
