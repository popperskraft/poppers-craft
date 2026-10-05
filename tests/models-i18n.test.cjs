const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
function moduleAt(file){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports});return exports;}
const {EN_PHRASES}=moduleAt('lib/i18n/en.ts'),{createTranslator}=moduleAt('lib/i18n/translate.ts'),translate=createTranslator(EN_PHRASES),cyrillic=/[А-Яа-яЁё]/;
function translated(value,context='') {const result=translate(value);assert.ok(result,`${context}: Missing English translation for ${value}`);assert.ok(!cyrillic.test(result),`${context}: Incomplete translation: ${result}`);return result;}
test('every skin editor label, option, hint, accessibility name and local error has a dictionary translation',()=>{
 const files=['app/models/SkinCarousel.tsx','app/profile/SkinForm.tsx','app/models/HumanEditor.tsx','app/models/ModelEditor.tsx','app/models/HumanViewport.tsx','app/models/PonyViewport.tsx','app/models/ModelVisibility.tsx','app/models/SkinCatalog.tsx','app/models/SkinPalette.tsx','app/models/ModelStudio.tsx','app/models/page.tsx','lib/human-skin.ts','lib/character-models.ts','lib/model-visibility.ts','app/api/profile/models/route.ts','app/api/profile/skin/route.ts'];
 for(const file of files){const source=ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true);function visit(node){if((ts.isStringLiteralLike(node)||ts.isJsxText(node))&&cyrillic.test(node.text))translated(node.text.replace(/\s+/g,' ').trim(),file);ts.forEachChild(node,visit);}visit(source);}
});
test('profile models section and its editor button are translated',()=>{
 /* r092: редакторы — в студии «Редактировать профиль». */const source=fs.readFileSync('app/profile/ProfileEditStudio.tsx','utf8'),section=source.match(/<p>CHARACTER_MODELS[\s\S]*?<\/section>/)?.[0];assert.ok(section);
 const ast=ts.createSourceFile('section.tsx',section,ts.ScriptTarget.Latest,true);function visit(node){if(ts.isJsxText(node)&&cyrillic.test(node.text))translated(node.text);ts.forEachChild(node,visit);}visit(ast);
 assert.equal(translate('ОТКРЫТЬ РЕДАКТОР →'),'OPEN EDITOR →');
});
test('dynamic colors, brush sizes, hidden counts, part titles and combined save messages remain fully English',()=>{
 assert.equal(translate('Цвет #aabbcc'),'Color #aabbcc');assert.equal(translate('Размер кисти: 4 px'),'Brush size: 4 px');assert.equal(translate('Скрыто частей: 3'),'Hidden parts: 3');
 assert.equal(translate('Части тела'),'Parts of the body');assert.equal(translate('Части внешнего слоя'),'Parts of the outer layer');
 assert.equal(translate('Рог — без внешнего слоя'),'Horn — no outer layer');
 translated('Скин сохранён, но переключить модель не удалось. Попробуйте применить ещё раз.');
 translated('Человек выбран, скин сохранён в аккаунте и доступен в лаунчере. Для обновления скина в игре перезайдите на сервер. Новые штрихи ещё не сохранены.');
 for(const label of ['Каталог PonySkincraft','Каталог Skindex','Основа и шрифт —','¾ длины'])translated(label);
});
