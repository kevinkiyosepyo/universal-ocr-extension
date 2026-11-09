import test from 'node:test';
import assert from 'node:assert/strict';
import { SolverClient } from '../shared/client.js';

test('cached creation results need no poll and are still deleted', async () => {
  const calls = [];
  const client = new SolverClient({ key: 'test', fetchImpl: async (url, options) => {
    calls.push(options.method);
    return Response.json(options.method === 'POST' ? { id: 'cached', state: 'succeeded', solution: { selected: [2], confidence: .9 } } : {});
  } });
  assert.deepEqual(await client.solve({ type: 'grid' }), { selected: [2], confidence: .9 });
  assert.deepEqual(calls, ['POST', 'DELETE']);
});
test('cancellation during cached progress wins over a successful response', async () => {
  const calls = [], abort = new AbortController();
  const client = new SolverClient({ key: 'test', fetchImpl: async (url, options) => {
    calls.push(options.method);
    return Response.json(options.method === 'POST' ? { id: 'cached', state: 'succeeded', solution: { text: 'answer' } } : {});
  } });
  await assert.rejects(client.solve({}, { signal: abort.signal, onProgress: () => abort.abort(new Error('Stopped')) }), /Stopped/);
  assert.deepEqual(calls, ['POST', 'DELETE']);
});
