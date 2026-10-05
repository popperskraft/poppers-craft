import type { ModelServiceProfile } from "./model-service";
import type { PlayerSkinModel } from "./player-skins";

export function activeHumanSkin(profile: ModelServiceProfile) {
  return profile.wardrobe?.human.find(slot => slot.id === profile.wardrobe?.activeHumanId) ?? null;
}
export function activeHumanModel(profile: ModelServiceProfile | null, legacy: unknown): PlayerSkinModel {
  return (profile?.wardrobe?.humanInitialized ? activeHumanSkin(profile)?.model : legacy) === 'slim' ? 'slim' : 'classic';
}

export function skinPreviewUrl(login: string) { return 'https://www.popperscraft.org/api/skins/'+encodeURIComponent(login.toLowerCase()); }
