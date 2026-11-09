import { TaskError } from '../shared/protocol.js';

const ANGLES = 720;
const uncertain = message => { throw new TaskError('UNCERTAIN_IMAGE', message); };

function validate(image) {
  if (!image || !Number.isInteger(image.width) || image.width < 64 || image.width > 2000 || image.height !== image.width || image.data?.length !== image.width * image.height * 4) {
    throw new TaskError('INVALID_TASK', 'Ring matching requires square RGBA images between 64 and 2000 pixels per side.');
  }
}

function sample(image, radius, angle) {
  const x = image.width * (.5 + Math.cos(angle) * radius) - .5;
  const y = image.height * (.5 + Math.sin(angle) * radius) - .5;
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  if (x0 < 0 || y0 < 0 || x0 + 1 >= image.width || y0 + 1 >= image.height) return null;
  const offsets = [(y0 * image.width + x0) * 4, (y0 * image.width + x0 + 1) * 4, ((y0 + 1) * image.width + x0) * 4, ((y0 + 1) * image.width + x0 + 1) * 4];
  const weights = [(1 - fx) * (1 - fy), fx * (1 - fy), (1 - fx) * fy, fx * fy], value = [0, 0, 0, 0];
  for (let c = 0; c < 4; c++) for (let i = 0; i < 4; i++) value[c] += image.data[offsets[i] + c] * weights[i];
  return value[3] >= 240 ? value : null;
}

function signature(image, radius, direction, pixelSize) {
  const result = new Float32Array(ANGLES * 4), sums = [0, 0, 0], squares = [0, 0, 0];
  let count = 0;
  for (let step = 0; step < ANGLES; step++) {
    const angle = step * 2 * Math.PI / ANGLES;
    const near = sample(image, radius + direction * .75 * pixelSize, angle);
    const far = sample(image, radius + direction * 1.5 * pixelSize, angle);
    if (!near || !far) continue;
    const at = step * 4;
    for (let c = 0; c < 3; c++) {
      // Estimate the actual seam from pixels just inside the visible region.
      // This removes a smooth radial gradient without reading occluded pixels.
      const value = Math.max(0, Math.min(255, 2 * near[c] - far[c]));
      result[at + c] = value; sums[c] += value; squares[c] += value * value;
    }
    result[at + 3] = 1; count++;
  }
  if (count < ANGLES * .95) uncertain('The ring boundary is too small, transparent, or incomplete to compare.');
  const variance = squares.reduce((total, value, c) => total + value / count - (sums[c] / count) ** 2, 0) / 3;
  if (variance < 36) uncertain('The ring boundary has too little angular texture to establish rotation.');
  return result;
}

function correlation(outer, inner, rotation) {
  const a = [0, 0, 0], b = [0, 0, 0], aa = [0, 0, 0], bb = [0, 0, 0], ab = [0, 0, 0];
  let count = 0;
  for (let angle = 0; angle < ANGLES; angle++) {
    const i = angle * 4, j = ((angle - rotation + ANGLES) % ANGLES) * 4;
    if (!outer[i + 3] || !inner[j + 3]) continue;
    count++;
    for (let c = 0; c < 3; c++) {
      const x = outer[i + c], y = inner[j + c];
      a[c] += x; b[c] += y; aa[c] += x * x; bb[c] += y * y; ab[c] += x * y;
    }
  }
  let covariance = 0, varianceA = 0, varianceB = 0;
  for (let c = 0; c < 3; c++) {
    covariance += ab[c] - a[c] * b[c] / count;
    varianceA += aa[c] - a[c] ** 2 / count; varianceB += bb[c] - b[c] ** 2 / count;
  }
  return covariance / Math.sqrt(varianceA * varianceB);
}

/**
 * Compare a concentric disk's visible edge with the surrounding ring's edge.
 * `ratio` is the rendered inner diameter divided by the rendered outer diameter;
 * source images can have independent resolutions. Returns the clockwise inner
 * rotation relative to the outer image. This requires a continuous textured
 * scene at the seam, not an upright reference or any provider acceptance signal.
 */
export function matchRingRotation(outer, inner, ratio) {
  validate(outer); validate(inner);
  if (!Number.isFinite(ratio) || ratio < .2 || ratio > .9) throw new TaskError('INVALID_TASK', 'The rendered inner-to-outer diameter ratio must be between 0.2 and 0.9.');
  const resolution = Math.min(outer.width, inner.width / ratio, 512);
  const a = signature(outer, ratio / 2, 1, 1 / resolution);
  const b = signature(inner, .5, -1, 1 / (resolution * ratio));
  const errors = new Float64Array(ANGLES);
  let best = Infinity, rotation = 0;
  for (let turn = 0; turn < ANGLES; turn++) {
    let error = 0, count = 0;
    for (let angle = 0; angle < ANGLES; angle++) {
      const i = angle * 4, j = ((angle - turn + ANGLES) % ANGLES) * 4;
      if (!a[i + 3] || !b[j + 3]) continue;
      for (let c = 0; c < 3; c++) error += (a[i + c] - b[j + c]) ** 2;
      count++;
    }
    errors[turn] = count >= ANGLES * .9 ? error / (count * 3) : Infinity;
    if (errors[turn] < best) { best = errors[turn]; rotation = turn; }
  }
  let next = Infinity;
  for (let turn = 0; turn < ANGLES; turn++) {
    const delta = Math.abs(turn - rotation);
    if (Math.min(delta, ANGLES - delta) > 15) next = Math.min(next, errors[turn]);
  }
  const rms = Math.sqrt(best), separation = Math.sqrt(next) - rms;
  const agreement = correlation(a, b, rotation);
  const confidence = Math.min(1 - rms / 100, separation / 10, agreement, 1);
  if (!Number.isFinite(confidence) || confidence < .85) uncertain('The circular edges do not establish one reliable rotation. Complete this challenge manually.');
  return { clockwiseDegrees: rotation / 2, normalizedDrag: rotation / ANGLES, confidence, boundaryError: rms };
}
