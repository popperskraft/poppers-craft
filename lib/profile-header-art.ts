export const PROFILE_HEADER_ART_WIDTH = 48;
export const PROFILE_HEADER_ART_HEIGHT = 12;
export const PROFILE_HEADER_ART_PIXEL_COUNT = PROFILE_HEADER_ART_WIDTH * PROFILE_HEADER_ART_HEIGHT;
export const PROFILE_HEADER_ART_COLORS = [
  "#111111", "#ffffff", "#7f7f7f", "#d4d0c8", "#c71919", "#ff6b1a",
  "#ffd800", "#b8ff1f", "#16833b", "#20d9d2", "#21b1ff", "#24408e",
  "#6f3fc5", "#d60270", "#ff53ba", "#7a3f18", "#f7a8b8", "#55cdfc",
] as const;

const PIXEL_CODES = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export type PixelHeaderArt = {
  palette: string[];
  pixels: string;
};

export function emptyPixelHeaderArt(): PixelHeaderArt {
  return { palette: [], pixels: ".".repeat(PROFILE_HEADER_ART_PIXEL_COUNT) };
}

export function parsePixelHeaderArt(value: unknown): PixelHeaderArt | null {
  let candidate = value;
  if (typeof candidate === "string") {
    try {
      candidate = JSON.parse(candidate);
    } catch {
      return null;
    }
  }
  if (!candidate || typeof candidate !== "object") return null;
  const palette = (candidate as { palette?: unknown }).palette;
  const pixels = (candidate as { pixels?: unknown }).pixels;
  if (!Array.isArray(palette) || palette.length > PIXEL_CODES.length || typeof pixels !== "string" || pixels.length !== PROFILE_HEADER_ART_PIXEL_COUNT) return null;
  const normalizedPalette = palette.map((color) => String(color).toLowerCase());
  if (normalizedPalette.some((color) => !HEX_COLOR.test(color))) return null;
  if ([...pixels].some((code) => code !== "." && (PIXEL_CODES.indexOf(code) < 0 || PIXEL_CODES.indexOf(code) >= normalizedPalette.length))) return null;
  return { palette: normalizedPalette, pixels };
}

export function pixelHeaderArtToColors(art: PixelHeaderArt | null): Array<string | null> {
  const normalized = parsePixelHeaderArt(art) ?? emptyPixelHeaderArt();
  return [...normalized.pixels].map((code) => code === "." ? null : normalized.palette[PIXEL_CODES.indexOf(code)] ?? null);
}

function colorDistance(left: string, right: string) {
  const parts = (color: string) => [1, 3, 5].map((index) => Number.parseInt(color.slice(index, index + 2), 16));
  const [lr, lg, lb] = parts(left);
  const [rr, rg, rb] = parts(right);
  return (lr - rr) ** 2 + (lg - rg) ** 2 + (lb - rb) ** 2;
}

export function colorsToPixelHeaderArt(colors: Array<string | null>): PixelHeaderArt {
  const palette: string[] = [];
  const pixels = Array.from({ length: PROFILE_HEADER_ART_PIXEL_COUNT }, (_, index) => {
    const rawColor = colors[index];
    if (!rawColor || !HEX_COLOR.test(rawColor)) return ".";
    const color = rawColor.toLowerCase();
    let paletteIndex = palette.indexOf(color);
    if (paletteIndex < 0 && palette.length < PIXEL_CODES.length) {
      paletteIndex = palette.push(color) - 1;
    } else if (paletteIndex < 0) {
      paletteIndex = palette.reduce((best, existing, existingIndex) => colorDistance(color, existing) < colorDistance(color, palette[best]) ? existingIndex : best, 0);
    }
    return PIXEL_CODES[paletteIndex];
  }).join("");
  return { palette, pixels };
}

export function hasPixelHeaderArt(art: PixelHeaderArt | null) {
  return Boolean(art && /[^.]/.test(art.pixels));
}
