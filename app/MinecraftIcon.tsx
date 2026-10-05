/* eslint-disable @next/next/no-img-element */
import { resolveMinecraftIcon, type MinecraftIconName } from "@/lib/minecraft-icons";
import "./minecraft-icons.css";

export type { MinecraftIconName } from "@/lib/minecraft-icons";

export function MinecraftIcon({
  name,
  size = "md",
}: {
  name: MinecraftIconName;
  size?: "sm" | "md" | "lg";
}) {
  return (
    <img
      className={`minecraft-icon mc-png-icon mc-icon-${size}`}
      src={`/minecraft-items/${resolveMinecraftIcon(name)}.png`}
      width={128}
      height={128}
      alt=""
      aria-hidden="true"
      draggable={false}
      decoding="async"
    />
  );
}
