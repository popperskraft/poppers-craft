import { normalizeWikiBlocks, normalizeWikiCategory, type WikiArticleBlock } from "./wiki-content";
import { parsePixelHeaderArt, type PixelHeaderArt } from "./profile-header-art";

export type WikiEditorDocument = { title: string; summary: string; category: string; tags: string; blocks: WikiArticleBlock[]; coverArt?: PixelHeaderArt | null };
export type WikiLocalDraft = { version: 1; userId: string; updatedAt: string | null; savedAt: string; document: WikiEditorDocument };

export function wikiDocumentKey(document: WikiEditorDocument) {
  // Signed image URLs expire; they are presentation data, not an article edit.
  return JSON.stringify({ ...document, coverArt: document.coverArt ?? null, blocks: document.blocks.map(block => ({ ...block, imageUrl: undefined })) });
}

export function parseWikiLocalDraft(raw: string | null, userId: string): WikiLocalDraft | null {
  try {
    const value = JSON.parse(raw ?? "null");
    if (!value || value.version !== 1 || value.userId !== userId || !value.document || typeof value.savedAt !== "string") return null;
    const draft = value.document;
    if (!["title", "summary", "category", "tags"].every(key => typeof draft[key] === "string") || !Array.isArray(draft.blocks)) return null;
    return {
      version: 1, userId, updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : null, savedAt: value.savedAt,
      document: { title: draft.title.slice(0, 120), summary: draft.summary.slice(0, 500), category: normalizeWikiCategory(draft.category), tags: draft.tags.slice(0, 220), blocks: normalizeWikiBlocks(draft.blocks), coverArt: parsePixelHeaderArt(draft.coverArt) },
    };
  } catch { return null; }
}
