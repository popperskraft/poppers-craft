"use client";
import { useState } from 'react';
import { ModelEditor } from './ModelEditor';
import { HumanEditor } from './HumanEditor';
export type EditorKind='pony'|'human';
export type StudioProps={active:boolean;refresh:number;onSelect:(kind:EditorKind)=>void;onApplied:()=>void;embedded?:boolean;initialSlot?:string;initialAdd?:boolean};
export function ModelStudio({initialEditor='pony',initialSlot,initialAdd=false,embedded=false,active=true}:{initialEditor?:EditorKind;initialSlot?:string;initialAdd?:boolean;embedded?:boolean;active?:boolean}){
  const [kind,setKind]=useState<EditorKind>(initialEditor),[visited,setVisited]=useState({pony:initialEditor==='pony',human:initialEditor==='human'}),[refresh,setRefresh]=useState({pony:0,human:0});
  function select(next:EditorKind){setKind(next);setVisited(v=>({...v,[next]:true}));if(!embedded)window.history.replaceState(null,'',next==='human'?'/models?editor=human':'/models');}
  const props=(editor:EditorKind)=>({embedded,initialSlot:editor===initialEditor?initialSlot:undefined,initialAdd:editor===initialEditor&&initialAdd,refresh:refresh[editor],onSelect:select,onApplied:()=>setRefresh(v=>({...v,[editor==='pony'?'human':'pony']:v[editor==='pony'?'human':'pony']+1}))});
  return <>{visited.pony?<div hidden={kind!=='pony'}><ModelEditor active={active&&kind==='pony'} {...props('pony')}/></div>:null}{visited.human?<div hidden={kind!=='human'}><HumanEditor active={active&&kind==='human'} {...props('human')}/></div>:null}</>;
}
