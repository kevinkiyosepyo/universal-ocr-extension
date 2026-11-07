// node examples/recognize-image.mjs /absolute/path/image.png
import { readFile } from 'node:fs/promises';
import { SolverClient } from '../shared/client.js';
const path = process.argv[2];
if (!path) throw new Error('Pass the path to a PNG, JPEG, WebP, or BMP image.');
const key = process.env.OCR_API_KEY || (await readFile(new URL('../.local/api-key', import.meta.url), 'utf8')).trim();
const client = new SolverClient({ endpoint: process.env.OCR_ENDPOINT || 'http://127.0.0.1:47821', key });
const result = await client.solve({ type: 'ocr', image: (await readFile(path)).toString('base64') });
console.log(result.text);
