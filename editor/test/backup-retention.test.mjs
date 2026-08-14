import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, rename, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { createTestWorkspace } from '../../test/helpers.mjs';
import { createRepositoryService } from '../server/repository-service.mjs';
import { createTransactionService } from '../server/transaction-service.mjs';

test('a fresh sentinel workspace exposes no editor backups', async (t) => {
  const workspace = await createTestWorkspace();
  t.after(workspace.cleanup);
  const distRoot = path.join(workspace.root, 'dist');
  const backupRoot = path.join(workspace.root, '.local-editor', 'backups');
  await mkdir(distRoot, { recursive: true });
  await mkdir(backupRoot, { recursive: true });
  const service = createTransactionService({
    projectRoot: workspace.root,
    contentRoot: path.join(workspace.root, 'src', 'content'),
    distRoot,
    backupRoot,
    buildCandidate: async () => assert.fail('listing backups must not build'),
  });
  assert.deepEqual(await service.listBackups(), []);
});

test('record 21 prunes only the oldest valid editor record and preserves unmanifested directories', async (t) => {
  const workspace = await createTestWorkspace(); t.after(workspace.cleanup);
  const contentRoot = path.join(workspace.root, 'src', 'content');
  const distRoot = path.join(workspace.root, 'dist');
  const backupRoot = path.join(workspace.root, '.local-editor', 'backups');
  await mkdir(distRoot, { recursive: true }); await writeFile(path.join(distRoot, 'index.html'), 'old\n'); await mkdir(backupRoot, { recursive: true });
  const foreign = path.join(backupRoot, 'foreign-directory'); await mkdir(foreign); await writeFile(path.join(foreign, 'keep.txt'), 'keep forever\n');
  const bootstrap = await createRepositoryService({ projectRoot: workspace.root, csrfToken: 'csrf' }).bootstrap();
  const input = { baseManifestHash: bootstrap.baseManifestHash, bundle: { baseManifestHash: bootstrap.baseManifestHash, sessionId: 'a'.repeat(32), content: { site: bootstrap.site, about: bootstrap.about, projects: bootstrap.projects, research: bootstrap.research }, images: bootstrap.images.map(({ destination, sha256 }) => ({ kind: 'canonical', destination, sha256 })) }, uploads: [] };
  let sequence = 0;
  const service = createTransactionService({
    projectRoot: workspace.root, contentRoot, distRoot, backupRoot,
    clock: () => new Date(`2026-08-12T12:00:${String(sequence).padStart(2, '0')}.000Z`),
    idFactory: () => `20260812T1200${String(++sequence).padStart(2, '0')}Z-0001`,
    buildCandidate: async () => { throw new Error('expected diagnostic'); },
  });
  for (let count = 0; count < 21; count += 1) await assert.rejects(service.save(input), (error) => error?.code === 'CANDIDATE_BUILD_FAILED');
  const backups = await service.listBackups();
  assert.equal(backups.length, 20);
  assert.equal(backups[0].id, '20260812T120002Z-0001');
  assert.equal(backups.at(-1).id, '20260812T120021Z-0001');
  assert.ok(backups.every((record) => record.kind === 'save' && record.phase === 'candidate-failed'));
  assert.deepEqual((await readdir(backupRoot)).sort(), ['foreign-directory', ...backups.map((record) => record.id)].sort());
  assert.equal(await readFile(path.join(foreign, 'keep.txt'), 'utf8'), 'keep forever\n');
});

test('retention rejects a nested reparse point before pruning any record and persists recovery-only', async (t) => {
  const workspace = await createTestWorkspace(); t.after(workspace.cleanup);
  const contentRoot = path.join(workspace.root, 'src', 'content');
  const distRoot = path.join(workspace.root, 'dist');
  const backupRoot = path.join(workspace.root, '.local-editor', 'backups');
  await mkdir(distRoot, { recursive: true }); await writeFile(path.join(distRoot, 'index.html'), 'old\n'); await mkdir(backupRoot, { recursive: true });
  const bootstrap = await createRepositoryService({ projectRoot: workspace.root, csrfToken: 'csrf' }).bootstrap();
  const input = { baseManifestHash: bootstrap.baseManifestHash, bundle: { baseManifestHash: bootstrap.baseManifestHash, sessionId: 'a'.repeat(32), content: { site: bootstrap.site, about: bootstrap.about, projects: bootstrap.projects, research: bootstrap.research }, images: bootstrap.images.map(({ destination, sha256 }) => ({ kind: 'canonical', destination, sha256 })) }, uploads: [] };
  let sequence = 0;
  const options = {
    projectRoot: workspace.root, contentRoot, distRoot, backupRoot,
    clock: () => new Date(`2026-08-12T12:20:${String(sequence).padStart(2, '0')}.000Z`),
    idFactory: () => `20260812T1220${String(++sequence).padStart(2, '0')}Z-0001`,
    buildCandidate: async () => { throw new Error('expected diagnostic'); },
  };
  const service = createTransactionService(options);
  for (let count = 0; count < 20; count += 1) await assert.rejects(service.save(input), (error) => error?.code === 'CANDIDATE_BUILD_FAILED');
  const oldest = path.join(backupRoot, '20260812T122001Z-0001');
  const outside = path.join(workspace.parent, 'outside-retention-reparse');
  const link = path.join(oldest, 'unsafe-link');
  await mkdir(outside, { recursive: true }); await writeFile(path.join(outside, 'keep.txt'), 'outside bytes\n');
  try { await symlink(outside, link, 'junction'); }
  catch (error) {
    await rm(outside, { recursive: true, force: true });
    if (['EPERM', 'EACCES'].includes(error?.code)) { t.skip('junction creation unavailable'); return; }
    throw error;
  }
  const recordsBefore = (await readdir(backupRoot)).filter((name) => /^\d{8}T\d{6}Z-\d{4}$/.test(name)).sort();
  try {
    await assert.rejects(service.save(input), (error) => error?.code === 'RECOVERY_REQUIRED');
    assert.equal(service.isRecoveryOnly(), true);
    assert.deepEqual((await readdir(backupRoot)).filter((name) => /^\d{8}T\d{6}Z-\d{4}$/.test(name)).sort(), recordsBefore);
    assert.equal(await readFile(path.join(outside, 'keep.txt'), 'utf8'), 'outside bytes\n');
    const restarted = createTransactionService(options);
    assert.deepEqual(await restarted.recoverBeforeListen(), { ok: false, recoveryOnly: true, messageZh: '检测到无法自动恢复的编辑记录，请保留现场并人工检查。' });
  } finally {
    await rm(link, { force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test('archiveDraft records a recoverable draft without building or promoting canonical trees', async (t) => {
  const workspace = await createTestWorkspace(); t.after(workspace.cleanup);
  const contentRoot = path.join(workspace.root, 'src', 'content');
  const distRoot = path.join(workspace.root, 'dist');
  const backupRoot = path.join(workspace.root, '.local-editor', 'backups');
  await mkdir(distRoot, { recursive: true }); await writeFile(path.join(distRoot, 'index.html'), 'old\n'); await mkdir(backupRoot, { recursive: true });
  const bootstrap = await createRepositoryService({ projectRoot: workspace.root, csrfToken: 'csrf' }).bootstrap();
  const input = { baseManifestHash: bootstrap.baseManifestHash, bundle: { baseManifestHash: bootstrap.baseManifestHash, sessionId: 'a'.repeat(32), content: { site: { ...bootstrap.site, name: 'Archived Draft' }, about: bootstrap.about, projects: bootstrap.projects, research: bootstrap.research }, images: bootstrap.images.map(({ destination, sha256 }) => ({ kind: 'canonical', destination, sha256 })) }, uploads: [] };
  const beforeContent = await readFile(path.join(contentRoot, 'site.yml'), 'utf8'), beforeDist = await readFile(path.join(distRoot, 'index.html'), 'utf8');
  let builds = 0;
  const service = createTransactionService({ projectRoot: workspace.root, contentRoot, distRoot, backupRoot, clock: () => new Date('2026-08-12T12:00:00.000Z'), idFactory: () => '20260812T120000Z-0001', buildCandidate: async () => { builds += 1; } });
  const summary = await service.archiveDraft(input);
  assert.deepEqual(summary, { id: '20260812T120000Z-0001', kind: 'archive', phase: 'complete', createdAt: '2026-08-12T12:00:00.000Z' });
  assert.equal(builds, 0);
  assert.equal(await readFile(path.join(contentRoot, 'site.yml'), 'utf8'), beforeContent);
  assert.equal(await readFile(path.join(distRoot, 'index.html'), 'utf8'), beforeDist);
  assert.equal((await readFile(path.join(backupRoot, summary.id, '.candidate', 'site.yml'), 'utf8')).includes('Archived Draft'), true);
  assert.deepEqual(await service.listBackups(), [summary]);
});

test('default operation identifiers remain unique for multiple operations in the same second', async (t) => {
  const workspace = await createTestWorkspace(); t.after(workspace.cleanup);
  const contentRoot = path.join(workspace.root, 'src', 'content');
  const distRoot = path.join(workspace.root, 'dist');
  const backupRoot = path.join(workspace.root, '.local-editor', 'backups');
  await mkdir(distRoot, { recursive: true }); await writeFile(path.join(distRoot, 'index.html'), 'old\n'); await mkdir(backupRoot, { recursive: true });
  const bootstrap = await createRepositoryService({ projectRoot: workspace.root, csrfToken: 'csrf' }).bootstrap();
  const input = { baseManifestHash: bootstrap.baseManifestHash, bundle: { baseManifestHash: bootstrap.baseManifestHash, sessionId: 'a'.repeat(32), content: { site: bootstrap.site, about: bootstrap.about, projects: bootstrap.projects, research: bootstrap.research }, images: bootstrap.images.map(({ destination, sha256 }) => ({ kind: 'canonical', destination, sha256 })) }, uploads: [] };
  const service = createTransactionService({ projectRoot: workspace.root, contentRoot, distRoot, backupRoot, clock: () => new Date('2026-08-12T12:30:00.000Z'), buildCandidate: async () => assert.fail('archive must not build') });
  const first = await service.archiveDraft(input);
  const second = await service.archiveDraft(input);
  assert.equal(first.id, '20260812T123000Z-0001');
  assert.equal(second.id, '20260812T123000Z-0002');
  assert.deepEqual((await service.listBackups()).map(({ id }) => id), [first.id, second.id]);
});

test('confirmation records are short-lived, session/action/target bound, single-use, and restart-local', async (t) => {
  const workspace = await createTestWorkspace(); t.after(workspace.cleanup);
  const contentRoot = path.join(workspace.root, 'src', 'content'), distRoot = path.join(workspace.root, 'dist'), backupRoot = path.join(workspace.root, '.local-editor', 'backups');
  await mkdir(distRoot, { recursive: true }); await writeFile(path.join(distRoot, 'index.html'), 'old\n'); await mkdir(backupRoot, { recursive: true });
  let now = new Date('2026-08-12T12:00:00.000Z');
  const options = { projectRoot: workspace.root, contentRoot, distRoot, backupRoot, clock: () => now, idFactory: () => '20260812T120000Z-0001', buildCandidate: async () => {} };
  const service = createTransactionService(options);
  const issued = service.issueConfirmation({ sessionId: 'a'.repeat(32), action: 'restore', targetId: '20260812T120000Z-0001', diffHash: 'b'.repeat(64), draftHash: 'c'.repeat(64), canonicalManifestHash: 'd'.repeat(64), now });
  assert.match(issued.token, /^[a-f0-9]{64}$/);
  assert.equal(issued.expiresAt, '2026-08-12T12:05:00.000Z');
  assert.equal(JSON.stringify(issued).includes('aaaa'), false);
  for (const context of [
    { ...issued, sessionId: 'e'.repeat(32), action: 'restore', targetId: '20260812T120000Z-0001' },
    { ...issued, sessionId: 'a'.repeat(32), action: 'save', targetId: '20260812T120000Z-0001' },
    { ...issued, sessionId: 'a'.repeat(32), action: 'restore', targetId: '20260812T120001Z-0001' },
  ]) assert.throws(() => service.consumeConfirmation(context), (error) => error?.code === 'FORBIDDEN');
  const consumed = service.consumeConfirmation({ ...issued, sessionId: 'a'.repeat(32), action: 'restore', targetId: '20260812T120000Z-0001' });
  assert.deepEqual(consumed, { sessionId: 'a'.repeat(32), action: 'restore', targetId: '20260812T120000Z-0001', diffHash: 'b'.repeat(64), draftHash: 'c'.repeat(64), canonicalManifestHash: 'd'.repeat(64) });
  assert.throws(() => service.consumeConfirmation({ ...issued, sessionId: 'a'.repeat(32), action: 'restore', targetId: '20260812T120000Z-0001' }), (error) => error?.code === 'FORBIDDEN');
  const restart = createTransactionService(options);
  const restartToken = service.issueConfirmation({ sessionId: 'a'.repeat(32), action: 'restore', targetId: '20260812T120000Z-0001', diffHash: 'b'.repeat(64), draftHash: 'c'.repeat(64), canonicalManifestHash: 'd'.repeat(64), now });
  assert.throws(() => restart.consumeConfirmation({ ...restartToken, sessionId: 'a'.repeat(32), action: 'restore', targetId: '20260812T120000Z-0001' }), (error) => error?.code === 'FORBIDDEN');
  now = new Date('2026-08-12T12:06:00.000Z');
  const expired = service.issueConfirmation({ sessionId: 'a'.repeat(32), action: 'restore', targetId: '20260812T120000Z-0001', diffHash: 'b'.repeat(64), draftHash: 'c'.repeat(64), canonicalManifestHash: 'd'.repeat(64), now: new Date('2026-08-12T12:00:00.000Z') });
  assert.throws(() => service.consumeConfirmation({ ...expired, sessionId: 'a'.repeat(32), action: 'restore', targetId: '20260812T120000Z-0001' }), (error) => error?.code === 'FORBIDDEN');
});

test('restore confirmation uses the trusted session argument and ignores a forged token payload session', async (t) => {
  const workspace = await createTestWorkspace(); t.after(workspace.cleanup);
  const contentRoot = path.join(workspace.root, 'src', 'content'), distRoot = path.join(workspace.root, 'dist'), backupRoot = path.join(workspace.root, '.local-editor', 'backups');
  await mkdir(distRoot, { recursive: true }); await writeFile(path.join(distRoot, 'index.html'), 'old\n'); await mkdir(backupRoot, { recursive: true });
  const bootstrap = await createRepositoryService({ projectRoot: workspace.root, csrfToken: 'csrf' }).bootstrap();
  const input = { baseManifestHash: bootstrap.baseManifestHash, bundle: { baseManifestHash: bootstrap.baseManifestHash, sessionId: 'a'.repeat(32), content: { site: { ...bootstrap.site, name: 'Session-bound restore' }, about: bootstrap.about, projects: bootstrap.projects, research: bootstrap.research }, images: bootstrap.images.map(({ destination, sha256 }) => ({ kind: 'canonical', destination, sha256 })) }, uploads: [] };
  let sequence = 0;
  const service = createTransactionService({ projectRoot: workspace.root, contentRoot, distRoot, backupRoot, clock: () => new Date(`2026-08-12T12:40:0${sequence}.000Z`), idFactory: () => `20260812T12400${++sequence}Z-0001`, buildCandidate: async ({ distRoot: target }) => writeFile(path.join(target, 'index.html'), 'restored\n') });
  const source = await service.archiveDraft(input);
  const viewed = await service.diffBackup(source.id, { sessionId: 'a'.repeat(32) });
  const before = await readdir(backupRoot);
  await assert.rejects(service.restore({ id: source.id, sessionId: 'b'.repeat(32), confirmationToken: { ...viewed.confirmation, sessionId: 'a'.repeat(32) } }), (error) => error?.code === 'FORBIDDEN');
  assert.deepEqual((await readdir(backupRoot)).sort(), before.sort());
});

test('restore uses a bound diff token, creates a pre-restore record, and never mutates its source backup', async (t) => {
  const workspace = await createTestWorkspace(); t.after(workspace.cleanup);
  const contentRoot = path.join(workspace.root, 'src', 'content'), distRoot = path.join(workspace.root, 'dist'), backupRoot = path.join(workspace.root, '.local-editor', 'backups');
  await mkdir(distRoot, { recursive: true }); await writeFile(path.join(distRoot, 'index.html'), 'old canonical\n'); await mkdir(backupRoot, { recursive: true });
  const bootstrap = await createRepositoryService({ projectRoot: workspace.root, csrfToken: 'csrf' }).bootstrap();
  const input = { baseManifestHash: bootstrap.baseManifestHash, bundle: { baseManifestHash: bootstrap.baseManifestHash, sessionId: 'a'.repeat(32), content: { site: { ...bootstrap.site, name: 'Restored Draft' }, about: bootstrap.about, projects: bootstrap.projects, research: bootstrap.research }, images: bootstrap.images.map(({ destination, sha256 }) => ({ kind: 'canonical', destination, sha256 })) }, uploads: [] };
  let sequence = 0;
  const service = createTransactionService({ projectRoot: workspace.root, contentRoot, distRoot, backupRoot, clock: () => new Date(`2026-08-12T12:00:0${sequence}.000Z`), idFactory: () => `20260812T12000${++sequence}Z-0001`, buildCandidate: async ({ contentRoot: source, distRoot: target }) => writeFile(path.join(target, 'index.html'), await readFile(path.join(source, 'site.yml'), 'utf8')) });
  const source = await service.archiveDraft(input);
  const sourceJournalBefore = await readFile(path.join(backupRoot, source.id, 'journal.json'));
  const sourceDraftBefore = await readFile(path.join(backupRoot, source.id, '.candidate', 'site.yml'));
  const viewed = await service.diffBackup(source.id, { sessionId: 'a'.repeat(32) });
  assert.ok(viewed.diff.changed.includes('site.yml'));
  assert.match(viewed.diffHash, /^[a-f0-9]{64}$/);
  assert.match(viewed.draftHash, /^[a-f0-9]{64}$/);
  assert.match(viewed.confirmation.token, /^[a-f0-9]{64}$/);
  const result = await service.restore({ id: source.id, sessionId: 'a'.repeat(32), confirmationToken: viewed.confirmation.token });
  assert.equal(result.ok, true);
  assert.equal(result.operationId, '20260812T120002Z-0001');
  assert.equal((await readFile(path.join(contentRoot, 'site.yml'), 'utf8')).includes('Restored Draft'), true);
  assert.equal((await readFile(path.join(distRoot, 'index.html'), 'utf8')).includes('Restored Draft'), true);
  assert.deepEqual(await readFile(path.join(backupRoot, source.id, 'journal.json')), sourceJournalBefore);
  assert.deepEqual(await readFile(path.join(backupRoot, source.id, '.candidate', 'site.yml')), sourceDraftBefore);
  const restoreJournal = JSON.parse(await readFile(path.join(backupRoot, result.operationId, 'journal.json'), 'utf8'));
  assert.equal(restoreJournal.kind, 'restore');
  assert.equal(restoreJournal.sourceBackupId, source.id);
  assert.equal(restoreJournal.phase, 'complete');
  assert.equal(await readFile(path.join(backupRoot, result.operationId, 'before', 'dist', 'index.html'), 'utf8'), 'old canonical\n');

  const preRestoreSource = await readFile(path.join(backupRoot, result.operationId, 'before', 'content', 'site.yml'));
  const reverseView = await service.diffBackup(result.operationId, { sessionId: 'a'.repeat(32) });
  assert.ok(reverseView.diff.changed.includes('site.yml'));
  const reverse = await service.restore({ id: result.operationId, sessionId: 'a'.repeat(32), confirmationToken: reverseView.confirmation.token });
  assert.equal(reverse.operationId, '20260812T120003Z-0001');
  assert.deepEqual(await readFile(path.join(contentRoot, 'site.yml')), preRestoreSource);
  assert.deepEqual(await readFile(path.join(backupRoot, result.operationId, 'before', 'content', 'site.yml')), preRestoreSource);
});

test('restore retention preserves an oldest source backup and prunes the next eligible record', async (t) => {
  const workspace = await createTestWorkspace(); t.after(workspace.cleanup);
  const contentRoot = path.join(workspace.root, 'src', 'content'), distRoot = path.join(workspace.root, 'dist'), backupRoot = path.join(workspace.root, '.local-editor', 'backups');
  await mkdir(distRoot, { recursive: true }); await writeFile(path.join(distRoot, 'index.html'), 'old canonical\n'); await mkdir(backupRoot, { recursive: true });
  const bootstrap = await createRepositoryService({ projectRoot: workspace.root, csrfToken: 'csrf' }).bootstrap();
  const inputFor = (name) => ({
    baseManifestHash: bootstrap.baseManifestHash,
    bundle: { baseManifestHash: bootstrap.baseManifestHash, sessionId: 'a'.repeat(32), content: { site: { ...bootstrap.site, name }, about: bootstrap.about, projects: bootstrap.projects, research: bootstrap.research }, images: bootstrap.images.map(({ destination, sha256 }) => ({ kind: 'canonical', destination, sha256 })) },
    uploads: [],
  });
  let sequence = 0;
  const service = createTransactionService({
    projectRoot: workspace.root, contentRoot, distRoot, backupRoot,
    clock: () => new Date('2026-08-12T13:00:00.000Z'),
    idFactory: () => `20260812T1300${String(++sequence).padStart(2, '0')}Z-0001`,
    buildCandidate: async ({ contentRoot: source, distRoot: target }) => writeFile(path.join(target, 'index.html'), await readFile(path.join(source, 'site.yml'), 'utf8')),
  });
  const source = await service.archiveDraft(inputFor('Oldest restore source'));
  for (let index = 2; index <= 20; index += 1) await service.archiveDraft(inputFor(`Later archive ${index}`));
  const sourceJournal = await readFile(path.join(backupRoot, source.id, 'journal.json'));
  const sourceSite = await readFile(path.join(backupRoot, source.id, '.candidate', 'site.yml'));
  const viewed = await service.diffBackup(source.id, { sessionId: 'a'.repeat(32) });
  const restored = await service.restore({ id: source.id, sessionId: 'a'.repeat(32), confirmationToken: viewed.confirmation.token });

  assert.equal(restored.operationId, '20260812T130021Z-0001');
  const backups = await service.listBackups();
  assert.equal(backups.length, 20);
  assert.equal(backups.some(({ id }) => id === source.id), true);
  assert.equal(backups.some(({ id }) => id === '20260812T130002Z-0001'), false);
  assert.deepEqual(await readFile(path.join(backupRoot, source.id, 'journal.json')), sourceJournal);
  assert.deepEqual(await readFile(path.join(backupRoot, source.id, '.candidate', 'site.yml')), sourceSite);
});

test('a completed save is a restorable immutable snapshot of its pre-save generation', async (t) => {
  const workspace = await createTestWorkspace(); t.after(workspace.cleanup);
  const contentRoot = path.join(workspace.root, 'src', 'content'), distRoot = path.join(workspace.root, 'dist'), backupRoot = path.join(workspace.root, '.local-editor', 'backups');
  await mkdir(distRoot, { recursive: true }); await writeFile(path.join(distRoot, 'index.html'), 'old canonical\n'); await mkdir(backupRoot, { recursive: true });
  const bootstrap = await createRepositoryService({ projectRoot: workspace.root, csrfToken: 'csrf' }).bootstrap();
  const originalSite = await readFile(path.join(contentRoot, 'site.yml'));
  const input = { baseManifestHash: bootstrap.baseManifestHash, bundle: { baseManifestHash: bootstrap.baseManifestHash, sessionId: 'a'.repeat(32), content: { site: { ...bootstrap.site, name: 'Saved Generation' }, about: bootstrap.about, projects: bootstrap.projects, research: bootstrap.research }, images: bootstrap.images.map(({ destination, sha256 }) => ({ kind: 'canonical', destination, sha256 })) }, uploads: [] };
  let sequence = 0;
  const service = createTransactionService({ projectRoot: workspace.root, contentRoot, distRoot, backupRoot, clock: () => new Date(`2026-08-12T12:00:0${sequence}.000Z`), idFactory: () => `20260812T12000${++sequence}Z-0001`, buildCandidate: async ({ contentRoot: source, distRoot: target }) => writeFile(path.join(target, 'index.html'), await readFile(path.join(source, 'site.yml'), 'utf8')) });
  const saved = await service.save(input);
  const sourceJournal = await readFile(path.join(backupRoot, saved.operationId, 'journal.json'));
  const sourceBefore = await readFile(path.join(backupRoot, saved.operationId, 'before', 'content', 'site.yml'));
  const viewed = await service.diffBackup(saved.operationId, { sessionId: 'a'.repeat(32) });
  assert.ok(viewed.diff.changed.includes('site.yml'));
  const restored = await service.restore({ id: saved.operationId, sessionId: 'a'.repeat(32), confirmationToken: viewed.confirmation.token });
  assert.equal(restored.operationId, '20260812T120002Z-0001');
  assert.deepEqual(await readFile(path.join(contentRoot, 'site.yml')), originalSite);
  assert.deepEqual(sourceBefore, originalSite);
  assert.deepEqual(await readFile(path.join(backupRoot, saved.operationId, 'journal.json')), sourceJournal);
  assert.deepEqual(await readFile(path.join(backupRoot, saved.operationId, 'before', 'content', 'site.yml')), sourceBefore);
});

test('restore target collisions persist manual recovery and preserve both generations', async (t) => {
  for (const targetKind of ['content', 'dist']) await t.test(targetKind, async (t) => {
    const workspace = await createTestWorkspace(); t.after(workspace.cleanup);
    const contentRoot = path.join(workspace.root, 'src', 'content'), distRoot = path.join(workspace.root, 'dist'), backupRoot = path.join(workspace.root, '.local-editor', 'backups');
    await mkdir(distRoot, { recursive: true }); await writeFile(path.join(distRoot, 'index.html'), 'old canonical\n'); await mkdir(backupRoot, { recursive: true });
    const bootstrap = await createRepositoryService({ projectRoot: workspace.root, csrfToken: 'csrf' }).bootstrap();
    const input = { baseManifestHash: bootstrap.baseManifestHash, bundle: { baseManifestHash: bootstrap.baseManifestHash, sessionId: 'a'.repeat(32), content: { site: { ...bootstrap.site, name: 'Restore Collision' }, about: bootstrap.about, projects: bootstrap.projects, research: bootstrap.research }, images: bootstrap.images.map(({ destination, sha256 }) => ({ kind: 'canonical', destination, sha256 })) }, uploads: [] };
    const archive = createTransactionService({ projectRoot: workspace.root, contentRoot, distRoot, backupRoot, clock: () => new Date('2026-08-12T12:00:00.000Z'), idFactory: () => '20260812T120001Z-0001', buildCandidate: async () => assert.fail('archive must not build') });
    const source = await archive.archiveDraft(input);
    const options = { projectRoot: workspace.root, contentRoot, distRoot, backupRoot, clock: () => new Date('2026-08-12T12:00:01.000Z'), idFactory: () => '20260812T120002Z-0001', buildCandidate: async ({ distRoot: target }) => writeFile(path.join(target, 'index.html'), 'restored candidate\n') };
    const peer = createTransactionService(options);
    const collisionRoot = targetKind === 'content' ? contentRoot : distRoot;
    const boundary = targetKind === 'content' ? 'before-new-content-promotion' : 'before-new-dist-promotion';
    const restorer = createTransactionService({ ...options, failpoint: async (name) => {
      if (name === boundary) {
        await mkdir(collisionRoot, { recursive: true });
        await writeFile(path.join(collisionRoot, 'external.txt'), `${targetKind} external generation\n`);
      }
    } });
    const viewed = await restorer.diffBackup(source.id, { sessionId: 'a'.repeat(32) });
    await assert.rejects(restorer.restore({ id: source.id, sessionId: 'a'.repeat(32), confirmationToken: viewed.confirmation.token }), (error) => error?.code === 'RECOVERY_REQUIRED');
    assert.equal(restorer.isRecoveryOnly(), true);
    assert.equal(await readFile(path.join(collisionRoot, 'external.txt'), 'utf8'), `${targetKind} external generation\n`);
    const journal = JSON.parse(await readFile(path.join(backupRoot, '20260812T120002Z-0001', 'journal.json'), 'utf8'));
    assert.equal(journal.phase, 'manual-recovery-required');
    await assert.rejects(peer.archiveDraft(input), (error) => error?.code === 'RECOVERY_REQUIRED');
    assert.equal(peer.isRecoveryOnly(), true);
  });
});

test('an external edit after viewing a restore diff rejects the token with zero restore write', async (t) => {
  const workspace = await createTestWorkspace(); t.after(workspace.cleanup);
  const contentRoot = path.join(workspace.root, 'src', 'content'), distRoot = path.join(workspace.root, 'dist'), backupRoot = path.join(workspace.root, '.local-editor', 'backups');
  await mkdir(distRoot, { recursive: true }); await writeFile(path.join(distRoot, 'index.html'), 'old canonical\n'); await mkdir(backupRoot, { recursive: true });
  const bootstrap = await createRepositoryService({ projectRoot: workspace.root, csrfToken: 'csrf' }).bootstrap();
  const input = { baseManifestHash: bootstrap.baseManifestHash, bundle: { baseManifestHash: bootstrap.baseManifestHash, sessionId: 'a'.repeat(32), content: { site: { ...bootstrap.site, name: 'Restore target' }, about: bootstrap.about, projects: bootstrap.projects, research: bootstrap.research }, images: bootstrap.images.map(({ destination, sha256 }) => ({ kind: 'canonical', destination, sha256 })) }, uploads: [] };
  let sequence = 0;
  const service = createTransactionService({ projectRoot: workspace.root, contentRoot, distRoot, backupRoot, clock: () => new Date(`2026-08-12T12:00:0${sequence}.000Z`), idFactory: () => `20260812T12000${++sequence}Z-0001`, buildCandidate: async ({ distRoot: target }) => writeFile(path.join(target, 'index.html'), 'restored\n') });
  const source = await service.archiveDraft(input), viewed = await service.diffBackup(source.id, { sessionId: 'a'.repeat(32) });
  await writeFile(path.join(contentRoot, 'external.txt'), 'external edit\n');
  const before = { site: await readFile(path.join(contentRoot, 'site.yml')), external: await readFile(path.join(contentRoot, 'external.txt')), dist: await readFile(path.join(distRoot, 'index.html')), source: await readFile(path.join(backupRoot, source.id, '.candidate', 'site.yml')) };
  await assert.rejects(service.restore({ id: source.id, sessionId: 'a'.repeat(32), confirmationToken: viewed.confirmation.token }), (error) => error?.code === 'CONFLICT');
  assert.deepEqual({ site: await readFile(path.join(contentRoot, 'site.yml')), external: await readFile(path.join(contentRoot, 'external.txt')), dist: await readFile(path.join(distRoot, 'index.html')), source: await readFile(path.join(backupRoot, source.id, '.candidate', 'site.yml')) }, before);
  assert.deepEqual((await service.listBackups()).map((record) => record.id), [source.id]);
  await assert.rejects(service.restore({ id: source.id, sessionId: 'a'.repeat(32), confirmationToken: viewed.confirmation.token }), (error) => error?.code === 'FORBIDDEN');
});

test('backup diff rejects a nested image junction without touching outside bytes', async (t) => {
  const workspace = await createTestWorkspace(); t.after(workspace.cleanup);
  const contentRoot = path.join(workspace.root, 'src', 'content'), distRoot = path.join(workspace.root, 'dist'), backupRoot = path.join(workspace.root, '.local-editor', 'backups');
  await mkdir(distRoot, { recursive: true }); await writeFile(path.join(distRoot, 'index.html'), 'old\n'); await mkdir(backupRoot, { recursive: true });
  const bootstrap = await createRepositoryService({ projectRoot: workspace.root, csrfToken: 'csrf' }).bootstrap();
  const input = { baseManifestHash: bootstrap.baseManifestHash, bundle: { baseManifestHash: bootstrap.baseManifestHash, sessionId: 'a'.repeat(32), content: { site: bootstrap.site, about: bootstrap.about, projects: bootstrap.projects, research: bootstrap.research }, images: bootstrap.images.map(({ destination, sha256 }) => ({ kind: 'canonical', destination, sha256 })) }, uploads: [] };
  const service = createTransactionService({ projectRoot: workspace.root, contentRoot, distRoot, backupRoot, clock: () => new Date('2026-08-12T12:00:00.000Z'), idFactory: () => '20260812T120000Z-0001', buildCandidate: async () => {} });
  const archived = await service.archiveDraft(input); const project = bootstrap.projects.find((record) => bootstrap.images.some((image) => image.kind === 'project' && image.slug === record.slug));
  const imagesRoot = path.join(backupRoot, archived.id, '.candidate', 'projects', project.slug, 'images'), safeRoot = `${imagesRoot}-safe`, outside = path.join(workspace.parent, 'outside-backup-junction');
  await mkdir(outside); await writeFile(path.join(outside, 'outside.png'), 'outside bytes'); await rename(imagesRoot, safeRoot);
  try { await symlink(outside, imagesRoot, 'junction'); }
  catch (error) { await rename(safeRoot, imagesRoot); if (['EPERM', 'EACCES'].includes(error?.code)) { t.skip('junction creation unavailable'); return; } throw error; }
  try {
    await assert.rejects(service.diffBackup(archived.id, { sessionId: 'a'.repeat(32) }), /重解析点|路径/);
    assert.equal(await readFile(path.join(outside, 'outside.png'), 'utf8'), 'outside bytes');
  } finally { await unlink(imagesRoot); await rename(safeRoot, imagesRoot); }
});
