import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import sharp from 'sharp';
import { codeConsensus, inferTextCode } from '../server/text-code.mjs';

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

async function withTextModel(readings, run) {
  const images = [];
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks));
    images.push(Buffer.from(body.messages[0].images[0], 'base64'));
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ message: { content: readings[images.length - 1] } }));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try { await run({ textModel: 'test-model', ollamaEndpoint: `http://127.0.0.1:${server.address().port}` }, images); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}

test('text inference stops on agreement without requesting fallback variants', async () => withTextModel(['JMKR', 'JMKR'], async (config, images) => {
  const image = await sharp({ create: { width: 300, height: 100, channels: 3, background: '#fff' } }).png().toBuffer();
  const result = await inferTextCode({ type: 'captcha-text', image: image.toString('base64'), minLength: 4 }, config);
  assert.equal(result.text, 'JMKR'); assert.equal(result.confidence, .9); assert.equal(images.length, 2);
}));

test('text fallback bounds portrait expansion and preserves uncertainty on disagreement', async () => withTextModel(['ABCD', 'ABCE', 'ABCF', 'ABCG'], async (config, images) => {
  const image = await sharp({ create: { width: 50, height: 1400, channels: 3, background: '#fff' } }).png().toBuffer();
  const result = await inferTextCode({ type: 'captcha-text', image: image.toString('base64'), minLength: 4 }, config);
  assert.equal(result.confidence, 0); assert.equal(images.length, 4);
  const fallback = await sharp(images[3]).metadata();
  assert.ok(fallback.width <= 900); assert.ok(fallback.height <= 1400);
}));
