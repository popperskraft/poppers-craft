import { ProfileHeaderArt } from "@/app/ProfileHeaderArt";
import { hasPixelHeaderArt, type PixelHeaderArt } from "@/lib/profile-header-art";

export function WikiCover({ art }: { art?: PixelHeaderArt | null }) {
  if (!hasPixelHeaderArt(art ?? null)) return null;
  return <div className="wiki-painted-cover" aria-hidden="true"><ProfileHeaderArt art={art ?? null} /></div>;
}
