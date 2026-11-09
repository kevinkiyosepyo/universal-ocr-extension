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
