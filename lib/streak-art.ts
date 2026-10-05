import "server-only";

// Keep the progression on the server so upcoming flames remain a surprise.
// The client receives the current asset only; opaque names do not reveal order.
const STREAK_FLAMES = [
  { days: 1, asset: "b67214cb1203af49e825" },
  { days: 2, asset: "eaad2fe1fe38feca1dc3" },
  { days: 3, asset: "0dd9502445028a953c79" },
  { days: 5, asset: "1851ab1f493b1ae1f75d" },
  { days: 7, asset: "e0745bf33f7b0aacb2de" },
  { days: 10, asset: "c3ed5d2efa9dc3ba619f" },
  { days: 14, asset: "a7a73d5e9cf943b8b1f8" },
  { days: 18, asset: "55cac3fb3604d63e38a8" },
  { days: 21, asset: "bd13eea88f169c321fde" },
  { days: 25, asset: "3a2b0e49c9cef5fa6a2b" },
  { days: 30, asset: "d5e65b4fb5c77aa07580" },
  { days: 40, asset: "1f07e338bd0c20bfc687" },
  { days: 50, asset: "82097bdeb67299c0f34a" },
  { days: 60, asset: "c4e225d8bae89d395faa" },
  { days: 75, asset: "9174129b50a994b39215" },
  { days: 90, asset: "0e23ed2f97d2c18f065c" },
  { days: 120, asset: "8c02d9ccd6856fb470ab" },
  { days: 150, asset: "0ad5f890f3b6f26b8dfe" },
  { days: 180, asset: "d1d77a27e40655999a2d" },
  { days: 210, asset: "e89d3ac9e7cdbd20c174" },
  { days: 240, asset: "5dbd82e8ba6d12e296b5" },
  { days: 270, asset: "ee87516973a2b9b68aad" },
  { days: 300, asset: "562f47b317fb146a9649" },
  { days: 365, asset: "9fd4b469ea1c1f0d6d5d" },
] as const;

/** Select only the earned flame; an inactive or invalid streak has no badge. */
export function getStreakFlame(days: number): string | null {
  if (!Number.isFinite(days) || days < 1) return null;
  for (let index = STREAK_FLAMES.length - 1; index >= 0; index--) {
    const flame = STREAK_FLAMES[index];
    if (days >= flame.days) return `/streak/flames/${flame.asset}.svg`;
  }
  return null;
}
