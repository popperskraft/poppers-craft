"use client";
import { useState } from 'react';
import type { Race } from '@/lib/character-models';
import { allVisible, togglePart, visibilityParts, type ModelLayer, type ModelVisibility as Visibility } from '@/lib/model-visibility';

export function ModelVisibility({kind,race,value,onChange,layer,onLayerChange}:{kind:'human'|'pony';race?:Race;value:Visibility;layer:ModelLayer;onLayerChange:(layer:ModelLayer)=>void;onChange:(value:Visibility)=>void}) {
  const [hover,setHover]=useState('');
  const parts=visibilityParts(kind,race),prefix=`${kind}-visibility`;
  const hiddenCount=parts.filter(p=>(layer==='base'||p.outer)&&value[layer].hidden.includes(p.id)).length;
  return <section className="model-visibility" aria-label={kind==='human'?'Видимость человека':'Видимость пони'}>
    <div className="visibility-heading"><h2>Видимость в 3D</h2><button onClick={()=>onChange(allVisible())}>Показать всё</button></div>
    <div className="visibility-layers">
      {(['base','outer'] as const).map(id=><label key={id} className="models-checkbox" data-visible={value[id].visible}>
        <input type="checkbox" checked={value[id].visible} onChange={e=>onChange({...value,[id]:{...value[id],visible:e.target.checked}})}/>{id==='base'?'Тело':'Внешний слой'}
      </label>)}
    </div>
    <div className="visibility-edit-layer">
        <label htmlFor={`${prefix}-layer`}>Слой рисования</label>
        <select id={`${prefix}-layer`} value={layer} onChange={e=>onLayerChange(e.target.value as ModelLayer)}><option value="base">Тело</option><option value="outer">Внешний слой</option></select>
    </div>
    <div className="visibility-content">
      <div className={`visibility-diagram visibility-${kind}`} role="group" aria-label={`Части ${layer==='base'?'тела':'внешнего слоя'}`} data-layer-visible={value[layer].visible}>
        {parts.map(p=><button key={p.id} className="visibility-part" disabled={layer==='outer'&&!p.outer}
          style={{left:`${p.x/2.4}%`,top:`${p.y/2.4}%`,width:`${p.w/2.4}%`,height:`${p.h/2.4}%`}}
          aria-label={p.label} aria-pressed={!value[layer].hidden.includes(p.id)} title={p.label+(layer==='outer'&&!p.outer?' — без внешнего слоя':'')}
          onMouseEnter={()=>setHover(p.label)} onMouseLeave={()=>setHover('')} onFocus={()=>setHover(p.label)} onBlur={()=>setHover('')}
          onClick={()=>onChange(togglePart(value,p.id,layer))}><span aria-hidden="true">{p.mark}</span></button>)}
      </div>
      <div className="visibility-options">

        <p>Нажимайте на части, чтобы скрыть или показать их.</p>
        <span className="visibility-current" aria-live="polite">{hover||(!value[layer].visible?'Этот слой скрыт':hiddenCount?'Скрыто частей: '+hiddenCount:'Все части видимы')}</span>
      </div>
    </div>
    <p className="visibility-note">{kind==='pony'&&layer==='outer'?'У шеи, хвоста, крыльев и рога нет отдельного внешнего слоя. ':''}Скрытие не меняет скин.</p>
  </section>;
}
