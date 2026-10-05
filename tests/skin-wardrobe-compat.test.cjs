const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
function load(file,mocks,extra={}){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:n=>{assert.ok(n in mocks,n);return mocks[n];},Buffer,Response,Request,...extra});return exports;}
test('initialized empty wardrobe uses default model; unavailable migration retains old slim model',()=>{
 const {activeHumanModel}=load('lib/skin-preview.ts',{});
 assert.equal(activeHumanModel(null,'slim'),'slim');
 assert.equal(activeHumanModel({wardrobe:{humanInitialized:false,human:[],activeHumanId:null}},'slim'),'slim');
 assert.equal(activeHumanModel({wardrobe:{humanInitialized:true,human:[],activeHumanId:null}},'slim'),'classic');
 assert.equal(activeHumanModel({wardrobe:{humanInitialized:true,human:[{id:'a',model:'slim'}],activeHumanId:'a'}},'classic'),'slim');
});
function skinSync(hasPath,url){const query={};for(const method of ['select','eq','limit'])query[method]=()=>method==='limit'?Promise.resolve({data:[{user_id:'owner',login:'player'}]}):query;
 return load('app/api/launcher/skin-sync/route.ts',{
 'node:crypto':require('node:crypto'),'next/server':{NextResponse:Response},
 '@/lib/player-skins':{createPlayerSkinSignedUrl:async()=>url,getPlayerSkinPath:()=>hasPath?'owner/skin.png':null,getPlayerSkinModel:()=>'slim',getPlayerSkinUpdatedAt:()=>'old'},
 '@/lib/supabase/admin':{createSupabaseAdminClient:()=>({from:()=>query,auth:{admin:{getUserById:async()=>({data:{user:{user_metadata:{},updated_at:'old'}}})}}})},
 '@/lib/waitlist':{normalizeLogin:v=>v.toLowerCase(),isValidLogin:()=>true},
 },{process:{env:{POPPERSCRAFT_BROWSER_SECRET:'k'.repeat(32)}}});}
const read=()=>new Request('https://www.popperscraft.org/api/launcher/skin-sync',{method:'POST',headers:{'x-popperscraft-browser-key':'k'.repeat(32),'Content-Type':'application/json'},body:JSON.stringify({login:'player'})});
test('legacy migration distinguishes signing outage from truly absent account skin',async()=>{
 const unavailable=await skinSync(true,null).POST(read());assert.equal(unavailable.status,503);assert.match(await unavailable.text(),/temporarily unavailable/);
 const absent=await skinSync(false,null).POST(read());assert.equal(absent.status,200);const empty=await absent.json();assert.equal(empty.skin,null);assert.equal(empty.skinLookupComplete,true);
 const present=await skinSync(true,'https://storage.example/signed').POST(read());assert.equal(present.status,200);assert.deepEqual((await present.json()).skin,{url:'https://storage.example/signed',model:'slim',updatedAt:'old'});
});
