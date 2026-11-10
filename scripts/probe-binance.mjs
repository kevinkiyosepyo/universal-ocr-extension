// Live CAPTCHA-only probe. The standalone official SDK instance has logging
// callbacks, never the host login continuation. No account credentials are used.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { createSolverServer } from '../server/app.mjs';
import { challengeOrigins } from '../src/challenge-common.js';
import { imageBase64 } from '../shared/protocol.js';
const url = 'https://accounts.binance.com/en/login';
const output = resolve('output/playwright/live-binance-extension', new Date().toISOString().replaceAll(':', '-')); await mkdir(output, { recursive: true });
const temp = await mkdtemp(join(tmpdir(), 'ocr-binance-demo-')), extension = join(temp, 'extension');
await cp(resolve('dist'), extension, { recursive: true });
const manifest = JSON.parse(await readFile(join(extension, 'manifest.json'), 'utf8'));
manifest.permissions.push('webNavigation'); manifest.host_permissions = ['http://127.0.0.1/*', ...challengeOrigins(['binance'])];
await writeFile(join(extension, 'manifest.json'), JSON.stringify(manifest));
const key = randomBytes(32).toString('hex'), { server, queue } = createSolverServer({ key, ollamaEndpoint: 'http://127.0.0.1:11435', model: 'qwen3-vl:4b-instruct' });
const captures = [], saved = new Set(), create = queue.create.bind(queue), get = queue.get.bind(queue);
let captureNumber = 0;
queue.create = task => {
  const n = ++captureNumber;
  for (const field of ['image', 'reference']) if (task[field]) captures.push(writeFile(join(output, `task-${n}-${field}.png`), Buffer.from(imageBase64(task[field]), 'base64')));
  return create(task);
};
queue.get = id => {
  const result = get(id);
  if (result.solution && !saved.has(id)) { saved.add(id); captures.push(writeFile(join(output, `solution-${saved.size}.json`), JSON.stringify(result.solution, null, 2) + '\n')); }
  return result;
};
server.listen(0, '127.0.0.1'); await once(server, 'listening');
const context = await chromium.launchPersistentContext(join(temp, 'profile'), { channel: 'chromium', headless: !process.argv.includes('--headed'), args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`], viewport: { width: 1200, height: 900 } });
const report = { provider: 'binance', kind: 'official standalone CAPTCHA SDK through full extension', url, startedAt: new Date().toISOString(), accountSubmission: false, network: [] };
const networkReads = [];
const captchaEndpoint = request => {
  try { const parsed = new URL(request.url()); return parsed.hostname === 'accounts.binance.com' && /^\/bapi\/composite\/v1\/public\/antibot\/(getCaptcha|refreshCaptcha|validateCaptcha)$/.test(parsed.pathname) ? parsed.pathname.split('/').at(-1) : null; } catch { return null; }
};
context.on('response', response => {
  const endpoint = captchaEndpoint(response.request()); if (!endpoint) return;
  networkReads.push((async () => {
    const entry = { endpoint, method: response.request().method(), status: response.status() };
    try {
      const body = await response.json();
      // Never retain request bodies, headers, challenge signatures, or tokens.
      if (typeof body.success === 'boolean') entry.success = body.success;
      if (typeof body.code === 'number' || typeof body.code === 'string' && /^\d{1,10}$/.test(body.code)) entry.code = body.code;
      if (typeof body.data?.result === 'number') entry.result = body.data.result;
      if (typeof body.data?.result_new === 'number') entry.resultNew = body.data.result_new;
      if (['SLIDE', 'IMAGE', 'CHECKBOX', 'POW'].includes(body.data?.captchaType)) entry.type = body.data.captchaType;
      entry.hasData = Boolean(body.data); entry.hasToken = Boolean(body.data?.token);
    } catch { entry.json = false; }
    report.network.push(entry);
  })());
});
context.on('requestfailed', request => {
  const endpoint = captchaEndpoint(request); if (!endpoint) return;
  const error = request.failure()?.errorText;
  report.network.push({ endpoint, method: request.method(), failed: /^net::[A-Z0-9_]+$/.test(error || '') ? error : 'network failure' });
});
let blockedNavigations = 0;
await context.addInitScript(() => {
  window.submitAttempts = 0;
  document.addEventListener('submit', event => { event.preventDefault(); window.submitAttempts++; }, true);
  HTMLFormElement.prototype.submit = function () { window.submitAttempts++; };
});
await context.route('**/*', route => {
  const request = route.request();
  if (request.isNavigationRequest() && !request.frame().parentFrame() && !['GET', 'HEAD'].includes(request.method())) { blockedNavigations++; return route.abort(); }
  return route.continue();
});
try {
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const ui = await context.newPage(); await ui.goto(`chrome-extension://${new URL(worker.url()).host}/control.html`);
  const send = (type, data = {}) => ui.evaluate(async message => { const result = await chrome.runtime.sendMessage(message); if (!result.ok) throw new Error(result.error); return result.value; }, { type, ...data });
  await send('SAVE_SERVICE', { endpoint: `http://127.0.0.1:${server.address().port}`, key });
  const page = await context.newPage(); await page.goto(url, { waitUntil: 'domcontentloaded' });
  report.browser = await page.evaluate(() => ({ userAgent: navigator.userAgent, webdriver: navigator.webdriver, language: navigator.language, viewport: [innerWidth, innerHeight] }));
  await page.waitForFunction(() => typeof window.BCaptcha === 'function', undefined, { timeout: 45000 });
  await page.evaluate(() => {
    window.ocrDemoEvents = [];
    window.ocrDragTrace = null;
    document.addEventListener('mousedown', event => {
      if (!event.target?.closest?.('.bcapc-popup .bs-slide-thumb')) return;
      window.ocrDragTrace = { startX: event.clientX, startY: event.clientY, startAt: performance.now(), moves: 0, trusted: event.isTrusted, mainWorldMouseEvent: event instanceof MouseEvent, windowView: event.view === window };
    });
    document.addEventListener('mousemove', event => { if (ocrDragTrace && !ocrDragTrace.released) { ocrDragTrace.moves++; ocrDragTrace.distance = event.clientX - ocrDragTrace.startX; } });
    document.addEventListener('mouseup', event => { if (ocrDragTrace && !ocrDragTrace.released) { ocrDragTrace.released = true; ocrDragTrace.distance = event.clientX - ocrDragTrace.startX; ocrDragTrace.durationMs = performance.now() - ocrDragTrace.startAt; delete ocrDragTrace.startAt; } });
    window.ocrDemoCaptcha = new BCaptcha({ bizId: 'login', lang: 'en', staticHost: 'https://bin.bnbstatic.com', apiHost: '', apiBasePath: '/bapi/composite/v1/public/antibot' });
    ocrDemoCaptcha.show({ onReady: () => ocrDemoEvents.push('ready'), onLoadSuccess: data => ocrDemoEvents.push({ event: 'loaded', type: data.captchaType }), onValidateSuccess: () => ocrDemoEvents.push('verified'), onValidateFail: () => ocrDemoEvents.push('rejected'), onError: code => ocrDemoEvents.push({ event: 'error', code }), onCancel: () => ocrDemoEvents.push('cancelled'), onClose: () => ocrDemoEvents.push('closed') });
  });
  await page.locator('.bcapc-popup .bs-modal .bs-slide-thumb').waitFor({ timeout: 30000 });
  await page.waitForFunction(() => window.ocrDemoEvents?.includes('ready') && [...document.querySelectorAll('.bs-tipmessage-container')].every(element => element.getBoundingClientRect().width === 0 || getComputedStyle(element).display === 'none'), undefined, { timeout: 30000 });
  await page.waitForFunction(() => { const image=document.querySelector('.bs-main-image'), piece=document.querySelector('.bs-slide-image'); return image && piece && Math.abs(image.getBoundingClientRect().x-piece.getBoundingClientRect().x)<.5; }, undefined, { timeout: 10000 });
  report.initialGeometry = await page.locator('.bs-main-image, .bs-slide-image, .bs-slide-thumb').evaluateAll(elements => elements.map(element => { const { x, y, width, height } = element.getBoundingClientRect(); return { class: element.className, x, y, width, height, left: getComputedStyle(element).left }; }));
  await page.locator('.bcapc-popup').screenshot({ path: join(output, 'before.png') });
  await page.bringToFront(); const tabId = await worker.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url).id, page.url());
  const started = Date.now(); await send('CHALLENGE_START', { tabId, sourceURL: page.url(), providers: ['binance'], autoVerify: true });
  for (let n = 0; n < 180; n++) { report.session = await send('CHALLENGE_GET', { tabId }); if (!report.session.active) break; await new Promise(resolve => setTimeout(resolve, 200)); }
  report.elapsedMs = Date.now() - started; if (report.session.active) await send('CHALLENGE_STOP', { tabId });
  report.events = await page.evaluate(() => window.ocrDemoEvents); report.drag = await page.evaluate(() => window.ocrDragTrace); report.submitAttempts = await page.evaluate(() => window.submitAttempts); report.blockedNavigations = blockedNavigations;
  report.accepted = report.session.state === 'widget-verified' && report.events.includes('verified');
  report.activity = (await worker.evaluate(() => chrome.storage.local.get('activity'))).activity;
  await page.screenshot({ path: join(output, 'after.png') });
  assert.equal(report.submitAttempts, 0); assert.equal(blockedNavigations, 0); assert.equal(page.url(), url);
  if (!report.accepted) process.exitCode = 1;
} catch (error) { report.accepted = false; report.error = error.message; process.exitCode = 1; }
finally {
  await Promise.all(networkReads);
  await Promise.all(captures);
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify({ path: join(output, 'report.json'), ...report }, null, 2));
  await context.close(); queue.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(temp, { recursive: true, force: true });
}
