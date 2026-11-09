import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

test('starting already healthy services does not reload either recognition model', { timeout: 15_000 }, async () => {
  const paths = [];
  const key = 'startup-regression-test-key';
  const server = createServer((request, response) => {
    paths.push(request.url);
    response.setHeader('Content-Type', 'application/json');
    if (request.url === '/api/version') response.end(JSON.stringify({ version: 'test' }));
    else if (request.url === '/api/tags') response.end(JSON.stringify({ models: [{ name: 'test-vision' }, { name: 'test-text' }] }));
    else if (request.url === '/health') response.end(JSON.stringify({ status: 'ok' }));
    else if (request.url === '/api/chat') response.end(JSON.stringify({ message: { content: JSON.stringify({ text: 'READY', confidence: .9 }) } }));
    else { response.statusCode = 404; response.end('{}'); }
    request.resume();
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const root = fileURLToPath(new URL('../', import.meta.url));
  const child = spawn(process.execPath, ['scripts/start-local.mjs'], {
    cwd: root,
    env: { ...process.env, OCR_API_KEY: key, OCR_PORT: String(server.address().port), OCR_OLLAMA_ENDPOINT: `http://127.0.0.1:${server.address().port}`, OCR_VISION_MODEL: 'test-vision', OCR_TEXT_MODEL: 'test-text' },
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 10_000, killSignal: 'SIGKILL',
  });
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
  try {
    const [code] = await once(child, 'exit');
    assert.equal(code, 0, stderr);
    assert.match(stdout, /services are already running/);
    assert.ok(paths.includes('/health'));
    assert.equal(paths.filter(path => path === '/api/chat').length, 0, 'A repeat start must not evict the active model with redundant warmup calls.');
    assert.ok(!stdout.includes(key) && !stderr.includes(key));
  } finally {
    if (child.exitCode === null) child.kill('SIGKILL');
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  }
});
