const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ts=require('typescript');
const modules={};
function load(name){
  name=name.replace('./','');if(modules[name])return modules[name];
  const exports={};modules[name]=exports;
  const code=ts.transpileModule(fs.readFileSync(`lib/${name}.ts`,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(code,{exports,require:load,Uint8ClampedArray,Uint8Array,btoa,atob,crypto:require('node:crypto').webcrypto});return exports;
}
const {TEXTURE_SECTIONS,texturePoint,paintTexture}=load('pony-texture');
const {blankPony,RACES,SIZES,setMetadata,isControlPixel}=load('character-models');
const {expandLegacyPony}=load('pony-template');
const {TAIL_LENGTHS,SNOUTS,readAppearance,normalizeTemplate}=load('character-models');
test('tail and snout survive PNG metadata for every race and size',()=>{
  for(const race of Object.keys(RACES))for(const size of Object.keys(SIZES))for(const tailLength of Object.keys(TAIL_LENGTHS))for(const snout of Object.keys(SNOUTS)){
    const next=setMetadata(blankPony(),race,size,tailLength,snout),appearance=readAppearance(next);
    assert.equal(appearance.tailLength,tailLength);assert.equal(appearance.snout,snout);
    const parsed=require('node:path').join('public/models/geometry-v2',`${race}-${size}-${tailLength}-${snout}.json`);
    assert(fs.existsSync(parsed),parsed);
  }
});
test('only the exact retired starter is replaced; metadata and custom drawings survive',async()=>{
  const old=new Uint8ClampedArray(require('node:zlib').inflateSync(fs.readFileSync('tests/fixtures/retired-template.deflate')));
  setMetadata(old,'unicorn','tall','half','square');
  const next=await normalizeTemplate(old);assert.deepEqual(next,setMetadata(blankPony(),'unicorn','tall','half','square'));
  const custom=old.slice();custom[(12*64+12)*4]=123;
  assert.equal(await normalizeTemplate(custom),custom);
  const white=blankPony();assert.equal(await normalizeTemplate(white),white);
});
test('all face pixels map inside the skin; gaps are never paintable',()=>{
  for(const section of TEXTURE_SECTIONS){
    const occupied=new Set();
    for(const tile of section.tiles)for(let y=0;y<tile.h;y++)for(let x=0;x<tile.w;x++){
      const display=`${tile.dx+x},${tile.dy+y}`;assert(!occupied.has(display),`${section.id} overlapping display faces`);occupied.add(display);
      const p=texturePoint(section,tile.dx+x,tile.dy+y);assert.equal(p.x,tile.x+x);assert.equal(p.y,tile.y+y);
      assert(p.x>=0&&p.x<64&&p.y>=0&&p.y<64);assert(tile.dx+x<section.width&&tile.dy+y<section.height);
    }
    for(let y=0;y<section.height;y++)for(let x=0;x<section.width;x++)if(!occupied.has(`${x},${y}`))assert.equal(texturePoint(section,x,y),null);
  }
});
test('head net maps the bottom to the original top row; legs and wings stay independent',()=>{
  const section=id=>TEXTURE_SECTIONS.find(s=>s.id===id);
  assert.equal(texturePoint(section('head'),8,16).x,16);assert.equal(texturePoint(section('head'),8,16).y,0);
  assert.equal(texturePoint(section('forelegs'),22,5).y,53);
  assert.equal(texturePoint(section('wings'),12,4).y,36);
});
test('fill and wide brushes cannot paint outside the selected face',()=>{
  const source=new Uint8ClampedArray(16384).fill(255),bounds={x:8,y:8,w:8,h:8};
  for(const fill of [true,false]){
    const next=paintTexture(source,8,8,[1,2,3,255],4,fill,bounds);
    assert.equal(next[(8*64+8)*4],1);assert.equal(next[(8*64+7)*4],255);assert.equal(next[(7*64+8)*4],255);
    assert.equal(source[(8*64+8)*4],255);
    if(fill)assert.equal(next[(15*64+15)*4],1);
  }
});
test('metadata cannot be painted, filled or erased even on the full skin',()=>{
  const source=blankPony();
  for(const [x,y,brush,fill] of [[0,0,4,false],[4,2,4,false],[0,3,1,true]]){
    const next=paintTexture(source,x,y,[0,0,0,0],brush,fill);
    for(let y=0;y<3;y++)for(let x=0;x<4;x++)assert.deepEqual(next.slice((y*64+x)*4,(y*64+x)*4+4),source.slice((y*64+x)*4,(y*64+x)*4+4));
  }
});
test('legacy conversion mirrors left limb and wing faces without changing the upper half',()=>{
  const legacy=new Uint8ClampedArray(8192);for(let i=0;i<2048;i++)legacy.set([i%64,Math.floor(i/64),0,255],i*4);
  const result=expandLegacyPony(legacy);
  assert.deepEqual(result.slice(0,8192),legacy);
  const pixel=(x,y)=>Array.from(result.slice((y*64+x)*4,(y*64+x)*4+4));
  assert.deepEqual(pixel(20,48),[7,16,0,255]);assert.deepEqual(pixel(16,52),[11,20,0,255]);
  assert.deepEqual(pixel(32,52),[51,20,0,255]);assert.deepEqual(pixel(56,34),[61,18,0,255]);
  assert.equal(result[(32*64)*4+3],0);
});
test('the template is monochrome outside metadata and supports all 32 race/size combinations',()=>{
  const pixels=blankPony();assert.equal(pixels.length,16384);
  for(let y=0;y<64;y++)for(let x=0;x<64;x++)if(!isControlPixel(x,y)){
    const i=(y*64+x)*4;assert(Math.max(pixels[i],pixels[i+1],pixels[i+2])-Math.min(pixels[i],pixels[i+1],pixels[i+2])<=1);
  }
  for(const race of Object.keys(RACES))for(const size of Object.keys(SIZES)){
    const next=setMetadata(pixels.slice(),race,size);assert.equal((next[0]<<16)|(next[1]<<8)|next[2],RACES[race].color);
    assert.equal((next[12]<<16)|(next[13]<<8)|next[14],SIZES[size].color);
  }
});
