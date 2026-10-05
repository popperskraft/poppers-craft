const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const ts=require('typescript');
test('Carousel has one free slot and five Hype slots, pony saving is gated',()=>{
 const source=fs.readFileSync('app/models/SkinCarousel.tsx','utf8');assert.ok(source.includes('wardrobe?.limit === 5 ? 5 : 1'));assert.ok(source.includes('Array.from({length: limit}'));assert.ok(source.includes('kind === "pony" && wardrobe && limit === 1'));
 const editor=fs.readFileSync('app/models/ModelEditor.tsx','utf8');assert.ok(editor.includes('disabled={profile?.wardrobe.limit===1||'));
 for(const name of ['app/models/SkinCarousel.tsx','app/models/ModelEditor.tsx'])assert.equal(ts.transpileModule(fs.readFileSync(name,'utf8'),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX},reportDiagnostics:true}).diagnostics?.filter(d=>d.category===ts.DiagnosticCategory.Error).length,0);
});
