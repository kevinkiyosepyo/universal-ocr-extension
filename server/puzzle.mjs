import { TaskError } from '../shared/protocol.js';

const gray = (data, offset) => data[offset] * .299 + data[offset + 1] * .587 + data[offset + 2] * .114;

// Match texture after removing the mean and brightness scale. Puzzle cutouts
// are commonly darkened, so raw RGB distance favors the wrong part of a scene.
export function matchPuzzle(background, piece, options = {}) {
  const { width: width, height, data } = background;
  if (width > 1200 || height > 1200 || piece.width > 1200 || piece.height > 1200) throw new TaskError('INVALID_TASK', 'Puzzle images must be at most 1200 pixels per side.');
  let left = piece.width, top = piece.height, right = -1, bottom = -1;
  for (let y = 0; y < piece.height; y++) for (let x = 0; x < piece.width; x++) {
    if (piece.data[(y * piece.width + x) * 4 + 3] < 200) continue;
    left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
  }
  const pw = right - left + 1, ph = bottom - top + 1;
  if (pw < 4 || ph < 4 || pw >= width || ph > height) throw new TaskError('INVALID_TASK', 'No usable puzzle piece at the background scale.');
  const stride = Math.max(1, Math.ceil(Math.sqrt(pw * ph / 700))), points = [];
  let sum = 0, squares = 0;
  for (let y = top; y <= bottom; y += stride) for (let x = left; x <= right; x += stride) {
    const offset = (y * piece.width + x) * 4;
    if (piece.data[offset + 3] < 200) continue;
    // Ignore the provider's decorative stroke around the piece. It is not
    // part of the background texture and can dominate a small cutout.
    const inset = Math.max(2, Math.round(Math.min(pw, ph) * .06));
    if ([[-inset, 0], [inset, 0], [0, -inset], [0, inset], [-inset, -inset], [inset, inset], [-inset, inset], [inset, -inset]].some(([dx, dy]) => x + dx < left || x + dx > right || y + dy < top || y + dy > bottom || piece.data[((y + dy) * piece.width + x + dx) * 4 + 3] < 200)) continue;
    const value = gray(piece.data, offset); points.push([x - left, y - top, value]); sum += value; squares += value * value;
  }
  const count = points.length, mean = sum / count, variance = squares - sum * sum / count;
  if (count < 20 || variance / count < 12) throw new TaskError('UNCERTAIN_IMAGE', 'The piece has too little texture to locate reliably.');
  for (const point of points) point[2] -= mean;
  const pixels = new Float32Array(width * height);
  for (let i = 0; i < pixels.length; i++) pixels[i] = gray(data, i * 4);
  const knownY = options.y === undefined ? null : Math.round(options.y * height) + top;
  const minY = knownY === null ? 0 : Math.max(0, knownY - 4), maxY = knownY === null ? height - ph : Math.min(height - ph, knownY + 4);
  if (minY > maxY) throw new TaskError('INVALID_TASK', 'The piece vertical position is outside the background.');
  const score = (x, y) => {
    let total = 0, sq = 0, dot = 0;
    for (const [px, py, value] of points) { const b = pixels[(y + py) * width + x + px]; total += b; sq += b * b; dot += b * value; }
    const spread = sq - total * total / count;
    return spread > count * 2 ? dot / Math.sqrt(spread * variance) : -1;
  };
  let best = { score: -1, x: 0, y: 0 }; const candidates = [];
  const step = knownY === null ? 2 : 1;
  for (let y = minY; y <= maxY; y += step) for (let x = 0; x <= width - pw; x += step) {
    const candidate = { x, y, score: score(x, y) };
    if (candidate.score > best.score) best = candidate;
    candidates.push(candidate);
  }
  const center = best;
  for (let y = Math.max(minY, center.y - step); y <= Math.min(maxY, center.y + step); y++) for (let x = Math.max(0, center.x - step); x <= Math.min(width - pw, center.x + step); x++) {
    const candidate = { x, y, score: score(x, y) }; if (candidate.score > best.score) best = candidate;
    candidates.push(candidate);
  }
  const alternative = candidates.reduce((value, candidate) => Math.hypot(candidate.x - best.x, candidate.y - best.y) > Math.max(6, pw * .2) ? Math.max(value, candidate.score) : value, -1);
  const separation = Math.max(0, best.score - alternative);
  let confidence = Math.max(0, Math.min(1, best.score)) * Math.min(1, separation / .12), method = 'texture';
  // Dark puzzle holes can replace, rather than merely dim, the original
  // texture. Corroborate an uncertain texture position with the alpha outline.
  // A rotated distractor has the wrong boundary even when its color matches.
  if (confidence < .9 && best.score < .9) {
    const opaque = (x, y) => x >= 0 && y >= 0 && x < piece.width && y < piece.height && piece.data[(y * piece.width + x) * 4 + 3] >= 200;
    const edges = [];
    for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) if (opaque(x, y)) {
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (!opaque(x + dx, y + dy) && opaque(x - dx * 4, y - dy * 4)) edges.push([x - left, y - top, dx, dy]);
    }
    if (edges.length >= 24) {
      const outlines = candidates.map(candidate => {
        let contrast = 0, positive = 0, count = 0;
        for (const [px, py, dx, dy] of edges) {
          const ox = candidate.x + px + dx * 3, oy = candidate.y + py + dy * 3, ix = candidate.x + px - dx * 4, iy = candidate.y + py - dy * 4;
          if (ox < 0 || oy < 0 || ox >= width || oy >= height || ix < 0 || iy < 0 || ix >= width || iy >= height) continue;
          const delta = pixels[oy * width + ox] - pixels[iy * width + ix]; contrast += delta; positive += delta > 8 ? 1 : 0; count++;
        }
        return { ...candidate, contrast: count ? contrast / count : 0, agreement: count ? positive / count : 0 };
      }).sort((a, b) => b.contrast - a.contrast);
      const outline = outlines[0], other = outlines.find(candidate => Math.hypot(candidate.x - outline.x, candidate.y - outline.y) > Math.max(6, pw * .2));
      const certainty = outline.agreement * Math.min(1, outline.contrast / 20) * Math.min(1, Math.max(0, outline.contrast - (other?.contrast || 0)) / 12);
      // Two signals must agree on the same location before a shape match may
      // authorize a drag. Flat masks and competing outlines stay uncertain.
      if (certainty > confidence && separation > .05 && Math.hypot(outline.x - best.x, outline.y - best.y) <= Math.max(6, pw * .12) && best.score >= .3) {
        best = outline; confidence = certainty; method = 'texture-and-outline';
      }
    }
  }
  const x = best.x - left, y = best.y - top;
  if (x < 0 || y < -4) throw new TaskError('UNCERTAIN_IMAGE', 'The predicted piece position is outside the background.');
  return { x, y: Math.max(0, y), width: piece.width, height: piece.height, pieceBounds: { left, top, width: pw, height: ph }, backgroundWidth: width, backgroundHeight: height, normalizedX: x / width, normalizedY: Math.max(0, y) / height, confidence, correlation: best.score, separation, method };
}
