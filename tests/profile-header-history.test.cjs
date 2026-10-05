const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ts=require('typescript');
function load(file){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require});return exports;}
const {createHeaderHistory,headerHistoryReducer:step,canUndoHeader,HEADER_HISTORY_LIMIT}=load('lib/profile-header-history.ts');
const {emptyPixelHeaderArt,colorsToPixelHeaderArt}=load('lib/profile-header-art.ts');
const art=(n=1,color='#ffffff')=>colorsToPixelHeaderArt(Array.from({length:576},(_,i)=>i<n?color:null));
const fresh=()=>createHeaderHistory({frames:[emptyPixelHeaderArt(),art(3)],frameIndex:0,frameMs:400});
const equal=(a,b)=>assert.equal(JSON.stringify(a),JSON.stringify(b));
test('a whole brush/eraser gesture is one reversible step, not one step per pixel',()=>{
  const initial=fresh();let state=step(initial,{type:'begin'});
  for(let n=1;n<=20;n++)state=step(state,{type:'paint',art:art(n)});
  assert.equal(state.past.length,0);assert.ok(canUndoHeader(state));
  state=step(state,{type:'end'});assert.equal(state.past.length,1);
  const undo=step(state,{type:'undo'});equal(undo.present,initial.present);
  equal(step(undo,{type:'redo'}).present,state.present);equal(initial.present.frames[0],emptyPixelHeaderArt());
});
test('fill and clear are each reversible without a pointer gesture',()=>{
  let state=step(fresh(),{type:'paint',art:art(576)});
  state=step(state,{type:'paint',art:emptyPixelHeaderArt()});
  assert.equal(state.past.length,2);equal(step(state,{type:'undo'}).present.frames[0],art(576));
  equal(step(step(state,{type:'undo'}),{type:'redo'}).present.frames[0],emptyPixelHeaderArt());
});
test('empty gestures/no-op paint do not consume undo or discard redo; new edits discard redo',()=>{
  let state=step(step(fresh(),{type:'paint',art:art()}),{type:'undo'});
  state=step(step(state,{type:'begin'}),{type:'end'});
  state=step(state,{type:'paint',art:emptyPixelHeaderArt()});
  assert.equal(state.future.length,1);assert.equal(state.past.length,0);
  state=step(state,{type:'paint',art:art(2)});assert.equal(state.future.length,0);
});
test('undo on another frame restores the edited frame and never overwrites its neighbour',()=>{
  let state=step(fresh(),{type:'paint',art:art(10)});
  state=step(state,{type:'select',index:1});assert.equal(state.past.length,1);
  state=step(state,{type:'undo'});assert.equal(state.present.frameIndex,0);equal(state.present.frames[1],art(3));
});
test('adding/removing frames and changing speed can be undone/redone exactly',()=>{
  const initial=fresh();let state=step(initial,{type:'add',maxFrames:8});
  assert.equal(state.present.frames.length,3);assert.equal(state.present.frameIndex,2);
  state=step(state,{type:'paint',art:art(16)});const beforeRemove=state.present;
  state=step(state,{type:'remove'});equal(step(state,{type:'undo'}).present,beforeRemove);
  state=step(state,{type:'speed',ms:800});assert.equal(step(state,{type:'undo'}).present.frameMs,400);
  for(let n=0;n<4;n++)state=step(state,{type:'undo'});equal(state.present,initial.present);
  for(let n=0;n<4;n++)state=step(state,{type:'redo'});assert.equal(state.present.frameMs,800);
});
test('undo during a gesture finalizes it once; duplicate end/cancel events are harmless',()=>{
  let state=step(step(fresh(),{type:'begin'}),{type:'paint',art:art(12)});
  state=step(state,{type:'undo'});equal(state.present.frames[0],emptyPixelHeaderArt());assert.equal(state.future.length,1);
  equal(step(step(state,{type:'end'}),{type:'end'}),state);
});
test('history is bounded; frame limits, first frame, invalid selections and endpoints are safe',()=>{
  let state=fresh();equal(step(state,{type:'undo'}),state);equal(step(state,{type:'redo'}),state);
  equal(step(state,{type:'add',maxFrames:2}),state);equal(step(state,{type:'select',index:99}),state);
  state=step(state,{type:'remove'});equal(step(state,{type:'remove'}),state);
  for(let n=1;n<=150;n++)state=step(state,{type:'paint',art:art(n)});
  assert.equal(state.past.length,HEADER_HISTORY_LIMIT);
});
test('manual RU/EN labels cover buttons, accessible group and shortcuts',()=>{
  const {EN_PHRASES}=load('lib/i18n/en.ts');
  const {createTranslator}=load('lib/i18n/translate.ts');const translate=createTranslator(EN_PHRASES);
  for(const label of ['↶ ШАГ НАЗАД','↷ ШАГ ВПЕРЁД','История рисунка','Отменить последнее изменение (Ctrl/Cmd+Z)','Вернуть отменённое изменение (Ctrl/Cmd+Shift+Z, Ctrl+Y)'])assert.ok(!/[А-Яа-яЁё]/.test(translate(label)),label);
});
