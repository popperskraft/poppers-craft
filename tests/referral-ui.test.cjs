const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function moduleAt(file, globals = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, URL, Event, ...globals });
  return exports;
}

const codeModule = moduleAt('lib/referral-code.ts');
const code = 'abcdef0123456789abcdef01';

function browser(href = 'https://popperscraft.org/rules', stored = new Map()) {
  const events = [];
  const window = {
    location: { href },
    localStorage: {
      getItem: (key) => stored.get(key) ?? null,
      setItem: (key, value) => stored.set(key, value),
      removeItem: (key) => stored.delete(key),
    },
    dispatchEvent: (event) => events.push(event.type),
    history: {
      state: { preserved: true },
      replaceState(state, _, url) {
        assert.deepEqual(state, { preserved: true });
        window.location.href = new URL(url, window.location.href).href;
      },
    },
  };
  return { window, stored, events };
}

function storageApi(window) {
  return moduleAt('app/referral-storage.ts', { window, require: (id) => {
    assert.equal(id, '@/lib/referral-code');
    return codeModule;
  } });
}

test('a referral entering any page survives browsing and a language-switch reload', () => {
  const env = browser(`https://popperscraft.org/rules?ref=${code}`);
  const api = storageApi(env.window);
  assert.equal(api.captureReferralFromUrl(), code);
  env.window.location.href = 'https://popperscraft.org/#waitlist';
  assert.equal(api.captureReferralFromUrl(), code);
  assert.equal(storageApi(env.window).captureReferralFromUrl(), code);
  assert.equal(env.stored.get(codeModule.REFERRAL_STORAGE_KEY), code);
});

test('a newer link wins; editing the field then wins over that link across reloads', () => {
  const otherCode = '0123456789abcdef01234567';
  const env = browser(`https://popperscraft.org/?ref=${code}&donationInterest=1#waitlist`);
  const api = storageApi(env.window);
  api.captureReferralFromUrl();
  env.window.location.href = `https://popperscraft.org/?ref=${otherCode}&donationInterest=1#waitlist`;
  assert.equal(api.captureReferralFromUrl(), otherCode);
  const invitation = `https://popperscraft.org/?ref=${code}#waitlist`;
  api.updateReferralDraft(invitation);
  assert.equal(env.window.location.href, 'https://popperscraft.org/?donationInterest=1#waitlist');
  assert.equal(storageApi(env.window).captureReferralFromUrl(), invitation);
  assert.ok(env.events.includes(api.REFERRAL_CHANGED_EVENT));
});

test('invalid and ambiguous invitations remain visible instead of silently disappearing', () => {
  const env = browser('https://popperscraft.org/?ref=invalid-code');
  const api = storageApi(env.window);
  assert.equal(api.captureReferralFromUrl(), 'invalid-code');
  assert.equal(codeModule.normalizeReferralCode(api.readReferralDraft()), null);
  env.window.location.href = `https://popperscraft.org/?ref=${code}&ref=other`;
  assert.equal(api.captureReferralFromUrl(), env.window.location.href);
  assert.equal(codeModule.normalizeReferralCode(api.readReferralDraft()), null);
});

test('explicit removal or successful form reset cannot resurrect the original invitation', () => {
  const env = browser(`https://popperscraft.org/?ref=${code}#waitlist`);
  const api = storageApi(env.window);
  api.captureReferralFromUrl();
  api.updateReferralDraft('');
  assert.equal(env.stored.has(codeModule.REFERRAL_STORAGE_KEY), false);
  assert.equal(api.readReferralDraft(), '');
  assert.equal(storageApi(env.window).captureReferralFromUrl(), '');
});

test('unavailable browser storage still keeps the referral in the current tab', () => {
  const env = browser(`https://popperscraft.org/rules?ref=${code}`);
  env.window.localStorage = { getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); }, removeItem() { throw Error('blocked'); } };
  const api = storageApi(env.window);
  assert.equal(api.captureReferralFromUrl(), code);
  env.window.location.href = 'https://popperscraft.org/';
  assert.equal(api.captureReferralFromUrl(), code);
  api.updateReferralDraft('');
  assert.equal(api.readReferralDraft(), '');
});

test('referral UI and server errors have complete human-written English dictionary coverage', () => {
  const { EN_PHRASES } = moduleAt('lib/i18n/en.ts');
  const { createTranslator } = moduleAt('lib/i18n/translate.ts');
  const translate = createTranslator(EN_PHRASES);
  const cyrillic = /[А-Яа-яЁё]/;
  const files = ['app/ReferralField.tsx', 'app/profile/ReferralPanel.tsx', 'lib/referrals.ts', 'app/api/referrals/route.ts'];
  for (const file of files) {
    const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    function visit(node) {
      if ((ts.isStringLiteralLike(node) || ts.isJsxText(node)) && cyrillic.test(node.text)) {
        const value = node.text.replace(/\s+/g, ' ').trim();
        const result = translate(value);
        assert.ok(result, `${file}: no translation for ${value}`);
        assert.ok(!cyrillic.test(result), `${file}: incomplete translation for ${value}`);
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  for (const phrase of ['необязательные поля отмечены отдельно', 'ПРИГЛАСИТЬ ДРУГА', 'Не удалось отправить анкету. Проверь соединение и попробуй ещё раз — заполненные поля сохранены.']) {
    assert.ok(translate(phrase));
  }
});
