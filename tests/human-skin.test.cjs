const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');const ts=require('typescript');
function moduleAt(path,mocks={}){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Uint8ClampedArray,Uint8Array,require:n=>mocks[n]});return exports;}
const human=moduleAt('lib/human-skin.ts'),paint=moduleAt('lib/pony-texture.ts',{'./character-models':{isControlPixel:(x,y)=>x<4&&y<3}});
test('classic and slim match Minecraft part sizes and arm locations',()=>{
  for(const model of ['classic','slim']){const p=human.humanParts(model);assert.equal(p.length,6);assert.equal(p[0].y+p[0].h/2,32);assert.equal(p[4].y-p[4].h/2,0);const w=model==='slim'?3:4;assert.equal(p[2].w,w);assert.equal(p[2].x+w/2,-4);assert.equal(p[3].x-w/2,4);}
});
test('all base and outer faces stay inside the skin, layers and parts never overlap',()=>{
  for(const model of ['classic','slim']){const used=new Set();for(const layer of ['base','outer'])for(const p of human.humanParts(model))for(const f of human.humanFaces(p,layer)){
    for(let y=f.y;y<f.y+f.h;y++)for(let x=f.x;x<f.x+f.w;x++){assert.ok(x>=0&&x<64&&y>=0&&y<64);assert.ok(!used.has(y*64+x),`${model} overlap ${x},${y}`);used.add(y*64+x);}
  }}
});
test('3D face UV order agrees with Minecraft front, back, top and bottom orientation',()=>{
  const head=human.humanParts('classic')[0],uv=human.humanUV(head,'base');assert.equal(uv.length,48);
  assert.deepEqual(Array.from(uv.slice(32,40)),[8/64,8/64,16/64,8/64,8/64,16/64,16/64,16/64]);
  assert.deepEqual(Array.from(uv.slice(24,32)),[16/64,8/64,24/64,8/64,16/64,0,24/64,0]);
  for(const model of ['classic','slim'])for(const layer of ['base','outer'])for(const p of human.humanParts(model))assert.ok(human.humanUV(p,layer).every(n=>n>=0&&n<=1));
});
test('neutral starter has opaque base, transparent outer layer and no colored pixels',()=>{
  for(const model of ['classic','slim']){const pixels=human.blankHuman(model);for(const p of human.humanParts(model))for(const layer of ['base','outer'])for(const f of human.humanFaces(p,layer))for(let y=f.y;y<f.y+f.h;y++)for(let x=f.x;x<f.x+f.w;x++){const i=(y*64+x)*4;assert.equal(pixels[i+3],layer==='base'?255:0);assert.equal(pixels[i],pixels[i+1]);assert.equal(pixels[i+1],pixels[i+2]);}}
});
test('legacy conversion mirrors each left limb face independently and leaves new overlays clear',()=>{
  const raw=new Uint8ClampedArray(8192);for(let y=0;y<32;y++)for(let x=0;x<64;x++)raw.set([x,y,17,255],(y*64+x)*4);
  const out=human.expandLegacyHuman(raw);const at=(x,y)=>Array.from(out.slice((y*64+x)*4,(y*64+x)*4+4));
  assert.deepEqual(at(20,52),[7,20,17,255]);assert.deepEqual(at(16,52),[11,20,17,255]);assert.deepEqual(at(24,52),[3,20,17,255]);assert.deepEqual(at(36,52),[47,20,17,255]);
  assert.equal(out[(40*64+20)*4+3],0);assert.equal(out[(8*64+40)*4+3],0);assert.deepEqual(at(8,8),[8,8,17,255]);
});
test('normalization matches opaque vanilla base without touching transparent overlays',()=>{
  const pixels=new Uint8ClampedArray(16384);pixels.set([10,20,30,96],(8*64+40)*4);const next=human.normalizeHumanSkin(pixels,'classic');assert.equal(next[(8*64+8)*4+3],255);assert.equal(next[(8*64+40)*4+3],96);assert.equal(pixels[(8*64+8)*4+3],0);
});
test('painting an empty outer face cannot leak into base skin or another face',()=>{
  const pixels=human.blankHuman(),face=human.humanFaces(human.humanParts('classic')[0],'outer')[4];const out=paint.paintTexture(pixels,face.x,face.y,[255,0,0,255],4,true,face,false);
  let changed=0;for(let i=0;i<4096;i++)if(out[i*4]!==pixels[i*4]){changed++;const x=i%64,y=Math.floor(i/64);assert.ok(x>=40&&x<48&&y>=8&&y<16);}
  assert.equal(changed,64);assert.deepEqual(Array.from(out.slice((8*64+8)*4,(8*64+8)*4+4)),Array.from(pixels.slice((8*64+8)*4,(8*64+8)*4+4)));
});
test('each face pixel in the human net maps back to its source pixel',()=>{
  for(const model of ['classic','slim'])for(const layer of ['base','outer'])for(const s of human.humanSections(model,layer))for(const f of s.tiles)for(let y=0;y<f.h;y++)for(let x=0;x<f.w;x++){const hit=paint.texturePoint(s,f.dx+x,f.dy+y);assert.equal(hit.x,f.x+x);assert.equal(hit.y,f.y+y);}
});
