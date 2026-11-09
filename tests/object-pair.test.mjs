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
