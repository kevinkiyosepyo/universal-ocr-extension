import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import sharp from 'sharp';

// SDK-derived fixtures, not AWS requests or provider acceptance tests.
const bundle = await build({ entryPoints: ['src/aws-waf-widget.js'], bundle: true, format: 'esm', write: false, target: 'chrome116' });
const html = await readFile('tests/fixtures/aws-waf.html', 'utf8');
const fixture = createServer((request, response) => { const script = request.url === '/aws-adapter.js'; response.setHeader('Content-Type', script ? 'text/javascript' : 'text/html'); response.end(script ? bundle.outputFiles[0].text : html); });
fixture.listen(0, '127.0.0.1'); await once(fixture, 'listening');
const browser = await chromium.launch({ channel: 'chromium', headless: true }), page = await browser.newPage(), checks = [], errors = [];
page.on('pageerror', error => errors.push(error.message));
const open = async (mode = 'grid', count = 9) => { await page.goto(`http://127.0.0.1:${fixture.address().port}/?mode=${mode}&count=${count}`); await page.waitForFunction(() => window.ready); };
const capture = () => page.evaluate(async () => { window.challenge = adapter.awsWafSnapshot(); window.captured = await adapter.captureAwsWaf(challenge); window.solution = { selected: [0, 3, 6], confidence: .99 }; return captured; });
const apply = stop => page.evaluate(async stop => { try { await adapter.applyAwsWaf(challenge, solution, async () => !stop || counts.clicks.length === 0); return null; } catch (error) { return error.message; } }, stop);
try {
  for (const count of [9, 12, 16]) {
    await open('grid', count); const { task } = await capture(), metadata = await sharp(Buffer.from(task.image.split(',')[1], 'base64')).metadata();
    assert.equal(task.rows, count === 9 ? 3 : 4); assert.equal(task.columns, count <= 12 ? 3 : 4); assert.equal(metadata.width / task.columns, metadata.height / task.rows);
    assert.match(await page.evaluate(() => adapter.previewAwsWaf(challenge, solution)), /No cells have been selected/);
    assert.deepEqual(await page.evaluate(() => counts.clicks), []);
    assert.equal(await apply(), null);
    assert.deepEqual(await page.evaluate(() => counts.clicks), [0, 3, 6]);
    assert.deepEqual(await page.evaluate(() => ({ verify: counts.verify, application: counts.application, prevented: counts.prevented })), { verify: 1, application: 0, prevented: true });
    assert.equal(await page.evaluate(() => adapter.awsWafStatus()?.state), 'puzzle-correct');
  }
  checks.push('9/12/16-cell canvas grids remove gutters, preserve review mode, and Confirm only in the protected provider form');
  await open('interstitial'); await capture(); assert.equal(await apply(), null); assert.equal(await page.evaluate(() => counts.application), 0);
  checks.push('Official-script-marked interstitial container uses the same scoped grid contract');
  for (const [mode, pattern] of [['scaled', /Scaled/], ['existing', /already has selections/], ['unknown', /unsupported/]]) {
    await open(mode); assert.match(await page.evaluate(async () => { try { await adapter.captureAwsWaf(adapter.awsWafSnapshot()); return ''; } catch (error) { return error.message; } }), pattern); assert.equal(await page.evaluate(() => counts.clicks.length + counts.verify + counts.application), 0);
  }
  checks.push('Scaled layouts, existing selections and unsupported puzzle types stop before input');
  for (const [mode, pattern] of [['refresh', /image changed/], ['prompt', /instruction changed/], ['reselect', /selection or layout changed/]]) {
    await open(mode); await capture(); assert.match(await apply(), pattern); assert.equal(await page.evaluate(() => counts.clicks.length), 1); assert.equal(await page.evaluate(() => counts.verify), 0);
  }
  checks.push('Image, instruction and selection changes after the first click stop further input');
  await open(); await capture(); assert.match(await apply(true), /stopped/); assert.equal(await page.evaluate(() => counts.clicks.length), 1); assert.equal(await page.evaluate(() => counts.verify), 0);
  checks.push('Stop after one selection prevents remaining clicks and Confirm');
  for (const change of ['action', 'outside', 'overlay', 'replace', 'image']) {
    await open(); await capture(); await page.evaluate(change => {
      if (change === 'action') challenge.form.action = '/application';
      if (change === 'outside') document.querySelector('#application').append(challenge.verify);
      if (change === 'replace') challenge.tiles[1].replaceWith(challenge.tiles[1].cloneNode(true));
      if (change === 'image') refresh();
      if (change === 'overlay') { const r = canvas.getBoundingClientRect(), cover = document.createElement('div'); cover.style.cssText = `position:fixed;left:${r.x}px;top:${r.y}px;width:${r.width}px;height:${r.height}px;background:red;z-index:99`; document.body.append(cover); }
    }, change);
    assert.match(await apply(), /changed|obscured/); assert.equal(await page.evaluate(() => counts.verify + counts.application), 0);
  }
  checks.push('Changed provider forms, outer application controls, overlays, replacement controls and stale pixels cannot verify');
  await open('rounds'); const first = await capture(); assert.equal(await apply(), null); const second = await capture(); assert.notEqual(first.fingerprint, second.fingerprint); assert.equal(await apply(), null); assert.equal(await page.evaluate(() => counts.verify), 2);
  checks.push('A fresh grid round has a new capture and can be processed without replaying the previous round');
  await open('reject'); await capture(); assert.equal(await apply(), null); assert.equal(await page.evaluate(() => adapter.awsWafStatus()?.state), 'failed');
  await open('gone'); await capture(); assert.equal(await apply(), null); assert.equal(await page.evaluate(() => adapter.awsWafStatus()), null);
  checks.push('Provider error is failure; widget disappearance never establishes success');
  await open(); await page.evaluate(() => showSuccess()); assert.equal(await page.evaluate(() => adapter.awsWafStatus()?.state), 'puzzle-correct'); await page.evaluate(() => host.style.display = 'none'); assert.equal(await page.evaluate(() => adapter.awsWafStatus()), null);
  checks.push('Visible success is puzzle-correct only: token issuance remains unconfirmed and hidden success does not count');
  await open();
  const observed = await page.evaluate(async () => {
    const statuses = [], stop = adapter.observeAwsWafStatus(status => statuses.push(status.state));
    showSuccess(); await Promise.resolve(); shadow.querySelector('#root').remove(); await Promise.resolve(); stop();
    return statuses;
  });
  assert.deepEqual(observed, ['puzzle-correct']);
  await open();
  assert.deepEqual(await page.evaluate(async () => { const statuses = [], stop = adapter.observeAwsWafStatus(status => statuses.push(status.state)); stop(); showSuccess(); await Promise.resolve(); return statuses; }), []);
  checks.push('Shadow-root observer captures a fleeting puzzle receipt and its disposer prevents stale callbacks');
  assert.deepEqual(errors, []);
  await mkdir('output/playwright/aws-waf', { recursive: true }); await writeFile('output/playwright/aws-waf/report.json', JSON.stringify({ kind: 'SDK-derived direct adapter fixtures; no live AWS acceptance', checks }, null, 2) + '\n'); checks.forEach(check => console.log('PASS ' + check));
} finally { await browser.close(); fixture.closeAllConnections(); await new Promise(resolve => fixture.close(resolve)); }
