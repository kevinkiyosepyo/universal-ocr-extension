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
  const means = [0, 0, 0], squares = [0, 0, 0];
  for (const point of points) for (let c = 0; c < 3; c++) { means[c] += point[c + 2]; squares[c] += point[c + 2] ** 2; }
  const variance = squares.reduce((total, value, c) => total + value / points.length - (means[c] / points.length) ** 2, 0) / 3;
  if (variance < 16) throw new TaskError('UNCERTAIN_IMAGE', 'The reference piece has too little texture to locate reliably.');
  // Compare distinctive pixels first so incorrect positions exceed their
  // error bound quickly; ordering does not change the final squared error.
  const centers = means.map(sum => sum / points.length);
  const contrast = point => centers.reduce((sum, value, c) => sum + (point[c + 2] - value) ** 2, 0);
  points.sort((a, b) => contrast(b) - contrast(a));
  const samples = Int32Array.from(points.flat()), count = points.length;
  const score = (x, y, cutoff) => {
    let sum = 0; const limit = cutoff * count;
    for (let p = 0; p < samples.length; p += 5) {
      const i = ((y + samples[p + 1]) * bw + x + samples[p]) * 4;
      if (bg[i + 3] < 200) return Infinity;
      sum += (bg[i] - samples[p + 2]) ** 2 + (bg[i + 1] - samples[p + 3]) ** 2 + (bg[i + 2] - samples[p + 4]) ** 2;
      if (sum > limit) return Infinity;
    }
    return sum / count;
  };
  let best = Infinity, bx = 0, by = 0;
  const consider = (x, y) => { const error = score(x, y, best); if (error < best) { best = error; bx = x; by = y; } };
  // Native image extracts often match exactly. Two distinctive RGB anchors
  // cheaply find such a location before expensive approximate scoring. This
  // is only a seed: when none matches, the complete search below still runs.
  const anchors = [0, Math.floor(count / 2) * 5];
  exact: for (let y = 0; y <= bh - th; y++) {
    candidate: for (let x = 0; x <= bw - tw; x++) {
      for (const p of anchors) {
        const i = ((y + samples[p + 1]) * bw + x + samples[p]) * 4;
        if (bg[i] !== samples[p + 2] || bg[i + 1] !== samples[p + 3] || bg[i + 2] !== samples[p + 4] || bg[i + 3] < 200) continue candidate;
      }
      if (score(x, y, 0) === 0) { best = 0; bx = x; by = y; break exact; }
    }
  }
  // Seed a tight error bound cheaply, then cover every pixel. This keeps exact
  // matching fast without missing copies on different coarse-grid phases.
  if (best !== 0) {
    const step = bw > 450 ? 3 : 2;
    for (let y = 0; y <= bh - th; y += step) for (let x = 0; x <= bw - tw; x += step) consider(x, y);
    const seedX = bx, seedY = by;
    for (let y = Math.max(0, seedY - step); y <= Math.min(bh - th, seedY + step); y++) for (let x = Math.max(0, seedX - step); x <= Math.min(bw - tw, seedX + step); x++) consider(x, y);
    for (let y = 0; y <= bh - th; y++) for (let x = 0; x <= bw - tw; x++) consider(x, y);
  }
  if (!Number.isFinite(best)) throw new TaskError('UNCERTAIN_IMAGE', 'No opaque background location matches the reference.');
  // Confidence saturates after three RGB levels of RMS separation. Larger
  // alternative errors cannot affect the answer, so stop scoring them early.
  let next = 3 * (Math.sqrt(best / 3) + 3) ** 2;
  const neighborhood = Math.max(3, Math.min(tw, th) * .1), offset = Math.floor(neighborhood) + 1;
  // Nearby alternatives usually supply a useful upper error bound before
  // checking the rest of the scene for separate exact or near-exact copies.
  for (const [dx, dy] of [[offset, 0], [-offset, 0], [0, offset], [0, -offset]]) {
    const x = bx + dx, y = by + dy;
    if (x >= 0 && y >= 0 && x <= bw - tw && y <= bh - th) next = Math.min(next, score(x, y, next));
  }
  for (let y = 0; y <= bh - th; y++) for (let x = 0; x <= bw - tw; x++) {
    if ((x - bx) ** 2 + (y - by) ** 2 <= neighborhood ** 2) continue;
    next = Math.min(next, score(x, y, next));
  }
  const separation = Math.sqrt(next / 3) - Math.sqrt(best / 3);
  if (separation < 1) throw new TaskError('UNCERTAIN_IMAGE', 'More than one piece location matches. Review the image manually.');
  const confidence = Math.max(0, Math.min(1, 1 - Math.sqrt(best / 3) / 100)) * Math.min(1, separation / 3);
  return { x: bx, y: by, width: tw, height: th, backgroundWidth: bw, backgroundHeight: bh, normalizedX: bx / bw, normalizedY: by / bh, confidence };
}

function polarSignature(image) {
  if (![image.width, image.height].every(value => Number.isInteger(value) && value >= 16) || image.data.length !== image.width * image.height * 4) throw new TaskError('INVALID_TASK', 'Rotation images must be at least 16 pixels per side with complete RGBA data.');
  const radii = [.15, .25, .35, .44], values = new Float32Array(radii.length * 360 * 4);
  let variation = 0, channels = 0, opaque = 0;
  for (let ring = 0; ring < radii.length; ring++) {
    const sums = [0, 0, 0], squares = [0, 0, 0]; let count = 0;
    for (let angle = 0; angle < 360; angle++) {
      const radius = Math.min(image.width, image.height) * radii[ring], radians = angle * Math.PI / 180;
      const x = (image.width - 1) / 2 + Math.cos(radians) * radius, y = (image.height - 1) / 2 + Math.sin(radians) * radius;
      const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0, at = (ring * 360 + angle) * 4;
      const offsets = [(y0 * image.width + x0) * 4, (y0 * image.width + x0 + 1) * 4, ((y0 + 1) * image.width + x0) * 4, ((y0 + 1) * image.width + x0 + 1) * 4];
      const weights = [(1 - fx) * (1 - fy), fx * (1 - fy), (1 - fx) * fy, fx * fy];
      for (let c = 0; c < 4; c++) values[at + c] = offsets.reduce((sum, offset, i) => sum + image.data[offset + c] * weights[i], 0);
      if (values[at + 3] < 200) continue;
      count++; opaque++;
      for (let c = 0; c < 3; c++) { sums[c] += values[at + c]; squares[c] += values[at + c] ** 2; }
    }
    if (count) for (let c = 0; c < 3; c++) { variation += squares[c] - sums[c] ** 2 / count; channels += count; }
  }
  // Radial color bands do not establish orientation. Measure variation along
  // each ring separately, and never read hidden RGB in transparent pixels.
  if (opaque < radii.length * 360 * .6 || !channels || variation / channels < 16) throw new TaskError('UNCERTAIN_IMAGE', 'The images need enough opaque angular detail to determine rotation.');
  return values;
}

export function matchRotation(image, reference) {
  // Sample each image once. Testing angles only indexes these signatures;
  // interpolation and trigonometry are not repeated for all 360 candidates.
  const source = polarSignature(image), upright = polarSignature(reference), errors = new Float64Array(360);
  let best = Infinity, degrees = 0;
  for (let rotation = 0; rotation < 360; rotation++) {
    let error = 0, count = 0;
    for (let ring = 0; ring < 4; ring++) for (let angle = 0; angle < 360; angle += 3) {
      const a = (ring * 360 + (angle - rotation + 360) % 360) * 4, b = (ring * 360 + angle) * 4;
      if (source[a + 3] < 200 || upright[b + 3] < 200) continue;
      for (let c = 0; c < 3; c++) error += (source[a + c] - upright[b + c]) ** 2;
      count++;
    }
    errors[rotation] = count >= 4 * 120 * .6 ? error / (count * 3) : Infinity;
    if (errors[rotation] < best) { best = errors[rotation]; degrees = rotation; }
  }
  let next = Infinity;
  for (let angle = 0; angle < 360; angle++) {
    const distance = Math.abs(angle - degrees);
    if (Math.min(distance, 360 - distance) > 8) next = Math.min(next, errors[angle]);
  }
  const separation = Math.sqrt(next) - Math.sqrt(best);
  if (!Number.isFinite(best) || separation < 1) throw new TaskError('UNCERTAIN_IMAGE', 'More than one rotation matches. Supply an unambiguous upright reference.');
  return { clockwiseDegrees: degrees, confidence: Math.max(0, Math.min(1, 1 - Math.sqrt(best) / 100)) * Math.min(1, separation / 8) };
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
