import { parentPort, workerData } from 'node:worker_threads';
import { createWorker } from 'tesseract.js';
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import { pixels, matchTemplate, matchRotation, proofOfWork } from './algorithms.mjs';
import { inferVision } from './vision.mjs';
import { sanitizeSettings, recognitionParameters, cleanText } from '../src/settings.js';
import { estimateTextScale, scaledSize } from '../src/geometry.js';

async function execute({ task, config }) {
  if (task.type === 'pow') return proofOfWork(task.prefix, task.difficulty);
  if (task.type === 'slider') {
    // Both images retain their original coordinate system. Scaling them independently
    // would change the relative piece size and invalidate the returned displacement.
    return matchTemplate(await pixels(task.image, 0), await pixels(task.reference, 0));
  }
  if (task.type === 'rotate') return matchRotation(await pixels(task.image, 600), await pixels(task.reference, 600));
  if (['grid', 'points', 'bbox', 'captcha-text'].includes(task.type)) return inferVision(task, config);
  const settings = sanitizeSettings(task.settings);
  const decoded = await sharp(Buffer.from(task.image, 'base64'), { limitInputPixels: 20_000_000 }).rotate().resize({ width: 4096, height: 4096, fit: 'inside', withoutEnlargement: true }).flatten({ background: '#fff' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let border = 0, borderCount = 0, low = 255, high = 0;
  for (let i = 0; i < decoded.data.length; i += 4) {
    const gray = decoded.data[i] * .299 + decoded.data[i + 1] * .587 + decoded.data[i + 2] * .114;
    low = Math.min(low, gray); high = Math.max(high, gray);
    const index = i / 4, x = index % decoded.info.width, y = Math.floor(index / decoded.info.width);
    if (x < 3 || y < 3 || x >= decoded.info.width - 3 || y >= decoded.info.height - 3) { border += gray; borderCount++; }
  }
  if (high - low < 2) return { text: '', confidence: 0 };
  const scale = estimateTextScale(decoded.data, decoded.info.width, decoded.info.height);
  const size = scaledSize(decoded.info.width, decoded.info.height, 24, scale);
  let pipeline = sharp(decoded.data, { raw: decoded.info }).resize(size.width, size.height);
  if (settings.processing !== 'original') pipeline = pipeline.grayscale().normalize();
  if (settings.processing !== 'original' && border / borderCount < 120) pipeline = pipeline.negate({ alpha: false });
  if (settings.processing === 'contrast') pipeline = pipeline.threshold(150);
  const image = await pipeline.extend({ top: 24, bottom: 24, left: 24, right: 24, background: '#fff' }).png().toBuffer();
  const worker = await createWorker(settings.language, 1, { langPath: fileURLToPath(new URL(`../node_modules/@tesseract.js-data/${settings.language}/4.0.0_best_int/`, import.meta.url)), cacheMethod: 'none' });
  try {
    await worker.setParameters(recognitionParameters(settings));
    const { data } = await worker.recognize(image);
    return { text: cleanText(data.text, settings), confidence: Math.max(0, Math.min(1, data.confidence / 100)) };
  } finally { await worker.terminate(); }
}

execute(workerData).then(
  (solution) => parentPort.postMessage({ ok: true, solution }),
  (error) => parentPort.postMessage({ ok: false, error: { code: error.code || 'ENGINE_ERROR', message: error.message, retryable: Boolean(error.retryable) } }),
);
