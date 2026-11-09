import { spawn } from 'node:child_process';
import { mkdir, open, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { setTimeout as pause } from 'node:timers/promises';
import sharp from 'sharp';
import { SolverClient } from '../shared/client.js';
import { inferVision } from '../server/vision.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const local = fileURLToPath(new URL('../.local/', import.meta.url));
const model = process.env.OCR_VISION_MODEL || 'qwen3-vl:4b-instruct';
const visionURL = process.env.OCR_OLLAMA_ENDPOINT || 'http://127.0.0.1:11435';
const endpoint = `http://127.0.0.1:${process.env.OCR_PORT || 47821}`;
const children = new Set(); let stopping = false;
await mkdir(local, { recursive: true, mode: 0o700 });
async function json(url, options = {}) { const response = await fetch(url, { signal: AbortSignal.timeout(2500), redirect: 'error', ...options }); if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json(); }
async function visionReady() { try { return typeof (await json(new URL('/api/version', visionURL))).version === 'string'; } catch { return false; } }
function shutdown(code = 0) {
  if (stopping) return; stopping = true;
  for (const child of children) child.kill('SIGTERM');
  const timeout = setTimeout(() => { for (const child of children) if (child.exitCode === null) child.kill('SIGKILL'); process.exit(code); }, 2000);
  if (!children.size) { clearTimeout(timeout); process.exitCode = code; }
}
function launch(command, args, options = {}) {
  const child = spawn(command, args, { cwd: root, stdio: 'inherit', ...options }); children.add(child);
  child.on('error', error => { console.error(`Unable to start ${command}: ${error.message}`); shutdown(1); });
  child.on('exit', code => { children.delete(child); if (!stopping) { console.error(`${command} stopped (${code ?? 'signal'}).`); shutdown(1); } else if (!children.size) process.exitCode ||= code || 0; });
  return child;
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => shutdown());
try {
  if (!await visionReady()) {
    if (visionURL !== 'http://127.0.0.1:11435') throw new Error('Start the configured Ollama endpoint before running this command.');
    const log = await open(local + 'vision.log', 'a', 0o600);
    launch('ollama', ['serve'], { stdio: ['ignore', log.fd, log.fd], env: { ...process.env, OLLAMA_HOST: '127.0.0.1:11435', OLLAMA_MODELS: local + 'models', OLLAMA_NO_CLOUD: '1', OLLAMA_FLASH_ATTENTION: process.env.OLLAMA_FLASH_ATTENTION || '0', OLLAMA_NUM_PARALLEL: '1', OLLAMA_MAX_LOADED_MODELS: '1', OLLAMA_KEEP_ALIVE: '15m' } });
    await log.close();
    let ready = false;
    for (let attempt = 0; attempt < 40 && !stopping; attempt++) { if (await visionReady()) { ready = true; break; } await pause(250); }
    if (!ready) throw new Error('Ollama did not start. Install Ollama, or inspect .local/vision.log.');
  }
  const tags = await json(new URL('/api/tags', visionURL));
  if (!tags.models?.some(item => item.name === model)) {
    if (!process.argv.includes('--setup')) throw new Error('The model is not downloaded. Run npm run setup:local once.');
    console.log(`Downloading ${model}. The default model is about 3.3 GB; this is a one-time download.`);
    const result = await json(new URL('/api/pull', visionURL), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model, stream: false }), signal: AbortSignal.timeout(30 * 60_000) });
    if (result.error) throw new Error(result.error);
  }
  console.log('Warming the vision model…');
  const image = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="256" height="100"><rect width="256" height="100" fill="white"/><text x="20" y="70" font-family="Arial" font-size="48">READY</text></svg>')).png().toBuffer();
  await inferVision({ type: 'captcha-text', image: image.toString('base64') }, { model, ollamaEndpoint: visionURL });
  let key = process.env.OCR_API_KEY;
  if (!key) try { key = (await readFile(local + 'api-key', 'utf8')).trim(); } catch { /* The companion creates it on first start. */ }
  let connected = false;
  if (key) try { connected = (await new SolverClient({ endpoint, key }).request('health', { retries: 0, signal: AbortSignal.timeout(3000) })).status === 'ok'; } catch { /* Start a new companion below. */ }
  if (!connected) {
    launch(process.execPath, ['server/index.mjs']);
    for (let attempt = 0; attempt < 30 && !stopping; attempt++) {
      await pause(250);
      try { key ||= (await readFile(local + 'api-key', 'utf8')).trim(); connected = (await new SolverClient({ endpoint, key }).request('health', { retries: 0, signal: AbortSignal.timeout(1500) })).status === 'ok'; } catch { /* Startup may still be in progress. */ }
      if (connected) break;
    }
    if (!connected) throw new Error('The companion did not start. Check whether its port is already occupied.');
  }
  console.log(`Ready: ${endpoint} · ${model}`);
  console.log('Pair once in extension Settings using .local/api-key. The key is never printed here.');
  console.log(children.size ? 'Keep this terminal open. Ctrl+C stops only the processes started by this command.' : 'The services are already running.');
} catch (error) { console.error(error.message); shutdown(1); }
