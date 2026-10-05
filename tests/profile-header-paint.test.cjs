const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function load(path, imports = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, require: name => imports[name] ?? require(name) });
  return exports;
}
const art = load('lib/profile-header-art.ts');
const { floodFillHeaderColors: fill } = load('lib/profile-header-paint.ts', { './profile-header-art': art });
const w = art.PROFILE_HEADER_ART_WIDTH, h = art.PROFILE_HEADER_ART_HEIGHT, count = w * h;
const empty = () => Array(count).fill(null);

test('fills the whole transparent canvas, normalizes colour and leaves input untouched', () => {
  const source = empty(), result = fill(source, 0, 0, '#ABCDEF');
  assert.equal(result.length, count); assert.ok(result.every(c => c === '#abcdef')); assert.ok(source.every(c => c === null));
});
test('fills only the region inside a closed border', () => {
  const source = empty();
  for (let x = 8; x <= 16; x++) source[3*w+x] = source[9*w+x] = '#111111';
  for (let y = 3; y <= 9; y++) source[y*w+8] = source[y*w+16] = '#111111';
  const result = fill(source, 12, 6, '#ff53ba');
  assert.equal(result.filter(c => c === '#ff53ba').length, 35);
  assert.equal(result[0], null);assert.equal(result[3*w+12], '#111111');
});
test('diagonally touching pixels are separate; horizontal neighbours never wrap rows', () => {
  const source = Array(count).fill('#111111');
  source[1*w+1] = source[2*w+2] = source[w-1] = source[w] = null;
  const diagonal = fill(source, 1, 1, '#ffffff');assert.equal(diagonal[2*w+2], null);
  const edge = fill(source, w-1, 0, '#ffffff');assert.equal(edge[w], null);
});
test('can recolour the boundary while leaving different-coloured islands untouched', () => {
  const source = Array(count).fill('#ffffff');source[5*w+5] = '#111111';
  const result = fill(source, w-1, h-1, '#21b1ff');
  assert.equal(result.filter(c => c === '#21b1ff').length, count-1);assert.equal(result[5*w+5], '#111111');
});
test('same colour, invalid colour and out-of-bounds clicks are no-ops', () => {
  const source = Array(count).fill('#abcdef');
  assert.equal(fill(source, 4, 4, '#ABCDEF'), source);
  for (const [x,y] of [[-1,0],[0,-1],[w,0],[0,h],[.5,1],[NaN,0]]) assert.equal(fill(source,x,y,'#ffffff'), source);
  assert.equal(fill(source, 0, 0, 'red'), source);
});
test('fills an erased hole and supports transparency without mutating other animation frames', () => {
  const first = Array(count).fill('#111111'), second = [...first];first[4*w+4] = null;
  assert.equal(fill(first,4,4,'#ff53ba')[4*w+4], '#ff53ba');
  assert.equal(fill(first,0,0,null).filter(c=>c===null).length,count);
  assert.ok(second.every(c=>c==='#111111'));
});
test('filled art round-trips through the existing persisted format without grid data', () => {
  const source = fill(empty(),w-1,h-1,'#24408e');
  const saved = art.colorsToPixelHeaderArt(source);
  assert.equal(JSON.stringify(art.pixelHeaderArtToColors(saved)),JSON.stringify(source));
  assert.equal(JSON.stringify(Object.keys(saved).sort()),JSON.stringify(['palette','pixels']));
});
test('all new UI phrases and tooltips have manual English translations', () => {
  const {EN_PHRASES} = load('lib/i18n/en.ts');
  const {createTranslator} = load('lib/i18n/translate.ts');
  const translate = createTranslator(EN_PHRASES);
  for (const phrase of ['ЗАЛИВКА','СЕТКА','Залить область выбранным цветом','Показать или скрыть пиксельную сетку','Заливка закрашивает соседние пиксели одного цвета. Сетка видна только в редакторе.','× КАДР','Кадры анимации шапки']) {
    assert.ok(translate(phrase),phrase);assert.ok(!/[А-Яа-яЁё]/.test(translate(phrase)));
  }
});
test('grid is an aria-hidden SVG overlay with non-intercepting pointer events, not painted pixels', () => {
  const component = fs.readFileSync('app/profile/PixelHeaderEditor.tsx','utf8');
  const css = fs.readFileSync('app/globals.css','utf8');
  assert.match(component, /<svg className="pixel-header-grid"[^>]*aria-hidden="true"/);
  assert.match(css, /\.pixel-header-grid \{[^}]*pointer-events: none/);
  assert.match(component, /tool !== "fill"\) paint\(event\)/);
  assert.match(component, /value === "eraser" \? "brush" : value/);
});
