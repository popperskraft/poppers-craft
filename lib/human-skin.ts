import type { TextureSection, TextureTile } from './pony-texture';
export type HumanModel = 'classic' | 'slim';
export type HumanLayer = 'base' | 'outer';
export type HumanPartId = 'head' | 'body' | 'rightArm' | 'leftArm' | 'rightLeg' | 'leftLeg';
export type HumanPart = {id:HumanPartId;label:string;w:number;h:number;d:number;x:number;y:number;u:number;v:number;ou:number;ov:number};
export function humanParts(model:HumanModel):HumanPart[]{
  const w=model==='slim'?3:4;
  return [
    {id:'head',label:'Голова',w:8,h:8,d:8,x:0,y:28,u:0,v:0,ou:32,ov:0},
    {id:'body',label:'Тело',w:8,h:12,d:4,x:0,y:18,u:16,v:16,ou:16,ov:32},
    {id:'rightArm',label:'Правая рука',w,h:12,d:4,x:-4-w/2,y:18,u:40,v:16,ou:40,ov:32},
    {id:'leftArm',label:'Левая рука',w,h:12,d:4,x:4+w/2,y:18,u:32,v:48,ou:48,ov:48},
    {id:'rightLeg',label:'Правая нога',w:4,h:12,d:4,x:-2,y:6,u:0,v:16,ou:0,ov:32},
    {id:'leftLeg',label:'Левая нога',w:4,h:12,d:4,x:2,y:6,u:16,v:48,ou:0,ov:48},
  ];
}
export function humanFaces(part:HumanPart,layer:HumanLayer):TextureTile[]{
  const {w,h,d}=part,u=layer==='outer'?part.ou:part.u,v=layer==='outer'?part.ov:part.v;
  const tile=(label:string,x:number,y:number,w:number,h:number,dx:number,dy:number)=>({label,x,y,w,h,dx,dy});
  // Face order matches THREE.BoxGeometry: +X, -X, +Y, -Y, +Z, -Z.
  return [tile('Слева',u+d+w,v+d,d,h,d+w,d),tile('Справа',u,v+d,d,h,0,d),
    tile('Сверху',u+d,v,w,d,d,0),tile('Снизу',u+d+w,v,w,d,d,d+h),
    tile('Спереди',u+d,v+d,w,h,d,d),tile('Сзади',u+2*d+w,v+d,w,h,2*d+w,d)];
}
export function humanSections(model:HumanModel,layer:HumanLayer):TextureSection[]{
  return humanParts(model).map(p=>({id:p.id,label:p.label,width:2*(p.w+p.d),height:p.h+2*p.d,tiles:humanFaces(p,layer)}));
}
export function humanUV(part:HumanPart,layer:HumanLayer):number[]{
  return humanFaces(part,layer).flatMap((f,i)=>{
    const top=(i===3?f.y+f.h:f.y)/64,bottom=(i===3?f.y:f.y+f.h)/64;
    return [f.x/64,top,(f.x+f.w)/64,top,f.x/64,bottom,(f.x+f.w)/64,bottom];
  });
}
export function humanPixelAllowed(model:HumanModel,layer:HumanLayer,x:number,y:number){
  return humanSections(model,layer).some(s=>s.tiles.some(t=>x>=t.x&&y>=t.y&&x<t.x+t.w&&y<t.y+t.h));
}
export function normalizeHumanSkin(pixels:Uint8ClampedArray,model:HumanModel){
  const result=pixels.slice();
  for(const part of humanParts(model))for(const f of humanFaces(part,'base'))for(let y=f.y;y<f.y+f.h;y++)for(let x=f.x;x<f.x+f.w;x++)result[(y*64+x)*4+3]=255;
  return result;
}
export function blankHuman(model:HumanModel='classic'){
  const pixels=new Uint8ClampedArray(16384);
  for(const part of humanParts(model))for(const f of humanFaces(part,'base'))for(let y=f.y;y<f.y+f.h;y++)for(let x=f.x;x<f.x+f.w;x++){
    const edge=y===f.y+f.h-1?210:239;pixels.set([edge,edge,edge,255],(y*64+x)*4);
  }
  // Neutral monochrome face makes the front easy to recognize while drawing.
  for(const x of [9,10,13,14])pixels.set([55,55,55,255],(11*64+x)*4);
  for(const x of [11,12])pixels.set([160,160,160,255],(14*64+x)*4);
  return pixels;
}
export function expandLegacyHuman(source:Uint8ClampedArray){
  if(source.length!==8192)throw new Error('Нужен скин 64×32.');
  const pixels=new Uint8ClampedArray(16384);pixels.set(source);
  const copy=(x:number,y:number,dx:number,dy:number,w:number,h:number)=>{
    for(let row=0;row<h;row++)for(let col=0;col<w;col++)pixels.set(source.slice(((y+row)*64+x+w-1-col)*4,((y+row)*64+x+w-col)*4),((dy+row)*64+dx+col)*4);
  };
  for(const [u,du] of [[0,16],[40,32]]){
    copy(u+4,16,du+4,48,4,4);copy(u+8,16,du+8,48,4,4);
    copy(u+8,20,du,52,4,12);copy(u+4,20,du+4,52,4,12);
    copy(u,20,du+8,52,4,12);copy(u+12,20,du+12,52,4,12);
  }
  // Old skins with an entirely opaque unused hat rectangle have no outer head layer.
  let opaque=true;for(let y=0;y<16;y++)for(let x=32;x<64;x++)if(source[(y*64+x)*4+3]<128)opaque=false;
  if(opaque)for(let y=0;y<16;y++)for(let x=32;x<64;x++)pixels[(y*64+x)*4+3]=0;
  return normalizeHumanSkin(pixels,'classic');
}
export async function readHumanPNG(file:Blob,model:HumanModel){
  if(file.size>256*1024)throw new Error('PNG должен быть не больше 256 КБ.');
  if(file.type!=='image/png')throw new Error('Выберите PNG-файл со скином.');
  const image=await createImageBitmap(file);
  try{
    if(image.width!==64||![32,64].includes(image.height))throw new Error('Выберите скин PNG 64×64 или 64×32.');
    const canvas=document.createElement('canvas');canvas.width=64;canvas.height=image.height;
    const ctx=canvas.getContext('2d')!;ctx.drawImage(image,0,0);const pixels=ctx.getImageData(0,0,64,image.height).data;
    return {pixels:image.height===32?expandLegacyHuman(pixels):normalizeHumanSkin(pixels,model),model:image.height===32?'classic' as const:model};
  }finally{image.close();}
}
export async function humanPNG(pixels:Uint8ClampedArray,model:HumanModel):Promise<Blob>{
  const canvas=document.createElement('canvas');canvas.width=canvas.height=64;
  canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(normalizeHumanSkin(pixels,model)),64,64),0,0);
  return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('Не удалось создать PNG.')),'image/png'));
}
