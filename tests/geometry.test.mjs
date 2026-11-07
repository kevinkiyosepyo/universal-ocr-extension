import test from 'node:test';
import assert from 'node:assert/strict';
import { pixelCrop, selectionRect, scaledSize, estimateTextScale, MAX_PIXELS } from '../src/geometry.js';

test('screenshot crop uses actual pixel dimensions, including fractional zoom', () => {
  assert.deepEqual(pixelCrop({ x: 40, y: 20, width: 100, height: 50 }, { width: 800, height: 600 }, { width: 1600, height: 1200 }), { x: 80, y: 40, width: 200, height: 100 });
  assert.deepEqual(pixelCrop({ x: 10.4, y: 20.4, width: 40.2, height: 10.2 }, { width: 100, height: 100 }, { width: 125, height: 125 }), { x: 13, y: 25, width: 51, height: 14 });
});
test('reverse drags and page boundaries produce a valid selection', () => {
  assert.deepEqual(selectionRect({ x: 90, y: 80 }, { x: -10, y: 200 }, { width: 100, height: 100 }), { x: 0, y: 80, width: 90, height: 20 });
  assert.deepEqual(pixelCrop({ x: 90, y: 90, width: 30, height: 40 }, { width: 100, height: 100 }, { width: 200, height: 200 }), { x: 180, y: 180, width: 20, height: 20 });
});
test('invalid and out-of-image crop geometry is rejected', () => {
  for (const crop of [{ x: NaN, y: 0, width: 10, height: 10 }, { x: 0, y: 0, width: -10, height: 10 }, { x: 110, y: 0, width: 10, height: 10 }]) {
    assert.throws(() => pixelCrop(crop, { width: 100, height: 100 }, { width: 100, height: 100 }));
  }
  assert.throws(() => pixelCrop({ x: 0, y: 0, width: 10, height: 10 }, { width: 0, height: 100 }, { width: 100, height: 100 }));
});
test('large images are bounded, while small text is enlarged', () => {
  for (const [width, height] of [[8000, 8000], [100, 80000], [80000, 100], [4500, 4500], [1000, 100]]) {
    const size = scaledSize(width, height);
    assert.ok((size.width + 48) * (size.height + 48) <= MAX_PIXELS, JSON.stringify(size));
    assert.ok(size.width <= 8192 && size.height <= 8192);
  }
  assert.deepEqual(scaledSize(300, 80, 24, 3), { width: 900, height: 240 });
  assert.throws(() => scaledSize(0, 10));
});

test('large glyphs shrink instead of becoming less recognizable after enlargement', () => {
  const width = 400, height = 200;
  const pixels = new Uint8ClampedArray(width * height * 4).fill(255);
  for (let y = 40; y < 140; y++) for (let x = 60; x < 150; x++) {
    const index = (y * width + x) * 4;
    pixels[index] = pixels[index + 1] = pixels[index + 2] = 0;
  }
  assert.equal(estimateTextScale(pixels, width, height), 0.42);
  assert.equal(estimateTextScale(new Uint8ClampedArray(width * height * 4).fill(255), width, height), 1);
});
