import { NextResponse } from 'next/server';
import { getCommunityViewer } from '@/lib/community';
import { validatePlayerSkin, getPlayerSkinPath, getPlayerSkinModel, PLAYER_SKINS_BUCKET } from '@/lib/player-skins';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { consumeRateLimit, rateLimitResponse } from '@/lib/request-security';
import { getViewerIdentity, sameOriginOrMissing } from '@/lib/waitlist';
import { ModelServiceError, callModelService } from '@/lib/model-service';
import { activeHumanSkin, downloadWardrobeSkin, saveHumanWardrobe } from '@/lib/skin-wardrobe';
export const dynamic='force-dynamic';
export const runtime='nodejs';
const NO_STORE={'Cache-Control':'private, no-store'};
const reply=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:NO_STORE});
async function viewer(){const identity=await getViewerIdentity();return identity&&!identity.needsMfa?getCommunityViewer({identity,allowAuthenticated:true}):null;}

export async function GET(){
  try{
    const owner=await viewer();if(!owner)return reply({error:'Войдите в аккаунт PoppersCraft.',loginRequired:true},401);
    const metadata=owner.user.user_metadata,path=getPlayerSkinPath(owner.user.id,metadata);
    const profile=await callModelService(owner.profile.login),active=activeHumanSkin(profile);
    let skinBase64:string|null=null;
    if(active)skinBase64=Buffer.from(await downloadWardrobeSkin(active.skinUrl)).toString('base64');
    else if(!profile.wardrobe?.humanInitialized&&path){
      const {data,error}=await createSupabaseAdminClient().storage.from(PLAYER_SKINS_BUCKET).download(path);
      if(error||!data)throw new Error('Skin unavailable');
      const bytes=new Uint8Array(await data.arrayBuffer());validatePlayerSkin(bytes);skinBase64=Buffer.from(bytes).toString('base64');
    }
    return reply({skinBase64,model:active?.model??(profile.wardrobe?.humanInitialized?'classic':getPlayerSkinModel(metadata)),updatedAt:String(profile.revision),login:owner.profile?.login||''});
  }catch{return reply({error:'Не удалось загрузить скин. Вы можете рисовать и скачать готовый PNG.'},503);}
}
export async function POST(request:Request){
  try{
    if(!sameOriginOrMissing(request))return reply({error:'Недопустимый запрос.'},403);
    const owner=await viewer();if(!owner)return reply({error:'Войдите в аккаунт PoppersCraft.',loginRequired:true},401);
    const limit=await consumeRateLimit(request,{scope:'profile-skin',key:owner.user.id,limit:12,windowSeconds:3600});
    if(!limit.allowed)return rateLimitResponse(limit,'Слишком много смен скина. Попробуйте позже.');
    const reader=request.body?.getReader(),chunks:Uint8Array<ArrayBuffer>[]=[];let size=0;
    if(reader)while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>300*1024){await reader.cancel();return reply({error:'Скин слишком большой.'},413);}chunks.push(new Uint8Array(value));}
    const form=await new Request(request.url,{method:'POST',headers:request.headers,body:new Blob(chunks)}).formData().catch(()=>null);
    const file=form?.get('skin'),model=form?.get('model'),expected=form?.get('expectedUpdatedAt');
    if(!(file instanceof File))return reply({error:'Выберите PNG-файл со скином.'},400);
    if(model!==null&&model!=='classic'&&model!=='slim')return reply({error:'Выберите обычные или узкие руки.'},400);

    const bytes=new Uint8Array(await file.arrayBuffer());
    try{
      validatePlayerSkin(bytes);
      const profile=await callModelService(owner.profile.login);
      if(expected!==null&&expected!==String(profile.revision))return reply({error:'Скин уже изменён в другом окне или лаунчере. Обновите версию перед сохранением.'},409);
      const updated=await saveHumanWardrobe(owner.profile.login,bytes,model==='slim'?'slim':model==='classic'?'classic':activeHumanSkin(profile)?.model??getPlayerSkinModel(owner.user.user_metadata),profile,form?.get('source')!=='editor');
      return reply({ok:true,model:activeHumanSkin(updated)?.model??'classic',updatedAt:String(updated.revision)});
    }catch(error){
      if(error instanceof ModelServiceError)return reply({error:error.message},error.status);
      const message=error instanceof Error&&/^(Скин|Размер|Загрузите)/.test(error.message)?error.message:'Не удалось сохранить скин.';
      return reply({error:message},400);
    }
  }catch{return reply({error:'Сохранение временно недоступно. Рисунок остаётся в редакторе.'},503);}
}
