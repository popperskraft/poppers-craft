"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { LoginModal } from "@/app/LoginModal";
import { blankPony, decodePixels, encodePixels, isControlPixel, RACES, SIZES, setMetadata, type ModelProfile, type Race, type PonySize, TAIL_LENGTHS, SNOUTS, readAppearance, normalizeTemplate, type TailLength, type Snout } from "@/lib/character-models";
import { paintTexture, type TextureTile } from "@/lib/pony-texture";
import { expandLegacyPony } from "@/lib/pony-template";
import { PonyViewport } from "./PonyViewport";
import { ModelVisibility } from "./ModelVisibility";
import { allVisible, type ModelLayer } from "@/lib/model-visibility";
import "./models.css";
import { SkinCatalog } from "./SkinCatalog";
import { SkinPalette, useSkinPalette } from './SkinPalette';
import { SkinCarousel } from "./SkinCarousel";
import type { StudioProps } from "./ModelStudio";

type Snapshot = { pixels: Uint8ClampedArray; race: Race; size: PonySize; tailLength: TailLength; snout: Snout };
const DRAFT_KEY="popperscraft.pony-draft.v1";
async function responseData(response:Response){
  try{return await response.json();}catch{throw new Error("Сервис сохранения временно недоступен. Рисунок остаётся в редакторе.");}
}
export function ModelEditor({active,refresh,onSelect,onApplied,embedded=false,initialSlot,initialAdd=false}:StudioProps) {
  const Container = embedded ? "section" : "main";
  const [slotReady,setSlotReady]=useState(false);
  const [pixels,setPixels]=useState(blankPony);const pixelsRef=useRef(pixels);pixelsRef.current=pixels;
  const [race,setRace]=useState<Race>("earth"),[size,setSize]=useState<PonySize>("normal");
  const [tailLength,setTailLength]=useState<TailLength>("full"),[snout,setSnout]=useState<Snout>("rounded");
  const [visibility,setVisibility]=useState(allVisible),[paintLayer,setPaintLayer]=useState<ModelLayer>("base");
  const [tool,setTool]=useState("paint"),[color,setColor]=useState("#ff4ead"),[brush,setBrush]=useState(1);
  const [profile,setProfile]=useState<ModelProfile|null>(null),[busy,setBusy]=useState(false),[dirty,setDirty]=useState(false);
  const dirtyRef=useRef(false);dirtyRef.current=dirty;
  const draftStored=useRef(false);
  const [slotId,setSlotId]=useState<string|null>(initialSlot??null),selected=useRef<string|null|undefined>(initialAdd?null:initialSlot);
  const [status,setStatus]=useState("Загружаем сохранённый образ…"),[error,setError]=useState(false);
  const [loginRequired,setLoginRequired]=useState(false),[loginOpen,setLoginOpen]=useState(false);
  const [reset,setReset]=useState(0),[historyVersion,setHistoryVersion]=useState(0);
  const undo=useRef<Snapshot[]>([]),redo=useRef<Snapshot[]>([]),stroke=useRef(false);
  const upload=useRef<HTMLInputElement>(null);
  const [conflict,setConflict]=useState(false);
  const {recent,remember}=useSkinPalette();
  function push(){undo.current.push({pixels:pixelsRef.current.slice(),race,size,tailLength,snout});if(undo.current.length>60)undo.current.shift();redo.current=[];setHistoryVersion(v=>v+1);}
  function commit(next:Uint8ClampedArray){pixelsRef.current=next;dirtyRef.current=true;draftStored.current=false;setPixels(next);setDirty(true);}
  function restore(from:React.RefObject<Snapshot[]>,to:React.RefObject<Snapshot[]>){
    const value=from.current.pop();if(!value)return;to.current.push({pixels:pixelsRef.current.slice(),race,size,tailLength,snout});
    setRace(value.race);setSize(value.size);setTailLength(value.tailLength);setSnout(value.snout);commit(value.pixels);setHistoryVersion(v=>v+1);
  }
  async function load(replace=false, requested=selected.current){
    setSlotReady(false);setBusy(true);setError(false);
    try{
      const response=await fetch("/api/profile/models",{cache:"no-store"});const data=await responseData(response) as ModelProfile & {error?:string;loginRequired?:boolean};
      if(!response.ok){setLoginRequired(Boolean(data.loginRequired));throw new Error(data.error||"Не удалось загрузить образ.");}
      setProfile(data);setLoginRequired(false);setConflict(false);
      if(replace||!dirtyRef.current){
        const nextId=requested===undefined?data.wardrobe.activePonyId:requested,entry=data.wardrobe.pony.find(item=>item.id===nextId);
        let next=blankPony();
        if(entry){const detailResponse=await fetch('/api/profile/models?kind=pony&slotId='+encodeURIComponent(entry.id),{cache:'no-store'}),detail=await responseData(detailResponse);if(!detailResponse.ok)throw new Error(detail.error||'Не удалось загрузить скин.');next=await normalizeTemplate(decodePixels(detail.slot.pixelsBase64));}
        const appearance=readAppearance(next);selected.current=entry?.id??null;setSlotId(selected.current);pixelsRef.current=next;setPixels(next);setRace(entry?.race??'earth');setSize(entry?.size??'normal');setTailLength(appearance.tailLength);setSnout(appearance.snout);dirtyRef.current=false;setDirty(false);undo.current=[];redo.current=[];
      }
      setSlotReady(true);setStatus('Выберите сохранённый скин или добавьте новый в свободное место.');
    }catch(e){setStatus(e instanceof Error?e.message:"Не удалось загрузить образ.");setError(true);}
    finally{setBusy(false);}
  }
  function choose(id:string|null){if(dirtyRef.current){setStatus('Сохраните или сбросьте изменения перед выбором другого скина.');setError(true);return;}void load(true,id);}
  function discard(){try{sessionStorage.removeItem(DRAFT_KEY);}catch{}void load(true);}
  async function wardrobeAction(operation:'select'|'delete'){
    if(!profile||!slotId)return;setBusy(true);setError(false);
    try{const response=await fetch('/api/profile/models',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'wardrobe',operation,kind:'pony',slotId,revision:profile.revision})}),data=await responseData(response);if(!response.ok){if(response.status===409)setConflict(true);throw new Error(data.error||'Не удалось изменить список скинов.');}setProfile(data);onApplied();if(operation==='delete'){try{sessionStorage.removeItem(DRAFT_KEY);}catch{}selected.current=undefined;await load(true);}setStatus(operation==='delete'?'Скин удалён из аккаунта.':'Скин выбран. Внешность обновится в игре в течение нескольких секунд.');}
    catch(e){setStatus(e instanceof Error?e.message:'Не удалось изменить список скинов.');setError(true);}finally{setBusy(false);}
  }
  useEffect(()=>{
    let cancelled=false;
    void (async()=>{
      try{
        const draft=JSON.parse(sessionStorage.getItem(DRAFT_KEY)||"null");
        if(draft&&(initialSlot?draft.slotId===initialSlot:initialAdd?draft.slotId==null:true)&&Object.hasOwn(RACES,draft.race)&&Object.hasOwn(SIZES,draft.size)){
          const next=await normalizeTemplate(decodePixels(draft.pixels));const appearance=readAppearance(next);
          if(!cancelled&&!dirtyRef.current){selected.current=draft.slotId??null;setSlotId(selected.current??null);commit(setMetadata(next,draft.race,draft.size,appearance.tailLength,appearance.snout));setRace(draft.race);setSize(draft.size);setTailLength(appearance.tailLength);setSnout(appearance.snout);}
        }
      }catch{ /* Invalid browser storage must not block the editor. */ }
      if(!cancelled)void load();
    })();
    return()=>{cancelled=true;};
  },[]);
  useEffect(()=>{
    if(!dirty)return;
    try{sessionStorage.setItem(DRAFT_KEY,JSON.stringify({slotId:selected.current,race,size,tailLength,snout,pixels:encodePixels(pixels)}));draftStored.current=true;}catch{draftStored.current=false;}
  },[dirty,pixels,race,size,tailLength,snout]);
  useEffect(()=>{const warn=(e:BeforeUnloadEvent)=>{if(dirtyRef.current&&!draftStored.current){e.preventDefault();e.returnValue="";}};window.addEventListener("beforeunload",warn);return()=>window.removeEventListener("beforeunload",warn);},[]);
  useEffect(()=>{
    if(!active)return;
    const key=(e:KeyboardEvent)=>{if(e.defaultPrevented||(embedded&&!(e.target as HTMLElement).closest('.models-page'))||(e.target as HTMLElement).matches("input,textarea,select"))return;
      if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="z"){e.preventDefault();e.shiftKey?restore(redo,undo):restore(undo,redo);}
    };window.addEventListener("keydown",key);return()=>window.removeEventListener("keydown",key);
  });
  useEffect(()=>{if(active&&refresh>0)void load();},[active,refresh]);
  function start(){if(!stroke.current){push();stroke.current=true;}}
  function paint(x:number,y:number,bounds?:TextureTile){
    if(isControlPixel(x,y))return;
    const source=pixelsRef.current;
    const value=parseInt(color.slice(1),16);const rgba=[value>>16,(value>>8)&255,value&255,tool==="erase"?0:255];
    const next=paintTexture(source,x,y,rgba,brush,tool==="fill",bounds);
    if(next!==source){commit(next);if(tool!=='erase')remember(color);}
  }
  function end(){stroke.current=false;}
  function changeRace(next:Race){push();setRace(next);commit(setMetadata(pixelsRef.current.slice(),next,size,tailLength,snout));}
  function changeSize(next:PonySize){push();setSize(next);commit(setMetadata(pixelsRef.current.slice(),race,next,tailLength,snout));}
  function changeTail(next:TailLength){push();setTailLength(next);commit(setMetadata(pixelsRef.current.slice(),race,size,next,snout));}
  function changeSnout(next:Snout){push();setSnout(next);commit(setMetadata(pixelsRef.current.slice(),race,size,tailLength,next));}
  function resetTemplate(){push();commit(setMetadata(blankPony(),race,size,tailLength,snout));setStatus("Чёрно-белая основа открыта. Предыдущий рисунок можно вернуть кнопкой «Отменить».");setError(false);}
  function download(){
    const canvas=document.createElement("canvas");canvas.width=canvas.height=64;
    canvas.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(setMetadata(pixelsRef.current.slice(),race,size,tailLength,snout)),64,64),0,0);
    const a=document.createElement("a");a.href=canvas.toDataURL("image/png");a.download="popperscraft-pony.png";a.click();
  }
  async function importSkin(file?:File){
    if(!file)return;
    if(file.size>256*1024){setStatus("PNG должен быть не больше 256 КБ.");setError(true);return;}
    try{
      const image=await createImageBitmap(file);
      if(image.width!==64||(image.height!==64&&image.height!==32)){image.close();throw new Error("Выберите пони-скин PNG 64×64 или 64×32.");}
      const canvas=document.createElement("canvas");canvas.width=64;canvas.height=image.height;const ctx=canvas.getContext("2d")!;ctx.drawImage(image,0,0);image.close();
      const raw=ctx.getImageData(0,0,64,canvas.height).data;
      const data=await normalizeTemplate(canvas.height===32?expandLegacyPony(raw):raw);
      const pixel=(x:number)=>(data[x*4]<<16)|(data[x*4+1]<<8)|data[x*4+2];
      const r=(Object.keys(RACES) as Race[]).find(k=>RACES[k].color===pixel(0))??race;
      const s=(Object.keys(SIZES) as PonySize[]).find(k=>SIZES[k].color===pixel(3))??size;
      const appearance=readAppearance(data);push();setRace(r);setSize(s);setTailLength(appearance.tailLength);setSnout(appearance.snout);commit(setMetadata(data,r,s,appearance.tailLength,appearance.snout));setStatus("Скин открыт. Изменения ещё не применены в игре.");setError(false);
    }catch(e){setStatus(e instanceof Error?e.message:"Не удалось открыть PNG.");setError(true);}
    if(upload.current)upload.current.value="";
  }
  async function save(mode:"human"|"pony"){
    if(!profile){setLoginOpen(true);return;}
    setBusy(true);setError(false);
    const savedPixels=pixelsRef.current;
    try{
      const data=mode==="pony"?{action:"wardrobe",operation:"save",kind:"pony",slotId:slotId??undefined,race,size,tailLength,snout,revision:profile.revision,pixelsBase64:encodePixels(setMetadata(pixelsRef.current.slice(),race,size,tailLength,snout))}:{mode,revision:profile.revision};
      const response=await fetch("/api/profile/models",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(data)});
      const result=await responseData(response);if(!response.ok){if(response.status===409)setConflict(true);throw new Error(result.error||"Не удалось сохранить образ.");}
      setProfile(result);selected.current=result.wardrobe.activePonyId;setSlotId(result.wardrobe.activePonyId);setConflict(false);onApplied();
      if(mode==="pony"&&savedPixels===pixelsRef.current){dirtyRef.current=false;setDirty(false);try{sessionStorage.removeItem(DRAFT_KEY);}catch{}}
      setStatus(mode==="pony"?(savedPixels===pixelsRef.current?"Пони сохранён. Внешность обновится в игре в течение нескольких секунд.":"Образ сохранён. Новые штрихи ещё не применены — сохраните их отдельно."):"Выбран человек. Пони-образ сохранён отдельно.");
    }catch(e){setStatus(e instanceof Error?e.message:"Не удалось сохранить.");setError(true);}finally{setBusy(false);}
  }
  return <Container className="models-page">
    {!embedded ? <header className="models-header"><Link href="/profile?edit=1#plus-models" className="models-back">← К профилю</Link><div><span>POPPERSCRAFT</span><h1>Модели персонажей</h1></div><span className="models-account">{profile?"@"+profile.login:"Студия пони"}</span></header> : null}
    <div className="models-top"><div className="models-bar"><div className="model-choice" role="group" aria-label="Выбор редактора"><button disabled={busy} onClick={()=>onSelect("human")} aria-pressed={false}>Человек</button><button aria-pressed={true}>Пони</button></div><p>Редактор пони. Внешность меняется, способности остаются прежними.</p></div><SkinCatalog kind="pony" onImport={()=>upload.current?.click()}/></div>
    <SkinCarousel kind="pony" wardrobe={profile?.wardrobe} equipped={profile?.mode==='pony'} selectedId={slotId} busy={busy} dirty={dirty} onChoose={choose} onApply={()=>void wardrobeAction('select')} onDelete={()=>void wardrobeAction('delete')} onUpload={()=>upload.current?.click()} onDiscard={discard}/>
    <div className="models-workspace" inert={busy}>
      <aside className="models-settings">
        <div className="models-options"><div className="models-field"><label htmlFor="pony-race">Раса</label><select id="pony-race" value={race} onChange={e=>changeRace(e.target.value as Race)}>{Object.entries(RACES).map(([k,v])=><option key={k} value={k}>{v.label}</option>)}</select></div><div className="models-field"><label htmlFor="pony-size">Размер</label><select id="pony-size" value={size} onChange={e=>changeSize(e.target.value as PonySize)}>{Object.entries(SIZES).map(([k,v])=><option key={k} value={k}>{v.label}</option>)}</select></div><div className="models-field"><label htmlFor="pony-tail">Длина хвоста</label><select id="pony-tail" value={tailLength} onChange={e=>changeTail(e.target.value as TailLength)}>{Object.entries(TAIL_LENGTHS).map(([k,v])=><option key={k} value={k}>{v.label}</option>)}</select></div><div className="models-field"><label htmlFor="pony-snout">Форма мордочки</label><select id="pony-snout" value={snout} onChange={e=>changeSnout(e.target.value as Snout)}>{Object.entries(SNOUTS).map(([k,v])=><option key={k} value={k}>{v.label}</option>)}</select></div></div>
        <span className="models-label">Инструменты</span><div className="models-tools" role="group" aria-label="Инструменты рисования">{[["paint","✎","Кисть"],["fill","▧","Заливка"],["erase","□","Ластик"]].map(([k,icon,label])=><button key={k} aria-pressed={tool===k} onClick={()=>setTool(k)}><b aria-hidden="true">{icon}</b>{label}</button>)}</div>
        <label htmlFor="pony-color">Цвет кисти</label><div className="models-color"><input id="pony-color" type="color" value={color} onChange={e=>{setColor(e.target.value);setTool("paint");}}/><code>{color.toUpperCase()}</code></div>
        <SkinPalette color={color} recent={recent} onSelect={value=>{setColor(value);setTool("paint");}}/>
        <label htmlFor="pony-brush">Размер кисти: {brush} px</label><input id="pony-brush" type="range" min="1" max="4" step="1" value={brush} onChange={e=>setBrush(Number(e.target.value))}/>
        <div className="models-history" data-version={historyVersion}><button disabled={!undo.current.length} onClick={()=>restore(undo,redo)}>Отменить</button><button disabled={!redo.current.length} onClick={()=>restore(redo,undo)}>Вернуть</button></div>
      </aside>
      <section className="models-stage" aria-label="Предпросмотр пони"><div className="stage-top"><span>{RACES[race].label} / {SIZES[size].label}</span><button onClick={()=>setReset(v=>v+1)}>Сбросить ракурс</button></div><PonyViewport visibility={visibility} layer={paintLayer} pixels={pixels} race={race} size={size} tailLength={tailLength} snout={snout} tool={tool} onPaint={paint} onStart={start} onEnd={end} reset={reset}/><div className="stage-bottom"><span>Рисунок сразу виден на модели</span><span>{dirty?"Есть несохранённые изменения":"64 × 64"}</span></div></section>
      <aside className="models-details"><ModelVisibility kind="pony" race={race} value={visibility} onChange={setVisibility} layer={paintLayer} onLayerChange={setPaintLayer}/>
        <div className="models-files"><button onClick={()=>upload.current?.click()}>Загрузить скин</button><button onClick={()=>void download()}>Скачать PNG</button><button className="models-clean" onClick={resetTemplate}>Чистая основа</button></div>
        <input hidden ref={upload} type="file" accept="image/png,.png" onChange={e=>void importSkin(e.target.files?.[0])}/>
        <small className="models-credits">Основа и шрифт — <a href="http://ponyskincraft.com/skin.php?action=edit" target="_blank" rel="noreferrer">PonySkincraft</a> · <a href="/models/NOTICE.txt" target="_blank" rel="noreferrer">Авторы и лицензии</a></small>
      </aside>
    </div>

    <footer className="models-footer"><div role="status" aria-live="polite" className={error?"models-error":""}>{status}{!slotReady&&!loginRequired?<button disabled={busy} onClick={()=>void load()}>Повторить загрузку скинов</button>:null}{conflict?<button onClick={()=>load(false)}>Обновить версию, сохранив рисунок</button>:null}{loginRequired?<button onClick={()=>setLoginOpen(true)}>Войти в аккаунт</button>:null}</div><button className="models-save" disabled={profile?.wardrobe.limit===1||busy||conflict||(!slotReady&&!loginRequired)||(!slotId&&profile?.wardrobe.pony.length===5)||(!profile&&!loginRequired)} onClick={()=>save("pony")}>{busy?"Подождите…":"Сохранить и применить"}</button></footer>
    <LoginModal open={loginOpen} onClose={()=>setLoginOpen(false)} successRedirect={embedded ? "/plus#plus-models" : "/models"}/>
  </Container>;
}
