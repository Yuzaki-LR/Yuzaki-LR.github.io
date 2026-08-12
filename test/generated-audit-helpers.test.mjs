import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { absoluteLocalPath, documentSiteBase, expandSiteBase, inventoryBuildInputs, normalizeSiteBase, stripSiteBase, trackedTextSurfaces } from './generated-audit-helpers.mjs';

const slash = String.fromCharCode(47);
const backslash = String.fromCharCode(92);
const drivePath = ['D:', backslash, 'research', backslash, 'raw.pdf'].join('');
const uncPath = [backslash, backslash, 'server', backslash, 'share', backslash, 'raw.pdf'].join('');
const devicePath = [backslash, backslash, '?', backslash, 'D:', backslash, 'raw.pdf'].join('');
const posixPath = ['', 'home', 'researcher', 'raw.pdf'].join(slash);
const filePath = ['file:', slash, slash, slash, 'D:', slash, 'raw.pdf'].join('');

test('local path scanner rejects encoded absolute paths without rejecting external web pathnames', () => {
  const encode = (value, depth) => Array.from({ length: depth }).reduce((encoded) => encodeURIComponent(encoded), value);
  const unsafe = [
    drivePath,
    uncPath,
    devicePath,
    filePath,
    posixPath,
    encodeURIComponent(drivePath),
    encodeURIComponent(encodeURIComponent(drivePath)),
    encode(drivePath, 3),
    encode(drivePath, 4),
    encode(drivePath, 5),
    `prefix ${drivePath} suffix`,
    `https://example.com/guide?next=${encodeURIComponent(drivePath)}`,
    `https://example.com/guide#${encodeURIComponent(posixPath)}`,
    ['bad', '%', 'ZZ'].join(''),
  ];
  for (const value of unsafe) assert.notEqual(absoluteLocalPath(value), null, value);
  assert.equal(absoluteLocalPath('https://example.com/home/guide'), null);
  assert.equal(absoluteLocalPath('https://example.com/guide?topic=home'), null);
});

test('tracked privacy surfaces always include index bytes and additionally differing working bytes', async () => {
  const surfaces = await trackedTextSurfaces(['docs/a.md', 'docs/b.md', 'docs/c.md'], {
    readIndex: async (file) => ({ 'docs/a.md': 'index-a', 'docs/b.md': 'same', 'docs/c.md': 'index-only' })[file],
    readWorking: async (file) => ({ 'docs/a.md': 'working-a', 'docs/b.md': 'same' })[file],
  });
  assert.deepEqual(surfaces, [
    { relativePath: 'docs/a.md', source: 'index-a', kind: 'index' },
    { relativePath: 'docs/a.md', source: 'working-a', kind: 'working' },
    { relativePath: 'docs/b.md', source: 'same', kind: 'index' },
    { relativePath: 'docs/c.md', source: 'index-only', kind: 'index' },
  ]);
});

test('generated route mapping strips only the emitted site base and rejects paths outside it', () => {
  assert.equal(normalizeSiteBase('/repo/'), '/repo/');
  assert.equal(stripSiteBase('/repo/', '/repo/'), '/');
  assert.equal(stripSiteBase('/repo/projects/', '/repo/'), '/projects/');
  assert.equal(expandSiteBase('/projects/', '/repo/'), '/repo/projects/');
  assert.throws(() => stripSiteBase('/projects/', '/repo/'), /escapes emitted site base/);
  assert.throws(() => stripSiteBase('/repository/', '/repo/'), /escapes emitted site base/);
});

test('generated documents must share the canonical homepage base instead of self-validating their own base', () => {
  const canonicalBase = normalizeSiteBase('/repo/');
  const detail = {
    identityHref: '/wrong/',
    internalHrefs: ['/wrong/projects/', '/wrong/projects/sample/', '/wrong/assets/projects/sample/result.png'],
  };
  const selfDeclaredBase = normalizeSiteBase(detail.identityHref);
  assert.doesNotThrow(() => detail.internalHrefs.forEach((href) => stripSiteBase(href, selfDeclaredBase)));
  assert.throws(() => documentSiteBase(detail.identityHref, canonicalBase), /canonical homepage base/i);
});

test('freshness inventory includes untracked build inputs and rejects reparse escapes', async () => {
  const tree = new Map([
    ['/fixture', { type: 'directory', realpath: '/fixture' }],
    ['/fixture/src', { type: 'directory', realpath: '/fixture/src' }],
    ['/fixture/src/pages', { type: 'directory', realpath: '/fixture/src/pages' }],
    ['/fixture/src/pages/index.astro', { type: 'file', realpath: '/fixture/src/pages/index.astro', mtimeMs: 10 }],
    ['/fixture/src/pages/new.astro', { type: 'file', realpath: '/fixture/src/pages/new.astro', mtimeMs: 20 }],
    ['/fixture/public', { type: 'directory', realpath: '/fixture/public' }],
    ['/fixture/public/robots.txt', { type: 'file', realpath: '/fixture/public/robots.txt', mtimeMs: 15 }],
    ['/fixture/package.json', { type: 'file', realpath: '/fixture/package.json', mtimeMs: 5 }],
    ['/fixture/pnpm-lock.yaml', { type: 'file', realpath: '/fixture/pnpm-lock.yaml', mtimeMs: 6 }],
    ['/fixture/astro.config.mjs', { type: 'file', realpath: '/fixture/astro.config.mjs', mtimeMs: 7 }],
    ['/fixture/tsconfig.json', { type: 'file', realpath: '/fixture/tsconfig.json', mtimeMs: 8 }],
    ['/fixture/pnpm-workspace.yaml', { type: 'file', realpath: '/fixture/pnpm-workspace.yaml', mtimeMs: 9 }],
  ]);
  const io = {
    realpath: async (target) => tree.get(target)?.realpath ?? target,
    lstat: async (target) => ({
      isDirectory: () => tree.get(target)?.type === 'directory',
      isFile: () => tree.get(target)?.type === 'file',
      isSymbolicLink: () => tree.get(target)?.type === 'link',
      mtimeMs: tree.get(target)?.mtimeMs,
    }),
    readdir: async (target) => [...tree.keys()].filter((entry) => entry.startsWith(`${target}/`) && !entry.slice(target.length + 1).includes('/')).map((entry) => entry.slice(target.length + 1)),
  };
  assert.deepEqual((await inventoryBuildInputs('/fixture', io)).map(({ relativePath }) => relativePath), [
    'astro.config.mjs', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'public/robots.txt', 'src/pages/index.astro', 'src/pages/new.astro', 'tsconfig.json',
  ]);

  tree.set('/fixture/src/pages/escape.astro', { type: 'link', realpath: '/outside/escape.astro', mtimeMs: 30 });
  await assert.rejects(inventoryBuildInputs('/fixture', io), /reparse|escape/i);
});

test('freshness inventory rejects a regular file whose realpath crosses Windows volumes', async () => {
  const root = ['C:', backslash, 'abc'].join('');
  const outside = ['D:', backslash, 'xyz', backslash, 'file'].join('');
  const io = {
    path: path.win32,
    realpath: async (target) => target === root ? root : outside,
    lstat: async (target) => ({
      isDirectory: () => target.endsWith('/public') || target.endsWith('/src'),
      isFile: () => !target.endsWith('/public') && !target.endsWith('/src'),
      isSymbolicLink: () => false,
      mtimeMs: 1,
    }),
    readdir: async () => [],
  };
  await assert.rejects(inventoryBuildInputs(root, io), /escapes project root/i);
});
