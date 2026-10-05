/* Язык интерфейса хранится в cookie, чтобы сервер знал его ещё до отрисовки
   страницы, и дублируется в профиле — на новом устройстве после входа
   язык восстанавливается сам. */
export const LOCALE_COOKIE = "pc_lang";
export const LOCALES = ["ru", "en"] as const;
export type Locale = (typeof LOCALES)[number];

export function normalizeLocale(value: unknown): Locale {
  return value === "en" ? "en" : "ru";
}
