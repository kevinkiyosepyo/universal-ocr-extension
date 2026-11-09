import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { matchPuzzle } from '../server/puzzle.mjs';
import { matchRingRotation } from '../server/ring-rotation.mjs';

// Direct adapter fixtures derived from public SDK markup and event contracts.
// No request reaches TikTok; fixture acceptance is not provider acceptance.
const bundle=await build({entryPoints:['src/tiktok-widget.js'],bundle:true,format:'esm',write:false,target:'chrome116'});
const html=await readFile('tests/fixtures/tiktok.html','utf8');
const fixture=createServer((request,response)=>{const script=request.url==='/tiktok-adapter.js';response.setHeader('Content-Type',script?'text/javascript':'text/html');response.end(script?bundle.outputFiles[0].text:html);});
fixture.listen(0,'127.0.0.1');await once(fixture,'listening');
const browser=await chromium.launch({channel:'chromium',headless:true}),page=await browser.newPage(),checks=[],errors=[];
page.on('pageerror',error=>errors.push(error.message));
const open=async mode=>{await page.goto(`http://127.0.0.1:${fixture.address().port}/?mode=${mode}`);await page.waitForFunction(()=>window.ready);};
const prepare=()=>page.evaluate(async()=>{window.challenge=adapter.tiktokSnapshot();window.capture=await adapter.captureTikTok(challenge,()=>{throw Error('Blob images must not be fetched through the network bridge.');});window.solution={points:[{x:.22,y:.35},{x:.71,y:.6}],confidence:.99};return capture;});
const apply=mode=>page.evaluate(async mode=>{let finalCalls=0;try{await adapter.applyTikTok(challenge,solution,async()=>{if(mode==='tamper-final-ring'&&counts.drags===16&&++finalCalls===2){challenge.image.style.transform='rotate(-80deg)';challenge.reference.style.transform='rotate(80deg)';challenge.handle.style.transform='translateX(126px)';}return mode==='cancel-points'?counts.clicks.length===0:mode==='cancel-drag'?counts.drags<3:true;});return null;}catch(error){return error.message;}},mode);
const decode=async data=>{const{data:rgba,info}=await sharp(Buffer.from(data.split(',')[1],'base64')).ensureAlpha().raw().toBuffer({resolveWithObject:true});return{data:rgba,width:info.width,height:info.height};};
try{
  for(const mode of ['slide']){
    await open(mode);const captured=await prepare();const result=matchPuzzle(await decode(captured.task.image),await decode(captured.task.reference),{y:captured.task.y});assert.ok(result.confidence>.85);await page.evaluate(result=>{solution=result;},result);
    assert.match(await page.evaluate(()=>adapter.previewTikTok(challenge,solution)),/puzzle position ready/);assert.equal(await page.evaluate(()=>counts.ends),0);
    assert.equal(await apply(),null);const counts=await page.evaluate(()=>window.counts);assert.equal(counts.ends,1);assert.equal(counts.submit,0);assert.equal(await page.evaluate(()=>fixtureAccepted),true);assert.equal(await page.evaluate(()=>dragTrusted),false);assert.equal(await page.evaluate(()=>adapter.tiktokVerified()),false);
  }
  checks.push('Local texture solver and SDK HTML drag events move blob-backed puzzle pieces; no form submit or invented acceptance');
  for(const mode of ['whirl','whirl-narrow']){
    await open(mode);const captured=await prepare();assert.equal(captured.task.type,'rotate-ring');const result=matchRingRotation(await decode(captured.task.image),await decode(captured.task.reference),captured.task.radiusRatio);assert.ok(Math.abs(result.clockwiseDegrees-91.5)<.6);await page.evaluate(result=>{solution=result;},result);
    assert.match(await page.evaluate(()=>adapter.previewTikTok(challenge,solution)),/circle alignment ready/);assert.equal(await apply(),null);assert.equal(await page.evaluate(()=>fixtureAccepted),true);assert.equal(await page.evaluate(()=>counts.ends),1);assert.equal(await page.evaluate(()=>counts.submit),0);assert.equal(await page.evaluate(()=>adapter.tiktokVerified()),false);
  }
  checks.push('Real boundary matcher drives SDK opposing rotations at both inspected circle sizes while preserving raw image fingerprints');
  for(const [mode,stop,pattern] of [['whirl-refresh',undefined,/changed/],['whirl','cancel-drag',/stopped/]]){await open(mode);await prepare();await page.evaluate(()=>{solution={clockwiseDegrees:91.5,confidence:.99};});assert.match(await apply(stop),pattern);assert.equal(await page.evaluate(()=>counts.ends),0);}
  checks.push('Ring image refresh or Stop during rotation prevents dragend verification');
  await open('whirl-flat');const flat=await prepare(),flatOuter=await decode(flat.task.image),flatInner=await decode(flat.task.reference);assert.throws(()=>matchRingRotation(flatOuter,flatInner,flat.task.radiusRatio),error=>error.code==='UNCERTAIN_IMAGE');assert.equal(await page.evaluate(()=>counts.drags),0);
  await open('whirl');await prepare();await page.evaluate(()=>{solution={clockwiseDegrees:91.5,confidence:.99};});assert.match(await apply('tamper-final-ring'),/movement changed/);assert.equal(await page.evaluate(()=>counts.ends),0);
  checks.push('Ambiguous ring pixels abstain and a final guarded movement change cannot release verification');
  for(const [mode,stop,pattern] of [['slide-refresh',undefined,/changed/],['slide','cancel-drag',/stopped/]]){
    await open(mode);await prepare();await page.evaluate(()=>{solution={normalizedX:160/348,confidence:.99};});assert.match(await apply(stop),pattern);assert.equal(await page.evaluate(()=>counts.ends),0);assert.equal(await page.evaluate(()=>counts.submit),0);
  }
  checks.push('Refresh or Stop during a drag never emits the SDK dragend verification event');
  for(const mode of ['points']){
    await open(mode);await prepare();assert.match(await page.evaluate(()=>adapter.previewTikTok(challenge,solution)),/same-shape pair/);assert.equal(await page.evaluate(()=>counts.clicks.length),0);
    assert.equal(await apply(),null);const counts=await page.evaluate(()=>window.counts);assert.equal(counts.clicks.length,2);assert.equal(counts.verify,1);assert.equal(counts.submit,0);assert.ok(Math.abs(counts.clicks[0].x-.22)<.01);assert.ok(Math.abs(counts.clicks[1].y-.6)<.01);
  }
  checks.push('Exact same-shape instruction supports two normalized image clicks and its scoped Confirm button');
  for(const mode of ['slide-scaled','points-scaled','whirl-scaled']){await open(mode);assert.match(await page.evaluate(async()=>{try{await adapter.captureTikTok(adapter.tiktokSnapshot());return '';}catch(error){return error.message;}}),/Scaled/);assert.equal(await page.evaluate(()=>counts.drags+counts.clicks.length+counts.submit),0);}
  await open('slide');await page.evaluate(()=>document.querySelector('#piece').style.transform='translateX(50px)');assert.match(await page.evaluate(async()=>{try{await adapter.captureTikTok(adapter.tiktokSnapshot());return '';}catch(error){return error.message;}}),/already moved/);
  checks.push('CSS-scaled layouts and existing puzzle movement stop before capture or input because the SDK uses layout coordinates');
  for(const [mode,stop,pattern] of [['points-refresh',undefined,/changed/],['points-prompt',undefined,/changed/],['points','cancel-points',/stopped/]]){
    await open(mode);await prepare();assert.match(await apply(stop),pattern);assert.equal(await page.evaluate(()=>counts.clicks.length),1);assert.equal(await page.evaluate(()=>counts.verify),0);
  }
  checks.push('Image refresh, instruction change, and Stop after one click prevent remaining input and Confirm');
  for(const mode of ['wrong-count','uncertain','duplicate','out-of-bounds']){
    await open('points');await prepare();await page.evaluate(mode=>{if(mode==='wrong-count')solution.points.pop();if(mode==='uncertain')solution.confidence=.3;if(mode==='duplicate')solution.points[1]=solution.points[0];if(mode==='out-of-bounds')solution.points[0].x=2;},mode);assert.ok(await apply());assert.equal(await page.evaluate(()=>counts.clicks.length),0);assert.equal(await page.evaluate(()=>counts.verify),0);
  }
  checks.push('Wrong point count, uncertainty, duplicates and invalid coordinates stop before input');
  for(const change of ['refresh','layout','detached','instruction','existing-selection','submit-control']){
    await open('points');await prepare();await page.evaluate(async change=>{if(change==='refresh')await refresh();if(change==='layout')challenge.image.style.width='300px';if(change==='detached')challenge.image.replaceWith(challenge.image.cloneNode());if(change==='instruction')challenge.root.querySelector('p').textContent='Select 2 objects that are different shapes';if(change==='existing-selection'){const mark=document.createElement('div');mark.className='cap-absolute cap-cursor-pointer mark';challenge.root.append(mark);}if(change==='submit-control')challenge.verify.type='submit';},change);
    assert.ok(await apply());assert.equal(await page.evaluate(()=>counts.verify),0);assert.equal(await page.evaluate(()=>counts.submit),0);if(change!=='submit-control')assert.equal(await page.evaluate(()=>counts.clicks.length),0);
  }
  checks.push('Changed captures, moved/replaced controls, existing selections and application Submit controls cannot produce verification');
  await open('points');await prepare();
  const moved=await page.evaluate(async()=>{const before=await adapter.captureTikTok(challenge);challenge.root.style.marginLeft='10px';const after=await adapter.captureTikTok(challenge);return{samePixels:before.task.image===after.task.image,different:before.fingerprint!==after.fingerprint};});assert.deepEqual(moved,{samePixels:true,different:true});
  checks.push('Geometry changes invalidate recognition fingerprints even when image pixels do not change');
  for(const afterFirst of [false,true]){
    await open('points');await prepare();await page.evaluate(afterFirst=>{const cover=()=>{const rect=challenge.image.getBoundingClientRect(),point=solution.points[afterFirst?1:0],overlay=document.createElement('div');overlay.style.cssText=`position:fixed;left:${rect.x+point.x*rect.width-10}px;top:${rect.y+point.y*rect.height-10}px;width:20px;height:20px;background:red;z-index:10000`;document.body.append(overlay);};if(afterFirst)challenge.image.addEventListener('click',cover,{once:true});else cover();},afterFirst);
    assert.match(await apply(),/obscured/);assert.equal(await page.evaluate(()=>counts.clicks.length),afterFirst?1:0);assert.equal(await page.evaluate(()=>counts.verify),0);
  }
  checks.push('Point hit-testing stops clicks on overlays before or during selection');
  for(const change of ['moved','nonconcentric','size']){await open('whirl');await page.evaluate(change=>{const[outer,inner]=document.querySelectorAll('#rings img');if(change==='moved'){outer.style.transform='rotate(-20deg)';inner.style.transform='rotate(20deg)';}if(change==='nonconcentric')inner.style.marginLeft='10px';if(change==='size'){inner.style.width='140px';inner.style.height='140px';}},change);assert.match(await page.evaluate(async()=>{try{await adapter.captureTikTok(adapter.tiktokSnapshot());return '';}catch(error){return error.message;}}),/already moved|geometry is unsupported/);assert.equal(await page.evaluate(()=>counts.drags),0);}
  await open('points');await page.evaluate(()=>document.querySelector('p').textContent='Tap the objects in the order that they appear');assert.match(await page.evaluate(()=>{try{adapter.tiktokSnapshot();return '';}catch(error){return error.message;}}),/unsupported/);
  checks.push('Moved or custom ring geometry and unimplemented object-selection instructions fail explicitly');
  await open('points');await prepare();await page.evaluate(()=>showError());assert.match(await apply(),/rejected/);assert.equal(await page.evaluate(()=>counts.clicks.length),0);assert.match(await page.evaluate(()=>adapter.tiktokFailure()),/rejected/);
  await page.evaluate(()=>challenge.root.remove());assert.equal(await page.evaluate(()=>adapter.tiktokVerified()),false);assert.equal(await page.evaluate(()=>adapter.tiktokSnapshot()),null);
  checks.push('Exact provider error text stops input; disappearance is not a success receipt');
  await open('points');await page.evaluate(()=>showSuccess());assert.equal(await page.evaluate(()=>adapter.tiktokVerified()),true);
  await page.evaluate(()=>document.querySelector('svg path').setAttribute('d','M0 0h48v48H0z'));assert.equal(await page.evaluate(()=>adapter.tiktokVerified()),false);
  await page.evaluate(()=>{showSuccess();document.querySelector('svg').style.display='none';});assert.equal(await page.evaluate(()=>adapter.tiktokVerified()),false);
  await page.evaluate(()=>{showSuccess();document.body.append(document.querySelector('svg'));});assert.equal(await page.evaluate(()=>adapter.tiktokVerified()),false);
  checks.push('Only the visible exact SDK pass-icon vector inside the provider root is an acceptance marker');
  assert.deepEqual(errors,[]);
  await mkdir('output/playwright/tiktok',{recursive:true});await writeFile('output/playwright/tiktok/report.json',JSON.stringify({kind:'SDK-derived direct adapter browser fixtures; no live TikTok acceptance',checks},null,2)+'\n');
  checks.forEach(check=>console.log('PASS '+check));
}finally{await browser.close();fixture.closeAllConnections();await new Promise(resolve=>fixture.close(resolve));}
