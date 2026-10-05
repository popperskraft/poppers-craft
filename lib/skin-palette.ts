export const PALETTE_KEY = 'popperscraft.skin-colors.v1';
export const RECENT_COLOR_LIMIT = 12;

export function recentColors(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((color): color is string =>
    typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color)
  ).map(color => color.toLowerCase()))].slice(0, RECENT_COLOR_LIMIT);
}

export function rememberColor(colors: readonly string[], color: string): string[] {
  return recentColors([color, ...colors]);
}

export function readPalette(storage: Pick<Storage, 'getItem'>): string[] {
  try { return recentColors(JSON.parse(storage.getItem(PALETTE_KEY) || 'null')); }
  catch { return []; }
}
