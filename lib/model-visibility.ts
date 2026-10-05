import type { Race } from './character-models';
export type ModelLayer = 'base' | 'outer';
export type ModelPartId = 'head' | 'body' | 'leftArm' | 'rightArm' | 'leftLeg' | 'rightLeg' | 'neck' | 'tail' | 'leftWing' | 'rightWing' | 'horn';
export type ModelVisibility = Record<ModelLayer, { visible: boolean; hidden: ModelPartId[] }>;
export type VisibilityPart = { id: ModelPartId; label: string; x: number; y: number; w: number; h: number; outer: boolean; mark?: string };
export function allVisible(): ModelVisibility { return {base:{visible:true,hidden:[]},outer:{visible:true,hidden:[]}}; }
export function partVisible(value: ModelVisibility, part: ModelPartId, layer: ModelLayer) {
  return value[layer].visible && !value[layer].hidden.includes(part);
}
export function togglePart(value: ModelVisibility, part: ModelPartId, layer: ModelLayer): ModelVisibility {
  const hidden=value[layer].hidden;
  return {...value,[layer]:{...value[layer],hidden:hidden.includes(part)?hidden.filter(p=>p!==part):[...hidden,part]}};
}
export function visibilityParts(kind: 'human' | 'pony', race: Race = 'earth'): VisibilityPart[] {
  if(kind==='human')return [
    {id:'head',label:'Голова',x:86,y:4,w:68,h:62,outer:true},
    {id:'body',label:'Туловище',x:86,y:74,w:68,h:84,outer:true},
    {id:'rightArm',label:'Правая рука',x:48,y:74,w:28,h:84,outer:true,mark:'П'},
    {id:'leftArm',label:'Левая рука',x:164,y:74,w:28,h:84,outer:true,mark:'Л'},
    {id:'rightLeg',label:'Правая нога',x:86,y:166,w:30,h:68,outer:true,mark:'П'},
    {id:'leftLeg',label:'Левая нога',x:124,y:166,w:30,h:68,outer:true,mark:'Л'},
  ];
  const parts: VisibilityPart[] = [
    {id:'head',label:'Голова и мордочка',x:12,y:40,w:60,h:54,outer:true},
    {id:'neck',label:'Шея',x:52,y:102,w:26,h:34,outer:false},
    {id:'body',label:'Туловище',x:86,y:96,w:98,h:52,outer:true},
    {id:'rightArm',label:'Правая передняя нога',x:54,y:156,w:24,h:62,outer:true,mark:'П'},
    {id:'leftArm',label:'Левая передняя нога',x:86,y:156,w:24,h:78,outer:true,mark:'Л'},
    {id:'rightLeg',label:'Правая задняя нога',x:128,y:156,w:24,h:62,outer:true,mark:'П'},
    {id:'leftLeg',label:'Левая задняя нога',x:160,y:156,w:24,h:78,outer:true,mark:'Л'},
    {id:'tail',label:'Хвост',x:194,y:110,w:28,h:88,outer:false},
  ];
  if(race==='unicorn'||race==='alicorn')parts.push({id:'horn',label:'Рог',x:28,y:4,w:22,h:28,outer:false});
  if(race==='pegasus'||race==='alicorn')parts.push(
    {id:'rightWing',label:'Правое крыло',x:100,y:12,w:54,h:32,outer:false,mark:'П'},
    {id:'leftWing',label:'Левое крыло',x:128,y:52,w:54,h:32,outer:false,mark:'Л'},
  );
  return parts;
}
