import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { callModelService } from "@/lib/model-service";
import { activeHumanSkin } from "@/lib/skin-wardrobe";
import { createPlayerSkinSignedUrl } from "@/lib/player-skins";
import { consumeRateLimit, rateLimitResponse } from "@/lib/request-security";
import { serverSharp } from "@/lib/server-sharp";
import { isValidLogin, normalizeLogin } from "@/lib/waitlist";
import { blankHuman } from "@/lib/human-skin";

export const dynamic="force-dynamic";
export const runtime="nodejs";
const cached=new Map<string,{expires:number;url:string|null}>();
/* Адрес скина всегда https://www.popperscraft.org/… (lib/skin-preview.ts), а сайт
   открывают и без www — без разрешения браузер не отдавал скин 3D-просмотру
   («Не удалось загрузить 3D-модель»). Скины и так публичные. */
const headers={"Cache-Control":"public, max-age=15", "X-Content-Type-Options":"nosniff", "Access-Control-Allow-Origin":"*"};
export async function GET(request:Request,{params}:{params:Promise<{login:string}>}) {
  const login=normalizeLogin((await params).login);
  if(!isValidLogin(login))return new Response(null,{status:404});
  let skin=cached.get(login);
  if(!skin||skin.expires<Date.now()) {
    const limit=await consumeRateLimit(request,{scope:'skin-preview',limit:240,windowSeconds:60});
    if(!limit.allowed)return rateLimitResponse(limit,'Too many requests');
    const admin=createSupabaseAdminClient();
    const {data:member,error}=await admin.from('waitlist_applications').select('user_id').eq('login',login).eq('status','approved').eq('is_banned',false).eq('is_deleted',false).limit(1).maybeSingle();
    if(error)return new Response(null,{status:503});
    if(!member?.user_id)return new Response(null,{status:404});
    let url:string|null=null,initialized=false;
    try { const profile=await callModelService(login,{}, {timeoutMs:4000});url=activeHumanSkin(profile)?.skinUrl??null;initialized=Boolean(profile.wardrobe?.humanInitialized); } catch { /* Temporary fallback for existing account skins. */ }
    if(!initialized&&!url) {const {data}=await admin.auth.admin.getUserById(member.user_id);url=await createPlayerSkinSignedUrl(member.user_id,data.user?.user_metadata);}
    if(cached.size>=1000)cached.delete(cached.keys().next().value!);
    skin={expires:Date.now()+15000,url};cached.set(login,skin);
  }
  if(skin.url)return new Response(null,{status:307,headers:{...headers,Location:skin.url}});
  const png=await serverSharp(Buffer.from(blankHuman()),{raw:{width:64,height:64,channels:4}}).png().toBuffer();
  return new Response(new Uint8Array(png),{headers:{...headers,'Content-Type':'image/png'}});
}
