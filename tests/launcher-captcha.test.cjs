/* r086: капча для API лаунчера (app/api/auth/captcha/route.ts). Лаунчер 0.2.16
   рисует картинку сам по полю icon и знает только свои спрайты. */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const SECRET='k'.repeat(40);
function loadRoute(){
  const out=ts.transpileModule(fs.readFileSync('app/api/auth/captcha/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const exports={};
  const stubs={
    'node:crypto':require('node:crypto'),
    'next/server':{NextResponse:{json:body=>({body,cookies:{set(){}},headers:{set(){}}})}},
    '@/lib/captcha':{CAPTCHA_COOKIE:'c',signCaptcha:()=>'sealed'},
    '@/lib/minecraft-icons':{resolveMinecraftIcon:name=>name},
  };
  vm.runInNewContext(out,{exports,require:name=>stubs[name]??{},Buffer,Math,process:{env:{POPPERSCRAFT_BROWSER_SECRET:SECRET}}});
  return exports.GET;
}
const GET=loadRoute();
const ask=headers=>GET(new Request('https://www.popperscraft.org/api/auth/captcha',{headers})).then(r=>r.body);
const LAUNCHER_SPRITES=['grass','book','chest','creeper','diamond','record','redstone','totem'];

test('the browser gets no item names',async()=>{
  for(const headers of [{},{'x-popperscraft-browser-key':'wrong'},{'x-popperscraft-browser-key':SECRET+'x'}]){
    const body=await ask(headers);
    assert.equal(body.options.length,4);
    for(const option of body.options)assert.deepEqual(Object.keys(option).sort(),['id','label']);
  }
});

test('the launcher API gets icons the launcher can draw',async()=>{
  for(let i=0;i<30;i++){
    const body=await ask({'x-popperscraft-browser-key':SECRET});
    assert.equal(body.options.length,4);
    for(const option of body.options){
      assert.ok(LAUNCHER_SPRITES.includes(option.icon),option.icon);
      assert.match(option.id,/^[A-Za-z0-9_-]{20,64}$/);
    }
    assert.match(body.prompt,/^Нажми на (алмаз|блок травы|сундук|редстоун|пластинку|тотем)$/);
  }
});
