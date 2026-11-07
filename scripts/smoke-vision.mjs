import assert from 'node:assert/strict';
import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';
import { createSolverServer } from '../server/app.mjs';
import { SolverClient } from '../shared/client.js';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
const config = { model: process.env.OCR_VISION_MODEL || 'qwen3-vl:4b-instruct', ollamaEndpoint: process.env.OCR_OLLAMA_ENDPOINT || 'http://127.0.0.1:11435' };
const report = [];

const shapes = [0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => { const x = i % 3 * 200, y = Math.floor(i / 3) * 200; return `<rect x="${x}" y="${y}" width="200" height="200" fill="white" stroke="#555" stroke-width="4"/>${[0, 4, 8].includes(i) ? `<circle cx="${x + 100}" cy="${y + 100}" r="60" fill="#e02020"/>` : `<rect x="${x + 40}" y="${y + 40}" width="120" height="120" fill="#2050d0"/>`}`; }).join('');
const grid = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600">${shapes}</svg>`)).png().toBuffer();
const object = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><rect width="600" height="400" fill="white"/><circle cx="150" cy="200" r="60" fill="#e02020"/><rect x="400" y="80" width="120" height="100" fill="#2050d0"/></svg>')).png().toBuffer();
await mkdir('output/vision', { recursive: true }); await writeFile('output/vision/grid.png', grid); await writeFile('output/vision/objects.png', object);
const key = randomBytes(32).toString('hex');
const { server } = createSolverServer({ ...config, key }); server.listen(0, '127.0.0.1'); await once(server, 'listening');
const client = new SolverClient({ endpoint: `http://127.0.0.1:${server.address().port}`, key });
try {
for (const task of [{ type: 'grid', image: grid.toString('base64'), rows: 3, columns: 3, prompt: 'Select every cell containing a red circle.' }, { type: 'points', image: object.toString('base64'), prompt: 'Find the center of the red circle.' }, { type: 'bbox', image: object.toString('base64'), prompt: 'Find the bounding box of the blue rectangle.' }]) {
  const started = Date.now(); const result = await client.solve(task);
  if (task.type === 'grid') assert.deepEqual(result.selected, [0, 4, 8]);
  if (task.type === 'points') { assert.equal(result.points.length, 1); assert.ok(Math.abs(result.points[0].x - .25) < .08 && Math.abs(result.points[0].y - .5) < .08); }
  if (task.type === 'bbox') { assert.equal(result.boxes.length, 1); const b = result.boxes[0]; assert.ok(Math.abs(b.x - 2 / 3) < .1 && Math.abs(b.y - .2) < .1 && Math.abs(b.width - .2) < .1 && Math.abs(b.height - .25) < .1); }
  report.push({ type: task.type, model: config.model, elapsedMs: Date.now() - started, result }); console.log(JSON.stringify(report.at(-1)));
}
await writeFile('output/vision/report.json', JSON.stringify(report, null, 2) + '\n');

} finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
