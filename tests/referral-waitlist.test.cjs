const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const source = ts.transpileModule(fs.readFileSync('app/api/waitlist/route.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
class ReferralError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }
const code = '0123456789abcdef01234567';
const body = { login: 'newplayer', email: 'new@example.test', password: 'safe-password', who: 'New player', fromWhere: 'From a friend', whyServer: 'Play together', whyYou: 'Friendly player', acceptRules: true, skinData: 'fixture' };
function setup(options = {}) {
  const calls = { created: 0, inserted: [], validated: [], notices: 0 };
  const admin = {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }), insert: async row => { calls.inserted.push(row); return { error: options.insertError ?? null }; } }),
    auth: { admin: { createUser: async () => { calls.created++; return { data: { user: { id: 'new-id', user_metadata: {} } } }; }, deleteUser: async () => {} } },
  };
  const mocks = {
    'next/server': { NextResponse: { json: (data, init) => Response.json(data, init) } },
    '@/lib/waitlist': { isProtectedAdminEmail: () => false, isValidEmail: () => true, isValidLogin: () => true, normalizeEmail: s => s, normalizeLogin: s => s, sameOriginOrMissing: () => true },
    '@/lib/supabase/admin': { createSupabaseAdminClient: () => admin },
    '@/lib/captcha': { verifyAndConsumeCaptcha: async () => true },
    '@/lib/request-security': { consumeRateLimit: async () => ({ allowed: true }) },
    '@/lib/support-bridge': { notifySupportAdmins: async () => { calls.notices++; } },
    '@/lib/player-skins': { parsePlayerSkinData: () => Buffer.alloc(0), savePlayerSkin: async () => {}, removePlayerSkin: async () => {} },
    '@/lib/social-links': { collectSocialLinks: () => '' },
    '@/lib/mail': { mailEnabled: () => false },
    '@/lib/mail-letters': {}, '@/lib/mail-tokens': {},
    '@/lib/referrals': {
      ReferralError,
      validateReferral: async value => { calls.validated.push(value); if (options.invalid) throw new ReferralError('Приглашение недоступно.', 400); if (options.offline) throw new ReferralError('Проверка недоступна.', 503); return { code }; },
      referralInsertError: error => error.message?.includes('referral-invalid') ? 'Приглашение недоступно.' : null,
    },
  };
  const exports = {};
  vm.runInNewContext(source, { exports, require: name => mocks[name], console, Buffer, Date, Intl });
  return { calls, post: value => exports.POST(new Request('https://www.popperscraft.org/api/waitlist', { method: 'POST', body: JSON.stringify({ ...body, ...value }) })) };
}
test('referral is stored in the same insert as the application, not in a later request', async () => {
  const { calls, post } = setup();
  assert.equal((await post({ referralCode: `https://www.popperscraft.org/?ref=${code}` })).status, 200);
  assert.equal(calls.inserted.length, 1);
  assert.equal(calls.inserted[0].referral_code, code);
  assert.equal(calls.inserted[0].user_id, 'new-id');
});
test('an invalid or unavailable referral blocks before creating the auth account', async () => {
  for (const options of [{ invalid: true }, { offline: true }]) {
    const { calls, post } = setup(options);
    assert.equal((await post({ referralCode: code })).status, options.offline ? 503 : 400);
    assert.equal(calls.created, 0);
    assert.equal(calls.inserted.length, 0);
    assert.equal(calls.notices, 0);
  }
});
test('the normal application flow still works without an invitation', async () => {
  const { calls, post } = setup();
  assert.equal((await post({})).status, 200);
  assert.equal(calls.validated.length, 0);
  assert.equal(calls.inserted[0].referral_code, null);
});
test('a referral invalidated between validation and insert does not report success', async () => {
  const { calls, post } = setup({ insertError: { message: 'referral-invalid' } });
  const response = await post({ referralCode: code });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, 'Приглашение недоступно.');
  assert.equal(calls.notices, 0);
});
