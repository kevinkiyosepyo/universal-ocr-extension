import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
const types = { html: 'text/html', css: 'text/css', js: 'text/javascript' };
const server = createServer(async (request, response) => {
  const path = new URL(request.url, 'http://localhost').pathname;
  const name = path === '/' ? 'demo.html' : path.slice(1);
  if (!['demo.html', 'demo.js', 'demo.css'].includes(name)) { response.writeHead(404); response.end(); return; }
  response.setHeader('Content-Type', `${types[name.split('.').pop()]}; charset=utf-8`);
  response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'");
  response.end(await readFile(new URL(`../tests/fixtures/${name}`, import.meta.url)));
});
server.listen(Number(process.env.OCR_DEMO_PORT || 4173), '127.0.0.1', () => console.log(`OCR test page: http://127.0.0.1:${server.address().port}`));
