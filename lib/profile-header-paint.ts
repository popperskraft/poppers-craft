import { PROFILE_HEADER_ART_HEIGHT, PROFILE_HEADER_ART_PIXEL_COUNT, PROFILE_HEADER_ART_WIDTH } from "./profile-header-art";

/** Four-connected fill, confined to one frame; transparent pixels form a colour of their own. */
export function floodFillHeaderColors(colors: Array<string | null>, x: number, y: number, color: string | null): Array<string | null> {
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= PROFILE_HEADER_ART_WIDTH || y >= PROFILE_HEADER_ART_HEIGHT) return colors;
  if (color !== null && !/^#[0-9a-f]{6}$/i.test(color)) return colors;
  const replacement = color?.toLowerCase() ?? null;
  const start = y * PROFILE_HEADER_ART_WIDTH + x;
  const target = colors[start]?.toLowerCase() ?? null;
  if (target === replacement) return colors;

  const next = Array.from({ length: PROFILE_HEADER_ART_PIXEL_COUNT }, (_, index) => colors[index] ?? null);
  const stack = [start];
  next[start] = replacement;
  const visit = (index: number) => {
    if ((next[index]?.toLowerCase() ?? null) !== target) return;
    next[index] = replacement;
    stack.push(index);
  };
  while (stack.length) {
    const index = stack.pop()!;
    const column = index % PROFILE_HEADER_ART_WIDTH;
    if (column > 0) visit(index - 1);
    if (column + 1 < PROFILE_HEADER_ART_WIDTH) visit(index + 1);
    if (index >= PROFILE_HEADER_ART_WIDTH) visit(index - PROFILE_HEADER_ART_WIDTH);
    if (index + PROFILE_HEADER_ART_WIDTH < PROFILE_HEADER_ART_PIXEL_COUNT) visit(index + PROFILE_HEADER_ART_WIDTH);
  }
  return next;
}
