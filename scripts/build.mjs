import { build } from 'esbuild';
import sharp from 'sharp';
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LANGUAGES } from '../src/settings.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const dist = join(root, 'dist');
await rm(dist, { recursive: true, force: true });
await cp(join(root, 'public'), dist, { recursive: true });
await build({
  absWorkingDir: root, entryPoints: ['src/background.js', 'src/popup.js', 'src/workspace.js'],
  outdir: dist, bundle: true, format: 'esm', platform: 'browser', target: 'chrome116',
  minify: false, legalComments: 'eof', logLevel: 'info',
});
await build({ absWorkingDir: root, entryPoints: ['src/content.js'], outdir: dist, bundle: true, format: 'iife', target: 'chrome116', logLevel: 'info' });
await mkdir(join(dist, 'vendor/core'), { recursive: true });
await mkdir(join(dist, 'vendor/lang'), { recursive: true });
await cp(join(root, 'node_modules/tesseract.js/dist/worker.min.js'), join(dist, 'vendor/worker.min.js'));
await cp(join(root, 'node_modules/tesseract.js/dist/worker.min.js.LICENSE.txt'), join(dist, 'vendor/worker.min.js.LICENSE.txt'));
const coreDir = join(root, 'node_modules/tesseract.js-core');
for (const name of await readdir(coreDir)) {
  if (/\.wasm(?:\.js)?$/.test(name)) await cp(join(coreDir, name), join(dist, 'vendor/core', name));
}
for (const language of Object.keys(LANGUAGES)) {
  await cp(join(root, `node_modules/@tesseract.js-data/${language}/4.0.0_best_int/${language}.traineddata.gz`), join(dist, `vendor/lang/${language}.traineddata.gz`));
}
await mkdir(join(dist, 'licenses'), { recursive: true });
await cp(join(root, 'licenses'), join(dist, 'licenses'), { recursive: true });
for (const dependency of ['tesseract.js', 'tesseract.js-core', 'bmp-js', 'idb-keyval', 'is-url', 'regenerator-runtime', 'wasm-feature-detect', 'zlibjs']) {
  const dir = join(root, 'node_modules', dependency);
  for (const name of await readdir(dir)) {
    if (/^(license|copying|notice)(\.|$)/i.test(name)) await cp(join(dir, name), join(dist, 'licenses', `${dependency}-${name}`));
  }
}
await cp(join(root, 'THIRD_PARTY_NOTICES.md'), join(dist, 'THIRD_PARTY_NOTICES.md'));
await cp(join(root, 'LICENSE'), join(dist, 'LICENSE'));
await mkdir(join(dist, 'icons'), { recursive: true });
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><rect width="128" height="128" rx="26" fill="#17745a"/><g fill="none" stroke="#e7f3df" stroke-width="6" stroke-linecap="round"><path d="M28 44V29h15M85 29h15v15M100 84v15H85M43 99H28V84"/><path d="M43 81l21-39 21 39M51 67h26"/></g></svg>`;
for (const size of [16, 32, 48, 128]) await sharp(Buffer.from(svg)).resize(size, size).png().toFile(join(dist, `icons/${size}.png`));
const manifest = JSON.parse(await readFile(join(dist, 'manifest.json'), 'utf8'));
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
if (manifest.version !== pkg.version) throw new Error('Package and manifest versions must match.');
await writeFile(join(dist, 'BUILD_INFO.json'), JSON.stringify({ version: pkg.version, engine: 'tesseract.js 7.0.0', languages: Object.keys(LANGUAGES) }, null, 2) + '\n');
console.log(`Built ${resolve(dist)}`);
