import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { createTestWorkspace } from '../../test/helpers.mjs';
import { acquireOperationLock } from '../server/operation-lock.mjs';

const run = promisify(execFile);
const emptyManifest = { hash: 'a'.repeat(64), compatibilityHash: 'b'.repeat(64), files: {} };

function completeJournal(operationId, overrides = {}) {
  return {
    formatVersion: 1,
    operationId,
    kind: 'save',
    createdAt: '2026-08-12T12:00:00.000Z',
    phase: 'complete',
    baseManifestHash: 'c'.repeat(64),
    before: { content: emptyManifest, dist: emptyManifest },
    candidate: { content: emptyManifest, dist: emptyManifest },
    ...overrides,
  };
}

test('a second request receives OPERATION_BUSY while the sentinel workspace lease is held', async (t) => {
  const workspace = await createTestWorkspace();
  const backupRoot = path.join(workspace.root, '.local-editor', 'backups');
  await mkdir(backupRoot, { recursive: true });
  const first = await acquireOperationLock({
    backupRoot,
    ownerNonce: randomBytes(16).toString('hex'),
    pid: process.pid,
    startedAt: new Date().toISOString(),
  });
  t.after(async () => { try { await first.release(); } finally { await workspace.cleanup(); } });
  await assert.rejects(
    acquireOperationLock({
      backupRoot,
      ownerNonce: randomBytes(16).toString('hex'),
      pid: process.pid,
      startedAt: new Date().toISOString(),
    }),
    (error) => error?.code === 'OPERATION_BUSY',
  );
});

test('a separately spawned editor process receives OPERATION_BUSY while the lease is held', async (t) => {
  const workspace = await createTestWorkspace();
  const backupRoot = path.join(workspace.root, '.local-editor', 'backups');
  await mkdir(backupRoot, { recursive: true });
  const lease = await acquireOperationLock({ backupRoot, ownerNonce: 'a'.repeat(32), pid: process.pid, startedAt: new Date().toISOString() });
  t.after(async () => { try { await lease.release(); } finally { await workspace.cleanup(); } });
  const moduleUrl = pathToFileURL(path.resolve('editor/server/operation-lock.mjs')).href;
  const source = `
    import { acquireOperationLock } from ${JSON.stringify(moduleUrl)};
    try {
      await acquireOperationLock({ backupRoot: process.argv[1], ownerNonce: 'b'.repeat(32), pid: process.pid, startedAt: new Date().toISOString() });
      process.stdout.write('ACQUIRED');
    } catch (error) {
      process.stdout.write(String(error?.code));
    }
  `;
  const child = await run(process.execPath, ['--input-type=module', '-e', source, backupRoot], { timeout: 5_000, windowsHide: true });
  assert.equal(child.stdout, 'OPERATION_BUSY');
});

test('release never deletes a lock record whose owner nonce was replaced', async (t) => {
  const workspace = await createTestWorkspace();
  t.after(workspace.cleanup);
  const backupRoot = path.join(workspace.root, '.local-editor', 'backups');
  await mkdir(backupRoot, { recursive: true });
  const lease = await acquireOperationLock({ backupRoot, ownerNonce: 'c'.repeat(32), pid: process.pid, startedAt: new Date().toISOString() });
  const replacement = `${JSON.stringify({ formatVersion: 1, ownerNonce: 'd'.repeat(32), pid: process.pid, startedAt: new Date().toISOString() })}\n`;
  await writeFile(path.join(backupRoot, '.operation.lock'), replacement);
  await assert.rejects(lease.release(), (error) => error?.code === 'LOCK_OWNERSHIP_LOST');
  assert.equal(await readFile(path.join(backupRoot, '.operation.lock'), 'utf8'), replacement);
});

test('a proven-dead owner is replaced only after operation journals are structurally proven', async (t) => {
  const workspace = await createTestWorkspace();
  t.after(workspace.cleanup);
  const backupRoot = path.join(workspace.root, '.local-editor', 'backups');
  const operationId = '20260812T120000Z-0001';
  await mkdir(path.join(backupRoot, operationId), { recursive: true });
  await writeFile(path.join(backupRoot, operationId, 'journal.json'), `${JSON.stringify(completeJournal(operationId))}\n`);
  const dead = `${JSON.stringify({ formatVersion: 1, ownerNonce: 'e'.repeat(32), pid: 999_999, startedAt: '2026-08-12T12:00:00.000Z' })}\n`;
  await writeFile(path.join(backupRoot, '.operation.lock'), dead);
  const lease = await acquireOperationLock({
    backupRoot, ownerNonce: 'f'.repeat(32), pid: process.pid, startedAt: new Date().toISOString(),
    isProcessAlive: () => false,
  });
  await lease.release();
  await assert.rejects(readFile(path.join(backupRoot, '.operation.lock'), 'utf8'), (error) => error?.code === 'ENOENT');
});

test('stale lock takeover rejects unknown phases and incomplete terminal manifests', async (t) => {
  for (const [label, journal] of [
    ['unknown phase', completeJournal('20260812T120000Z-0001', { phase: 'invented-phase' })],
    ['missing candidate manifests', completeJournal('20260812T120000Z-0001', { candidate: {} })],
    ['unsafe manifest path', completeJournal('20260812T120000Z-0001', { before: { content: { ...emptyManifest, files: { '../escape': { length: 1, sha256: 'd'.repeat(64) } } }, dist: emptyManifest } })],
    ['archive promotion phase', completeJournal('20260812T120000Z-0001', { kind: 'archive', phase: 'before-old-content-rename' })],
  ]) await t.test(label, async (t) => {
    const workspace = await createTestWorkspace(); t.after(workspace.cleanup);
    const backupRoot = path.join(workspace.root, '.local-editor', 'backups');
    const operationId = '20260812T120000Z-0001';
    await mkdir(path.join(backupRoot, operationId), { recursive: true });
    await writeFile(path.join(backupRoot, operationId, 'journal.json'), `${JSON.stringify(journal)}\n`);
    const dead = `${JSON.stringify({ formatVersion: 1, ownerNonce: '3'.repeat(32), pid: 999_999, startedAt: '2026-08-12T12:00:00.000Z' })}\n`;
    await writeFile(path.join(backupRoot, '.operation.lock'), dead);
    await assert.rejects(
      acquireOperationLock({ backupRoot, ownerNonce: '4'.repeat(32), pid: process.pid, startedAt: new Date().toISOString(), isProcessAlive: () => false }),
      (error) => error?.code === 'LOCK_RECOVERY_REQUIRED',
      label,
    );
    assert.equal(await readFile(path.join(backupRoot, '.operation.lock'), 'utf8'), dead);
  });
});

test('a dead-owner lock and malformed matching journal remain preserved for manual recovery', async (t) => {
  const workspace = await createTestWorkspace();
  t.after(workspace.cleanup);
  const backupRoot = path.join(workspace.root, '.local-editor', 'backups');
  const operationId = '20260812T120000Z-0001';
  await mkdir(path.join(backupRoot, operationId), { recursive: true });
  await writeFile(path.join(backupRoot, operationId, 'journal.json'), '{broken');
  const dead = `${JSON.stringify({ formatVersion: 1, ownerNonce: '1'.repeat(32), pid: 999_999, startedAt: '2026-08-12T12:00:00.000Z' })}\n`;
  await writeFile(path.join(backupRoot, '.operation.lock'), dead);
  await assert.rejects(
    acquireOperationLock({ backupRoot, ownerNonce: '2'.repeat(32), pid: process.pid, startedAt: new Date().toISOString(), isProcessAlive: () => false }),
    (error) => error?.code === 'LOCK_RECOVERY_REQUIRED',
  );
  assert.equal(await readFile(path.join(backupRoot, '.operation.lock'), 'utf8'), dead);
});
