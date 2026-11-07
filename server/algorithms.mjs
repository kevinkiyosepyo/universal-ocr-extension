import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { TaskError } from '../shared/protocol.js';

export async function pixels(base64, max = 900) {
  const { data, info } = await sharp(Buffer.from(base64, 'base64'), { limitInputPixels: 20_000_000, animated: false })
    .rotate().resize(max ? { width: max, height: max, fit: 'inside', withoutEnlargement: true } : {}).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

export function matchTemplate(background, template) {
  const { width: bw, height: bh, data: bg } = background;
  const { width: tw, height: th, data: fg } = template;
  if (tw >= bw || th > bh) throw new TaskError('INVALID_TASK', 'The piece must be smaller than the background, at the same scale.');
  if (bw > 1200 || bh > 1200) throw new TaskError('INVALID_TASK', 'Piece matching supports images up to 1200 × 1200 at original scale.');
  const points = [];
  // Uniform subsampling bounds work on large pieces while preserving all their edges.
  const stride = Math.max(1, Math.ceil(Math.sqrt(tw * th / 1800)));
  for (let y = 0; y < th; y += stride) for (let x = 0; x < tw; x += stride) {
    const offset = (y * tw + x) * 4;
    if (fg[offset + 3] > 200) points.push([x, y, fg[offset], fg[offset + 1], fg[offset + 2]]);
  }
  if (points.length < 16) throw new TaskError('INVALID_TASK', 'The reference piece contains too few opaque pixels.');
  let best = Infinity, next = Infinity, bx = 0, by = 0;
  const score = (x, y) => {
    let sum = 0;
    for (const [px, py, r, g, b] of points) {
      const i = ((y + py) * bw + x + px) * 4;
      sum += (bg[i] - r) ** 2 + (bg[i + 1] - g) ** 2 + (bg[i + 2] - b) ** 2;
      if (sum > best * points.length) break;
    }
    return sum / points.length;
  };
  const step = bw > 450 ? 3 : 2;
  for (let y = 0; y <= bh - th; y += step) for (let x = 0; x <= bw - tw; x += step) {
    const error = score(x, y);
    if (error < best) { next = best; best = error; bx = x; by = y; } else if (error < next) next = error;
  }
  const centerX = bx, centerY = by;
  for (let y = Math.max(0, centerY - step); y <= Math.min(bh - th, centerY + step); y++) for (let x = Math.max(0, centerX - step); x <= Math.min(bw - tw, centerX + step); x++) {
    const error = score(x, y);
    if (error < best) { best = error; bx = x; by = y; }
  }
  const confidence = Math.max(0, Math.min(1, 1 - Math.sqrt(best / 3) / 100));
  return { x: bx, y: by, width: tw, height: th, backgroundWidth: bw, backgroundHeight: bh, normalizedX: bx / bw, normalizedY: by / bh, confidence };
}

export function matchRotation(image, reference) {
  const sample = (img, angle, radius) => {
    const r = Math.min(img.width, img.height) * radius;
    const x = (img.width - 1) / 2 + Math.cos(angle) * r, y = (img.height - 1) / 2 + Math.sin(angle) * r;
    const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
    return [0, 1, 2].map((c) => img.data[(y0 * img.width + x0) * 4 + c] * (1 - fx) * (1 - fy) + img.data[(y0 * img.width + x0 + 1) * 4 + c] * fx * (1 - fy) + img.data[((y0 + 1) * img.width + x0) * 4 + c] * (1 - fx) * fy + img.data[((y0 + 1) * img.width + x0 + 1) * 4 + c] * fx * fy);
  };
  let best = Infinity, degrees = 0;
  for (let rotation = 0; rotation < 360; rotation++) {
    let error = 0, n = 0;
    for (const radius of [0.15, 0.25, 0.35, 0.44]) for (let angle = 0; angle < 360; angle += 3) {
      const a = sample(image, (angle - rotation) * Math.PI / 180, radius);
      const b = sample(reference, angle * Math.PI / 180, radius);
      for (let c = 0; c < 3; c++) { error += (a[c] - b[c]) ** 2; n++; }
    }
    error /= n;
    if (error < best) { best = error; degrees = rotation; }
  }
  return { clockwiseDegrees: degrees, confidence: Math.max(0, Math.min(1, 1 - Math.sqrt(best) / 100)) };
}

export function proofOfWork(prefix, difficulty, deadline = Date.now() + 25_000) {
  for (let nonce = 0; ; nonce++) {
    if (nonce % 8192 === 0 && Date.now() > deadline) throw new TaskError('TIMEOUT', 'Proof-of-work exceeded its time budget.', true);
    const hash = createHash('sha256').update(`${prefix}${nonce}`).digest();
    let bits = 0;
    for (const byte of hash) { if (byte === 0) bits += 8; else { bits += Math.clz32(byte) - 24; break; } }
    if (bits >= difficulty) return { nonce, hash: hash.toString('hex'), difficulty, algorithm: 'sha256(prefix + decimal nonce)' };
  }
}
