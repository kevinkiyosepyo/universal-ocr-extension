import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { pixels } from '../server/algorithms.mjs';
import { matchPuzzle } from '../server/puzzle.mjs';
import { validateTask } from '../shared/protocol.js';

async function fixture({ dim = false, padded = false } = {}) {
  const width = 320, height = 160, data = Buffer.alloc(width * height * 4);
  // A deterministic textured scene, with no marker encoding the answer.
  let seed = 91731;
  for (let i = 0; i < data.length; i += 4) { seed = (1664525 * seed + 1013904223) >>> 0; data[i] = seed >>> 24; data[i + 1] = seed >>> 16 & 255; data[i + 2] = seed >>> 8 & 255; data[i + 3] = 255; }
  const base = await sharp(data, { raw: { width, height, channels: 4 } }).blur(1).png().toBuffer();
  const crop = { left: 173, top: 48, width: 47, height: 51 };
  let piece = await sharp(base).extract(crop).ensureAlpha().raw().toBuffer();
  for (let y = 0; y < crop.height; y++) for (let x = 0; x < crop.width; x++) if ((x < 6 && y < 13) || (x > 35 && y > 37)) piece[(y * crop.width + x) * 4 + 3] = 0;
  piece = await sharp(piece, { raw: { width: crop.width, height: crop.height, channels: 4 } }).png().toBuffer();
  const image = dim ? await sharp(base).composite([{ input: await sharp(piece).modulate({ brightness: .35 }).png().toBuffer(), left: crop.left, top: crop.top }]).png().toBuffer() : base;
  if (padded) piece = await sharp(piece).extend({ left: 11, top: 8, right: 19, bottom: 12, background: '#0000' }).png().toBuffer();
  return { image: await pixels(image.toString('base64'), 0), piece: await pixels(piece.toString('base64'), 0), expected: { x: crop.left - (padded ? 11 : 0), y: crop.top - (padded ? 8 : 0) } };
}
test('puzzle matching locates a darkened cutout and preserves transparent padding coordinates', async () => {
  for (const options of [{}, { dim: true }, { dim: true, padded: true }]) {
    const sample = await fixture(options), result = matchPuzzle(sample.image, sample.piece, { y: sample.expected.y / sample.image.height });
    assert.equal(result.x, sample.expected.x); assert.equal(result.y, sample.expected.y); assert.ok(result.confidence > .8, JSON.stringify(result));
  }
});
test('puzzle matching searches both axes and rejects uninformative references', async () => {
  const sample = await fixture({ dim: true }); const result = matchPuzzle(sample.image, sample.piece);
  assert.equal(result.x, sample.expected.x); assert.equal(result.y, sample.expected.y);
  const flat = { width: 20, height: 20, data: Buffer.alloc(20 * 20 * 4, 255) };
  assert.throws(() => matchPuzzle(sample.image, flat), /little texture/);
  assert.throws(() => matchPuzzle(sample.image, sample.piece, { y: 1 }), error => error.code === 'INVALID_TASK' && /outside the background/.test(error.message));
  assert.throws(() => validateTask({ type: 'puzzle', image: 'AAAA', reference: 'AAAA', y: 9 }), /normalized/);
});

function repeatedLogoFixture({ contours = [135], unrelated = false, padding = 3 } = {}) {
  const width = 310, height = 160, pieceWidth = 60 + padding - 3, pieceHeight = height, top = 61;
  const image = { width, height, data: Buffer.alloc(width * height * 4) };
  const piece = { width: pieceWidth, height: pieceHeight, data: Buffer.alloc(pieceWidth * pieceHeight * 4) };
  const texture = (x, y) => 112 + 38 * Math.sin(x * Math.PI * 2 / 70) + 26 * Math.cos((x + y) * Math.PI * 2 / 35) + 18 * Math.sin(y * .27);
  const mask = (x, y) => ((x >= 5 && x <= 45 && y >= 9 && y <= 48) || ((x - 25) ** 2 + (y - 9) ** 2 <= 8 ** 2) || ((x - 45) ** 2 + (y - 29) ** 2 <= 8 ** 2)) && (x - 5) ** 2 + (y - 28) ** 2 > 7 ** 2;
  const boundary = (x, y) => mask(x, y) && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => !mask(x + dx, y + dy));
  const write = (target, x, y, value) => { const offset = (y * target.width + x) * 4; target.data[offset] = target.data[offset + 1] = target.data[offset + 2] = Math.round(value); target.data[offset + 3] = 255; };
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) write(image, x, y, texture(x, y));
  for (let y = 0; y < 54; y++) for (let x = 0; x < 55; x++) if (mask(x, y)) write(piece, x + padding, y + top, texture(x + 135, y + top));
  for (const origin of contours) for (let y = 0; y < 54; y++) for (let x = 0; x < 55; x++) if (mask(x, y)) {
    const value = unrelated ? 80 + 25 * Math.cos(x * 1.7 + y * .9) : texture(x + origin, y + top) * .45;
    write(image, x + origin, y + top, boundary(x, y) ? 245 : value);
  }
  return { image, piece, expected: 135 - padding };
}

test('an independent cutout contour resolves repeated high-correlation logo textures', () => {
  for (const padding of [3, 11]) {
    const sample = repeatedLogoFixture({ padding }), result = matchPuzzle(sample.image, sample.piece, { y: 0 });
    assert.equal(result.x, sample.expected, JSON.stringify(result)); assert.equal(result.y, 0);
    assert.equal(result.normalizedX, sample.expected / sample.image.width);
    assert.equal(result.method, 'texture-and-contour'); assert.ok(result.confidence >= .85, JSON.stringify(result));
  }
});

test('repeated textures stay uncertain without one independently corroborated contour', () => {
  for (const options of [{ contours: [] }, { contours: [65, 135] }, { unrelated: true }]) {
    const sample = repeatedLogoFixture(options);
    let result;
    try { result = matchPuzzle(sample.image, sample.piece, { y: 0 }); }
    catch (error) { assert.equal(error.code, 'UNCERTAIN_IMAGE'); continue; }
    assert.ok(result.confidence < .85, `${JSON.stringify(options)}: ${JSON.stringify(result)}`);
  }
});
