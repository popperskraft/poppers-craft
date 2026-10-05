/* r096: ответы Попперса без звёздочек и решёток (lib/poppers-format.ts,
   app/PoppersRichText.tsx) и передача человека оператору, когда ИИ
   недоступен (lib/poppers-outage.ts). */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const read=p=>fs.readFileSync(p,'utf8');
function load(p,extra={}){const exports={};vm.runInNewContext(ts.transpileModule(read(p),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,URL,String,Number,Error,console,...extra});return exports;}
const f=load('lib/poppers-format.ts');
const plain=nodes=>f.inlinePlainText(nodes);
const flat=value=>JSON.parse(JSON.stringify(value));

/* Ответ Попперса, который прислал владелец (сокращён). */
const SAMPLE=`Чтобы начать игру на PoppersCraft, вам нужно подать анкету, дождаться её одобрения администрацией, оплатить разовый пропуск и скачать наш лаунчер.

Вот пошаговый путь:

1.  **Лист ожидания → Анкета**: На главной странице заполните форму.
2.  **Ожидание**: Игроки будут голосовать за вашу заявку в разделе «Вайтлист».
3.  **Оплата**: Пропуск POPPERSCRAFT стоит 499 ₽.
4.  **Играть → Скачать лаунчер**: После оплаты перейдите в раздел «Играть» (/members).

Если возникнут сложности, напишите @PoppersCraftAuthBot.`;

test('owner sample: paragraphs and a numbered list with bold step names, no asterisks',()=>{
  const blocks=flat(f.parsePoppersText(SAMPLE));
  assert.deepEqual(blocks.map(block=>block.type),['paragraph','paragraph','list','paragraph']);
  const list=blocks[2];
  assert.equal(list.ordered,true);
  assert.deepEqual(list.items.map(item=>item.number),[1,2,3,4]);
  const first=flat(f.parseInline(list.items[0].text));
  assert.equal(first[0].type,'strong');
  assert.equal(plain(first[0].children),'Лист ожидания → Анкета');
  assert.equal(plain(first),'Лист ожидания → Анкета: На главной странице заполните форму.');
  const text=f.poppersPlainText(SAMPLE);
  assert.ok(!text.includes('*'),'no asterisks left');
  assert.match(text,/^1\. Лист ожидания → Анкета: На главной странице заполните форму\.$/m);
  assert.match(text,/^4\. Играть → Скачать лаунчер: После оплаты перейдите в раздел «Играть» \(\/members\)\.$/m);
});

test('headings, bullets, rules, tables and quotes',()=>{
  const blocks=flat(f.parsePoppersText('## Как попасть на сервер\n- первый пункт\n* второй пункт\n---\n| Тариф | Цена |\n|---|---|\n| PLUS | 199 ₽ |\n> цитата\n### Итог ###'));
  assert.deepEqual(blocks,[
    {type:'heading',text:'Как попасть на сервер'},
    {type:'list',ordered:false,items:[{number:null,text:'первый пункт'},{number:null,text:'второй пункт'}]},
    {type:'paragraph',text:'Тариф · Цена\nPLUS · 199 ₽\nцитата'},
    {type:'heading',text:'Итог'},
  ]);
  assert.equal(f.poppersPlainText('## Шаги\n- раз\n- два'),'Шаги\n\n• раз\n• два');
  /* Строка с отступом после пункта — продолжение пункта. */
  assert.deepEqual(flat(f.parsePoppersText('1. Шаг\n   подробнее'))[0].items,[{number:1,text:'Шаг\nподробнее'}]);
});

test('inline marks; nicknames, maths and stray marks',()=>{
  assert.equal(plain(f.parseInline('Ник qerqex_ и tomac_777 не трогаем')),'Ник qerqex_ и tomac_777 не трогаем');
  assert.equal(plain(f.parseInline('2 * 3 = 6')),'2 * 3 = 6');
  assert.equal(plain(f.parseInline('**Важно** и *курсив* и _тоже_ и `код` и ~~старое~~')),'Важно и курсив и тоже и код и старое');
  assert.equal(plain(f.parseInline('Оборванный **жирный и *звёздочка')),'Оборванный жирный и звёздочка');
  const types=flat(f.parseInline('**Важно** и *курсив*')).map(node=>node.type);
  assert.deepEqual(types,['strong','text','em']);
});

test('links: only the site, its subdomains and t.me are clickable',()=>{
  const site=flat(f.parseInline('Откройте [лаунчер](/launcher)'));
  assert.deepEqual(site[1],{type:'link',href:'/launcher',children:[{type:'text',text:'лаунчер'}]});
  const map=flat(f.parseInline('Карта: https://map.popperscraft.org.'));
  assert.equal(map[1].type,'link');
  assert.equal(map[1].href,'https://map.popperscraft.org/');
  assert.equal(map[2].text,'.','trailing dot stays outside the link');
  assert.deepEqual(flat(f.parseInline('[жми](https://evil.example/x)')),[{type:'text',text:'жми (https://evil.example/x)'}]);
  assert.equal(f.safeHref('javascript:alert(1)'),null);
  assert.equal(f.safeHref('//evil.example'),null);
  assert.equal(f.safeHref('http://popperscraft.org'),null,'only https');
  assert.equal(f.safeHref('https://t.me/popperskraft'),'https://t.me/popperskraft');
  /* В Telegram ссылки на страницы сайта — полным адресом. */
  assert.equal(f.poppersPlainText('Скачайте [лаунчер](/launcher)'),'Скачайте лаунчер (https://popperscraft.org/launcher)');
});

test('chat renders Poppers answers with formatting, without raw HTML',()=>{
  const chat=read('app/PoppersAssistant.tsx');
  assert.match(chat,/message\.role === "assistant" && !message\.kind \? \(/);
  assert.match(chat,/<PoppersRichText text=\{message\.text\} \/>/);
  const rich=read('app/PoppersRichText.tsx');
  assert.ok(!rich.includes('dangerouslySetInnerHTML'));
  assert.match(rich,/target: "_blank", rel: "noopener noreferrer"/);
  assert.match(read('app/globals.css'),/\.poppers-assistant-log > :is\(p, div\) \{\n  max-width: 92%;/);
  assert.match(read('app/text-containment.css'),/\.poppers-rich ul,\n\.poppers-rich ol \{/);
});

test('AI outage: owner gets a bot message at most every 30 minutes per cause',async()=>{
  const sent=[];const limits=[];
  const outage=load('lib/poppers-outage.ts',{Request,require:(name)=>name==='@/lib/request-security'
    ?{consumeRateLimit:async(_request,options)=>{limits.push(options);return{allowed:limits.length===1};}}
    :{notifySupportAdmins:async(text)=>{sent.push(text);return{sent:1,configured:true};}}});
  assert.equal(outage.poppersOutageReason(new Error('telegram-failed')),null,'not an AI failure');
  assert.equal(outage.poppersOutageReason(new Error('gemini-429')).key,'quota');
  assert.equal(outage.poppersOutageReason(new Error('gemini-403')).key,'key');
  assert.equal(outage.poppersOutageReason(new Error('gemini-network')).key,'down');
  await outage.reportPoppersOutage(new Error('gemini-429'),'чат на сайте');
  await outage.reportPoppersOutage(new Error('gemini-429'),'чат на сайте');
  await outage.reportPoppersOutage(new Error('something-else'),'чат на сайте');
  assert.equal(sent.length,1,'second alert is rate-limited, non-AI errors are ignored');
  assert.match(sent[0],/ПОППЕРС НЕ ОТВЕЧАЕТ/);
  assert.match(sent[0],/закончились токены/);
  assert.match(sent[0],/вопросы сразу уходят операторам/);
  assert.deepEqual({scope:limits[0].scope,key:limits[0].key,limit:limits[0].limit,windowSeconds:limits[0].windowSeconds},{scope:'poppers-outage-alert',key:'quota',limit:1,windowSeconds:1800});
});

test('AI outage: the person is handed to an operator on the site and in Telegram',()=>{
  const route=read('app/api/poppers/route.ts');
  assert.match(route,/catch \(error\) \{\n\s*after\(\(\) => reportPoppersOutage\(error, "чат на сайте"\)\);\n\s*generated = \{\n\s*answer: english \? "Poppers can't answer on his own right now\." : "Попперс сейчас не может ответить сам\.",\n\s*needsHuman: true,/);
  assert.ok(!route.includes('Попперс не смог связаться с Gemini'));
  const bot=read('lib/telegram-support-bot.ts');
  assert.match(bot,/await reportPoppersOutage\(error, "Telegram-бот"\);\n\s*await saveSession\(user\.id, \{ \.\.\.session, history: \[\.\.\.session\.history, \["u", clean\(text, TURN_CHARS\)\]\] \}\);\n\s*await send\(chatId, "Попперс сейчас не может ответить сам — передаю ваш вопрос команде\."\);\n\s*await openTicket\(chatId, user\);/);
  assert.match(bot,/const plain = poppersPlainText\(answer\) \|\| answer;/);
  const business=read('app/api/telegram/business/route.ts');
  assert.match(business,/after\(\(\) => reportPoppersOutage\(error, "Telegram Business"\)\);/);
  assert.match(business,/const plain = poppersPlainText\(answer\) \|\| answer;/);
});
