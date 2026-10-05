export const STAR_RATING_VALUES = Array.from({ length: 10 }, (_, index) => (index + 1) / 2);

export function validStarRating(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
    && value >= 0.5 && value <= 5 && Number.isInteger(value * 2);
}

export function starFill(rating: number, star: number) {
  return Number.isFinite(rating) ? Math.max(0, Math.min(1, rating - star + 1)) : 0;
}

// Rated articles precede unrated ones. Equal averages use vote count, then date.
export function compareArticleRatings(
  a: { rating: { average: number; count: number }; publishedAt: string | null; updatedAt: string; id: number },
  b: { rating: { average: number; count: number }; publishedAt: string | null; updatedAt: string; id: number },
) {
  return Number(b.rating.count > 0) - Number(a.rating.count > 0)
    || b.rating.average - a.rating.average || b.rating.count - a.rating.count
    || Date.parse(b.publishedAt ?? b.updatedAt) - Date.parse(a.publishedAt ?? a.updatedAt) || b.id - a.id;
}
