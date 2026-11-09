import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const models = fileURLToPath(new URL('../.local/models/', import.meta.url));
await mkdir(models, { recursive: true });
const env = { ...process.env, OLLAMA_HOST: '127.0.0.1:11435', OLLAMA_MODELS: models, OLLAMA_NO_CLOUD: '1', OLLAMA_FLASH_ATTENTION: process.env.OLLAMA_FLASH_ATTENTION || '0', OLLAMA_NUM_PARALLEL: '1', OLLAMA_MAX_LOADED_MODELS: '1' };
if (process.argv.includes('--pull')) {
  const response = await fetch('http://127.0.0.1:11435/api/pull', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'qwen3-vl:4b-instruct', stream: false }), signal: AbortSignal.timeout(20 * 60_000) });
  const result = await response.json();
  if (!response.ok || result.error) throw new Error(result.error || 'Model download failed. Start npm run vision first.');
  console.log('Local vision model ready.');
} else {
  const child = spawn('ollama', ['serve'], { env, stdio: 'inherit' });
  child.on('error', () => { console.error('Install Ollama from https://ollama.com, then run this command again.'); process.exitCode = 1; });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
  child.on('exit', (code) => { process.exitCode = code || 0; });
}
