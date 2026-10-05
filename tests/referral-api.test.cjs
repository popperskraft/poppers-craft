const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, mocks = {}) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, { exports, require: name => {
    assert.ok(name in mocks, `Unmocked module: ${name}`); return mocks[name];
  }, Buffer, Uint8Array, URL, Response, console: { error() {} } });
  return exports;
}
const { normalizeReferralCode } = load('lib/referral-code.ts');
const code = 'a123456789abcdef01234567';
class ReferralError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }

function setup(options = {}) {
  const calls = [];
  const identity = 'identity' in options ? options.identity : { user: { id: 'signed-in-user' }, needsMfa: false };
  const route = load('app/api/referrals/route.ts', {
    'next/server': { NextResponse: Response },
    '@/lib/waitlist': {
      getViewerIdentity: async () => { if (options.authError) throw Error('private diagnostic'); return identity; },
      sameOriginOrMissing: () => options.sameOrigin !== false,
    },
    '@/lib/request-security': {
      consumeRateLimit: async () => ({ allowed: options.allowed !== false }),
      rateLimitResponse: () => Response.json({ error: 'rate limit' }, { status: 429 }),
    },
    '@/lib/referrals': {
      ReferralError,
      referralSummary: async user => {
        calls.push(['summary', user]);
        if (options.summaryError) throw Error('private database diagnostic');
        return { eligible: true, code, url: `https://www.popperscraft.org/?ref=${code}#waitlist`, invited: 2, rewarded: 1, rewardDays: 30 };
      },
      validateReferral: async value => {
        calls.push(['validate', value]);
        if (options.validationError) throw options.validationError;
        const normalized = normalizeReferralCode(value);
        if (!normalized) throw new ReferralError('Введите реферальную ссылку или код приглашения.');
        return { code: normalized, inviterLogin: 'friend' };
      },
    },
  });
  return { route, calls };
}
const request = (body, headers = {}) => new Request('https://www.popperscraft.org/api/referrals', {
  method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body), headers,
});

test('parser accepts case-insensitive codes and canonical HTTPS links', () => {
  for (const value of [code, ` ${code.toUpperCase()} `, `https://popperscraft.org/?ref=${code}`, `https://www.popperscraft.org/?ref=${code.toUpperCase()}#waitlist`]) {
    assert.equal(normalizeReferralCode(value), code);
  }
});

test('parser rejects external or credentialed URLs, duplicate refs, malformed and oversized inputs', () => {
  for (const value of [null, undefined, {}, 42, '', 'a'.repeat(23), 'g'.repeat(24), 'a'.repeat(2049),
    `https://example.com/?ref=${code}`, `https://popperscraft.org.evil.test/?ref=${code}`,
    `https://evil@popperscraft.org/?ref=${code}`, `https://popperscraft.org:123/?ref=${code}`,
    `http://popperscraft.org/?ref=${code}`, `javascript:${code}`, `/?ref=${code}`,
    `https://popperscraft.org/?ref=${code}&ref=${code}`, 'https://popperscraft.org/?ref=']) {
    assert.equal(normalizeReferralCode(value), null, String(value));
  }
});

test('GET reveals no referral data without authentication and completed MFA', async () => {
  for (const identity of [null, { needsMfa: true, user: { id: 'mfa-pending' } }]) {
    const { route, calls } = setup({ identity }); const response = await route.GET();
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { authenticated: false, eligible: false });
    assert.match(response.headers.get('Cache-Control'), /private, no-store/);
    assert.equal(calls.length, 0);
  }
});

test('GET uses the verified session user and catches authentication/database failures', async () => {
  const { route, calls } = setup(); const response = await route.GET();
  assert.equal((await response.json()).rewardDays, 30);
  assert.deepEqual(calls, [['summary', 'signed-in-user']]);
  for (const options of [{ authError: true }, { summaryError: true }]) {
    const result = await setup(options).route.GET(); assert.equal(result.status, 503);
    assert.doesNotMatch(await result.text(), /private|diagnostic/);
  }
});

test('POST validates invitations for visitors without exposing account IDs', async () => {
  const { route, calls } = setup({ identity: null });
  const response = await route.POST(request({ code, userId: 'forged-user' }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { valid: true, code, inviterLogin: 'friend' });
  assert.deepEqual(calls, [['validate', code]]);
  assert.match(response.headers.get('Cache-Control'), /no-store/);
});

test('POST rejects cross-origin, limited, malformed and oversized requests before validation', async () => {
  for (const [options, body, headers, status] of [
    [{ sameOrigin: false }, { code }, {}, 403], [{ allowed: false }, { code }, {}, 429],
    [{}, { code }, { 'content-length': '99999' }, 413],
    [{}, JSON.stringify({ code, padding: 'x'.repeat(4096) }), {}, 413],
    [{}, JSON.stringify({ code, padding: 'я'.repeat(2100) }), { 'content-length': '10' }, 413],
  ]) {
    const { route, calls } = setup(options); const response = await route.POST(request(body, headers));
    assert.equal(response.status, status); assert.equal(calls.length, 0);
  }
  const malformed = await setup().route.POST(request('{')); assert.equal(malformed.status, 400);
});

test('POST preserves safe validation errors but never leaks unexpected diagnostics', async () => {
  const invalid = await setup({ validationError: new ReferralError('Приглашение недоступно.', 400) }).route.POST(request({ code }));
  assert.equal(invalid.status, 400); assert.equal((await invalid.json()).error, 'Приглашение недоступно.');
  const crash = await setup({ validationError: Error('private diagnostic') }).route.POST(request({ code }));
  assert.equal(crash.status, 503); assert.doesNotMatch(await crash.text(), /private|diagnostic/);
});
