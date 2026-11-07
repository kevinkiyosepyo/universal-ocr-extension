import { Worker } from 'node:worker_threads';
import { randomUUID, createHash } from 'node:crypto';
import { TaskError, validateTask } from '../shared/protocol.js';

export class TaskQueue {
  constructor(config = {}) {
    this.config = config; this.tasks = new Map(); this.requests = new Map(); this.pending = []; this.active = 0;
    this.metrics = { created: 0, succeeded: 0, failed: 0, cancelled: 0, totalMs: 0 };
    this.ttl = setInterval(() => this.prune(), 30_000); this.ttl.unref();
  }
  create(input) {
    this.prune();
    const task = validateTask(input);
    const requestId = typeof input.requestId === 'string' && /^[\w-]{1,100}$/.test(input.requestId) ? input.requestId : randomUUID();
    const existing = this.requests.get(requestId);
    const digest = createHash('sha256').update(JSON.stringify(task)).digest('hex');
    if (existing && this.tasks.has(existing)) { const record = this.tasks.get(existing); if (record.digest !== digest) throw new TaskError('CONFLICT', 'This requestId already belongs to a different task.'); return this.public(record); }
    if (this.pending.length >= 24 || this.tasks.size >= 200) throw new TaskError('QUEUE_FULL', 'The task queue is full. Try again shortly.', true);
    const record = { id: randomUUID(), requestId, type: task.type, task, digest, state: 'queued', createdAt: Date.now() };
    this.tasks.set(record.id, record); this.requests.set(requestId, record.id); this.pending.push(record); this.metrics.created++; this.pump();
    return this.public(record);
  }
  public(record) {
    return { id: record.id, type: record.type, state: record.state, createdAt: record.createdAt, elapsedMs: (record.finishedAt || Date.now()) - (record.startedAt || record.createdAt), ...(record.solution ? { solution: record.solution } : {}), ...(record.error ? { error: record.error } : {}) };
  }
  get(id) { const record = this.tasks.get(id); if (!record) throw new TaskError('NOT_FOUND', 'Task not found or expired.'); return this.public(record); }
  remove(id) {
    const record = this.tasks.get(id);
    if (!record) return;
    if (['queued', 'running'].includes(record.state)) {
      record.state = 'cancelled'; record.finishedAt = Date.now(); this.metrics.cancelled++;
      record.worker?.terminate();
    }
    this.tasks.delete(id); this.requests.delete(record.requestId);
    this.pending = this.pending.filter((task) => task.id !== id);
    delete record.task; delete record.solution;
  }
  pump() {
    while (this.active < (this.config.concurrency || 2) && this.pending.length) {
      const record = this.pending.shift();
      if (!this.tasks.has(record.id)) continue;
      this.active++; record.state = 'running'; record.startedAt = Date.now();
      const worker = new Worker(new URL('./task-worker.mjs', import.meta.url), { workerData: { task: record.task, config: this.config } });
      record.worker = worker; delete record.task;
      let done = false;
      const finish = (result) => {
        if (done) return; done = true; clearTimeout(timeout); this.active--;
        if (record.state !== 'cancelled') {
          record.state = result.ok ? 'succeeded' : 'failed'; record.finishedAt = Date.now();
          if (result.ok) record.solution = result.solution; else record.error = result.error;
          this.metrics[record.state]++; this.metrics.totalMs += record.finishedAt - record.startedAt;
        }
        delete record.worker; void worker.terminate(); this.pump();
      };
      const timeout = setTimeout(() => finish({ ok: false, error: { code: 'TIMEOUT', message: 'Task exceeded 180 seconds.', retryable: true } }), this.config.timeout || 180_000);
      worker.once('message', finish);
      worker.once('error', (error) => finish({ ok: false, error: { code: 'ENGINE_ERROR', message: error.message, retryable: false } }));
      worker.once('exit', () => finish({ ok: false, error: { code: 'WORKER_STOPPED', message: 'Recognition worker stopped.', retryable: true } }));
    }
  }
  prune() { for (const record of this.tasks.values()) if (Date.now() - (record.finishedAt || record.createdAt) > 10 * 60_000) this.remove(record.id); }
  close() { clearInterval(this.ttl); for (const id of this.tasks.keys()) this.remove(id); }
}
