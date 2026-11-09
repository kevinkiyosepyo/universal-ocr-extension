import test from 'node:test';
import assert from 'node:assert/strict';
import { matchRingRotation } from '../server/ring-rotation.mjs';

const desktopRatio = 128 / 210, narrowRatio = 105 / 170;
const scene = (x, y) => [128 + 45 * Math.sin(23 * x + 19 * y + .6) + 30 * Math.cos(7 * x - 27 * y),
  128 + 45 * Math.cos(29 * x + 11 * y + .3) + 30 * Math.sin(17 * x - 19 * y),
  128 + 45 * Math.sin(13 * x + 31 * y + 1.2) + 30 * Math.cos(23 * x - 7 * y)];

function render(size, scale, rotation = 0, color = scene) {
  const data = Buffer.alloc(size * size * 4), angle = rotation * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = ((x + .5) / size - .5) * scale, dy = ((y + .5) / size - .5) * scale;
    const rgb = color(dx * cos + dy * sin, dy * cos - dx * sin), i = (y * size + x) * 4;
    for (let c = 0; c < 3; c++) data[i + c] = Math.round(rgb[c]);
    data[i + 3] = 255;
  }
  return { width: size, height: size, data };
}
const uncertain = error => error.code === 'UNCERTAIN_IMAGE';
const angularError = (a, b) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));

test('ring boundary comparison recovers clockwise relative rotation at both SDK diameter ratios', () => {
  for (const ratio of [desktopRatio, narrowRatio]) {
    const outer = render(210, 1, 17);
    for (const correction of [0, .5, 37, 91.5, 180, 271, 359.5]) {
      const result = matchRingRotation(outer, render(160, ratio, 17 - correction), ratio);
      assert.ok(angularError(result.clockwiseDegrees, correction) <= .5, JSON.stringify({ correction, ratio, result }));
      assert.equal(result.normalizedDrag, result.clockwiseDegrees / 360);
      assert.ok(result.confidence >= .85, JSON.stringify(result));
    }
  }
});

test('ring comparison uses displayed ratio with independent source resolutions and tolerates small pixel noise', () => {
  const outer = render(480, 1, -13), inner = render(257, desktopRatio, 102);
  for (let i = 0; i < inner.data.length; i += 4) for (let c = 0; c < 3; c++) inner.data[i + c] += (i + c) % 3 - 1;
  const result = matchRingRotation(outer, inner, desktopRatio);
  assert.ok(angularError(result.clockwiseDegrees, 245) <= .5, JSON.stringify(result));
});

test('flat, radial, and periodically repeating ring boundaries abstain', () => {
  const patterns = [() => [127, 80, 220], (x, y) => Array(3).fill(100 + 100 * Math.hypot(x, y)),
    (x, y) => { const a = Math.atan2(y, x) * 4; return [128 + 65 * Math.sin(a), 128 + 65 * Math.cos(a), 128 + 45 * Math.sin(2 * a)]; }];
  for (const pattern of patterns) assert.throws(() => matchRingRotation(render(210, 1, 0, pattern), render(128, desktopRatio, 37, pattern), desktopRatio), uncertain);
});

test('unrelated textures and hidden RGB cannot claim a ring match', () => {
  const outer = render(210, 1), unrelated = render(128, desktopRatio, 80, (x, y) => scene(x + .29, y - .37));
  assert.throws(() => matchRingRotation(outer, unrelated, desktopRatio), uncertain);
  const hidden = render(128, desktopRatio);
  for (let i = 3; i < hidden.data.length; i += 4) hidden.data[i] = 0;
  assert.throws(() => matchRingRotation(outer, hidden, desktopRatio), uncertain);
});

test('ring matching rejects missing geometry and non-square source images', () => {
  const outer = render(210, 1), inner = render(128, desktopRatio);
  for (const ratio of [undefined, NaN, 0, .1, 1, Infinity]) assert.throws(() => matchRingRotation(outer, inner, ratio), error => error.code === 'INVALID_TASK');
  assert.throws(() => matchRingRotation(outer, { ...inner, height: 100 }, desktopRatio), error => error.code === 'INVALID_TASK');
  const wide = matchRingRotation(outer, render(192, .9, 60), .9);
  assert.ok(angularError(wide.clockwiseDegrees, 300) <= .5);
});
