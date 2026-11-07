import { api } from './platform.js';
import { recognize } from './ocr.js';

const controllers = new Map();
let pending = Promise.resolve();
api.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== api.runtime.id || message?.target !== 'engine') return;
  if (message.type === 'CANCEL_OCR') { controllers.get(message.id)?.abort(new Error('Recognition cancelled.')); respond({ ok: true }); return; }
  if (message.type !== 'LOCAL_OCR') return;
  const controller = new AbortController(); controllers.set(message.id, controller);
  const work = pending.then(async () => {
    if (controller.signal.aborted) throw controller.signal.reason;
    return recognize(message.image, message.settings, { signal: controller.signal });
  });
  pending = work.catch(() => {});
  work.then((value) => respond({ ok: true, value }), (error) => respond({ ok: false, error: error.message })).finally(() => controllers.delete(message.id));
  return true;
});
