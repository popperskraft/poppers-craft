// Original PNGs supplied by the site owner. Only this approved set is exposed.
export const minecraftItems = {
  diamond: "Алмаз",
  lapis_lazuli: "Лазурит",
  redstone: "Редстоун",
  ender_pearl: "Жемчуг Эндера",
  golden_apple: "Золотое яблоко",
  totem_of_undying: "Тотем бессмертия",
  nether_star: "Звезда Незера",
  rail: "Рельсы",
  pufferfish: "Рыба-фугу",
  tnt: "TNT",
  chest: "Сундук",
  furnace: "Печка",
  crafting_table: "Верстак",
  water_bucket: "Ведро воды",
  apple: "Яблоко",
  potion: "Зелье",
  lava_bucket: "Ведро лавы",
  book: "Книга",
  knowledge_book: "Книга знаний",
  glistering_melon_slice: "Золотой арбуз",
  emerald: "Изумруд",
  enchanted_book: "Зачарованная книга",
  clock: "Часы",
  compass: "Компас",
  cake: "Торт",
  carrot: "Морковка",
  experience_bottle: "Зелье опыта",
  writable_book: "Книга с пером",
  bone: "Кость",
  music_disc_11: "Пластинка — 11",
  music_disc_13: "Пластинка — 13",
  music_disc_blocks: "Пластинка — blocks",
  music_disc_cat: "Пластинка — cat",
  music_disc_chirp: "Пластинка — chirp",
  music_disc_far: "Пластинка — far",
  music_disc_mall: "Пластинка — mall",
  music_disc_mellohi: "Пластинка — mellohi",
  music_disc_stal: "Пластинка — stal",
  music_disc_strad: "Пластинка — strad",
  music_disc_wait: "Пластинка — wait",
  music_disc_ward: "Пластинка — ward",
  music_disc_pigstep: "Пластинка — Pigstep",
  music_disc_otherside: "Пластинка — otherside",
  music_disc_5: "Пластинка — 5",
  music_disc_relic: "Пластинка — Relic",
  music_disc_creator: "Пластинка — Creator",
  music_disc_creator_music_box: "Пластинка — Creator (Music Box)",
  music_disc_precipice: "Пластинка — Precipice",
  music_disc_tears: "Пластинка — Tears",
  music_disc_lava_chicken: "Пластинка — Lava Chicken",
} as const;

export type MinecraftItemIconName = keyof typeof minecraftItems;

// Keep existing saved blocks compatible without changing their database records.
const legacyIcons = {
  villager: "emerald",
  creeper: "tnt",
  zombie: "bone",
  pig: "carrot",
  grass: "crafting_table",
  totem: "totem_of_undying",
  record: "music_disc_cat",
  pickaxe: "rail",
  sword: "nether_star",
  key: "ender_pearl",
  pearl: "ender_pearl",
  cookie: "cake",
} as const satisfies Record<string, MinecraftItemIconName>;

export type MinecraftIconName = MinecraftItemIconName | keyof typeof legacyIcons;
export const minecraftIconChoices = Object.keys(minecraftItems) as MinecraftItemIconName[];
export const supportedMinecraftIcons: readonly string[] = [...minecraftIconChoices, ...Object.keys(legacyIcons)];

export function isMinecraftIconName(name: string): name is MinecraftIconName {
  return Object.hasOwn(minecraftItems, name) || Object.hasOwn(legacyIcons, name);
}

export function resolveMinecraftIcon(name: string): MinecraftItemIconName {
  if (Object.hasOwn(minecraftItems, name)) return name as MinecraftItemIconName;
  if (Object.hasOwn(legacyIcons, name)) return legacyIcons[name as keyof typeof legacyIcons];
  return "diamond";
}
