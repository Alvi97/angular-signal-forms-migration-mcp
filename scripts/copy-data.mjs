/**
 * Copies runtime data files into dist.
 *
 * tsc emits JavaScript, not assets, so the vendored Angular update-guide data has to be
 * copied explicitly or the built server throws MODULE_NOT_FOUND at runtime — which is
 * exactly how this was found.
 */
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const from = join(root, 'src', 'data');
const to = join(root, 'dist', 'data');

if (!existsSync(from)) {
  console.error('no src/data to copy — run npm run data:update-steps first');
  process.exit(1);
}

mkdirSync(to, { recursive: true });
cpSync(from, to, { recursive: true });
console.log('copied src/data -> dist/data');
