import "server-only";

import { readFile } from "node:fs/promises";
import { calculateStreak, isStreakDay, type PlayerStreakData as StreakSummary } from "./streak";
import { getStreakFlame } from "./streak-art";

export type PlayerStreakData = StreakSummary & { flameSrc: string | null };

const SNAPSHOT_PATH = process.env.POPPERSCRAFT_STREAK_FILE || "/var/lib/popperscraft-streak/streaks.json";
const MAX_AGE_MS = 3 * 60_000;
type Snapshot = {
  generatedAt: string;
  players: Record<string, { days: string[] }>;
};
let cached: { readAt: number; snapshot: Snapshot | null } | null = null;
let reading: Promise<Snapshot | null> | null = null;

async function readSnapshot(now: number): Promise<Snapshot | null> {
  if (cached && now >= cached.readAt && now - cached.readAt < 10_000) return cached.snapshot;
  if (reading) return reading;
  reading = (async () => {
    let snapshot: Snapshot | null = null;
    try {
      const raw = await readFile(SNAPSHOT_PATH, "utf8");
      // This private local file is written atomically by the collector, never by a player.
      const value = JSON.parse(raw);
      if (value?.version === 1 && value?.source === "poppersauth-confirmed-logins"
        && value?.timeZone === "Europe/Moscow" && value?.utcOffsetMinutes === 180
        && typeof value?.generatedAt === "string" && Number.isFinite(Date.parse(value.generatedAt))
        && value.players && typeof value.players === "object" && !Array.isArray(value.players)) {
        snapshot = value;
      }
    } catch {
      // Missing, unreadable or incomplete data is unavailable, never a lost streak.
    }
    cached = { readAt: now, snapshot };
    return snapshot;
  })();
  try { return await reading; } finally { reading = null; }
}

/** Server-only: browser input cannot award a day or change the calendar. */
export async function getPlayerStreak(login: string, now = Date.now()): Promise<PlayerStreakData | null> {
  const name = login.trim().toLowerCase();
  if (!/^[a-z0-9_.-]{1,32}$/.test(name)) return null;
  const snapshot = await readSnapshot(now);
  if (!snapshot) return null;
  const age = now - Date.parse(snapshot.generatedAt);
  if (age > MAX_AGE_MS || age < -30_000) return null;
  const exists = Object.hasOwn(snapshot.players, name);
  const player = exists ? snapshot.players[name] : undefined;
  if (exists && (!player || typeof player !== "object" || !Array.isArray(player.days) || !player.days.every(isStreakDay))) return null;
  const summary = calculateStreak(player?.days ?? [], now, snapshot.generatedAt);
  return { ...summary, flameSrc: getStreakFlame(summary.currentDays) };
}
