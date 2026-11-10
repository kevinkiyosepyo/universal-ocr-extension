import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { matchPuzzle } from '../server/puzzle.mjs';

const bundle = await build({ entryPoints: ['src/binance-widget.js'], bundle: true, format: 'esm', write: false, target: 'chrome116' });
const html = await readFile('tests/fixtures/binance.html', 'utf8');
const fixture = createServer((request, response) => { const script = request.url === '/binance-adapter.js'; response.setHeader('Content-Type', script ? 'text/javascript' : 'text/html'); response.end(script ? bundle.outputFiles[0].text : html); });
fixture.listen(0, '127.0.0.1'); await once(fixture, 'listening');
const browser = await chromium.launch({ channel: 'chromium', headless: true }), page = await browser.newPage(), checks = [], errors = [];
page.on('pageerror', error => errors.push(error.message));
const open = async mode => { await page.goto(`http://127.0.0.1:${fixture.address().port}/?mode=${mode}`); await page.waitForFunction(() => window.ready); };
const prepare = () => page.evaluate(async () => { window.challenge = adapter.binanceSnapshot(); window.capture = await adapter.captureBinance(challenge); window.solution = { normalizedX: 142 / 310, confidence: .99 }; return capture; });
const apply = mode => page.evaluate(async mode => { let finalCalls = 0; try { await adapter.applyBinance(challenge, solution, async () => { if (mode === 'tamper-final' && counts.moves === 16 && ++finalCalls === 2) challenge.handle.style.left = challenge.reference.style.left = '40px'; return mode !== 'stop' || counts.moves < 3; }); return null; } catch (error) { return error.message; } }, mode);
const decode = async value => { const { data, info } = await sharp(Buffer.from(value.split(',')[1], 'base64')).ensureAlpha().raw().toBuffer({ resolveWithObject: true }); return { data, width: info.width, height: info.height }; };
try {
  await open('slide'); const capture = await prepare(), solution = matchPuzzle(await decode(capture.task.image), await decode(capture.task.reference), { y: 0 });
  assert.equal(solution.x, 142); assert.ok(solution.confidence > .85); await page.evaluate(value => { window.solution = value; }, solution);
  assert.match(await page.evaluate(() => adapter.previewBinance(challenge, solution)), /142 pixels right/); assert.equal(await page.evaluate(() => counts.moves), 0);
  assert.equal(await apply(), null); assert.equal(await page.evaluate(() => fixtureAccepted), true); assert.equal(await page.evaluate(() => counts.releases), 1); assert.equal(await page.evaluate(() => counts.submits), 0); assert.equal(await page.evaluate(() => adapter.binanceVerified()), false);
  checks.push('Real texture matcher reads the SDK sprite geometry; review has no input and release alone is not acceptance');
  for (const [mode, operation, error] of [['refresh', undefined, /changed/], ['slide', 'stop', /stopped/], ['slide', 'tamper-final', /changed/]]) {
    await open(mode); await prepare(); assert.match(await apply(operation), error); assert.equal(await page.evaluate(() => counts.releases), 0); assert.equal(await page.evaluate(() => counts.submits), 0);
  }
  checks.push('Refresh, Stop and movement during the final async guard never release verification');
  for (const change of ['image', 'detached', 'position', 'uncertain', 'range', 'overlay']) {
    await open('slide'); await prepare(); await page.evaluate(change => { if (change === 'image') refresh(); if (change === 'detached') challenge.handle.replaceWith(challenge.handle.cloneNode(true)); if (change === 'position') challenge.reference.style.left = '20px'; if (change === 'uncertain') solution.confidence = .2; if (change === 'range') solution.normalizedX = .99; if (change === 'overlay') { const cover = document.createElement('div'); cover.style.cssText = 'position:fixed;inset:0;z-index:999;background:#fff'; document.body.append(cover); } }, change);
    assert.ok(await apply()); assert.equal(await page.evaluate(() => counts.moves + counts.releases + counts.submits), 0);
  }
  checks.push('Changed sprites, controls, existing movement, low confidence, invalid range and overlays stop before input');
  await open('scaled'); assert.match(await page.evaluate(async () => { try { await adapter.captureBinance(adapter.binanceSnapshot()); return ''; } catch (error) { return error.message; } }), /Scaled/);
  await open('slide'); await page.evaluate(() => document.querySelector('.bs-slide-image').style.left = '20px'); assert.match(await page.evaluate(async () => { try { await adapter.captureBinance(adapter.binanceSnapshot()); return ''; } catch (error) { return error.message; } }), /already moved/);
  checks.push('Scaled and previously moved layouts cannot be captured for automatic input');
  await open('accept'); await prepare(); assert.equal(await apply(), null); assert.equal(await page.evaluate(() => adapter.binanceVerified()), true);
  await page.evaluate(() => challenge.root.style.display = 'none'); assert.equal(await page.evaluate(() => adapter.binanceVerified()), false);
  await open('reject'); await prepare(); assert.equal(await apply(), null); assert.match(await page.evaluate(() => adapter.binanceFailure()), /rejected/); assert.equal(await page.evaluate(() => adapter.binanceVerified()), false);
  await page.evaluate(() => challenge.root.remove()); assert.equal(await page.evaluate(() => adapter.binanceVerified()), false);
  checks.push('Only visible SDK success state confirms acceptance; failure and disappearance do not');
  await open('checkbox'); assert.equal(await page.evaluate(() => adapter.binanceVerified()), false); assert.equal(await page.evaluate(() => counts.checks), 0);
  await page.evaluate(() => adapter.binanceManagedSnapshot().control.click()); assert.equal(await page.evaluate(() => adapter.binanceVerified()), true); assert.equal(await page.evaluate(() => counts.submits), 0);
  checks.push('Native checkbox detection preserves the SDK verification path and recognizes its explicit receipt');
  await open('intro'); await page.waitForTimeout(100); assert.equal(await page.evaluate(() => adapter.binanceSnapshot()), null);
  await page.waitForFunction(() => !document.querySelector('.bs-slide-image').getAnimations().some(animation => animation.playState === 'running'));
  assert.equal((await prepare()).task.type, 'puzzle');
  checks.push('The SDK entrance animation waits without failing or treating its translation as user movement');
  const prepareGrid = () => page.evaluate(async () => { window.challenge = adapter.binanceSnapshot(); window.capture = await adapter.captureBinance(challenge); window.solution = { selected: [0, 4], confidence: .99 }; return capture; });
  const applyGrid = mode => page.evaluate(async mode => { let finalCalls = 0; try { return await adapter.applyBinance(challenge, solution, async () => { if (mode === 'final' && counts.selections === 2 && ++finalCalls === 2) challenge.label.textContent = 'Changed target'; return mode !== 'stop' || counts.selections < 1; }); } catch (error) { return { error: error.message }; } }, mode);
  await open('grid-one'); const grid = await prepareGrid(), pixels = await decode(grid.task.image);
  assert.equal(grid.task.type, 'grid'); assert.equal(grid.task.rows, 3); assert.equal(grid.task.columns, 3);
  for (let index = 0; index < 9; index++) { const offset = ((Math.floor(index / 3) * 128 + 64) * pixels.width + index % 3 * 128 + 64) * 4; assert.deepEqual([...pixels.data.subarray(offset, offset + 3)], [20 + index * 20, 90, 220 - index * 17]); }
  assert.match(await page.evaluate(() => adapter.previewBinance(challenge, solution)), /cells 1, 5/); assert.equal(await page.evaluate(() => counts.selections + counts.verifies), 0);
  assert.equal(await page.evaluate(() => adapter.binanceVerified()), false); assert.deepEqual(await applyGrid(), { nextPage: false, page: 1, pages: 1 });
  assert.equal(await page.evaluate(() => counts.selections), 2); assert.equal(await page.evaluate(() => counts.verifies), 1); assert.equal(await page.evaluate(() => counts.submits), 0); assert.equal(await page.evaluate(() => adapter.binanceVerified()), false);
  checks.push('Grid CSS sprites preserve all nine crops; preview and clipped default banners never imply acceptance');
  await open('grid-two'); const firstGrid = await prepareGrid(); assert.deepEqual(await applyGrid(), { nextPage: true, page: 1, pages: 2 });
  assert.equal(await page.evaluate(() => adapter.binanceVerified()), false); const secondGrid = await prepareGrid(); assert.notEqual(firstGrid.fingerprint, secondGrid.fingerprint);
  assert.deepEqual(await applyGrid(), { nextPage: false, page: 2, pages: 2 }); assert.equal(await page.evaluate(() => adapter.binanceVerified()), true); assert.equal(await page.evaluate(() => counts.verifies), 2); assert.equal(await page.evaluate(() => counts.submits), 0);
  await page.evaluate(() => challenge.root.style.display = 'none'); assert.equal(await page.evaluate(() => adapter.binanceVerified()), false);
  await open('grid-one'); assert.equal(await page.evaluate(() => { const banner = document.querySelector('.bcap-success-message'); banner.style.transition = 'bottom .2s ease-out'; banner.getBoundingClientRect(); banner.style.bottom = '0px'; return adapter.binanceVerified(); }), true);
  checks.push('Two-page grids select only the fully visible page and require the final explicit success banner');
  for (const [mode, operation] of [['grid-refresh', undefined], ['grid-one', 'stop'], ['grid-one', 'final']]) { await open(mode); await prepareGrid(); assert.ok((await applyGrid(operation)).error); assert.equal(await page.evaluate(() => counts.verifies + counts.submits), 0); }
  for (const change of ['selection', 'invalid', 'confidence', 'overlay', 'verify']) {
    await open('grid-one'); await prepareGrid();
    await page.evaluate(change => { if (change === 'selection') challenge.tiles[8].setAttribute('selected', 'true'); if (change === 'invalid') solution.selected = [9]; if (change === 'confidence') solution.confidence = .1; if (change === 'overlay') { const cover = document.createElement('div'); cover.style.cssText = 'position:fixed;inset:0;z-index:999;background:white'; document.body.append(cover); } if (change === 'verify') challenge.verify.replaceWith(challenge.verify.cloneNode(true)); }, change);
    assert.ok((await applyGrid()).error); assert.equal(await page.evaluate(() => counts.selections + counts.verifies + counts.submits), 0);
  }
  await open('grid-loading'); assert.equal(await page.evaluate(() => adapter.binanceSnapshot()), null); assert.equal(await page.evaluate(() => adapter.binanceFailure()), null);
  await open('grid-reject'); await prepareGrid(); await applyGrid(); assert.match(await page.evaluate(() => adapter.binanceFailure()), /rejected/); assert.equal(await page.evaluate(() => adapter.binanceVerified()), false);
  checks.push('Grid Stop, refresh, final-await mutation, stale controls and uncertain selections cannot verify');
  assert.deepEqual(errors, []);
  await mkdir('output/playwright/binance', { recursive: true }); await writeFile('output/playwright/binance/report.json', JSON.stringify({ kind: 'SDK-derived local fixtures; not live Binance acceptance', checks }, null, 2) + '\n');
  checks.forEach(check => console.log('PASS ' + check));
} finally { await browser.close(); fixture.closeAllConnections(); await new Promise(resolve => fixture.close(resolve)); }
