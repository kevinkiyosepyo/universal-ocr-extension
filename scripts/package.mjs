import { mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
await mkdir(join(root, 'artifacts'), { recursive: true });
for (const [targetName, directory] of [['chromium', 'dist'], ['firefox', 'dist-firefox'], ['edge', 'dist-edge'], ['browser-input', 'dist-browser-input']]) {
const name = `universal-ocr-${version}-${targetName}.zip`;
const target = join(root, 'artifacts', name);
await rm(target, { force: true });
execFileSync('zip', ['-q', '-r', target, '.', '-x', '*.DS_Store'], { cwd: join(root, directory) });
const checksum = createHash('sha256').update(await readFile(target)).digest('hex');
await writeFile(join(root, 'artifacts', `${name}.sha256`), `${checksum}  ${name}\n`);
console.log(`Packaged ${target}`);

}
