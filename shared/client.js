import { endpointURL, signedHeaders, TaskError, retryDelay } from './protocol.js';

export class SolverClient {
  constructor({ endpoint = 'http://127.0.0.1:47821', key = '', fetchImpl = fetch } = {}) {
    this.endpoint = endpointURL(endpoint); this.key = key; this.fetch = fetchImpl.bind(globalThis);
  }
  async request(path, { method = 'GET', body, signal, retries = 2 } = {}) {
    const url = new URL(path.replace(/^\//, ''), this.endpoint);
    const encoded = body === undefined ? '' : JSON.stringify(body);
    for (let attempt = 0; ; attempt++) {
      try {
        const response = await this.fetch(url, {
          method, headers: await signedHeaders(this.key, method, url.pathname, encoded),
          body: encoded || undefined, signal, redirect: 'error', cache: 'no-store',
        });
        const result = await response.json();
        if (!response.ok) throw new TaskError(result.error?.code || 'HTTP_ERROR', result.error?.message || `Service returned ${response.status}.`, response.status === 429 || response.status >= 500);
        return result;
      } catch (error) {
        if (signal?.aborted) throw signal.reason || error;
        const transient = error.retryable || error instanceof TypeError;
        if (!transient || attempt >= retries) throw error;
        await wait(retryDelay(attempt), signal);
      }
    }
  }
  async solve(task, { signal, onProgress = () => {}, timeout = 180_000 } = {}) {
    const controller = new AbortController();
    const abort = () => controller.abort(signal?.reason || new Error('Cancelled.'));
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    const timer = setTimeout(() => controller.abort(new Error('Recognition timed out.')), timeout);
    let id;
    try {
      const created = await this.request('v1/tasks', { method: 'POST', body: { ...task, requestId: crypto.randomUUID() }, signal: controller.signal });
      id = created.id;
      let status = created, interval = 60;
      for (;;) {
        onProgress(status);
        if (controller.signal.aborted) throw controller.signal.reason;
        if (status.state === 'succeeded') return status.solution;
        if (['failed', 'cancelled'].includes(status.state)) throw new TaskError(status.error?.code || 'CANCELLED', status.error?.message || 'Task cancelled.', status.error?.retryable);
        await wait(interval, controller.signal);
        interval = Math.min(300, Math.round(interval * 1.5));
        status = await this.request(`v1/tasks/${id}`, { signal: controller.signal });
      }
    } finally {
      clearTimeout(timer); signal?.removeEventListener('abort', abort);
      if (id) await this.request(`v1/tasks/${id}`, { method: 'DELETE', retries: 0, signal: AbortSignal.timeout(3000) }).catch(() => {});
    }
  }
}

function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, ms);
    signal?.addEventListener('abort', abort, { once: true });
  });
}
