import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = join(root, 'output/playwright/smoke');
await mkdir(output, { recursive: true });
const profile = await mkdtemp(join(output, 'profile-'));
const extension = join(root, 'dist');
const context = await chromium.launchPersistentContext(profile, {
  channel: 'chromium', headless: true,
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  viewport: { width: 1280, height: 1000 }, deviceScaleFactor: 2,
});
const report = [];
const failures = [];
const externalRequests = [];
context.on('request', (request) => { if (/^https?:/.test(request.url())) externalRequests.push(request.url()); });
try {
  let worker = context.serviceWorkers()[0];
  if (!worker) worker = await context.waitForEvent('serviceworker');
  const id = new URL(worker.url()).host;
  const page = await context.newPage();
  page.on('pageerror', (error) => failures.push(error.message));
  await context.setOffline(true);
  await page.goto(`chrome-extension://${id}/workspace.html`);
  await page.getByRole('button', { name: 'Choose image', exact: true }).waitFor({ state: 'visible' });
  const ready = () => page.waitForFunction(() => document.querySelector('#cancel').hidden && !document.querySelector('#choose').disabled, undefined, { timeout: 30_000 });
  const upload = async (buffer, name = 'sample.png', mimeType = 'image/png') => {
    await page.locator('#file').setInputFiles({ buffer, name, mimeType });
  };
  const expectText = async (expected) => {
    await page.waitForFunction((text) => document.querySelector('#result').value.trim() === text && document.querySelector('#cancel').hidden && !document.querySelector('#choose').disabled, expected, { timeout: 30_000 });
    return page.locator('#metrics').textContent();
  };
  const image = async (text, dark = false) => {
    const dataURL = await page.evaluate(({ text, dark }) => {
      const canvas = document.createElement('canvas'); canvas.width = 1000; canvas.height = 180;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = dark ? '#17352b' : '#fff'; ctx.fillRect(0, 0, 1000, 180);
      ctx.fillStyle = dark ? '#fff' : '#17352b'; ctx.font = '64px Arial, sans-serif'; ctx.fillText(text, 35, 115);
      return canvas.toDataURL('image/png');
    }, { text, dark });
    return Buffer.from(dataURL.split(',')[1], 'base64');
  };
  await ready();
  await worker.evaluate(() => new Promise((resolve, reject) => {
    chrome.contextMenus.update('ocr-region', { enabled: true }, () => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message)); else resolve(true);
    });
  }));
  report.push({ check: 'Context menu registration', result: 'Capture menu installed successfully' });
  const sample = await image('HELLO OCR 4827');
  await upload(sample);
  report.push({ check: 'Offline English OCR in extension worker', result: await expectText('HELLO OCR 4827') });
  await page.getByLabel('Text layout', { exact: true }).selectOption('line');
  await page.getByText('Character options', { exact: true }).click();
  await page.getByLabel('Characters to recognize').selectOption('digits');
  await page.getByLabel('Remove all spaces').check();
  const digits = await image('572948');
  await upload(digits, 'digits.png');
  report.push({ check: 'Digits-only short code', result: await expectText('572948') });
  await page.getByLabel('Characters to recognize').selectOption('all');
  await page.getByLabel('Remove all spaces').uncheck();
  await upload(sample);
  report.push({ check: 'Whitelist reset across runs', result: await expectText('HELLO OCR 4827') });
  await upload(await image('LOCAL TEXT 2026', true), 'dark.png');
  report.push({ check: 'Automatic dark-background cleanup', result: await expectText('LOCAL TEXT 2026') });
  for (const processing of ['original', 'contrast']) {
    await page.getByLabel('Image cleanup').selectOption(processing);
    await upload(sample);
    report.push({ check: `${processing} cleanup`, result: await expectText('HELLO OCR 4827') });
  }
  await page.getByLabel('Image cleanup').selectOption('auto');
  for (const [language, text] of [['spa', 'Hola mundo 2026'], ['fra', 'Bonjour 2026'], ['deu', 'Guten Tag 2026'], ['jpn', 'こんにちは 2026'], ['kor', '안녕하세요 2026'], ['chi_sim', '你好世界 2026']]) {
    await page.getByLabel('Text language').selectOption(language);
    await upload(await image(text), `${language}.png`);
    await ready();
    const actual = await page.getByRole('textbox', { name: 'Recognized text, editable' }).inputValue();
    assert.equal(actual.replace(/\s+/g, ''), text.replace(/\s+/g, ''), `${language} recognition`);
    report.push({ check: `Bundled ${language} model, offline`, result: actual });
  }
  await page.getByLabel('Text language').selectOption('eng');
  await upload(sample);
  await expectText('HELLO OCR 4827');
  const downloadPending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save .txt' }).click();
  const download = await downloadPending;
  assert.equal(await readFile(await download.path(), 'utf8'), 'HELLO OCR 4827');
  report.push({ check: 'Text download', result: 'Exact text preserved' });
  for (let i = 0; i < 4; i++) {
    await page.getByRole('button', { name: 'Rotate 90°' }).click();
    await ready();
  }
  await page.getByRole('button', { name: 'Read text', exact: true }).click();
  await expectText('HELLO OCR 4827');
  report.push({ check: 'Four rotations and recognition', result: 'Original text recovered' });
  const blank = await sharp({ create: { width: 500, height: 160, channels: 3, background: '#fff' } }).png().toBuffer();
  await upload(blank, 'blank.png');
  await page.getByRole('status').filter({ hasText: 'No text found' }).waitFor();
  assert.equal(await page.getByRole('textbox', { name: 'Recognized text, editable' }).inputValue(), '');
  report.push({ check: 'Empty recognition', result: 'Helpful message and empty result' });
  await upload(Buffer.from('not an image'), 'notes.txt', 'text/plain');
  await page.getByRole('status').filter({ hasText: 'Choose a PNG' }).waitFor();
  await upload(Buffer.from('invalid png'), 'broken.png');
  await page.getByRole('status').filter({ hasText: 'could not be decoded' }).waitFor();
  await upload(Buffer.alloc(15 * 1024 * 1024 + 1), 'oversized.png');
  await page.getByRole('status').filter({ hasText: 'over 15 MB' }).waitFor();
  report.push({ check: 'Invalid, corrupted, and oversized files', result: 'Rejected without breaking the workspace' });
  const rows = Array.from({ length: 90 }, (_, index) => `<text x="40" y="${65 + index * 55}" font-family="Arial" font-size="36">Long document recognition ${index} 572948</text>`).join('');
  const large = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="5100"><rect width="100%" height="100%" fill="white"/>${rows}</svg>`)).png().toBuffer();
  await page.getByLabel('Text layout', { exact: true }).selectOption('block');
  await upload(large, 'large.png');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'Recognition cancelled' }).waitFor();
  await page.getByLabel('Text layout', { exact: true }).selectOption('sparse');
  await upload(sample);
  await expectText('HELLO OCR 4827');
  report.push({ check: 'Cancellation and worker restart', result: 'Cancelled work stopped; next recognition succeeded' });
  await page.screenshot({ path: join(output, 'workspace.png'), fullPage: true, scale: 'css' });
  await page.getByRole('button', { name: 'Clear workspace' }).click();
  assert.equal(await page.locator('#preview').getAttribute('src'), null);
  assert.equal(await page.getByRole('textbox', { name: 'Recognized text, editable' }).inputValue(), '');
  assert.equal(await page.getByRole('button', { name: 'Read text', exact: true }).isDisabled(), true);
  report.push({ check: 'Clear workspace', result: 'Image, source association, and text released' });
  assert.deepEqual(externalRequests, []);
  assert.deepEqual(failures, []);
  report.push({ check: 'Runtime isolation', result: 'No external HTTP requests or uncaught page errors' });
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  for (const item of report) console.log(`PASS ${item.check}: ${item.result}`);
} catch (error) {
  for (const page of context.pages()) {
    if (page.url().includes('workspace.html')) {
      console.error(await page.locator('#status').textContent().catch(() => 'Workspace unavailable'));
      await page.screenshot({ path: join(output, 'failure.png'), fullPage: true }).catch(() => {});
    }
  }
  console.error(JSON.stringify(report, null, 2));
  throw error;
} finally {
  await context.close();
  await rm(profile, { recursive: true, force: true });
}
