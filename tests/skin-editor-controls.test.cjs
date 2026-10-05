const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
function moduleAt(path,globals={}){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,setTimeout,clearTimeout,require,...globals});return exports;}
const palette=moduleAt('lib/skin-palette.ts');
test('palette remembers most recently used colors, normalizes, deduplicates and bounds storage',()=>{
 let colors=palette.rememberColor(['#FF4EAD','#112233','#ff4ead'],'#112233');
 assert.equal(JSON.stringify(colors),JSON.stringify(['#112233','#ff4ead']));
 for(let i=0;i<30;i++)colors=palette.rememberColor(colors,'#'+i.toString(16).padStart(6,'0'));
 assert.equal(colors.length,12);assert.equal(colors[0],'#00001d');assert.equal(colors[11],'#000012');
 const data=new Map(),storage={getItem:k=>data.get(k),setItem:(k,v)=>data.set(k,v)};
 storage.setItem(palette.PALETTE_KEY,JSON.stringify(colors));assert.equal(JSON.stringify(palette.readPalette(storage)),JSON.stringify(colors));
});
test('invalid or unavailable palette storage cannot break painting',()=>{
 for(const raw of ['{','null','{}','[0,null,"red","#abcdef","#ABCDEF","#1234567"]']) {
  const colors=palette.readPalette({getItem:()=>raw});assert.ok(colors.every(c=>/^#[0-9a-f]{6}$/.test(c)));assert.ok(colors.length<=1);
 }
 assert.equal(palette.readPalette({getItem:()=>{throw new Error('storage denied');}}).length,0);
});
function fixture(){
 const canvas=new EventTarget(),window=new EventTarget();canvas.setPointerCapture=()=>{};
 const {bindSkinPainting}=moduleAt('lib/skin-pointer.ts',{window});const paints=[],ends=[];
 const dispose=bindSkinPainting(canvas,event=>paints.push([event.pointerId,event.clientX]),()=>ends.push(true));
 function send(type,props={}) {const event=new Event(type,{cancelable:true});Object.assign(event,{pointerId:1,pointerType:'mouse',button:0,buttons:1,clientX:10,...props});canvas.dispatchEvent(event);return event;}
 return {canvas,window,paints,ends,send,dispose};
}
test('holding right or middle mouse never paints; left draws and ends cleanly',()=>{
 const f=fixture();
 f.send('pointerdown',{button:2,buttons:2});f.send('pointermove',{buttons:2,clientX:80});f.send('pointerup',{button:2,buttons:0});
 f.send('pointerdown',{button:1,buttons:4});f.send('pointerup',{button:1,buttons:0});assert.equal(f.paints.length,0);assert.equal(f.ends.length,0);
 assert.equal(f.send('contextmenu').defaultPrevented,true);
 f.send('pointerdown');f.send('pointermove',{clientX:30});f.send('pointerup',{buttons:0});assert.equal(f.paints.length,2);assert.equal(f.ends.length,1);
 f.send('pointermove',{buttons:0});assert.equal(f.paints.length,2);f.dispose();
});
test('cancel, focus loss, extra buttons and other pointers cannot leave a painting stroke stuck',()=>{
 const f=fixture();f.send('pointerdown');f.send('pointermove',{pointerId:2});assert.equal(f.paints.length,1);
 f.send('pointermove',{buttons:3});f.send('pointermove');assert.equal(f.paints.length,1);
 f.send('pointerdown');f.send('pointercancel');f.send('pointermove');assert.equal(f.paints.length,2);
 f.send('pointerdown');f.window.dispatchEvent(new Event('blur'));f.send('pointermove');assert.equal(f.paints.length,3);
 f.send('pointerdown');f.send('lostpointercapture');f.send('pointermove');assert.equal(f.paints.length,4);
 f.dispose();f.send('pointerdown');assert.equal(f.paints.length,4);
});
test('a touch tap paints once, while a two-finger gesture never paints or resumes until lifted',async()=>{
 const f=fixture(),touch={pointerType:'touch'};
 f.send('pointerdown',touch);f.send('pointerup',{...touch,buttons:0});assert.equal(f.paints.length,1);
 f.send('pointerdown',touch);f.send('pointerdown',{...touch,pointerId:2});
 await new Promise(resolve=>setTimeout(resolve,150));
 f.send('pointermove',touch);f.send('pointerup',{...touch,pointerId:2});f.send('pointermove',touch);f.send('pointerup',touch);
 assert.equal(f.paints.length,1);
 f.send('pointerdown',touch);await new Promise(resolve=>setTimeout(resolve,150));f.send('pointermove',touch);f.send('pointerup',touch);assert.equal(f.paints.length,3);f.dispose();
});
test('real OrbitControls rotates with right drag, paints with left and zooms with wheel',async()=>{
 const THREE=await import('three'),{OrbitControls}=await import('three/addons/controls/OrbitControls.js');
 const f=fixture(),canvas=f.canvas;canvas.style={};canvas.clientHeight=600;canvas.clientWidth=800;canvas.getRootNode=()=>f.window;canvas.releasePointerCapture=()=>{};
 const camera=new THREE.PerspectiveCamera(35,4/3,.1,500);camera.position.set(44,30,60);
 const controls=new OrbitControls(camera,canvas);controls.target.set(0,16,0);controls.enablePan=false;
 const {configureSkinControls}=moduleAt('lib/skin-pointer.ts',{window:f.window});configureSkinControls(controls);controls.update();
 const start=camera.position.clone();
 f.send('pointerdown',{clientY:50});f.send('pointermove',{clientX:180,clientY:90});f.send('pointerup',{buttons:0});
 assert.ok(start.distanceTo(camera.position)<1e-8);assert.equal(f.paints.length,2);
 f.send('pointerdown',{button:2,buttons:2,clientY:50});f.send('pointermove',{buttons:2,clientX:180,clientY:90});f.send('pointerup',{button:2,buttons:0});
 assert.ok(start.distanceTo(camera.position)>1);assert.equal(f.paints.length,2);
 const distance=camera.position.distanceTo(controls.target);f.send('wheel',{deltaY:-100,deltaMode:0});assert.ok(camera.position.distanceTo(controls.target)<distance);assert.equal(f.paints.length,2);
 controls.dispose();f.dispose();
});
