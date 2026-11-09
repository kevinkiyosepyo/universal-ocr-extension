import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import sharp from 'sharp';
import { createSolverServer } from '../server/app.mjs';
import { SolverClient } from '../shared/client.js';

const model = process.env.OCR_TEXT_MODEL || 'glm-ocr:q8_0';
const key = randomBytes(32).toString('hex');
const { server } = createSolverServer({ key, model: 'qwen3-vl:4b-instruct', textModel: model, ollamaEndpoint: process.env.OCR_OLLAMA_ENDPOINT || 'http://127.0.0.1:11435' });
server.listen(0, '127.0.0.1'); await once(server, 'listening');
const client = new SolverClient({ key, endpoint: `http://127.0.0.1:${server.address().port}` });
const cases = [['JMKR', await readFile('tests/fixtures/text-jmkr.png')]];
for (const code of ['K7P4XR', 'mP7k', '82AH']) cases.push([code, await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="300" height="100"><rect width="300" height="100" fill="#f0efda"/><text x="25" y="70" font-family="Arial" font-size="54">${code}</text></svg>`)).png().toBuffer()]);
const report = [];
try {
  for (const [expected, image] of cases) {
    const started = performance.now();
    const result = await client.solve({ type: 'captcha-text', image: image.toString('base64') });
    const row = { expected, result, model, elapsedMs: Math.round(performance.now() - started) };
    report.push(row); console.log(JSON.stringify(row));
    assert.equal(result.text, expected); assert.ok(result.confidence >= .8); assert.equal(result.confidenceBasis, 'variant-agreement');
  }
} finally {
  await mkdir('output/text-code', { recursive: true });
  await writeFile('output/text-code/report.json', JSON.stringify(report, null, 2) + '\n');
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
