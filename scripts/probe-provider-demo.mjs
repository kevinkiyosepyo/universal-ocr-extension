import { chromium } from 'playwright';
import { cp, mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
const out=resolve('output/live-demo');await mkdir(out,{recursive:true});
const temp=await mkdtemp(join(tmpdir(),'ocr-provider-demo-')),extension=join(temp,'extension');await cp(resolve('dist'),extension,{recursive:true});
const manifest=JSON.parse(await readFile(join(extension,'manifest.json'),'utf8'));manifest.permissions.push('webNavigation');manifest.host_permissions=['https://*/*','http://127.0.0.1/*'];await writeFile(join(extension,'manifest.json'),JSON.stringify(manifest));
const context=await chromium.launchPersistentContext(join(temp,'profile'),{channel:'chromium',headless:false,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`],viewport:{width:1200,height:1000}});
const report={kind:'official-public-demo',url:'https://www.google.com/recaptcha/api2/demo',startedAt:new Date().toISOString(),applicationSubmitted:false};
try {
 const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');const id=new URL(worker.url()).host;
 const ui=await context.newPage();await ui.goto(`chrome-extension://${id}/control.html`);
 const key=(await readFile('.local/api-key','utf8')).trim();await ui.evaluate(({key})=>chrome.runtime.sendMessage({type:'SAVE_SERVICE',endpoint:'http://127.0.0.1:47821',key}),{key});
 const target=await context.newPage();await target.goto(report.url,{waitUntil:'domcontentloaded'});await target.evaluate(()=>document.title='Universal OCR — public CAPTCHA test');
 await target.locator('iframe[title="reCAPTCHA"]').waitFor({timeout:30000});
 const anchor=target.frameLocator('iframe[title="reCAPTCHA"]');await anchor.locator('#recaptcha-anchor').waitFor({timeout:30000});
 report.initialWidgetText=await anchor.locator('body').innerText();await target.screenshot({path:join(out,'before.png')});
 await anchor.locator('#recaptcha-anchor').click();
 for(let i=0;i<50;i++){if(await anchor.locator('#recaptcha-anchor').getAttribute('aria-checked')==='true')break;const frame=target.frames().find(frame=>frame.url().includes('/bframe'));if(frame&&await frame.locator('.rc-imageselect-target').isVisible().catch(()=>false))break;await new Promise(resolve=>setTimeout(resolve,200));}
 const challenge=target.frames().find(frame=>frame.url().includes('/bframe'));
 report.challengeText=challenge?await challenge.locator('body').innerText():'';
 await target.screenshot({path:join(out,'challenge.png')});
 if(challenge&&await challenge.locator('.rc-imageselect-target').isVisible().catch(()=>false)){
  const tabId=await worker.evaluate(async url=>(await chrome.tabs.query({})).find(tab=>tab.url===url).id,target.url());
  const started=await ui.evaluate(({tabId,sourceURL})=>chrome.runtime.sendMessage({type:'CHALLENGE_START',tabId,sourceURL,autoVerify:true}),{tabId,sourceURL:target.url()});report.start=started;
  if(started.ok){for(let i=0;i<320;i++){const state=await ui.evaluate(tabId=>chrome.runtime.sendMessage({type:'CHALLENGE_GET',tabId}),tabId);report.outcome=state.value;if(!state.value.active)break;await new Promise(resolve=>setTimeout(resolve,500));}}
 if(report.outcome?.active){await ui.evaluate(tabId=>chrome.runtime.sendMessage({type:'CHALLENGE_STOP',tabId}),tabId);report.outcome={...report.outcome,active:false,state:'test-time-limit',detail:'The public-demo test reached its time limit.'};}
 }else report.outcome={state:await anchor.locator('#recaptcha-anchor').getAttribute('aria-checked')==='true'?'checkbox-only':'no-supported-grid',detail:report.challengeText};
 report.frames=await Promise.all(target.frames().map(async frame=>({url:frame.url(),dom:await frame.locator('body').evaluate(body=>({text:body.innerText,tiles:[...body.querySelectorAll('.rc-imageselect-tile')].map(el=>({tag:el.tagName,cls:el.className,rect:el.getBoundingClientRect().toJSON(),html:el.outerHTML.slice(0,500)}))})).catch(()=>null)})));await target.screenshot({path:join(out,'after.png')});report.activity=(await worker.evaluate(()=>chrome.storage.local.get('activity'))).activity;
} catch(error){report.error=error.message;}
finally{await writeFile(join(out,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({...report,frames:undefined},null,2));await new Promise(resolve=>setTimeout(resolve,12000));await context.close();await rm(temp,{recursive:true,force:true});}
