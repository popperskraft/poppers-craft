/* Перекраска скина Minecraft по частям тела — для нейросети, которая
   помогает игроку («куртка розовая», «волосы в цвет HYPE»). Работает с
   развёрткой 64×64 (у старых скинов 64×32 нижней половины нет — её строки
   просто пропускаются). Тень сохраняется: меняются оттенок и
   насыщенность, а светлота части сдвигается к светлоте нового цвета. */

type Rect = [x: number, y: number, width: number, height: number];

export const SKIN_PARTS: Record<string, { label: string; rects: Rect[] }> = {
  head: { label: "голова (лицо и волосы базового слоя)", rects: [[0, 0, 32, 16]] },
  hat: { label: "верхний слой головы: причёска, шапка, очки", rects: [[32, 0, 32, 16]] },
  body: { label: "туловище", rects: [[16, 16, 24, 16]] },
  jacket: { label: "верхний слой туловища: куртка", rects: [[16, 32, 24, 16]] },
  arms: { label: "руки", rects: [[40, 16, 16, 16], [32, 48, 16, 16]] },
  sleeves: { label: "верхний слой рук: рукава", rects: [[40, 32, 16, 16], [48, 48, 16, 16]] },
  legs: { label: "ноги", rects: [[0, 16, 16, 16], [16, 48, 16, 16]] },
  pants: { label: "верхний слой ног: штаны и обувь", rects: [[0, 32, 16, 16], [0, 48, 16, 16]] },
  all: { label: "весь скин", rects: [[0, 0, 64, 64]] },
};

export type SkinChange = { part: string; color: string; mode?: "tint" | "replace" };

const clamp = (value: number) => Math.min(1, Math.max(0, value));

export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}

export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) { const v = Math.round(l * 255); return [v, v, v]; }
  const hue = (p: number, q: number, t: number) => {
    if (t < 0) t += 1; if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  return [hue(p, q, h + 1 / 3), hue(p, q, h), hue(p, q, h - 1 / 3)].map((v) => Math.round(v * 255)) as [number, number, number];
}

export function parseHexColor(value: string): [number, number, number] | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(value.trim());
  if (!match) return null;
  const n = parseInt(match[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/* Меняет пиксели на месте; возвращает, сколько пикселей перекрашено. */
export function recolorSkinPixels(pixels: Uint8Array | Uint8ClampedArray, width: number, height: number, changes: SkinChange[]) {
  let changed = 0;
  for (const change of changes) {
    const part = SKIN_PARTS[change.part];
    const target = parseHexColor(change.color);
    if (!part || !target) throw new Error(`Неизвестная часть или цвет: ${change.part} ${change.color}`);
    const [th, ts, tl] = rgbToHsl(...target);
    const cells: number[] = [];
    for (const [x0, y0, w, h] of part.rects) {
      for (let y = y0; y < Math.min(y0 + h, height); y++) {
        for (let x = x0; x < Math.min(x0 + w, width); x++) {
          const i = (y * width + x) * 4;
          if (pixels[i + 3] > 0) cells.push(i);
        }
      }
    }
    if (!cells.length) continue;
    const meanL = cells.reduce((sum, i) => sum + rgbToHsl(pixels[i], pixels[i + 1], pixels[i + 2])[2], 0) / cells.length;
    for (const i of cells) {
      if (change.mode === "replace") {
        [pixels[i], pixels[i + 1], pixels[i + 2]] = target;
      } else {
        const l = rgbToHsl(pixels[i], pixels[i + 1], pixels[i + 2])[2];
        [pixels[i], pixels[i + 1], pixels[i + 2]] = hslToRgb(th, ts, clamp(l * tl / Math.max(meanL, 0.05)));
      }
      changed++;
    }
  }
  return changed;
}
