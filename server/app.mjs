import { createServer } from 'node:http';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { TaskQueue } from './queue.mjs';
import { TASK_TYPES, endpointURL, TaskError } from '../shared/protocol.js';

export function createSolverServer(config) {
  if (typeof config.key !== 'string' || config.key.length < 24) throw new Error('Use an API key of at least 24 characters.');
  const { key: _key, ...engineConfig } = config;
  const queue = new TaskQueue(engineConfig);
  const nonces = new Map();
  const reply = (response, status, value) => { response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); response.end(JSON.stringify(value)); };
  const server = createServer(async (request, response) => {
    try {
      if (!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(request.headers.host || '')) throw new TaskError('FORBIDDEN', 'This service accepts loopback hosts only.');
      const origin = request.headers.origin;
      if (origin && !/^(chrome-extension:\/\/[a-p]{32}|moz-extension:\/\/[a-z0-9-]+)$/.test(origin)) throw new TaskError('FORBIDDEN', 'Webpage origins cannot access this service.');
      if (origin) { response.setHeader('Access-Control-Allow-Origin', origin); response.setHeader('Vary', 'Origin'); }
      if (request.method === 'OPTIONS') {
        response.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
        response.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-OCR-Timestamp, X-OCR-Nonce, X-OCR-Signature');
        response.writeHead(204); response.end(); return;
      }
      const url = new URL(request.url, 'http://localhost');
      if (url.search || url.hash) throw new TaskError('INVALID_REQUEST', 'Query parameters are not accepted.');
      const chunks = []; let bytes = 0;
      for await (const chunk of request) {
        bytes += chunk.length;
        if (bytes > 42 * 1024 * 1024) throw new TaskError('TOO_LARGE', 'Request body is too large.');
        chunks.push(chunk);
      }
      const rawBody = Buffer.concat(chunks);
      const body = rawBody.toString('utf8');
      const timestamp = request.headers['x-ocr-timestamp'], nonce = request.headers['x-ocr-nonce'], signature = request.headers['x-ocr-signature'];
      for (const [value, expiry] of nonces) if (expiry < Date.now()) nonces.delete(value);
      if (!/^\d{13}$/.test(timestamp || '') || Math.abs(Date.now() - Number(timestamp)) > 60_000 || !/^[\w-]{16,100}$/.test(nonce || '') || !/^[a-f0-9]{64}$/.test(signature || '')) throw new TaskError('UNAUTHORIZED', 'A valid timestamped signature is required.');
      const digest = createHash('sha256').update(rawBody).digest('hex');
      const expected = createHmac('sha256', config.key).update(`${timestamp}\n${nonce}\n${request.method}\n${url.pathname}\n${digest}`).digest();
      if (!timingSafeEqual(expected, Buffer.from(signature, 'hex')) || nonces.has(nonce)) throw new TaskError('UNAUTHORIZED', 'Invalid or replayed request signature.');
      if (nonces.size >= 20_000) throw new TaskError('QUEUE_FULL', 'Request limit reached. Retry in one minute.', true);
      nonces.set(nonce, Date.now() + 120_000);
      if (request.method === 'GET' && url.pathname === '/health') {
        let vision = { available: false, model: config.model };
        try {
          const result = await fetch(new URL('api/tags', endpointURL(config.ollamaEndpoint)), { signal: AbortSignal.timeout(2500), redirect: 'error' });
          const value = await result.json();
          vision.available = result.ok && value.models?.some((model) => model.name === config.model);
        } catch { /* OCR and deterministic engines remain available. */ }
        reply(response, 200, { status: 'ok', version: '2.0.0', vision, tasks: TASK_TYPES, queued: queue.pending.length, running: queue.active }); return;
      }
      if (request.method === 'GET' && url.pathname === '/v1/metrics') { reply(response, 200, queue.metrics); return; }
      if (request.method === 'POST' && url.pathname === '/v1/tasks') {
        let task; try { task = JSON.parse(body); } catch { throw new TaskError('INVALID_REQUEST', 'Body must be JSON.'); }
        reply(response, 202, queue.create(task)); return;
      }
      const match = url.pathname.match(/^\/v1\/tasks\/([a-f0-9-]{36})$/);
      if (match && request.method === 'GET') { reply(response, 200, queue.get(match[1])); return; }
      if (match && request.method === 'DELETE') { queue.remove(match[1]); reply(response, 200, { deleted: true }); return; }
      throw new TaskError('NOT_FOUND', 'Route not found.');
    } catch (error) {
      const status = { UNAUTHORIZED: 401, FORBIDDEN: 403, NOT_FOUND: 404, QUEUE_FULL: 429, TOO_LARGE: 413, CONFLICT: 409 }[error.code] || (error instanceof TaskError ? 400 : 500);
      if (!response.headersSent) reply(response, status, { error: { code: error.code || 'INTERNAL_ERROR', message: error instanceof TaskError ? error.message : 'The service encountered an internal error.', retryable: Boolean(error.retryable) } });
    }
  });
  server.requestTimeout = 30_000;
  server.on('close', () => queue.close());
  return { server, queue };
}
