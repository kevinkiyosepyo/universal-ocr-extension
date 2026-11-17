import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { chromium } from 'playwright';

// Isolated local fixtures exercise the production DOM adapter, without any
// recognition model, live provider request, or user browser profile.
const html = await readFile('tests/fixtures/challenge.html', 'utf8');
const bundle = await build({ entryPoints: ['src/challenge-dom.js'], bundle: true, format: 'iife', globalName: 'gridAdapter', write: false, target: 'chrome116' });
const server = createServer((_request, response) => { response.setHeader('Content-Type', 'text/html'); response.end(html); });
server.listen(0, '127.0.0.1'); await once(server, 'listening');
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: 'chromium', headless: true });
const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
const checks = [], errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.route('**/*', route => {
  const url = new URL(route.request().url());
  if (['www.google.com', 'newassets.hcaptcha.com', 'unrelated.example.test'].includes(url.hostname)) return route.fulfill({ contentType: 'text/html', body: html });
  return url.origin === origin ? route.continue() : route.abort();
});
const open = async (mode = 'static') => { await page.goto(`${origin}/?mode=${mode}`); await page.waitForFunction(() => [...document.images].every(image => image.complete && image.naturalWidth)); await page.addScriptTag({ content: bundle.outputFiles[0].text }); };
const capture = () => page.evaluate(async () => { window.challenge = gridAdapter.snapshot(); window.capture = await gridAdapter.captureGrid(challenge); return capture.fingerprint; });
const errorCode = action => page.evaluate(action);
try {
  await open(); await capture();
  const stable = await page.evaluate(async () => {
    const before = capture.fingerprint;
    for (const index of [1, 5, 6]) gridAdapter.clickTile(challenge.tiles[index], challenge.root);
    const after = await gridAdapter.captureGrid(gridAdapter.snapshot());
    gridAdapter.verifyChallenge(challenge);
    return { samePixels: capture.image === after.image, sameFingerprint: before === after.fingerprint, counts };
  });
  assert.deepEqual(stable, { samePixels: true, sameFingerprint: true, counts: { clicks: [1, 5, 6], verify: 1, submit: 0 } });
  checks.push('Static sprite capture ignores selected-image shrinking while preserving guarded clicks and Verify');

  await open('dynamic'); await capture();
  await page.evaluate(() => gridAdapter.clickTile(challenge.tiles[1], challenge.root));
  assert.equal(await errorCode(() => { try { gridAdapter.verifyChallenge(challenge); } catch (error) { return error.code; } }), 'GRID_CHANGED');
  await page.waitForFunction(() => document.querySelectorAll('.rc-image-tile-11').length === 1);
  assert.equal(await errorCode(() => { try { gridAdapter.clickTile(challenge.tiles[5], challenge.root); } catch (error) { return error.code; } }), 'GRID_CHANGED');
  const replacement = await page.evaluate(async () => {
    const latest = gridAdapter.snapshot(), next = await gridAdapter.captureGrid(latest);
    const image = await gridAdapter.loadImage(next.image), canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
    const matching = [...Array(9)].map((_, index) => index).filter(index => { const pixel = ctx.getImageData((index % 3 + .5) * 128, (Math.floor(index / 3) + .5) * 128, 1, 1).data; return pixel[0] > 150 && pixel[1] < 80; });
    return { changed: next.fingerprint !== capture.fingerprint, matching, counts };
  });
  assert.equal(replacement.changed, true); assert.deepEqual(replacement.matching, [5, 6]); assert.deepEqual(replacement.counts, { clicks: [1], verify: 0, submit: 0 });
  checks.push('Dynamic replacement invalidates old targets and recaptures the full replacement cell; pending selections cannot Verify');

  await open();
  await page.evaluate(() => {
    const image = document.images[0];
    window.originalSource = image.src;
    Object.defineProperty(image, 'currentSrc', { configurable: true, value: 'https://images.example.test/pending.png' });
    window.captureResult = gridAdapter.captureGrid(gridAdapter.snapshot(), async () => {
      window.fetchPending = true;
      await new Promise(resolve => { window.releaseFetch = resolve; });
      return originalSource;
    }).then(() => 'accepted', error => error.code);
  });
  await page.waitForFunction(() => fetchPending);
  await page.evaluate(() => { delete document.images[0].currentSrc; change(); releaseFetch(); });
  assert.equal(await page.evaluate(() => captureResult), 'GRID_CHANGED');
  assert.deepEqual(await page.evaluate(() => counts), { clicks: [], verify: 0, submit: 0 });
  checks.push('A source replacement while asynchronous image fetch is pending rejects the stale capture');

  for (const mutation of ['source', 'prompt', 'order', 'verify-parent']) {
    await open(); await capture();
    const result = await page.evaluate(mutation => {
      if (mutation === 'source') change();
      if (mutation === 'prompt') document.querySelector('.rc-imageselect-desc-wrapper').textContent = 'Select all images with bicycles';
      if (mutation === 'order') challenge.tiles[0].parentElement.append(challenge.tiles[0]);
      if (mutation === 'verify-parent') { const wrapper = document.createElement('div'); document.body.append(wrapper); wrapper.append(challenge.verify); }
      try { gridAdapter.clickTile(challenge.tiles[1], challenge.root); } catch (error) { return { code: error.code, counts }; }
    }, mutation);
    assert.deepEqual(result, { code: 'GRID_CHANGED', counts: { clicks: [], verify: 0, submit: 0 } });
  }
  checks.push('Source, prompt, tile-order and Verify-parent changes stop before input despite connected original nodes');

  await open(); await capture();
  const manualChange = await page.evaluate(() => { challenge.tiles[1].classList.add('rc-imageselect-tileselected'); try { gridAdapter.clickTile(challenge.tiles[1], challenge.root); } catch (error) { return { code: error.code, stillSelected: gridAdapter.selected(challenge.tiles[1]), counts }; } });
  assert.deepEqual(manualChange, { code: 'GRID_CHANGED', stillSelected: true, counts: { clicks: [], verify: 0, submit: 0 } });
  await open(); await capture();
  const dropped = await page.evaluate(() => { challenge.tiles[1].onclick = null; gridAdapter.clickTile(challenge.tiles[1], challenge.root); try { gridAdapter.clickTile(challenge.tiles[5], challenge.root); } catch (error) { return { code: error.code, counts }; } });
  assert.deepEqual(dropped, { code: 'GRID_CHANGED', counts: { clicks: [], verify: 0, submit: 0 } });
  checks.push('Manual selection changes and ignored clicks stop the remaining sequence without toggling user choices');

  await open(); await capture();
  const identity = await page.evaluate(async () => {
    challenge.root.replaceChildren(challenge.root.firstElementChild.cloneNode(true));
    await Promise.all([...document.images].map(image => image.decode()));
    const next = await gridAdapter.captureGrid(gridAdapter.snapshot());
    return { sameImage: next.image === capture.image, differentFingerprint: next.fingerprint !== capture.fingerprint };
  });
  assert.deepEqual(identity, { sameImage: true, differentFingerprint: true });
  checks.push('Identical pixels in a new challenge generation produce a distinct fingerprint');

  await open();
  await page.evaluate(() => {
    const image = document.images[0], canvas = document.createElement('canvas'); canvas.width = canvas.height = 80; const ctx = canvas.getContext('2d'); ctx.fillStyle = 'red'; ctx.fillRect(0, 0, 80, 80); image.replaceWith(canvas);
  });
  await capture();
  assert.equal(await errorCode(() => { const canvas = document.querySelector('canvas'); canvas.getContext('2d').clearRect(0, 0, 80, 80); try { gridAdapter.clickTile(challenge.tiles[1], challenge.root); } catch (error) { return error.code; } }), 'GRID_CHANGED');
  checks.push('In-place canvas pixel changes invalidate the input guard');

  await open();
  assert.equal(await page.evaluate(() => { Object.defineProperty(document.images[0], 'complete', { configurable: true, value: false }); return gridAdapter.snapshot(); }), null);
  await open();
  assert.equal(await page.evaluate(() => { const original = document.images[0]; original.parentElement.append(original.cloneNode()); return gridAdapter.snapshot(); }), null);
  await open();
  assert.equal(await page.evaluate(() => { document.images[0].remove(); return gridAdapter.snapshot(); }), null);
  checks.push('Undecoded, missing or overlapping departing/replacement images wait instead of producing a partial grid');

  await open();
  assert.equal(await page.evaluate(() => { document.querySelector('#recaptcha-anchor').setAttribute('aria-checked', 'true'); document.querySelector('#checkbox').setAttribute('aria-checked', 'true'); return gridAdapter.verifiedWidget(['recaptcha-v2', 'hcaptcha']); }), false);
  for (const [url, provider, marker, expected] of [
    ['https://www.google.com/recaptcha/fixture', 'recaptcha-v2', '#recaptcha-anchor', true],
    ['https://newassets.hcaptcha.com/captcha/v1/fixture/hcaptcha.html', 'hcaptcha', '#checkbox', true],
    ['https://unrelated.example.test/fixture', 'recaptcha-v2', '#recaptcha-anchor', false],
    ['https://unrelated.example.test/fixture', 'hcaptcha', '#checkbox', false],
  ]) {
    await page.goto(origin); await page.setContent(`<iframe width="600" height="700" src="${url}"></iframe>`);
    await page.frameLocator('iframe').locator(marker).waitFor();
    const frame = page.frames().find(frame => frame.url() === url); await frame.addScriptTag({ content: bundle.outputFiles[0].text });
    const checked = await frame.evaluate(({ provider, marker }) => { document.querySelector(marker).setAttribute('aria-checked', 'true'); return gridAdapter.verifiedWidget([provider]); }, { provider, marker });
    assert.equal(checked, expected);
    assert.equal(await frame.evaluate(({ provider, marker }) => { document.querySelector(marker).hidden = true; return gridAdapter.verifiedWidget([provider]); }, { provider, marker }), false);
  }
  await page.goto('https://www.google.com/recaptcha/fixture'); await page.addScriptTag({ content: bundle.outputFiles[0].text });
  assert.equal(await page.evaluate(() => { document.querySelector('#recaptcha-anchor').setAttribute('aria-checked', 'true'); return gridAdapter.verifiedWidget(['recaptcha-v2']); }), false);
  checks.push('Only visible checked widgets in provider child frames count as receipts; host, unrelated, hidden and top-level markers do not');

  await open('guard'); await capture();
  assert.match(await errorCode(() => { try { gridAdapter.verifyChallenge(challenge); } catch (error) { return error.message; } }), /submission controls/);
  assert.equal(await page.evaluate(() => counts.submit), 0);
  checks.push('Form-submission refusal remains enforced after freshness checks');
  assert.deepEqual(errors, []);
  await mkdir('output/challenges', { recursive: true });
  await writeFile('output/challenges/dom-guard-report.json', JSON.stringify({ kind: 'Production DOM adapter with isolated provider-origin fixtures, not live acceptance', checks }, null, 2) + '\n');
  checks.forEach(check => console.log('PASS ' + check));
} finally { await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
