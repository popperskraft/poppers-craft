import { headerFlagLabel } from "@/lib/header-flags";
import { isUpdateFlag, normalizeUpdateColor } from "@/lib/update-styles";
import "./update-flags.css";

export function UpdateBadge({ color, label }: { color: string; label: string }) {
  const style = normalizeUpdateColor(color);
  const flag = isUpdateFlag(style);
  return (
    <span
      className={`version-box ${flag ? `update-flag flag-${style}` : style}`}
      title={flag ? headerFlagLabel(style) : undefined}
    >
      <span>{label}</span>
    </span>
  );
}
