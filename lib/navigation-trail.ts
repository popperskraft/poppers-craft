/* Путь пользователя по сайту для кнопки «← НАЗАД».

   Это не копия истории браузера, а «хлебные крошки» без петель:
   - промежуточные шаги (проверка 2FA, итог оплаты, ссылки из писем,
     редакторы) в путь не попадают, поэтому «Назад» туда не ведёт;
   - если человек вернулся на страницу, которая уже есть в пути, всё,
     что было после неё, отбрасывается. Так «Назад» не гоняет по кругу
     между двумя страницами;
   - та же страница с другими фильтрами (?q=, ?page=, ?tab=) заменяет
     прежнюю запись, а не добавляет новую;
   - завершённый сценарий (оплата, выход из аккаунта) обнуляет путь:
     после оплаты «Назад» ведёт на главную, а не обратно к оплате. */

export const NAVIGATION_STACK_KEY = "popperscraft:navigation-stack";
/* Раздел главной, на котором человек был перед уходом со страницы. */
export const HOME_SECTION_KEY = "popperscraft:home-section";

const MAX_ENTRIES = 24;

const TRANSIENT_PATTERNS = [
  /^\/mfa\/?$/,
  /^\/auth(?:\/|$)/,
  /^\/donation\/return\/?$/,
  /^\/reset\/?$/,
  /^\/mail\/?$/,
  /^\/launcher\/authorize\/?$/,
  /^\/my-card\/?$/,
  /^\/wiki\/new\/?$/,
  /^\/wiki\/articles\/[^/]+\/edit\/?$/,
  /^\/oauth(?:\/|$)/,
];

/* Одноразовые параметры: токены из писем, номер платежа, адрес после
   входа и открытие окон. Возвращаться с ними нельзя. */
const VOLATILE_PARAMS = ["token", "token_hash", "code", "state", "type", "payment", "next", "login", "plan", "to", "from", "donationInterest", "error", "error_description"];

/* Параметры, которые делают из страницы другую страницу: анкета в
   вайтлисте — отдельное окно со своей кнопкой «Назад» к списку. */
const IDENTITY_PARAMS = ["application"];

export const HOME_SECTIONS = ["top", "overview", "waitlist", "updates", "donate", "soon"] as const;

export function isTransientPath(pathname: string) {
  return TRANSIENT_PATTERNS.some((pattern) => pattern.test(pathname));
}

/* Запись пути: адрес страницы без одноразовых параметров. */
export function trailEntry(pathname: string, search: string) {
  const params = new URLSearchParams(search);
  for (const key of VOLATILE_PARAMS) params.delete(key);
  const query = params.toString();
  return `${pathname || "/"}${query ? `?${query}` : ""}`;
}

function splitEntry(entry: string) {
  const index = entry.indexOf("?");
  return index < 0
    ? { pathname: entry, params: new URLSearchParams() }
    : { pathname: entry.slice(0, index), params: new URLSearchParams(entry.slice(index + 1)) };
}

/* «Та же страница»: путь и параметры, которые меняют саму страницу. */
function identityOf(entry: string) {
  const { pathname, params } = splitEntry(entry);
  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  const keys = IDENTITY_PARAMS.filter((key) => params.has(key)).map((key) => `${key}=${params.get(key)}`);
  return keys.length ? `${normalized}?${keys.join("&")}` : normalized;
}

function validEntry(value: unknown): value is string {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//") && !isTransientPath(splitEntry(value).pathname);
}

export function readTrail(): string[] {
  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(NAVIGATION_STACK_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter(validEntry) : [];
  } catch {
    return [];
  }
}

function writeTrail(trail: string[]) {
  try {
    window.sessionStorage.setItem(NAVIGATION_STACK_KEY, JSON.stringify(trail.slice(-MAX_ENTRIES)));
  } catch {
    // Без хранилища «Назад» просто ведёт на родительскую страницу.
  }
}

/* Отметить открытую страницу. */
export function recordVisit(pathname: string, search: string) {
  if (isTransientPath(pathname)) return;
  const entry = trailEntry(pathname, search);
  const identity = identityOf(entry);
  const trail = readTrail();
  let index = -1;
  for (let i = trail.length - 1; i >= 0; i -= 1) {
    if (identityOf(trail[i]) === identity) { index = i; break; }
  }
  writeTrail(index >= 0 ? [...trail.slice(0, index), entry] : [...trail, entry]);
}

/* Сценарий завершён: дальше «Назад» ведёт только по указанным страницам. */
export function resetTrail(entries: string[] = []) {
  writeTrail(entries.filter(validEntry));
}

/* Страница больше не существует (например, статью удалили). */
export function forgetTrailPage(pathname: string) {
  const identity = identityOf(pathname);
  writeTrail(readTrail().filter((entry) => identityOf(entry) !== identity));
}

/* Куда ведёт «Назад» со страницы: предыдущая страница пути или null.
   Найденная запись снимается — открывшись, страница добавит себя снова. */
export function takePreviousPage(pathname: string, search: string) {
  const current = identityOf(trailEntry(pathname, search));
  const trail = readTrail();
  while (trail.length && identityOf(trail[trail.length - 1]) === current) trail.pop();
  const previous = trail.pop() ?? null;
  if (previous) writeTrail(trail);
  return previous;
}

/* Главная: вернуть человека к разделу, где он был. */
export function withHomeSection(entry: string) {
  if (splitEntry(entry).pathname !== "/") return entry;
  try {
    const section = window.sessionStorage.getItem(HOME_SECTION_KEY) ?? "";
    return section && section !== "top" && (HOME_SECTIONS as readonly string[]).includes(section) ? `${entry}#${section}` : entry;
  } catch {
    return entry;
  }
}

/* Родительская страница — куда ведёт «Назад», если пути нет
   (страницу открыли по ссылке или в новой вкладке). */
export function parentPage(pathname: string, search = "") {
  const params = new URLSearchParams(search);
  if (pathname === "/whitelist" && params.has("application")) return "/whitelist";
  if (pathname.startsWith("/donation")) return "/";
  const connections = pathname.match(/^(\/players\/[^/]+)\/connections\//);
  if (connections) return connections[1];
  if (/^\/players\/[^/]+\/?$/.test(pathname)) return "/players";
  if (pathname === "/players") return "/feed";
  if (/^\/wiki\/articles\/[^/]+/.test(pathname)) return "/wiki/articles";
  if (pathname.startsWith("/wiki/") && pathname !== "/wiki/") return "/wiki";
  if (pathname === "/models") return "/profile";
  /* Разделы по меню сайта: лаунчер — часть «Играть», настройки — своей
     карточки (lib/site-navigation.ts). */
  if (pathname === "/launcher") return "/members";
  if (pathname === "/profile") return "/my-card";
  return "/";
}
