const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
function load(file, mocks = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText, { exports, require: name => name in mocks ? mocks[name] : require(name), process, Buffer, URL, Response, Request, Headers, ReadableStream, TextEncoder, console });
  return exports;
}
const installers = load('lib/launcher-installers.ts');
const releases = load('lib/launcher-releases.ts', { './launcher-installers': installers });
const linux = load('app/launcher/LinuxDownloads.tsx', { '@/lib/launcher-installers': installers });
const admin = load('app/admin/AdminLauncherPanel.tsx', { '@/lib/launcher-installers': installers });
const sample = (id, originalName, createdAt, archived = false) => ({ id, platform: 'linux', originalName, createdAt, archived, version: '0.2.18', size: 104745060, sha256: 'abc', createdBy: 'Test', notes: '' });

test('legacy filenames identify separate Linux formats; newest per format, not per OS', () => {
  const rows = [sample('deb-old', 'old.deb', '2026-10-01'), sample('app', 'x.AppImage', '2026-10-03'), sample('deb', 'x.deb', '2026-10-02'), sample('hidden', 'y.deb', '2026-10-04', true)];
  assert.equal(installers.linuxReleasesFor(rows, 'deb')[0].id, 'deb');
  assert.equal(installers.linuxReleasesFor(rows, 'appimage')[0].id, 'app');
  assert.equal(installers.linuxInstallerFor({ platform: 'windows', originalName: 'test.deb' }), null);
  assert.equal(installers.linuxInstallerFor(sample('rpm', 'old.rpm', '2026-10-01')), null);
  assert.equal(installers.launcherReleaseLabel(rows[1]), 'Linux · AppImage');
});

test('public Linux card has one latest AppImage and separate collapsed DEB, without historical versions', () => {
  const rows = [sample('deb-old', 'old.deb', '2026-10-01'), sample('app-old', 'old.AppImage', '2026-10-01'), sample('app', 'x.AppImage', '2026-10-03'), sample('deb', 'x.deb', '2026-10-02')];
  const html = renderToStaticMarkup(React.createElement(linux.LinuxDownloads, { releases: rows }));
  const alternative = renderToStaticMarkup(React.createElement(linux.LinuxAlternativeDownloads, { releases: rows }));
  assert.match(html, /href="\/api\/launcher\/releases\/app\/download" download="x.AppImage"/);
  assert.match(html, /СКАЧАТЬ ↗/);
  assert.match(alternative, /href="\/api\/launcher\/releases\/deb\/download" download="x.deb"/);
  assert.match(alternative, /<details class="launcher-linux-alternatives"><summary>Другие варианты установки Linux/);
  assert.doesNotMatch(html + alternative, /app-old|deb-old|ПРЕДЫДУЩИЕ ВЕРСИИ|<details[^>]*\bopen/);
  assert.doesNotMatch(fs.readFileSync('app/launcher/page.tsx', 'utf8'), /previous|ПРЕДЫДУЩИЕ ВЕРСИИ/);
  const noDeb = renderToStaticMarkup(React.createElement(linux.LinuxAlternativeDownloads, { releases: [rows[2]] }));
  assert.match(noDeb, /DEB пока недоступен/);
  assert.doesNotMatch(noDeb, /\/deb\/download/);
});

test('admin exposes four upload targets and labels both independent Linux records', () => {
  const html = renderToStaticMarkup(React.createElement(admin.AdminLauncherPanel, { initialReleases: [sample('deb', 'x.deb', '2026-10-02'), sample('app', 'x.AppImage', '2026-10-03')] }));
  assert.match(html, /value="deb">Linux · DEB — Ubuntu \/ Debian \/ Mint/);
  assert.match(html, /value="appimage">Linux · AppImage — переносимый/);
  assert.match(html, /launcher-release-platform">Linux · DEB/);
  assert.match(html, /launcher-release-platform">Linux · AppImage/);
  assert.equal(installers.launcherUploadTargets.deb.accept, '.deb');
  assert.equal(installers.launcherUploadTargets.appimage.accept, '.AppImage');
});

test('storage: separate uploads, validation, archive/restore without affecting other formats or platforms', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'poppers-linux-test-'));
  const original = process.env.POPPERSCRAFT_LAUNCHER_STORAGE_DIR;
  process.env.POPPERSCRAFT_LAUNCHER_STORAGE_DIR = dir;
  const put = (platform, installer, originalName) => releases.storeLauncherRelease({ platform, installer, originalName, version: '0.2.18', notes: '', createdBy: 'test', declaredSize: 4, body: new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('test')); c.close(); } }) });
  try {
    const deb = await put('linux', 'deb', 'x.deb');
    const app = await put('linux', 'appimage', 'x.AppImage');
    const mac = await put('macos', '', 'x.dmg');
    const win = await put('windows', '', 'x.exe');
    await assert.rejects(() => put('linux', 'deb', 'wrong.AppImage'), /выберите файл .deb/);
    await assert.rejects(() => put('linux', 'appimage', 'wrong.deb'), /выберите файл .AppImage/);
    await assert.rejects(() => put('linux', 'rpm', 'wrong.rpm'), /Выберите формат Linux/);
    await assert.rejects(() => put('windows', 'deb', 'x.exe'), /Выберите формат Linux/);
    assert.equal((await releases.listLauncherReleases()).length, 4);
    await releases.setLauncherReleaseArchived(deb.id, true, 'test');
    assert.equal(await releases.getActiveLauncherRelease(deb.id), null);
    for (const kept of [app, mac, win]) assert.ok(await releases.getActiveLauncherRelease(kept.id));
    const file = await releases.launcherReleaseFile(deb);
    assert.equal(fs.readFileSync(file.filePath, 'utf8'), 'test', 'archive retains the file');
    await releases.setLauncherReleaseArchived(deb.id, false, 'test');
    assert.equal((await releases.listLauncherReleases()).length, 4);
  } finally {
    if (original === undefined) delete process.env.POPPERSCRAFT_LAUNCHER_STORAGE_DIR;
    else process.env.POPPERSCRAFT_LAUNCHER_STORAGE_DIR = original;
    fs.rmSync(dir, { recursive: true }); // only this test's mkdtemp directory
  }
});

test('new Linux phrases, dynamic sizes and upload states translate to English', () => {
  const { EN_PHRASES } = load('lib/i18n/en.ts');
  const translate = load('lib/i18n/translate.ts').createTranslator(EN_PHRASES);
  for (const phrase of ['Для macOS на Intel и Apple Silicon. Установщик DMG.', 'Для Windows 10 и 11. Установщик EXE.', 'AppImage для Linux на Intel / AMD (x86_64).', 'Другие варианты установки Linux', 'Один файл для большинства дистрибутивов Linux.', 'Скачать для Linux', 'Скачать DEB', 'Другие варианты установки', 'Скачать для Ubuntu / Debian / Mint', 'Скачать AppImage', 'СИСТЕМА И ФОРМАТ', 'Linux · AppImage — переносимый', 'Для Linux DEB выберите файл .deb.', 'Для Linux AppImage выберите файл .AppImage.', 'ФАЙЛ ДЛЯ LINUX · APPIMAGE', 'До 1,5 ГБ · .AppImage', 'v0.2.18 · 104.7 МБ', 'Версия 0.2.18 для Linux · AppImage опубликована.']) {
    const result = translate(phrase);
    assert.ok(result, phrase);
    assert.doesNotMatch(result, /[А-Яа-яЁё]/, phrase);
  }
});
