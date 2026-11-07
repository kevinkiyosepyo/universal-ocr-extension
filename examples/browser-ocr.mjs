// Works with an existing Playwright Page or Puppeteer Page. Screenshots capture
// the visible element, including cross-origin image content. Does not submit.
import { readFile } from 'node:fs/promises';
import { SolverClient } from '../shared/client.js';
export async function readElement(page, selector, { puppeteer = false } = {}) {
  const key = process.env.OCR_API_KEY || (await readFile(new URL('../.local/api-key', import.meta.url), 'utf8')).trim();
  const image = puppeteer ? await (await page.$(selector)).screenshot({ type: 'png' }) : await page.locator(selector).screenshot({ type: 'png' });
  return new SolverClient({ key }).solve({ type: 'ocr', image: Buffer.from(image).toString('base64'), settings: { mode: 'line' } });
}
