import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { Uint8ArrayReader, Uint8ArrayWriter, ZipWriter } from '@zip.js/zip.js';
import { createTestWorkspace } from '../../test/helpers.mjs';

const expectedVersion = process.version.slice(1);
const archiveRoot = `node-v${expectedVersion}-win-x64`;

async function zipBytes(entries) {
  const output = new Uint8ArrayWriter();
  const writer = new ZipWriter(output, { useWebWorkers: false });
  for (const entry of entries) {
    await writer.add(entry.name, new Uint8ArrayReader(entry.bytes ?? new Uint8Array()), {
      ...(entry.directory ? { directory: true } : {}),
      ...(entry.externalFileAttributes === undefined ? {} : { externalFileAttributes: entry.externalFileAttributes }),
      ...(entry.unixMode === undefined ? {} : { unixMode: entry.unixMode, versionMadeBy: 0x31e }),
      ...(entry.password === undefined ? {} : { password: entry.password, encryptionStrength: 3 }),
      ...(entry.level === undefined ? {} : { level: entry.level }),
    });
  }
  const archive = Buffer.from(await writer.close());
  for (const entry of entries.filter((value) => value.rewriteTo)) {
    const from = Buffer.from(entry.name);
    const to = Buffer.from(entry.rewriteTo);
    assert.equal(from.length, to.length);
    let offset = archive.indexOf(from);
    assert.notEqual(offset, -1);
    while (offset !== -1) {
      to.copy(archive, offset);
      offset = archive.indexOf(from, offset + to.length);
    }
  }
  return archive;
}

function checksumsFor(bytes, filename = `node-v${expectedVersion}-win-x64.zip`) {
  return Buffer.from(`${createHash('sha256').update(bytes).digest('hex')}  ${filename}\n`);
}

function testInstaller(module, archive, hooks = {}) {
  assert.equal(typeof module.createPortableRuntimeInstallerForTesting, 'function');
  return module.createPortableRuntimeInstallerForTesting({
    expectedVersion,
    trustedChecksum: createHash('sha256').update(archive).digest('hex'),
    hooks,
  });
}

async function treeSnapshot(root) {
  const result = [];
  async function visit(directory) {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const target = path.join(directory, entry.name);
      const relative = path.relative(root, target).replace(/\\/g, '/');
      if (entry.isDirectory()) { result.push(`${relative}/`); await visit(target); }
      else result.push(`${relative}:${createHash('sha256').update(await readFile(target)).digest('hex')}`);
    }
  }
  await visit(root);
  return result;
}

async function installerWorkspace(t) {
  const workspace = await createTestWorkspace();
  t.after(workspace.cleanup);
  const toolsRoot = path.join(workspace.root, '.local-editor', 'tools');
  await mkdir(toolsRoot, { recursive: true });
  await writeFile(path.join(toolsRoot, 'sentinel.txt'), 'owned tools sentinel\n');
  return { ...workspace, toolsRoot };
}

async function loadInstaller() {
  try { return await import('../server/portable-runtime-installer.mjs'); }
  catch (error) {
    if (error?.code === 'ERR_MODULE_NOT_FOUND' && /portable-runtime-installer\.mjs/.test(error.message)) return {};
    throw error;
  }
}

test('portable runtime installer verifies, stages, executes, and promotes node.exe', async (t) => {
  const workspace = await installerWorkspace(t);
  const executableBytes = await readFile(process.execPath);
  const archive = await zipBytes([
    { name: `${archiveRoot}/`, directory: true },
    { name: `${archiveRoot}/node.exe`, bytes: executableBytes },
    { name: `${archiveRoot}/LICENSE`, bytes: Buffer.from('fixture license\n') },
    { name: `${archiveRoot}/npm.ps1`, bytes: Buffer.from('# npm shim\n') },
    { name: `${archiveRoot}/npx.ps1`, bytes: Buffer.from('# npx shim\n') },
  ]);
  const module = await loadInstaller();
  const installPortableRuntime = testInstaller(module, archive);

  const record = await installPortableRuntime({
    zipBytes: archive,
    checksumsBytes: checksumsFor(archive),
    toolsRoot: workspace.toolsRoot,
    expectedVersion,
  });

  assert.equal(record.version, `v${expectedVersion}`);
  assert.equal(record.checksum, createHash('sha256').update(archive).digest('hex'));
  assert.equal(record.destination, path.join(workspace.toolsRoot, 'node'));
  assert.equal(await readFile(path.join(record.destination, 'node.exe')).then((bytes) => bytes.length), executableBytes.length);
  assert.match(record.installedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test('production portable runtime installer rejects a self-consistent archive outside the pinned official trust anchor', async (t) => {
  const workspace = await installerWorkspace(t);
  const archive = await zipBytes([
    { name: `${archiveRoot}/`, directory: true },
    { name: `${archiveRoot}/node.exe`, bytes: await readFile(process.execPath) },
  ]);
  const { stagePortableRuntime } = await loadInstaller();
  await assert.rejects(
    stagePortableRuntime({ zipBytes: archive, checksumsBytes: checksumsFor(archive), toolsRoot: workspace.toolsRoot, expectedVersion }),
    (error) => error?.code === 'PORTABLE_RUNTIME_INVALID',
  );
  await assert.rejects(readFile(path.join(workspace.toolsRoot, 'node', 'node.exe')), (error) => error?.code === 'ENOENT');
});

test('portable runtime installer revalidates the full plain tree across execution and promotion boundaries', async (t) => {
  const module = await loadInstaller();
  for (const boundary of ['after executable check', 'after pre-promotion proof']) await t.test(boundary, async () => {
    const workspace = await installerWorkspace(t);
    const outside = path.join(workspace.parent, `outside-${boundary.replaceAll(' ', '-')}`);
    await mkdir(outside);
    await writeFile(path.join(outside, 'sentinel.txt'), 'outside bytes\n');
    const archive = await zipBytes([
      { name: `${archiveRoot}/`, directory: true },
      { name: `${archiveRoot}/node.exe`, bytes: await readFile(process.execPath) },
      { name: `${archiveRoot}/LICENSE`, bytes: Buffer.from('fixture license\n') },
      { name: `${archiveRoot}/node_modules/`, directory: true },
      { name: `${archiveRoot}/node_modules/tool.txt`, bytes: Buffer.from('tool bytes\n') },
    ]);
    const before = await treeSnapshot(workspace.toolsRoot);
    const hooks = boundary === 'after executable check' ? {
      afterExecutableCheck: async ({ stagingRoot }) => writeFile(path.join(stagingRoot, 'LICENSE'), 'tampered after exec\n'),
    } : {
      afterPrePromotionProof: async ({ stagingRoot }) => {
        const modules = path.join(stagingRoot, 'node_modules');
        await rm(modules, { recursive: true });
        await symlink(outside, modules, 'junction');
      },
    };
    const installPortableRuntime = testInstaller(module, archive, hooks);
    await assert.rejects(
      installPortableRuntime({ zipBytes: archive, checksumsBytes: checksumsFor(archive), toolsRoot: workspace.toolsRoot, expectedVersion }),
      (error) => error?.code === 'PORTABLE_RUNTIME_INVALID',
    );
    assert.deepEqual(await treeSnapshot(workspace.toolsRoot), before);
    assert.equal(await readFile(path.join(outside, 'sentinel.txt'), 'utf8'), 'outside bytes\n');
  });
});

test('portable runtime installer rejects hostile and ambiguous archives without changing tools bytes', async (t) => {
  const cases = [
    ['zip-slip', [{ name: `${archiveRoot}/../evil`, bytes: Buffer.from('x') }]],
    ['absolute', [{ name: `/${archiveRoot}/node.exe`, bytes: Buffer.from('x') }]],
    ['drive', [{ name: 'C:/node.exe', bytes: Buffer.from('x') }]],
    ['UNC', [{ name: '//server/share/node.exe', bytes: Buffer.from('x') }]],
    ['ADS', [{ name: `${archiveRoot}/node.exe:payload`, bytes: Buffer.from('x') }]],
    ['exact duplicate', [{ name: `${archiveRoot}/corepack`, rewriteTo: `${archiveRoot}/node.exe`, bytes: Buffer.from('x') }]],
    ['case-fold collision', [{ name: `${archiveRoot}/node.EXE`, bytes: Buffer.from('y') }]],
    ['file-directory collision', [{ name: archiveRoot, bytes: Buffer.from('not a directory') }]],
    ['symlink metadata', [{ name: `${archiveRoot}/LICENSE`, bytes: Buffer.from('link-target'), unixMode: 0o120777 }]],
    ['reparse metadata', [{ name: `${archiveRoot}/LICENSE`, bytes: Buffer.from('reparse'), externalFileAttributes: 0x400 }]],
    ['encrypted entry', [{ name: `${archiveRoot}/LICENSE`, bytes: Buffer.from('secret'), password: 'test-only-password' }]],
    ['unexpected top-level', [{ name: 'other-root/node.exe', bytes: Buffer.from('x') }]],
    ['unexpected distribution entry', [{ name: `${archiveRoot}/surprise.exe`, bytes: Buffer.from('x') }]],
    ['node_modules root as a file', [{ name: `${archiveRoot}/node_modules`, bytes: Buffer.from('x') }]],
  ];
  const module = await loadInstaller();

  for (const [name, hostile] of cases) await t.test(name, async () => {
    const workspace = await installerWorkspace(t);
    const before = await treeSnapshot(workspace.toolsRoot);
    const archive = await zipBytes([
      { name: `${archiveRoot}/`, directory: true },
      { name: `${archiveRoot}/node.exe`, bytes: Buffer.from('placeholder') },
      ...hostile,
    ]);
    const installPortableRuntime = testInstaller(module, archive);
    await assert.rejects(
      installPortableRuntime({ zipBytes: archive, checksumsBytes: checksumsFor(archive), toolsRoot: workspace.toolsRoot, expectedVersion }),
      (error) => error?.code === 'PORTABLE_RUNTIME_INVALID',
    );
    assert.deepEqual(await treeSnapshot(workspace.toolsRoot), before);
  });
});

test('portable runtime installer requires the distribution root and verifies entry signatures before writes', async (t) => {
  const module = await loadInstaller();
  const validWithoutRoot = await zipBytes([{ name: `${archiveRoot}/node.exe`, bytes: Buffer.from('not executable'), level: 0 }]);
  const corruptPayload = Buffer.from('integrity-sentinel');
  const corruptArchive = await zipBytes([
    { name: `${archiveRoot}/`, directory: true },
    { name: `${archiveRoot}/node.exe`, bytes: corruptPayload, level: 0 },
  ]);
  const payloadOffset = corruptArchive.indexOf(corruptPayload);
  assert.notEqual(payloadOffset, -1);
  corruptArchive[payloadOffset] ^= 0xff;

  for (const [name, archive] of [['missing root', validWithoutRoot], ['signature mismatch', corruptArchive]]) await t.test(name, async () => {
    const workspace = await installerWorkspace(t);
    const before = await treeSnapshot(workspace.toolsRoot);
    const installPortableRuntime = testInstaller(module, archive);
    await assert.rejects(
      installPortableRuntime({ zipBytes: archive, checksumsBytes: checksumsFor(archive), toolsRoot: workspace.toolsRoot, expectedVersion }),
      (error) => error?.code === 'PORTABLE_RUNTIME_INVALID',
    );
    assert.deepEqual(await treeSnapshot(workspace.toolsRoot), before);
  });
});

test('portable runtime installer rejects corrupt ZIP and checksum mismatch without changing tools bytes', async (t) => {
  const module = await loadInstaller();
  for (const [name, archive, checksums] of [
    ['corrupt ZIP', Buffer.from('not a zip'), checksumsFor(Buffer.from('not a zip'))],
    ['checksum mismatch', await zipBytes([{ name: `${archiveRoot}/node.exe`, bytes: Buffer.from('x') }]), Buffer.from(`${'0'.repeat(64)}  node-v${expectedVersion}-win-x64.zip\n`)],
    ['missing exact checksum filename', await zipBytes([{ name: `${archiveRoot}/node.exe`, bytes: Buffer.from('x') }]), Buffer.from(`${'0'.repeat(64)}  another.zip\n`)],
  ]) await t.test(name, async () => {
    const workspace = await installerWorkspace(t);
    const before = await treeSnapshot(workspace.toolsRoot);
    const installPortableRuntime = testInstaller(module, archive);
    await assert.rejects(
      installPortableRuntime({ zipBytes: archive, checksumsBytes: checksums, toolsRoot: workspace.toolsRoot, expectedVersion }),
      (error) => error?.code === 'PORTABLE_RUNTIME_INVALID',
    );
    assert.deepEqual(await treeSnapshot(workspace.toolsRoot), before);
  });
});

test('portable runtime installer rejects duplicate checksum records and existing destination without mutation', async (t) => {
  const module = await loadInstaller();
  const archive = await zipBytes([{ name: `${archiveRoot}/node.exe`, bytes: Buffer.from('x') }]);
  const correct = createHash('sha256').update(archive).digest('hex');
  for (const [name, prepare, checksums] of [
    ['duplicate checksum', async () => {}, Buffer.from(`${correct}  node-v${expectedVersion}-win-x64.zip\n${correct}  node-v${expectedVersion}-win-x64.zip\n`)],
    ['conflicting checksum', async () => {}, Buffer.from(`${correct}  node-v${expectedVersion}-win-x64.zip\n${'0'.repeat(64)}  node-v${expectedVersion}-win-x64.zip\n`)],
    ['existing destination', async (toolsRoot) => { await mkdir(path.join(toolsRoot, 'node')); await writeFile(path.join(toolsRoot, 'node', 'sentinel.txt'), 'existing runtime\n'); }, checksumsFor(archive)],
  ]) await t.test(name, async () => {
    const workspace = await installerWorkspace(t);
    await prepare(workspace.toolsRoot);
    const before = await treeSnapshot(workspace.toolsRoot);
    const installPortableRuntime = testInstaller(module, archive);
    await assert.rejects(
      installPortableRuntime({ zipBytes: archive, checksumsBytes: checksums, toolsRoot: workspace.toolsRoot, expectedVersion }),
      (error) => error?.code === 'PORTABLE_RUNTIME_INVALID',
    );
    assert.deepEqual(await treeSnapshot(workspace.toolsRoot), before);
  });
});
