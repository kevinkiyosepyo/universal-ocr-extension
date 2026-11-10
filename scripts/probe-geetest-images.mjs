// Explicit official-demo acceptance check. No account or application is used.
import { chromium } from 'playwright';
import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { createSolverServer } from '../server/app.mjs';
import { SolverClient } from '../shared/client.js';
import { imageBase64 } from '../shared/protocol.js';

const mode = process.argv[2] || 'icons';
const demos = { icons: 'https://gt4.geetest.com/demov4/icon-popup-en.html', grid: 'https://gt4.geetest.com/demov4/nine-popup-en.html' };
if (!demos[mode]) throw new Error('Choose icons or grid.');
const output = resolve('output/playwright/live-geetest-images', new Date().toISOString().replaceAll(':', '-') + '-' + mode);
await mkdir(output, { recursive: true });
const key = randomBytes(32).toString('hex'), { server } = createSolverServer({ key, model: process.env.OCR_VISION_MODEL || 'qwen3-vl:4b-instruct', textModel: 'glm-ocr:q8_0', ollamaEndpoint: process.env.OCR_OLLAMA_ENDPOINT || 'http://127.0.0.1:11435' });
server.listen(0, '127.0.0.1'); await once(server, 'listening');
const solver = new SolverClient({ endpoint: `http://127.0.0.1:${server.address().port}`, key });
const bundle = await build({ entryPoints: ['src/geetest-images.js'], bundle: true, format: 'iife', globalName: 'geetestImagesAdapter', write: false, target: 'chrome116' });
const browser = await chromium.launch({ channel: 'chromium', headless: !process.argv.includes('--headed') });
const context = await browser.newContext({ viewport: { width: 1200, height: 1000 } });
const page = await context.newPage();
const report = { mode, url: demos[mode], kind: 'official public demo, direct production adapter with real local model', model: process.env.OCR_VISION_MODEL || 'qwen3-vl:4b-instruct', startedAt: new Date().toISOString(), accepted: false };
let blockedFormNavigations = 0;
await context.addInitScript(() => {
  window.probeSubmitAttempts = 0; window.probeSawSuccess = false;
  document.addEventListener('submit', event => { event.preventDefault(); window.probeSubmitAttempts++; }, true);
  HTMLFormElement.prototype.submit = function () { window.probeSubmitAttempts++; };
  const record = () => { if (document.querySelector('.geetest_captcha.geetest_success, .geetest_holder.geetest_success, .geetest_holder.geetest_success_animate')) window.probeSawSuccess = true; };
  new MutationObserver(record).observe(document, { subtree: true, attributes: true, childList: true });
});
await context.route('**/*', route => {
  const request = route.request();
  if (request.isNavigationRequest() && request.frame().parentFrame() === null && !['GET', 'HEAD'].includes(request.method())) { blockedFormNavigations++; return route.abort(); }
  return route.continue();
});
await page.exposeFunction('probeFetchImage', async url => {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || !['static.geetest.com', 'static.geevisit.com'].includes(parsed.hostname)) throw new Error('Unreviewed image origin.');
  const response = await context.request.get(url);
  if (!response.ok()) throw new Error('Image request failed: ' + response.status());
  return 'data:' + (response.headers()['content-type'] || 'image/png') + ';base64,' + (await response.body()).toString('base64');
});
try {
  await page.goto(report.url, { waitUntil: 'domcontentloaded' });
  await page.locator('.geetest_btn_click').click();
  await page.locator(mode === 'icons' ? '.geetest_box .geetest_click .geetest_bg' : '.geetest_box .geetest_nine .geetest_item_img').first().waitFor({ timeout: 30000 });
  await page.waitForFunction(() => [...document.querySelectorAll('.geetest_ques_tips img')].length > 0 && [...document.querySelectorAll('.geetest_ques_tips img')].every(node => node.complete && node.naturalWidth > 0));
  await page.waitForFunction(() => {
    const value = JSON.stringify([...document.querySelectorAll('.geetest_box, .geetest_item, .geetest_ques_tips img')].map(node => { const { x, y, width, height } = node.getBoundingClientRect(); return { x, y, width, height }; }));
    if (window.probeLayout !== value) { window.probeLayout = value; window.probeLayoutSince = performance.now(); }
    return performance.now() - window.probeLayoutSince > 250;
  });
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await page.screenshot({ path: join(output, 'before.png') });
  const captured = await page.evaluate(async () => {
    window.probeChallenge = geetestImagesAdapter.geetestImagesSnapshot();
    if (!probeChallenge) throw new Error('No supported image challenge.');
    window.probeCaptured = await geetestImagesAdapter.captureGeetestImages(probeChallenge, probeFetchImage);
    return probeCaptured;
  });
  await writeFile(join(output, 'task.png'), Buffer.from(imageBase64(captured.task.image), 'base64'));
  report.prompt = captured.task.prompt;
  const started = Date.now();
  report.solution = await solver.solve(captured.task);
  report.inferenceMs = Date.now() - started;
  const fresh = await page.evaluate(async () => (await geetestImagesAdapter.captureGeetestImages(probeChallenge, probeFetchImage)).fingerprint);
  if (fresh !== captured.fingerprint) throw new Error('Challenge changed while recognition was running.');
  report.preview = await page.evaluate(solution => geetestImagesAdapter.previewGeetestImages(probeChallenge, solution), report.solution);
  await page.evaluate(solution => geetestImagesAdapter.applyGeetestImages(probeChallenge, solution, async () => true), report.solution);
  report.applied = true;
  for (let i = 0; i < 160; i++) {
    if (await page.evaluate(() => window.probeSawSuccess)) { report.accepted = true; break; }
    const failed = await page.locator('.geetest_result_tips').allTextContents();
    if (failed.some(text => /fail|try again|incorrect/i.test(text))) { report.providerMessage = failed; break; }
    await new Promise(resolve => setTimeout(resolve, 75));
  }
  report.elapsedMs = Date.now() - started;
  report.providerMessage ||= await page.locator('.geetest_result_tips, .geetest_result_content').allTextContents();
} catch (error) { report.error = error.message; }
finally {
  report.selectionState = await page.evaluate(() => ({ marks: [...document.querySelectorAll('.geetest_square_mark')].map(node => ({ number: node.querySelector('.geetest_mark_no')?.innerText, markup: node.outerHTML, parent: node.parentElement.className })), grid: [...document.querySelectorAll('.geetest_item')].map((node, index) => ({ index, selected: Boolean(node.querySelector('.geetest_item_ghost.geetest_selected')) })) })).catch(() => null);
  report.submitAttempts = await page.evaluate(() => window.probeSubmitAttempts).catch(() => null);
  report.blockedFormNavigations = blockedFormNavigations;
  await page.screenshot({ path: join(output, 'after.png') }).catch(() => {});
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2)); console.log('Evidence: ' + output);
  await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
