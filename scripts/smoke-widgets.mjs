import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { mkdtemp, cp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { createSolverServer } from '../server/app.mjs';
import sharp from 'sharp';

const output = resolve('output/widgets'); await mkdir(output, { recursive: true });
const browserInput = process.argv.includes('--browser-input');
const temp = await mkdtemp(join(tmpdir(), 'ocr-widgets-')), extension = join(temp, 'extension');
await cp(resolve('dist'), extension, { recursive: true });
const manifest = JSON.parse(await readFile(join(extension, 'manifest.json'), 'utf8'));
manifest.permissions.push('webNavigation'); manifest.host_permissions = ['http://127.0.0.1/*', 'https://*.mtcaptcha.com/*', 'https://*.geetest.com/*', 'https://*.geevisit.com/*', 'https://*.prosopo.io/*', 'https://*.captchafox.com/*'];
manifest.host_permissions.push('https://turing.captcha.qcloud.com/*', 'https://ca.turing.captcha.qcloud.com/*', 'https://captcha.gtimg.com/*');
manifest.host_permissions.push('<all_urls>'); // Test-only equivalent of toolbar activeTab capture access.
if (browserInput) manifest.permissions.push('debugger');
await writeFile(join(extension, 'manifest.json'), JSON.stringify(manifest));
const html = await readFile('tests/fixtures/widgets.html', 'utf8');
const puzzleHTML = await readFile('tests/fixtures/puzzle.html', 'utf8');
const managedHTML = await readFile('tests/fixtures/managed.html', 'utf8');
const foxHTML = await readFile('tests/fixtures/fox-slide.html', 'utf8');
const pointHTML = await readFile('tests/fixtures/points.html', 'utf8');
const fixture = createServer((req, res) => { res.setHeader('Content-Type', 'text/html'); res.end(`<title>Application fixture</title><iframe width="500" height="400" src="https://service.mtcaptcha.com/mtcv1/client/fixture${new URL(req.url, 'http://fixture').search}"></iframe>`); });
fixture.listen(0, '127.0.0.1'); await once(fixture, 'listening'); const origin = `http://127.0.0.1:${fixture.address().port}`;
let delay = 0, calls = 0, short = false, lastImage, uncertainPoints = false, shapeCalls = 0, shapeSolutions = [];
const firstShapes = [{ x: 250, y: 550 }, { x: 500, y: 700 }, { x: 750, y: 600 }];
const nextShapes = [{ x: 200, y: 700 }, { x: 600, y: 520 }, { x: 820, y: 800 }];
const vision = createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.url === '/api/tags') return res.end(JSON.stringify({ models: [{ name: 'fixture-model' }] }));
  let body = ''; for await (const chunk of req) body += chunk; calls++;
  const request = JSON.parse(body), content = request.messages.at(-1).content;
  lastImage = await sharp(Buffer.from(request.messages.at(-1).images[0], 'base64')).metadata();
  const text = short && !content.includes('at least') ? 'K7P' : 'K7P4XR';
  const points = content.includes('matching shapes') ? shapeSolutions[Math.min(shapeCalls++, shapeSolutions.length - 1)] : [{ x: 100, y: 390 }, { x: 600, y: 390 }];
  if (delay) await new Promise(resolve => setTimeout(resolve, delay));
  res.end(JSON.stringify({ message: { content: JSON.stringify(content.includes('Return center points') ? { points, confidence: uncertainPoints ? 40 : 99 } : { text, confidence: 99 }) } }));
});
vision.listen(0, '127.0.0.1'); await once(vision, 'listening');
const key = randomBytes(32).toString('hex');
const { server, queue } = createSolverServer({ key, model: 'fixture-model', ollamaEndpoint: `http://127.0.0.1:${vision.address().port}`, cache: false });
const tasks = [], createTask = queue.create.bind(queue);
queue.create = task => { tasks.push({ type: task.type, prompt: task.prompt }); return createTask(task); };
server.listen(0, '127.0.0.1'); await once(server, 'listening');
const context = await chromium.launchPersistentContext(join(temp, 'profile'), { channel: 'chromium', headless: true, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
await context.route('https://service.mtcaptcha.com/mtcv1/client/fixture*', route => route.fulfill({ contentType: 'text/html', body: html }));
await context.route('https://newassets.hcaptcha.com/fixture*', route => route.fulfill({ contentType: 'text/html', body: pointHTML }));
await context.route('https://newassets.hcaptcha.com/point-adapter.js', route => route.fulfill({ contentType: 'text/javascript', body: '' }));
const report = [], errors = [];
context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
try {
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const ui = await context.newPage(); await ui.goto(`chrome-extension://${new URL(worker.url()).host}/control.html`);
  const send = (type, data = {}) => ui.evaluate(async payload => { const result = await chrome.runtime.sendMessage(payload); if (!result.ok) throw new Error(result.error); return result.value; }, { type, ...data });
  await send('SAVE_SERVICE', { endpoint: `http://127.0.0.1:${server.address().port}`, key });
  const target = await context.newPage(); let tabId, frame;
  const open = async mode => {
    await target.goto(origin + '/?mode=' + mode);
    frame = target.frames().find(f => f.url().includes('/client/fixture')); await frame.waitForFunction(() => window.counts);
    await target.bringToFront(); tabId = await worker.evaluate(async url => (await chrome.tabs.query({})).find(t => t.url === url).id, target.url());
  };
  const start = (autoVerify, providers = ['mtcaptcha']) => send('CHALLENGE_START', { tabId, sourceURL: target.url(), autoVerify, browserInput: autoVerify && browserInput, providers });
  const waitState = async expected => {
    let status;
    for (let i = 0; i < 150; i++) {
      status = await send('CHALLENGE_GET', { tabId });
      if (expected.includes(status.state)) return status;
      if (status.state === 'failed') throw new Error(status.detail);
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('Widget timeout: ' + JSON.stringify(status));
  };
  await open('mt-review'); await start(false); await waitState(['review']);
  assert.equal(await frame.locator('.mtcap-inputtext').inputValue(), '');
  assert.deepEqual(await frame.evaluate(() => counts), { input: 0, submit: 0 });
  const storage = await worker.evaluate(() => Promise.all([chrome.storage.local.get('activity'), chrome.storage.session.get(null)]));
  assert.ok(!JSON.stringify(storage).includes('K7P4XR'));
  report.push('MTCaptcha review recognizes without typing or persisting the answer');
  await open('mt-auto'); await start(true); await waitState(['widget-verified']);
  assert.deepEqual(await frame.evaluate(() => counts), { input: 1, submit: 0 });
  report.push('MTCaptcha auto-check input reaches a provider verification marker without form submission');
  short = true; await open('mt-short'); await start(true); await waitState(['widget-verified']);
  assert.equal(await frame.evaluate(() => counts.input), 2); short = false;
  report.push('MTCaptcha missing-character feedback causes one bounded retry with a minimum-length hint');
  // Same-origin text widgets are deliberately scoped to the top-level origin.
  await context.route(origin + '/text*', route => route.fulfill({ contentType: 'text/html', body: html }));
  const openText = async mode => {
    await target.goto(origin + '/text?mode=' + mode); frame = target.mainFrame(); await frame.waitForFunction(() => window.counts);
    await target.bringToFront(); tabId = await worker.evaluate(async url => (await chrome.tabs.query({})).find(t => t.url === url).id, target.url());
  };
  await openText('text-fill'); await start(true, ['text-captcha']); await waitState(['review']);
  assert.equal(await frame.locator('#captchaAnswer').inputValue(), 'K7P4XR'); assert.equal(await frame.evaluate(() => counts.submit), 0);
  report.push('Generic text image finds one associated answer field and leaves application Submit untouched');
  await openText('text-existing'); await start(true, ['text-captcha']); assert.match((await waitState(['failed'])).detail, /already contains/);
  assert.equal(await frame.locator('#captchaAnswer').inputValue(), 'keep-my-answer');
  report.push('Existing user answers are preserved');
  await openText('text-ambiguous'); await start(true, ['text-captcha']); assert.match((await waitState(['failed'])).detail, /More than one/);
  assert.equal(await frame.evaluate(() => counts.input), 0);
  report.push('Ambiguous image/input pairing stops before filling');
  delay = 1300; await open('mt-review'); await start(true); await waitState(['recognizing']); await frame.evaluate(() => refreshImage());
  const before = calls; await waitState(['widget-verified']); assert.ok(calls > before); assert.equal(await frame.evaluate(() => counts.input), 1);
  report.push('A refreshed image invalidates the in-flight answer and is recognized again');
  await open('mt-review'); await start(true); await waitState(['recognizing']); await send('CHALLENGE_STOP', { tabId });
  await new Promise(resolve => setTimeout(resolve, 1800)); assert.equal(await frame.evaluate(() => counts.input), 0);
  report.push('Stop prevents late text insertion');
  await context.route(origin + '/puzzle*', route => route.fulfill({ contentType: 'text/html', body: puzzleHTML }));
  const openPuzzle = async mode => {
    await target.goto(origin + '/puzzle?mode=' + mode); frame = target.mainFrame(); await frame.waitForFunction(() => window.counts);
    await target.bringToFront(); tabId = await worker.evaluate(async url => (await chrome.tabs.query({})).find(t => t.url === url).id, target.url());
  };
  delay = 0;
  for (const version of ['v3', 'v4', 'tencent', 'tencent-scaled', 'tencent-fleeting']) {
    await openPuzzle(version); await start(true, [version.startsWith('tencent') ? 'tencent' : 'geetest-' + version]);
    try { await waitState(['widget-verified']); } catch (error) { throw new Error(`${version}: ${error.message}; ${JSON.stringify(await frame.evaluate(() => ({ counts, lastMove: moves.at(-1) })))}`); }
    assert.deepEqual(await frame.evaluate(() => counts), { drags: 1, submit: 0 });
    assert.equal(await frame.evaluate(() => trustedPointer), browserInput);
    assert.ok(Math.abs((await frame.evaluate(() => moves.at(-1))) - (version === 'tencent-scaled' ? 74.5 : version.startsWith('tencent') ? 149 : 173)) < 2);
    if (version === 'tencent-fleeting') {
      assert.equal(await frame.evaluate(() => successFlashes), 1);
      assert.equal(await frame.locator('.tencent-captcha-dy__verify-status-img--success').count(), 0);
    }
    report.push(`${version === 'tencent-fleeting' ? 'Tencent sprite with a success marker removed before the next poll' : version === 'tencent-scaled' ? 'Tencent sprite under a half-scale transform' : version === 'tencent' ? 'Tencent sprite' : 'Geetest ' + version} image capture, actual local matching, scaled drag, and completion marker`);
  }
  await openPuzzle('tencent'); await start(false, ['tencent']); await waitState(['review']);
  await frame.evaluate(() => flashSuccess()); await send('CHALLENGE_STOP', { tabId });
  await start(false, ['tencent']);
  assert.equal((await waitState(['review', 'widget-verified'])).state, 'review');
  assert.equal(await frame.evaluate(() => counts.drags), 0);
  report.push('Stopping and restarting clears a previously observed Tencent success marker');
  await openPuzzle('tencent-rotated'); await start(true, ['tencent']);
  assert.match((await waitState(['failed'])).detail, /Rotated/);
  assert.equal(await frame.evaluate(() => counts.drags), 0);
  report.push('Rotated Tencent sprite capture stops before any slider input');
  await openPuzzle('v4'); await start(false, ['geetest-v4']); await waitState(['review']);
  assert.equal(await frame.evaluate(() => counts.drags), 0);
  report.push('Puzzle review reports the displacement without releasing a drag');
  if (browserInput) {
    await openPuzzle('v4'); await start(true, ['geetest-v4']);
    await frame.waitForFunction(() => counts.drags === 1); await send('CHALLENGE_STOP', { tabId });
    await new Promise(resolve => setTimeout(resolve, 500));
    assert.equal(await frame.locator('.geetest_success').count(), 0);
    assert.equal(await frame.evaluate(() => moves.at(-1)), 0);
    await worker.evaluate(async tabId => { await chrome.debugger.attach({ tabId }, '1.3'); await chrome.debugger.detach({ tabId }); }, tabId);
    report.push('Stopping browser input cancels at the starting position and detaches the debugger');
  }
  await context.route(origin + '/fox*', route => route.fulfill({ contentType: 'text/html', body: foxHTML }));
  const openFox = async (query = '') => {
    await target.goto(origin + '/fox' + query); frame = target.mainFrame(); await frame.waitForFunction(() => window.counts);
    await target.bringToFront(); tabId = await worker.evaluate(async url => (await chrome.tabs.query({})).find(t => t.url === url).id, target.url());
  };
  const previousCalls = calls;
  await openFox(); await start(true, ['captchafox']); await waitState(['widget-verified']);
  assert.deepEqual(await frame.evaluate(() => counts), { drags: 1, submit: 0 });
  assert.equal(await frame.evaluate(() => trustedPointer), browserInput);
  assert.equal(calls, previousCalls);
  report.push('CaptchaFox captures only the visible widget, locates both objects, drags once, and waits for a response');
  uncertainPoints = true; await openFox('?ambiguous'); await start(true, ['captchafox']); await waitState(['failed']);
  assert.equal(lastImage.width, 300); assert.equal(lastImage.height, 60);
  assert.equal(await frame.evaluate(() => counts.drags), 0); uncertainPoints = false;
  report.push('Uncertain object positions stop before a slider action');
  await context.route(origin + '/points*', route => route.fulfill({ contentType: 'text/html', body: `<title>Point application fixture</title><iframe width="650" height="650" src="https://newassets.hcaptcha.com/fixture${new URL(route.request().url()).search}"></iframe>` }));
  const openPoints = async (mode = '') => {
    shapeCalls = 0; shapeSolutions = mode === 'multi' ? [firstShapes, nextShapes] : [firstShapes];
    await target.goto(origin + '/points?mode=' + mode);
    frame = target.frames().find(item => item.url().startsWith('https://newassets.hcaptcha.com/fixture')); await frame.waitForFunction(() => window.counts);
    await target.bringToFront(); tabId = await worker.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url).id, target.url());
  };
  await openPoints(); let taskStart = tasks.length; await start(true, ['hcaptcha']); await waitState(['widget-verified']);
  let pointCounts = await frame.evaluate(() => counts);
  assert.equal(pointCounts.clicks.length, 3); assert.equal(pointCounts.verify, 1); assert.equal(pointCounts.submit, 0);
  assert.equal(await frame.locator('#checkbox').getAttribute('aria-checked'), 'true');
  assert.deepEqual(tasks.slice(taskStart).map(task => task.type), ['ocr', 'points']);
  assert.match(tasks.at(-1).prompt, /Click the THREE matching shapes/i);
  report.push('Cross-origin hCaptcha canvas instructions use real OCR before point selection and provider verification');
  await openPoints(); await start(false, ['hcaptcha']); await waitState(['review']);
  assert.deepEqual(await frame.evaluate(() => counts), { clicks: [], verify: 0, submit: 0 });
  report.push('hCaptcha point review returns recognized centers without clicking or verifying');
  await openPoints('multi'); taskStart = tasks.length; await start(true, ['hcaptcha']); await waitState(['widget-verified']);
  pointCounts = await frame.evaluate(() => counts);
  assert.equal(pointCounts.clicks.length, 6); assert.equal(pointCounts.verify, 2); assert.equal(pointCounts.submit, 0);
  assert.deepEqual(tasks.slice(taskStart).map(task => task.type), ['ocr', 'points', 'ocr', 'points']);
  assert.equal(shapeCalls, 2); assert.equal(await frame.evaluate(() => round), 1);
  report.push('A new hCaptcha canvas round is recognized again before selecting its different shape centers');
  await openPoints(); delay = 1300; await start(true, ['hcaptcha']);
  for (let i = 0; i < 150 && shapeCalls === 0; i++) await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(shapeCalls, 1); await send('CHALLENGE_STOP', { tabId });
  await new Promise(resolve => setTimeout(resolve, 1600)); delay = 0;
  assert.deepEqual(await frame.evaluate(() => counts), { clicks: [], verify: 0, submit: 0 });
  assert.equal((await send('CHALLENGE_GET', { tabId })).state, 'stopped');
  report.push('Stopping hCaptcha point inference prevents late clicks and verification');
  await openPoints('gone'); await start(true, ['hcaptcha']); await waitState(['verifying']);
  const receiptWait = Date.now();
  assert.equal(await frame.locator('canvas, .button-submit').count(), 0);
  assert.match((await waitState(['failed'])).detail, /has not confirmed the point selection/);
  assert.ok(Date.now() - receiptWait < 15_000, 'Missing point verification must fail within 15 seconds.');
  pointCounts = await frame.evaluate(() => counts);
  assert.equal(pointCounts.clicks.length, 3); assert.equal(pointCounts.verify, 1); assert.equal(pointCounts.submit, 0); assert.equal(shapeCalls, 1);
  report.push('A removed hCaptcha widget without a success receipt fails within the verification timeout');
  await context.route(origin + '/managed*', route => route.fulfill({ contentType: 'text/html', body: managedHTML }));
  await worker.evaluate(() => chrome.storage.local.remove('service'));
  for (const provider of ['prosopo', 'captchafox']) {
    await target.goto(origin + '/managed?provider=' + provider); frame = target.mainFrame(); await frame.waitForFunction(() => window.counts);
    await target.bringToFront(); tabId = await worker.evaluate(async url => (await chrome.tabs.query({})).find(t => t.url === url).id, target.url());
    await start(false, [provider]); await waitState(['review']); assert.equal(await frame.evaluate(() => counts.starts), 0);
    await start(true, [provider]); await waitState(['verifying']);
    assert.equal((await send('CHALLENGE_GET', { tabId })).active, true);
    await waitState(['widget-verified']); assert.deepEqual(await frame.evaluate(() => counts), { starts: 1, submit: 0 });
    assert.equal(await frame.evaluate(() => trustedPointer), browserInput);
    report.push(`${provider} starts its native widget without a local model and waits for a provider response, not just a checked box`);
  }
  assert.deepEqual(errors, []);
  await writeFile(join(output, browserInput ? 'browser-input-report.json' : 'report.json'), JSON.stringify({ checks: report, browserInput, model: 'deterministic test double', pointInstructionOcr: 'real Tesseract', modelCalls: calls }, null, 2) + '\n');
  report.forEach(item => console.log('PASS ' + item));
} finally {
  await context.close();
  for (const service of [fixture, vision, server]) { service.closeAllConnections(); await new Promise(resolve => service.close(resolve)); }
  await rm(temp, { recursive: true, force: true });
}
