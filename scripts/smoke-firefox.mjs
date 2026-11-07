import { firefox } from 'playwright';
import { mkdtemp, mkdir, readFile, writeFile, rm, cp } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import sharp from 'sharp';
import { connectWithMaxRetries, findFreeTcpPort } from '../node_modules/web-ext/lib/firefox/remote.js';
const output = resolve('output/firefox'); await mkdir(output, { recursive: true });
const temp = await mkdtemp(join(output, 'test-')); const extension = join(temp, 'extension'); await cp('dist-firefox', extension, { recursive: true });
const image = (await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="160"><rect width="600" height="160" fill="white"/><text x="30" y="110" font-family="Arial" font-size="64">FIREFOX 5729</text></svg>')).png().toBuffer()).toString('base64');
let resolveReport, rejectReport; const done = new Promise((resolve, reject) => { resolveReport = resolve; rejectReport = reject; });
const checks = [];
const fixture = createServer(async (request, response) => {
  if (request.url === '/report' && request.method === 'POST') {
    let body = ''; for await (const part of request) body += part;
    const result = JSON.parse(body); response.end('ok');
    if (result.error) rejectReport(new Error(result.error));
    else { checks.push(result.check); if (checks.length === 2) resolveReport(); }
  } else { response.writeHead(404); response.end(); }
});
fixture.listen(0, '127.0.0.1'); await once(fixture, 'listening'); const reportURL = `http://127.0.0.1:${fixture.address().port}/report`;
// Playwright's Firefox transport cannot instrument extension process tabs.
// A test-only module exercises their real DOM and sends fixture results to loopback.
await writeFile(join(extension, 'smoke-bootstrap.js'), `browser.tabs.create({url:browser.runtime.getURL('workspace.html')});`);
const manifest = JSON.parse(await readFile(join(extension, 'manifest.json'), 'utf8')); manifest.background.scripts.push('smoke-bootstrap.js'); manifest.host_permissions = ['http://127.0.0.1/*'];
await writeFile(join(extension, 'manifest.json'), JSON.stringify(manifest));
for (const name of ['workspace', 'control']) {
  const path = join(extension, `${name}.html`); await writeFile(path, (await readFile(path, 'utf8')).replace('</body>', '<script type="module" src="smoke-ui.js"></script></body>'));
}
await writeFile(join(extension, 'smoke-ui.js'), `
const report = (body) => fetch(${JSON.stringify(reportURL)}, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
const wait = async (predicate) => { const start=Date.now(); while(!predicate()){if(Date.now()-start>25000)throw Error('DOM check timed out: '+document.querySelector('#notice,#status')?.textContent); await new Promise(r=>setTimeout(r,100));} };
try {
  const isText=location.pathname.includes('workspace');
  await wait(()=>isText?!document.querySelector('#choose').disabled:document.querySelector('#task-type'));
  const file = new File([Uint8Array.from(atob(${JSON.stringify(image)}),c=>c.charCodeAt(0))],'sample.png',{type:'image/png'});
  const transfer=new DataTransfer();transfer.items.add(file);
  const input=document.querySelector(isText?'#file':'#task-image');input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));
  if(!isText){await wait(()=>document.querySelector('#task-preview').getAttribute('src'));document.querySelector('#analyze').click();}
  await wait(()=>document.querySelector(isText?'#result':'#solution').value.trim()==='FIREFOX 5729');
  await report({check:isText?'Real bundled OCR in Firefox workspace':'Real background-page OCR from visual workbench'});
  if(isText) await browser.tabs.create({url:browser.runtime.getURL('control.html')});
} catch(error){await report({error:error.message});}
`);
const port = await findFreeTcpPort(); let context, remote;
const timeout = setTimeout(() => rejectReport(new Error('Firefox smoke exceeded 60 seconds.')), 60000);
// Install only into a new temporary Firefox profile using its loopback devtools API.
try {
  context = await firefox.launchPersistentContext(join(temp, 'profile'), { headless: true, args: ['-start-debugger-server', String(port)], firefoxUserPrefs: { 'devtools.debugger.remote-enabled': true, 'devtools.chrome.enabled': true, 'devtools.debugger.prompt-connection': false, 'devtools.debugger.force-local': true } });
  remote = await connectWithMaxRetries({ port, maxRetries: 50 }); await remote.installTemporaryAddon(extension, false);
  await done; await writeFile(join(output, 'report.json'), JSON.stringify({ browser: context.browser()?.version() || 'Firefox', checks }, null, 2) + '\n'); checks.forEach(check => console.log('PASS ' + check));
} finally { clearTimeout(timeout); remote?.disconnect(); await context?.close(); fixture.closeAllConnections(); await new Promise(resolve => fixture.close(resolve)); await rm(temp, { recursive: true, force: true }); }
