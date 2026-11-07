import { createWorker } from 'tesseract.js';
import { cleanText, recognitionParameters, sanitizeSettings } from './settings.js';
import { prepareImage } from './image.js';

function abortable(promise, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new Error('Recognition cancelled.'));
    if (signal.aborted) return abort();
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

export async function recognize(image, options, { signal, onProgress = () => {} } = {}) {
  const settings = sanitizeSettings(options);
  const controller = new AbortController();
  const cancel = () => controller.abort(signal?.reason ?? new Error('Recognition cancelled.'));
  signal?.addEventListener('abort', cancel, { once: true });
  if (signal?.aborted) cancel();
  const deadline = setTimeout(() => controller.abort(new Error('Recognition took too long. Try a smaller image.')), 120_000);
  let worker;
  const started = performance.now();
  try {
    onProgress({ status: 'Preparing image', progress: 0.02 });
    const prepared = await abortable(prepareImage(image, settings.processing), controller.signal);
    if (!prepared) return { text: '', confidence: 0, elapsedMs: Math.round(performance.now() - started) };
    let rejectWorker;
    const workerError = new Promise((_, reject) => { rejectWorker = reject; });
    const pending = createWorker(settings.language, 1, {
      workerPath: chrome.runtime.getURL('vendor/worker.min.js'),
      corePath: chrome.runtime.getURL('vendor/core'),
      langPath: chrome.runtime.getURL('vendor/lang'),
      workerBlobURL: false,
      cacheMethod: 'none',
      logger: (message) => { if (!controller.signal.aborted) onProgress(message); },
      errorHandler: (error) => rejectWorker(new Error(typeof error === 'string' ? error : 'The OCR engine stopped. Please retry.')),
    });
    pending.then((created) => {
      if (controller.signal.aborted) void created.terminate();
      else worker = created;
    }, () => {});
    worker = await abortable(Promise.race([pending, workerError]), controller.signal);
    await abortable(Promise.race([worker.setParameters(recognitionParameters(settings)), workerError]), controller.signal);
    const result = await abortable(Promise.race([worker.recognize(prepared, {}, { text: true }), workerError]), controller.signal);
    return {
      text: cleanText(result.data.text, settings),
      confidence: Math.max(0, Math.min(100, Math.round(result.data.confidence || 0))),
      elapsedMs: Math.round(performance.now() - started),
    };
  } finally {
    clearTimeout(deadline);
    signal?.removeEventListener('abort', cancel);
    controller.abort();
    if (worker) await worker.terminate();
  }
}
