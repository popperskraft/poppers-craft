/** Consecutive verified Minecraft login days, in the server calendar (UTC+3). */
export type PlayerStreakData = {
  currentDays: number;
  bestDays: number;
  lastActiveDay: string | null;
  playedToday: boolean;
  today: string;
  updatedAt: string;
};

const DAY_MS = 86_400_000;
const OFFSET_MS = 180 * 60_000;

export function streakDay(now: number = Date.now()): string {
  return new Date(now + OFFSET_MS).toISOString().slice(0, 10);
}

export function isStreakDay(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const at = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(at) && new Date(at).toISOString().slice(0, 10) === value;
}

export function calculateStreak(days: readonly string[], now: number = Date.now(), updatedAt = new Date(now).toISOString()): PlayerStreakData {
  const today = streakDay(now);
  const yesterday = streakDay(now - DAY_MS);
  const ordered = [...new Set(days.filter(day => isStreakDay(day) && day <= today))].sort();
  let run = 0;
  let best = 0;
  let previous = -Infinity;
  for (const day of ordered) {
    const at = Date.parse(`${day}T00:00:00Z`);
    run = at - previous === DAY_MS ? run + 1 : 1;
    best = Math.max(best, run);
    previous = at;
  }
  const last = ordered.at(-1) ?? null;
  return {
    currentDays: last === today || last === yesterday ? run : 0,
    bestDays: best,
    lastActiveDay: last,
    playedToday: last === today,
    today,
    updatedAt,
  };
}

export function formatStreakDays(days: number): string {
  const count = Number.isFinite(days) ? Math.max(0, Math.floor(days)) : 0;
  const lastTwo = count % 100;
  const last = count % 10;
  const word = lastTwo >= 11 && lastTwo <= 14 ? "дней" : last === 1 ? "день" : last >= 2 && last <= 4 ? "дня" : "дней";
  return `${count} ${word}`;
}
