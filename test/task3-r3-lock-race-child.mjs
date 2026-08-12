import * as realFs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { registerHooks } from 'node:module';
import path from 'node:path';

const operation = process.argv[2];
const lockPath = process.argv[3];
const replacement = process.argv[4] ?? '';
const contender = process.argv[5] ?? '';
const operations = new Set([
  'acquire',
  'acquire-release',
  'hold',
  'recover-ambiguous',
  'recover-mismatch',
  'recover-three-party',
  'release',
  'release-mismatch',
  'stall',
]);
if (!operations.has(operation) || !path.isAbsolute(lockPath)) {
  throw new Error('invalid Task 3 lock race-child arguments');
}

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultLockPath = path.join(projectRoot, '.astro-build-test-lock');
function mapped(value) {
  if (typeof value !== 'string') return value;
  if (value === defaultLockPath) return lockPath;
  if (value.startsWith(`${defaultLockPath}.claim-`)) return `${lockPath}${value.slice(defaultLockPath.length)}`;
  return value;
}
async function atomicReplace(target, bytes) {
  const temporary = `${target}.fixture-${randomUUID()}`;
  await realFs.writeFile(temporary, bytes, { flag: 'wx' });
  await realFs.rename(temporary, target);
}
async function atomicCreate(target, bytes) {
  const temporary = `${target}.fixture-${randomUUID()}`;
  await realFs.writeFile(temporary, bytes, { flag: 'wx' });
  try {
    await realFs.link(temporary, target);
  } finally {
    await realFs.unlink(temporary);
  }
}

let replaceLiveAfterRead = operation === 'recover-mismatch'
  || operation === 'recover-three-party'
  || operation === 'recover-ambiguous';
let createContenderAfterClaim = operation === 'release' || operation === 'recover-three-party';

globalThis.__task3R3Fs = {
  ...realFs,
  cp: (source, destination, options) => realFs.cp(mapped(source), mapped(destination), options),
  lstat: (target, options) => realFs.lstat(mapped(target), options),
  link: async (existingPath, newPath) => {
    if (operation === 'recover-ambiguous'
      && typeof existingPath === 'string'
      && existingPath.startsWith(`${defaultLockPath}.claim-`)
      && newPath === defaultLockPath) {
      const error = new Error('injected ambiguous no-clobber recovery failure');
      error.code = 'EPERM';
      throw error;
    }
    return realFs.link(mapped(existingPath), mapped(newPath));
  },
  mkdir: (target, options) => realFs.mkdir(mapped(target), options),
  mkdtemp: (prefix, options) => realFs.mkdtemp(mapped(prefix), options),
  open: (target, flags, mode) => realFs.open(mapped(target), flags, mode),
  readFile: async (target, options) => {
    const source = await realFs.readFile(mapped(target), options);
    if (replaceLiveAfterRead && target === defaultLockPath) {
      replaceLiveAfterRead = false;
      await atomicReplace(lockPath, replacement);
    }
    return source;
  },
  readdir: (target, options) => realFs.readdir(mapped(target), options),
  realpath: (target, options) => realFs.realpath(mapped(target), options),
  rename: async (source, destination) => {
    const result = await realFs.rename(mapped(source), mapped(destination));
    if (createContenderAfterClaim && source === defaultLockPath) {
      createContenderAfterClaim = false;
      await atomicCreate(lockPath, contender || replacement);
    }
    return result;
  },
  rm: (target, options) => realFs.rm(mapped(target), options),
  unlink: (target) => realFs.unlink(mapped(target)),
  writeFile: (target, data, options) => realFs.writeFile(mapped(target), data, options),
};

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'node:fs/promises' && context.parentURL?.endsWith('/test/helpers.mjs')) {
      return { shortCircuit: true, url: 'task3-r3:fs-promises' };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === 'task3-r3:fs-promises') {
      return {
        format: 'module',
        shortCircuit: true,
        source: `
          const fs = globalThis.__task3R3Fs;
          export const cp = fs.cp;
          export const lstat = fs.lstat;
          export const link = fs.link;
          export const mkdir = fs.mkdir;
          export const mkdtemp = fs.mkdtemp;
          export const open = fs.open;
          export const readFile = fs.readFile;
          export const readdir = fs.readdir;
          export const realpath = fs.realpath;
          export const rename = fs.rename;
          export const rm = fs.rm;
          export const unlink = fs.unlink;
          export const writeFile = fs.writeFile;
        `,
      };
    }
    return nextLoad(url, context);
  },
});

const { acquireAstroBuildLock } = await import('./helpers.mjs');

async function acquireAndReport({ release = false, hold = false } = {}) {
  try {
    const releaseLock = await acquireAstroBuildLock({ timeoutMs: 500 });
    if (release) await releaseLock();
    console.log(release ? 'RELEASED' : 'ACQUIRED');
    if (hold) await new Promise(() => {});
  } catch (error) {
    console.log(`REJECTED:${error.message}`);
  }
}

if (operation === 'stall') {
  setInterval(() => {}, 1_000);
} else if (operation === 'hold') {
  await acquireAndReport({ hold: true });
} else if (operation === 'acquire-release') {
  await acquireAndReport({ release: true });
} else if (operation === 'acquire') {
  await acquireAndReport();
} else if (operation === 'release' || operation === 'release-mismatch') {
  const releaseLock = await acquireAstroBuildLock({ timeoutMs: 500 });
  if (operation === 'release-mismatch') await atomicReplace(lockPath, replacement);
  try {
    await releaseLock();
    console.log('RELEASED');
  } catch (error) {
    console.log(`REJECTED:${error.message}`);
  }
} else {
  await acquireAndReport();
}
