// Explicit live probe against Google's public, verification-only score demo.
// No account/profile, site secret, form submission, or model is used.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { recaptchaV3Native } from '../src/recaptcha-v3.js';
import { challengeOrigins } from '../src/challenge-common.js';

const url = 'https://recaptcha-demo.appspot.com/recaptcha-v3-request-scores.php';
const output = resolve('output/playwright/live-recaptcha-v3', new Date().toISOString().replaceAll(':', '-'));
await mkdir(output, { recursive: true });
const extensionMode = process.argv.includes('--extension');
let browser, context, temporary;
if (extensionMode) {
  temporary = await mkdtemp(join(tmpdir(), 'ocr-v3-demo-'));
  const extension = join(temporary, 'extension');await cp(resolve('dist'), extension, { recursive: true });
  const manifest = JSON.parse(await readFile(join(extension, 'manifest.json'), 'utf8'));
  manifest.permissions = [...new Set([...manifest.permissions, 'webNavigation'])];
  manifest.host_permissions = [new URL(url).origin + '/*', ...challengeOrigins(['recaptcha-v3'])];
  await writeFile(join(extension, 'manifest.json'), JSON.stringify(manifest));
  context = await chromium.launchPersistentContext(join(temporary, 'profile'), { channel: 'chromium', headless: true, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
} else { browser = await chromium.launch({ channel: 'chromium', headless: true });context = await browser.newContext(); }
const page = await context.newPage();
const report = { provider: 'recaptcha-v3', kind: extensionMode ? 'official public demo through full extension session' : 'official public demo using native adapter', url, startedAt: new Date().toISOString() };
try {
  await page.addInitScript(() => {
    window.submitAttempts = 0;
    document.addEventListener('submit', event => { event.preventDefault(); window.submitAttempts++; }, true);
    HTMLFormElement.prototype.submit = function () { window.submitAttempts++; };
  });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !document.querySelector('.step3')?.classList.contains('hidden'), undefined, { timeout: 30000 });
  if (extensionMode) {
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const ui = await context.newPage();await ui.goto(`chrome-extension://${new URL(worker.url()).host}/control.html`);
    const send = (type, data = {}) => ui.evaluate(async payload => { const response = await chrome.runtime.sendMessage(payload);if (!response?.ok) throw new Error(response?.error || 'Extension request failed.');return response.value; }, { type, ...data });
    const tabId = await worker.evaluate(async sourceURL => (await chrome.tabs.query({})).find(tab => tab.url === sourceURL).id, url);
    await page.bringToFront();
    const receipts = [];
    page.on('response', async response => {
      const location = new URL(response.url());
      if (location.origin === new URL(url).origin && location.pathname === '/recaptcha-v3-verify.php') {
        try { const value = await response.json();receipts.push({ success: value.success, score: value.score, action: value.action, hostname: value.hostname, challengeTimestamp: value.challenge_ts, errorCodes: value['error-codes'] }); } catch { /* Invalid responses are reported by the adapter. */ }
      }
    });
    const startedAt = Date.now();
    await send('CHALLENGE_START', { tabId, sourceURL: url, providers: ['recaptcha-v3'], autoVerify: true });
    for (let attempt = 0; attempt < 150; attempt++) {
      report.session = await send('CHALLENGE_GET', { tabId });
      if (!report.session.active) break;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    report.elapsedMs = Date.now() - startedAt;
    if (report.session?.active) await send('CHALLENGE_STOP', { tabId });
    report.receipts = receipts;
    report.accepted = report.session?.state === 'widget-verified' && receipts.some(receipt => receipt.success === true && receipt.score >= .5 && receipt.action === 'examples/v3scores' && receipt.hostname === 'recaptcha-demo.appspot.com');
  } else {
    const expected = await page.evaluate(recaptchaV3Native, { op: 'inspect' });
    report.plan = { action: expected.action, verification: expected.verification, callbackPresent: expected.callbackPresent };
    report.result = await page.evaluate(recaptchaV3Native, { op: 'execute', requestId: randomUUID(), expected, timeoutMs: 25000 });
    report.accepted = report.result.state === 'server-verified' && report.result.serverVerified === true;
    assert.ok(!Object.hasOwn(report.result, 'token'));
  }
  report.submitAttempts = await page.evaluate(() => window.submitAttempts);
  report.formCount = await page.locator('form').count();
  assert.equal(report.submitAttempts, 0);
  assert.equal(report.formCount, 0);
  if (!report.accepted) process.exitCode = 1;
} catch (error) {
  report.accepted = false;
  report.error = error.message;
  process.exitCode = 1;
} finally {
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ report: join(output, 'report.json'), ...report }, null, 2));
  await context.close();await browser?.close();
  if (temporary) await rm(temporary, { recursive: true, force: true });
}
