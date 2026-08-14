import assert from 'node:assert/strict';
import { copyFile, mkdir, symlink } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { createTestWorkspace } from '../../test/helpers.mjs';
import { isCompatibleNodeVersion, locateNode } from '../server/runtime-locator.mjs';

test('runtime locator prefers the verified project-local node over PATH', async (t) => {
  const workspace = await createTestWorkspace();
  t.after(workspace.cleanup);
  const localNode = path.join(workspace.root, '.local-editor', 'tools', 'node', 'node.exe');
  await mkdir(path.dirname(localNode), { recursive: true });
  await copyFile(process.execPath, localNode);
  assert.deepEqual(await locateNode({ projectRoot: workspace.root, envPath: path.dirname(process.execPath) }), {
    executable: localNode,
    source: 'project-local',
    version: process.version,
  });
});

test('runtime locator accepts a compatible PATH node without changing PATH', async (t) => {
  const workspace = await createTestWorkspace();
  t.after(workspace.cleanup);
  const originalPath = process.env.PATH;
  assert.deepEqual(await locateNode({ projectRoot: workspace.root, envPath: path.dirname(process.execPath) }), {
    executable: process.execPath,
    source: 'path',
    version: process.version,
  });
  assert.equal(process.env.PATH, originalPath);
});

test('runtime locator rejects versions below the project engine minimum', async () => {
  assert.equal(isCompatibleNodeVersion('v22.11.0'), false);
  assert.equal(isCompatibleNodeVersion('v22.12.0'), true);
  assert.equal(isCompatibleNodeVersion('v24.14.0'), true);
  assert.equal(isCompatibleNodeVersion('not-node'), false);
});

test('runtime locator gives Chinese offline provisioning instructions when no runtime exists', async (t) => {
  const workspace = await createTestWorkspace();
  t.after(workspace.cleanup);
  const emptyPath = path.join(workspace.root, 'empty-path');
  await mkdir(emptyPath);
  await assert.rejects(
    locateNode({ projectRoot: workspace.root, envPath: emptyPath }),
    (error) => error?.code === 'NODE_RUNTIME_REQUIRED'
      && /Node\.js/.test(error.message)
      && /\.local-editor/.test(error.message)
      && !/https?:\/\//.test(error.message),
  );
});

test('runtime locator accepts Windows path casing changes for the same safe project', { skip: process.platform !== 'win32' }, async (t) => {
  const workspace = await createTestWorkspace();
  t.after(workspace.cleanup);
  const localNode = path.join(workspace.root, '.local-editor', 'tools', 'node', 'node.exe');
  await mkdir(path.dirname(localNode), { recursive: true });
  await copyFile(process.execPath, localNode);

  const located = await locateNode({ projectRoot: workspace.root.toUpperCase(), envPath: '' });
  assert.equal(located.source, 'project-local');
  assert.equal(located.version, process.version);
  assert.equal(located.executable.toLowerCase(), localNode.toLowerCase());
});

test('runtime locator ignores relative PATH directories', async (t) => {
  const workspace = await createTestWorkspace();
  t.after(workspace.cleanup);
  const runtimeDirectory = path.join(workspace.root, 'relative-runtime');
  await mkdir(runtimeDirectory);
  await copyFile(process.execPath, path.join(runtimeDirectory, 'node.exe'));
  const relativeRuntimeDirectory = path.relative(process.cwd(), runtimeDirectory);
  assert.equal(path.isAbsolute(relativeRuntimeDirectory), false);

  await assert.rejects(
    locateNode({ projectRoot: workspace.root, envPath: relativeRuntimeDirectory }),
    (error) => error?.code === 'NODE_RUNTIME_REQUIRED',
  );
});

test('runtime locator fails closed on a project-local node directory junction', { skip: process.platform !== 'win32' }, async (t) => {
  const workspace = await createTestWorkspace();
  t.after(workspace.cleanup);
  const localNodeDirectory = path.join(workspace.root, '.local-editor', 'tools', 'node');
  const junctionTarget = path.join(workspace.root, 'runtime-junction-target');
  await mkdir(path.dirname(localNodeDirectory), { recursive: true });
  await mkdir(junctionTarget);
  await copyFile(process.execPath, path.join(junctionTarget, 'node.exe'));
  await symlink(junctionTarget, localNodeDirectory, 'junction');

  await assert.rejects(
    locateNode({ projectRoot: workspace.root, envPath: path.dirname(process.execPath) }),
    (error) => error?.code === 'NODE_RUNTIME_UNSAFE',
  );
});
