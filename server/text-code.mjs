import sharp from 'sharp';
import { endpointURL, TaskError, validateSolution } from '../shared/protocol.js';

// Agreement across image treatments is a consistency check, not a calibrated
// probability of correctness. In particular, never use the model's own claimed
// confidence to authorize a code it may have shortened or hallucinated.
export function codeConsensus(readings, minLength = 1) {
  const valid = readings.map(value => typeof value === 'string' ? value.trim() : '').map(value => /^[\p{L}\p{N}]{1,128}$/u.test(value) && value.length >= minLength ? value : '');
  const text = valid.find(value => value && valid.filter(other => other === value).length >= 2);
  return { text: text || valid.find(Boolean) || '', confidence: text ? .9 : 0, confidenceBasis: 'variant-agreement' };
}

export async function inferTextCode(task, config) {
  const endpoint = endpointURL(config.ollamaEndpoint);
  const original = await sharp(Buffer.from(task.image, 'base64'), { limitInputPixels: 20_000_000 }).rotate().resize({ width: 1400, height: 1400, fit: 'inside', withoutEnlargement: true }).flatten({ background: '#fff' }).png().toBuffer();
  const variants = [
    await sharp(original).grayscale().normalize().png().toBuffer(),
    await sharp(original).extend({ top: 20, bottom: 20, left: 20, right: 20, background: '#fff' }).png().toBuffer(),
    original,
    await sharp(original).grayscale().normalize().resize({ width: 900 }).png().toBuffer(),
  ];
  const readings = [];
  for (const image of variants) {
    let response;
    try {
      response = await fetch(new URL('api/chat', endpoint), {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(60_000),
        body: JSON.stringify({ model: config.textModel, stream: false, keep_alive: '15m', options: { temperature: 0, num_ctx: 4096, num_predict: 128 }, messages: [{ role: 'user', content: 'Text Recognition:', images: [image.toString('base64')] }] }),
      });
    } catch (error) { throw new TaskError('VISION_UNAVAILABLE', `The local text model is unavailable or timed out: ${error.message}`, true); }
    const body = await response.json();
    if (!response.ok) throw new TaskError('VISION_ERROR', body.error || `Text model returned ${response.status}.`, response.status >= 500);
    readings.push(body.message?.content);
    const result = codeConsensus(readings, task.minLength);
    if (result.confidence > 0 || readings.length === variants.length) return validateSolution(task, result);
  }
}
