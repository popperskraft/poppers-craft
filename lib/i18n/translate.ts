/* Перевод готового текста страницы по словарю EN_PHRASES.

   Порядок поиска:
   1. точное совпадение фразы (пробелы схлопнуты до одного);
   2. шаблоны с подстановками: «Голосов: {0}» ловит «Голосов: 2», а
      подставленные части тоже переводятся, если они есть в словаре;
   3. даты, отформатированные по-русски («13 сентября 2026 г., 05:15»),
      — только если после замены месяцев в тексте не осталось кириллицы.
      Так случайная дата внутри поста игрока не превращается в смесь языков.

   Если перевода нет, возвращается null — текст остаётся как есть. */

const CYRILLIC = /[А-Яа-яЁё]/;

const MONTHS: Record<string, string> = {
  января: "January", февраля: "February", марта: "March", апреля: "April", мая: "May", июня: "June",
  июля: "July", августа: "August", сентября: "September", октября: "October", ноября: "November", декабря: "December",
  "янв.": "Jan", "февр.": "Feb", "мар.": "Mar", "апр.": "Apr", "июн.": "Jun", "июл.": "Jul",
  "авг.": "Aug", "сент.": "Sep", "окт.": "Oct", "нояб.": "Nov", "дек.": "Dec",
};

const DATE_PATTERN = new RegExp(
  `(\\d{1,2}) (${Object.keys(MONTHS).map((month) => month.replace(".", "\\.")).join("|")})(?: (\\d{4})(?: г\\.)?)?( в )?`,
  "g",
);

function translateDates(text: string) {
  if (!DATE_PATTERN.test(text)) return null;
  DATE_PATTERN.lastIndex = 0;
  const result = text.replace(DATE_PATTERN, (_match, day: string, month: string, year: string | undefined, at: string | undefined) =>
    `${day} ${MONTHS[month]}${year ? ` ${year}` : ""}${at ? " at " : ""}`);
  return CYRILLIC.test(result) ? null : result;
}

type Pattern = { regex: RegExp; template: string };

export type Translator = (text: string) => string | null;

export function createTranslator(dictionary: Record<string, string>): Translator {
  const exact = new Map<string, string>();
  const patterns: Pattern[] = [];
  for (const [key, value] of Object.entries(dictionary)) {
    if (/\{\d+\}/.test(key)) {
      const source = key
        .split(/(\{\d+\})/)
        .map((part) => (/^\{\d+\}$/.test(part) ? "([\\s\\S]+?)" : part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
        .join("");
      patterns.push({ regex: new RegExp(`^${source}$`), template: value });
    } else {
      exact.set(key, value);
    }
  }
  /* Сначала более конкретные шаблоны — с длинной постоянной частью. */
  patterns.sort((left, right) => right.regex.source.length - left.regex.source.length);

  const translate: Translator = (text) => {
    const normalized = text.replace(/\s+/g, " ").trim();
    if (!normalized || !CYRILLIC.test(normalized)) return null;
    const direct = exact.get(normalized);
    if (direct !== undefined) return direct;
    for (const pattern of patterns) {
      const match = pattern.regex.exec(normalized);
      if (!match) continue;
      /* Подстановки в русской фразе пронумерованы слева направо, поэтому
         {n} — это (n + 1)-я скобка регулярного выражения. */
      return pattern.template.replace(/\{(\d+)\}/g, (_all, index: string) => {
        const value = match[Number(index) + 1] ?? "";
        return translate(value) ?? value;
      });
    }
    return translateDates(normalized);
  };
  return translate;
}
