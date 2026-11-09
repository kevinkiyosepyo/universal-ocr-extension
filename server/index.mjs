import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createSolverServer } from './app.mjs';

const dir = fileURLToPath(new URL('../.local/', import.meta.url));
await mkdir(dir, { recursive: true, mode: 0o700 });
const keyFile = `${dir}/api-key`;
let key = process.env.OCR_API_KEY;
if (!key) {
  try { key = (await readFile(keyFile, 'utf8')).trim(); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    key = randomBytes(32).toString('hex'); await writeFile(keyFile, `${key}\n`, { mode: 0o600, flag: 'wx' });
  }
}
const port = Number(process.env.OCR_PORT || 47821);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('OCR_PORT must be between 1024 and 65535.');
const { server } = createSolverServer({ key, model: process.env.OCR_VISION_MODEL || 'qwen3-vl:4b-instruct', textModel: process.env.OCR_TEXT_MODEL ?? 'glm-ocr:q8_0', ollamaEndpoint: process.env.OCR_OLLAMA_ENDPOINT || 'http://127.0.0.1:11435', concurrency: 2 });
server.listen(port, '127.0.0.1', () => {
  console.log(`Local solver: http://127.0.0.1:${port}`);
  console.log(`API key: stored in ${keyFile}. Copy its contents into extension Settings.`);
  console.log('Text, template matching, rotation, and proof-of-work are ready. Visual reasoning uses the configured local Ollama model.');
});
for (const event of ['SIGINT', 'SIGTERM']) process.on(event, () => { server.close(); server.closeAllConnections(); });
