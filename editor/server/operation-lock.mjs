import * as nodeFs from 'node:fs/promises';
import path from 'node:path';
import { assertConfinedPath } from './path-policy.mjs';

const NONCE = /^[a-f0-9]{32,128}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const LOCK_NAME = '.operation.lock';
const OPERATION_ID = /^\d{8}T\d{6}Z-\d{4}$/;
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
const JOURNAL_PHASES = new Set([
  'preparing-candidate', 'candidate-built', 'candidate-failed', 'conflict-before-promotion',
  'before-old-content-rename', 'old-content-renamed', 'before-new-content-promotion', 'new-content-promoted',
  'before-old-dist-rename', 'old-dist-renamed', 'before-new-dist-promotion', 'new-dist-promoted',
  'before-conflict-content-restore', 'conflict-restored-before-content-promotion',
  'before-conflict-new-content-rollback', 'conflict-new-content-rolled-back',
  'before-conflict-old-content-restore', 'conflict-old-content-restored',
  'before-conflict-dist-restore', 'conflict-restored-before-dist-promotion',
  'manual-recovery-required', 'recovered-old', 'complete',
]);
const PHASES_WITHOUT_CANDIDATE_MANIFEST = new Set(['preparing-candidate', 'candidate-failed']);
const ARCHIVE_PHASES = new Set(['preparing-candidate', 'candidate-failed', 'complete']);

function failure(code, message) {
  return Object.assign(new Error(message), { code });
}

function ownerRecord({ ownerNonce, pid, startedAt }) {
  if (!NONCE.test(ownerNonce ?? '') || !Number.isSafeInteger(pid) || pid < 1 || typeof startedAt !== 'string' || new Date(startedAt).toISOString() !== startedAt) {
    throw failure('BAD_INPUT', '操作锁身份无效');
  }
  return { formatVersion: 1, ownerNonce, pid, startedAt };
}

async function syncDirectory(directory, filesystem) {
  const handle = await filesystem.open(directory, 'r');
  try {
    await handle.sync();
  } catch (error) {
    if (process.platform !== 'win32' || !['EPERM', 'EINVAL'].includes(error?.code)) throw error;
  } finally { await handle.close(); }
}

async function confined(backupRoot, relativePath, mustExist, operation, filesystem) {
  return assertConfinedPath({ root: backupRoot, relativePath, mustExist, operation, filesystem });
}

function parseOwner(source) {
  let value;
  try { value = JSON.parse(source); } catch { throw failure('LOCK_RECOVERY_REQUIRED', '操作锁记录损坏'); }
  if (!value || value.formatVersion !== 1 || !NONCE.test(value.ownerNonce ?? '') || !Number.isSafeInteger(value.pid) || value.pid < 1 || typeof value.startedAt !== 'string') {
    throw failure('LOCK_RECOVERY_REQUIRED', '操作锁记录损坏');
  }
  return value;
}

function validManifestPath(value) {
  if (typeof value !== 'string' || !value || value.includes('\0') || value.includes('\\') || value.includes('%') || path.posix.isAbsolute(value) || path.win32.isAbsolute(value) || /^[a-zA-Z]:/.test(value) || value.startsWith('//')) return false;
  const segments = value.split('/');
  return segments.every((segment) => segment && segment !== '.' && segment !== '..' && !/[:\x00-\x1f]/.test(segment) && !/[. ]$/.test(segment) && !RESERVED.test(segment));
}

function validManifest(value) {
  return value && typeof value === 'object' && !Array.isArray(value) && SHA256.test(value.hash ?? '') && SHA256.test(value.compatibilityHash ?? '') && value.files && typeof value.files === 'object' && !Array.isArray(value.files)
    && Object.entries(value.files).every(([name, file]) => validManifestPath(name) && file && typeof file === 'object' && !Array.isArray(file) && Number.isSafeInteger(file.length) && file.length >= 0 && SHA256.test(file.sha256 ?? ''));
}

function validConflict(value) {
  if (value === undefined) return true;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return keys.length > 0 && keys.every((key) => ['content', 'dist'].includes(key) && validManifest(value[key]));
}

export function isStructurallyValidOperationJournal(value, expectedId) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.formatVersion !== 1 || value.operationId !== expectedId || !OPERATION_ID.test(value.operationId ?? '') || !['save', 'archive', 'restore'].includes(value.kind) || !JOURNAL_PHASES.has(value.phase) || !SHA256.test(value.baseManifestHash ?? '') || !validManifest(value.before?.content) || !validManifest(value.before?.dist) || !value.candidate || typeof value.candidate !== 'object' || Array.isArray(value.candidate) || !validConflict(value.conflict)) return false;
  try { if (new Date(value.createdAt).toISOString() !== value.createdAt) return false; } catch { return false; }
  if (value.kind === 'restore' && !OPERATION_ID.test(value.sourceBackupId ?? '')) return false;
  if (value.kind !== 'restore' && value.sourceBackupId !== undefined) return false;
  if (value.kind === 'archive' && (!ARCHIVE_PHASES.has(value.phase) || value.conflict !== undefined)) return false;
  if (!PHASES_WITHOUT_CANDIDATE_MANIFEST.has(value.phase) && (!validManifest(value.candidate.content) || !validManifest(value.candidate.dist))) return false;
  return true;
}

async function assertRecoverableJournals(root, filesystem) {
  for (const entry of await filesystem.readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !OPERATION_ID.test(entry.name)) continue;
    const journalPath = await confined(root, `${entry.name}/journal.json`, true, 'read', filesystem);
    let journal;
    try { journal = JSON.parse(await filesystem.readFile(journalPath, 'utf8')); }
    catch { throw failure('LOCK_RECOVERY_REQUIRED', '编辑事务记录损坏'); }
    if (!isStructurallyValidOperationJournal(journal, entry.name)) {
      throw failure('LOCK_RECOVERY_REQUIRED', '编辑事务记录损坏');
    }
  }
}

async function claimStaleLock({ root, lockPath, filesystem, isProcessAlive }) {
  const source = await filesystem.readFile(lockPath, 'utf8');
  const owner = parseOwner(source);
  if (await isProcessAlive(owner.pid)) throw failure('OPERATION_BUSY', '另一个编辑操作正在进行');
  await assertRecoverableJournals(root, filesystem);
  const claimName = `${LOCK_NAME}.stale-${owner.ownerNonce}`;
  const claimPath = await confined(root, claimName, false, 'rename', filesystem);
  await confined(root, LOCK_NAME, true, 'rename', filesystem);
  try { await filesystem.rename(lockPath, claimPath); }
  catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
  if (await filesystem.readFile(claimPath, 'utf8') !== source) throw failure('LOCK_RECOVERY_REQUIRED', '操作锁所有权无法证明');
  await confined(root, claimName, true, 'delete', filesystem);
  await filesystem.unlink(claimPath);
  await syncDirectory(root, filesystem);
  return true;
}

function defaultProcessAlive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { return error?.code !== 'ESRCH'; }
}

export async function acquireOperationLock({ backupRoot, ownerNonce, pid, startedAt, filesystem = nodeFs, isProcessAlive = defaultProcessAlive }) {
  const record = ownerRecord({ ownerNonce, pid, startedAt });
  const metadata = `${JSON.stringify(record)}\n`;
  const rootInfo = await filesystem.lstat(backupRoot);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw failure('LOCK_RECOVERY_REQUIRED', '操作锁根目录不安全');
  const root = await filesystem.realpath(backupRoot);
  const lockPath = await confined(backupRoot, LOCK_NAME, false, 'copy', filesystem);
  if (typeof isProcessAlive !== 'function') throw failure('BAD_INPUT', '操作锁存活检查无效');
  let handle;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await confined(backupRoot, LOCK_NAME, false, 'copy', filesystem);
      handle = await filesystem.open(lockPath, 'wx', 0o600);
      break;
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      if (attempt > 0 || !(await claimStaleLock({ root, lockPath, filesystem, isProcessAlive }))) throw failure('OPERATION_BUSY', '另一个编辑操作正在进行');
    }
  }
  try {
    await handle.writeFile(metadata, 'utf8');
    await handle.sync();
  } catch (error) {
    try { await handle.close(); } catch { /* Keep the original failure. */ }
    try {
      if (await filesystem.readFile(lockPath, 'utf8') === metadata) {
        await confined(root, LOCK_NAME, true, 'delete', filesystem);
        await filesystem.unlink(lockPath);
      }
    } catch { /* Preserve uncertain lock state. */ }
    throw error;
  }
  await handle.close();
  await syncDirectory(root, filesystem);

  let released = false;
  return {
    ownerNonce,
    async release() {
      if (released) return;
      const claimName = `${LOCK_NAME}.release-${ownerNonce}`;
      const claimPath = await confined(root, claimName, false, 'rename', filesystem);
      await confined(root, LOCK_NAME, true, 'rename', filesystem);
      try {
        await filesystem.rename(lockPath, claimPath);
      } catch (error) {
        if (error?.code === 'ENOENT') throw failure('LOCK_OWNERSHIP_LOST', '操作锁所有权已丢失');
        throw error;
      }
      let claimed;
      try { claimed = await filesystem.readFile(claimPath, 'utf8'); } catch (error) {
        throw failure('LOCK_OWNERSHIP_LOST', '操作锁所有权无法证明', { cause: error });
      }
      if (claimed !== metadata) {
        try {
          await confined(root, claimName, true, 'rename', filesystem);
          await confined(root, LOCK_NAME, false, 'rename', filesystem);
          await filesystem.rename(claimPath, lockPath);
          await syncDirectory(root, filesystem);
        } catch { /* Preserve every uncertain record for manual recovery. */ }
        throw failure('LOCK_OWNERSHIP_LOST', '操作锁所有权已丢失');
      }
      await confined(root, claimName, true, 'delete', filesystem);
      await filesystem.unlink(claimPath);
      await syncDirectory(root, filesystem);
      released = true;
    },
  };
}
