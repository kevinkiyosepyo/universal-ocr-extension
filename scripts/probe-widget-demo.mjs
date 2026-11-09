// Explicitly invoked acceptance probe. Only the named public demo is opened;
// no account is used and no form Submit control is clicked.
import { chromium } from 'playwright';
import { cp, mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { challengeOrigins } from '../src/challenge-common.js';
import { createSolverServer } from '../server/app.mjs';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { imageBase64 } from '../shared/protocol.js';

const provider = process.argv[2] || 'mtcaptcha';
const browserInput = process.argv.includes('--browser-input');
const demos = {
  mtcaptcha: 'https://service.mtcaptcha.com/mtcv1/demo/index.html',
  'geetest-v4': 'https://gt4.geetest.com/demov4/slide-float-en.html',
  prosopo: 'https://demo.prosopo.io/pow-explicit.html',
  captchafox: 'https://captchafox.com/#demo',
  tencent: 'https://intl.cloud.tencent.com/zh/products/captcha',
  hcaptcha: 'https://accounts.hcaptcha.com/demo',
};
if (!demos[provider]) throw new Error('No reviewed public demo for this provider.');
const out = resolve('output/playwright/live-' + provider, new Date().toISOString().replaceAll(':', '-')); await mkdir(out, { recursive: true });
const temp = await mkdtemp(join(tmpdir(), 'ocr-widget-demo-')), extension = join(temp, 'extension');
const key = randomBytes(32).toString('hex');
const { server, queue } = createSolverServer({ key, model: process.env.OCR_VISION_MODEL || 'qwen3-vl:4b-instruct', textModel: process.env.OCR_TEXT_MODEL ?? 'glm-ocr:q8_0', ollamaEndpoint: process.env.OCR_OLLAMA_ENDPOINT || 'http://127.0.0.1:11435' });
const captures = [], createTask = queue.create.bind(queue); let captureNumber = 0;
queue.create = task => {
  const n = ++captureNumber;
  if (task.image) captures.push(writeFile(join(out, `task-${n}-image.png`), Buffer.from(imageBase64(task.image), 'base64')));
  if (task.reference) captures.push(writeFile(join(out, `task-${n}-piece.png`), Buffer.from(imageBase64(task.reference), 'base64')));
  captures.push(writeFile(join(out, `task-${n}.json`), JSON.stringify({ type: task.type, y: task.y, minLength: task.minLength })));
  return createTask(task);
};
server.listen(0, '127.0.0.1'); await once(server, 'listening');
await cp(resolve('dist'), extension, { recursive: true });
const manifest = JSON.parse(await readFile(join(extension, 'manifest.json'), 'utf8'));
manifest.permissions.push('webNavigation');
if (browserInput) manifest.permissions.push('debugger');
manifest.host_permissions = ['http://127.0.0.1/*', new URL(demos[provider]).origin + '/*', ...challengeOrigins([provider])];
// The disposable profile has no toolbar user gesture to grant activeTab.
// Its test-only grant permits the same screenshot path used by toolbar starts.
if (provider === 'captchafox') manifest.host_permissions.push('<all_urls>');
await writeFile(join(extension, 'manifest.json'), JSON.stringify(manifest));
const context = await chromium.launchPersistentContext(join(temp, 'profile'), {
  channel: 'chromium', headless: false, args: ['--window-size=1200,1050', `--disable-extensions-except=${extension}`, `--load-extension=${extension}`], viewport: null,
});
await context.addInitScript(() => {
  if (window !== window.top) return;
  window.demoSubmitAttempts = 0;
  document.addEventListener('submit', event => { event.preventDefault(); window.demoSubmitAttempts++; }, true);
  HTMLFormElement.prototype.submit = function () { window.demoSubmitAttempts++; };
});
let blockedFormNavigations = 0;
await context.route('**/*', route => {
  const request = route.request();
  if (request.isNavigationRequest() && request.frame().parentFrame() === null && !['GET', 'HEAD'].includes(request.method())) { blockedFormNavigations++; return route.abort(); }
  return route.continue();
});
const report = { provider, browserInput, visionModel: process.env.OCR_VISION_MODEL || 'qwen3-vl:4b-instruct', url: demos[provider], kind: 'official public demo', startedAt: new Date().toISOString(), formSubmissionGuard: true };
process.once('SIGINT', () => { void context.close(); });
let target;
try {
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const ui = await context.newPage(); await ui.goto(`chrome-extension://${new URL(worker.url()).host}/control.html`);
  const send = (type, data = {}) => ui.evaluate(async payload => {
    const response = await chrome.runtime.sendMessage(payload); if (!response.ok) throw new Error(response.error); return response.value;
  }, { type, ...data });
  await send('SAVE_SERVICE', { endpoint: `http://127.0.0.1:${server.address().port}`, key });
  target = await context.newPage(); await target.goto(report.url, { waitUntil: 'domcontentloaded' });
  if (provider === 'mtcaptcha') {
    const widget = target.frameLocator('iframe[src*="/client/iframe.html"]');
    await widget.locator('.mtcap-inputtext').waitFor({ timeout: 40_000 });
    for (let i = 0; i < 100; i++) {
      if (await widget.locator('.mtcap-image').evaluate(element => getComputedStyle(element).backgroundImage.startsWith('url('))) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    await widget.locator('.mtcap-image').screenshot({ path: join(out, 'image.png') });
  } else if (provider === 'geetest-v4') {
    await target.locator('.geetest_btn_click').click();
    await target.locator('.geetest_box .geetest_slide .geetest_bg').waitFor({ timeout: 30_000 });
  } else if (provider === 'tencent') {
    await target.getByText('滑块拼图验证', { exact: true }).click();
    await target.getByText('未开始验证', { exact: true }).click();
    await target.getByRole('checkbox', { name: 'I am human', exact: true }).click();
    await target.waitForFunction(() => [...document.querySelectorAll('#tCaptchaDyMainWrap .tencent-captcha-dy__verify-bg-img, .captcha-demo__button')].some(node => {
      const box = node.getBoundingClientRect();
      return box.width > 0 && box.height > 0 && (node.matches('.tencent-captcha-dy__verify-bg-img') || /验证成功/.test(node.textContent));
    }));
    if (await target.locator('.captcha-demo__button').filter({ hasText: '验证成功' }).isVisible()) {
      report.nativeVerificationObserved = true; report.challengePresented = false; report.adapterTested = false;
      throw Object.assign(new Error('The provider verified the checkbox without presenting a puzzle.'), { code: 'NO_PUZZLE_REQUIRED' });
    }
    await target.locator('#tCaptchaDyMainWrap .tencent-captcha-dy__verify-bg-img').waitFor({ timeout: 30_000 });
    report.challengePresented = true;
  } else if (provider === 'hcaptcha') {
    await target.frameLocator('iframe[title^="Widget containing checkbox"]').getByRole('checkbox').click();
  } else {
    await target.locator(provider === 'prosopo' ? '.prosopo-checkbox input[type="checkbox"]' : '.cf-checkbox-box').waitFor({ timeout: 30_000 });
  }
  await target.screenshot({ path: join(out, 'before.png') });
  await target.bringToFront();
  const tabId = await worker.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url).id, target.url());
  const started = Date.now();
  report.adapterTested = true;
  await send('CHALLENGE_START', { tabId, sourceURL: target.url(), providers: [provider], autoVerify: true, browserInput });
  for (let i = 0; i < (provider === 'hcaptcha' ? 340 : 180); i++) {
    if (provider === 'captchafox' && !report.layers && await target.locator('.cf-slide__canvas canvas').count()) {
      const layers = await target.locator('.cf-slide canvas').evaluateAll(nodes => nodes.map(node => { let image; try { image = node.toDataURL(); } catch {} return { image, width: node.width, height: node.height, style: node.getAttribute('style'), parent: node.parentElement.className }; }));
      report.layers = layers.map(({ image, ...metadata }) => metadata);
      for (let n = 0; n < layers.length; n++) if (layers[n].image) await writeFile(join(out, `layer-${n}.png`), Buffer.from(imageBase64(layers[n].image), 'base64'));
      await target.locator('.cf-slide').screenshot({ path: join(out, 'slide.png') });
    }
    report.outcome = await send('CHALLENGE_GET', { tabId });
    if (!report.outcome.active) break;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  report.elapsedMs = Date.now() - started;
  if (report.outcome?.active) { await send('CHALLENGE_STOP', { tabId }); report.outcome = { state: 'test-time-limit' }; }
  const responseSelector = { mtcaptcha: 'input.mtcaptcha-verifiedtoken', prosopo: '[name="procaptcha-response"]', captchafox: '[name="cf-captcha-response"]', hcaptcha: '[name="h-captcha-response"]' }[provider];
  if (provider === 'tencent') {
    report.demoStatus = await target.locator('.captcha-demo__button').allTextContents();
    report.providerResponsePresent = report.demoStatus.some(text => /验证成功/.test(text));
    report.widgetMessage = await target.locator('#tCaptchaDyMainWrap').allTextContents();
  } else report.providerResponsePresent = responseSelector ? await target.locator(responseSelector).evaluateAll(nodes => nodes.some(node => node.value.length > 0)) : await target.locator('.geetest_captcha').evaluateAll(nodes => nodes.some(node => node.classList.contains('geetest_success')));
  report.accepted = report.providerResponsePresent && report.outcome.state === 'widget-verified';
  if (provider === 'mtcaptcha' && !report.accepted && process.argv.includes('--diagnose-input')) {
    const input = target.frameLocator('iframe[src*="/client/iframe.html"]').locator('.mtcap-inputtext');
    const code = await input.inputValue();
    if (code) {
      await input.fill(''); await input.pressSequentially(code);
      for (let i = 0; i < 40; i++) {
        if (await target.locator('input.mtcaptcha-verifiedtoken').evaluateAll(nodes => nodes.some(node => node.value.length > 0))) { report.browserTypingDiagnosticAccepted = true; break; }
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      report.browserTypingDiagnosticAccepted ||= false;
    }
  }
  if (provider === 'mtcaptcha') report.widgetMessage = await target.frameLocator('iframe[src*="/client/iframe.html"]').locator('.mtcap-msg').allTextContents();
  report.submitAttempts = await target.evaluate(() => window.demoSubmitAttempts);
  report.blockedFormNavigations = blockedFormNavigations;
  await target.screenshot({ path: join(out, 'after.png') });
  report.activity = (await worker.evaluate(() => chrome.storage.local.get('activity'))).activity;
} catch (error) {
  if (error.code === 'NO_PUZZLE_REQUIRED') report.detail = error.message;
  else report.error = error.message;
  if (target && !target.isClosed()) {
    await target.screenshot({ path: join(out, 'error.png') }).catch(() => {});
    if (provider === 'tencent') report.widgetMessage = await target.locator('#tCaptchaDyMainWrap, .captcha-demo__button').allTextContents().catch(() => []);
    report.submitAttempts = await target.evaluate(() => window.demoSubmitAttempts).catch(() => null);
    report.blockedFormNavigations = blockedFormNavigations;
  }
}
await writeFile(join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
await Promise.all(captures);
console.log(JSON.stringify(report, null, 2));
console.log('Evidence: ' + out);
console.log('Test finished. The demo window stays open until you close it or stop this command.');
await context.waitForEvent('close').catch(() => {});
server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
await rm(temp, { recursive: true, force: true });
