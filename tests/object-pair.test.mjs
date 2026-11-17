import test from 'node:test';
import assert from 'node:assert/strict';
import { locateObjectPair } from '../server/object-pair.mjs';

test('object-pair fast path locates two separated shapes and refuses ambiguous scenes', () => {
  const width = 300, height = 60, data = Buffer.alloc(width * height * 4, 255);
  const fill = left => { for (let y = 5; y < 55; y++) for (let x = left; x < left + 50; x++) { const offset = (y * width + x) * 4; data[offset] = 30; data[offset + 1] = 90; data[offset + 2] = 160; } };
  assert.equal(locateObjectPair({ data, width, height }), null);
  fill(5); assert.equal(locateObjectPair({ data, width, height }), null);
  fill(155); const result = locateObjectPair({ data, width, height });
  assert.equal(result.points.length, 2); assert.ok(Math.abs((result.points[1].x - result.points[0].x) * width - 150) < .01);
  assert.ok(result.confidence >= .8);
  fill(230); assert.equal(locateObjectPair({ data, width, height }), null);
});

function scene(rectangles) {
  const width = 300, height = 80, data = Buffer.alloc(width * height * 4, 255);
  for (const [left, top, w, h] of rectangles) for (let y = top; y < top + h; y++) for (let x = left; x < left + w; x++) {
    const offset = (y * width + x) * 4; data[offset] = 30; data[offset + 1] = 90; data[offset + 2] = 160;
  }
  return { data, width, height };
}

test('vertical fragments and a narrow extra object cannot masquerade as exactly two objects', () => {
  assert.equal(locateObjectPair(scene([[10, 10, 50, 20], [10, 45, 50, 20], [155, 10, 50, 55]])), null);
  assert.equal(locateObjectPair(scene([[10, 10, 50, 55], [155, 10, 50, 55], [230, 15, 5, 40]])), null);
});

test('border-touching icons and enclosed details keep their original foreground-region coordinates', () => {
  const sample = scene([[0, 0, 50, 55], [155, 0, 50, 55], [100, 70, 1, 1]]);
  // A foreground pupil surrounded by white is a disconnected component, but
  // belongs to the enclosing icon rather than becoming a third object.
  for (let y = 15; y < 29; y++) for (let x = 15; x < 29; x++) {
    const offset = (y * sample.width + x) * 4;
    if (x < 17 || x > 26 || y < 17 || y > 26) sample.data.fill(255, offset, offset + 4);
  }
  const result = locateObjectPair(sample);
  assert.equal(result?.points.length, 2);
  assert.equal(result.points[0].x, 24.5 / sample.width); assert.equal(result.points[0].y, 27 / sample.height);
  assert.equal(result.points[1].x, 179.5 / sample.width); assert.ok(result.confidence >= .85);
});

test('object-pair rejects malformed pixel buffers and fractional dimensions', () => {
  assert.equal(locateObjectPair({ data: Buffer.alloc(20), width: 300, height: 80 }), null);
  const sample = scene([[10, 10, 50, 55], [155, 10, 50, 55]]);
  assert.equal(locateObjectPair({ ...sample, width: 300.5 }), null);
});
