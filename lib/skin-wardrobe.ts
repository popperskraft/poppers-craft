import "server-only";
import { serverSharp } from "@/lib/server-sharp";
import { expandLegacyHuman, normalizeHumanSkin } from "./human-skin";
import { callModelService, type ModelServiceProfile } from "./model-service";
import { validatePlayerSkin, type PlayerSkinModel } from "./player-skins";

export { activeHumanSkin, activeHumanModel, skinPreviewUrl } from "./skin-preview";
export async function humanPngPixels(bytes: Uint8Array, model: PlayerSkinModel) {
  validatePlayerSkin(bytes);
  const {data,info}=await serverSharp(bytes,{limitInputPixels:4096}).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  if(info.width!==64||![32,64].includes(info.height)||info.channels!==4)throw new Error("Скин должен иметь размер 64×64 или 64×32 пикселя.");
  const pixels=new Uint8ClampedArray(data);
  return {model:info.height===32?'classic' as const:model,pixelsBase64:Buffer.from(info.height===32?expandLegacyHuman(pixels):normalizeHumanSkin(pixels,model)).toString('base64')};
}
export async function downloadWardrobeSkin(url: string) {
  const parsed=new URL(url);
  if(parsed.protocol!=='https:'||parsed.hostname!=='cdn.popperscraft.org'||parsed.port||parsed.username||parsed.password||parsed.search||parsed.hash||!/^\/skins\/models\/[a-f0-9]{64}\.png$/.test(parsed.pathname))throw new Error('Invalid skin URL');
  const response=await fetch(url,{cache:'no-store',redirect:'error',signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw new Error('Skin unavailable');
  const reader=response.body?.getReader(),chunks:Uint8Array[]=[];let length=0;
  if(reader)while(true){const {value,done}=await reader.read();if(done)break;length+=value.byteLength;if(length>256*1024){await reader.cancel();throw new Error('Skin too large');}chunks.push(value);}
  const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}validatePlayerSkin(bytes);return bytes;
}
export async function saveHumanWardrobe(login: string, bytes: Uint8Array, model: PlayerSkinModel, profile: ModelServiceProfile, append=false) {
  const image=await humanPngPixels(bytes,model);
  return callModelService(login,{action:'wardrobe',operation:'save',kind:'human',slotId:append?undefined:profile.wardrobe?.activeHumanId??undefined,revision:profile.revision,...image});
}
