const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ts=require('typescript');
const React=require('react');
const {renderToStaticMarkup}=require('react-dom/server');
function load(file,dependencies={}){
 const exports={};const output=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 vm.runInNewContext(output,{exports,require:name=>Object.hasOwn(dependencies,name)?dependencies[name]:require(name)});return exports;
}
const shared=load('lib/streak.ts');
const css={default:new Proxy({},{get:(_,name)=>String(name)})};
const {PlayerStreak}=load('app/players/PlayerStreak.tsx',{'@/lib/streak':shared,'./PlayerStreak.module.css':css});
const {PlayerPresence}=load('app/players/PlayerPresence.tsx',{'./PlayerPresence.module.css':css});
const {EN_PHRASES}=load('lib/i18n/en.ts');
const translate=load('lib/i18n/translate.ts').createTranslator(EN_PHRASES);
const current={currentDays:3,bestDays:30,playedToday:true,today:'2026-10-01',lastActiveDay:'2026-10-01',updatedAt:'2026-10-01T12:00:00Z',flameSrc:'/streak/flames/test-current.svg'};
const badge=data=>React.createElement(PlayerStreak,{login:'alice',initialStreak:data});

test('only the current flame and count are visible, with no future catalogue or details',()=>{
 const html=renderToStaticMarkup(badge(current));
 assert.equal((html.match(/<img /g)||[]).length,1);
 assert.match(html,/src="\/streak\/flames\/test-current\.svg"/);
 assert.match(html,/title="Ударный режим: 3 дня"/);
 assert.match(html,/aria-label="Ударный режим: 3 дня"/);
 assert.match(html,/>3<\/span>/);
 assert.doesNotMatch(html,/<details|<summary|<button|<ol|progressbar|data-level|30 дней|следующ|РЕКОРД|Правила|365|24 варианта/);
});
test('zero and unavailable hide the badge without inventing a zero or revealing a record',()=>{
 for(const value of [null,{...current,currentDays:0,flameSrc:null},{...current,flameSrc:null}])assert.equal(renderToStaticMarkup(badge(value)),'');
});
test('flame belongs beside the status label, above the date, including online and unknown last seen',()=>{
 const offline=renderToStaticMarkup(React.createElement(PlayerPresence,{online:false,lastSeen:'2026-09-30T21:00:00Z',trailing:badge(current)}));
 assert.ok(offline.indexOf('Последний раз в игре:')<offline.indexOf('role="img"'));
 assert.ok(offline.indexOf('role="img"')<offline.indexOf('<time'));
 assert.match(offline,/datetime="2026-09-30T21:00:00Z"/i);
 const online=renderToStaticMarkup(React.createElement(PlayerPresence,{online:true,trailing:badge(current)}));
 assert.match(online,/В ИГРЕ/);assert.match(online,/role="img"/);assert.doesNotMatch(online,/<time/);
 const unknown=renderToStaticMarkup(React.createElement(PlayerPresence,{online:false,trailing:badge(current)}));
 assert.match(unknown,/Нет данных о последней игре/);assert.match(unknown,/role="img"/);
});
test('tooltip and accessible names support manual RU/EN forms',()=>{
 for(const [n,en] of [[1,'1 day'],[2,'2 days'],[3,'3 days'],[5,'5 days'],[21,'21 days'],[365,'365 days']]){
  assert.equal(translate(`Ударный режим: ${shared.formatStreakDays(n)}`),`Daily streak: ${en}`);
 }
 assert.equal(translate('Не удалось загрузить ударный режим.'),'Could not load the daily streak.');
});
test('client component never imports a future tier table',()=>{
 const source=fs.readFileSync('app/players/PlayerStreak.tsx','utf8');
 assert.doesNotMatch(source,/STREAK_LEVELS|STREAK_FLAMES|getStreakLevel|streak-art/);
 assert.equal('STREAK_LEVELS' in shared,false);
});
