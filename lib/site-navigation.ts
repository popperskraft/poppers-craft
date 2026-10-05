/* Главное меню сайта — одно на всех страницах.

   Раньше полное меню было только на главной, а внутренние страницы
   показывали каждая свой набор ссылок («НА ГЛАВНУЮ», «ЛЕНТА», «МОЙ
   ПРОФИЛЬ →», «ПОИСК ИГРОКОВ»…), и из ленты в Wiki можно было попасть
   только через главную. Теперь шапка одна (главная и app/SiteHeader.tsx
   берут пункты отсюда), а на страницах остаются только «← НАЗАД» и
   действия самой страницы.

   Договорённость о стрелках на кнопках:
     →  страница сайта;
     ↓  раздел ниже на этой же странице;
     ↗  другой сайт, Telegram или скачивание файла. */

export type NavViewer = {
  authenticated: boolean;
  needsMfa?: boolean;
  /* Одобренная анкета: лента, игроки, вайтлист, страница доступа. */
  approved: boolean;
  admin: boolean;
  /* Анкеты в вайтлисте, за которые этот игрок ещё не голосовал
     (lib/whitelist-to-vote.ts): число на пункте «Вайтлист» и полоска
     под шапкой. latestId — самая новая из них: закрытая полоска
     появляется снова только с новой анкетой. */
  whitelistToVote?: number;
  whitelistLatestId?: number;
};

export type NavItem = {
  label: string;
  href: string;
  /* Раздел главной: на главной пункт прокручивает к нему. */
  section?: string;
  /* Страницы, на которых пункт подсвечен как текущий. */
  match: string[];
  /* Число на пункте: сколько анкет ждут голоса. */
  badge?: number;
};

export function mainNavItems(viewer: NavViewer | null): NavItem[] {
  const signedIn = Boolean(viewer?.authenticated && !viewer.needsMfa);
  const approved = signedIn && Boolean(viewer?.approved);
  const admin = signedIn && Boolean(viewer?.admin);
  const plus: NavItem = { label: "PLUS", href: "/plus", match: ["/plus", "/donation"] };
  const wiki: NavItem = { label: "Wiki", href: "/wiki", match: ["/wiki"] };

  if (approved || admin) {
    return [
      /* Как попасть на сервер: лаунчер, шаги, IP. Администратору без
         анкеты страница доступа не положена — ему сразу лаунчер. */
      approved
        ? { label: "Играть", href: "/members", match: ["/members", "/launcher"] }
        : { label: "Играть", href: "/launcher", match: ["/launcher"] },
      { label: "Лента", href: "/feed", match: ["/feed"] },
      /* Список игроков — отдельный пункт после ленты (r100: из меню
         аккаунта он переехал в шапку по просьбе владельца). */
      { label: "Список игроков", href: "/players", match: ["/players"] },
      {
        label: "Вайтлист",
        href: "/whitelist",
        match: ["/whitelist"],
        ...(viewer?.whitelistToVote ? { badge: viewer.whitelistToVote } : {}),
      },
      wiki,
      /* «PLUS» здесь больше нет (r090): подписка игрока — в «Профиль ▾ →
         Подписка» (app/profile/page.tsx), а тарифы открываются оттуда. */
      ...(admin ? [{ label: "Управление", href: "/admin", match: ["/admin"] }] : []),
    ];
  }

  return [
    ...(!viewer?.authenticated ? [{ label: "Лист ожидания", href: "/#waitlist", section: "waitlist", match: [] }] : []),
    { label: "Обновления", href: "/#updates", section: "updates", match: [] },
    wiki,
    { label: "Правила", href: "/rules", match: ["/rules", "/cookies"] },
    plus,
  ];
}

export function isCurrentNavItem(item: NavItem, pathname: string) {
  return item.match.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/* Страницы без общей шапки: у главной и управления она своя, а проверки
   входа, письма, оплата и редакторы — отдельные шаги, из которых не
   уходят посередине. */
const WITHOUT_HEADER = [
  /^\/$/,
  /^\/admin(?:\/|$)/,
  /^\/auth(?:\/|$)/,
  /^\/mfa\/?$/,
  /^\/mail\/?$/,
  /^\/reset\/?$/,
  /^\/my-card\/?$/,
  /^\/launcher\/authorize\/?$/,
  /^\/donation\/return\/?$/,
  /^\/models(?:\/|$)/,
  /^\/wiki\/new\/?$/,
  /^\/wiki\/articles\/[^/]+\/edit\/?$/,
  /^\/oauth(?:\/|$)/,
];

export function hasSiteHeader(pathname: string) {
  return !WITHOUT_HEADER.some((pattern) => pattern.test(pathname));
}

/* Подпись к числу на пункте «Вайтлист» — для экранных дикторов и подсказки. */
export function whitelistBadgeLabel(count: number) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  const word = mod10 === 1 && mod100 !== 11 ? "анкета ждёт" : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? "анкеты ждут" : "анкет ждут";
  return `${count} ${word} вашего голоса`;
}
