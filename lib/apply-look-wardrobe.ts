import "server-only";
import { callModelService, ModelServiceError, type ModelServiceProfile } from "./model-service";
import { downloadWardrobeSkin, humanPngPixels } from "./skin-wardrobe";
import { normalizeHumanSkin } from "./human-skin";
import {
  decodePixels, normalizeTemplate, setMetadata, RACES, SIZES, TAIL_LENGTHS, SNOUTS,
  type Race, type PonySize, type TailLength, type Snout, type SkinSlot,
} from "./character-models";
import type { LookEntry, LookPayload } from "./player-looks";

const changed = () => new ModelServiceError("Внешность уже изменена в другом окне. Обновите данные перед сохранением.", 409);

/** Applying an archived look selects an existing match or consumes a free slot. */
export async function applyLookWardrobe(
  login: string, entry: LookEntry, payload: LookPayload, profile: ModelServiceProfile,
): Promise<ModelServiceProfile> {
  if (!profile.wardrobe) throw new ModelServiceError("Работа с моделями пока недоступна.", 503);
  const kind = payload.kind;
  const slots = profile.wardrobe[kind];
  let target: Record<string, unknown>;
  let matches: (slot: SkinSlot) => Promise<boolean>;

  const detail = async (slot: SkinSlot) => {
    const current = await callModelService(login, { action: "slot", kind, slotId: slot.id });
    if (current.revision !== profile.revision || current.slot?.id !== slot.id) throw changed();
    return current.slot;
  };

  if (kind === "human") {
    const image = await humanPngPixels(new Uint8Array(Buffer.from(payload.skinBase64 ?? "", "base64")), entry.model ?? "classic");
    target = image;
    matches = async (slot) => {
      const saved = await detail(slot);
      const model = saved.model ?? "classic";
      if (model !== image.model) return false;
      const existing = saved.pixelsBase64
        ? { model, pixelsBase64: Buffer.from(normalizeHumanSkin(decodePixels(saved.pixelsBase64), model)).toString("base64") }
        : await humanPngPixels(await downloadWardrobeSkin(saved.skinUrl), model);
      return existing.model === image.model && existing.pixelsBase64 === image.pixelsBase64;
    };
  } else {
    const race = entry.race ?? profile.race ?? "earth";
    const size = entry.size ?? profile.size ?? "normal";
    const tailLength = entry.tailLength ?? "full";
    const snout = entry.snout ?? "rounded";
    if (!Object.hasOwn(RACES, race) || !Object.hasOwn(SIZES, size)
      || !Object.hasOwn(TAIL_LENGTHS, tailLength) || !Object.hasOwn(SNOUTS, snout)) {
      throw new ModelServiceError("Некорректные настройки модели.", 400);
    }
    // The service normalizes metadata and the retired template on every save.
    // Compare those same canonical pixels, so an old saved look is reusable.
    const canonical = async (encoded: string) => Buffer.from(setMetadata(
      await normalizeTemplate(decodePixels(encoded)), race as Race, size as PonySize,
      tailLength as TailLength, snout as Snout,
    )).toString("base64");
    const pixelsBase64 = await canonical(payload.pixelsBase64 ?? "");
    target = { race, size, tailLength, snout, pixelsBase64 };
    matches = async (slot) => {
      if (slot.race !== race || slot.size !== size || (slot.tailLength ?? "full") !== tailLength || (slot.snout ?? "rounded") !== snout) return false;
      const saved = await detail(slot);
      return Boolean(saved.pixelsBase64) && await canonical(saved.pixelsBase64!) === pixelsBase64;
    };
  }

  const comparisons = await Promise.all(slots.map(matches));
  const match = slots.find((_, index) => comparisons[index]);
  if (match) {
    return callModelService(login, { action: "wardrobe", operation: "select", kind, slotId: match.id, revision: profile.revision });
  }
  if (slots.length >= 5) throw new ModelServiceError("Можно сохранить не больше пяти скинов каждого типа.", 409);
  return callModelService(login, { action: "wardrobe", operation: "save", kind, revision: profile.revision, ...target });
}
