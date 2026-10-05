const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript'),path=require('node:path');
function load(file,mocks={}){const exports={};const req=name=>{if(name in mocks)return mocks[name];if(name==='server-only')return {};if(name.startsWith('@/'))return load(name.slice(2)+'.ts',mocks);if(name.startsWith('.'))return load(path.join(path.dirname(file),name)+'.ts',mocks);return require(name);};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,{exports,require:req,Buffer,Blob,Request,Response,URL,console,process,Date,structuredClone});return exports;}
const pure=load('lib/wiki-discussion.ts'),content=load('lib/wiki-content.ts'),editor=load('lib/wiki-editor.ts');
test('rating accepts half stars from 0.5 to 5; aggregates per person and per article',()=>{
 for(const score of [0.5,1,1.5,2,2.5,3,3.5,4,4.5,5])assert.ok(pure.validWikiRating(score));
 for(const score of [0,6,1.2,'5',null,true,NaN])assert.ok(!pure.validWikiRating(score));
 const r=pure.summarizeWikiRatings([{source_key:pure.WIKI_RATING_PREFIX+'1:a',body:'rating:5'},{source_key:pure.WIKI_RATING_PREFIX+'1:b',body:'rating:3'},{source_key:pure.WIKI_RATING_PREFIX+'2:c',body:'rating:1'},{source_key:pure.WIKI_RATING_PREFIX+'1:a',body:'rating:1'},{source_key:pure.WIKI_RATING_PREFIX+'1:hack',body:'rating:6'}],1,'b');
 assert.equal(r.count,2);assert.equal(r.average,2);assert.equal(r.mine,3);
});
test('whole threads include nested, orphaned and cyclic legacy replies exactly once',()=>{
 const rows=[{id:1,parentId:null},{id:2,parentId:1},{id:3,parentId:2},{id:4,parentId:3},{id:5,parentId:99},{id:6,parentId:7},{id:7,parentId:6}];
 const threads=pure.wikiThreads(rows);
 assert.deepEqual(Array.from(threads[0].replies,r=>r.id),[2,3,4]);
 const seen=threads.flatMap(t=>[t.root.id,...t.replies.map(r=>r.id)]);
 assert.equal(seen.length,7);assert.equal(new Set(seen).size,7);
});
test('image IDs are not truncated at 80 characters and existing content styles survive',()=>{
 const imageId='uploads/12345678-1234-1234-1234-123456789012/2026-09-29/12345678-1234-1234-1234-123456789012.png';
 const blocks=content.normalizeWikiBlocks([{id:'image',type:'image',imageId,caption:'Caption',alt:'Alt'},{id:'text',type:'paragraph',text:'Text',font:'system',color:'#123456'}]);
 assert.equal(blocks[0].imageId,imageId);assert.equal(blocks[0].caption,'Caption');assert.equal(blocks[1].font,'system');
});
test('local recovery is account-scoped, validated and does not persist arbitrary image URLs',()=>{
 const document={title:'Draft',summary:'',category:'ГАЙДЫ',tags:'one',blocks:[{id:'image',type:'image',imageId:'uploads/u/image.png',imageUrl:'javascript:bad'}]};
 const raw=JSON.stringify({version:1,userId:'u',savedAt:'now',updatedAt:'v1',document});
 assert.equal(editor.parseWikiLocalDraft(raw,'other'),null);
 const restored=editor.parseWikiLocalDraft(raw,'u');assert.ok(restored);assert.equal(restored.document.blocks[0].imageUrl,undefined);
 assert.equal(editor.wikiDocumentKey(document),editor.wikiDocumentKey({...document,blocks:[{...document.blocks[0],imageUrl:'https://new-url'}]}));
 assert.equal(editor.parseWikiLocalDraft('{bad','u'),null);
});
test('image signing and article input reject traversal and encoded paths',()=>{
 for(const p of ['uploads/u/../v/image.png','uploads/u/%2e%2e/v.png','uploads/u//image.png','https://example.com/image.png'])assert.equal(content.isWikiImagePath(p),false);
 assert.equal(content.isWikiImagePath('uploads/u/2026-09-29/photo.png'),true);
 const result=load('lib/wiki-input.ts').parseWikiArticleInput({title:'Article',status:'published',blocks:[{id:'img',type:'image',imageId:'uploads/u/../v/image.png'}]});
 assert.equal(result.value,null);
});
function setup(options={}){
 const rows=options.rows??[],uploads=[],updates=[],upserts=[],notifications=[];
 const article={row:{id:10,source_key:'__wiki_article__:demo',updated_at:'v1'},payload:{version:1,slug:'demo',authorId:'u',summary:'',category:'ГАЙДЫ',tags:[],status:options.draft?'draft':'published',contentPath:'articles/demo.json',publishedAt:'2026-09-01'}};
 const db={from:()=>{let filters=[],operation=null,single=false,offset=null;
  const q={select:()=>q,eq:(k,v)=>(filters.push(row=>row[k]===v),q),in:(k,vs)=>(filters.push(row=>vs.includes(row[k])),q),order:()=>q,range:(a,b)=>(offset=[a,b],q),update:v=>(operation=['update',v],q),upsert:(v,opts)=>(operation=['upsert',v],assert.equal(opts.onConflict,'source_key'),q),insert:v=>(operation=['insert',v],q),delete:()=>{throw Error('destructive delete called')},maybeSingle:()=>{single=true;return q},single:()=>{single=true;return q},then:(resolve,reject)=>Promise.resolve().then(()=>{
   let data=rows.filter(row=>filters.every(filter=>filter(row)));
   if(operation){const [op,value]=operation;
    if(op==='update'){updates.push(value);if(options.race)data=[];else data.forEach(row=>Object.assign(row,value));}
    if(op==='upsert'){assert.ok(value.body.length>=3&&value.body.length<=1200,'site_updates body constraint');upserts.push(value);const row=rows.find(row=>row.source_key===value.source_key);if(row)Object.assign(row,value);else rows.push({...value,id:rows.length+100});data=[value];}
    if(op==='insert'){const row={...value,id:rows.length+100};rows.push(row);data=[row];}
   }
   if(offset)data=data.slice(offset[0],offset[1]+1);
   return {data:single?data[0]??null:data,error:null};
  }).then(resolve,reject)};return q;},
  storage:{from:()=>({upload:async(p,b,o)=>{uploads.push({path:p,body:JSON.parse(await b.text()),options:o});return{error:null}},remove:()=>{throw Error('destructive storage removal called')}})}
 };
 const wiki={getWikiIndexById:async()=>article,parseWikiCommentRow:row=>({row,payload:JSON.parse(row.body)}),encodeWikiRecord:JSON.stringify,WIKI_ARTICLE_PREFIX:'__wiki_article__:',WIKI_COMMENT_PREFIX:'__wiki_comment__:',WIKI_BUCKET:'wiki',ensureWikiBucket:async()=>{},readWikiDocument:async()=>{if(options.contentUnavailable)throw Error('offline');return {blocks:[],coverArt:options.oldArt??null}},readWikiContent:async()=>[],wikiRatings:async(ids,user)=>new Map(ids.map(id=>[id,pure.summarizeWikiRatings(rows,id,user)]))};
 const mocks={'next/server':{NextResponse:{json:(body,init)=>Response.json(body,init)}},'@/lib/community':{getCommunityViewer:async()=>options.guest?null:{user:{id:options.user??'u'},adminProfile:options.admin?{}:null}},'@/lib/waitlist':{sameOriginOrMissing:()=>!options.crossOrigin},'@/lib/request-security':{consumeRateLimit:async()=>({allowed:!options.limited}),rateLimitResponse:()=>Response.json({error:'rate'},{status:429})},'@/lib/supabase/admin':{createSupabaseAdminClient:()=>db},'@/lib/wiki':wiki};
 mocks['@/lib/wiki-publication-notify']={queueWikiPublication:async slug=>{if(options.queueUnavailable)throw Error('offline');notifications.push(slug)}};
 return{rows,uploads,updates,upserts,notifications,article,mocks,route:p=>load(p,mocks)};
}
const req=(method,body)=>new Request('https://www.popperscraft.org/api/wiki',{method,headers:{'content-type':'application/json'},body:JSON.stringify(body)});
const params=id=>({params:Promise.resolve({id:String(id)})});
const ratingRoute='app/api/wiki/articles/[id]/rating/route.ts';
test('ratings require auth, same origin, published article, valid input and rate limit',async()=>{
 for(const [opts,score,status] of [[{guest:true},4,401],[{crossOrigin:true},4,403],[{},'4',400],[{draft:true},4,404],[{limited:true},4,429]]){const s=setup(opts);assert.equal((await s.route(ratingRoute).POST(req('POST',{score}),params(10))).status,status);assert.equal(s.upserts.length,0);}
});
test('changing a rating updates the same unique record rather than adding another vote',async()=>{
 const s=setup();const r=s.route(ratingRoute);
 assert.equal((await r.POST(req('POST',{score:5}),params(10))).status,200);
 const result=await(await r.POST(req('POST',{score:3.5}),params(10))).json();
 assert.equal(result.rating.count,1);assert.equal(result.rating.mine,3.5);assert.equal(result.rating.average,3.5);assert.equal(s.rows.length,1);
});
const commentRow=(id,parentId,extra={})=>({id,source_key:'__wiki_comment__:10:'+id,title:'wiki-comment:10',published:false,body:JSON.stringify({version:1,articleId:10,authorId:'u',parentId,body:'original',...extra})});
test('replying to a reply works, but cross-article and deleted targets are rejected',async()=>{
 const route='app/api/wiki/articles/[id]/comments/route.ts';
 for(const [row,status] of [[commentRow(2,1),200],[commentRow(2,1,{articleId:11}),400],[commentRow(2,1,{deletedAt:'now'}),400]]){
  const s=setup({rows:[row]});const response=await s.route(route).POST(req('POST',{body:'Nested reply',parentId:2}),params(10));
  assert.equal(response.status,status);if(status===200)assert.equal(JSON.parse(s.rows[1].body).parentId,2);
 }
});
test('comment deletion keeps original data and every reply, with owner/admin enforcement',async()=>{
 const route='app/api/wiki/comments/[id]/route.ts';
 for(const [opts,status] of [[{user:'other'},403],[{user:'u'},200],[{user:'admin',admin:true},200]]){
  const s=setup({...opts,rows:[commentRow(1,null),commentRow(2,1),commentRow(3,2)]});
  const response=await s.route(route).DELETE(req('DELETE',{}),params(1));
  assert.equal(response.status,status);assert.equal(s.rows.length,3);assert.equal(JSON.parse(s.rows[1].body).body,'original');
  if(status===200){assert.ok(JSON.parse(s.rows[0].body).deletedAt);assert.equal(JSON.parse(s.rows[0].body).body,'original');}
 }
});
const articleBody={title:'Useful guide',summary:'',category:'ГАЙДЫ',tags:[],blocks:[{id:'b',type:'paragraph',text:'hello',font:'pixel',color:'#161616'}],status:'published',expectedUpdatedAt:'v1'};
test('article save rejects stale version or wrong owner before any upload',async()=>{
 for(const [opts,version,status] of [[{},'old',409],[{user:'other'},'v1',403]]){
  const s=setup(opts);assert.equal((await s.route('app/api/wiki/articles/[id]/route.ts').PATCH(req('PATCH',{...articleBody,expectedUpdatedAt:version}),params(10))).status,status);assert.equal(s.uploads.length,0);
 }
});
test('article save uses immutable revision + compare-and-swap; keeps previous files',async()=>{
 for(const race of [false,true]){
  const row={id:10,source_key:'__wiki_article__:demo',updated_at:'v1'};const s=setup({race,rows:[row]});
  const response=await s.route('app/api/wiki/articles/[id]/route.ts').PATCH(req('PATCH',articleBody),params(10));
  assert.equal(response.status,race?409:200);assert.equal(s.uploads.length,1);assert.ok(s.uploads[0].path.startsWith('articles/demo/'));assert.equal(s.uploads[0].options.upsert,false);
  if(!race)assert.equal(JSON.parse(row.body).contentPath,s.uploads[0].path);
 }
});
test('new wiki UI strings have manual English translations',()=>{
 const {EN_PHRASES}=load('lib/i18n/en.ts'),translate=load('lib/i18n/translate.ts').createTranslator(EN_PHRASES);
 const files=['app/wiki/WikiArticleEditor.tsx','app/wiki/WikiComments.tsx','app/wiki/WikiRating.tsx','app/wiki/WikiLibrary.tsx','app/wiki/articles/[slug]/page.tsx','app/api/wiki/articles/[id]/route.ts','app/api/wiki/articles/[id]/rating/route.ts','app/api/wiki/articles/[id]/comments/route.ts','app/api/wiki/images/refresh/route.ts'];
 files.push('app/PixelStars.tsx','app/profile/PixelHeaderEditor.tsx','app/players/[login]/ProfileReviews.tsx','app/api/profiles/[login]/reviews/route.ts','lib/wiki-input.ts','app/api/wiki/articles/route.ts');
 for(const file of files){const source=ts.createSourceFile(file,fs.readFileSync(file,'utf8'),99,true);function visit(n){
  let text=null;if(ts.isStringLiteralLike(n)||ts.isJsxText(n))text=n.text.replace(/\s+/g,' ').trim();
  if(ts.isTemplateExpression(n))text=n.head.text+n.templateSpans.map((p,i)=>'{'+i+'}'+p.literal.text).join('');
  if(text&&/[А-Яа-яЁё]/.test(text)){const result=translate(text);assert.ok(result&&!/[А-Яа-яЁё]/.test(result),file+': '+text+' => '+result);}
  ts.forEachChild(n,visit);
 }visit(source)}
});
test('library removes WIKI TXT and preserves author artwork, tags and ratings',()=>{
 const source=fs.readFileSync('app/wiki/WikiLibrary.tsx','utf8');assert.ok(!source.includes('WIKI TXT'));assert.ok(!source.includes('wiki-article-card-placeholder'));
 assert.match(source,/WikiAuthor author/);assert.match(source,/wiki-tags/);assert.match(source,/article.rating.average/);
 const backend=fs.readFileSync('lib/wiki.ts','utf8');assert.match(backend,/profile_header_art/);assert.match(backend,/frames: true/);
});

test('fractional display, ranking, validation and legacy ratings remain compatible',()=>{
 const stars=load('lib/star-rating.ts');
 assert.deepEqual([1,2,3,4,5].map(n=>stars.starFill(3.5,n)),[1,1,1,.5,0]);
 const items=[{id:1,rating:{average:0,count:0}},{id:2,rating:{average:3.5,count:2}},{id:3,rating:{average:5,count:1}},{id:4,rating:{average:.5,count:1}}].map(a=>({...a,publishedAt:null,updatedAt:'2026-09-29'}));
 assert.deepEqual(items.sort(stars.compareArticleRatings).map(a=>a.id),[3,2,4,1]);
 for(const score of [-1,0,0.1,3.25,5.5,Infinity,'3.5',null])assert.equal(stars.validStarRating(score),false);
 const r=pure.summarizeWikiRatings([{source_key:pure.WIKI_RATING_PREFIX+'1:a',body:'rating:3.5'},{source_key:pure.WIKI_RATING_PREFIX+'1:b',body:'rating:5'},{source_key:pure.WIKI_RATING_PREFIX+'1:c',body:'rating:0.5'}],1,'a');
 assert.equal(r.count,3);assert.equal(r.average,3);assert.equal(r.mine,3.5);
});
const painted=()=>({palette:['#123456'],pixels:'0'.repeat(576)});
test('artwork is validated, stored in content and survives old clients and draft recovery',async()=>{
 const input=load('lib/wiki-input.ts');
 assert.ok(input.parseWikiArticleInput({...articleBody,coverArt:painted()}).value.coverArt);
 for(const art of [{palette:['javascript:evil'],pixels:'0'.repeat(576)},{palette:['#123456'],pixels:'0'},'<script>'])assert.equal(input.parseWikiArticleInput({...articleBody,coverArt:art}).value,null);
 for(const [coverArt,expected] of [[undefined,painted()],[null,null],[painted(),painted()]]){
  const s=setup({oldArt:painted(),rows:[{id:10,source_key:'__wiki_article__:demo',updated_at:'v1'}]});
  const r=await s.route('app/api/wiki/articles/[id]/route.ts').PATCH(req('PATCH',{...articleBody,coverArt}),params(10));
  assert.equal(r.status,200);assert.deepEqual(s.uploads[0].body.coverArt,expected);
 }
 const doc={...articleBody,tags:'',coverArt:painted()};
 const draft=editor.parseWikiLocalDraft(JSON.stringify({version:1,userId:'u',savedAt:'now',updatedAt:'v1',document:doc}),'u');
 assert.equal(JSON.stringify(draft.document.coverArt),JSON.stringify(painted()));
 assert.notEqual(editor.wikiDocumentKey(doc),editor.wikiDocumentKey({...doc,coverArt:null}));
});
test('unavailable previous content blocks save instead of losing artwork',async()=>{
 const s=setup({contentUnavailable:true});
 assert.equal((await s.route('app/api/wiki/articles/[id]/route.ts').PATCH(req('PATCH',articleBody),params(10))).status,503);
 assert.equal(s.uploads.length,0);
});
test('only first publication queues chat; notification failure prevents publication',async()=>{
 for(const first of [true,false]){
  const s=setup({rows:[{id:10,source_key:'__wiki_article__:demo',updated_at:'v1'}]});
  if(first)s.article.payload.publishedAt=null;
  assert.equal((await s.route('app/api/wiki/articles/[id]/route.ts').PATCH(req('PATCH',articleBody),params(10))).status,200);
  assert.equal(s.notifications.length,first?1:0);
 }
 for(const status of ['draft','published']){
  const s=setup();
  assert.equal((await s.route('app/api/wiki/articles/route.ts').POST(req('POST',{...articleBody,status,coverArt:painted()}))).status,200);
  assert.equal(s.notifications.length,status==='published'?1:0);assert.deepEqual(s.uploads[0].body.coverArt,painted());
 }
 const s=setup({queueUnavailable:true});s.article.payload.publishedAt=null;
 assert.equal((await s.route('app/api/wiki/articles/[id]/route.ts').PATCH(req('PATCH',articleBody),params(10))).status,503);assert.equal(s.updates.length,0);
 const old=setup({rows:[{id:10,source_key:'__wiki_article__:demo',updated_at:'v1'}]});
 await old.route('app/api/wiki/articles/[id]/route.ts').PATCH(req('PATCH',{...articleBody,status:'draft'}),params(10));
 assert.equal(JSON.parse(old.updates[0].body).publishedAt,'2026-09-01');assert.equal(old.notifications.length,0);
});
test('profile API stores half-star values without rounding and rejects invalid values',async()=>{
 const writes=[];
 const db={from:table=>{const q={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:{user_id:'target',login:'other'},error:null}),upsert:async value=>{writes.push(value);return {error:null}}};return q}};
 const mocks={'next/server':{NextResponse:{json:(body,init)=>Response.json(body,init)}},'@/lib/supabase/admin':{createSupabaseAdminClient:()=>db},'@/lib/community':{getCommunityViewer:async()=>({user:{id:'u'},profile:{login:'tester'}})},'@/lib/player-marks':{marksFor:async()=>({plus:false})},'@/lib/waitlist':{sameOriginOrMissing:()=>true,normalizeLogin:x=>x}};
 const route=load('app/api/profiles/[login]/reviews/route.ts',mocks);
 for(const rating of [.5,3.5,5,3.2,0,'3.5']){
  const response=await route.POST(req('POST',{rating,comment:'Test review'}),{params:Promise.resolve({login:'other'})});
  assert.equal(response.status,typeof rating==='number'&&[.5,3.5,5].includes(rating)?200:400);
 }
 assert.deepEqual(writes.map(w=>JSON.parse(w.body).rating),[.5,3.5,5]);
 const rows=writes.map((w,i)=>({...w,source_key:'__profile_review__:target:u'+i,created_at:'2026-09-29'}));
 const q={select:()=>q,in:()=>q,eq:async()=>({data:rows,error:null})};
 const reviews=load('lib/profile-reviews.ts',{'@/lib/supabase/admin':{createSupabaseAdminClient:()=>({from:()=>q})},'@/lib/player-marks':{playerMarks:async()=>new Map()}});
 const result=await reviews.listProfileReviews('target','u1');assert.equal(result.myReview.rating,3.5);assert.equal(result.averageRating,3);
});
