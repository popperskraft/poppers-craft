import { RACES, SIZES, decodePixels, type Race, type PonySize } from "./character-models";

/** Only the appearance already visible in-game, never account or editor metadata. */
export type ProfilePony = { pixelsBase64: string; race: Race; size: PonySize };

export function profilePony(value: unknown): ProfilePony | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Record<string, unknown>;
  if (data.hasPony !== true || typeof data.pixelsBase64 !== "string"
    || !/^[A-Za-z0-9+/]{21846}==$/.test(data.pixelsBase64)
    || typeof data.race !== "string" || !Object.hasOwn(RACES, data.race)
    || typeof data.size !== "string" || !Object.hasOwn(SIZES, data.size)) return null;
  try { decodePixels(data.pixelsBase64); } catch { return null; }
  return { pixelsBase64: data.pixelsBase64, race: data.race as Race, size: data.size as PonySize };
}
