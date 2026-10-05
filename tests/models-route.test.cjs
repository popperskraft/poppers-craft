const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ts=require('typescript');
const code=ts.transpileModule(fs.readFileSync('app/api/profile/models/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function setup(overrides={}){
  const sent=[];const identity={id:'signed-in-user',needsMfa:false};
  const options={identity,viewer:{user:{id:'signed-in-user'},profile:{login:'TestOwner'}},origin:true,key:'x'.repeat(40),allowed:true,...overrides};
  const exports={};
  const mocks={
    '@/lib/community':{getCommunityViewer:async()=>options.viewer},
    '@/lib/waitlist':{getViewerIdentity:async()=>{if(options.authError)throw Error('private backend error');return options.identity;},sameOriginOrMissing:()=>options.origin},
    '@/lib/request-security':{consumeRateLimit:async()=>({allowed:options.allowed}),rateLimitResponse:()=>Response.json({error:'rate limited'},{status:429})}
  };
  vm.runInNewContext(code,{exports,require:name=>{assert.ok(mocks[name],name);return mocks[name];},process:{env:{POPPERSCRAFT_BROWSER_SECRET:options.key}},Response,TextDecoder,AbortSignal,fetch:async(url,init)=>{
    sent.push({url,...init,body:JSON.parse(init.body)});if(options.fail)throw Error('private upstream error');
    return Response.json(options.payload||{login:'testowner',mode:'pony',revision:2},{status:options.status||200});
  }});
  return {route:exports,sent};
}
function request(body,headers={}){return new Request('https://www.popperscraft.org/api/profile/models',{method:'POST',body:typeof body==='string'?body:JSON.stringify(body),headers});}
test('anonymous and MFA sessions never reach the model service',async()=>{
  for(const identity of [null,{needsMfa:true}]){const{route,sent}=setup({identity});assert.equal((await route.GET(new Request('https://www.popperscraft.org/api/profile/models'))).status,401);assert.equal(sent.length,0);}
});
test('origin, membership and throttling are enforced',async()=>{
  for(const [options,status]of [[{origin:false},403],[{viewer:null},403],[{allowed:false},429]]){const{route,sent}=setup(options);assert.equal((await route.POST(request({mode:'human',revision:1}))).status,status);assert.equal(sent.length,0);}
});
test('only the signed-in profile determines the edited login',async()=>{
  const{route,sent}=setup();const response=await route.POST(request({login:'Victim',mode:'pony',race:'alicorn',size:'foal',pixelsBase64:'draft',revision:1,skinUrl:'https://evil.invalid/skin'}));
  assert.equal(response.status,200);assert.equal(sent[0].url,'https://api.popperscraft.org/api/models/profile');assert.equal(sent[0].body.login,'testowner');assert.equal(sent[0].body.skinUrl,undefined);assert.equal(sent[0].redirect,'error');assert.equal(sent[0].headers['X-PoppersCraft-Browser-Key'],'x'.repeat(40));
});
test('actual request bytes are limited even without Content-Length',async()=>{
  const{route,sent}=setup();assert.equal((await route.POST(request(' '.repeat(33000)))).status,413);assert.equal(sent.length,0);
});
test('tail length and snout are forwarded with a skin upload',async()=>{
  const {route,sent}=setup();
  assert.equal((await route.POST(request({mode:'pony',revision:0,race:'earth',size:'normal',tailLength:'half',snout:'square',pixelsBase64:'pixels'}))).status,200);
  assert.equal(sent[0].body.tailLength,'half');assert.equal(sent[0].body.snout,'square');
});
test('malformed payloads cannot mutate state',async()=>{
  for(const body of ['{broken','null','[]']){const{route,sent}=setup();assert.equal((await route.POST(request(body))).status,400);assert.equal(sent.length,0);}
});
test('GET reads only the signed-in profile and disables caching',async()=>{
  const{route,sent}=setup();const response=await route.GET(new Request('https://www.popperscraft.org/api/profile/models?login=Victim'));
  assert.equal(sent[0].body.login,'testowner');assert.deepEqual(Object.keys(sent[0].body),['login']);assert.match(response.headers.get('Cache-Control'),/no-store/);
});
test('conflict is delivered without retrying a stale write',async()=>{
  const{route,sent}=setup({status:409,payload:{error:'Changed elsewhere'}});const response=await route.POST(request({mode:'human',revision:1}));assert.equal(response.status,409);assert.equal(sent.length,1);
});
test('configuration, authentication backend and upstream failures have safe errors',async()=>{
  for(const options of [{key:''},{authError:true},{fail:true}]){const{route}=setup(options);const response=await route.GET(new Request('https://www.popperscraft.org/api/profile/models'));assert.equal(response.status,503);assert.doesNotMatch(await response.text(),/private|secret|backend error/);}
});
