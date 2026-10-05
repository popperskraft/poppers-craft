import { isControlPixel } from './character-models';

export type TextureTile = { label: string; x: number; y: number; w: number; h: number; dx: number; dy: number };
export type TextureSection = { id: string; label: string; width: number; height: number; tiles: TextureTile[]; note?: string };
const tile = (label: string, x: number, y: number, w: number, h: number, dx: number, dy: number): TextureTile => ({label,x,y,w,h,dx,dy});
// Display each cube as a net. Coordinates always address the original 64×64 skin.
function cube(u: number, v: number, w: number, h: number, d: number, dx=0, dy=0, prefix=''): TextureTile[] {
  return [
    tile(prefix+'Сверху',u+d,v,w,d,dx+d,dy),
    tile(prefix+'Справа',u,v+d,d,h,dx,dy+d),
    tile(prefix+'Спереди',u+d,v+d,w,h,dx+d,dy+d),
    tile(prefix+'Слева',u+d+w,v+d,d,h,dx+d+w,dy+d),
    tile(prefix+'Сзади',u+2*d+w,v+d,w,h,dx+2*d+w,dy+d),
    tile(prefix+'Снизу',u+d+w,v,w,d,dx+d,dy+d+h),
  ];
}
export const TEXTURE_SECTIONS: TextureSection[] = [
  {id:'head',label:'Голова',width:32,height:24,tiles:cube(0,0,8,8,8)},
  {id:'ears',label:'Уши',width:8,height:6,tiles:cube(12,16,2,2,2),note:'Одна развёртка для обоих ушей.'},
  {id:'mane',label:'Грива',width:32,height:24,tiles:cube(32,0,8,8,8),note:'Верхний слой головы. Прозрачные пиксели открывают основной слой.'},
  {id:'neck',label:'Шея',width:4,height:4,tiles:[tile('Шея',0,16,4,4,0,0)]},
  {id:'body',label:'Тело',width:32,height:32,tiles:[
    ...cube(16,16,8,8,4),
    tile('Бока',24,0,8,8,0,18),tile('Отметка на боку',4,0,4,8,10,18),
    tile('Живот',56,0,8,8,16,18),tile('Спина',32,20,8,12,24,18),
    tile('Круп',36,16,8,4,0,28),
  ]},
  {id:'forelegs',label:'Передние ноги',width:34,height:20,tiles:[...cube(40,16,4,12,4,0,0,'Правая · '),...cube(32,48,4,12,4,18,0,'Левая · ')]},
  {id:'hindlegs',label:'Задние ноги',width:34,height:20,tiles:[...cube(0,16,4,12,4,0,0,'Правая · '),...cube(16,48,4,12,4,18,0,'Левая · ')]},
  {id:'tail',label:'Хвост',width:8,height:8,tiles:[tile('Спереди',32,0,4,8,0,0),tile('Сбоку',36,0,4,8,4,0)]},
  {id:'horn',label:'Рог',width:4,height:6,tiles:cube(0,3,1,4,1),note:'Рог виден у единорога и аликорна.'},
  {id:'wings',label:'Крылья',width:18,height:18,tiles:[...cube(56,16,2,14,2,0,0,'Правое · '),...cube(56,32,2,14,2,10,0,'Левое · ')],note:'Крылья видны у пегаса и аликорна.'},
  {id:'all',label:'Весь скин',width:64,height:64,tiles:[tile('Весь скин',0,0,64,64,0,0)],note:'Полная текстура, включая дополнительные слои. Служебные пиксели защищены.'},
];
export function texturePoint(section: TextureSection, x: number, y: number) {
  const t=section.tiles.find(t=>x>=t.dx&&y>=t.dy&&x<t.dx+t.w&&y<t.dy+t.h);
  return t ? {x:t.x+x-t.dx,y:t.y+y-t.dy,tile:t} : null;
}
export function paintTexture(source: Uint8ClampedArray, x: number, y: number, rgba: number[], brush: number, fill: boolean, bounds?: TextureTile, protectMetadata=true) {
  const allowed=(a:number,b:number)=>a>=0&&b>=0&&a<64&&b<64&&(!protectMetadata||!isControlPixel(a,b))&&(!bounds||(a>=bounds.x&&b>=bounds.y&&a<bounds.x+bounds.w&&b<bounds.y+bounds.h));
  if(!allowed(x,y))return source;
  const next=source.slice();
  if(fill){
    const old=source.slice((y*64+x)*4,(y*64+x)*4+4);
    if(old.every((v,i)=>v===rgba[i]))return source;
    const queue=[y*64+x],seen=new Uint8Array(4096);
    while(queue.length){const p=queue.pop()!,a=p%64,b=Math.floor(p/64);if(seen[p]||!allowed(a,b))continue;seen[p]=1;
      if(!old.every((v,i)=>source[p*4+i]===v))continue;next.set(rgba,p*4);
      if(a>0)queue.push(p-1);if(a<63)queue.push(p+1);if(b>0)queue.push(p-64);if(b<63)queue.push(p+64);
    }
  }else{
    for(let j=0;j<brush;j++)for(let i=0;i<brush;i++){
      const a=x+i-Math.floor((brush-1)/2),b=y+j-Math.floor((brush-1)/2);
      if(allowed(a,b))next.set(rgba,(b*64+a)*4);
    }
  }
  return next;
}

