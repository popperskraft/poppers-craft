import {
  colorsToPixelHeaderArt,
  pixelHeaderArtToColors,
  PROFILE_HEADER_ART_HEIGHT,
  PROFILE_HEADER_ART_WIDTH,
  type PixelHeaderArt,
} from "@/lib/profile-header-art";

/* Пиксельная шапка профиля для нейросети: 12 строк по 48 символов, каждый
   символ — ключ палитры, «.» — прозрачный пиксель (виден цвет шапки).
   Так нейросети проще рисовать и дорисовывать, чем со строкой кодов,
   в которой шапка хранится на сайте (lib/profile-header-art.ts). */

export type HeaderGrid = { palette: Record<string, string>; rows: string[] };

const KEYS = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
const HEX = /^#[0-9a-f]{6}$/i;

export function headerArtToGrid(art: PixelHeaderArt | null): HeaderGrid {
  const colors = pixelHeaderArtToColors(art);
  const palette: Record<string, string> = {};
  const keyFor = new Map<string, string>();
  const rows: string[] = [];
  for (let y = 0; y < PROFILE_HEADER_ART_HEIGHT; y++) {
    let row = "";
    for (let x = 0; x < PROFILE_HEADER_ART_WIDTH; x++) {
      const color = colors[y * PROFILE_HEADER_ART_WIDTH + x];
      if (!color) { row += "."; continue; }
      let key = keyFor.get(color);
      if (!key) {
        key = KEYS[keyFor.size] ?? KEYS[KEYS.length - 1];
        keyFor.set(color, key);
        palette[key] = color;
      }
      row += key;
    }
    rows.push(row);
  }
  return { palette, rows };
}

export function gridToHeaderArt(input: { palette?: unknown; rows?: unknown }): PixelHeaderArt {
  const palette = input.palette && typeof input.palette === "object" && !Array.isArray(input.palette) ? input.palette as Record<string, unknown> : null;
  if (!palette) throw new Error("Нужна палитра: символ → цвет #RRGGBB.");
  const colors = new Map<string, string>();
  for (const [key, value] of Object.entries(palette)) {
    if (key.length !== 1 || key === "." || !KEYS.includes(key)) throw new Error(`Ключ палитры «${key}»: один символ 0–9, a–z или A–Z.`);
    if (typeof value !== "string" || !HEX.test(value)) throw new Error(`Цвет «${key}» — в формате #RRGGBB.`);
    colors.set(key, value.toLowerCase());
  }
  const rows = Array.isArray(input.rows) ? input.rows.map(String) : [];
  if (rows.length !== PROFILE_HEADER_ART_HEIGHT) throw new Error(`Нужно ровно ${PROFILE_HEADER_ART_HEIGHT} строк.`);
  const pixels: Array<string | null> = [];
  rows.forEach((row, y) => {
    if (row.length !== PROFILE_HEADER_ART_WIDTH) throw new Error(`Строка ${y + 1}: нужно ровно ${PROFILE_HEADER_ART_WIDTH} символов, а не ${row.length}.`);
    for (const char of row) {
      if (char === ".") { pixels.push(null); continue; }
      const color = colors.get(char);
      if (!color) throw new Error(`Строка ${y + 1}: символа «${char}» нет в палитре.`);
      pixels.push(color);
    }
  });
  return colorsToPixelHeaderArt(pixels);
}

/* Картинка для предпросмотра: каждый пиксель шапки — квадрат scale×scale,
   прозрачные — цветом шапки, как на карточке игрока. */
export function headerArtPreviewRgba(art: PixelHeaderArt | null, background: string, scale = 8) {
  const colors = pixelHeaderArtToColors(art);
  const width = PROFILE_HEADER_ART_WIDTH * scale;
  const height = PROFILE_HEADER_ART_HEIGHT * scale;
  const bg = HEX.test(background) ? background : "#1c44da";
  const rgb = (hex: string) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const color = colors[Math.floor(y / scale) * PROFILE_HEADER_ART_WIDTH + Math.floor(x / scale)] ?? bg;
      const [r, g, b] = rgb(color);
      const i = (y * width + x) * 4;
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
    }
  }
  return { data, width, height };
}
