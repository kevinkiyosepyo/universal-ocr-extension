import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { createSolverServer } from '../server/app.mjs';
import { SolverClient } from '../shared/client.js';

const bundle = await build({ entryPoints: ['src/hcaptcha-points.js'], bundle: true, format: 'iife', globalName: 'pointAdapter', write: false, target: 'chrome116' });
const html = await readFile('tests/fixtures/points.html', 'utf8');
const fixture = createServer((req, res) => { res.setHeader('Content-Type', 'text/html'); res.end(`<title>Point frame fixture</title><iframe width="650" height="650" src="https://newassets.hcaptcha.com/fixture${new URL(req.url, 'http://fixture').search}"></iframe>`); });
fixture.listen(0, '127.0.0.1'); await once(fixture, 'listening');
const key = randomBytes(32).toString('hex'), { server } = createSolverServer({ key, model: 'unused', ollamaEndpoint: 'http://127.0.0.1:1' });
server.listen(0, '127.0.0.1'); await once(server, 'listening');
const client = new SolverClient({ endpoint: `http://127.0.0.1:${server.address().port}`, key });
const browser = await chromium.launch({ channel: 'chromium', headless: true });
const context = await browser.newContext();
await context.route('https://newassets.hcaptcha.com/fixture*', route => route.fulfill({ contentType: 'text/html', body: html }));
await context.route('https://newassets.hcaptcha.com/point-adapter.js', route => route.fulfill({ contentType: 'text/javascript', body: bundle.outputFiles[0].text }));
const page = await context.newPage(), checks = [], errors = []; page.on('pageerror', error => errors.push(error.message));
let frame;
const open = async (mode = '') => { await page.goto(`http://127.0.0.1:${fixture.address().port}/?mode=${mode}`); frame = page.frames().find(f => f.url().includes('newassets.hcaptcha.com/fixture')); await frame.waitForFunction(() => window.pointAdapter && window.counts); };
const prepare = async () => frame.evaluate(async () => {
  const c = pointAdapter.resolvePointInstruction(pointAdapter.hcaptchaPointsSnapshot(), 'Click the THREE matching shapes');
  window.challenge = c; window.expectedImage = c.image.toDataURL();
  // Production capture uses layout pixels; retain that path for this fixture.
  const canvas=document.createElement('canvas');canvas.width=360;canvas.height=320;canvas.getContext('2d').drawImage(c.image,0,0,360,320);window.expectedImage=canvas.toDataURL();
  window.solution = { points: centers, confidence: .95 };
});
const apply = async mode => frame.evaluate(async mode => { try { await pointAdapter.applyPointSelection(challenge,solution,async()=>mode==='cancel'?counts.clicks.length===0:true,expectedImage); return null; } catch(error){return error.message;} },mode);
try {
  await open();
  const header = await frame.evaluate(() => { const c=pointAdapter.hcaptchaPointsSnapshot(); return {pending:c.needsInstruction,image:pointAdapter.capturePointHeader(c)}; });
  assert.equal(header.pending, true);
  const read = await client.solve({type:'ocr',image:header.image});
  assert.equal(await frame.evaluate(read => pointAdapter.resolvePointInstruction(pointAdapter.hcaptchaPointsSnapshot(),read).expectedCount,read.text),3);
  checks.push('Canvas-only instruction is read by the real OCR engine before selecting the supported static mode');
  await prepare();
  await frame.evaluate(()=>pointAdapter.pointSelection(challenge,solution));
  assert.deepEqual(await frame.evaluate(()=>counts),{clicks:[],verify:0,submit:0});
  checks.push('Review validation makes no point clicks or verification attempts');
  assert.equal(await apply(),null);
  let counts=await frame.evaluate(()=>window.counts);assert.equal(counts.clicks.length,3);assert.equal(counts.verify,1);assert.equal(counts.submit,0);
  assert.equal(await frame.locator('#checkbox').getAttribute('aria-checked'),'true');
  checks.push('Three normalized centers map into the cross-origin frame and use only its provider Verify control');
  assert.equal(await frame.evaluate(()=>pointAdapter.pointSceneMatches(challenge,expectedImage,solution.points)),true);
  await frame.evaluate(()=>{ctx.fillStyle='#f00';ctx.fillRect(centers[0].x*720+60,centers[0].y*640,4,4);});
  assert.equal(await frame.evaluate(()=>pointAdapter.pointSceneMatches(challenge,expectedImage,solution.points)),false);
  await frame.evaluate(()=>drawScene(true));
  assert.equal(await frame.evaluate(()=>pointAdapter.pointSceneMatches(challenge,expectedImage,solution.points)),false);
  checks.push('Full-size 21-pixel selection rings are ignored but scene changes invalidate the recognized image');
  for(const [mode,pattern] of [['wrong-count',/Exactly/],['duplicate',/overlap/],['bounds',/valid shape centers/],['uncertain',/reliably/]]){
    await open();await prepare();
    await frame.evaluate(mode=>{if(mode==='wrong-count')solution.points=solution.points.slice(0,2);if(mode==='duplicate')solution.points=[centers[0],centers[0],centers[2]];if(mode==='bounds')solution.points[0]={x:1.01,y:.5};if(mode==='uncertain')solution.confidence=.5;},mode);
    assert.match(await apply(),pattern);assert.equal(await frame.evaluate(()=>counts.clicks.length),0);assert.equal(await frame.evaluate(()=>counts.verify),0);
  }
  checks.push('Wrong count, overlapping points, out-of-bounds coordinates, and low confidence stop before input');
  await open();await prepare();await frame.evaluate(()=>drawScene(true));assert.match(await apply(),/changed/);assert.equal(await frame.evaluate(()=>counts.clicks.length),0);
  checks.push('A changed canvas between recognition and action receives no clicks');
  await open('refresh');await prepare();assert.match(await apply(),/changed/);assert.equal(await frame.evaluate(()=>counts.clicks.length),1);assert.equal(await frame.evaluate(()=>counts.verify),0);
  checks.push('A scene refresh after the first point prevents the remaining clicks and Verify');
  await open();await prepare();assert.match(await apply('cancel'),/stopped/);assert.equal(await frame.evaluate(()=>counts.clicks.length),1);assert.equal(await frame.evaluate(()=>counts.verify),0);
  checks.push('Stopping after the first point prevents further input and verification');
  await open();await prepare();await frame.evaluate(()=>document.querySelector('.button-submit').textContent='Next');assert.match(await apply(),/already has selections/);assert.equal(await frame.evaluate(()=>counts.clicks.length),0);
  checks.push('Existing point selections are preserved');
  assert.match(await frame.evaluate(()=>{try{pointAdapter.resolvePointInstruction(challenge,'Drag the shape into the hole');return '';}catch(e){return e.message;}}),/unsupported/);
  checks.push('Unrecognized OCR instructions cannot enable the point adapter');
  await open('scaled');await prepare();assert.equal(await apply(),null);assert.equal(await frame.locator('#checkbox').getAttribute('aria-checked'),'true');
  checks.push('Scaled canvas display preserves normalized click positions');
  await open();
  await frame.evaluate(()=>{const grid=document.createElement('div');grid.className='task-grid';grid.style.cssText='width:300px;height:100px';grid.append(document.createElement('canvas'),document.createElement('canvas'));document.querySelector('.challenge-view').append(grid);});
  assert.equal(await frame.evaluate(()=>pointAdapter.hcaptchaPointsSnapshot()),null);
  checks.push('Visible image grids with canvas tiles stay with the grid adapter');
  assert.deepEqual(errors,[]);
  await mkdir('output/points',{recursive:true});await writeFile('output/points/report.json',JSON.stringify({kind:'direct adapter browser fixtures',checks},null,2)+'\n');
  checks.forEach(check=>console.log('PASS '+check));
} finally {await browser.close();for(const service of [fixture,server]){service.closeAllConnections();await new Promise(resolve=>service.close(resolve));}}
