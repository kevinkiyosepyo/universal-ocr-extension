import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

// Real DOM fixtures derived from observed provider URLs. No remote content loads.
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const source = await readFile('src/providers.js', 'utf8');
  const attach = async () => {
    await page.addScriptTag({ type: 'module', content: `${source}\nwindow.scanProviders = () => scanProviders(document, PROVIDERS);` });
    await page.waitForFunction(() => window.scanProviders);
  };
  await page.route('**/*', route => route.abort());
  await page.goto('about:blank');
  await attach();
  const scan = async html => {
    await page.evaluate(value => { document.body.innerHTML = value; }, html);
    return page.evaluate(() => scanProviders().map(item => item.id));
  };
  assert.deepEqual(await scan('<div class="g-recaptcha" data-action="apply"></div><iframe src="https://recaptcha.net/recaptcha/enterprise/anchor?size=invisible&k=fixture"></iframe>'), ['recaptcha-enterprise']);
  console.log('PASS Enterprise invisible job-form frame is not labeled standard v2 or v3');
  assert.deepEqual(await scan('<script src="https://www.google.com/recaptcha/enterprise.js?render=fixture"></script><div class="g-recaptcha" data-action="apply"></div>'), ['recaptcha-enterprise']);
  console.log('PASS Enterprise script and shared action markup do not enable standard native v3');
  assert.deepEqual(await scan('<iframe src="https://www.google.com/recaptcha/api2/anchor?size=normal"></iframe><script src="https://www.google.com/recaptcha/api.js?render=explicit"></script>'), ['recaptcha-v2']);
  assert.deepEqual(await scan('<script src="https://www.google.com/recaptcha/api.js?render=fixture"></script>'), ['recaptcha-v3']);
  console.log('PASS Standard checkbox and explicit score APIs retain their identities');
  assert.deepEqual(await scan('<iframe src="https://www.google.com/recaptcha/api2/anchor"></iframe><iframe src="https://recaptcha.net/recaptcha/enterprise/anchor?size=invisible"></iframe><div class="h-captcha"></div>'), ['recaptcha-v2', 'recaptcha-enterprise', 'hcaptcha']);
  console.log('PASS Mixed-provider pages retain independent standard and Enterprise widgets');
  assert.deepEqual(await scan('<script src="https://www.google.com.evil.test/recaptcha/enterprise.js"></script><script src="http://www.google.com/recaptcha/enterprise.js"></script>'), []);
  assert.deepEqual(await scan('<iframe src="https://www.google.com.evil.test/recaptcha/enterprise/anchor"></iframe><iframe src="http://www.google.com/recaptcha/enterprise/anchor"></iframe>'), []);
  console.log('PASS Lookalike and insecure scripts or frames cannot identify Enterprise or standard v2');
  assert.deepEqual(await scan('<script src="https://www.google.com/recaptcha/api.js?render=fixture"></script><iframe src="https://recaptcha.net/recaptcha/enterprise/anchor"></iframe>'), ['recaptcha-enterprise', 'recaptcha-v3']);
  console.log('PASS Independently declared standard score API survives a mixed Enterprise host page');

  for (const kind of ['anchor', 'bframe']) {
    const url = `https://recaptcha.net/recaptcha/enterprise/${kind}?fixture=1`;
    await page.route(url, route => route.fulfill({ contentType: 'text/html', body: '<div class="rc-imageselect">Enterprise challenge</div><div class="g-recaptcha" data-action="apply"></div>' }));
    await page.goto(url); await attach();
    assert.deepEqual(await page.evaluate(() => scanProviders().map(item => item.id)), ['recaptcha-enterprise']);
  }
  console.log('PASS Enterprise frame-local markup is classified using its own document URL');
} finally { await browser.close(); }
