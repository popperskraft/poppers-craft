/* r081: подключение нейросетей (lib/ai-connect, app/mcp, app/oauth). */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript'),crypto=require('node:crypto');
const read=p=>fs.readFileSync(p,'utf8');

/* Загрузка TS-модуля с подменой зависимостей: свои файлы (@/… и ./…)
   подгружаются так же, внешние — из mocks или настоящим require. */
function loadTs(file,mocks={},cache=new Map()){
  const full=path.resolve(file);
  if(cache.has(full))return cache.get(full);
  const exports={};cache.set(full,exports);
  const code=ts.transpileModule(read(full),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
  const localRequire=name=>{
    if(name in mocks)return mocks[name];
    if(name==='server-only')return {};
    if(name.startsWith('@/')||name.startsWith('.')){
      const base=name.startsWith('@/')?path.resolve(name.slice(2)):path.resolve(path.dirname(full),name);
      for(const candidate of [base+'.ts',base+'.tsx',path.join(base,'index.ts')])if(fs.existsSync(candidate))return loadTs(candidate,mocks,cache);
      throw new Error('Cannot resolve '+name);
    }
    return require(name);
  };
  vm.runInNewContext(code,{exports,module:{exports},require:localRequire,Buffer,URL,URLSearchParams,Response,Headers,Request,console,process,setTimeout,TextEncoder,Date,Math,JSON},{filename:full});
  return exports;
}

const rules=loadTs('lib/ai-connect/oauth-rules.ts');
const config=loadTs('lib/ai-connect/config.ts');

test('redirect URIs: HTTPS or loopback only; loopback matches on any port',()=>{
  for(const uri of ['https://claude.ai/api/mcp/auth_callback','https://chatgpt.com/connector_platform_oauth_redirect','http://localhost:3118/callback','http://127.0.0.1/callback'])assert.ok(rules.isAllowedRedirectUri(uri),uri);
  for(const uri of ['http://evil.example/cb','https://claude.ai/cb#frag','https://user:pass@claude.ai/cb','javascript:alert(1)','ftp://x/y'])assert.ok(!rules.isAllowedRedirectUri(uri),uri);
  assert.ok(rules.redirectUriMatches(['http://localhost/callback'],'http://localhost:51234/callback'));
  assert.ok(rules.redirectUriMatches(['http://127.0.0.1/callback'],'http://127.0.0.1:9/callback'));
  assert.ok(!rules.redirectUriMatches(['http://localhost/callback'],'http://localhost:51234/other'));
  assert.ok(!rules.redirectUriMatches(['https://claude.ai/api/mcp/auth_callback'],'https://claude.ai:8443/api/mcp/auth_callback'));
  assert.ok(rules.redirectUriMatches(['https://claude.ai/api/mcp/auth_callback'],'https://claude.ai/api/mcp/auth_callback'));
});

test('PKCE accepts only the matching S256 verifier',()=>{
  const verifier='a'.repeat(20)+'-._~'+'B'.repeat(30);
  const challenge=crypto.createHash('sha256').update(verifier).digest('base64url');
  assert.ok(rules.pkceMatches(verifier,challenge));
  assert.ok(!rules.pkceMatches(verifier+'x',challenge));
  assert.ok(!rules.pkceMatches('short',challenge));
  assert.ok(!rules.pkceMatches(verifier,verifier));
});

test('scopes: unknown ones dropped, empty means both; secrets are random and hashed',()=>{
  assert.deepEqual([...rules.parseScopes('popperscraft.read offline_access')],['popperscraft.read']);
  assert.deepEqual([...rules.parseScopes('')],[...config.AI_SCOPES]);
  const a=rules.newSecret('pca'),b=rules.newSecret('pca');
  assert.match(a,/^pca_[A-Za-z0-9_-]{43}$/);assert.notEqual(a,b);
  assert.equal(rules.hashSecret(a).length,64);assert.notEqual(rules.hashSecret(a),a);
  assert.equal(rules.cleanClientName('<b>Claude</b>\u0000'),'bClaude/b');
});

test('skin recolor keeps shading, touches only the chosen part and skips transparent pixels',()=>{
  const {recolorSkinPixels,SKIN_PARTS}=loadTs('lib/ai-connect/skin-recolor.ts');
  const pixels=new Uint8Array(64*64*4);
  const set=(x,y,v,a=255)=>{const i=(y*64+x)*4;pixels[i]=v;pixels[i+1]=v;pixels[i+2]=v;pixels[i+3]=a;};
  set(20,20,80);set(21,20,160);set(22,20,120,0);set(2,2,100);
  recolorSkinPixels(pixels,64,64,[{part:'body',color:'#ff0000'}]);
  const px=(x,y)=>Array.from(pixels.slice((y*64+x)*4,(y*64+x)*4+4));
  const dark=px(20,20),light=px(21,20);
  assert.ok(dark[0]>dark[1]&&light[0]>light[1],'body turned red');
  assert.ok(light[0]+light[1]>dark[0]+dark[1],'shading kept');
  assert.deepEqual(px(22,20),[120,120,120,0],'transparent untouched');
  assert.deepEqual(px(2,2),[100,100,100,255],'head untouched');
  recolorSkinPixels(pixels,64,64,[{part:'head',color:'#00ff00',mode:'replace'}]);
  assert.deepEqual(px(2,2),[0,255,0,255]);
  const legacy=new Uint8Array(64*32*4);assert.doesNotThrow(()=>recolorSkinPixels(legacy,64,32,[{part:'pants',color:'#123456'}]));
  assert.throws(()=>recolorSkinPixels(pixels,64,64,[{part:'tail',color:'#ffffff'}]));
  assert.throws(()=>recolorSkinPixels(pixels,64,64,[{part:'body',color:'red'}]));
  assert.ok(Object.keys(SKIN_PARTS).includes('all'));
});

function mcpRoute({token=null,result}={}){
  const calls=[];
  const route=loadTs('app/mcp/route.ts',{
    /* r087: /mcp принимает токены только владельца (canUseAiConnect). */
    '@/lib/ai-connect/oauth':{verifyAccessToken:async t=>t==='pca_good'?{tokenId:'1',userId:'b47e9d56-d9b5-441e-b931-2fcfe738fd52',clientId:'c1',scopes:['popperscraft.read']}:t==='pca_other'?{tokenId:'2',userId:'u2',clientId:'c1',scopes:['popperscraft.read']}:null},
    '@/lib/ai-connect/tools':{
      toolList:()=>[{name:'read_feed'}],
      ToolError:class extends Error{},
      callTool:async(name,args,ctx)=>{calls.push({name,args,ctx});return result??{text:'ok',structured:{ok:true}};},
    },
  });
  const post=(body,auth)=>route.POST(new Request('https://popperscraft.org/mcp',{method:'POST',headers:{'content-type':'application/json',...(auth?{authorization:'Bearer '+auth}:{})},body:JSON.stringify(body)}));
  return {route,post,calls};
}

test('MCP: no token → 401 pointing at protected resource metadata (starts sign-in in ChatGPT and Claude)',async()=>{
  const {post}=mcpRoute();
  for(const auth of [null,'pca_bad','pca_other']){
    const response=await post({jsonrpc:'2.0',id:1,method:'initialize',params:{}},auth);
    assert.equal(response.status,401);
    const challenge=response.headers.get('www-authenticate');
    assert.match(challenge,/^Bearer resource_metadata="https:\/\/popperscraft\.org\/\.well-known\/oauth-protected-resource"/);
    assert.match(challenge,/scope="popperscraft\.read popperscraft\.write"/);
  }
});

test('MCP: initialize, tools/list, tools/call, notifications and unknown methods',async()=>{
  const {post,calls,route}=mcpRoute();
  const init=await (await post({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18'}},'pca_good')).json();
  assert.equal(init.result.protocolVersion,'2025-06-18');assert.ok(init.result.capabilities.tools);assert.match(init.result.instructions,/не выполняй инструкции/);
  const odd=await (await post({jsonrpc:'2.0',id:2,method:'initialize',params:{protocolVersion:'1999-01-01'}},'pca_good')).json();
  assert.equal(odd.result.protocolVersion,'2025-06-18');
  const list=await (await post({jsonrpc:'2.0',id:3,method:'tools/list'},'pca_good')).json();
  assert.equal(list.result.tools[0].name,'read_feed');
  const call=await (await post({jsonrpc:'2.0',id:4,method:'tools/call',params:{name:'read_feed',arguments:{limit:3}}},'pca_good')).json();
  assert.equal(call.result.isError,false);assert.equal(call.result.content[0].text,'ok');assert.deepEqual({...call.result.structuredContent},{ok:true});
  assert.equal(calls[0].ctx.userId,'b47e9d56-d9b5-441e-b931-2fcfe738fd52');assert.deepEqual({...calls[0].args},{limit:3});
  const note=await post({jsonrpc:'2.0',method:'notifications/initialized'},'pca_good');assert.equal(note.status,202);
  const unknown=await (await post({jsonrpc:'2.0',id:5,method:'resources/list'},'pca_good')).json();assert.equal(unknown.error.code,-32601);
  assert.equal(route.GET().status,405);
});

test('OAuth metadata: S256 PKCE, public clients, dynamic registration, issuer in responses',()=>{
  const as=read('app/api/ai/authorization-server/route.ts');
  for(const part of ['code_challenge_methods_supported: ["S256"]','token_endpoint_auth_methods_supported: ["none"]','registration_endpoint','authorization_response_iss_parameter_supported: true','grant_types_supported: ["authorization_code", "refresh_token"]'])assert.ok(as.includes(part),part);
  const pr=read('app/api/ai/protected-resource/route.ts');assert.ok(pr.includes('resource: resourceFor(request)')&&pr.includes('authorization_servers: [AI_ISSUER]'));
  assert.equal(config.MCP_RESOURCE,'https://popperscraft.org/mcp');
  /* С www и без него — один ресурс; описание отвечает адресом того хоста, с которого спросили. */
  for(const value of ['https://popperscraft.org/mcp','https://www.popperscraft.org/mcp/','https://popperscraft.org/mcp/'])assert.ok(config.isOurResource(value),value);
  for(const value of ['https://evil.example/mcp','https://popperscraft.org/mcp/other','http://popperscraft.org/mcp',''])assert.ok(!config.isOurResource(value),value);
  assert.equal(config.resourceFor(new Request('https://x/',{headers:{'x-forwarded-host':'www.popperscraft.org'}})),'https://www.popperscraft.org/mcp');
  assert.equal(config.resourceFor(new Request('https://x/',{headers:{'x-forwarded-host':'evil.example'}})),config.MCP_RESOURCE);
  const next=read('next.config.ts');
  for(const source of ['/.well-known/oauth-protected-resource','/.well-known/oauth-authorization-server'])assert.ok(next.includes(`source: "${source}"`),source);
  assert.match(read('lib/ai-connect/authorize.ts'),/url\.searchParams\.set\("iss", AI_ISSUER\)/);
});

test('consent: never redirects before the redirect URI is verified; uses location.assign, not a form',async()=>{
  const client={id:'pcc_'+'a'.repeat(43),name:'Claude',redirect_uris:['https://claude.ai/api/mcp/auth_callback']};
  const authorize=loadTs('lib/ai-connect/authorize.ts',{
    './oauth':{getClient:async id=>id===client.id?client:null,clientAcceptsRedirect:(c,u)=>c.redirect_uris.includes(u)},
  });
  const base={client_id:client.id,redirect_uri:client.redirect_uris[0],response_type:'code',code_challenge_method:'S256',code_challenge:'x'.repeat(43),state:'s1'};
  assert.equal((await authorize.checkAuthorizeRequest({...base,redirect_uri:'https://evil.example/cb'})).kind,'fatal');
  assert.equal((await authorize.checkAuthorizeRequest({...base,client_id:'pcc_unknown'})).kind,'fatal');
  const noPkce=await authorize.checkAuthorizeRequest({...base,code_challenge_method:'plain'});
  assert.equal(noPkce.kind,'redirect');assert.match(noPkce.url,/^https:\/\/claude\.ai\/api\/mcp\/auth_callback\?error=invalid_request/);assert.match(noPkce.url,/iss=https%3A%2F%2Fpopperscraft\.org/);
  assert.equal((await authorize.checkAuthorizeRequest({...base,resource:'https://other.example/mcp'})).kind,'redirect');
  const ok=await authorize.checkAuthorizeRequest({...base,resource:'https://popperscraft.org/mcp/',scope:'popperscraft.write'});
  assert.equal(ok.kind,'ok');assert.deepEqual([...ok.request.scopes],['popperscraft.write']);assert.equal(ok.request.resource,'https://popperscraft.org/mcp');
  const ui=read('app/oauth/authorize/AiConsent.tsx');assert.match(ui,/window\.location\.assign\(result\.redirect\)/);assert.ok(!ui.includes('<form'));
  assert.match(read('app/api/ai/consent/route.ts'),/sameOriginOrMissing\(request\)/);
});

test('tools: only the agreed actions; write tools ask for confirmation and are logged and limited',()=>{
  const source=read('lib/ai-connect/tools.ts');
  const names=[...source.matchAll(/^    name: "([a-z_]+)",$/gm)].map(match=>match[1]);
  assert.deepEqual(names,['get_my_profile','read_feed','get_player','search_players','search_wiki','server_status','get_my_subscription','get_my_skin','get_my_header','create_post','comment_on_post','update_profile','set_header_art','recolor_skin','paint_skin','make_pony']);
  assert.ok(!/password|email|mfa|payment|admin|delete_account|ban/i.test(names.join(' ')));
  for(const tool of ['create_post','comment_on_post','update_profile','set_header_art','recolor_skin','paint_skin','make_pony']){
    const block=source.slice(source.indexOf(`name: "${tool}"`));const body=block.slice(0,block.indexOf('\n  },\n'));
    assert.match(body,/scope: SCOPE_WRITE/,tool);assert.match(body,/readOnly: false/,tool);assert.match(body,/CONFIRM_NOTE/,tool);
    assert.match(body,/await dailyLimit\(ctx, "/,tool);assert.match(body,/await logActivity\(ctx\.userId, ctx\.clientId, "/,tool);
  }
  assert.match(source,/if \(!ctx\.scopes\.includes\(tool\.scope\)\)/);
  assert.match(source,/getCommunityViewer\(\{ identity: \{ user: data\.user, adminProfile: null, needsMfa: false \} \}\)/);
});

test('connections are revocable by the player; tokens stored only as hashes; codes single-use',()=>{
  const oauth=read('lib/ai-connect/oauth.ts');
  assert.ok(!/access_token: access,[\s\S]*insert\(\{[^}]*access_token/.test(oauth));
  assert.match(oauth,/access_hash: hashSecret\(access\)/);assert.match(oauth,/refresh_hash: hashSecret\(refresh\)/);
  assert.match(oauth,/\.update\(\{ used_at: new Date\(\)\.toISOString\(\) \}\)\s*\.eq\("code_hash", hashSecret\(input\.code\)\)\s*\.is\("used_at", null\)/);
  assert.match(oauth,/\.update\(\{ revoked_at: new Date\(\)\.toISOString\(\) \}\)\s*\.eq\("refresh_hash", hashSecret\(input\.refreshToken\)\)/);
  const sql=read('supabase/migrations/20261001200000_r081_ai_connector.sql');
  assert.match(sql,/enable row level security/);assert.match(sql,/revoke all on public\.pc_ai_clients, public\.pc_ai_codes, public\.pc_ai_tokens, public\.pc_ai_activity from anon, authenticated/);
  assert.ok(!/\bdelete\b/i.test(sql.replace(/--.*$/gm,'')),'migration deletes nothing');
});

test('new UI texts have manual English translations; /oauth is a step without the site header',()=>{
  const {EN_PHRASES}=loadTs('lib/i18n/en.ts');const translate=loadTs('lib/i18n/translate.ts').createTranslator(EN_PHRASES);
  for(const file of ['app/oauth/authorize/AiConsent.tsx','app/profile/AiConnectionsPanel.tsx']){
    const source=ts.createSourceFile(file,read(file),99,true);
    function visit(node){if((ts.isStringLiteralLike(node)||ts.isJsxText(node))&&/[А-Яа-яЁё]/.test(node.text)){const text=node.text.replace(/\s+/g,' ').trim();if(text&&!/^[«»\s]*$/.test(text))assert.ok(translate(text),`${file}: ${text}`);}ts.forEachChild(node,visit);}
    visit(source);
  }
  for(const text of Object.values(config.SCOPE_DESCRIPTIONS))assert.ok(translate(text),text);
  const nav=loadTs('lib/site-navigation.ts');assert.ok(!nav.hasSiteHeader('/oauth/authorize'));
  assert.match(read('lib/navigation-trail.ts'),/\/\^\\\/oauth\(\?:\\\/\|\$\)\/,/);
});

test('profile has the «Нейросети» tab; password change and 2FA removal cut AI connections',()=>{
  const page=read('app/profile/page.tsx');
  /* r087: вкладка видна только тем, кому открыты нейросети (canUseAiConnect). */
  /* r089: раздел «Нейросети» — в «Профиль → Настройки», только для canUseAiConnect. */
  assert.match(page,/id: "ai",\s*label: "НЕЙРОСЕТИ",\s*content: canUseAiConnect\(viewer\.user\.id\) \? <section className="profile-password">[\s\S]*?<AiConnectionsPanel \/>[\s\S]*?<\/section> : undefined,/);
  assert.match(read('app/profile/ProfileSettings.tsx'),/section\.content !== undefined && section\.content !== null/);
  const password=read('app/api/profile/password/route.ts');
  assert.ok(password.indexOf('await revokeAllAiTokens(user.id)')>password.indexOf('supabase.auth.updateUser('),'revoke after a successful change');
  const disable=read('app/api/profile/mfa/disable/route.ts');
  assert.ok(disable.indexOf('await revokeAllAiTokens(user.id)')>disable.indexOf('deleteFactor')&&disable.indexOf('await revokeAllAiTokens(user.id)')<disable.indexOf('signOut({ scope: "global" })'));
  const mail=read('app/api/auth/email-confirm/route.ts');
  assert.ok(mail.indexOf('await revokeAllAiTokens(checked.user.id)')>mail.indexOf('clearMailToken(checked.user.id, "mfa_reset")'));
});

test('pixel header: 12×48 grid round-trips, bad grids are explained, cosmetic rule and fresh metadata kept',()=>{
  const grid=loadTs('lib/ai-connect/header-art-grid.ts');
  const sky='s'.repeat(48),grass='g'.repeat(48);
  const rows=[...Array(8).fill(sky),'s'.repeat(20)+'hhhh'+'s'.repeat(24),...Array(3).fill(grass)];
  const art=grid.gridToHeaderArt({palette:{s:'#55CDFC',g:'#16833b',h:'#7a3f18'},rows});
  assert.equal(art.pixels.length,576);
  const back=grid.headerArtToGrid(art);
  assert.equal(back.rows.length,12);assert.ok(back.rows.every(row=>row.length===48));
  const colorAt=(g,x,y)=>g.palette[g.rows[y][x]];
  assert.equal(colorAt(back,0,0),'#55cdfc');assert.equal(colorAt(back,21,8),'#7a3f18');assert.equal(colorAt(back,47,11),'#16833b');
  const clear=grid.gridToHeaderArt({palette:{},rows:Array(12).fill('.'.repeat(48))});assert.ok(!/[^.]/.test(clear.pixels));
  assert.throws(()=>grid.gridToHeaderArt({palette:{s:'#55cdfc'},rows:Array(11).fill(sky)}),/12/);
  assert.throws(()=>grid.gridToHeaderArt({palette:{s:'#55cdfc'},rows:[...Array(11).fill(sky),'s'.repeat(47)]}),/48/);
  assert.throws(()=>grid.gridToHeaderArt({palette:{s:'#55cdfc'},rows:[...Array(11).fill(sky),'x'.repeat(48)]}),/палитре/);
  assert.throws(()=>grid.gridToHeaderArt({palette:{ss:'#55cdfc'},rows:Array(12).fill(sky)}),/один символ/);
  assert.throws(()=>grid.gridToHeaderArt({palette:{s:'blue'},rows:Array(12).fill(sky)}),/#RRGGBB/);
  const preview=grid.headerArtPreviewRgba(art,'#1c44da',8);assert.equal(preview.width,384);assert.equal(preview.height,96);assert.equal(preview.data.length,384*96*4);
  const source=read('lib/ai-connect/tools.ts');const block=source.slice(source.indexOf('name: "set_header_art"'));const body=block.slice(0,block.indexOf('\n  },\n'));
  assert.match(body,/canUseCosmetic\(viewer\.user\.id, "header_art"\)/);
  assert.match(body,/admin\.auth\.admin\.getUserById\(viewer\.user\.id\)/);
  assert.match(body,/profile_header_flag: drawn \? "custom"/);
});

test('skin painting: rectangles, bounds, pony template tint keeps eyes, rainbow mane, map of parts',()=>{
  const paint=loadTs('lib/ai-connect/skin-paint.ts');
  const pixels=new Uint8ClampedArray(64*64*4);
  assert.equal(paint.applyPaintOps(pixels,[{x:8,y:8,w:8,h:8,color:'#ff0000'},{x:0,y:0,color:'transparent'}]),65);
  assert.deepEqual(Array.from(pixels.slice((8*64+8)*4,(8*64+8)*4+4)),[255,0,0,255]);
  assert.throws(()=>paint.applyPaintOps(pixels,[{x:60,y:0,w:8,h:1,color:'#ffffff'}]),/0–63/);
  assert.throws(()=>paint.applyPaintOps(pixels,[{x:0,y:0,color:'red'}]),/цвет/);
  const guarded=new Uint8ClampedArray(64*64*4);paint.applyPaintOps(guarded,[{x:0,y:0,w:4,h:3,color:'#123456'}],{protectControl:true});assert.equal(guarded[3],0,'pony control pixels untouched');
  const pony=paint.ponyTemplatePixels();assert.equal(pony.length,64*64*4);
  const eye=(x,y)=>Array.from(pony.slice((y*64+x)*4,(y*64+x)*4+4));
  const pupil=eye(9,11),white=eye(10,11);
  paint.tintGreyTiles(pony,paint.ponySectionTiles('head'),'#ff9ecb');
  assert.deepEqual(eye(9,11),pupil);assert.deepEqual(eye(10,11),white);
  const coat=eye(8,8);assert.ok(coat[0]>coat[1]&&coat[0]>200,'coat turned pink');
  paint.rainbowTiles(pony,paint.ponySectionTiles('mane'));
  const mane=paint.ponySectionTiles('mane')[0];const top=(mane.y*64+mane.x)*4;
  assert.ok(pony[top+3]===0||pony[top]===0xe4,'first stripe red or transparent');
  const human=paint.skinMap('human','classic');assert.ok(human.some(t=>t.part==='head'&&t.layer==='base'&&t.face==='Спереди'&&t.x===8&&t.y===8));
  const wings=paint.skinMap('pony').filter(t=>t.part==='wings');assert.ok(wings.length>=6);
  const preview=paint.texturePreviewRgba(pixels,6);assert.equal(preview.width,384);
  const source=read('lib/ai-connect/tools.ts');const block=source.slice(source.indexOf('name: "make_pony"'));
  assert.match(block,/canUseCosmetic\(viewer\.user\.id, "pony"\)/);assert.match(block,/setMetadata\(pixels, race, size, tailLength, snout\)/);assert.match(block,/kind: "pony"/);
});

/* r087: нейросети видны и доступны только владельцу @step (решение владельца,
   2026-10-02) — вкладка, экран разрешения, выдача кода и /mcp. */
test('AI connector is open only to the site owner account',()=>{
  assert.equal(config.canUseAiConnect('b47e9d56-d9b5-441e-b931-2fcfe738fd52'),true);
  assert.equal(config.canUseAiConnect('a2426bac-2797-4ac0-b7d1-22f10fced050'),false);
  assert.equal(config.canUseAiConnect(''),false);
  assert.equal(config.canUseAiConnect(null),false);
  const authorize=read('app/oauth/authorize/page.tsx');
  assert.ok(authorize.indexOf('canUseAiConnect(viewer.user.id)')>authorize.indexOf('if (!viewer)'),'checked after sign-in, before the consent screen');
  assert.ok(authorize.indexOf('canUseAiConnect(viewer.user.id)')<authorize.indexOf('<AiConsent'));
  const consent=read('app/api/ai/consent/route.ts');
  assert.ok(consent.indexOf('canUseAiConnect(viewer.user.id)')<consent.indexOf('createAuthorizationCode({'),'no code for other accounts');
  assert.match(read('app/mcp/route.ts'),/if \(!verified \|\| !canUseAiConnect\(verified\.userId\)\) return unauthorized/);
  /* Попперс не рассказывает игрокам о нейросетях. */
  const guide=read('lib/poppers-site-guide.ts');
  assert.ok(!/НЕЙРОСЕТИ|ChatGPT|Claude/.test(guide));
});
