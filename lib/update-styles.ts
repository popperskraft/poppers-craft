import { HEADER_FLAG_OPTIONS, type HeaderFlag } from "./header-flags";

export type UpdateFlag = Exclude<HeaderFlag, "none" | "custom">;
type FlagOption = Extract<(typeof HEADER_FLAG_OPTIONS)[number], { value: UpdateFlag }>;

// Use the profile catalogue as the source of truth; custom drawings are not flags.
export const UPDATE_FLAG_OPTIONS = HEADER_FLAG_OPTIONS.filter(
  (option): option is FlagOption => option.value !== "none" && option.value !== "custom",
);
export const UPDATE_SOLID_COLOR_OPTIONS = [
  { value: "lime", label: "ЛАЙМ" },
  { value: "pink", label: "РОЗОВЫЙ" },
  { value: "cyan", label: "ГОЛУБОЙ" },
  { value: "yellow", label: "ЖЁЛТЫЙ" },
] as const;

export type UpdateColor = (typeof UPDATE_SOLID_COLOR_OPTIONS)[number]["value"] | UpdateFlag;
const flagValues = new Set<string>(UPDATE_FLAG_OPTIONS.map((option) => option.value));
const colorValues = new Set<string>([
  ...UPDATE_SOLID_COLOR_OPTIONS.map((option) => option.value),
  ...flagValues,
]);

export function isUpdateFlag(value: unknown): value is UpdateFlag {
  return typeof value === "string" && flagValues.has(value);
}

export function isUpdateColor(value: unknown): value is UpdateColor {
  return typeof value === "string" && colorValues.has(value);
}

export function normalizeUpdateColor(value: unknown): UpdateColor {
  return isUpdateColor(value) ? value : "pink";
}

// Preserve the existing database enum: flags are stored as style:<flag>:<id>
// with a plain pink fallback. Legacy USA records remain intact, without a flag.
export function readUpdateColor(sourceKey: unknown, storedColor: unknown): UpdateColor {
  if (typeof sourceKey === "string" && sourceKey.startsWith("style:")) {
    const flag = sourceKey.split(":")[1];
    return isUpdateFlag(flag) ? flag : "pink";
  }
  return normalizeUpdateColor(storedColor);
}
