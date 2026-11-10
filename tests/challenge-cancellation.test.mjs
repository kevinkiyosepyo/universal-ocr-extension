import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, webcrypto } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { build } from 'esbuild';

// Run the actual background router, with extension APIs and external effects
// replaced by controlled promises. Storage clones values like Chrome does.
const bundle = await build({
  entryPoints: [new URL('../src/challenge-background.js', import.meta.url).pathname],
  bundle: true, format: 'cjs', platform: 'node', write: false,
  plugins: [{ name: 'background-effects', setup(builder) {
    builder.onLoad({ filter: /\/src\/platform\.js$/ }, () => ({ contents: 'export const api = globalThis.testApi;' }));
    builder.onLoad({ filter: /\/src\/automation-background\.js$/ }, () => ({ contents: 'export async function recordActivity(value) { globalThis.activities.push(value); }' }));
    builder.onLoad({ filter: /\/shared\/client\.js$/ }, () => ({ contents: 'export class SolverClient { async solve(task, options) { return globalThis.solve(task, options); } }' }));
  } }],
});
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const noEvent = { addListener() {} };

function harness({ pauseTabGet = 0, pauseExecute = false, pauseRoundSave = false } = {}) {
  const tabId = 7, url = 'https://example.test/challenge', nonce = randomUUID(), id = randomUUID();
  const key = `challenge-session:${tabId}`;
  const state = { [key]: { id, tabId, url, origin: new URL(url).origin, active: true, autoVerify: true, providers: ['recaptcha-v3', 'recaptcha-v2'], expiresAt: Date.now() + 60000, rounds: 0, frames: { 0: { nonce, documentId: 'document-1' } } } };
  const reached = deferred(), release = deferred(), execution = deferred(), releaseExecution = deferred(), saving = deferred(), releaseSaving = deferred();
  const calls = [], cancelled = new Set(), activities = [];
  let tabGets = 0, solved = 0, abortedSolve = false;
  const api = {
    runtime: { id: 'test-extension' },
    storage: {
      session: {
        async get(name) { return structuredClone({ [name]: state[name] }); },
        async set(values) {
          if (pauseRoundSave && values[key]?.rounds === 1 && values[key]?.active) { saving.resolve(); await releaseSaving.promise; }
          Object.assign(state, structuredClone(values));
        },
        async remove(name) { delete state[name]; },
      },
      local: { async get() { return { service: { endpoint: 'http://127.0.0.1:47821', key: 'fixture-only-service-key' } }; } },
    },
    tabs: {
      async get() { if (++tabGets === pauseTabGet) { reached.resolve(); await release.promise; } return { id: tabId, url, active: true }; },
      async sendMessage() {}, onRemoved: noEvent, onUpdated: noEvent,
    },
    scripting: { async executeScript({ args: [request] }) {
      calls.push(request.op);
      if (request.op === 'inspect') return [{ result: { action: 'fixture', sourceURL: url } }];
      if (request.op === 'cancel') { cancelled.add(request.requestId); return [{ result: { cancelled: true } }]; }
      if (request.op === 'execute') {
        execution.resolve();
        if (pauseExecute) await releaseExecution.promise;
        if (cancelled.has(request.requestId)) throw new Error('The provider request was stopped.');
        return [{ result: { state: 'token-issued' } }];
      }
      throw new Error('Unexpected native operation');
    } },
  };
  const sandbox = { module: { exports: {} }, testApi: api, activities, URL, crypto: webcrypto, AbortController, AbortSignal, setTimeout, clearTimeout,
    async solve(_task, { signal }) {
      solved++;
      if (signal.aborted) { abortedSolve = true; throw signal.reason; }
      return new Promise((_resolve, reject) => signal.addEventListener('abort', () => { abortedSolve = true; reject(signal.reason); }, { once: true }));
    },
  };
  runInNewContext(bundle.outputFiles[0].text, sandbox);
  const route = sandbox.module.exports.challengeRoute;
  const sender = { id: api.runtime.id, tab: { id: tabId }, frameId: 0, url, documentId: 'document-1' };
  return {
    request: () => route({ type: 'CHALLENGE_NATIVE_V3', op: 'execute', sessionId: id, nonce }, sender, false),
    recognize: () => route({ type: 'CHALLENGE_SOLVE', provider: 'recaptcha-v2', sessionId: id, nonce, task: { type: 'grid', image: 'AAAA', prompt: 'bus', rows: 3, columns: 3 } }, sender, false),
    stop: () => route({ type: 'CHALLENGE_STOP', tabId }, {}, true),
    state, key, calls, cancelled, activities, reached, release, execution, releaseExecution, saving, releaseSaving,
    solveState: () => ({ solved, abortedSolve }),
  };
}

test('native v3 executes once while its bound session remains active', { timeout: 3000 }, async () => {
  const h = harness();
  assert.equal((await h.request()).state, 'token-issued');
  assert.deepEqual(h.calls, ['inspect', 'execute']);
});

test('Stop during deferred tab validation prevents native v3 registration and execution', { timeout: 3000 }, async () => {
  // The second tabs.get occurs after MAIN-world inspection, before the
  // controller is registered. Stop must invalidate that stale validation.
  const h = harness({ pauseTabGet: 2 });
  const pending = h.request();
  const rejected = assert.rejects(pending, /stopped|expired/);
  await h.reached.promise;
  assert.equal((await h.stop()).active, false);
  h.release.resolve();
  await rejected;
  assert.deepEqual(h.calls, ['inspect']);
  assert.equal(h.state[h.key].state, 'stopped');
});

test('Stop reaches native v3 even when MAIN-world execution is still queued', { timeout: 3000 }, async () => {
  const h = harness({ pauseExecute: true });
  const pending = h.request();
  const rejected = assert.rejects(pending, /stopped|expired/);
  await h.execution.promise;
  assert.equal((await h.stop()).active, false);
  assert.deepEqual(h.calls, ['inspect', 'execute', 'cancel']);
  h.releaseExecution.resolve();
  await rejected;
  assert.equal(h.cancelled.size, 1);
  assert.deepEqual(h.activities, []);
});

test('Stop queued during round persistence aborts the registered recognition task', { timeout: 3000 }, async () => {
  const h = harness({ pauseRoundSave: true });
  const pending = h.recognize();
  const rejected = assert.rejects(pending, /Stopped|stopped|expired/);
  await h.saving.promise;
  const stopped = h.stop();
  h.releaseSaving.resolve();
  assert.equal((await stopped).active, false);
  await rejected;
  assert.deepEqual(h.solveState(), { solved: 1, abortedSolve: true });
  assert.equal(h.state[h.key].state, 'stopped');
  assert.deepEqual(h.activities, []);
});
