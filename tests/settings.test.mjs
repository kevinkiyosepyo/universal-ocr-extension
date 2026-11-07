import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeSettings, recognitionParameters, cleanText, DEFAULTS } from '../src/settings.js';

test('untrusted stored settings cannot select external models or inject configuration', () => {
  assert.deepEqual(sanitizeSettings({ language: '../../remote', mode: '99', processing: 'eval', characters: 'other', removeSpaces: 'false' }), DEFAULTS);
  assert.equal(sanitizeSettings({ language: '__proto__' }).language, 'eng');
  assert.deepEqual(sanitizeSettings(null), DEFAULTS);
  assert.equal(sanitizeSettings({ whitelist: 'a'.repeat(1000) }).whitelist.length, 256);
});
test('code recognition constrains characters and resets the whitelist on the next run', () => {
  assert.equal(recognitionParameters({ characters: 'digits', mode: 'line' }).tessedit_char_whitelist, '0123456789');
  assert.equal(recognitionParameters({ characters: 'all' }).tessedit_char_whitelist, '');
  assert.equal(recognitionParameters({ characters: 'custom', whitelist: 'AB12' }).tessedit_char_whitelist, 'AB12');
});
test('document whitespace is preserved unless removing spaces is explicitly selected', () => {
  assert.equal(cleanText('  Hello  world\r\nNext line\n', { removeSpaces: false }), 'Hello  world\nNext line');
  assert.equal(cleanText(' 12 34\n56\t', { removeSpaces: true }), '123456');
  assert.equal(cleanText('안녕 세계\n', { removeSpaces: false }), '안녕 세계');
});
