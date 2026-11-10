import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { chromium } from 'playwright';

// Exercise the real content controller and DOM adapters. Only extension
// messaging/recognition is stubbed so a report response can be paused exactly
// between selection and Verify, without a model or a live provider request.
const bundle = await build({
  entryPoints: ['src/challenge-content.js'], bundle: true, format: 'iife', write: false, target: 'chrome116',
  plugins: [{ name: 'content-api', setup(builder) {
    builder.onLoad({ filter: /\/src\/platform\.js$/ }, () => ({ contents: 'export const api = globalThis.challengeTestApi;' }));
  } }],
});
const html = await readFile('tests/fixtures/challenge.html', 'utf8');
const server = createServer((_request, response) => { response.setHeader('Content-Type', 'text/html'); response.end(html); });
server.listen(0, '127.0.0.1'); await once(server, 'listening');
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: 'chromium', headless: true });
const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
const errors = [], checks = [];
page.on('pageerror', error => errors.push(error.message));
await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());

async function open(mode, holdVerifyReport) {
  await page.goto(`${origin}/?mode=${mode}`);
  await page.evaluate(({ mode, holdVerifyReport }) => {
    const listeners = [], session = { id: crypto.randomUUID(), providers: [mode === 'hcaptcha' ? 'hcaptcha' : 'recaptcha-v2'], active: true, autoVerify: true, state: 'waiting' };
    window.sessionReports = [];
    window.recognitionCalls = 0;
    window.reportPending = false;
    window.reportReleased = false;
    window.stopAtReport = () => {
      session.active = false; session.state = 'stopped'; session.detail = 'Stopped.';
      for (const listener of listeners) listener({ type: 'CHALLENGE_STATUS', session: { ...session } });
    };
    window.challengeTestApi = { runtime: {
      onMessage: { addListener(listener) { listeners.push(listener); } },
      async sendMessage(message) {
        if (message.type === 'CHALLENGE_HELLO' || message.type === 'CHALLENGE_POLL') return { ok: true, value: { ...session } };
        if (message.type === 'CHALLENGE_SOLVE') { recognitionCalls++; return { ok: true, value: { selected: [1, 5, 6], confidence: .99 } }; }
        if (message.type === 'CHALLENGE_REPORT') {
          sessionReports.push(message.state);
          const reply = { ok: true, value: { ...session, state: message.state, detail: message.detail } };
          if (holdVerifyReport && message.state === 'verifying') {
            reportPending = true;
            await new Promise(resolve => { window.releaseReport = resolve; });
            reportReleased = true;
          }
          return reply;
        }
        throw new Error(`Unexpected extension message: ${message.type}`);
      },
    } };
  }, { mode, holdVerifyReport });
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
}

try {
  for (const mode of ['static', 'hcaptcha']) {
    await open(mode, false);
    await page.waitForFunction(() => sessionReports.includes('widget-verified'), null, { timeout: 10000 });
    assert.deepEqual(await page.evaluate(() => counts), { clicks: [1, 5, 6], verify: 1, submit: 0 });
    assert.equal(await page.evaluate(() => recognitionCalls), 1);
    checks.push(`${mode}: active session selects and verifies once`);

    await open(mode, true);
    await page.waitForFunction(() => reportPending, null, { timeout: 10000 });
    assert.deepEqual(await page.evaluate(() => counts), { clicks: [1, 5, 6], verify: 0, submit: 0 });
    await page.evaluate(() => { stopAtReport(); releaseReport(); });
    await page.waitForFunction(() => reportReleased);
    // Let the awaited controller continuation and another poll interval run.
    await page.waitForTimeout(550);
    assert.deepEqual(await page.evaluate(() => counts), { clicks: [1, 5, 6], verify: 0, submit: 0 });
    assert.equal(await page.evaluate(() => sessionReports.includes('widget-verified')), false);
    assert.equal(await page.evaluate(() => recognitionCalls), 1);
    checks.push(`${mode}: Stop during the Verify status report prevents the late Verify click`);
  }
  assert.deepEqual(errors, []);
  await mkdir('output/challenges', { recursive: true });
  await writeFile('output/challenges/cancellation-report.json', JSON.stringify({ kind: 'Actual content controller with deferred extension reports and local provider fixtures', checks }, null, 2) + '\n');
  for (const check of checks) console.log('PASS ' + check);
} finally {
  await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
