import type { MinecraftIconName } from "@/lib/minecraft-icons";

/* Разделы справочника Wiki. Общие для страницы /wiki и приложения для iPhone
   (GET /api/app/wiki), чтобы текст правился в одном месте. */
export type WikiHubSection = {
  id: string;
  icon: MinecraftIconName;
  title: string;
  lines: string[];
};

export const WIKI_HUB_SECTIONS: WikiHubSection[] = [
  {
    id: "start",
    icon: "crafting_table",
    title: "КАК НАЧАТЬ",
    lines: [
      "Сначала заполни анкету в лист ожидания: её оценят игроки, решение примет администрация.",
      "После одобрения скачай лаунчер PoppersCraft в разделе «Играть» и войди с ником и паролем из анкеты — лаунчер сам подключит к серверу.",
    ],
  },
  {
    id: "mods",
    icon: "furnace",
    title: "МОДЫ И ПЛАГИНЫ",
    lines: [],
  },
  {
    id: "metro",
    icon: "rail",
    title: "POPPERSMETRO",
    lines: [
      "самописный плагин на метро в мире popperscraft",
    ],
  },
  {
    id: "economy",
    icon: "emerald",
    title: "ЭКОНОМИКА И ЗЕМЛЯ",
    lines: [
      "1 алмаз = 100 попперсов. Попперсы нужны для земли и торговли между игроками.",
      "Игровые преимущества за реальные деньги не продаются.",
      "Дороги, станции и метро строят сами игроки.",
    ],
  },
  {
    id: "community",
    icon: "golden_apple",
    title: "ЛЕНТА И ПРОФИЛИ",
    lines: [],
  },
  {
    id: "map",
    icon: "compass",
    title: "КАРТА МИРА",
    lines: [
      "карта может лагать, я до сих пор не очень понимаю как она работает, но вроде норм",
    ],
  },
  {
    id: "help",
    icon: "knowledge_book",
    title: "ПРАВИЛА И ПОМОЩЬ",
    lines: [
      "Перед регистрацией нужно принять правила сервера и условия обработки данных анкеты.",
      "Если ответа нет в Wiki, напиши @PoppersCraftAuthBot в Telegram или спроси Попперса на сайте.",
    ],
  },
];
