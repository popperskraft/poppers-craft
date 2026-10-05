import {
  normalizeWikiBlocks,
  normalizeWikiCategory,
  normalizeWikiTags,
  isWikiImagePath,
  wikiImageIds,
  wikiArticleTextLength,
  type WikiArticleBlock,
  type WikiArticleCategory,
} from "@/lib/wiki-content";
import { parsePixelHeaderArt, type PixelHeaderArt } from "@/lib/profile-header-art";

export type WikiArticleInput = {
  title: string;
  summary: string;
  category: WikiArticleCategory;
  tags: string[];
  blocks: WikiArticleBlock[];
  status: "draft" | "published";
  coverArt?: PixelHeaderArt | null;
};

export function parseWikiArticleInput(value: unknown): { value: WikiArticleInput | null; error: string | null } {
  if (!value || typeof value !== "object") return { value: null, error: "Не удалось прочитать статью." };
  const body = value as Record<string, unknown>;
  const title = String(body.title ?? "").trim().slice(0, 120);
  const summary = String(body.summary ?? "").trim().slice(0, 500);
  const category = normalizeWikiCategory(body.category);
  const tags = normalizeWikiTags(body.tags);
  const blocks = normalizeWikiBlocks(body.blocks);
  const status = body.status === "published" ? "published" : "draft";
  const coverArt = body.coverArt == null ? body.coverArt as undefined | null : parsePixelHeaderArt(body.coverArt);
  if (body.coverArt != null && !coverArt) return { value: null, error: "Рисунок шапки повреждён. Откройте редактор и попробуйте снова." };
  if (wikiImageIds(blocks).some(path => !isWikiImagePath(path))) return { value: null, error: "Один из скриншотов недоступен. Загрузите его заново." };
  if (title.length < 3) return { value: null, error: "Название должно содержать от 3 до 120 символов." };
  if (summary.length > 500) return { value: null, error: "Краткое описание слишком длинное." };
  if (!blocks.length) return { value: null, error: "Добавьте в статью хотя бы один блок." };
  if (wikiArticleTextLength(blocks) > 50_000) return { value: null, error: "Статья слишком большая. Максимум — 50 000 символов." };
  if (status === "published" && !blocks.some((block) => block.type === "image" ? Boolean(block.imageId) : block.type === "divider" ? false : Boolean(block.text.trim()))) {
    return { value: null, error: "Перед публикацией добавьте текст или скриншот." };
  }
  return { value: { title, summary, category, tags, blocks, status, coverArt }, error: null };
}

const CYRILLIC_SLUG: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y",
  к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f",
  х: "h", ц: "c", ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};

export function wikiSlugBase(title: string) {
  const transliterated = title.toLocaleLowerCase("ru").split("").map((character) => CYRILLIC_SLUG[character] ?? character).join("");
  return transliterated.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 96) || "article";
}
