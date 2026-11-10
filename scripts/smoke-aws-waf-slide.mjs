import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const bundle=await build({entryPoints:['src/aws-waf-widget.js'],bundle:true,format:'esm',write:false,target:'chrome116'}),html=await readFile('tests/fixtures/aws-waf-slide.html','utf8');
const fixture=createServer((request,response)=>{const script=request.url==='/aws-adapter.js';response.setHeader('Content-Type',script?'text/javascript':'text/html');response.end(script?bundle.outputFiles[0].text:html)});fixture.listen(0,'127.0.0.1');await once(fixture,'listening');
const browser=await chromium.launch({channel:'chromium',headless:true}),page=await browser.newPage(),checks=[],errors=[];page.on('pageerror',error=>errors.push(error.message));
const open=async mode=>{await page.goto(`http://127.0.0.1:${fixture.address().port}/?mode=${mode||'normal'}`);await page.waitForFunction(()=>ready)};
const capture=()=>page.evaluate(async()=>{window.challenge=adapter.awsWafSnapshot();window.captured=await adapter.captureAwsWaf(challenge);window.solution={points:[{x:.75,y:.3},{x:.25,y:.7}],confidence:.99};return captured});
const apply=stop=>page.evaluate(async stop=>{try{await adapter.applyAwsWaf(challenge,solution,async()=>!stop||counts.moves<3);return null}catch(e){return e.message}},stop);
try{
  await open();const result=await capture();assert.equal(result.task.type,'points');assert.match(result.task.prompt,/TOP half/);assert.match(await page.evaluate(()=>adapter.previewAwsWaf(challenge,solution)),/137 pixels right/);assert.equal(await page.evaluate(()=>counts.starts+counts.verify),0);
  assert.equal(await apply(),null);assert.equal(await page.evaluate(()=>accepted),true);assert.deepEqual(await page.evaluate(()=>({verify:counts.verify,application:counts.application,prevented:counts.prevented})),{verify:1,application:0,prevented:true});
  checks.push('SDK split-image displacement maps two normalized half centers to handle travel and scoped Confirm');
  for(const mode of ['refresh','instruction']){await open(mode);await capture();assert.match(await apply(),/changed/);assert.equal(await page.evaluate(()=>counts.verify+counts.application),0);assert.ok(Math.abs(await page.evaluate(()=>distance))<.5)}
  await open();await capture();assert.match(await apply(true),/stopped/);assert.equal(await page.evaluate(()=>counts.verify+counts.application),0);assert.ok(Math.abs(await page.evaluate(()=>distance))<.5);
  checks.push('Mid-drag image changes, instruction changes and Stop restore the start position without Confirm');
  for(const mode of ['existing','scaled','reflected']){await open(mode);assert.match(await page.evaluate(async()=>{try{await adapter.captureAwsWaf(adapter.awsWafSnapshot());return ''}catch(e){return e.message}}),/already moved|unsupported/);assert.equal(await page.evaluate(()=>counts.starts+counts.verify),0)}
  checks.push('Existing movement, CSS scaling and reflection stop before interaction');
  for(const mutation of ['uncertain','same-half','edge','overlay','progress','form']){await open();await capture();await page.evaluate(mutation=>{if(mutation==='uncertain')solution.confidence=.5;if(mutation==='same-half')solution.points[1].y=.25;if(mutation==='edge')solution.points[1].x=.001;if(mutation==='progress')handle.style.marginLeft='8px';if(mutation==='form')challenge.form.action='/application';if(mutation==='overlay'){const r=handle.getBoundingClientRect(),cover=document.createElement('div');cover.style.cssText=`position:fixed;left:${r.x}px;top:${r.y}px;width:${r.width}px;height:${r.height}px;background:red;z-index:99`;document.body.append(cover)}},mutation);assert.match(await apply(),/uncertain|invalid|obscured|changed/);assert.equal(await page.evaluate(()=>counts.verify+counts.application),0)}
  checks.push('Ambiguous model points, occluded handles, changed progress and host form controls never verify');
  await open();await capture();await page.evaluate(()=>solution.points=[{x:.25,y:.3},{x:.75,y:.7}]);assert.match(await page.evaluate(()=>adapter.previewAwsWaf(challenge,solution)),/137 pixels right/);
  checks.push('Negative visual displacement wraps to the equivalent rightward slider distance');
  assert.deepEqual(errors,[]);await mkdir('output/playwright/aws-waf',{recursive:true});await writeFile('output/playwright/aws-waf/slide-report.json',JSON.stringify({kind:'SDK-derived split-image fixtures with deterministic model points; no live recognition or AWS acceptance',checks},null,2)+'\n');checks.forEach(check=>console.log('PASS '+check));
}finally{await browser.close();fixture.closeAllConnections();await new Promise(resolve=>fixture.close(resolve))}
