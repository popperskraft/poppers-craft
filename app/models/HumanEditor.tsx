"use client";
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { LoginModal } from '@/app/LoginModal';
import { decodePixels, encodePixels, type ModelProfile } from '@/lib/character-models';
import { paintTexture, type TextureTile } from '@/lib/pony-texture';
import { blankHuman, humanPixelAllowed, humanPNG, normalizeHumanSkin, readHumanPNG, type HumanModel, type HumanLayer } from '@/lib/human-skin';
import { HumanViewport } from './HumanViewport';
import { ModelVisibility } from './ModelVisibility';
import { allVisible } from '@/lib/model-visibility';
import { SkinCatalog } from './SkinCatalog';
import { SkinPalette, useSkinPalette } from './SkinPalette';
import { SkinCarousel } from './SkinCarousel';
import type { StudioProps } from './ModelStudio';
import './models.css';
type Snapshot={pixels:Uint8ClampedArray;model:HumanModel};
const DRAFT='popperscraft.human-draft.v1';
async function responseData(response:Response){try{return await response.json();}catch{throw new Error('Сервис сохранения временно недоступен. Рисунок остаётся в редакторе.');}}
export function HumanEditor({active,refresh,onSelect,onApplied,embedded=false,initialSlot,initialAdd=false}:StudioProps){
  const Container = embedded ? "section" : "main";
  const [slotReady,setSlotReady]=useState(false);
  const [pixels,setPixels]=useState<Uint8ClampedArray>(()=>blankHuman()),[model,setModel]=useState<HumanModel>('classic');
  const [layer,setLayer]=useState<HumanLayer>('base'),[visibility,setVisibility]=useState(allVisible);
  const [tool,setTool]=useState('paint'),[color,setColor]=useState('#ff4ead'),[brush,setBrush]=useState(1),[reset,setReset]=useState(0);
  const [dirty,setDirty]=useState(false),[busy,setBusy]=useState(false),[canSave,setCanSave]=useState(false),[error,setError]=useState(false),[loginRequired,setLoginRequired]=useState(false),[loginOpen,setLoginOpen]=useState(false),[conflict,setConflict]=useState(false);
  const [status,setStatus]=useState('Загружаем человеческий скин…'),[login,setLogin]=useState(''),[version,setVersion]=useState(0);
  const pixelsRef=useRef(pixels);pixelsRef.current=pixels;const dirtyRef=useRef(false);dirtyRef.current=dirty;
  const modelRef=useRef(model);modelRef.current=model;
  const [profile,setProfile]=useState<ModelProfile|null>(null),[slotId,setSlotId]=useState<string|null>(initialSlot??null);
  const selected=useRef<string|null|undefined>(initialAdd?null:initialSlot);
  const draftStored=useRef(false),stroke=useRef(false),upload=useRef<HTMLInputElement>(null);
  const undo=useRef<Snapshot[]>([]),redo=useRef<Snapshot[]>([]);
  const {recent,remember}=useSkinPalette();
  function commit(next:Uint8ClampedArray){pixelsRef.current=next;dirtyRef.current=true;draftStored.current=false;setPixels(next);setDirty(true);}
  function push(){undo.current.push({pixels:pixelsRef.current.slice(),model});if(undo.current.length>60)undo.current.shift();redo.current=[];setVersion(v=>v+1);}
  function restore(from:React.RefObject<Snapshot[]>,to:React.RefObject<Snapshot[]>){const value=from.current.pop();if(!value)return;to.current.push({pixels:pixelsRef.current.slice(),model});setModel(value.model);commit(value.pixels);setVersion(v=>v+1);}
  async function load(replace=false, requested=selected.current){
    setSlotReady(false);setBusy(true);setError(false);
    try{
      const response=await fetch('/api/profile/models',{cache:'no-store'}),data=await responseData(response) as ModelProfile & {error?:string;loginRequired?:boolean};
      if(!response.ok){setLoginRequired(Boolean(data.loginRequired));throw new Error(data.error||'Не удалось загрузить скин.');}
      setProfile(data);setCanSave(Boolean(data.wardrobe.humanInitialized));setLoginRequired(false);setLogin(data.login||'');setConflict(false);
      if(!data.wardrobe.humanInitialized){setStatus('Не удалось загрузить сохранённые скины. Попробуйте ещё раз.');setError(true);return;}
      if(replace||!dirtyRef.current){
        const nextId=requested===undefined?data.wardrobe.activeHumanId:requested;
        const entry=data.wardrobe.human.find(item=>item.id===nextId);
        let next=blankHuman(),nextModel:HumanModel='classic';
        if(entry){
          const detailResponse=await fetch('/api/profile/models?kind=human&slotId='+encodeURIComponent(entry.id),{cache:'no-store'}),detail=await responseData(detailResponse);
          if(!detailResponse.ok)throw new Error(detail.error||'Не удалось загрузить скин.');
          nextModel=entry.model==='slim'?'slim':'classic';
          if(detail.slot?.pixelsBase64)next=decodePixels(detail.slot.pixelsBase64);
          else {const imageResponse=await fetch(entry.skinUrl,{cache:'no-store'});if(!imageResponse.ok)throw new Error('Не удалось загрузить скин.');const image=await readHumanPNG(await imageResponse.blob(),nextModel);next=image.pixels;nextModel=image.model;}
        }
        selected.current=entry?.id??null;setSlotId(selected.current);pixelsRef.current=next;setPixels(next);setModel(nextModel);modelRef.current=nextModel;dirtyRef.current=false;setDirty(false);undo.current=[];redo.current=[];
      }
      setSlotReady(true);setStatus('Выберите сохранённый скин или добавьте новый в свободное место.');
    }catch(e){setStatus(e instanceof Error?e.message:'Не удалось загрузить скин.');setError(true);}finally{setBusy(false);}
  }
  function choose(id:string|null){if(dirtyRef.current){setStatus('Сохраните или сбросьте изменения перед выбором другого скина.');setError(true);return;}void load(true,id);}
  function discard(){try{sessionStorage.removeItem(DRAFT);}catch{}void load(true);}
  async function wardrobeAction(operation:'select'|'delete'){
    if(!profile||!slotId)return;setBusy(true);setError(false);
    try{const response=await fetch('/api/profile/models',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'wardrobe',operation,kind:'human',slotId,revision:profile.revision})}),data=await responseData(response);if(!response.ok){if(response.status===409)setConflict(true);throw new Error(data.error||'Не удалось изменить список скинов.');}setProfile(data);onApplied();if(operation==='delete'){try{sessionStorage.removeItem(DRAFT);}catch{}selected.current=undefined;await load(true);}setStatus(operation==='delete'?'Скин удалён из аккаунта.':'Скин выбран. Внешность обновится в игре в течение нескольких секунд.');}
    catch(e){setStatus(e instanceof Error?e.message:'Не удалось изменить список скинов.');setError(true);}finally{setBusy(false);}
  }
  useEffect(()=>{
    try{const draft=JSON.parse(sessionStorage.getItem(DRAFT)||'null');if(draft&&(draft.model==='classic'||draft.model==='slim')){if(initialSlot?draft.slotId===initialSlot:initialAdd?draft.slotId==null:true){selected.current=draft.slotId??null;setSlotId(selected.current??null);commit(decodePixels(draft.pixels));setModel(draft.model);}}}catch{/* Storage is optional. */}
    void load();
  },[]);
  useEffect(()=>{if(active&&refresh>0)void load();},[active,refresh]);
  useEffect(()=>{if(dirty)try{sessionStorage.setItem(DRAFT,JSON.stringify({slotId:selected.current,model,pixels:encodePixels(pixels)}));draftStored.current=true;}catch{draftStored.current=false;}},[dirty,model,pixels]);
  useEffect(()=>{const warn=(e:BeforeUnloadEvent)=>{if(dirtyRef.current&&!draftStored.current){e.preventDefault();e.returnValue='';}};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[]);
  useEffect(()=>{if(!active)return;const key=(e:KeyboardEvent)=>{if(e.defaultPrevented||(embedded&&!(e.target as HTMLElement).closest('.models-page'))||(e.target as HTMLElement).matches('input,textarea,select'))return;if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();e.shiftKey?restore(redo,undo):restore(undo,redo);}};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);});
  function start(){if(!stroke.current){push();stroke.current=true;}}
  function paint(x:number,y:number,bounds?:TextureTile){
    if(!humanPixelAllowed(model,layer,x,y))return;
    const source=pixelsRef.current;
    const rgb=parseInt(color.slice(1),16),rgba=tool==='erase'?(layer==='outer'?[0,0,0,0]:[239,239,239,255]):[rgb>>16,(rgb>>8)&255,rgb&255,255];
    const next=paintTexture(source,x,y,rgba,brush,tool==='fill',bounds,false);if(next!==source){commit(next);if(tool!=='erase')remember(color);}
  }
  function changeModel(next:HumanModel){push();setModel(next);commit(normalizeHumanSkin(pixelsRef.current,next));}
  function clean(){push();commit(blankHuman(model));setStatus('Белая основа открыта. Предыдущий рисунок можно вернуть кнопкой «Отменить».');setError(false);}
  async function importSkin(file?:File){
    if(!file)return;
    try{const decoded=await readHumanPNG(file,model);push();setModel(decoded.model);commit(decoded.pixels);setStatus('Скин открыт. Проверьте модель рук: обычные или узкие. Изменения ещё не применены в игре.');setError(false);}
    catch(e){setStatus(e instanceof Error?e.message:'Не удалось открыть PNG.');setError(true);}finally{if(upload.current)upload.current.value='';}
  }
  async function download(){try{const blob=await humanPNG(pixelsRef.current,model),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='popperscraft-human.png';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){setStatus(e instanceof Error?e.message:'Не удалось скачать PNG.');setError(true);}}
  async function save(){
    if(!canSave){setLoginOpen(true);return;}
    if(!profile)return;
    setBusy(true);setError(false);const snapshot={pixels:pixelsRef.current,model};
    try{
      const response=await fetch('/api/profile/models',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'wardrobe',operation:'save',kind:'human',slotId:slotId??undefined,model:snapshot.model,revision:profile.revision,pixelsBase64:encodePixels(normalizeHumanSkin(snapshot.pixels,snapshot.model))})}),data=await responseData(response);
      if(!response.ok){if(response.status===409)setConflict(true);throw new Error(data.error||'Не удалось сохранить скин.');}
      setProfile(data);selected.current=data.wardrobe.activeHumanId;setSlotId(data.wardrobe.activeHumanId);
      if(snapshot.pixels===pixelsRef.current&&snapshot.model===modelRef.current){dirtyRef.current=false;setDirty(false);try{sessionStorage.removeItem(DRAFT);}catch{}}
      setConflict(false);onApplied();setStatus('Скин сохранён в аккаунте. Внешность обновится в игре в течение нескольких секунд.'+(dirtyRef.current?' Новые штрихи ещё не сохранены.':''));
    }catch(e){setStatus(e instanceof Error?e.message:'Не удалось сохранить скин.');setError(true);}finally{setBusy(false);}
  }

  return <Container className="models-page human-editor">
    {!embedded ? <header className="models-header"><Link href="/profile?edit=1#plus-models" className="models-back">← К профилю</Link><div><span>POPPERSCRAFT</span><h1>Модели персонажей</h1></div><span className="models-account">{login?'@'+login:'Студия скинов'}</span></header> : null}
    <div className="models-top"><div className="models-bar"><div className="model-choice" role="group" aria-label="Выбор редактора"><button aria-pressed={true}>Человек</button><button disabled={busy} aria-pressed={false} onClick={()=>onSelect('pony')}>Пони</button></div><p>Редактор человека. Нарисуйте свой скин или откройте готовый PNG.</p></div><SkinCatalog kind="human" onImport={()=>upload.current?.click()}/></div>
    <SkinCarousel kind="human" wardrobe={profile?.wardrobe.humanInitialized?profile.wardrobe:undefined} equipped={profile?.mode==='human'} selectedId={slotId} busy={busy} dirty={dirty} onChoose={choose} onApply={()=>void wardrobeAction('select')} onDelete={()=>void wardrobeAction('delete')} onUpload={()=>upload.current?.click()} onDiscard={discard}/>
    <div className="models-workspace" inert={busy}>
      <aside className="models-settings human-settings">
        <div className="models-options"><div className="models-field"><label htmlFor="human-model">Модель рук</label><select id="human-model" value={model} onChange={e=>changeModel(e.target.value as HumanModel)}><option value="classic">Обычные · 4 px</option><option value="slim">Узкие · 3 px</option></select></div></div>
        <span className="models-label">Инструменты</span><div className="models-tools" role="group" aria-label="Инструменты рисования">{[['paint','✎','Кисть'],['fill','▧','Заливка'],['erase','□','Ластик']].map(([k,icon,label])=><button key={k} aria-pressed={tool===k} onClick={()=>setTool(k)}><b aria-hidden="true">{icon}</b>{label}</button>)}</div>
        <label htmlFor="human-color">Цвет кисти</label><div className="models-color"><input id="human-color" type="color" value={color} onChange={e=>{setColor(e.target.value);setTool('paint');}}/><code>{color.toUpperCase()}</code></div>
        <SkinPalette color={color} recent={recent} onSelect={value=>{setColor(value);setTool("paint");}}/>
        <label htmlFor="human-brush">Размер кисти: {brush} px</label><input id="human-brush" type="range" min="1" max="4" value={brush} onChange={e=>setBrush(Number(e.target.value))}/>
        <div className="models-history" data-version={version}><button disabled={!undo.current.length} onClick={()=>restore(undo,redo)}>Отменить</button><button disabled={!redo.current.length} onClick={()=>restore(redo,undo)}>Вернуть</button></div>
      </aside>
      <section className="models-stage" aria-label="Предпросмотр человека"><div className="stage-top"><span>Человек / {model==='slim'?'Узкие руки':'Обычные руки'}</span><button onClick={()=>setReset(v=>v+1)}>Сбросить ракурс</button></div><HumanViewport pixels={pixels} model={model} layer={layer} visibility={visibility} tool={tool} reset={reset} onPaint={paint} onStart={start} onEnd={()=>{stroke.current=false;}}/><div className="stage-bottom"><span>{layer==='base'?'Основной слой':'Внешний слой · одежда и детали'}</span><span>{dirty?'Есть несохранённые изменения':'64 × 64'}</span></div></section>
      <aside className="models-details"><ModelVisibility kind="human" value={visibility} onChange={setVisibility} layer={layer} onLayerChange={setLayer}/>
        <div className="models-files"><button onClick={()=>upload.current?.click()}>Загрузить скин</button><button onClick={()=>void download()}>Скачать PNG</button><button className="models-clean" onClick={clean}>Чистая основа</button></div>
        <input hidden ref={upload} type="file" accept="image/png,.png" onChange={e=>void importSkin(e.target.files?.[0])}/>
        <small className="models-credits"><a href="/models/NOTICE.txt" target="_blank" rel="noreferrer">Авторы и лицензии</a></small>
      </aside>
    </div>

    <footer className="models-footer"><div role="status" aria-live="polite" className={error?'models-error':''}>{status}{!slotReady&&!loginRequired?<button disabled={busy} onClick={()=>void load()}>Повторить загрузку скинов</button>:null}{conflict?<button onClick={()=>void load()}>Обновить версию, сохранив рисунок</button>:null}{loginRequired?<button onClick={()=>setLoginOpen(true)}>Войти в аккаунт</button>:null}</div><button className="models-save" disabled={busy||conflict||(!slotReady&&!loginRequired)||(!slotId&&profile?.wardrobe.human.length===5)||(!canSave&&!loginRequired)} onClick={()=>void save()}>{busy?'Подождите…':'Сохранить и применить'}</button></footer>
    <LoginModal open={loginOpen} onClose={()=>setLoginOpen(false)} successRedirect={embedded ? "/plus#plus-models" : "/models?editor=human"}/>
  </Container>;
}
