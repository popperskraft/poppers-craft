/* r088: видео-инструкция на странице лаунчера появляется только после
   нажатия «Скачать» — для выбранной системы (macOS или Windows). */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const read=p=>fs.readFileSync(p,'utf8');
function load(p,require=()=>({})){const exports={};vm.runInNewContext(ts.transpileModule(read(p),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require,URLSearchParams});return exports;}

test('no instruction until a download button is pressed',()=>{
  const page=read('app/launcher/page.tsx');
  assert.ok(!page.includes('<LauncherVideo'),'the page no longer renders the video by itself');
  assert.match(page,/<LauncherDownloads>[\s\S]*platform="macos"[\s\S]*platform="windows"[\s\S]*platform="linux"[\s\S]*<\/LauncherDownloads>/);
  assert.match(page,/<article className="launcher-platform-card" data-platform=\{platform\}>/);
  const downloads=read('app/launcher/LauncherDownloads.tsx');
  assert.match(downloads,/useState<LauncherVideoPlatform \| null>\(null\)/);
  assert.match(downloads,/\{platform \? <LauncherVideo key=\{platform\} platform=\{platform\} \/> : null\}/);
  /* Клик только отмечает систему: файл скачивается как обычно. */
  assert.ok(!downloads.includes('preventDefault'));
  assert.match(downloads,/if \(chosen !== "macos" && chosen !== "windows"\) return;/);
  /* Чуть-чуть прокручивает, с учётом «уменьшить движение». */
  assert.match(downloads,/window\.scrollBy\(\{ top: shift, behavior: reduced \? "auto" : "smooth" \}\)/);
});

test('each system has its own clip, served from the media folder',()=>{
  const video=read('app/launcher/LauncherVideo.tsx');
  assert.match(video,/file: "\/media\/launcher-install-macos\.mp4"/);
  assert.match(video,/file: "\/media\/launcher-install-windows\.mp4"/);
  assert.match(video,/poster: "\/media\/launcher-install-windows\.jpg"/);
  assert.match(video,/aspect: "16 \/ 9"/);
  const media=read('app/media/[name]/route.ts');
  assert.match(media,/"launcher-install-windows\.mp4": "video\/mp4"/);
  assert.match(media,/"launcher-install-windows\.jpg": "image\/jpeg"/);
});

test('new texts are translated',()=>{
  const {EN_PHRASES}=load('lib/i18n/en.ts');
  const translate=load('lib/i18n/translate.ts').createTranslator(EN_PHRASES);
  for(const text of ['Установка лаунчера на Windows — от скачивания до первого запуска.','Установка лаунчера на Mac — от скачивания до первого запуска.','ВИДЕО-ИНСТРУКЦИЯ'])assert.ok(translate(text),text);
});
