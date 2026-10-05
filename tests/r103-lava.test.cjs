/* r103: lava.top — оплата картой не из России. */
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const read=(file)=>fs.readFileSync(file,'utf8');

test('lava.top offers, invoice and webhook auth',()=>{
  const lava=read('lib/lava.ts');
  for(const id of ['07bf2b19-cc2d-4ab8-92a3-fa06249136a5','f6f46a28-cea9-46ad-8fda-428d8c6e3ff0','7e54cbf4-3e31-467a-8572-e08de2808ef3','c4cc64b9-43b4-42a9-9545-f8bdba4c19a0','130a8a28-6874-4635-869e-2456f95c6dc5'])assert.ok(lava.includes(id),id);
  assert.match(lava,/"\/api\/v3\/invoice"/);
  assert.match(lava,/timingSafeEqual\(Buffer\.from\(expected\), Buffer\.from\(supplied\)\)/);
  assert.match(lava,/process\.env\.LAVA_PUBLIC === "1"/);
  assert.ok(!/[0-9A-Za-z]{60}/.test(lava),'no API key in the code');
});

test('lava payments use the same apply path and skip YooKassa sync',()=>{
  const payments=read('lib/payments.ts');
  assert.match(payments,/if \(lava\) return startLavaPayment\(/);
  assert.match(payments,/if \(row\.provider && row\.provider !== "yookassa"\) \{/);
  assert.match(payments,/\.eq\("provider", "yookassa"\)\n\s*\.in\("status", \["created", "pending"\]\)/);
  assert.match(payments,/if \(type === "subscription\.recurring\.payment\.success" && contractId && event\.parentContractId\)/);
  assert.match(payments,/return applyPayment\(updated\);/);
  const route=read('app/api/payments/lava/webhook/route.ts');
  assert.match(route,/if \(!lavaWebhookAuthorized\(request\.headers\.get\("x-api-key"\)\)\)/);
  assert.match(read('app/donation/PaymentDialog.tsx'),/\{summary\.lava \? \(/);
});
