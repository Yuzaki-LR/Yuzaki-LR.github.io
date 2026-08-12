import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
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

export async function readFixture(relativePath) {
  const fixtureRoot = await realpath(path.join(projectRoot, 'test', 'fixtures', 'content-v2'));
  const target = path.resolve(fixtureRoot, relativePath);
  if (target !== fixtureRoot && !target.startsWith(`${fixtureRoot}${path.sep}`)) {
    throw new Error('Fixture path escapes content-v2');
  }
  return readFile(await realpath(target), 'utf8');
}

export async function withContentCodecWorkspace(run) {
  const parent = await mkdtemp(path.join(projectRoot, '.content-codec-test-'));
  const sentinel = path.join(parent, '.content-codec-sentinel');
  const operationRoot = path.join(parent, 'operation');
  await writeFile(sentinel, 'content-codec-test-sentinel\n');
  await mkdir(operationRoot);
  try {
    return await run({ parent, root: operationRoot, sentinel });
  } finally {
    if (await readFile(sentinel, 'utf8') !== 'content-codec-test-sentinel\n') {
      throw new Error('content codec test workspace sentinel changed');
    }
    await rm(parent, { recursive: true, force: true });
  }
}
