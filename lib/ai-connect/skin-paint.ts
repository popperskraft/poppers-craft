import { expandLegacyPony, legacyPonyTemplate } from "@/lib/pony-template";
import { isControlPixel } from "@/lib/character-models";
import { humanSections, type HumanModel } from "@/lib/human-skin";
import { TEXTURE_SECTIONS } from "@/lib/pony-texture";
import { hslToRgb, parseHexColor, rgbToHsl } from "./skin-recolor";

/* Рисование на развёртке 64×64 для нейросети: прямоугольники нужного цвета
   поверх скина человека или пони (paint_skin, make_pony). Карта частей
   (skinMap) объясняет, какие пиксели — лицо, спина, крылья и т. д. */

export type PaintOp = { x: number; y: number; w?: number; h?: number; color: string };
export type MapTile = { part: string; layer?: string; face: string; x: number; y: number; w: number; h: number };

const TRANSPARENT = "transparent";

/* Карта развёртки: для человека — оба слоя (base и outer), для пони — части
   из редактора моделей (lib/pony-texture.ts). */
export function skinMap(kind: "human" | "pony", model: HumanModel = "classic"): MapTile[] {
  if (kind === "pony") {
    return TEXTURE_SECTIONS.filter((section) => section.id !== "all").flatMap((section) =>
      section.tiles.map((tile) => ({ part: section.id, face: tile.label, x: tile.x, y: tile.y, w: tile.w, h: tile.h })));
  }
  return (["base", "outer"] as const).flatMap((layer) => humanSections(model, layer).flatMap((section) =>
    section.tiles.map((tile) => ({ part: section.id, layer, face: tile.label, x: tile.x, y: tile.y, w: tile.w, h: tile.h }))));
}

function parseColor(value: string): [number, number, number, number] | null {
  if (value === TRANSPARENT) return [0, 0, 0, 0];
  const match = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(value.trim());
  if (!match) return null;
  const rgb = parseHexColor(`#${match[1]}`)!;
  return [rgb[0], rgb[1], rgb[2], match[2] ? Number.parseInt(match[2], 16) : 255];
}

/* Прямоугольники цвета. Служебные пиксели пони (метка породы в углу)
   не трогаются. Возвращает число закрашенных пикселей. */
export function applyPaintOps(pixels: Uint8Array | Uint8ClampedArray, ops: PaintOp[], options: { protectControl?: boolean } = {}) {
  if (ops.length > 600) throw new Error("Не больше 600 прямоугольников за раз.");
  let painted = 0;
  ops.forEach((op, index) => {
    const color = parseColor(String(op.color ?? ""));
    const x = Number(op.x), y = Number(op.y), w = op.w === undefined ? 1 : Number(op.w), h = op.h === undefined ? 1 : Number(op.h);
    if (!color) throw new Error(`Операция ${index + 1}: цвет — #RRGGBB, #RRGGBBAA или "transparent".`);
    if (![x, y, w, h].every(Number.isInteger) || x < 0 || y < 0 || w < 1 || h < 1 || x + w > 64 || y + h > 64) {
      throw new Error(`Операция ${index + 1}: прямоугольник должен лежать в пределах 0–63 по x и y.`);
    }
    for (let row = y; row < y + h; row++) {
      for (let col = x; col < x + w; col++) {
        if (options.protectControl && isControlPixel(col, row)) continue;
        pixels.set(color, (row * 64 + col) * 4);
        painted++;
      }
    }
  });
  return painted;
}

/* Серые пиксели шаблона пони (шерсть и её тени) перекрашиваются в нужный
   цвет с сохранением теней; чёрные и белые (глаза), цветные и прозрачные
   остаются как есть. */
function isTemplateGrey(r: number, g: number, b: number) {
  return Math.abs(r - g) < 6 && Math.abs(g - b) < 6 && r > 0x40 && r < 0xfa;
}

export function tintGreyTiles(pixels: Uint8Array | Uint8ClampedArray, tiles: Array<{ x: number; y: number; w: number; h: number }>, hex: string) {
  const target = parseHexColor(hex);
  if (!target) throw new Error(`Цвет ${hex} — в формате #RRGGBB.`);
  const [th, ts, tl] = rgbToHsl(...target);
  const cells: number[] = [];
  for (const tile of tiles) {
    for (let y = tile.y; y < tile.y + tile.h; y++) {
      for (let x = tile.x; x < tile.x + tile.w; x++) {
        const i = (y * 64 + x) * 4;
        if (!isControlPixel(x, y) && pixels[i + 3] > 0 && isTemplateGrey(pixels[i], pixels[i + 1], pixels[i + 2])) cells.push(i);
      }
    }
  }
  if (!cells.length) return 0;
  const meanL = cells.reduce((sum, i) => sum + rgbToHsl(pixels[i], pixels[i + 1], pixels[i + 2])[2], 0) / cells.length;
  for (const i of cells) {
    const l = rgbToHsl(pixels[i], pixels[i + 1], pixels[i + 2])[2];
    const [r, g, b] = hslToRgb(th, ts, Math.min(1, Math.max(0, l * tl / Math.max(meanL, 0.05))));
    pixels[i] = r; pixels[i + 1] = g; pixels[i + 2] = b;
  }
  return cells.length;
}

/* Радужные полосы сверху вниз внутри каждой грани (грива, хвост).
   Прозрачные пиксели остаются прозрачными. */
export const RAINBOW = ["#e40303", "#ff8c00", "#ffed00", "#008026", "#24408e", "#732982"];

export function rainbowTiles(pixels: Uint8Array | Uint8ClampedArray, tiles: Array<{ x: number; y: number; w: number; h: number }>, colors = RAINBOW) {
  const rgb = colors.map((color) => parseHexColor(color)!);
  for (const tile of tiles) {
    for (let y = tile.y; y < tile.y + tile.h; y++) {
      const band = rgb[Math.min(rgb.length - 1, Math.floor(((y - tile.y) * rgb.length) / tile.h))];
      for (let x = tile.x; x < tile.x + tile.w; x++) {
        const i = (y * 64 + x) * 4;
        if (isControlPixel(x, y) || pixels[i + 3] === 0) continue;
        pixels[i] = band[0]; pixels[i + 1] = band[1]; pixels[i + 2] = band[2];
      }
    }
  }
}

export function ponySectionTiles(id: string) {
  return TEXTURE_SECTIONS.find((section) => section.id === id)?.tiles ?? [];
}

export function ponyTemplatePixels() {
  return expandLegacyPony(legacyPonyTemplate());
}

/* Картинка развёртки для ответа нейросети: каждый пиксель — квадрат
   scale×scale, прозрачные — в шахматную клетку. */
export function texturePreviewRgba(pixels: Uint8Array | Uint8ClampedArray, scale = 6) {
  const size = 64 * scale;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (Math.floor(y / scale) * 64 + Math.floor(x / scale)) * 4;
      const o = (y * size + x) * 4;
      const alpha = pixels[i + 3] / 255;
      const checker = ((Math.floor(x / scale) + Math.floor(y / scale)) % 2) ? 200 : 235;
      for (let c = 0; c < 3; c++) data[o + c] = Math.round(pixels[i + c] * alpha + checker * (1 - alpha));
      data[o + 3] = 255;
    }
  }
  return { data, width: size, height: size };
}
