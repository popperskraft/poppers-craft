/* Оформление ответов Попперса (просьба владельца, 2026-10-03). Модель пишет
   Markdown: «## Заголовок», «**жирный**», списки «1.» и «-». На сайте это
   превращается в заголовки, выделение и списки (app/PoppersRichText.tsx), а в
   Telegram — в чистый текст без звёздочек и решёток (poppersPlainText).
   HTML из ответа не вставляется: только текст, а ссылки кликабельны лишь на
   страницы сайта, его поддомены и t.me. */

export type InlineNode =
  | { type: "text"; text: string }
  | { type: "strong"; children: InlineNode[] }
  | { type: "em"; children: InlineNode[] }
  | { type: "code"; text: string }
  | { type: "link"; href: string; children: InlineNode[] };

export type PoppersListItem = { number: number | null; text: string };

export type PoppersBlock =
  | { type: "heading"; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; ordered: boolean; items: PoppersListItem[] };

const SITE_ORIGIN = "https://popperscraft.org";

const FENCE = /^\s*(```|~~~)/;
const RULE = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
const TABLE_RULE = /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)*\|?\s*$/;
const TABLE_ROW = /^\s*\|(.+)\|\s*$/;
const HEADING = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/;
const BULLET = /^\s*[-*+•]\s+(.*)$/;
const NUMBERED = /^\s*(\d{1,3})[.)]\s+(.*)$/;
const QUOTE = /^\s*>\s?(.*)$/;

/* Разбор на блоки: заголовки, абзацы и списки. Таблицы превращаются в
   строки «ячейка · ячейка», разделители и рамки кода убираются. */
export function parsePoppersText(source: string): PoppersBlock[] {
  const blocks: PoppersBlock[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length) blocks.push({ type: "paragraph", text: paragraph.join("\n") });
    paragraph = [];
  };
  for (const rawLine of String(source ?? "").replace(/\r\n?/g, "\n").split("\n")) {
    if (FENCE.test(rawLine)) continue;
    const line = rawLine.replace(/\s+$/, "");
    if (!line.trim()) {
      flush();
      continue;
    }
    if (RULE.test(line)) {
      flush();
      continue;
    }
    /* Строка «|---|---|» под шапкой таблицы: таблица остаётся одним абзацем. */
    if (TABLE_RULE.test(line)) continue;
    const heading = HEADING.exec(line);
    if (heading) {
      flush();
      blocks.push({ type: "heading", text: heading[1] });
      continue;
    }
    const bullet = BULLET.exec(line);
    const numbered = bullet ? null : NUMBERED.exec(line);
    if (bullet || numbered) {
      flush();
      const ordered = Boolean(numbered);
      const item: PoppersListItem = { number: numbered ? Number(numbered[1]) : null, text: (numbered ? numbered[2] : bullet![1]).trim() };
      const last = blocks[blocks.length - 1];
      if (last?.type === "list" && last.ordered === ordered) last.items.push(item);
      else blocks.push({ type: "list", ordered, items: [item] });
      continue;
    }
    /* Строка с отступом сразу после пункта списка — продолжение этого пункта. */
    const last = blocks[blocks.length - 1];
    if (!paragraph.length && last?.type === "list" && /^\s{2,}\S/.test(line)) {
      const item = last.items[last.items.length - 1];
      item.text = `${item.text}\n${line.trim()}`;
      continue;
    }
    const row = TABLE_ROW.exec(line);
    const quote = row ? null : QUOTE.exec(line);
    paragraph.push(row
      ? row[1].split("|").map((cell) => cell.trim()).filter(Boolean).join(" · ")
      : quote ? quote[1].trim() : line.trim());
  }
  flush();
  return blocks;
}

/* Ссылка кликабельна только на свой сайт (в том числе /путь), его поддомены и t.me. */
export function safeHref(url: string): string | null {
  const value = String(url ?? "").trim();
  if (/^\/(?!\/)\S*$/.test(value)) return value;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:") return null;
    const host = parsed.hostname.toLowerCase();
    if (host === "popperscraft.org" || host.endsWith(".popperscraft.org") || host === "t.me") return parsed.toString();
  } catch {
    // Not a URL: shown as plain text.
  }
  return null;
}

const INLINE = new RegExp([
  String.raw`\*\*(?=\S)([\s\S]*?\S)\*\*`,
  String.raw`__(?=\S)([\s\S]*?\S)__`,
  String.raw`\x60([^\x60\n]+)\x60`,
  String.raw`\[([^\]\n]+)\]\(([^)\s]+)\)`,
  String.raw`~~(?=\S)([^~\n]*?\S)~~`,
  String.raw`(?<![\p{L}\p{N}_*])\*(?=[^\s*])([^*\n]*?[^\s*])\*(?![\p{L}\p{N}*])`,
  String.raw`(?<![\p{L}\p{N}_])_(?=[^\s_])([^_\n]*?[^\s_])_(?![\p{L}\p{N}_])`,
  String.raw`(https:\/\/[^\s<>"()]*[^\s<>"().,;:!?])`,
].join("|"), "gu");

/* Остатки разметки, которые не сложились в пару: «**», одиночная «*» у края
   слова, обратные кавычки. «2 * 3» с пробелами вокруг не трогаем. */
function stripStray(value: string) {
  return value
    .replace(/\*{2,}/g, "")
    .replace(/(^|\s)\*(?=\S)/g, "$1")
    .replace(/(\S)\*(?=\s|$)/g, "$1")
    .replace(/\x60+/g, "")
    .replace(/(^|\s)_{2,}(?=\S)|(\S)_{2,}(?=\s|$)/g, "$1$2");
}

export function parseInline(text: string): InlineNode[] {
  const nodes: InlineNode[] = [];
  const pushText = (value: string) => {
    const clean = stripStray(value);
    if (!clean) return;
    const previous = nodes[nodes.length - 1];
    if (previous?.type === "text") previous.text += clean;
    else nodes.push({ type: "text", text: clean });
  };
  let last = 0;
  for (const match of String(text ?? "").matchAll(INLINE)) {
    const index = match.index ?? 0;
    pushText(text.slice(last, index));
    const [whole, bold, boldUnderscore, code, label, url, strike, em, emUnderscore, bareUrl] = match;
    if (bold !== undefined || boldUnderscore !== undefined) {
      nodes.push({ type: "strong", children: parseInline(bold ?? boldUnderscore) });
    } else if (code !== undefined) {
      nodes.push({ type: "code", text: code });
    } else if (label !== undefined) {
      const href = safeHref(url);
      if (href) nodes.push({ type: "link", href, children: parseInline(label) });
      else for (const node of parseInline(`${label} (${url})`)) node.type === "text" ? pushText(node.text) : nodes.push(node);
    } else if (strike !== undefined) {
      for (const node of parseInline(strike)) node.type === "text" ? pushText(node.text) : nodes.push(node);
    } else if (em !== undefined || emUnderscore !== undefined) {
      nodes.push({ type: "em", children: parseInline(em ?? emUnderscore) });
    } else if (bareUrl !== undefined) {
      const href = safeHref(bareUrl);
      if (href) nodes.push({ type: "link", href, children: [{ type: "text", text: bareUrl }] });
      else pushText(bareUrl);
    }
    last = index + whole.length;
  }
  pushText(String(text ?? "").slice(last));
  return nodes;
}

/* Текст без разметки. absoluteLinks — для Telegram: там нет сайта вокруг,
   поэтому «/members» превращается в полный адрес. */
export function inlinePlainText(nodes: InlineNode[], absoluteLinks = false): string {
  return nodes.map((node) => {
    if (node.type === "text" || node.type === "code") return node.text;
    if (node.type === "link") {
      const label = inlinePlainText(node.children, absoluteLinks);
      const href = absoluteLinks && node.href.startsWith("/") ? `${SITE_ORIGIN}${node.href}` : node.href;
      return label === node.href || label === href ? href : `${label} (${href})`;
    }
    return inlinePlainText(node.children, absoluteLinks);
  }).join("");
}

/* Ответ Попперса для Telegram: заголовки — отдельной строкой, пункты — «•» или
   «1.», без звёздочек, решёток и других служебных символов. */
export function poppersPlainText(source: string): string {
  return parsePoppersText(source).map((block) => {
    if (block.type === "list") {
      return block.items.map((item, index) => {
        const marker = block.ordered ? `${item.number ?? index + 1}.` : "•";
        return `${marker} ${inlinePlainText(parseInline(item.text), true)}`;
      }).join("\n");
    }
    return inlinePlainText(parseInline(block.text), true);
  }).join("\n\n").trim();
}
