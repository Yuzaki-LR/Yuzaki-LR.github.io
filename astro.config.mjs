import { defineConfig } from 'astro/config';
import { lstatSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const site = process.env.SITE_URL;
const base = process.env.BASE;
const candidateBuild = process.env.EDITOR_CANDIDATE_BUILD === '1';

function realDirectory(value, name) {
  const info = lstatSync(value);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`Invalid ${name}`);
  return realpathSync(value);
}

function candidateDirectory(name, operationRoot) {
  const value = process.env[name];
  if (!value || !path.isAbsolute(value)) throw new Error(`Invalid ${name}`);
  const resolved = realDirectory(value, name);
  const relative = path.relative(operationRoot, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`Invalid ${name}`);
  return resolved;
}

function candidateConfiguration() {
  if (!candidateBuild) return null;
  const operationValue = process.env.EDITOR_OPERATION_ROOT;
  if (!operationValue || !path.isAbsolute(operationValue)) throw new Error('Invalid EDITOR_OPERATION_ROOT');
  const operationRoot = realDirectory(operationValue, 'EDITOR_OPERATION_ROOT');
  return {
    operationRoot,
    contentRoot: candidateDirectory('EDITOR_CONTENT_ROOT', operationRoot),
    outDir: candidateDirectory('EDITOR_OUT_DIR', operationRoot),
    cacheDir: candidateDirectory('EDITOR_CACHE_DIR', operationRoot),
  };
}

const candidate = candidateConfiguration();

export default defineConfig({
  output: 'static',
  trailingSlash: 'always',
  build: {
    inlineStylesheets: 'never',
  },
  ...(site ? { site } : {}),
  ...(base ? { base } : {}),
  ...(candidate ? {
    root: candidate.operationRoot,
    srcDir: fileURLToPath(new URL('./src/', import.meta.url)),
    publicDir: fileURLToPath(new URL('./public/', import.meta.url)),
    outDir: candidate.outDir,
    cacheDir: candidate.cacheDir,
    vite: {
      cacheDir: candidate.cacheDir,
      define: {
        'process.env.NODE_ENV': JSON.stringify('test'),
        'process.env.TEST_SITE_CONTENT_ROOT': JSON.stringify(candidate.contentRoot),
      },
    },
  } : {}),
});
