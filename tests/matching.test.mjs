import test from 'node:test';
import assert from 'node:assert/strict';
import { matchRotation, matchTemplate } from '../server/algorithms.mjs';

function angularImage(width = 200, height = width, rotation = 0, symmetry = 1) {
  const data = Buffer.alloc(width * height * 4), scale = Math.min(width, height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const dx = (x - (width - 1) / 2) / scale, dy = (y - (height - 1) / 2) / scale;
    const angle = (Math.atan2(dy, dx) - rotation * Math.PI / 180) * symmetry, radius = Math.hypot(dx, dy), i = (y * width + x) * 4;
    data[i] = Math.round(127 + (40 * Math.sin(angle) + 50 * Math.cos(3 * angle)) * (.5 + radius));
    data[i + 1] = Math.round(127 + (55 * Math.sin(2 * angle) + 35 * Math.cos(7 * angle)) * (.5 + radius));
    data[i + 2] = Math.round(127 + (55 * Math.cos(5 * angle) + 25 * Math.sin(11 * angle)) * (.5 + radius));
    data[i + 3] = 255;
  }
  return { width, height, data };
}
const uncertain = error => error.code === 'UNCERTAIN_IMAGE';

test('rotation recovers distinct angles across zero and independently sized images', () => {
  const reference = angularImage(200);
  for (const degrees of [0, 1, 37, 90, 179, 270, 359]) {
    const result = matchRotation(angularImage(201, 197, degrees), reference);
    const error = Math.abs(result.clockwiseDegrees - ((360 - degrees) % 360));
    assert.ok(Math.min(error, 360 - error) <= 1, JSON.stringify({ degrees, result }));
    assert.ok(result.confidence > .9, JSON.stringify(result));
  }
});

test('flat images and concentric bands cannot establish a rotation', () => {
  const flat = angularImage(100);
  for (let i = 0; i < flat.data.length; i += 4) { flat.data[i] = flat.data[i + 1] = flat.data[i + 2] = 127; }
  assert.throws(() => matchRotation(flat, flat), uncertain);
  const rings = angularImage(200);
  for (let y = 0; y < rings.height; y++) for (let x = 0; x < rings.width; x++) {
    const color = Math.round(255 * Math.hypot(x - 99.5, y - 99.5) / 142), i = (y * rings.width + x) * 4;
    rings.data[i] = rings.data[i + 1] = rings.data[i + 2] = color;
  }
  assert.throws(() => matchRotation(rings, rings), uncertain);
});

test('repeating angular patterns reject equally valid orientations', () => {
  for (const symmetry of [2, 4]) assert.throws(() => matchRotation(angularImage(200, 200, 37, symmetry), angularImage(200, 200, 0, symmetry)), uncertain);
});

test('rotation ignores hidden RGB and rejects malformed tiny inputs', () => {
  const hidden = angularImage(); for (let i = 3; i < hidden.data.length; i += 4) hidden.data[i] = 0;
  assert.throws(() => matchRotation(hidden, hidden), uncertain);
  assert.throws(() => matchRotation({ width: 1, height: 1, data: Buffer.alloc(4) }, angularImage()), error => error.code === 'INVALID_TASK');
});

function texturedImage(width = 160, height = 100) {
  const data = Buffer.alloc(width * height * 4); let seed = 5173;
  for (let i = 0; i < data.length; i += 4) { seed = (1664525 * seed + 1013904223) >>> 0; data[i] = seed >>> 24; data[i + 1] = seed >>> 16 & 255; data[i + 2] = seed >>> 8 & 255; data[i + 3] = 255; }
  return { width, height, data };
}
function cut(image, x, y, width, height) {
  const data = Buffer.alloc(width * height * 4);
  for (let row = 0; row < height; row++) image.data.copy(data, row * width * 4, ((y + row) * image.width + x) * 4, ((y + row) * image.width + x + width) * 4);
  return { width, height, data };
}
function paste(image, piece, x, y) {
  for (let row = 0; row < piece.height; row++) piece.data.copy(image.data, ((y + row) * image.width + x) * 4, row * piece.width * 4, (row + 1) * piece.width * 4);
}

test('template matching preserves exact odd-pixel coordinates', () => {
  const image = texturedImage(), piece = cut(image, 37, 19, 26, 21), result = matchTemplate(image, piece);
  assert.equal(result.x, 37); assert.equal(result.y, 19); assert.equal(result.confidence, 1);
});

test('template matching retains exhaustive fallback when no exact RGB anchors match', () => {
  const image = texturedImage(), piece = cut(image, 37, 19, 26, 21);
  for (let i = 0; i < piece.data.length; i += 4) piece.data[i] += piece.data[i] < 254 ? 2 : -2;
  const result = matchTemplate(image, piece);
  assert.equal(result.x, 37); assert.equal(result.y, 19); assert.ok(result.confidence > .98);
});

test('flat pieces and repeated matches on different sampling phases stay uncertain', () => {
  const image = texturedImage(), flat = { width: 26, height: 21, data: Buffer.alloc(26 * 21 * 4, 255) };
  assert.throws(() => matchTemplate(image, flat), uncertain);
  const piece = cut(image, 37, 19, 26, 21); paste(image, piece, 86, 53);
  assert.throws(() => matchTemplate(image, piece), uncertain);
  // A tiny change to one repeated copy must not turn ambiguity into certainty.
  image.data[(53 * image.width + 86) * 4] ^= 1;
  assert.throws(() => matchTemplate(image, piece), uncertain);
});

test('transparent background RGB cannot establish a template match', () => {
  const image = texturedImage(), piece = cut(image, 37, 19, 26, 21);
  for (let i = 3; i < image.data.length; i += 4) image.data[i] = 0;
  assert.throws(() => matchTemplate(image, piece), uncertain);
});
