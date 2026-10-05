const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, mocks = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, require: name => mocks[name] ?? {}, console, Date, Number, Map, Set, Buffer, process });
  return exports;
}
const verifier = load('lib/payment-verification.ts');
const row = { id: 'order-1', amount: 499, provider_payment_id: 'provider-1', status: 'pending', kind: 'pass', test: false, applied_at: null };
const paid = { id: 'provider-1', metadata: { payment_id: 'order-1' }, amount: { value: '499.00', currency: 'RUB' }, status: 'succeeded', paid: true, test: false };

test('only the exact paid order and RUB amount qualify', () => {
  assert.doesNotThrow(() => verifier.verifyProviderPayment(row, paid));
  for (const patch of [
    { id: 'other' }, { metadata: {} }, { metadata: { payment_id: 'other' } },
    { amount: { value: '0.00', currency: 'RUB' } },
    { amount: { value: '499.01', currency: 'RUB' } },
    { amount: { value: '499.00', currency: 'USD' } },
    { amount: { value: 'NaN', currency: 'RUB' } }, { paid: false },
  ]) assert.throws(() => verifier.verifyProviderPayment(row, { ...paid, ...patch }));
});

function setup(provider) {
  const writes = [], applied = [];
  const database = {
    from: () => ({
      select: () => ({ eq: () => ({ not: () => ({ maybeSingle: async () => ({ data: null }) }) }) }),
      update(patch) { writes.push(patch); return { eq() { return { select() { return { single: async () => ({ data: { ...row, ...patch }, error: null }) }; } }; } }; },
    }),
    rpc: async (name, args) => { applied.push({ name, args }); return { data: 'applied' }; },
  };
  const payments = load('lib/payments.ts', {
    '@/lib/payment-verification': verifier,
    '@/lib/supabase/admin': { createSupabaseAdminClient: () => database },
    '@/lib/yookassa': { getYooPayment: async () => provider, paymentMethodTitle: () => null },
  });
  return { payments, writes, applied };
}

test('synchronization verifies before persisting or applying a mismatched payment', async () => {
  const { payments, writes, applied } = setup({ ...paid, amount: { value: '1.00', currency: 'RUB' } });
  await assert.rejects(payments.syncPayment(row), /payment-amount-mismatch/);
  assert.equal(writes.length, 0);
  assert.equal(applied.length, 0);
});

test('provider test flags cannot turn a test purchase into a real referral reward', async () => {
  for (const [providerTest, orderTest, expectedTest] of [[false, false, false], [true, false, true], [undefined, false, true], [false, true, true]]) {
    const { payments, writes, applied } = setup({ ...paid, test: providerTest });
    await payments.syncPayment({ ...row, test: orderTest });
    assert.equal(writes[0].test, expectedTest);
    assert.equal(applied.length, 1);
    assert.equal(applied[0].name, 'pc_apply_payment');
  }
});

test('already-applied success does not apply or issue rewards again', async () => {
  const { payments, writes, applied } = setup(paid);
  await payments.syncPayment({ ...row, status: 'succeeded', applied_at: new Date().toISOString() });
  assert.equal(writes.length, 0);
  assert.equal(applied.length, 0);
});

test('a confirmed payment whose atomic application failed can be retried', async () => {
  const { payments, writes, applied } = setup(paid);
  await payments.syncPayment({ ...row, status: 'succeeded', applied_at: null });
  assert.equal(writes.length, 0);
  assert.equal(applied.length, 1);
  assert.equal(applied[0].args.p_payment, row.id);
});
