import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { randomUUID } from 'node:crypto';
import { recaptchaV3Native } from '../src/recaptcha-v3.js';

const origin = 'https://recaptcha-demo.appspot.com', path = '/recaptcha-v3-request-scores.php';
const key = '6L_fixture_public_key_for_v3_native_tests';
const browser = await chromium.launch({ channel: 'chromium', headless: true }), page = await browser.newPage();
let verificationCalls = 0, receiptMode = 'success';
const checks = [];
await page.route(origin + '/**', route => {
  const url = new URL(route.request().url());
  if (url.pathname === '/recaptcha-v3-verify.php') {
    verificationCalls++;
    const receipt = { success: true, score: .9, hostname: url.hostname, action: 'examples/v3scores', challenge_ts: new Date().toISOString(), 'error-codes': [] };
    if (receiptMode === 'low-score') { receipt.success = false; receipt.score = .1; receipt['error-codes'] = ['score-threshold-not-met']; }
    if (receiptMode === 'wrong-action') receipt.action = 'unexpected/action';
    if (receiptMode === 'wrong-host') receipt.hostname = 'another.example';
    if (receiptMode === 'expired') receipt.challenge_ts = new Date(Date.now() - 180000).toISOString();
    if (receiptMode === 'missing-score') delete receipt.score;
    if (receiptMode === 'invalid-score') receipt.score = 9;
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(receipt) });
  }
  return route.fulfill({ contentType: 'text/html', body: `<title>Native v3 control fixture</title><script src="https://www.google.com/recaptcha/api.js?render=${key}"></script><form><button type="submit" class="g-recaptcha" data-sitekey="${key}" data-action="application_submit" data-callback="submitApplication">Submit application</button></form><script>window.submissions=0;window.callbacks=0;window.apiCalls=[];window.submitApplication=()=>{callbacks++;document.querySelector('form').submit()};document.querySelector('form').addEventListener('submit',e=>{e.preventDefault();submissions++});HTMLFormElement.prototype.submit=function(){submissions++};</script>` });
});
await page.route('https://www.google.com/recaptcha/api.js**', route => route.fulfill({ contentType: 'text/javascript', body: `window.grecaptcha={ready(callback){if(!window.neverReady)callback()},async execute(key,options){window.apiCalls.push({key,action:options.action});if(window.executeDelay)await new Promise(r=>setTimeout(r,window.executeDelay));return 'fixture_token_for_native_control_test_only'}};` }));
const open = async (route = path) => { verificationCalls = 0; receiptMode = 'success'; await page.goto(origin + route); };
const inspect = () => page.evaluate(recaptchaV3Native, { op: 'inspect' });
const execute = async (expected, extra = {}) => page.evaluate(recaptchaV3Native, { op: 'execute', requestId: randomUUID(), expected, timeoutMs: 1000, ...extra });
try {
  await open();const expected=await inspect();assert.equal(expected.action,'examples/v3scores');assert.equal(expected.verification,'official-demo');
  let result=await execute(expected);assert.equal(result.state,'server-verified');assert.equal(result.receipt.score,.9);assert.equal(verificationCalls,1);assert.ok(!JSON.stringify(result).includes('fixture_token'));
  checks.push('Official demo contract uses the native API and validates a backend receipt without exposing its token');
  await open('/generic');const generic=await inspect();assert.equal(generic.action,'application_submit');assert.equal(generic.callbackPresent,true);result=await execute(generic);assert.equal(result.state,'token-issued');assert.equal(result.serverVerified,false);assert.equal(verificationCalls,0);assert.deepEqual(await page.evaluate(()=>({callbacks,submissions})),{callbacks:0,submissions:0});
  checks.push('Generic declared actions issue a token without invoking callbacks, submitting forms, or claiming server acceptance');
  for(const mode of ['wrong-action','wrong-host','expired','missing-score','invalid-score']){await open();receiptMode=mode;await assert.rejects(execute(await inspect()),/receipt|score/);}
  await open();receiptMode='low-score';result=await execute(await inspect());assert.equal(result.state,'rejected');assert.equal(result.receipt.score,.1);
  checks.push('Mismatched, expired, incomplete and invalid score receipts cannot pass; low scores remain rejected');
  await open();const stale=await inspect();await page.evaluate(()=>history.pushState(null,'','?changed'));await assert.rejects(execute(stale),/changed/);assert.equal(verificationCalls,0);assert.equal(await page.evaluate(()=>apiCalls.length),0);
  await open('/generic');const staleAction=await inspect();await page.evaluate(()=>document.querySelector('button').dataset.action='other');await assert.rejects(execute(staleAction),/changed/);assert.equal(await page.evaluate(()=>apiCalls.length),0);
  checks.push('Navigation and changed actions invalidate an inspected plan before native execution');
  await open('/generic');await page.evaluate(()=>{const b=document.querySelector('button').cloneNode(true);b.dataset.action='second';document.body.append(b)});await assert.rejects(inspect(),/Multiple/);
  await open('/generic');await page.evaluate(()=>document.querySelector('button').removeAttribute('data-action'));await assert.rejects(inspect(),/not explicitly declared/);
  await open('/generic');await page.evaluate(()=>document.querySelector('script[src]').src='https://www.google.com/recaptcha/api.js?render=explicit');await assert.rejects(inspect(),/explicit site key/);
  checks.push('Ambiguous or undeclared actions never get guessed');
  await open();await page.evaluate(()=>window.neverReady=true);await assert.rejects(execute(await inspect(),{timeoutMs:100}),/timed out/);assert.equal(await page.evaluate(()=>apiCalls.length),0);assert.equal(verificationCalls,0);
  await open();const delayedPlan=await inspect(),delayedId=randomUUID();const beforeStart=await page.evaluate(recaptchaV3Native,{op:'cancel',requestId:delayedId});assert.equal(beforeStart.pendingPrevented,true);await assert.rejects(execute(delayedPlan,{requestId:delayedId}),/stopped before execution/);assert.equal(await page.evaluate(()=>apiCalls.length),0);assert.equal(verificationCalls,0);
  await open();await page.evaluate(()=>window.executeDelay=300);const cancelPlan=await inspect(),requestId=randomUUID();const pending=execute(cancelPlan,{requestId});pending.catch(()=>{});await page.waitForFunction(()=>apiCalls.length===1);const stopped=await page.evaluate(recaptchaV3Native,{op:'cancel',requestId});assert.equal(stopped.cancelled,true);await assert.rejects(pending,/stopped/);await page.waitForTimeout(350);assert.equal(verificationCalls,0);
  checks.push('Ready timeout, cancel-before-start and cancellation prevent a late token from reaching a verification endpoint');
  await open();await page.evaluate(()=>window.executeDelay=100);const changedPlan=await inspect(),changing=execute(changedPlan);changing.catch(()=>{});await page.waitForFunction(()=>apiCalls.length===1);await page.evaluate(()=>history.pushState(null,'','?new'));await assert.rejects(changing,/changed/);assert.equal(verificationCalls,0);
  checks.push('Navigation while the SDK is issuing a token prevents backend verification');
  checks.forEach(check=>console.log('PASS '+check));
} finally { await browser.close(); }
