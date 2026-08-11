import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const distRoot = path.join(projectRoot, 'dist');

export function readDist(relativePath) {
  return readFile(path.join(distRoot, relativePath), 'utf8');
}

export async function readBuiltCss() {
  const assetDir = path.join(distRoot, '_astro');
  const files = await readdir(assetDir);
  const cssFiles = files.filter((file) => file.endsWith('.css'));
  return Promise.all(cssFiles.map((file) => readFile(path.join(assetDir, file), 'utf8')))
    .then((parts) => parts.join('\n'));
}
