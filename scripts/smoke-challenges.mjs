import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { mkdtemp, cp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { createSolverServer } from '../server/app.mjs';
const output=resolve('output/challenges');await mkdir(output,{recursive:true});
const temp=await mkdtemp(join(tmpdir(),'ocr-challenges-')), extension=join(temp,'extension');await cp(resolve('dist'),extension,{recursive:true});
const manifest=JSON.parse(await readFile(join(extension,'manifest.json'),'utf8'));manifest.permissions.push('webNavigation');manifest.host_permissions=['http://127.0.0.1/*','https://*/*'];await writeFile(join(extension,'manifest.json'),JSON.stringify(manifest));
const fixtureHTML=await readFile('tests/fixtures/challenge.html','utf8');
const fixture=createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end('<title>Saved application fixture</title><iframe width="500" height="600" src="https://www.google.com/recaptcha/fixture'+(req.url.includes('?')?req.url.slice(req.url.indexOf('?')):'')+'"></iframe>');});fixture.listen(0,'127.0.0.1');await once(fixture,'listening');const origin=`http://127.0.0.1:${fixture.address().port}`;
let delay=0, modelCalls=0;
const vision=createServer(async(req,res)=>{
 res.setHeader('Content-Type','application/json');if(req.url==='/api/tags'){res.end(JSON.stringify({models:[{name:'fixture-model'}]}));return}
 let body='';for await(const chunk of req)body+=chunk;const value=JSON.parse(body);modelCalls++; const dimensions=value.messages.at(-1).content.match(/(\d+)-row by (\d+)-column/);const rows=+dimensions[1],columns=+dimensions[2];
 const {data,info}=await sharp(Buffer.from(value.messages.at(-1).images[0],'base64')).removeAlpha().raw().toBuffer({resolveWithObject:true});const selected=[];
 for(let i=0;i<rows*columns;i++){const x=Math.floor((i%columns+.5)*info.width/columns),y=Math.floor((Math.floor(i/columns)+.5)*info.height/rows);const offset=(y*info.width+x)*info.channels;if(data[offset]>150&&data[offset+1]<80)selected.push(i)}
 if(delay)await new Promise(resolve=>setTimeout(resolve,delay));res.end(JSON.stringify({message:{content:JSON.stringify({selected,confidence:99})}}));
});vision.listen(0,'127.0.0.1');await once(vision,'listening');
const key=randomBytes(32).toString('hex'),{server,queue}=createSolverServer({key,model:'fixture-model',ollamaEndpoint:`http://127.0.0.1:${vision.address().port}`,cache:true});server.listen(0,'127.0.0.1');await once(server,'listening');const endpoint=`http://127.0.0.1:${server.address().port}`;
const context=await chromium.launchPersistentContext(join(temp,'profile'),{channel:'chromium',headless:true,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`],viewport:{width:1200,height:950}});
const report=[], errors=[];
context.on('page',page=>page.on('pageerror',error=>errors.push(error.message)));
await context.route('https://www.google.com/recaptcha/fixture*',route=>route.fulfill({contentType:'text/html',body:fixtureHTML}));
try{
 let worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');const id=new URL(worker.url()).host;const ui=await context.newPage();await ui.goto(`chrome-extension://${id}/control.html`);
 const send=(type,data={})=>ui.evaluate(async payload=>{const r=await chrome.runtime.sendMessage(payload);if(!r.ok)throw new Error(r.error);return r.value},{type,...data});
 await send('SAVE_SERVICE',{endpoint,key});
 const target=await context.newPage();let tabId,frame;
 const open=async(mode)=>{await target.goto(origin+'/?mode='+mode);frame=target.frames().find(item=>item.url().includes('/recaptcha/fixture'));await frame.waitForFunction(()=>window.counts);await target.bringToFront();tabId=await worker.evaluate(async url=>(await chrome.tabs.query({})).find(tab=>tab.url===url).id,target.url());};
 const start=async(autoVerify=true)=>send('CHALLENGE_START',{tabId,sourceURL:target.url(),autoVerify});
 const waitState=async(expected)=>{let result;for(let i=0;i<160;i++){result=await send('CHALLENGE_GET',{tabId});if(expected.includes(result?.state))return result;if(result?.state==='failed')throw new Error(result.detail);await new Promise(resolve=>setTimeout(resolve,100));}throw new Error('State timeout: '+JSON.stringify(result));};
 await open('static');await start();await waitState(['widget-verified']);assert.deepEqual(await frame.evaluate(()=>counts),{clicks:[1,5,6],verify:1,submit:0});report.push('One-click cross-origin frame injection, image capture, signed recognition, selection, and widget completion');
 await open('scene');await start();await waitState(['widget-verified']);assert.deepEqual(await frame.evaluate(()=>counts.clicks),[0,4]);report.push('Continuous 4×4 image is cropped into the correct squares');
 await open('dynamic');await start();await waitState(['widget-verified']);assert.deepEqual(await frame.evaluate(()=>counts),{clicks:[1,5,6],verify:1,submit:0});report.push('Dynamic replacement tiles are reread; Verify occurs only after no matching images remain');
 await open('multi');await start();await waitState(['widget-verified']);assert.deepEqual(await frame.evaluate(()=>counts),{clicks:[1,5,6,2],verify:2,submit:0});report.push('Multi-round challenge continues after a new image set');
 await open('transition');await start();await waitState(['widget-verified']);assert.deepEqual(await frame.evaluate(()=>counts),{clicks:[1,5,6,2],verify:2,submit:0});report.push('Sliding old/new tables settle before the next round is analyzed');
 await open('hcaptcha');await start();await waitState(['widget-verified']);assert.deepEqual(await frame.evaluate(()=>counts),{clicks:[1,5,6],verify:1,submit:0});report.push('hCaptcha grid background images and selected-state tracking');
 await open('static');await start(false);await waitState(['review']);assert.equal(await frame.evaluate(()=>counts.verify),0);await frame.locator('#recaptcha-verify-button').click();await waitState(['widget-verified']);report.push('Review mode waits for manual Verify');
 await open('guard');await start();const denied=await waitState(['failed']);assert.match(denied.detail,/submission controls/);assert.equal(await frame.evaluate(()=>counts.submit),0);report.push('Form Submit control cannot be used as challenge verification');
 queue.cache.clear();delay=1800;await open('static');await start();await waitState(['recognizing']);await send('CHALLENGE_STOP',{tabId});await new Promise(resolve=>setTimeout(resolve,2200));assert.deepEqual(await frame.evaluate(()=>counts.clicks),[]);report.push('Stop cancels recognition and prevents late clicks');
 queue.cache.clear();await open('static');await start();await waitState(['recognizing']);await target.reload();await new Promise(resolve=>setTimeout(resolve,2200));const stopped=await send('CHALLENGE_GET',{tabId});assert.equal(stopped.active,false);frame=target.frames().find(item=>item.url().includes('/recaptcha/fixture'));assert.deepEqual(await frame.evaluate(()=>counts.clicks),[]);report.push('Navigation cancels the session and preserves the new document');
 delay=0;await open('static');await assert.rejects(send('CHALLENGE_START',{tabId,sourceURL:origin+'/different',autoVerify:true}),/page changed/);await start(false);await worker.evaluate(async tabId=>{const key='challenge-session:'+tabId;const value=(await chrome.storage.session.get(key))[key];value.expiresAt=Date.now()-1;await chrome.storage.session.set({[key]:value})},tabId);const expired=await send('CHALLENGE_GET',{tabId});assert.equal(expired.active,false);assert.equal(expired.state,'expired');assert.deepEqual(await frame.evaluate(()=>counts.clicks),[]);report.push('Stale start URLs are rejected and expired sessions display inactive');
 assert.ok(queue.metrics.cacheHits>0);report.push('Identical images reuse bounded recognition cache');
 assert.deepEqual(errors,[]);await target.screenshot({path:join(output,'workflow.png')});await writeFile(join(output,'report.json'),JSON.stringify({checks:report,modelCalls,cacheHits:queue.metrics.cacheHits},null,2)+'\n');report.forEach(item=>console.log('PASS '+item));
}catch(error){console.error(report);await writeFile(join(output,'failure.txt'),String(error));for(const page of context.pages())if(page.url().startsWith(origin)){await page.screenshot({path:join(output,'failure.png')});console.error(await page.locator('body').innerText());}throw error}
finally{await context.close();for(const service of[fixture,vision,server]){service.closeAllConnections();await new Promise(resolve=>service.close(resolve));}await rm(temp,{recursive:true,force:true});}
