const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('admin rights are never granted by a matching e-mail alone', () => {
  const waitlist = read('lib/waitlist.ts');
  assert.match(waitlist, /if \(!protectedProfile\?\.user_id \|\| protectedProfile\.user_id !== user\.id\) return null;/);
  assert.match(waitlist, /if \(!data\.user_id \|\| data\.user_id !== user\.id\) return null;/);
  assert.doesNotMatch(waitlist, /\.update\(\{ user_id: user\.id \}\)/);
});

test('the application form refuses staff e-mails', () => {
  const route = read('app/api/waitlist/route.ts');
  assert.match(route, /from\("admin_profiles"\)\.select\("id"\)\.eq\("email", email\)/);
  assert.match(route, /isProtectedAdminEmail\(email\)/);
});

test('password and Telegram logins never bind an admin profile by e-mail', () => {
  for (const file of ['app/api/login/route.ts', 'app/api/auth/telegram/route.ts']) {
    assert.doesNotMatch(read(file), /\.update\(\{ user_id:/, file);
  }
});

test('owners\' personal e-mails live in the server environment, not in the code', () => {
  const waitlist = read('lib/waitlist.ts');
  assert.doesNotMatch(waitlist, /icloud\.com|plitle\.plitle/);
  assert.match(waitlist, /process\.env\.PC_OWNER_EMAIL/);
  assert.match(waitlist, /\.filter\(\(email\): email is string => Boolean\(email\)\)/);
});
