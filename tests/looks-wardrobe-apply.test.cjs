const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const {webcrypto}=require('node:crypto');
function load(file,mocks={}){
 const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
 {exports,require:name=>{assert.ok(name in mocks,name);return mocks[name];},Buffer,Response,Request,Uint8Array,Uint8ClampedArray,atob,btoa,crypto:webcrypto});return exports;
}
const human=load('lib/human-skin.ts'),template=load('lib/pony-template.ts');
const models=load('lib/character-models.ts',{'./pony-template':template});
class ModelServiceError extends Error{constructor(message,status){super(message);this.status=status;}}
const id=n=>n.toString(16).padStart(32,'0'),png=n=>Buffer.from('png-'+n);
const pixels=(n,alpha=255)=>Buffer.from(Array.from({length:4096},()=>[n,22,33,alpha]).flat()).toString('base64');
function setup({kind='human',count=1,target=8,existing=null,model='classic',detailRevision=null,legacy=false,legacyCoercesClassic=false,ponyAllowed=true,metadata={}}={}){
 const calls=[],mutations=[],downloads=[];
 const slots=Array.from({length:count},(_,index)=>({id:id(index+1),skinUrl:'https://cdn.popperscraft.org/skins/models/'+String(index+1).repeat(64)+'.png',...(kind==='human'?{model}:{race:'pegasus',size:'normal',tailLength:'full',snout:'rounded',...metadata})}));
 let state={login:'player',mode:kind,revision:11,race:'earth',size:'normal',wardrobe:{limit:5,human:kind==='human'?slots:[],pony:kind==='pony'?slots:[],activeHumanId:kind==='human'?slots[0]?.id??null:null,activePonyId:kind==='pony'?slots[0]?.id??null:null,humanInitialized:true}};
 const saved=new Map(slots.map((slot,index)=>[slot.id,pixels(existing&&index===0?existing:index+1)]));
 async function callModelService(login,data={}){
  calls.push({login,...data});assert.equal(login,'player');
  if(!data.action)return structuredClone(state);
  if(data.action==='slot'){
   const slot=slots.find(slot=>slot.id===data.slotId);assert.ok(slot);
   return {...structuredClone(state),revision:detailRevision??state.revision,slot:{...slot,...(legacy?{}:{pixelsBase64:saved.get(slot.id)})}};
  }
  assert.equal(data.action,'wardrobe');assert.equal(data.revision,state.revision);mutations.push(data);
  if(data.operation==='save'){
   assert.equal(data.slotId,undefined,'Applying an archived look must never replace a slot');
   const slot={id:id(99),skinUrl:'new',...data};state.wardrobe[kind].push(slot);state.wardrobe[kind==='human'?'activeHumanId':'activePonyId']=slot.id;
  }else{assert.equal(data.operation,'select');state.wardrobe[kind==='human'?'activeHumanId':'activePonyId']=data.slotId;}
  state={...state,revision:state.revision+1,mode:kind};return structuredClone(state);
 }
 async function humanPngPixels(bytes,selectedModel){
  const n=Number(Buffer.from(bytes).toString().split('-')[1]);assert.ok(n>=0);
  return {model:legacyCoercesClassic?'classic':selectedModel,pixelsBase64:Buffer.from(human.normalizeHumanSkin(new Uint8ClampedArray(Buffer.from(pixels(n),'base64')),selectedModel)).toString('base64')};
 }
 const service={callModelService,ModelServiceError};
 const helpers=load('lib/apply-look-wardrobe.ts',{'server-only':{},'./model-service':service,'./skin-wardrobe':{humanPngPixels,downloadWardrobeSkin:async url=>{downloads.push(url);return png(existing??1);}},'./human-skin':human,'./character-models':models});
 const entry={id:'look-id',name:'Saved look',kind,model,race:'pegasus',size:'normal',tailLength:'full',snout:'rounded',...metadata};
 const payload=kind==='human'?{kind,skinBase64:png(target).toString('base64')}:{kind,pixelsBase64:pixels(target)};
 const route=load('app/api/profile/looks/apply/route.ts',{
  'next/server':{NextResponse:Response},'@/lib/community':{getCommunityViewer:async()=>({user:{id:'owner',user_metadata:{}},profile:{login:'player'}})},
  '@/lib/waitlist':{getViewerIdentity:async()=>({}),sameOriginOrMissing:()=>true},
  '@/lib/request-security':{consumeRateLimit:async()=>({allowed:true}),rateLimitResponse:()=>Response.json({}, {status:429})},
  '@/lib/player-looks':{looksLimit:()=>6,readLookPayload:async(user,look)=>{assert.equal(user,'owner');assert.equal(look,'look-id');return payload;},readLooks:()=>[entry]},
  '@/lib/apply-look-wardrobe':helpers,'@/lib/model-service':service,
  '@/lib/payments':{canUseCosmetic:async()=>ponyAllowed},'@/lib/plus-perks':{plusState:async()=>({active:false,tier:'plus'})},'@/lib/plus-style':{LOOKS_LIMIT:3},
 });
 return {calls,mutations,downloads,saved,slots,state:()=>state,apply:()=>route.POST(new Request('https://www.popperscraft.org/api/profile/looks/apply',{method:'POST',body:JSON.stringify({id:'look-id',login:'victim'})}))};
}

test('human look appends in a free slot and preserves every saved human',async()=>{
 const app=setup({count:2});const before=structuredClone(app.slots),response=await app.apply();assert.equal(response.status,200);
 assert.equal(app.mutations.length,1);assert.equal(app.mutations[0].operation,'save');assert.equal(app.mutations[0].slotId,undefined);
 assert.deepEqual(app.state().wardrobe.human.slice(0,2),before);assert.equal(app.state().wardrobe.human.length,3);
});
test('full human wardrobe reuses matching normalized pixels and model',async()=>{
 const app=setup({count:5,existing:8,target:8,model:'slim'});const normalized=human.normalizeHumanSkin(new Uint8ClampedArray(Buffer.from(pixels(8),'base64')),'slim');normalized[(20*64+20)*4+3]=0;app.saved.set(id(1),Buffer.from(normalized).toString('base64'));
 assert.equal((await app.apply()).status,200);assert.equal(app.mutations[0].operation,'select');assert.equal(app.mutations[0].slotId,id(1));assert.equal(app.state().wardrobe.human.length,5);
});
test('applying a new human look to a full wardrobe returns409 without replacing or deleting',async()=>{
 const app=setup({count:5});const before=structuredClone(app.state());const response=await app.apply();assert.equal(response.status,409);assert.match((await response.json()).error,/пяти/);
 assert.equal(app.mutations.length,0);assert.deepEqual(app.state(),before);
});
test('migrated human PNG is normalized and reused without creating another saved skin',async()=>{
 const app=setup({count:1,target:8,existing:8,legacy:true});assert.equal((await app.apply()).status,200);assert.equal(app.downloads.length,1);assert.equal(app.mutations[0].operation,'select');assert.equal(app.mutations[0].slotId,id(1));
});
test('pony look appends without replacing current pony; metadata is canonicalized',async()=>{
 const app=setup({kind:'pony',count:1,metadata:{tailLength:'quarter',snout:'square'}});const before=structuredClone(app.slots);
 assert.equal((await app.apply()).status,200);const change=app.mutations[0];assert.equal(change.operation,'save');assert.equal(change.slotId,undefined);
 assert.deepEqual(app.state().wardrobe.pony.slice(0,1),before);assert.equal(app.state().wardrobe.pony.length,2);
 const bytes=Buffer.from(change.pixelsBase64,'base64');assert.equal(bytes.readUIntBE(4,3),models.TAIL_LENGTHS.quarter.color);assert.equal(bytes.readUIntBE(8,3),models.SNOUTS.square.color);
});
test('full pony wardrobe reuses matching art and metadata despite raw control-pixel differences',async()=>{
 const app=setup({kind:'pony',count:5,target:8,existing:8});const normalized=models.setMetadata(new Uint8ClampedArray(Buffer.from(pixels(8),'base64')),'pegasus','normal');app.saved.set(id(1),Buffer.from(normalized).toString('base64'));
 assert.equal((await app.apply()).status,200);assert.equal(app.mutations[0].operation,'select');assert.equal(app.mutations[0].slotId,id(1));assert.equal(app.state().wardrobe.pony.length,5);
});
test('pony metadata mismatch cannot replace a slot in a full wardrobe',async()=>{
 const app=setup({kind:'pony',count:5,target:8,existing:8});app.slots[0].tailLength='half';assert.equal((await app.apply()).status,409);assert.equal(app.mutations.length,0);
});
test('concurrent change during slot comparison returns409 without a write',async()=>{
 const app=setup({target:8,existing:8,detailRevision:12});const response=await app.apply();assert.equal(response.status,409);assert.match((await response.json()).error,/другом окне/);assert.equal(app.mutations.length,0);
});
test('pony entitlement is still checked before any wardrobe read or write',async()=>{
 const app=setup({kind:'pony',ponyAllowed:false});const response=await app.apply();assert.equal(response.status,403);assert.equal((await response.json()).plusRequired,true);assert.equal(app.calls.length,0);
});

test('migrated legacy PNG with stored slim model cannot satisfy a classic look after normalization',async()=>{
 const app=setup({count:1,target:8,existing:8,legacy:true,model:'slim',legacyCoercesClassic:true});
 assert.equal((await app.apply()).status,200);assert.equal(app.mutations[0].operation,'save');assert.equal(app.mutations[0].slotId,undefined);assert.equal(app.state().wardrobe.human.length,2);
});
