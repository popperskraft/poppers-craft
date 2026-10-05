export const HEADER_FLAG_OPTIONS = [
  { value: "none", label: "Без флага", group: "base" },
  { value: "custom", label: "Мой пиксельный рисунок", group: "base" },
  /* Пресеты-сцены в духе Minecraft (r099) — те же пиксельные картинки, что у фонов карточки. */
  { value: "mc-meadow", label: "Луг", group: "minecraft" },
  { value: "mc-sky", label: "Небо", group: "minecraft" },
  { value: "mc-sunset", label: "Закат", group: "minecraft" },
  { value: "mc-night", label: "Ночь", group: "minecraft" },
  { value: "mc-nether", label: "Незер", group: "minecraft" },
  { value: "mc-end", label: "Энд", group: "minecraft" },
  { value: "mc-hearts", label: "Сердечки", group: "minecraft" },
  { value: "rainbow", label: "Радужный", group: "pride" },
  { value: "progress", label: "Прогресс-прайд", group: "pride" },
  { value: "bear", label: "Медведи", group: "pride" },
  { value: "transgender", label: "Трансгендерный", group: "pride" },
  { value: "lesbian", label: "Лесбийский", group: "pride" },
  { value: "gay", label: "Гей / MLM", group: "pride" },
  { value: "bisexual", label: "Бисексуальный", group: "pride" },
  { value: "pansexual", label: "Пансексуальный", group: "pride" },
  { value: "omnisexual", label: "Омнисексуальный", group: "pride" },
  { value: "polysexual", label: "Полисексуальный", group: "pride" },
  { value: "asexual", label: "Асексуальный", group: "pride" },
  { value: "demisexual", label: "Демисексуальный", group: "pride" },
  { value: "aromantic", label: "Аромантичный", group: "pride" },
  { value: "nonbinary", label: "Небинарный", group: "pride" },
  { value: "genderfluid", label: "Гендерфлюид", group: "pride" },
  { value: "genderqueer", label: "Гендерквир", group: "pride" },
  { value: "agender", label: "Агендерный", group: "pride" },
  { value: "bigender", label: "Бигендерный", group: "pride" },
  { value: "demigirl", label: "Демидевушка", group: "pride" },
  { value: "demiboy", label: "Демипарень", group: "pride" },
  { value: "intersex", label: "Интерсекс", group: "pride" },
  { value: "queer", label: "Квир", group: "pride" },
] as const;

export type HeaderFlag = (typeof HEADER_FLAG_OPTIONS)[number]["value"];

export const HEADER_FLAG_VALUES = new Set<string>(HEADER_FLAG_OPTIONS.map((option) => option.value));

export function normalizeHeaderFlag(value: unknown): HeaderFlag {
  const candidate = String(value ?? "none");
  if (candidate === "usa") return "none";
  return HEADER_FLAG_VALUES.has(candidate) ? candidate as HeaderFlag : "none";
}

/* ЛГБТК+ флаги: их прячет настройка «Я гомофоб». Сцены Minecraft — нет. */
export function isPrideHeaderFlag(value: unknown) {
  const normalized = normalizeHeaderFlag(value);
  return HEADER_FLAG_OPTIONS.some((option) => option.value === normalized && option.group === "pride");
}

export const HEADER_PRESET_GROUPS = [
  { id: "minecraft", label: "MINECRAFT" },
  { id: "pride", label: "ФЛАГИ" },
] as const;

/* Режим шапки в редакторе: свой рисунок, просто цвет или готовый пресет. */
export type HeaderMode = "custom" | "color" | "preset";

export function headerModeOf(value: unknown): HeaderMode {
  const normalized = normalizeHeaderFlag(value);
  return normalized === "custom" ? "custom" : normalized === "none" ? "color" : "preset";
}

export function headerFlagLabel(value: unknown) {
  const normalized = normalizeHeaderFlag(value);
  return HEADER_FLAG_OPTIONS.find((option) => option.value === normalized)?.label ?? "Без флага";
}
