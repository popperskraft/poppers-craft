export const WIKI_ARTICLE_CATEGORIES = [
  "ГАЙДЫ",
  "СТРОИТЕЛЬСТВО",
  "МЕХАНИКИ",
  "ЭКОНОМИКА",
  "СООБЩЕСТВО",
  "ИСТОРИЯ",
  "ДРУГОЕ",
] as const;

export type WikiArticleCategory = typeof WIKI_ARTICLE_CATEGORIES[number];
export type WikiBlockType = "heading" | "paragraph" | "image" | "list" | "quote" | "notice" | "code" | "divider";
export type WikiFont = "pixel" | "mono" | "system";

export type WikiArticleBlock = {
  id: string;
  type: WikiBlockType;
  text: string;
  font: WikiFont;
  color: string;
  level?: 2 | 3;
  listStyle?: "bullet" | "number";
  imageId?: string;
  imageUrl?: string | null;
  alt?: string;
  caption?: string;
};

const BLOCK_TYPES = new Set<WikiBlockType>(["heading", "paragraph", "image", "list", "quote", "notice", "code", "divider"]);
const FONTS = new Set<WikiFont>(["pixel", "mono", "system"]);

function limitedString(value: unknown, maximum: number) {
  return String(value ?? "").replace(/\r\n?/g, "\n").slice(0, maximum);
}

function safeColor(value: unknown) {
  const color = String(value ?? "").trim();
  return /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : "#161616";
}

export function normalizeWikiTags(value: unknown) {
  const source = Array.isArray(value) ? value : String(value ?? "").split(",");
  return [...new Set(source.map((tag) => limitedString(tag, 24).trim().replace(/^#/, "").toLowerCase()).filter(Boolean))].slice(0, 8);
}

export function normalizeWikiCategory(value: unknown): WikiArticleCategory {
  const category = String(value ?? "").toUpperCase() as WikiArticleCategory;
  return WIKI_ARTICLE_CATEGORIES.includes(category) ? category : "ДРУГОЕ";
}

export function normalizeWikiBlocks(value: unknown): WikiArticleBlock[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 60).flatMap((candidate, index) => {
    if (!candidate || typeof candidate !== "object") return [];
    const raw = candidate as Record<string, unknown>;
    const type = String(raw.type ?? "") as WikiBlockType;
    if (!BLOCK_TYPES.has(type)) return [];
    const fontValue = String(raw.font ?? "pixel") as WikiFont;
    const block: WikiArticleBlock = {
      id: limitedString(raw.id, 80).replace(/[^a-zA-Z0-9_-]/g, "") || `block-${index + 1}`,
      type,
      text: type === "divider" || type === "image" ? "" : limitedString(raw.text, type === "heading" ? 180 : type === "code" ? 12000 : 6000),
      font: FONTS.has(fontValue) ? fontValue : "pixel",
      color: safeColor(raw.color),
    };
    if (type === "heading") block.level = Number(raw.level) === 3 ? 3 : 2;
    if (type === "list") block.listStyle = raw.listStyle === "number" ? "number" : "bullet";
    if (type === "image") {
      const imageId = limitedString(raw.imageId, 180).trim();
      if (imageId) block.imageId = imageId;
      block.alt = limitedString(raw.alt, 180).trim();
      block.caption = limitedString(raw.caption, 300).trim();
    }
    return [block];
  });
}

export function wikiArticleTextLength(blocks: WikiArticleBlock[]) {
  return blocks.reduce((total, block) => total + block.text.length + (block.caption?.length ?? 0) + (block.alt?.length ?? 0), 0);
}

export function wikiImageIds(blocks: WikiArticleBlock[]) {
  return [...new Set(blocks.flatMap((block) => block.type === "image" && block.imageId ? [block.imageId] : []))];
}

export function isWikiImagePath(path: string) {
  return path.length <= 180 && /^uploads\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_./-]+$/.test(path)
    && path.split("/").every(part => part !== "" && part !== "." && part !== "..");
}

export function wikiBlockLabel(type: WikiBlockType) {
  return ({
    heading: "ЗАГОЛОВОК",
    paragraph: "ТЕКСТ",
    image: "СКРИНШОТ",
    list: "СПИСОК",
    quote: "ЦИТАТА",
    notice: "ВАЖНО",
    code: "КОМАНДА / КОД",
    divider: "РАЗДЕЛИТЕЛЬ",
  } satisfies Record<WikiBlockType, string>)[type];
}
