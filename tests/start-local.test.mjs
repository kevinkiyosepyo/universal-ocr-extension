import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

const readyHealth = () => ({ status: 'ok', vision: { model: 'test-vision', available: true }, text: { model: 'test-text', available: true } });

async function withLauncher({ health = readyHealth(), textModel = 'test-text' } = {}, assertion) {
  const paths = [];
  const key = 'startup-regression-test-key';
  const server = createServer((request, response) => {
    paths.push(request.url);
    response.setHeader('Content-Type', 'application/json');
    if (request.url === '/api/version') response.end(JSON.stringify({ version: 'test' }));
    else if (request.url === '/api/tags') response.end(JSON.stringify({ models: [{ name: 'test-vision' }, { name: 'test-text' }] }));
    else if (request.url === '/health') response.end(JSON.stringify(health));
    else if (request.url === '/api/chat') response.end(JSON.stringify({ message: { content: JSON.stringify({ text: 'READY', confidence: .9 }) } }));
    else { response.statusCode = 404; response.end('{}'); }
    request.resume();
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const root = fileURLToPath(new URL('../', import.meta.url));
  const child = spawn(process.execPath, ['scripts/start-local.mjs'], {
    cwd: root,
    env: { ...process.env, OCR_API_KEY: key, OCR_PORT: String(server.address().port), OCR_OLLAMA_ENDPOINT: `http://127.0.0.1:${server.address().port}`, OCR_VISION_MODEL: 'test-vision', OCR_TEXT_MODEL: textModel },
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 10_000, killSignal: 'SIGKILL',
  });
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
  try {
    const [code] = await once(child, 'exit');
    assert.ok(paths.includes('/health'));
    assert.equal(paths.filter(path => path === '/api/chat').length, 0, 'A repeat start must not evict the active model with redundant warmup calls.');
    assert.equal(paths.filter(path => path === '/api/pull').length, 0);
    assert.ok(!stdout.includes(key) && !stderr.includes(key));
    // The existing service belongs to another owner and must remain available.
    assert.equal((await fetch(`http://127.0.0.1:${server.address().port}/health`)).status, 200);
    await assertion({ code, stdout, stderr, paths });
  } finally {
    if (child.exitCode === null) child.kill('SIGKILL');
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  }
}

test('starting already healthy services does not reload either recognition model', { timeout: 15_000 }, () => withLauncher({}, ({ code, stdout, stderr }) => {
  assert.equal(code, 0, stderr);
  assert.match(stdout, /services are already running/);
}));

for (const kind of ['vision', 'text']) {
  test(`an existing companion using a different ${kind} model is not silently reused`, { timeout: 15_000 }, () => {
    const health = readyHealth(); health[kind].model = 'other-model';
    return withLauncher({ health }, ({ code, stdout, stderr }) => {
      assert.equal(code, 1);
      assert.match(stderr, /existing companion uses/);
      assert.match(stderr, /other-model/);
      assert.match(stderr, /No replacement service was started/);
      assert.doesNotMatch(stdout, /Ready:|Warming/);
      assert.doesNotMatch(stderr, /EADDRINUSE/);
    });
  });
  test(`an existing companion with unavailable ${kind} fails without starting a replacement`, { timeout: 15_000 }, () => {
    const health = readyHealth(); health[kind].available = false;
    return withLauncher({ health }, ({ code, stdout, stderr }) => {
      assert.equal(code, 1);
      assert.match(stderr, new RegExp(`${kind} model is unavailable`));
      assert.match(stderr, /No replacement service was started/);
      assert.doesNotMatch(stdout, /Ready:|Warming/);
      assert.doesNotMatch(stderr, /EADDRINUSE/);
    });
  });
}

test('a disabled dedicated text model correctly reuses the vision-model fallback', { timeout: 15_000 }, () => {
  const health = readyHealth(); health.text.model = 'test-vision';
  return withLauncher({ health, textModel: '' }, ({ code, stdout, stderr }) => {
    assert.equal(code, 0, stderr);
    assert.match(stdout, /services are already running/);
  });
});
