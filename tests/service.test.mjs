import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import sharp from 'sharp';
import { createSolverServer } from '../server/app.mjs';
import { SolverClient } from '../shared/client.js';
import { signedHeaders, validateTask, validateSolution, endpointURL } from '../shared/protocol.js';
import { validateRule, matchOrigin } from '../src/providers.js';
const key = randomBytes(32).toString('hex');
async function service(fn, config = {}) { const { server, queue } = createSolverServer({ key, model: 'missing', ollamaEndpoint: 'http://127.0.0.1:1', ...config }); server.listen(0, '127.0.0.1'); await once(server, 'listening'); const endpoint = `http://127.0.0.1:${server.address().port}`; try { await fn(new SolverClient({ endpoint, key }), endpoint, queue); } finally { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); } }
const svgImage = (body, width = 500, height = 160) => sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${body}</svg>`)).png().toBuffer();

test('signed requests reject missing, modified, expired, replayed, and foreign-origin requests', async () => service(async (client, endpoint) => {
  assert.equal((await fetch(`${endpoint}/v1/metrics`)).status, 401);
  const headers = await signedHeaders(key, 'GET', '/v1/metrics');
  assert.equal((await fetch(`${endpoint}/v1/metrics`, { headers })).status, 200);
  assert.equal((await fetch(`${endpoint}/v1/metrics`, { headers })).status, 401);
  assert.equal((await fetch(`${endpoint}/v1/metrics`, { headers: await signedHeaders(key, 'GET', '/v1/metrics', '', Date.now() - 120000) })).status, 401);
  assert.equal((await fetch(`${endpoint}/v1/metrics`, { headers: { ...await signedHeaders(key, 'GET', '/v1/metrics'), Origin: 'https://untrusted.example' } })).status, 403);
  const body = JSON.stringify({ type: 'pow', prefix: 'fixture', difficulty: 4 });
  assert.equal((await fetch(`${endpoint}/v1/tasks`, { method: 'POST', headers: await signedHeaders(key, 'POST', '/v1/tasks', body), body: body.replace('fixture', 'changed') })).status, 401);
  assert.equal((await client.request('health')).status, 'ok');
}));

test('task queue is idempotent, cancellable, and does not retain completed images', async () => service(async (client, endpoint, queue) => {
  const input = { type: 'pow', prefix: 'test', difficulty: 24, requestId: 'stable-retry' };
  const first = await client.request('v1/tasks', { method: 'POST', body: input });
  const second = await client.request('v1/tasks', { method: 'POST', body: input }); assert.equal(first.id, second.id);
  await assert.rejects(client.request('v1/tasks', { method: 'POST', body: { ...input, prefix: 'different' } }), /different task/);
  await client.request(`v1/tasks/${first.id}`, { method: 'DELETE' });
  assert.throws(() => queue.get(first.id), /expired/);
  const result = await client.solve({ type: 'pow', prefix: 'sample', difficulty: 12 });
  assert.equal(result.hash, createHash('sha256').update(`sample${result.nonce}`).digest('hex')); assert.ok(result.hash.startsWith('000'));
  assert.equal(queue.tasks.size, 0); assert.equal(queue.metrics.cancelled, 1); assert.equal(queue.metrics.succeeded, 1);
}));

test('local service reads text and detects blank images using the real bundled model', async () => service(async (client) => {
  const image = await svgImage('<rect width="100%" height="100%" fill="white"/><text x="30" y="110" font-family="Arial" font-size="64" fill="black">572948</text>');
  const result = await client.solve({ type: 'ocr', image: image.toString('base64'), settings: { mode: 'line', characters: 'digits', removeSpaces: true } });
  assert.equal(result.text, '572948'); assert.ok(result.confidence > .8);
  const dark = await svgImage('<rect width="100%" height="100%" fill="#17352b"/><text x="30" y="110" font-family="Arial" font-size="64" fill="white">572948</text>');
  assert.equal((await client.solve({ type: 'ocr', image: dark.toString('base64'), settings: { mode: 'line', characters: 'digits' } })).text, '572948');
  const blank = await svgImage('<rect width="100%" height="100%" fill="white"/>');
  assert.equal((await client.solve({ type: 'ocr', image: blank.toString('base64') })).text, '');
}));

test('piece matching returns original pixel coordinates and rotation compares a real reference', async () => service(async (client) => {
  const base = await svgImage('<defs><linearGradient id="g"><stop stop-color="#af1823"/><stop offset="1" stop-color="#143fea"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><circle cx="207" cy="88" r="38" fill="#ffd65c"/><path d="M50 20 L400 130" stroke="#fff" stroke-width="9"/>');
  const piece = await sharp(base).extract({ left: 181, top: 61, width: 65, height: 54 }).png().toBuffer();
  const match = await client.solve({ type: 'slider', image: base.toString('base64'), reference: piece.toString('base64') });
  assert.equal(match.x, 181); assert.equal(match.y, 61); assert.equal(match.confidence, 1);
  const reference = await svgImage('<rect width="100%" height="100%" fill="#fff"/><path d="M100 100 L100 5 A95 95 0 0 1 195 100 Z" fill="#e62939"/><circle cx="60" cy="140" r="26" fill="#1450a1"/>', 200, 200);
  const rotated = await sharp(reference).rotate(90).png().toBuffer();
  const solution = await client.solve({ type: 'rotate', image: rotated.toString('base64'), reference: reference.toString('base64') });
  assert.ok(Math.abs(solution.clockwiseDegrees - 270) <= 2); assert.ok(solution.confidence > .9);
}));

test('untrusted tasks and rule values fail closed', () => {
  assert.throws(() => endpointURL('http://external.example'), /HTTPS/);
  assert.throws(() => endpointURL('https://user:password@external.example'), /credentials/);
  assert.throws(() => validateTask({ type: 'recaptcha-v3' }), /Provider tokens/);
  assert.throws(() => validateTask({ type: 'pow', prefix: 'a', difficulty: 25 }), /difficulty/);
  assert.throws(() => validateSolution({ type: 'grid', rows: 3, columns: 3 }, { selected: [9], confidence: 1 }), /index/);
  assert.throws(() => validateSolution({ type: 'points' }, { points: [{ x: 2, y: .3 }] }), /coordinates/);
  assert.throws(() => validateRule({ origin: 'https://example.com', imageSelector: '#img', inputSelector: '#input', minConfidence: 'nonsense' }), /minConfidence/);
  assert.equal(matchOrigin('https://example.com.evil/path', 'https://example.com'), false);
  assert.equal(matchOrigin('https://example.com:8443/path', 'https://example.com'), false);
});

test('request signing preserves Unicode split across transport chunks', async () => service(async (client, endpoint) => {
  const body = JSON.stringify({ type: 'pow', prefix: '日本語', difficulty: 1 });
  const bytes = Buffer.from(body); const split = bytes.indexOf(Buffer.from('日')) + 1;
  const headers = await signedHeaders(key, 'POST', '/v1/tasks', body);
  const status = await new Promise((resolve, reject) => {
    const request = httpRequest(endpoint + '/v1/tasks', { method: 'POST', headers }, response => { response.resume(); response.on('end', () => resolve(response.statusCode)); });
    request.on('error', reject); request.write(bytes.subarray(0, split)); setTimeout(() => request.end(bytes.subarray(split)), 10);
  });
  assert.equal(status, 202);
}));

test('client cancellation removes active work and a subsequent task still succeeds', async () => service(async (client, endpoint, queue) => {
  const controller = new AbortController();
  await assert.rejects(client.solve({ type: 'pow', prefix: 'cancel-me', difficulty: 24 }, { signal: controller.signal, onProgress: () => controller.abort(new Error('Stopped by user')) }), /Stopped/);
  assert.equal(queue.tasks.size, 0);
  assert.equal((await client.solve({ type: 'pow', prefix: 'next', difficulty: 1 })).difficulty, 1);
}));
