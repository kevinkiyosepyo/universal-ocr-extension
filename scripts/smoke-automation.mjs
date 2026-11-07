import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdtemp, mkdir, cp, readFile, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import sharp from 'sharp';
import { createSolverServer } from '../server/app.mjs';
const output = resolve('output/automation'); await mkdir(output, { recursive: true });
const temp = await mkdtemp(join(output, 'test-')); const extension = join(temp, 'extension'); await cp('dist', extension, { recursive: true });
// Grants apply only to this disposable test profile and controlled fixtures.
const manifest = JSON.parse(await readFile(join(extension, 'manifest.json'), 'utf8'));
manifest.host_permissions = ['http://127.0.0.1/*', 'https://health.example.test/*']; manifest.permissions.push('proxy'); manifest.optional_permissions = [];
await writeFile(join(extension, 'manifest.json'), JSON.stringify(manifest));
const fixture = createServer((req, res) => { res.setHeader('Content-Type', 'text/html'); res.end(`<!doctype html><title>Automation fixture</title><h1>Local challenge fixture</h1><canvas id="challenge" width="500" height="160"></canvas><form><label>Answer <input id="answer"></label><button id="application" type="submit">Submit application</button></form><button id="verify" type="button">Verify</button><p id="success" hidden>Correct</p><output id="events"></output><script>const ctx=document.querySelector('canvas').getContext('2d');function draw(text){ctx.fillStyle='white';ctx.fillRect(0,0,500,160);ctx.fillStyle='black';ctx.font='64px Arial';ctx.fillText(text,30,110);}draw('572948');window.counts={input:0,change:0,submit:0,verify:0};for(const name of ['input','change'])document.querySelector('#answer').addEventListener(name,()=>counts[name]++);document.querySelector('form').addEventListener('submit',e=>{e.preventDefault();counts.submit++});document.querySelector('#verify').onclick=()=>{counts.verify++;document.querySelector('#success').hidden=document.querySelector('#answer').value!=='572948'};</script>`); });
fixture.listen(0, '127.0.0.1'); await once(fixture, 'listening'); const origin = `http://127.0.0.1:${fixture.address().port}`;
const key = randomBytes(32).toString('hex'); const { server } = createSolverServer({ key, model: 'none', ollamaEndpoint: 'http://127.0.0.1:1' }); server.listen(0, '127.0.0.1'); await once(server, 'listening'); const endpoint = `http://127.0.0.1:${server.address().port}`;
const context = await chromium.launchPersistentContext(join(temp, 'profile'), { channel: 'chromium', headless: true, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`], viewport: { width: 1320, height: 1000 } });
const report = [], errors = [];
context.on('console', message => { if (message.type() === 'error') console.error('BROWSER', message.text().slice(0,500)); });
try {
  let worker = context.serviceWorkers()[0]; if (!worker) worker = await context.waitForEvent('serviceworker');
  const id = new URL(worker.url()).host; const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
  await page.goto(`chrome-extension://${id}/control.html`); await page.locator('#task-type').waitFor();
  const img = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="160"><rect width="600" height="160" fill="white"/><text x="30" y="110" font-family="Arial" font-size="64">LOCAL TOOL 427</text></svg>')).png().toBuffer();
  await page.locator('#task-image').setInputFiles({ name: 'sample.png', mimeType: 'image/png', buffer: img });
  await page.getByRole('button', { name: 'Analyze image' }).click();
  await page.waitForFunction(() => document.querySelector('#solution').value === 'LOCAL TOOL 427', undefined, { timeout: 30000 });
  report.push('Workbench real OCR through offscreen engine, without service');
  await page.locator('#theme').selectOption('dark'); await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  await page.screenshot({ path: join(output, 'workbench-dark.png'), fullPage: true }); await page.locator('#theme').selectOption('light');
  await page.screenshot({ path: join(output, 'workbench.png'), fullPage: true }); report.push('Light and dark themes');
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  const pasteAllowed = await page.locator('#service-key').evaluate(field => { const data = new DataTransfer(); data.setData('text/plain', 'pairing-key-fixture'); const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }); field.dispatchEvent(event); return !event.defaultPrevented; }); assert.equal(pasteAllowed, true); report.push('Text paste remains available in Settings');
  await page.locator('#service-endpoint').fill(endpoint); await page.locator('#service-key').fill(key); await page.getByRole('button', { name: 'Save connection', exact: true }).click();
  await page.getByRole('button', { name: 'Test connection', exact: true }).click(); await page.locator('#service-result').filter({ hasText: 'Connected' }).waitFor(); report.push('Signed extension-to-service connection');
  await page.getByRole('link', { name: 'Visual workbench' }).click(); await page.locator('#task-type').selectOption('pow'); await page.locator('#task-prefix').fill('browser-fixture'); await page.locator('#task-difficulty').fill('8'); await page.getByRole('button', { name: 'Analyze image' }).click();
  await page.waitForFunction(() => document.querySelector('#solution').value.includes('nonce'), undefined, { timeout: 15000 }); const pow = JSON.parse(await page.locator('#solution').inputValue()); assert.ok(pow.hash.startsWith('00')); report.push('Service task creation, polling, result display, and cleanup');
  await page.getByRole('link', { name: 'Site rules', exact: true }).click(); await page.locator('#rule-editor summary').click();
  for (const [field, value] of [['name', 'Fixture text'], ['origin', origin], ['image', '#challenge'], ['input', '#answer'], ['submit', '#verify'], ['success', '#success']]) await page.locator(`#rule-${field}`).fill(value);
  await page.locator('#rule-characters').selectOption('digits'); await page.locator('#rule-auto-submit').check(); await page.getByRole('button', { name: 'Save rule and grant site access' }).click();
  await page.locator('#notice').filter({ hasText: 'Rule saved' }).waitFor(); await page.locator('#automation-enabled').check();
  const target = await context.newPage(); target.on('pageerror', e => errors.push(e.message)); await target.goto(origin); await target.waitForFunction(() => document.querySelector('#answer').value === '572948', undefined, { timeout: 30000 });
  await target.locator('#success').waitFor({ state: 'visible' }); assert.deepEqual(await target.evaluate(() => counts), { input: 1, change: 1, submit: 0, verify: 1 }); report.push('Opt-in site rule reads real image, fills field, verifies challenge once, never submits application');
  await target.evaluate(() => { const widget = document.createElement('div'); widget.className = 'g-recaptcha'; document.body.append(widget); });
  const detected = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'SCAN_PAGE' })); assert.equal(detected.ok, true); assert.ok(detected.value.some(item => item.id === 'recaptcha-v2' && item.status === 'detected')); report.push('Provider scan detects fixture widget without claiming a solve');
  await page.bringToFront(); await page.getByRole('link', { name: 'Activity', exact: true }).click(); await page.locator('#activity-rows').filter({ hasText: 'verified' }).waitFor(); report.push('Recognized, applied, and verified outcomes recorded separately');
  // An application submit selector must be rejected even when a rule requests verification.
  await page.getByRole('link', { name: 'Site rules', exact: true }).click(); await page.getByRole('button', { name: 'Edit', exact: true }).click(); await page.locator('#rule-submit').fill('#application'); await page.getByRole('button', { name: 'Save rule and grant site access' }).click(); await page.locator('#notice').filter({ hasText: 'Rule saved' }).waitFor();
  await target.bringToFront(); await target.reload(); await target.waitForFunction(() => counts.input >= 1, undefined, { timeout: 30000 });
  await page.bringToFront(); await page.getByRole('link', { name: 'Activity', exact: true }).click(); await page.locator('#activity-rows').filter({ hasText: 'Application submission is not supported' }).waitFor(); assert.equal(await target.evaluate(() => counts.submit), 0); report.push('Application Submit selector refused');
  await page.getByRole('link', { name: 'Site rules', exact: true }).click(); await page.locator('#automation-enabled').uncheck();
  await target.bringToFront(); await target.evaluate(() => { document.querySelector('#answer').value = ''; draw('123456'); });
  // Observe multiple scheduler periods; this explicitly tests the stop control.
  await target.waitForTimeout(2200); assert.equal(await target.locator('#answer').inputValue(), ''); report.push('Global pause prevents subsequent field changes');
  // Cross-document insertion protection uses a document nonce even in browsers without documentId.
  const tabId = await worker.evaluate(async (url) => (await chrome.tabs.query({})).find(tab => tab.url === url || tab.url === url + '/').id, origin);
  await worker.evaluate(tabId => chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] }), tabId);
  const viewport = await worker.evaluate(tabId => chrome.tabs.sendMessage(tabId, { type: 'VIEWPORT' }), tabId);
  await target.reload(); await worker.evaluate(tabId => chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] }), tabId);
  const stale = await page.evaluate(({ tabId, nonce }) => chrome.runtime.sendMessage({ type: 'INSERT_TEXT', source: { tabId, documentNonce: nonce, frameId: 0 }, text: 'old image' }), { tabId, nonce: viewport.documentNonce }); assert.equal(stale.ok, false); assert.match(stale.error, /changed/); report.push('Stale document insertion blocked');
  await page.bringToFront(); await page.getByRole('link', { name: 'Settings', exact: true }).click(); await page.locator('#proxy-section summary').click(); await page.locator('#proxy-list').fill('http://127.0.0.1:59999\nsocks5://127.0.0.1:59998'); await page.getByRole('button', { name: 'Save proxies and grant access' }).click();
  await page.getByRole('button', { name: 'Use first', exact: true }).click(); await page.locator('#proxy-result').filter({ hasText: 'fixed_servers' }).waitFor();
  await page.getByRole('button', { name: 'Use next', exact: true }).click(); await page.locator('#proxy-result').filter({ hasText: 'socks5' }).waitFor();
  await page.getByRole('button', { name: 'Restore browser settings', exact: true }).click(); await page.locator('#proxy-result').filter({ hasText: 'controllable_by_this_extension' }).waitFor(); report.push('Proxy selection, rotation, and restoration in disposable profile');
  await context.route('https://health.example.test/status', route => route.fulfill({ status: 200, body: 'ok' })); await page.locator('#proxy-url').fill('https://health.example.test/status'); await page.getByRole('button', { name: 'Check connection', exact: true }).click(); await page.locator('#proxy-result').filter({ hasText: '200' }).waitFor(); report.push('Proxy health-check UI and optional host scope');
  await page.getByRole('link', { name: 'Compatibility', exact: true }).click(); assert.ok(await page.locator('#provider-rows tr').count() >= 14); report.push('Compatibility matrix exposes integration limits');
  assert.deepEqual(errors, []); await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n'); report.forEach(item => console.log('PASS ' + item));
} catch (error) {
  for (const page of context.pages()) if (page.url().includes('control.html')) { console.error('NOTICE:', await page.locator('#notice').textContent()); console.error('CONTEXTS', await page.evaluate(() => chrome.runtime.getContexts({}))); console.error('ERRORS', errors); const cdp = await context.newCDPSession(page); console.error('TARGETS', (await cdp.send('Target.getTargets')).targetInfos.map(t => ({url:t.url,title:t.title,type:t.type}))); await cdp.detach(); await page.screenshot({ path: join(output, 'failure.png'), fullPage: true }); }
  console.error(report); throw error;
} finally { await context.close(); fixture.closeAllConnections(); await new Promise(resolve => fixture.close(resolve)); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(temp, { recursive: true, force: true }); }
