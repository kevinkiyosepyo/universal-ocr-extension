import test from 'node:test';
import assert from 'node:assert/strict';
import { codeConsensus } from '../server/text-code.mjs';

test('text code agreement preserves case and does not reward a confident but shortened reading', () => {
  assert.equal(codeConsensus(['JMKR', 'JMKR']).text, 'JMKR');
  assert.equal(codeConsensus(['JMKR', 'JMkR']).confidence, 0);
  assert.equal(codeConsensus(['JMR', 'JMKR', 'JMKR']).text, 'JMKR');
  assert.equal(codeConsensus(['JMR', 'JMR'], 4).confidence, 0);
  assert.equal(codeConsensus(['mP7k', 'mP7k']).text, 'mP7k');
});
test('text code disagreement and malformed model output stay uncertain', () => {
  for (const readings of [['ABC', 'ABD', 'ABE'], ['Read this: ABC', 'Read this: ABC'], ['ABC\nDEF', 'ABC\nDEF'], ['', ''], [null, undefined]]) assert.equal(codeConsensus(readings).confidence, 0);
});
