export const TASK_TYPES = Object.freeze(['ocr', 'captcha-text', 'grid', 'points', 'bbox', 'slider', 'rotate', 'pow']);
export const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

export class TaskError extends Error {
  constructor(code, message, retryable = false) { super(message); this.name = 'TaskError'; this.code = code; this.retryable = retryable; }
}

export function endpointURL(value) {
  let url;
  try { url = new URL(value); } catch { throw new TaskError('INVALID_ENDPOINT', 'Enter a complete endpoint URL.'); }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) || url.username || url.password || url.search || url.hash) {
    throw new TaskError('INVALID_ENDPOINT', 'Use HTTPS, or HTTP on localhost, without embedded credentials or a query.');
  }
  url.pathname = url.pathname.replace(/\/+$/, '') + '/';
  return url;
}

export function imageBase64(value) {
  if (typeof value !== 'string') throw new TaskError('INVALID_IMAGE', 'Supply an image as base64 or a data URL.');
  const raw = value.replace(/^data:image\/(?:png|jpeg|webp|bmp|gif);base64,/i, '');
  if (!raw || raw.length > Math.ceil(MAX_IMAGE_BYTES * 4 / 3) + 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(raw) || raw.length % 4 !== 0) {
    throw new TaskError('INVALID_IMAGE', 'Invalid image encoding or image larger than 15 MB.');
  }
  return raw;
}

export function validateTask(input) {
  if (!input || !TASK_TYPES.includes(input.type)) throw new TaskError('UNSUPPORTED_TASK', `Supported task types: ${TASK_TYPES.join(', ')}. Provider tokens are issued by their own services.`);
  const task = { type: input.type };
  if (input.type === 'pow') {
    if (typeof input.prefix !== 'string' || input.prefix.length > 4096 || !Number.isInteger(input.difficulty) || input.difficulty < 0 || input.difficulty > 24) throw new TaskError('INVALID_TASK', 'Proof-of-work requires a prefix and a difficulty of 0–24 leading zero bits.');
    return { ...task, prefix: input.prefix, difficulty: input.difficulty };
  }
  task.image = imageBase64(input.image);
  if (['slider', 'rotate'].includes(task.type)) task.reference = imageBase64(input.reference);
  if (['grid', 'points', 'bbox'].includes(task.type)) {
    if (typeof input.prompt !== 'string' || !input.prompt.trim() || input.prompt.length > 2000) throw new TaskError('INVALID_TASK', 'Visual tasks require a short instruction describing what to find.');
    task.prompt = input.prompt.trim();
  }
  if (task.type === 'grid') {
    if (![input.rows, input.columns].every((n) => Number.isInteger(n) && n >= 1 && n <= 6) || input.rows * input.columns > 36) throw new TaskError('INVALID_TASK', 'Grid dimensions must be between 1 and 6 rows and columns.');
    task.rows = input.rows; task.columns = input.columns;
    task.layout = ['tiles', 'scene'].includes(input.layout) ? input.layout : 'tiles';
  }
  if (task.type === 'ocr') task.settings = input.settings && typeof input.settings === 'object' ? input.settings : {};
  return task;
}

export function validateSolution(task, result) {
  if (!result || typeof result !== 'object') throw new TaskError('INVALID_SOLUTION', 'The recognition engine returned no usable result.');
  const confidence = Number.isFinite(result.confidence) ? Math.min(1, Math.max(0, result.confidence)) : 0;
  if (task.type === 'captcha-text') {
    if (typeof result.text !== 'string' || result.text.length > 128 || /[\r\n]/.test(result.text)) throw new TaskError('INVALID_SOLUTION', 'The model did not return a single short text code.');
    return { text: result.text.trim(), confidence };
  }
  if (task.type === 'grid') {
    if (!Array.isArray(result.selected) || !result.selected.every((n) => Number.isInteger(n) && n >= 0 && n < task.rows * task.columns)) throw new TaskError('INVALID_SOLUTION', 'The model returned an invalid grid index.');
    return { selected: [...new Set(result.selected)].sort((a, b) => a - b), confidence };
  }
  const unit = (n) => Number.isFinite(n) && n >= 0 && n <= 1;
  if (task.type === 'points') {
    if (!Array.isArray(result.points) || result.points.length > 30 || !result.points.every((p) => unit(p?.x) && unit(p?.y))) throw new TaskError('INVALID_SOLUTION', 'The model returned invalid point coordinates.');
    return { points: result.points.map(({ x, y }) => ({ x, y })), confidence };
  }
  if (task.type === 'bbox') {
    if (!Array.isArray(result.boxes) || result.boxes.length > 30 || !result.boxes.every((b) => [b?.x, b?.y, b?.width, b?.height].every(unit) && b.width > 0 && b.height > 0 && b.x + b.width <= 1.001 && b.y + b.height <= 1.001)) throw new TaskError('INVALID_SOLUTION', 'The model returned invalid bounding boxes.');
    return { boxes: result.boxes.map(({ x, y, width, height }) => ({ x, y, width, height })), confidence };
  }
  return result;
}

export function retryDelay(attempt, random = Math.random) { return Math.min(8000, 400 * 2 ** attempt) + Math.floor(random() * 200); }

export async function signedHeaders(key, method, path, body = '', now = Date.now(), nonce = crypto.randomUUID()) {
  const encoder = new TextEncoder();
  const hex = (bytes) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
  const digest = hex(await crypto.subtle.digest('SHA-256', encoder.encode(body)));
  const canonical = `${now}\n${nonce}\n${method.toUpperCase()}\n${path}\n${digest}`;
  const signingKey = await crypto.subtle.importKey('raw', encoder.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return {
    'Content-Type': 'application/json', 'X-OCR-Timestamp': String(now), 'X-OCR-Nonce': nonce,
    'X-OCR-Signature': hex(await crypto.subtle.sign('HMAC', signingKey, encoder.encode(canonical))),
  };
}
