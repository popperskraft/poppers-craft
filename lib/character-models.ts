import { expandLegacyPony, legacyPonyTemplate } from "./pony-template";

export const RACES = {
  earth: { label: "Земной пони", color: 0xf9b131 },
  pegasus: { label: "Пегас", color: 0x88caf0 },
  unicorn: { label: "Единорог", color: 0xd19fe4 },
  alicorn: { label: "Аликорн", color: 0xfef9fc },
} as const;
export const SIZES = {
  foal: { label: "Жеребёнок", color: 0xffbe53, scale: 0.6 },
  yearling: { label: "Маленький", color: 0x53beff, scale: 0.6 },
  squat: { label: "Невысокий", color: 0xa3d2c7, scale: 0.7 },
  normal: { label: "Обычный", color: 0, scale: 0.8 },
  stocky: { label: "Коренастый", color: 0xb2e7dd, scale: 0.8 },
  lanky: { label: "Стройный", color: 0x3254ce, scale: 0.85 },
  bulky: { label: "Крупный", color: 0xce3254, scale: 1 },
  tall: { label: "Высокий", color: 0x534b76, scale: 1.1 },
} as const;
export type Race = keyof typeof RACES;
export type PonySize = keyof typeof SIZES;
export const TAIL_LENGTHS = {
  full: { label: "Полный", color: 0 },
  three_quarters: { label: "¾ длины", color: 0x8a6b7f },
  half: { label: "½ длины", color: 0x534b76 },
  quarter: { label: "¼ длины", color: 0xd19fe4 },
  stub: { label: "Короткий", color: 0x425844 },
} as const;
export const SNOUTS = {
  rounded: { label: "Округлая", color: 0 },
  square: { label: "Квадратная", color: 0xffffff },
} as const;
export type TailLength = keyof typeof TAIL_LENGTHS;
export type Snout = keyof typeof SNOUTS;
export type SkinSlot = { id: string; skinUrl: string; model?: "classic" | "slim"; race?: Race; size?: PonySize; tailLength?: TailLength; snout?: Snout; pixelsBase64?: string };
export type SkinWardrobe = { limit: number; human: SkinSlot[]; pony: SkinSlot[]; activeHumanId: string | null; activePonyId: string | null; humanInitialized?: boolean };
export type ModelProfile = {
  login: string; mode: "human" | "pony"; race: Race; size: PonySize;
  wardrobe: SkinWardrobe; slot?: SkinSlot;
  revision: number; skinUrl: string; hasPony: boolean; pixelsBase64?: string;
};
export function isControlPixel(x: number, y: number) { return x < 4 && y < 3; }
export function setMetadata(pixels: Uint8ClampedArray, race: Race, size: PonySize, tailLength: TailLength="full", snout: Snout="rounded") {
  for (let y = 0; y < 3; y++) for (let x = 0; x < 4; x++) {
    const offset = (y * 64 + x) * 4;
    pixels.set([0, 0, 0, 255], offset);
  }
  for (const [x, color] of [[0, RACES[race].color], [1, TAIL_LENGTHS[tailLength].color], [2, SNOUTS[snout].color], [3, SIZES[size].color]]) {
    pixels.set([color >> 16, (color >> 8) & 255, color & 255, 255], x * 4);
  }
  return pixels;
}
export function encodePixels(pixels: Uint8ClampedArray) {
  return btoa(String.fromCharCode(...pixels));
}
export function decodePixels(encoded: string) {
  const raw = atob(encoded);
  if (raw.length !== 16384) throw new Error("Скин повреждён.");
  return Uint8ClampedArray.from(raw, c => c.charCodeAt(0));
}
export function blankPony() {
  return setMetadata(expandLegacyPony(legacyPonyTemplate()), "earth", "normal");
}
export function readAppearance(pixels: Uint8ClampedArray): {tailLength: TailLength; snout: Snout} {
  const color=(x:number)=>pixels[x*4+3]===255 ? (pixels[x*4]<<16)|(pixels[x*4+1]<<8)|pixels[x*4+2] : 0;
  return {
    tailLength:(Object.keys(TAIL_LENGTHS) as TailLength[]).find(k=>TAIL_LENGTHS[k].color===color(1))??"full",
    snout:(Object.keys(SNOUTS) as Snout[]).find(k=>SNOUTS[k].color===color(2))??"rounded",
  };
}
export async function normalizeTemplate(pixels: Uint8ClampedArray) {
  const drawing=new Uint8Array(pixels);
  for(let y=0;y<3;y++)for(let x=0;x<4;x++)drawing.fill(0,(y*64+x)*4,(y*64+x)*4+4);
  const digest=await crypto.subtle.digest("SHA-256",drawing);
  const hash=Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,"0")).join("");
  // Identify only the exact retired starter drawing; never replace custom artwork.
  if(hash!=="a741f0b1061a4062987094bda8571565b7dc86006a7760325555e42adb0d8c46")return pixels;
  const white=blankPony();
  for(let y=0;y<3;y++)for(let x=0;x<4;x++)white.set(pixels.slice((y*64+x)*4,(y*64+x)*4+4),(y*64+x)*4);
  return white;
}
