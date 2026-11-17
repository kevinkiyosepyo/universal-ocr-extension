import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdtemp, cp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';

const output = resolve('output/provider-detection');
const temp = await mkdtemp(join(tmpdir(), 'ocr-provider-scan-')), extension = join(temp, 'extension');
await cp('dist', extension, { recursive: true });
const manifest = JSON.parse(await readFile(join(extension, 'manifest.json'), 'utf8'));
// Fixture access belongs only to this disposable profile, never a user profile.
manifest.host_permissions = ['http://127.0.0.1/*', 'https://www.google.com/*', 'https://recaptcha.net/*', 'https://newassets.hcaptcha.com/*'];
await writeFile(join(extension, 'manifest.json'), JSON.stringify(manifest));
const enterpriseAnchor = '<iframe src="https://recaptcha.net/recaptcha/enterprise/anchor?size=invisible"></iframe>';
const enterpriseGrid = '<iframe src="https://www.google.com/recaptcha/enterprise/bframe?fixture=1"></iframe>';
const standardAnchor = '<iframe src="https://www.google.com/recaptcha/api2/anchor?size=normal"></iframe>';
const standardScore = '<script src="https://www.google.com/recaptcha/api.js?render=fixture"></script>';
const markup = {
  invisible: '<div class="g-recaptcha" data-action="apply"></div>' + enterpriseAnchor,
  enterprise: enterpriseGrid,
  standard: standardAnchor,
  score: standardScore,
  mixed: standardAnchor + enterpriseGrid + '<div class="h-captcha"></div>',
  'mixed-score': standardScore + enterpriseGrid,
  forged: '<iframe src="https://www.google.com.evil.test/recaptcha/enterprise/anchor"></iframe><script src="http://www.google.com/recaptcha/enterprise.js"></script>',
};
const fixture = createServer((request, response) => {
  const mode = new URL(request.url, 'http://fixture.test').searchParams.get('mode');
  response.setHeader('Content-Type', 'text/html'); response.end(`<!doctype html><title>Provider scan fixture</title>${markup[mode] || ''}`);
});
fixture.listen(0, '127.0.0.1'); await once(fixture, 'listening');
const origin = `http://127.0.0.1:${fixture.address().port}`;
const context = await chromium.launchPersistentContext(join(temp, 'profile'), {
  channel: 'chromium', headless: true, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
});
const errors = [], checks = [];
context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
await context.route('**/*', route => {
  const url = new URL(route.request().url());
  if (url.origin === origin || url.protocol === 'chrome-extension:') return route.continue();
  if (['www.google.com', 'recaptcha.net'].includes(url.hostname) && url.protocol === 'https:') {
    if (url.pathname.endsWith('.js')) return route.fulfill({ contentType: 'text/javascript', body: '' });
    return route.fulfill({ contentType: 'text/html', body: '<!doctype html><div class="rc-imageselect">Provider-frame fixture</div>' });
  }
  return route.abort();
});
try {
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const extensionOrigin = 'chrome-extension://' + new URL(worker.url()).host;
  const ui = await context.newPage(); await ui.goto(extensionOrigin + '/control.html');
  const target = await context.newPage();
  const scan = async mode => {
    await target.goto(`${origin}/?mode=${mode}`); await target.bringToFront();
    const response = await ui.evaluate(() => chrome.runtime.sendMessage({ type: 'SCAN_PAGE' }));
    assert.equal(response.ok, true, response.error); return response.value;
  };
  const ids = values => [...new Set(values.map(item => item.id))].sort();
  assert.deepEqual(ids(await scan('invisible')), ['recaptcha-enterprise']);
  checks.push('Actual SCAN_PAGE excludes standard v2/v3 for an invisible Enterprise host and child frame');

  const enterprise = await scan('enterprise');
  assert.deepEqual(ids(enterprise), ['recaptcha-enterprise']);
  assert.ok(enterprise.some(item => item.origin === 'https://www.google.com' && item.id === 'recaptcha-enterprise'));
  checks.push('Actual all-frame scan identifies an Enterprise grid by its own document URL');
  assert.deepEqual(ids(await scan('standard')), ['recaptcha-v2']);
  assert.deepEqual(ids(await scan('score')), ['recaptcha-v3']);
  checks.push('Standard checkbox and score integrations remain detectable through the real extension route');
  assert.deepEqual(ids(await scan('mixed')), ['hcaptcha', 'recaptcha-enterprise', 'recaptcha-v2']);
  checks.push('Mixed Enterprise, standard checkbox and hCaptcha identities stay separate after frame aggregation');
  assert.deepEqual(ids(await scan('mixed-score')), ['recaptcha-enterprise', 'recaptcha-v3']);
  checks.push('An independent standard score API survives Enterprise child-frame scanning');
  assert.deepEqual(ids(await scan('forged')), []);
  checks.push('Lookalike and insecure URLs do not enable standard assistance through the real scan route');

  await scan('enterprise');
  const tabId = await worker.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url).id, target.url());
  const before = await worker.evaluate(() => chrome.permissions.getAll());
  const nextPage = context.waitForEvent('page');
  await worker.evaluate(url => chrome.tabs.create({ url, active: false }), extensionOrigin + '/popup.html');
  const popup = await nextPage; await popup.waitForLoadState('networkidle');
  await popup.evaluate(() => document.querySelector('#assist').click());
  await popup.waitForFunction(() => /automatic integration is not available/.test(document.querySelector('#popup-status').textContent), null, { timeout: 5000 });
  const state = await ui.evaluate(tabId => chrome.runtime.sendMessage({ type: 'CHALLENGE_GET', tabId }), tabId);
  assert.equal(state.ok, true); assert.equal(state.value, undefined);
  assert.deepEqual(await worker.evaluate(() => chrome.permissions.getAll()), before);
  checks.push('The real popup refuses Enterprise-only automatic assistance before granting permissions or starting a session');

  assert.deepEqual(errors, []);
  await mkdir(output, { recursive: true });
  await writeFile(join(output, 'route-report.json'), JSON.stringify({ kind: 'Packaged extension, real SCAN_PAGE and popup, intercepted local provider fixtures only', checks }, null, 2) + '\n');
  for (const check of checks) console.log('PASS ' + check);
} finally {
  await context.close(); fixture.closeAllConnections(); await new Promise(resolve => fixture.close(resolve));
  await rm(temp, { recursive: true, force: true });
}
