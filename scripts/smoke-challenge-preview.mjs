import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { chromium } from 'playwright';

// Actual controller and DOM adapters, deterministic recognition and deferred
// extension messages. No provider requests or application submissions occur.
const bundle = await build({
  entryPoints: ['src/challenge-content.js'], bundle: true, format: 'iife', write: false, target: 'chrome116',
  plugins: [{ name: 'preview-api', setup(builder) {
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

async function open(mode, holdRecognition = false) {
  await page.goto(`${origin}/?mode=${mode}`);
  await page.evaluate(({ mode, holdRecognition }) => {
    const listeners = [], session = { id: crypto.randomUUID(), providers: [mode === 'hcaptcha' ? 'hcaptcha' : 'recaptcha-v2'], active: true, autoVerify: false, state: 'waiting' };
    window.sessionReports = []; window.recognitionCalls = 0; window.recognitionPending = false; window.recognitionReleased = false;
    window.inputEvents = 0; window.providerCompletions = 0; window.hostSubmitAttempts = 0;
    // A provider could resume a pending host action on its last selection.
    // Instrument that path without allowing any native form navigation.
    HTMLFormElement.prototype.submit = function () { hostSubmitAttempts++; };
    HTMLFormElement.prototype.requestSubmit = function () { hostSubmitAttempts++; };
    let tileClicks = 0;
    for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'input', 'change']) document.addEventListener(type, event => {
      if (event.target.closest('.rc-imageselect-tile, .task-image, #recaptcha-verify-button, .button-submit')) {
        inputEvents++;
        if (type === 'click' && event.target.closest('.rc-imageselect-tile, .task-image') && ++tileClicks === 3) {
          providerCompletions++; document.querySelector('#guard').requestSubmit();
        }
      }
    }, true);
    const now = Date.now; window.clockOffset = 0; Date.now = () => now() + clockOffset;
    window.stopRecognition = () => {
      session.active = false; session.state = 'stopped'; session.detail = 'Stopped.';
      for (const listener of listeners) listener({ type: 'CHALLENGE_STATUS', session: { ...session } });
    };
    window.refreshScene = () => {
      const replacement = document.createElement('canvas'); replacement.width = replacement.height = 128;
      const context = replacement.getContext('2d'); context.fillStyle = '#2244aa'; context.fillRect(0, 0, 128, 128);
      if (mode === 'hcaptcha') {
        document.querySelector('.task-image').style.backgroundImage = `url('${replacement.toDataURL()}')`;
        document.querySelector('.prompt-text').textContent = 'Select every image containing a bicycle.';
      } else {
        const image = document.querySelector('.rc-imageselect-target img'); image.className = 'rc-image-tile-11'; image.style.cssText = 'width:80px;height:80px;left:0;top:0'; image.src = replacement.toDataURL();
        document.querySelector('.rc-imageselect-desc-wrapper').textContent = 'Select all images with a bicycle.';
      }
    };
    window.challengeTestApi = { runtime: {
      onMessage: { addListener(listener) { listeners.push(listener); } },
      async sendMessage(message) {
        if (message.type === 'CHALLENGE_HELLO' || message.type === 'CHALLENGE_POLL') return { ok: true, value: { ...session } };
        if (message.type === 'CHALLENGE_SOLVE') {
          const attempt = ++recognitionCalls;
          if (holdRecognition && attempt === 1) {
            recognitionPending = true;
            await new Promise(resolve => { window.releaseRecognition = resolve; });
            recognitionReleased = true;
          }
          return { ok: true, value: { selected: attempt === 1 ? [1, 5, 6] : [2], confidence: .99 } };
        }
        if (message.type === 'CHALLENGE_REPORT') {
          sessionReports.push({ state: message.state, preview: message.preview, detail: message.detail });
          return { ok: true, value: { ...session, state: message.state, preview: message.preview, detail: message.detail } };
        }
        throw new Error(`Unexpected extension message: ${message.type}`);
      },
    } };
  }, { mode, holdRecognition });
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
}

const waitReview = () => page.waitForFunction(() => sessionReports.some(report => report.state === 'review' || report.state === 'failed'), null, { timeout: 10000 });
async function assertNoInput() {
  assert.deepEqual(await page.evaluate(() => ({ clicks: counts.clicks, verify: counts.verify, submit: counts.submit, inputEvents, providerCompletions, hostSubmitAttempts })), {
    clicks: [], verify: 0, submit: 0, inputEvents: 0, providerCompletions: 0, hostSubmitAttempts: 0,
  });
}
async function assertPreview(indices) {
  const reports = await page.evaluate(() => sessionReports);
  assert.equal(reports.some(report => report.state === 'failed'), false, JSON.stringify(reports));
  const previews = reports.filter(report => report.state === 'review');
  assert.equal(previews.length, 1, JSON.stringify(reports));
  await assertNoInput();
  const cells = String(previews[0].preview || '').split(':').at(-1);
  assert.deepEqual([...cells.matchAll(/\d+/g)].map(match => Number(match[0])), indices);
}

try {
  for (const mode of ['static', 'hcaptcha']) {
    await open(mode); await waitReview(); await assertPreview([2, 6, 7]);
    checks.push(`${mode}: review shows one-based cells with zero input, provider completion or host-submit attempts`);

    await open(mode, true);
    await page.waitForFunction(() => recognitionPending, null, { timeout: 10000 });
    await page.evaluate(() => { stopRecognition(); releaseRecognition(); });
    await page.waitForFunction(() => recognitionReleased);
    await page.waitForTimeout(550);
    await assertNoInput();
    assert.equal(await page.evaluate(() => sessionReports.some(report => report.state === 'review')), false);
    checks.push(`${mode}: Stop discards the pending recognition without preview or input`);

    await open(mode, true);
    await page.waitForFunction(() => recognitionPending, null, { timeout: 10000 });
    await page.evaluate(() => { refreshScene(); releaseRecognition(); });
    await waitReview(); await assertPreview([3]);
    assert.equal(await page.evaluate(() => recognitionCalls), 2);
    checks.push(`${mode}: refreshed image and prompt discard stale indices and preview only the fresh result`);
  }
  await open('dynamic'); await waitReview(); await assertPreview([2, 6, 7]);
  await page.evaluate(() => { clockOffset = 11000; });
  await page.waitForTimeout(550); await assertPreview([2, 6, 7]);
  assert.equal(await page.evaluate(() => recognitionCalls), 1);
  checks.push('Dynamic review does not time out waiting for replacement images it never clicked');

  assert.deepEqual(errors, []);
  await mkdir('output/challenges', { recursive: true });
  await writeFile('output/challenges/preview-report.json', JSON.stringify({ kind: 'Actual controller with local grids and deterministic recognition; no live provider or job-site requests', checks }, null, 2) + '\n');
  for (const check of checks) console.log('PASS ' + check);
} finally {
  await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
