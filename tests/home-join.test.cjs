/* r084: «Как попасть на сервер» над анкетой на главной (app/JoinProcess.tsx). */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const read=p=>fs.readFileSync(p,'utf8');
function load(p,require){const exports={};vm.runInNewContext(ts.transpileModule(read(p),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require});return exports;}
const element=(type,props)=>({type,props});
const {JoinProcess}=load('app/JoinProcess.tsx',name=>{
  if(name==='react/jsx-runtime')return {jsx:element,jsxs:element};
  if(name==='./MinecraftIcon')return {MinecraftIcon:'MinecraftIcon'};
  return {};
});
const titles=tree=>{const out=[];(function walk(node){if(!node||typeof node!=='object')return;if(node.type==='strong')out.push(node.props.children);[node.props?.children].flat(Infinity).forEach(walk);})(tree);return out;};

test('the path: application → players vote → admins decide → pay for entry → play (always five steps)',()=>{
  assert.deepEqual(titles(JoinProcess()),['АНКЕТА','ГОЛОСУЮТ ИГРОКИ','РЕШАЕТ АДМИНИСТРАЦИЯ','ОПЛАТИ ВХОД','ИГРАЙ']);
});

test('the block replaces the old steps inside the guest waitlist section and is translated',()=>{
  const home=read('app/HomePage.tsx');
  const section=home.slice(home.indexOf('<section className="waitlist-section" id="waitlist">'),home.indexOf('<div className="waitlist-grid">'));
  assert.match(section,/<JoinProcess \/>/);
  assert.ok(!home.includes('className="waitlist-steps"'));
  const {EN_PHRASES}=load('lib/i18n/en.ts',()=>({}));const translate=load('lib/i18n/translate.ts',()=>({})).createTranslator(EN_PHRASES);
  const source=ts.createSourceFile('app/JoinProcess.tsx',read('app/JoinProcess.tsx'),99,true);
  (function visit(node){if((ts.isStringLiteralLike(node)||ts.isJsxText(node))&&/[А-Яа-яЁё]/.test(node.text)){const text=node.text.replace(/\s+/g,' ').trim();assert.ok(translate(text),text);}ts.forEachChild(node,visit);})(source);
});
