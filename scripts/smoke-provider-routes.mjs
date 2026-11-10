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

// End-to-end extension sessions against SDK-derived local controls. Real queue,
// image processing and CPU puzzle matcher; deterministic vision grid response.
// These checks do not establish live provider acceptance.
const temporary = await mkdtemp(join(tmpdir(), 'ocr-provider-routes-'));
const extension = join(temporary, 'extension');
await cp(resolve('dist'), extension, { recursive: true });
const manifest = JSON.parse(await readFile(join(extension, 'manifest.json'), 'utf8'));
manifest.permissions.push('webNavigation'); manifest.host_permissions = ['<all_urls>'];
await writeFile(join(extension, 'manifest.json'), JSON.stringify(manifest));
const fixtures = Object.fromEntries(await Promise.all(['aws-waf', 'aws-waf-slide', 'binance', 'geetest-images'].map(async name => [name, await readFile(`tests/fixtures/${name}.html`, 'utf8')])));
const site = createServer((request, response) => {
  if (request.url.endsWith('-adapter.js')) { response.setHeader('Content-Type', 'text/javascript'); return response.end(''); }
  response.setHeader('Content-Type', 'text/html'); response.end(fixtures[new URL(request.url, 'http://local').pathname.slice(1)] || 'Not found');
});
site.listen(0, '127.0.0.1'); await once(site, 'listening'); const origin = `http://127.0.0.1:${site.address().port}`;
let calls = 0, delay = 0;
const vision = createServer(async (request, response) => {
  response.setHeader('Content-Type', 'application/json');
  if (request.url === '/api/tags') return response.end(JSON.stringify({ models: [{ name: 'fixture-model' }] }));
  let body = ''; for await (const chunk of request) body += chunk; calls++;
  const task = JSON.parse(body), content = task.messages.at(-1).content;
  let solution = { selected: [0, 3, 6], confidence: 99 };
  if (content.includes('TOP half')) solution = { points: [{ x: 750, y: 300 }, { x: 250, y: 700 }], confidence: 99 };
  if (content.includes('TOP band')) {
    const grid = content.includes('grid of photographs'), { height } = await sharp(Buffer.from(task.messages.at(-1).images[0], 'base64')).metadata();
    const points = grid ? [{ x: 1/6, y: 1/6 }, { x: .5, y: .5 }, { x: 5/6, y: 5/6 }] : [{ x: .2, y: .4 }, { x: .7, y: .3 }, { x: .5, y: .75 }];
    solution = { points: points.map(({ x, y }) => ({ x: Math.round(x * 1000), y: Math.round((120 + y * (height - 120)) / height * 1000) })), confidence: 99 };
  }
  if (delay) await new Promise(resolve => setTimeout(resolve, delay));
  response.end(JSON.stringify({ message: { content: JSON.stringify(solution) } }));
});
vision.listen(0, '127.0.0.1'); await once(vision, 'listening');
const key = randomBytes(32).toString('hex');
const { server, queue } = createSolverServer({ key, model: 'fixture-model', ollamaEndpoint: `http://127.0.0.1:${vision.address().port}`, cache: false });
server.listen(0, '127.0.0.1'); await once(server, 'listening');
const context = await chromium.launchPersistentContext(join(temporary, 'profile'), { channel: 'chromium', headless: true, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
const checks = [], errors = [];
context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
try {
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const ui = await context.newPage(); await ui.goto(`chrome-extension://${new URL(worker.url()).host}/control.html`);
  const send = (type, data = {}) => ui.evaluate(async message => { const reply = await chrome.runtime.sendMessage(message); if (!reply.ok) throw new Error(reply.error); return reply.value; }, { type, ...data });
  await send('SAVE_SERVICE', { endpoint: `http://127.0.0.1:${server.address().port}`, key });
  const target = await context.newPage(); let tabId;
  const open = async (provider, mode = 'grid') => {
    await target.goto(`${origin}/${provider}?mode=${mode}`); await target.waitForFunction(() => window.ready);
    await target.bringToFront(); tabId = await worker.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url).id, target.url());
  };
  const start = (provider, autoVerify = true) => send('CHALLENGE_START', { tabId, sourceURL: target.url(), providers: [provider], autoVerify });
  const wait = async state => {
    for (let n = 0; n < 120; n++) { const result = await send('CHALLENGE_GET', { tabId }); if (state.includes(result.state)) return result; if (!result.active) throw Error(JSON.stringify(result)); await new Promise(resolve => setTimeout(resolve, 100)); }
    throw Error('Session did not finish: ' + JSON.stringify(await send('CHALLENGE_GET', { tabId })));
  };
  await open('aws-waf'); await start('aws-waf', false); await wait(['review']);
  assert.deepEqual(await target.evaluate(() => ({ clicks: counts.clicks, verify: counts.verify, application: counts.application })), { clicks: [], verify: 0, application: 0 });
  await send('CHALLENGE_STOP', { tabId }); checks.push('AWS grid review traverses the signed service and produces no input');
  await open('aws-waf'); await start('aws-waf'); const aws = await wait(['puzzle-correct']);
  assert.equal(aws.active, false); assert.equal(await target.evaluate(() => counts.verify), 1); assert.equal(await target.evaluate(() => counts.application), 0);
  checks.push('AWS shadow-root correctness is latched and terminates distinctly from token issuance');
  await open('aws-waf', 'rounds'); await start('aws-waf'); await wait(['puzzle-correct']); assert.equal(await target.evaluate(() => counts.verify), 2);
  checks.push('AWS fresh subsequent round is recognized once and reaches its own receipt');
  await open('aws-waf', 'reject'); await start('aws-waf'); assert.match((await wait(['failed'])).detail, /AWS WAF/); checks.push('AWS provider rejection terminates without success');
  delay = 1000; await open('aws-waf'); const before = calls; await start('aws-waf');
  for (let n = 0; n < 100 && calls === before; n++) await new Promise(resolve => setTimeout(resolve, 40));
  assert.ok(calls > before); await send('CHALLENGE_STOP', { tabId }); await new Promise(resolve => setTimeout(resolve, 1200));
  assert.equal(await target.evaluate(() => counts.clicks.length + counts.verify + counts.application), 0); delay = 0;
  checks.push('Stopping a running AWS recognition prevents subsequent clicks and Confirm');
  await open('aws-waf-slide', 'normal'); await start('aws-waf'); await wait(['puzzle-correct']); assert.equal(await target.evaluate(() => accepted), true); assert.equal(await target.evaluate(() => counts.application), 0);
  checks.push('AWS split-image points pass the signed route and align only the scoped provider slider');
  await open('binance', 'slide'); await start('binance', false); await wait(['review']); assert.equal(await target.evaluate(() => counts.moves + counts.releases + counts.submits), 0); await send('CHALLENGE_STOP', { tabId });
  await open('binance', 'accept'); await start('binance'); await wait(['widget-verified']); assert.equal(await target.evaluate(() => counts.releases), 1); assert.equal(await target.evaluate(() => counts.submits), 0);
  checks.push('Binance review and automatic slider paths use the CPU matcher and require the SDK success marker');
  await open('binance', 'reject'); await start('binance'); assert.match((await wait(['failed'])).detail, /Binance/);
  await open('binance', 'checkbox'); await start('binance'); await wait(['widget-verified']); assert.equal(await target.evaluate(() => counts.checks), 1); assert.equal(await target.evaluate(() => counts.submits), 0);
  checks.push('Binance rejection and native checkbox paths preserve session and form boundaries');
  for (const mode of ['grid-one-accept', 'grid-two']) {
    await open('binance', mode); await start('binance'); await wait(['widget-verified']); assert.equal(await target.evaluate(() => counts.verifies), mode === 'grid-two' ? 2 : 1); assert.equal(await target.evaluate(() => counts.submits), 0);
  }
  checks.push('Binance one- and two-page grids traverse Next once and terminate only on the provider receipt');
  for (const mode of ['icons-pass', 'grid-pass']) {
    await open('geetest-images', mode); await start('geetest-v4'); await wait(['widget-verified']);
    assert.equal(await target.evaluate(() => counts.verify), 1); assert.equal(await target.evaluate(() => counts.submit), 0);
    if (mode === 'grid-pass') assert.deepEqual(await target.evaluate(() => counts.clicks), [0, 4, 8]);
  }
  checks.push('Geetest ordered icons and grid centers pass the full session route and wait for explicit success');
  const nativeKey = 'public-fixture-site-key-123456789';
  const nativeToken = 'fixture-native-response-never-persist-this';
  await context.route('https://www.google.com/recaptcha/api.js*', route => route.fulfill({ contentType: 'text/javascript', body: `window.nativeCalls=0;window.grecaptcha={ready:cb=>cb(),execute:()=>{nativeCalls++;return new Promise(resolve=>{window.releaseNative=()=>resolve('${nativeToken}');if(!location.search.includes('defer'))releaseNative();});}};` }));
  await context.route(origin + '/native*', route => route.fulfill({ contentType: 'text/html', body: `<form><button type="submit" class="g-recaptcha" data-sitekey="${nativeKey}" data-action="test/action" data-callback="submitApplication">Submit application</button></form><script>window.nativeSubmits=0;window.callbacks=0;window.submitApplication=()=>callbacks++;document.querySelector('form').addEventListener('submit',e=>{e.preventDefault();nativeSubmits++;});</script><script src="https://www.google.com/recaptcha/api.js?render=${nativeKey}"></script>` }));
  // v3 must work without the local recognition service and cannot be called a
  // server-verified result merely because its SDK produced a response string.
  await worker.evaluate(() => chrome.storage.local.remove('service'));
  const openNative = async suffix => { await target.goto(origin + '/native' + suffix); await target.waitForFunction(() => window.grecaptcha); await target.bringToFront(); tabId = await worker.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url).id, target.url()); };
  await openNative(''); await start('recaptcha-v3', false); await wait(['review']); assert.equal(await target.evaluate(() => nativeCalls), 0); await send('CHALLENGE_STOP', { tabId });
  await openNative(''); await start('recaptcha-v3'); await wait(['token-issued']);
  assert.deepEqual(await target.evaluate(() => [nativeCalls, nativeSubmits, callbacks]), [1, 0, 0]);
  assert.equal(JSON.stringify(await worker.evaluate(() => Promise.all([chrome.storage.local.get(null), chrome.storage.session.get(null)]))).includes(nativeToken), false);
  checks.push('v3 review performs no execution; native generic token issuance needs no model and never invokes or persists the site callback/token');
  await openNative('?defer'); await start('recaptcha-v3'); await target.waitForFunction(() => nativeCalls === 1); await send('CHALLENGE_STOP', { tabId }); await target.evaluate(() => releaseNative()); await new Promise(resolve => setTimeout(resolve, 150));
  assert.equal((await send('CHALLENGE_GET', { tabId })).state, 'stopped'); assert.deepEqual(await target.evaluate(() => [nativeSubmits, callbacks]), [0, 0]);
  checks.push('Stop during a native v3 SDK request prevents late results or page callbacks');
  assert.deepEqual(errors, []);
  await mkdir('output/playwright/provider-routes', { recursive: true }); await writeFile('output/playwright/provider-routes/report.json', JSON.stringify({ kind: 'Full extension local controls; no live provider acceptance', checks }, null, 2) + '\n');
  checks.forEach(check => console.log('PASS ' + check));
} finally {
  await context.close(); queue.close();
  for (const service of [server, vision, site]) { service.closeAllConnections(); await new Promise(resolve => service.close(resolve)); }
  await rm(temporary, { recursive: true, force: true });
}
