/* Оформление подписчиков PLUS — общие списки для сервера и браузера.
   Значения совпадают с проверками в таблицах pc_plus_profile,
   pc_sticker_reactions и pc_early_features (sql/r069_plus_perks.sql). */

import type { MinecraftItemIconName } from "@/lib/minecraft-icons";

export const PLUS_RINGS = [
  { id: "pink", label: "Розовая" },
  { id: "blue", label: "Голубая" },
  { id: "lime", label: "Лаймовая" },
  { id: "gold", label: "Золотая" },
  { id: "violet", label: "Фиолетовая" },
  { id: "rainbow", label: "Радужная" },
] as const;
export type PlusRing = (typeof PLUS_RINGS)[number]["id"];
export const DEFAULT_RING: PlusRing = "pink";

export const PLUS_THEMES = [
  { id: "classic", label: "Классика" },
  { id: "night", label: "Ночь" },
  { id: "sky", label: "Небо" },
  { id: "grass", label: "Трава" },
  { id: "nether", label: "Незер" },
  { id: "end", label: "Энд" },
  { id: "candy", label: "Розовая" },
] as const;
export type PlusTheme = (typeof PLUS_THEMES)[number]["id"];
export const DEFAULT_THEME: PlusTheme = "classic";

export const PLUS_STICKERS = [
  { id: "diamond", label: "Алмаз" },
  { id: "golden_apple", label: "Золотое яблоко" },
  { id: "cake", label: "Торт" },
  { id: "totem_of_undying", label: "Тотем" },
  { id: "tnt", label: "TNT" },
  { id: "nether_star", label: "Звезда" },
  { id: "emerald", label: "Изумруд" },
  { id: "pufferfish", label: "Фугу" },
  { id: "music_disc_cat", label: "Пластинка" },
  { id: "experience_bottle", label: "Опыт" },
] as const satisfies ReadonlyArray<{ id: MinecraftItemIconName; label: string }>;
export type PlusSticker = (typeof PLUS_STICKERS)[number]["id"];
export type StickerTarget = "feed_post" | "wiki_article";
export type StickerCount = { sticker: PlusSticker; count: number };

/* Шапка профиля: с PLUS — одна своя картинка, анимация (до восьми кадров,
   первый — сама картинка) — возможность HYPE. */
export const MAX_HEADER_FRAMES = 1;
export const MAX_HEADER_FRAMES_HYPE = 8;
export const HEADER_FRAME_SPEEDS = [
  { ms: 700, label: "Медленно" },
  { ms: 400, label: "Обычно" },
  { ms: 200, label: "Быстро" },
] as const;
export const DEFAULT_FRAME_MS = 400;

/* ---- тарифы --------------------------------------------------------------

   PLUS — оформление профиля на сайте. HYPE — всё из PLUS и сверху то, что
   видно в игре: пони, своя пластинка каждый день, живая шапка, радужная обводка,
   закреплённый пост и новые функции раньше остальных. */

export const PLUS_TIERS = ["plus", "hype"] as const;
export type PlusTier = (typeof PLUS_TIERS)[number];
export const TIER_LABEL: Record<PlusTier, string> = { plus: "PLUS", hype: "HYPE" };
/* Полные названия тарифов — коротко, без «POPPERSCRAFT». */
export const TIER_NAME: Record<PlusTier, string> = { plus: "POPPERS+", hype: "POPPERS HYPE" };
const TIER_RANK: Record<PlusTier, number> = { plus: 1, hype: 2 };

export const isPlusTier = (value: unknown): value is PlusTier =>
  typeof value === "string" && (PLUS_TIERS as readonly string[]).includes(value);

export const asTier = (value: unknown): PlusTier => (isPlusTier(value) ? value : "plus");

/* Тариф не ниже нужного: HYPE открывает всё, что открывает PLUS. */
export const tierCovers = (tier: PlusTier, needed: PlusTier) => TIER_RANK[tier] >= TIER_RANK[needed];

/* Возможности только для HYPE. Всё остальное входит и в PLUS. */
export const HYPE_ONLY = {
  pony: "Скин пони",
  records: "Своя пластинка каждый день",
  headerFrames: "Анимированная шапка профиля",
  rainbowRing: "Радужная обводка",
  pinnedPost: "Закреплённый пост в профиле",
  earlyAccess: "Ранний доступ к новым функциям",
} as const;
export type HypeFeature = keyof typeof HYPE_ONLY;

/* Хватает ли тарифа для возможности из списка HYPE. */
export const hasHypeFeature = (tier: PlusTier | null | undefined) =>
  Boolean(tier && tierCovers(tier, "hype"));

/* Образы в гардеробе: без подписки три, с PLUS шесть, с HYPE вдвое больше. */
export const LOOKS_LIMIT = 3;
export const LOOKS_LIMIT_PLUS = 6;
export const LOOKS_LIMIT_HYPE = LOOKS_LIMIT_PLUS * 2;

/* Лимиты по тарифу: у HYPE всё удвоено. */
export function looksLimitFor(tier: PlusTier | null | undefined) {
  if (!tier) return LOOKS_LIMIT;
  return hasHypeFeature(tier) ? LOOKS_LIMIT_HYPE : LOOKS_LIMIT_PLUS;
}

/* Сколько кадров шапки можно сохранить: без HYPE — только саму картинку. */
export function headerFramesFor(tier: PlusTier | null | undefined) {
  return hasHypeFeature(tier) ? MAX_HEADER_FRAMES_HYPE : MAX_HEADER_FRAMES;
}

/* Ранний доступ: новые функции сначала получают подписчики HYPE
   (в базе эта аудитория называется "plus"). */
export const EARLY_FEATURES = [
  { key: "feed-compact", title: "Компактная лента", description: "Посты короче, картинки меньше — больше записей на экране." },
  { key: "feed-dark", title: "Тёмная лента", description: "Тёмное оформление ленты для вечерних посиделок." },
] as const;
export type EarlyFeatureKey = (typeof EARLY_FEATURES)[number]["key"];
export type EarlyAudience = "admins" | "plus" | "all";

/* Значки стажа: сколько месяцев игрок был с подпиской (оплаты, подарки, выдачи). */
const TENURE_TIERS = [
  { months: 12, label: "ГОД С ПОДПИСКОЙ", icon: "totem_of_undying" },
  { months: 6, label: "ПОЛГОДА С ПОДПИСКОЙ", icon: "nether_star" },
  { months: 3, label: "3 МЕСЯЦА С ПОДПИСКОЙ", icon: "diamond" },
  { months: 1, label: "МЕСЯЦ С ПОДПИСКОЙ", icon: "emerald" },
] as const satisfies ReadonlyArray<{ months: number; label: string; icon: MinecraftItemIconName }>;
export type TenureTier = (typeof TENURE_TIERS)[number];

export function tenureTier(months: number): TenureTier | null {
  return TENURE_TIERS.find((tier) => months >= tier.months) ?? null;
}

export function nextTenureTier(months: number) {
  return [...TENURE_TIERS].reverse().find((tier) => months < tier.months) ?? null;
}

const isOneOf = <T extends string>(list: ReadonlyArray<{ id: T }>, value: unknown): value is T =>
  typeof value === "string" && list.some((item) => item.id === value);

export const isPlusRing = (value: unknown): value is PlusRing => isOneOf(PLUS_RINGS, value);
export const isPlusTheme = (value: unknown): value is PlusTheme => isOneOf(PLUS_THEMES, value);
export const isPlusSticker = (value: unknown): value is PlusSticker => isOneOf(PLUS_STICKERS, value);

/* Классы обводки подписчика: «is-plus ring-pink». Без подписки — пусто.
   У HYPE добавляется is-hype: обводка светится заметнее. */
export function plusClass(plus: boolean | undefined, ring?: string | null, tier?: string | null) {
  if (!plus) return "";
  const safeRing = isPlusRing(ring) ? ring : DEFAULT_RING;
  /* Радужная — только для HYPE: с PLUS показываем обычную розовую. */
  const allowed = safeRing === "rainbow" && !hasHypeFeature(asTier(tier)) ? DEFAULT_RING : safeRing;
  return `is-plus ring-${allowed}${hasHypeFeature(asTier(tier)) ? " is-hype" : ""}`;
}

export function joinClasses(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}
