export type FeedPoll = { kind: "vote" | "text"; question: string; options: string[] };
export type FeedPollResults = FeedPoll & { counts: number[]; total: number; myAnswer: string | null; answers: { author: string; text: string }[] };
const PREFIX = "__pc_feed_v1__:";

export function validatePoll(value: unknown): FeedPoll | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object") throw new Error("Неверный формат опроса.");
  const p = value as Record<string, unknown>;
  if (p.kind !== "vote" && p.kind !== "text") throw new Error("Выберите тип опроса.");
  const question = typeof p.question === "string" ? p.question.trim() : "";
  if (question.length < 3 || question.length > 200) throw new Error("Вопрос: от 3 до 200 символов.");
  const options = Array.isArray(p.options) ? p.options.map(x => typeof x === "string" ? x.trim() : "") : [];
  if (p.kind === "vote" && (options.length < 2 || options.length > 10 || options.some(x => !x || x.length > 120) || new Set(options.map(normalizeSearch)).size !== options.length)) throw new Error("Добавьте от 2 до 10 разных вариантов, каждый до 120 символов.");
  return { kind: p.kind, question, options: p.kind === "vote" ? options : [] };
}

export function encodeFeedBody(body: string, poll: FeedPoll | null) {
  const value = PREFIX + JSON.stringify({ body, poll });
  if (value.length > 5000) throw new Error("Пост с опросом слишком большой. Сократите текст или варианты.");
  return value;
}

export function decodeFeedBody(value: string): { body: string; poll: FeedPoll | null } {
  if (value.startsWith(PREFIX)) {
    try {
      const data = JSON.parse(value.slice(PREFIX.length));
      if (typeof data.body === "string") return { body: data.body, poll: validatePoll(data.poll) };
    } catch { /* Legacy plain text remains readable. */ }
  }
  return { body: value, poll: null };
}

export function normalizeSearch(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase("ru").replace(/ё/g, "е").replace(/@/g, "").trim();
}

function oneTypo(a: string, b: string) {
  if (a.length < 4 || Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, errors = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++errors > 1) return false;
    if (a.length === b.length && a[i] === b[j + 1] && a[i + 1] === b[j]) { i += 2; j += 2; continue; }
    if (a.length >= b.length) i++;
    if (b.length >= a.length) j++;
  }
  return errors + (i < a.length || j < b.length ? 1 : 0) <= 1;
}

export function matchesFeedSearch(query: string, fields: string[]) {
  const haystack = normalizeSearch(fields.join(" "));
  const words = haystack.split(/[^\p{L}\p{N}_.-]+/u);
  return normalizeSearch(query).split(/\s+/).filter(Boolean).every(token => haystack.includes(token) || words.some(word => oneTypo(token, word)));
}
