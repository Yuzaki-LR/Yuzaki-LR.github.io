import assert from 'node:assert/strict';
import * as nodeFsSync from 'node:fs';
import * as nodeFs from 'node:fs/promises';
import { mkdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { createTestWorkspace } from '../../test/helpers.mjs';
import * as pathPolicy from '../server/path-policy.mjs';

const { assertConfinedPath } = pathPolicy;
const windowsPath = (...segments) => ['C:', ...segments].join('\\');
const uncPath = (...segments) => ['', '', ...segments].join('\\');

test('path policy accepts a real confined file and a safe new output', async (t) => {
  const workspace = await createTestWorkspace(); t.after(workspace.cleanup);
  assert.equal(await assertConfinedPath({ root: workspace.root, relativePath: 'src/content/site.yml', mustExist: true, operation: 'read' }), path.join(await import('node:fs/promises').then(m => m.realpath(workspace.root)), 'src', 'content', 'site.yml'));
  assert.match(await assertConfinedPath({ root: workspace.root, relativePath: 'backups/safe-id', mustExist: false, operation: 'copy' }), /backups[\\/]safe-id$/);
});

test('path policy rejects lexical Windows and encoded escape forms', async (t) => {
  const workspace = await createTestWorkspace(); t.after(workspace.cleanup);
  const bad = ['..', '../x', '/etc/passwd', ['C:', 'x'].join('/'), ['C:', 'x'].join(''), windowsPath('x'), uncPath('server','share'), uncPath('?','C:','x'), 'a:b', 'name. ', 'name.', '%2e%2e/x', '%252e%252e/x', 'a\\..\\x', 'a\0b', 'CON', 'aux.txt', '.', ''];
  for (const relativePath of bad) await assert.rejects(assertConfinedPath({ root: workspace.root, relativePath, mustExist: false, operation: 'delete' }), /不安全|网站目录/);
});

test('every operation fails closed on an escaping junction or symlink', async (t) => {
  const workspace = await createTestWorkspace(); t.after(workspace.cleanup);
  const outside = path.join(workspace.parent, 'outside'); await mkdir(outside); await writeFile(path.join(outside, 'secret.txt'), 'secret');
  const link = path.join(workspace.root, 'escape');
  await symlink(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
  for (const operation of ['walker', 'read', 'copy', 'rename', 'delete']) {
    await assert.rejects(assertConfinedPath({ root: workspace.root, relativePath: 'escape/secret.txt', mustExist: true, operation }), /超出网站目录|重解析点/);
  }
});

test('operation-bound read and walk recheck after initial validation before filesystem access', async (t) => {
  const workspace = await createTestWorkspace(); t.after(workspace.cleanup);
  const inside = path.join(workspace.root, 'barrier');
  const original = path.join(workspace.root, 'barrier-original');
  const outside = path.join(workspace.parent, 'barrier-outside');
  await mkdir(inside); await mkdir(outside);
  await writeFile(path.join(inside, 'secret.txt'), 'inside bytes');
  await writeFile(path.join(outside, 'secret.txt'), 'outside secret bytes');
  await assertConfinedPath({ root: workspace.root, relativePath: 'barrier/secret.txt', mustExist: true, operation: 'read' });
  await assertConfinedPath({ root: workspace.root, relativePath: 'barrier', mustExist: true, operation: 'walker' });

  let reads = 0; let walks = 0;
  const filesystem = {
    ...nodeFs,
    readFile: async (...args) => { reads += 1; return nodeFs.readFile(...args); },
    readdir: async (...args) => { walks += 1; return nodeFs.readdir(...args); },
  };
  const confined = pathPolicy.createConfinedFileSystem({ root: workspace.root, filesystem });
  await rename(inside, original);
  await symlink(outside, inside, process.platform === 'win32' ? 'junction' : 'dir');
  try {
    await assert.rejects(confined.readFile('barrier/secret.txt', 'utf8'), /超出网站目录|重解析点/);
    await assert.rejects(confined.readdir('barrier'), /超出网站目录|重解析点/);
    assert.deepEqual({ reads, walks }, { reads: 0, walks: 0 });
  } finally {
    await rm(inside); await rename(original, inside);
  }
});

test('operation-bound copy rename and delete recheck the nearest existing ancestor', async (t) => {
  const workspace = await createTestWorkspace(); t.after(workspace.cleanup);
  const inside = path.join(workspace.root, 'operations');
  const original = path.join(workspace.root, 'operations-original');
  const outside = path.join(workspace.parent, 'operations-outside');
  await mkdir(inside); await mkdir(outside);
  for (const [name, bytes] of [['source.txt', 'inside source'], ['rename.txt', 'inside rename'], ['delete.txt', 'inside delete']]) {
    await writeFile(path.join(inside, name), bytes);
  }
  for (const [name, bytes] of [['source.txt', 'outside source'], ['rename.txt', 'outside rename'], ['delete.txt', 'outside delete']]) {
    await writeFile(path.join(outside, name), bytes);
  }
  await assertConfinedPath({ root: workspace.root, relativePath: 'operations/new/nested/copied.txt', mustExist: false, operation: 'copy' });
  await assertConfinedPath({ root: workspace.root, relativePath: 'operations/rename.txt', mustExist: true, operation: 'rename' });
  await assertConfinedPath({ root: workspace.root, relativePath: 'operations/delete.txt', mustExist: true, operation: 'delete' });

  const calls = { copy: 0, rename: 0, delete: 0 };
  const filesystem = {
    ...nodeFs,
    copyFile: async (...args) => { calls.copy += 1; return nodeFs.copyFile(...args); },
    rename: async (...args) => { calls.rename += 1; return nodeFs.rename(...args); },
    rm: async (...args) => { calls.delete += 1; return nodeFs.rm(...args); },
  };
  const confined = pathPolicy.createConfinedFileSystem({ root: workspace.root, filesystem });
  await rename(inside, original);
  await symlink(outside, inside, process.platform === 'win32' ? 'junction' : 'dir');
  try {
    await assert.rejects(confined.copyFile('operations/source.txt', 'operations/new/nested/copied.txt'), /超出网站目录|重解析点/);
    await assert.rejects(confined.rename('operations/rename.txt', 'operations/renamed.txt'), /超出网站目录|重解析点/);
    await assert.rejects(confined.rm('operations/delete.txt'), /超出网站目录|重解析点/);
    assert.deepEqual(calls, { copy: 0, rename: 0, delete: 0 });
    assert.equal(await nodeFs.readFile(path.join(outside, 'source.txt'), 'utf8'), 'outside source');
    await assert.rejects(nodeFs.access(path.join(outside, 'new', 'nested', 'copied.txt')));
    assert.equal(await nodeFs.readFile(path.join(outside, 'rename.txt'), 'utf8'), 'outside rename');
    await assert.rejects(nodeFs.access(path.join(outside, 'renamed.txt')));
    assert.equal(await nodeFs.readFile(path.join(outside, 'delete.txt'), 'utf8'), 'outside delete');
  } finally {
    await rm(inside); await rename(original, inside);
  }
});

test('copy and rename reject source or destination replacement between validations', async (t) => {
  const workspace = await createTestWorkspace(); t.after(workspace.cleanup);
  for (const operation of ['copyFile', 'rename']) {
    for (const replaced of ['source', 'destination']) {
      const name = `${operation}-${replaced}`;
      const sourceDirectory = path.join(workspace.root, `${name}-source`);
      const destinationDirectory = path.join(workspace.root, `${name}-destination`);
      const sourceOriginal = `${sourceDirectory}-original`;
      const destinationOriginal = `${destinationDirectory}-original`;
      const outsideSource = path.join(workspace.parent, `${name}-outside-source`);
      const outsideDestination = path.join(workspace.parent, `${name}-outside-destination`);
      await mkdir(sourceDirectory); await mkdir(destinationDirectory);
      await mkdir(outsideSource); await mkdir(outsideDestination);
      await writeFile(path.join(sourceDirectory, 'record.txt'), 'inside source');
      await writeFile(path.join(destinationDirectory, 'record.txt'), 'inside destination');
      await writeFile(path.join(outsideSource, 'record.txt'), 'outside source');
      await writeFile(path.join(outsideDestination, 'record.txt'), 'outside destination');

      const sourceRelative = `${name}-source/record.txt`;
      const destinationRelative = `${name}-destination/record.txt`;
      const blockedPath = path.join(destinationDirectory, 'record.txt');
      let blockedOnce = false; let release;
      const released = new Promise((resolve) => { release = resolve; });
      let signalBlocked;
      const blocked = new Promise((resolve) => { signalBlocked = resolve; });
      const calls = { copyFile: 0, rename: 0 };
      const filesystem = {
        ...nodeFs,
        realpath: async (value) => {
          const resolved=await nodeFs.realpath(value);
          if (path.resolve(value) === path.resolve(blockedPath) && !blockedOnce) {
            blockedOnce=true;
            signalBlocked(); await released;
          }
          return resolved;
        },
        copyFile: async () => { calls.copyFile += 1; throw new Error(`unsafe underlying copy reached: ${name}`); },
        rename: async () => { calls.rename += 1; throw new Error(`unsafe underlying rename reached: ${name}`); },
      };
      const synchronousFilesystem = {
        ...nodeFsSync,
        copyFileSync: () => { calls.copyFile += 1; throw new Error(`unsafe underlying copy reached: ${name}`); },
        renameSync: () => { calls.rename += 1; throw new Error(`unsafe underlying rename reached: ${name}`); },
      };
      const confined = pathPolicy.createConfinedFileSystem({ root: workspace.root, filesystem, synchronousFilesystem });
      const pending = confined[operation](sourceRelative, destinationRelative);
      await blocked;

      const replacedDirectory = replaced === 'source' ? sourceDirectory : destinationDirectory;
      const originalDirectory = replaced === 'source' ? sourceOriginal : destinationOriginal;
      const outsideDirectory = replaced === 'source' ? outsideSource : outsideDestination;
      await rename(replacedDirectory, originalDirectory);
      await symlink(outsideDirectory, replacedDirectory, process.platform === 'win32' ? 'junction' : 'dir');
      try {
        const rejected=assert.rejects(pending, /安全|重解析|网站目录/);
        release();
        await rejected;
        assert.deepEqual(calls, { copyFile: 0, rename: 0 }, `${operation} must not reach the underlying path operation after ${replaced} replacement`);
        assert.equal(await nodeFs.readFile(path.join(outsideSource, 'record.txt'), 'utf8'), 'outside source');
        assert.equal(await nodeFs.readFile(path.join(outsideDestination, 'record.txt'), 'utf8'), 'outside destination');
        assert.deepEqual((await nodeFs.readdir(outsideSource)).sort(), ['record.txt']);
        assert.deepEqual((await nodeFs.readdir(outsideDestination)).sort(), ['record.txt']);
      } finally {
        await pending.catch(() => {});
        await rm(replacedDirectory); await rename(originalDirectory, replacedDirectory);
      }
    }
  }
});

test('operation-bound access rejects a project root replaced by a reparse point', async (t) => {
  const workspace = await createTestWorkspace(); t.after(workspace.cleanup);
  const original = `${workspace.root}-original`;
  const outside = path.join(workspace.parent, 'root-outside');
  await mkdir(path.join(outside, 'src', 'content'), { recursive: true });
  await writeFile(path.join(outside, 'src', 'content', 'site.yml'), 'outside root bytes');
  await assertConfinedPath({ root: workspace.root, relativePath: 'src/content/site.yml', mustExist: true, operation: 'read' });
  let reads = 0;
  const filesystem = { ...nodeFs, readFile: async (...args) => { reads += 1; return nodeFs.readFile(...args); } };
  const confined = pathPolicy.createConfinedFileSystem({ root: workspace.root, filesystem });
  await rename(workspace.root, original);
  await symlink(outside, workspace.root, process.platform === 'win32' ? 'junction' : 'dir');
  try {
    await assert.rejects(confined.readFile('src/content/site.yml', 'utf8'), /网站目录|重解析点/);
    assert.equal(reads, 0);
    assert.equal(await nodeFs.readFile(path.join(outside, 'src', 'content', 'site.yml'), 'utf8'), 'outside root bytes');
  } finally {
    await rm(workspace.root); await rename(original, workspace.root);
  }
});
