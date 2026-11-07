import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorker } from 'tesseract.js';
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import { recognitionParameters, cleanText } from '../src/settings.js';

test('real bundled OCR recognizes printed text and numeric codes without a remote model', { timeout: 60_000 }, async () => {
  const worker = await createWorker('eng', 1, {
    langPath: fileURLToPath(new URL('../node_modules/@tesseract.js-data/eng/4.0.0_best_int/', import.meta.url)),
    cacheMethod: 'none',
  });
  try {
    for (const fixture of [
      { text: 'HELLO OCR 4827', settings: { mode: 'line' } },
      { text: '572948', settings: { mode: 'line', characters: 'digits', removeSpaces: true } },
    ]) {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="170"><rect width="100%" height="100%" fill="white"/><text x="35" y="110" font-family="Arial, sans-serif" font-size="70" fill="black">${fixture.text}</text></svg>`;
      const image = await sharp(Buffer.from(svg)).png().toBuffer();
      await worker.setParameters(recognitionParameters(fixture.settings));
      const { data } = await worker.recognize(image);
      assert.equal(cleanText(data.text, fixture.settings), fixture.text);
      assert.ok(data.confidence > 80, `Confidence: ${data.confidence}`);
    }
  } finally { await worker.terminate(); }
});
