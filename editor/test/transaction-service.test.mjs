import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as nodeFsSync from 'node:fs';
import * as nodeFs from 'node:fs/promises';
import { cp, mkdir, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { createTestWorkspace } from '../../test/helpers.mjs';
import { createRepositoryService } from '../server/repository-service.mjs';
import { createTransactionService } from '../server/transaction-service.mjs';
import { createCandidateBuilder } from '../server/build-service.mjs';

async function transactionWorkspace(t) {
  const workspace = await createTestWorkspace();
  t.after(workspace.cleanup);
  const contentRoot = path.join(workspace.root, 'src', 'content');
  const distRoot = path.join(workspace.root, 'dist');
  const backupRoot = path.join(workspace.root, '.local-editor', 'backups');
  await mkdir(distRoot, { recursive: true });
  await writeFile(path.join(distRoot, 'index.html'), '<!doctype html><title>old</title>\n');
  await mkdir(backupRoot, { recursive: true });
  return { ...workspace, contentRoot, distRoot, backupRoot };
}

async function treeHash(root) {
  const hash = createHash('sha256');
  async function visit(directory) {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const target = path.join(directory, entry.name);
      const relative = path.relative(root, target).replace(/\\/g, '/');
      hash.update(relative); hash.update('\0');
      if (entry.isDirectory()) await visit(target);
      else { const bytes = await readFile(target); hash.update(String(bytes.length)); hash.update('\0'); hash.update(bytes); }
    }
  }
  await visit(root);
  return hash.digest('hex');
}

async function validSaveInput(workspace) {
  const bootstrap = await createRepositoryService({ projectRoot: workspace.root, csrfToken: 'csrf' }).bootstrap();
  return {
    baseManifestHash: bootstrap.baseManifestHash,
    bundle: {
      baseManifestHash: bootstrap.baseManifestHash,
      sessionId: 'a'.repeat(32),
      content: { site: bootstrap.site, about: bootstrap.about, projects: bootstrap.projects, research: bootstrap.research },
      images: bootstrap.images.map(({ destination, sha256 }) => ({ kind: 'canonical', destination, sha256 })),
    },
    uploads: [],
  };
}

test('validation failure before candidate creation writes no operation record', async (t) => {
  const workspace = await transactionWorkspace(t);
  let builds = 0;
  const service = createTransactionService({
    projectRoot: workspace.root,
    contentRoot: workspace.contentRoot,
    distRoot: workspace.distRoot,
    backupRoot: workspace.backupRoot,
    buildCandidate: async () => { builds += 1; },
  });

  await assert.rejects(
    service.save({ baseManifestHash: 'not-a-manifest', bundle: null, uploads: [] }),
    (error) => error?.code === 'BAD_INPUT',
  );
  assert.equal(builds, 0);
  assert.deepEqual(await readdir(workspace.backupRoot), []);
});

test('deep candidate schema failure writes no operation record', async (t) => {
  const workspace = await transactionWorkspace(t);
  const input = await validSaveInput(workspace);
  input.bundle.content.site.theme.text = 'not-a-colour';
  let builds = 0;
  const service = createTransactionService({
    projectRoot: workspace.root, contentRoot: workspace.contentRoot, distRoot: workspace.distRoot, backupRoot: workspace.backupRoot,
    buildCandidate: async () => { builds += 1; },
  });
  await assert.rejects(service.save(input), (error) => error?.code === 'BAD_INPUT');
  assert.equal(builds, 0);
  assert.deepEqual(await readdir(workspace.backupRoot), []);
});

test('unsafe candidate image reference writes no operation record', async (t) => {
  const workspace = await transactionWorkspace(t);
  const input = await validSaveInput(workspace);
  input.bundle.images[0] = { kind: 'canonical', destination: '../outside.png', sha256: 'a'.repeat(64) };
  const service = createTransactionService({
    projectRoot: workspace.root, contentRoot: workspace.contentRoot, distRoot: workspace.distRoot, backupRoot: workspace.backupRoot,
    buildCandidate: async () => assert.fail('unsafe image must not build'),
  });
  await assert.rejects(service.save(input), (error) => error?.code === 'BAD_INPUT');
  assert.deepEqual(await readdir(workspace.backupRoot), []);
});

test('unreferenced candidate image and roots outside project write no operation record', async (t) => {
  const workspace = await transactionWorkspace(t);
  const input = await validSaveInput(workspace);
  input.bundle.images.push({ kind: 'canonical', destination: 'site-images/orphan.png', sha256: 'a'.repeat(64) });
  const service = createTransactionService({ projectRoot: workspace.root, contentRoot: workspace.contentRoot, distRoot: workspace.distRoot, backupRoot: workspace.backupRoot, buildCandidate: async () => assert.fail('orphan must not build') });
  await assert.rejects(service.save(input), (error) => error?.code === 'BAD_INPUT');
  assert.deepEqual(await readdir(workspace.backupRoot), []);
  const outside = await transactionWorkspace(t);
  assert.throws(() => createTransactionService({ projectRoot: workspace.root, contentRoot: outside.contentRoot, distRoot: workspace.distRoot, backupRoot: workspace.backupRoot, buildCandidate: async () => {} }), (error) => error?.code === 'BAD_INPUT');
});

test('stale canonical and upload image bindings write no operation record', async (t) => {
  const workspace = await transactionWorkspace(t);
  const canonical = await validSaveInput(workspace);
  canonical.bundle.images[0].sha256 = '0'.repeat(64);
  const service = createTransactionService({
    projectRoot: workspace.root, contentRoot: workspace.contentRoot, distRoot: workspace.distRoot, backupRoot: workspace.backupRoot,
    buildCandidate: async () => assert.fail('stale images must not build'),
  });
  await assert.rejects(service.save(canonical), (error) => error?.code === 'CONFLICT');
  assert.deepEqual(await readdir(workspace.backupRoot), []);

  const upload = await validSaveInput(workspace);
  upload.bundle.images[0] = { kind: 'upload', destination: upload.bundle.images[0].destination, uploadId: '1'.repeat(32), sessionId: '2'.repeat(32) };
  upload.uploads = { resolveUpload: () => undefined };
  await assert.rejects(service.save(upload), (error) => error?.code === 'BAD_INPUT');
  assert.deepEqual(await readdir(workspace.backupRoot), []);
});

test('candidate build failure records a diagnostic without changing canonical content or dist', async (t) => {
  const workspace = await transactionWorkspace(t);
  const before = { content: await treeHash(workspace.contentRoot), dist: await treeHash(workspace.distRoot) };
  const service = createTransactionService({
    projectRoot: workspace.root,
    contentRoot: workspace.contentRoot,
    distRoot: workspace.distRoot,
    backupRoot: workspace.backupRoot,
    clock: () => new Date('2026-08-12T12:00:00.000Z'),
    idFactory: () => '20260812T120000Z-0001',
    buildCandidate: async () => { throw new Error(`${workspace.root} TOKEN=secret source bytes`); },
  });
  await assert.rejects(service.save(await validSaveInput(workspace)), (error) => error?.code === 'CANDIDATE_BUILD_FAILED');
  assert.deepEqual({ content: await treeHash(workspace.contentRoot), dist: await treeHash(workspace.distRoot) }, before);
  const records = await readdir(workspace.backupRoot);
  assert.deepEqual(records, ['20260812T120000Z-0001']);
  const journal = JSON.parse(await readFile(path.join(workspace.backupRoot, records[0], 'journal.json'), 'utf8'));
  assert.equal(journal.kind, 'save');
  assert.equal(journal.phase, 'candidate-failed');
  assert.deepEqual(journal.diagnostic, { code: 'CANDIDATE_BUILD_FAILED' });
  assert.doesNotMatch(JSON.stringify(journal), /TOKEN=|source bytes|yunxi-academic-website/i);
});

test('stale base manifest returns a file-level conflict without build, record, or canonical write', async (t) => {
  const workspace = await transactionWorkspace(t);
  const input = await validSaveInput(workspace);
  await writeFile(path.join(workspace.contentRoot, 'site.yml'), `${await readFile(path.join(workspace.contentRoot, 'site.yml'), 'utf8')}\n`);
  const before = { content: await treeHash(workspace.contentRoot), dist: await treeHash(workspace.distRoot) };
  let builds = 0;
  const service = createTransactionService({
    projectRoot: workspace.root, contentRoot: workspace.contentRoot, distRoot: workspace.distRoot, backupRoot: workspace.backupRoot,
    buildCandidate: async () => { builds += 1; },
  });
  await assert.rejects(service.save(input), (error) => {
    assert.equal(error?.code, 'CONFLICT');
    assert.ok(error?.diff?.changed.includes('site.yml'));
    assert.deepEqual(error?.diff?.changed, [...error.diff.changed].sort());
    assert.deepEqual(error?.diff?.added, []);
    assert.deepEqual(error?.diff?.removed, []);
    return true;
  });
  assert.equal(builds, 0);
  assert.deepEqual(await readdir(workspace.backupRoot), []);
  assert.deepEqual({ content: await treeHash(workspace.contentRoot), dist: await treeHash(workspace.distRoot) }, before);
});

test('a concurrent save receives OPERATION_BUSY before a second build starts', async (t) => {
  const workspace = await transactionWorkspace(t); const input = await validSaveInput(workspace);
  let builds = 0; let releaseBuild; let markStarted;
  const started = new Promise((resolve) => { markStarted = resolve; });
  const gate = new Promise((resolve) => { releaseBuild = resolve; });
  const service = createTransactionService({
    projectRoot: workspace.root, contentRoot: workspace.contentRoot, distRoot: workspace.distRoot, backupRoot: workspace.backupRoot,
    clock: () => new Date('2026-08-12T12:00:00.000Z'), idFactory: () => '20260812T120000Z-0001',
    buildCandidate: async ({ distRoot }) => { builds += 1; markStarted(); await gate; await writeFile(path.join(distRoot, 'index.html'), 'candidate\n'); },
  });
  const first = service.save(input); await started;
  try {
    await assert.rejects(Promise.race([
      service.save(input),
      new Promise((_, reject) => setTimeout(() => reject(new Error('second save did not fail promptly')), 1_000)),
    ]), (error) => error?.code === 'OPERATION_BUSY');
    assert.equal(builds, 1);
  } finally { releaseBuild(); }
  await first;
});

test('confirmed conflict resolution snapshots the external generation before promoting the bound draft', async (t) => {
  const workspace = await transactionWorkspace(t);
  const input = await validSaveInput(workspace);
  input.bundle.content.site.name = 'Confirmed Draft';
  const sitePath = path.join(workspace.contentRoot, 'site.yml');
  await writeFile(sitePath, `${await readFile(sitePath, 'utf8')}\n# external-generation\n`);
  let now = new Date('2026-08-12T12:00:00.000Z');
  const service = createTransactionService({
    projectRoot: workspace.root, contentRoot: workspace.contentRoot, distRoot: workspace.distRoot, backupRoot: workspace.backupRoot,
    clock: () => now, idFactory: () => '20260812T120000Z-0001',
    buildCandidate: async ({ distRoot }) => writeFile(path.join(distRoot, 'index.html'), '<title>Confirmed Draft</title>\n'),
  });
  let context;
  await assert.rejects(service.save(input), (error) => {
    assert.equal(error?.code, 'CONFLICT'); context = error.confirmationContext;
    assert.match(context?.targetId, /^\d{8}T\d{6}Z-0000$/);
    for (const key of ['diffHash', 'draftHash', 'canonicalManifestHash']) assert.match(context[key], /^[a-f0-9]{64}$/);
    return true;
  });
  assert.deepEqual(await readdir(workspace.backupRoot), []);
  const sessionId = 'b'.repeat(32);
  const issued = service.issueConfirmation({ sessionId, action: 'conflict', ...context, now: new Date('2026-08-12T12:00:00.000Z') });
  now = new Date('2026-08-12T12:00:01.000Z');
  const result = await service.save({ ...input, sessionId, conflictResolutionToken: issued.token });
  assert.equal(result.ok, true);
  assert.equal((await readFile(sitePath, 'utf8')).includes('Confirmed Draft'), true);
  assert.doesNotMatch(await readFile(sitePath, 'utf8'), /external-generation/);
  assert.match(await readFile(path.join(workspace.backupRoot, result.operationId, 'before', 'content', 'site.yml'), 'utf8'), /external-generation/);
});

test('successful save atomically promotes candidate content and dist while preserving the old state', async (t) => {
  const workspace = await transactionWorkspace(t);
  const input = await validSaveInput(workspace);
  input.bundle.content.site.name = 'Saved Candidate';
  const old = { content: await treeHash(workspace.contentRoot), dist: await treeHash(workspace.distRoot) };
  const service = createTransactionService({
    projectRoot: workspace.root, contentRoot: workspace.contentRoot, distRoot: workspace.distRoot, backupRoot: workspace.backupRoot,
    clock: () => new Date('2026-08-12T12:00:00.000Z'), idFactory: () => '20260812T120000Z-0001',
    buildCandidate: async ({ distRoot }) => {
      await writeFile(path.join(distRoot, 'index.html'), '<!doctype html><title>Saved Candidate</title>\n');
    },
  });
  const result = await service.save(input);
  assert.equal(result.ok, true);
  assert.equal(result.operationId, '20260812T120000Z-0001');
  assert.equal(result.manifestHash, (await createRepositoryService({ projectRoot: workspace.root, csrfToken: 'csrf' }).bootstrap()).baseManifestHash);
  assert.equal((await readFile(path.join(workspace.contentRoot, 'site.yml'), 'utf8')).includes('Saved Candidate'), true);
  assert.equal((await readFile(path.join(workspace.distRoot, 'index.html'), 'utf8')).includes('Saved Candidate'), true);
  const operationRoot = path.join(workspace.backupRoot, result.operationId);
  assert.deepEqual({
    content: await treeHash(path.join(operationRoot, 'before', 'content')),
    dist: await treeHash(path.join(operationRoot, 'before', 'dist')),
  }, old);
  const journal = JSON.parse(await readFile(path.join(operationRoot, 'journal.json'), 'utf8'));
  assert.equal(journal.phase, 'complete');
  assert.equal(journal.candidate.content.compatibilityHash, result.manifestHash);
});

test('manifest hashes and file order do not depend on filesystem enumeration order', async (t) => {
  const normal = await transactionWorkspace(t);
  const reversed = await transactionWorkspace(t);
  const normalInput = await validSaveInput(normal);
  const reversedInput = await validSaveInput(reversed);
  const fixed = {
    clock: () => new Date('2026-08-12T12:00:00.000Z'),
    idFactory: () => '20260812T120000Z-0001',
    buildCandidate: async ({ distRoot }) => writeFile(path.join(distRoot, 'index.html'), 'candidate\n'),
  };
  const normalService = createTransactionService({ projectRoot: normal.root, contentRoot: normal.contentRoot, distRoot: normal.distRoot, backupRoot: normal.backupRoot, ...fixed });
  const reversedFilesystem = {
    ...nodeFs,
    readdir: async (...args) => (await nodeFs.readdir(...args)).reverse(),
  };
  const reversedService = createTransactionService({ projectRoot: reversed.root, contentRoot: reversed.contentRoot, distRoot: reversed.distRoot, backupRoot: reversed.backupRoot, filesystem: reversedFilesystem, ...fixed });
  await normalService.save(normalInput);
  await reversedService.save(reversedInput);
  const normalJournal = JSON.parse(await readFile(path.join(normal.backupRoot, '20260812T120000Z-0001', 'journal.json'), 'utf8'));
  const reversedJournal = JSON.parse(await readFile(path.join(reversed.backupRoot, '20260812T120000Z-0001', 'journal.json'), 'utf8'));
  assert.equal(reversedJournal.candidate.content.hash, normalJournal.candidate.content.hash);
  assert.equal(reversedJournal.candidate.dist.hash, normalJournal.candidate.dist.hash);
  assert.deepEqual(Object.keys(reversedJournal.candidate.content.files), Object.keys(normalJournal.candidate.content.files));
  assert.deepEqual(Object.keys(reversedJournal.candidate.dist.files), Object.keys(normalJournal.candidate.dist.files));
});

test('every journal update flushes its temporary file and active operation directory', async (t) => {
  const workspace = await transactionWorkspace(t); const input = await validSaveInput(workspace);
  const operationId = '20260812T120000Z-0001'; const operationRoot = path.join(workspace.backupRoot, operationId);
  let journalFlushes = 0; let operationDirectoryFlushes = 0;
  const filesystem = { ...nodeFs, async open(target, ...args) {
    const handle = await nodeFs.open(target, ...args); const original = handle.sync.bind(handle);
    handle.sync = async () => { const name = path.basename(String(target)); if (name.startsWith('.journal-')) journalFlushes += 1; if (path.resolve(String(target)) === path.resolve(operationRoot)) operationDirectoryFlushes += 1; return original(); };
    return handle;
  } };
  const service = createTransactionService({
    projectRoot: workspace.root, contentRoot: workspace.contentRoot, distRoot: workspace.distRoot, backupRoot: workspace.backupRoot,
    clock: () => new Date('2026-08-12T12:00:00.000Z'), idFactory: () => operationId, filesystem,
    buildCandidate: async ({ distRoot }) => writeFile(path.join(distRoot, 'index.html'), 'candidate\n'),
  });
  await service.save(input);
  assert.ok(journalFlushes >= 8, `journal flushes: ${journalFlushes}`);
  assert.ok(operationDirectoryFlushes >= journalFlushes, `directory flushes: ${operationDirectoryFlushes}`);
});

test('an external edit immediately before promotion returns conflict without moving canonical content', async (t) => {
  const workspace = await transactionWorkspace(t);
  const input = await validSaveInput(workspace);
  input.bundle.content.site.name = 'Candidate Name';
  const sitePath = path.join(workspace.contentRoot, 'site.yml');
  const distBefore = await treeHash(workspace.distRoot);
  let injected = false;
  let renameReached = false;
  const service = createTransactionService({
    projectRoot: workspace.root, contentRoot: workspace.contentRoot, distRoot: workspace.distRoot, backupRoot: workspace.backupRoot,
    clock: () => new Date('2026-08-12T12:00:00.000Z'), idFactory: () => '20260812T120000Z-0001',
    buildCandidate: async ({ distRoot }) => writeFile(path.join(distRoot, 'index.html'), 'candidate\n'),
    failpoint: async (boundary, context) => {
      if (boundary === 'before-old-content-rename') renameReached = true;
      if (!injected && boundary === 'after-operation-directory-flush' && context?.phase === 'candidate-built') {
        injected = true;
        await writeFile(sitePath, `${await readFile(sitePath, 'utf8')}\n# external-generation\n`);
      }
    },
  });
  await assert.rejects(service.save(input), (error) => error?.code === 'CONFLICT');
  assert.equal(injected, true);
  assert.equal(renameReached, false);
  assert.match(await readFile(sitePath, 'utf8'), /external-generation/);
  assert.equal(await treeHash(workspace.distRoot), distBefore);
  await assert.rejects(readFile(path.join(workspace.backupRoot, '20260812T120000Z-0001', 'before', 'content', 'site.yml')), (error) => error?.code === 'ENOENT');
});

test('an edit after prepromotion rehash is restored byte-exact after the moved-content proof fails', async (t) => {
  const workspace = await transactionWorkspace(t);
  const input = await validSaveInput(workspace); input.bundle.content.site.name = 'Candidate Name';
  const sitePath = path.join(workspace.contentRoot, 'site.yml'); const oldDist = await treeHash(workspace.distRoot);
  let externalBytes;
  const service = createTransactionService({
    projectRoot: workspace.root, contentRoot: workspace.contentRoot, distRoot: workspace.distRoot, backupRoot: workspace.backupRoot,
    clock: () => new Date('2026-08-12T12:00:00.000Z'), idFactory: () => '20260812T120000Z-0001',
    buildCandidate: async ({ distRoot }) => writeFile(path.join(distRoot, 'index.html'), 'candidate\n'),
    failpoint: async (boundary, context) => {
      if (boundary === 'before-journal-temp-flush' && context?.phase === 'before-old-content-rename') {
        externalBytes = `${await readFile(sitePath, 'utf8')}\n# after-prepromotion\n`; await writeFile(sitePath, externalBytes);
      }
    },
  });
  await assert.rejects(service.save(input), (error) => error?.code === 'CONFLICT');
  assert.equal(await readFile(sitePath, 'utf8'), externalBytes);
  assert.equal(await treeHash(workspace.distRoot), oldDist);
  await assert.rejects(readFile(path.join(workspace.contentRoot, 'external-candidate.txt')), (error) => error?.code === 'ENOENT');
});

test('a moved-dist proof failure restores external dist and rolls promoted content back to all-old', async (t) => {
  const workspace = await transactionWorkspace(t);
  const input = await validSaveInput(workspace); input.bundle.content.site.name = 'Candidate Name';
  const oldContent = await treeHash(workspace.contentRoot); const distPath = path.join(workspace.distRoot, 'index.html'); let externalDist;
  const service = createTransactionService({
    projectRoot: workspace.root, contentRoot: workspace.contentRoot, distRoot: workspace.distRoot, backupRoot: workspace.backupRoot,
    clock: () => new Date('2026-08-12T12:00:00.000Z'), idFactory: () => '20260812T120000Z-0001',
    buildCandidate: async ({ distRoot }) => writeFile(path.join(distRoot, 'index.html'), 'candidate\n'),
    failpoint: async (boundary, context) => {
      if (boundary === 'before-journal-temp-flush' && context?.phase === 'before-old-dist-rename') {
        externalDist = `${await readFile(distPath, 'utf8')}external-dist\n`; await writeFile(distPath, externalDist);
      }
    },
  });
  await assert.rejects(service.save(input), (error) => error?.code === 'CONFLICT');
  assert.equal(await treeHash(workspace.contentRoot), oldContent);
  assert.equal(await readFile(distPath, 'utf8'), externalDist);
  const journal = JSON.parse(await readFile(path.join(workspace.backupRoot, '20260812T120000Z-0001', 'journal.json'), 'utf8'));
  assert.equal(journal.phase, 'conflict-restored-before-dist-promotion');
});

test('promotion target collisions persist recovery-only across already-created service instances', async (t) => {
  for (const targetKind of ['content', 'dist']) await t.test(targetKind, async (t) => {
    const workspace = await transactionWorkspace(t);
    const input = await validSaveInput(workspace); input.bundle.content.site.name = 'Candidate Name';
    const options = {
      projectRoot: workspace.root, contentRoot: workspace.contentRoot, distRoot: workspace.distRoot, backupRoot: workspace.backupRoot,
      clock: () => new Date('2026-08-12T12:00:00.000Z'), idFactory: () => '20260812T120000Z-0001',
      buildCandidate: async ({ distRoot }) => writeFile(path.join(distRoot, 'index.html'), 'candidate\n'),
    };
    const peer = createTransactionService(options);
    const collisionRoot = targetKind === 'content' ? workspace.contentRoot : workspace.distRoot;
    const boundary = targetKind === 'content' ? 'before-new-content-promotion' : 'before-new-dist-promotion';
    const service = createTransactionService({ ...options, failpoint: async (name) => {
      if (name === boundary) {
        await mkdir(collisionRoot, { recursive: true });
        await writeFile(path.join(collisionRoot, 'external.txt'), `${targetKind} external generation\n`);
      }
    } });
    await assert.rejects(service.save(input), (error) => error?.code === 'RECOVERY_REQUIRED');
    assert.equal(service.isRecoveryOnly(), true);
    assert.equal(await readFile(path.join(collisionRoot, 'external.txt'), 'utf8'), `${targetKind} external generation\n`);
    const journal = JSON.parse(await readFile(path.join(workspace.backupRoot, '20260812T120000Z-0001', 'journal.json'), 'utf8'));
    assert.equal(journal.phase, 'manual-recovery-required');
    await assert.rejects(peer.archiveDraft(input), (error) => error?.code === 'RECOVERY_REQUIRED');
    let uploadMutations = 0;
    await assert.rejects(peer.runMutation(() => { uploadMutations += 1; }), (error) => error?.code === 'RECOVERY_REQUIRED');
    assert.equal(uploadMutations, 0);
    assert.equal(peer.isRecoveryOnly(), true);
  });
});

test('promotion renames revalidate after the failpoint and cannot follow a replaced destination parent', async (t) => {
  const workspace = await transactionWorkspace(t);
  const input = await validSaveInput(workspace);
  const oldContent = await treeHash(workspace.contentRoot);
  const operationRoot = path.join(workspace.backupRoot, '20260812T120000Z-0001');
  const beforeRoot = path.join(operationRoot, 'before');
  const savedBeforeRoot = `${beforeRoot}-safe`;
  const outside = path.join(workspace.parent, 'outside-promotion-destination');
  await mkdir(outside, { recursive: true });
  let replaced = false;
  const service = createTransactionService({
    projectRoot: workspace.root,
    contentRoot: workspace.contentRoot,
    distRoot: workspace.distRoot,
    backupRoot: workspace.backupRoot,
    clock: () => new Date('2026-08-12T12:00:00.000Z'),
    idFactory: () => '20260812T120000Z-0001',
    buildCandidate: async ({ distRoot }) => writeFile(path.join(distRoot, 'index.html'), 'candidate\n'),
    failpoint: async (name) => {
      if (name !== 'before-old-content-rename') return;
      await rename(beforeRoot, savedBeforeRoot);
      try { await symlink(outside, beforeRoot, 'junction'); }
      catch (error) {
        await rename(savedBeforeRoot, beforeRoot);
        if (['EPERM', 'EACCES'].includes(error?.code)) { t.skip('junction creation unavailable'); return; }
        throw error;
      }
      replaced = true;
    },
  });
  try {
    await assert.rejects(service.save(input), (error) => ['BAD_INPUT', 'RECOVERY_REQUIRED'].includes(error?.code));
    if (!replaced) return;
    assert.equal(await treeHash(workspace.contentRoot), oldContent);
    assert.deepEqual(await readdir(outside), []);
  } finally {
    if (replaced) {
      await rm(beforeRoot);
      await rename(savedBeforeRoot, beforeRoot);
    }
  }
});

test('each promotion rename flushes both parent directories before its after-boundary', async (t) => {
  const workspace = await transactionWorkspace(t);
  const input = await validSaveInput(workspace);
  const events = [];
  const filesystem = {
    ...nodeFs,
    async open(target, flags, ...rest) {
      const handle = await nodeFs.open(target, flags, ...rest);
      return {
        writeFile: handle.writeFile.bind(handle),
        sync: async () => { events.push({ type: 'sync', target: path.resolve(target) }); return handle.sync(); },
        close: handle.close.bind(handle),
      };
    },
  };
  const synchronousFilesystem = {
    ...nodeFsSync,
    renameSync(source, destination) {
      events.push({ type: 'rename', source: path.resolve(source), destination: path.resolve(destination) });
      return nodeFsSync.renameSync(source, destination);
    },
  };
  const service = createTransactionService({
    projectRoot: workspace.root,
    contentRoot: workspace.contentRoot,
    distRoot: workspace.distRoot,
    backupRoot: workspace.backupRoot,
    filesystem,
    synchronousFilesystem,
    clock: () => new Date('2026-08-12T12:00:00.000Z'),
    idFactory: () => '20260812T120000Z-0001',
    buildCandidate: async ({ distRoot }) => writeFile(path.join(distRoot, 'index.html'), 'candidate\n'),
    failpoint: async (name) => events.push({ type: 'boundary', name }),
  });
  await service.save(input);
  const renameIndex = events.findIndex((event) => event.type === 'rename' && event.source === path.resolve(workspace.contentRoot));
  const afterIndex = events.findIndex((event) => event.type === 'boundary' && event.name === 'after-old-content-rename');
  assert.ok(renameIndex >= 0 && afterIndex > renameIndex);
  const durable = events.slice(renameIndex + 1, afterIndex).filter((event) => event.type === 'sync').map((event) => event.target);
  assert.ok(durable.includes(path.resolve(path.dirname(workspace.contentRoot))));
  assert.ok(durable.includes(path.resolve(path.join(workspace.backupRoot, '20260812T120000Z-0001', 'before'))));
});

test('candidate builder uses an isolated Node process and sanitises bounded failure logs', async (t) => {
  const workspace = await transactionWorkspace(t);
  const operationRoot = path.join(workspace.backupRoot, '20260812T120000Z-0001');
  const candidateContentRoot = path.join(operationRoot, '.candidate');
  const candidateDistRoot = path.join(operationRoot, 'candidate-dist');
  await mkdir(candidateContentRoot, { recursive: true }); await mkdir(candidateDistRoot);
  let call;
  const successful = createCandidateBuilder({
    projectRoot: workspace.root,
    runProcess: async (executable, args, options) => {
      call = { executable, args, options };
      await writeFile(path.join(candidateDistRoot, 'index.html'), 'candidate\n');
      return { exitCode: 0, stdout: 'built', stderr: '' };
    },
  });
  const result = await successful({ projectRoot: workspace.root, operationRoot, contentRoot: candidateContentRoot, distRoot: candidateDistRoot });
  assert.equal(call.executable, process.execPath);
  assert.equal(call.options.shell, false);
  assert.equal(call.options.cwd, workspace.root);
  assert.deepEqual(call.args.slice(0, 5), [
    '--permission',
    `--allow-fs-read=${workspace.root}`,
    `--allow-fs-write=${operationRoot}`,
    '--allow-addons',
    '--allow-child-process',
  ]);
  assert.deepEqual(call.args.slice(-2), [path.join(workspace.root, 'node_modules', 'astro', 'bin', 'astro.mjs'), 'build']);
  assert.equal(call.options.env.EDITOR_CANDIDATE_BUILD, '1');
  assert.equal(call.options.env.EDITOR_OPERATION_ROOT, operationRoot);
  assert.equal(call.options.env.EDITOR_CONTENT_ROOT, candidateContentRoot);
  assert.equal(call.options.env.EDITOR_OUT_DIR, candidateDistRoot);
  assert.equal(call.options.env.ASTRO_TELEMETRY_DISABLED, '1');
  assert.ok(call.options.env.TEMP.startsWith(`${operationRoot}${path.sep}`));
  assert.equal('PATH' in call.options.env, true);
  assert.equal('SESSION_SECRET' in call.options.env, false);
  assert.deepEqual(result, { ok: true, diagnostic: { code: 'CANDIDATE_BUILD_OK' } });

  const secret = `${workspace.root} SESSION=private CSRF=private SOURCE_BYTES_SENTINEL`;
  const failing = createCandidateBuilder({ projectRoot: workspace.root, maxLogBytes: 64, runProcess: async () => ({ exitCode: 1, stdout: secret.repeat(20), stderr: `stack ${secret}` }) });
  await assert.rejects(
    failing({ projectRoot: workspace.root, operationRoot, contentRoot: candidateContentRoot, distRoot: candidateDistRoot }),
    (error) => {
      assert.equal(error?.code, 'CANDIDATE_BUILD_FAILED');
      assert.deepEqual(error?.diagnostic, { code: 'CANDIDATE_BUILD_FAILED' });
      assert.doesNotMatch(JSON.stringify(error), /SESSION=|CSRF=|SOURCE_BYTES|yunxi-academic-website|stack/i);
      return true;
    },
  );
});

test('candidate builder close aborts and awaits every active child build', async (t) => {
  const workspace = await transactionWorkspace(t);
  const operationRoot = path.join(workspace.backupRoot, '20260812T120000Z-0099');
  const candidateContentRoot = path.join(operationRoot, '.candidate');
  const candidateDistRoot = path.join(operationRoot, 'candidate-dist');
  await mkdir(candidateContentRoot, { recursive: true });
  await mkdir(candidateDistRoot);
  let childStarted;
  const started = new Promise((resolve) => { childStarted = resolve; });
  let childExited = false;
  const builder = createCandidateBuilder({
    projectRoot: workspace.root,
    runProcess: async (_executable, _args, options) => {
      childStarted();
      await new Promise((resolve) => options.signal.addEventListener('abort', resolve, { once: true }));
      childExited = true;
      throw Object.assign(new Error('candidate child aborted'), { code: 'ABORT_ERR' });
    },
  });
  const build = builder({
    projectRoot: workspace.root,
    operationRoot,
    contentRoot: candidateContentRoot,
    distRoot: candidateDistRoot,
  });
  await started;

  const firstClose = builder.close();
  const secondClose = builder.close();
  assert.equal(firstClose, secondClose);
  await firstClose;

  assert.equal(childExited, true);
  await assert.rejects(build, (error) => error?.code === 'CANDIDATE_BUILD_FAILED');
  await assert.rejects(
    builder({ projectRoot: workspace.root, operationRoot, contentRoot: candidateContentRoot, distRoot: candidateDistRoot }),
    (error) => error?.code === 'CANDIDATE_BUILD_FAILED',
  );
});

test('candidate builder close fails closed when active tree termination is unproven', async (t) => {
  const workspace = await transactionWorkspace(t);
  const operationRoot = path.join(workspace.backupRoot, '20260812T120000Z-0097');
  const candidateContentRoot = path.join(operationRoot, '.candidate');
  const candidateDistRoot = path.join(operationRoot, 'candidate-dist');
  await mkdir(candidateContentRoot, { recursive: true });
  await mkdir(candidateDistRoot);
  let started;
  const childStarted = new Promise((resolve) => { started = resolve; });
  const builder = createCandidateBuilder({
    projectRoot: workspace.root,
    runProcess: async (_executable, _args, options) => {
      started();
      await new Promise((resolve) => options.signal.addEventListener('abort', resolve, { once: true }));
      throw Object.assign(new Error('fixed termination failure'), { code: 'CANDIDATE_TERMINATION_FAILED' });
    },
  });
  const build = builder({ projectRoot: workspace.root, operationRoot, contentRoot: candidateContentRoot, distRoot: candidateDistRoot });
  await childStarted;

  await assert.rejects(builder.close(), (error) => error instanceof AggregateError
    && error.errors.some((entry) => entry?.code === 'CANDIDATE_TERMINATION_FAILED'));
  await assert.rejects(build, (error) => error?.code === 'CANDIDATE_TERMINATION_FAILED');
});

test('candidate builder close causally awaits its tree terminator', { timeout: 10_000 }, async (t) => {
  const workspace = await transactionWorkspace(t);
  const operationRoot = path.join(workspace.backupRoot, '20260812T120000Z-0096');
  const candidateContentRoot = path.join(operationRoot, '.candidate');
  const candidateDistRoot = path.join(operationRoot, 'candidate-dist');
  const astroRoot = path.join(workspace.root, 'node_modules', 'astro', 'bin');
  await mkdir(candidateContentRoot, { recursive: true });
  await mkdir(candidateDistRoot);
  await mkdir(astroRoot, { recursive: true });
  await writeFile(path.join(astroRoot, 'astro.mjs'), [
    "import { writeFile } from 'node:fs/promises';",
    "import path from 'node:path';",
    "await writeFile(path.join(process.env.EDITOR_OPERATION_ROOT, 'runner-started'), 'started');",
    'setInterval(() => {}, 1000);',
  ].join('\n'));
  let markTerminationStarted;
  const terminationStarted = new Promise((resolve) => { markTerminationStarted = resolve; });
  let releaseTermination;
  const terminationGate = new Promise((resolve) => { releaseTermination = resolve; });
  let terminationFinished = false;
  const builder = createCandidateBuilder({
    projectRoot: workspace.root,
    terminateTree: async (child) => {
      markTerminationStarted();
      child.kill('SIGTERM');
      if (child.exitCode === null && child.signalCode === null) await new Promise((resolve) => child.once('close', resolve));
      await terminationGate;
      terminationFinished = true;
    },
  });
  const build = builder({ projectRoot: workspace.root, operationRoot, contentRoot: candidateContentRoot, distRoot: candidateDistRoot });
  const marker = path.join(operationRoot, 'runner-started');
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await readFile(marker, 'utf8').then(() => true, () => false)) break;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.equal(await readFile(marker, 'utf8'), 'started');

  const closing = builder.close();
  assert.equal(await Promise.race([terminationStarted.then(() => true), new Promise((resolve) => setTimeout(() => resolve(false), 500))]), true);
  let closeSettled = false;
  void closing.finally(() => { closeSettled = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(closeSettled, false);
  releaseTermination();
  await closing;
  assert.equal(terminationFinished, true);
  await assert.rejects(build, (error) => error?.code === 'CANDIDATE_BUILD_FAILED');
});

test('candidate builder close rejects boundedly when tree termination fails before child close', { skip: process.platform !== 'win32', timeout: 10_000 }, async (t) => {
  const workspace = await transactionWorkspace(t);
  const operationRoot = path.join(workspace.backupRoot, '20260812T120000Z-0095');
  const candidateContentRoot = path.join(operationRoot, '.candidate');
  const candidateDistRoot = path.join(operationRoot, 'candidate-dist');
  const astroRoot = path.join(workspace.root, 'node_modules', 'astro', 'bin');
  await mkdir(candidateContentRoot, { recursive: true });
  await mkdir(candidateDistRoot);
  await mkdir(astroRoot, { recursive: true });
  await writeFile(path.join(astroRoot, 'astro.mjs'), [
    "import { writeFile } from 'node:fs/promises';",
    "import path from 'node:path';",
    "await writeFile(path.join(process.env.EDITOR_OPERATION_ROOT, 'runner-started'), String(process.pid));",
    'setInterval(() => {}, 1000);',
  ].join('\n'));
  let activeChild;
  const builder = createCandidateBuilder({
    projectRoot: workspace.root,
    terminateTree: async (child) => {
      activeChild = child;
      throw Object.assign(new Error('injected tree termination failure'), { code: 'CANDIDATE_TERMINATION_FAILED' });
    },
  });
  const build = builder({ projectRoot: workspace.root, operationRoot, contentRoot: candidateContentRoot, distRoot: candidateDistRoot });
  const marker = path.join(operationRoot, 'runner-started');
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await readFile(marker, 'utf8').then(() => true, () => false)) break;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.match(await readFile(marker, 'utf8'), /^\d+$/);

  const closing = builder.close();
  try {
    const result = await Promise.race([
      closing.then(() => ({ state: 'resolved' }), (error) => ({ state: 'rejected', error })),
      new Promise((resolve) => setTimeout(() => resolve({ state: 'timeout' }), 750)),
    ]);
    assert.equal(result.state, 'rejected');
    assert.ok(result.error instanceof AggregateError);
    assert.ok(result.error.errors.some((entry) => entry?.code === 'CANDIDATE_TERMINATION_FAILED'));
  } finally {
    if (activeChild?.pid && activeChild.exitCode === null && activeChild.signalCode === null) {
      assert.ok(typeof process.env.SystemRoot === 'string' && path.isAbsolute(process.env.SystemRoot));
      await new Promise((resolve, reject) => {
        const killer = spawn(path.join(process.env.SystemRoot, 'System32', 'taskkill.exe'), ['/PID', String(activeChild.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        killer.once('error', reject);
        killer.once('close', (code) => code === 0 ? resolve() : reject(new Error(`test cleanup taskkill failed: ${code}`)));
      });
    }
    await Promise.allSettled([closing, build]);
    assert.ok(!activeChild || activeChild.exitCode !== null || activeChild.signalCode !== null);
  }
});

test('candidate builder close terminates a real child process tree', { skip: process.platform !== 'win32', timeout: 15_000 }, async (t) => {
  const workspace = await transactionWorkspace(t);
  const operationRoot = path.join(workspace.backupRoot, '20260812T120000Z-0098');
  const candidateContentRoot = path.join(operationRoot, '.candidate');
  const candidateDistRoot = path.join(operationRoot, 'candidate-dist');
  const astroRoot = path.join(workspace.root, 'node_modules', 'astro', 'bin');
  await mkdir(candidateContentRoot, { recursive: true });
  await mkdir(candidateDistRoot);
  await mkdir(astroRoot, { recursive: true });
  await writeFile(path.join(astroRoot, 'astro.mjs'), [
    "import { spawn } from 'node:child_process';",
    "import { writeFile } from 'node:fs/promises';",
    "import path from 'node:path';",
    "const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', windowsHide: true });",
    "await writeFile(path.join(process.env.EDITOR_OPERATION_ROOT, 'descendant.pid'), String(child.pid));",
    "await new Promise(() => {});",
  ].join('\n'));
  const builder = createCandidateBuilder({ projectRoot: workspace.root });
  const build = builder({ projectRoot: workspace.root, operationRoot, contentRoot: candidateContentRoot, distRoot: candidateDistRoot });
  const pidPath = path.join(operationRoot, 'descendant.pid');
  let descendantPid;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try { descendantPid = Number(await readFile(pidPath, 'utf8')); break; }
    catch (error) { if (error?.code !== 'ENOENT') throw error; await new Promise((resolve) => setTimeout(resolve, 25)); }
  }
  assert.ok(Number.isSafeInteger(descendantPid));
  const alive = () => { try { process.kill(descendantPid, 0); return true; } catch { return false; } };
  t.after(async () => {
    await builder.close();
    if (alive()) await new Promise((resolve, reject) => {
      const killer = spawn('taskkill.exe', ['/PID', String(descendantPid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
      killer.once('error', reject);
      killer.once('close', (code) => code === 0 ? resolve() : reject(new Error(`test cleanup taskkill failed: ${code}`)));
    });
    assert.equal(alive(), false, 'test cleanup must leave no descendant');
  });
  assert.equal(alive(), true);

  await builder.close();
  await assert.rejects(build, (error) => error?.code === 'CANDIDATE_BUILD_FAILED');
  assert.equal(alive(), false);
});

test('candidate builder runs real Astro against only the operation content and output roots', async (t) => {
  const workspace = await transactionWorkspace(t);
  const operationRoot = path.join(workspace.backupRoot, '20260812T120000Z-0002');
  const candidateContentRoot = path.join(operationRoot, '.candidate');
  const candidateDistRoot = path.join(operationRoot, 'candidate-dist');
  await mkdir(operationRoot);
  await cp(workspace.contentRoot, candidateContentRoot, { recursive: true });
  await mkdir(candidateDistRoot);
  const sitePath = path.join(candidateContentRoot, 'site.yml');
  await writeFile(sitePath, (await readFile(sitePath, 'utf8')).replace(/name: .*/, 'name: Isolated Candidate Build'));
  const builder = createCandidateBuilder({ projectRoot: path.resolve('.') });
  assert.deepEqual(await builder({
    projectRoot: path.resolve('.'), operationRoot, contentRoot: candidateContentRoot, distRoot: candidateDistRoot,
  }), { ok: true, diagnostic: { code: 'CANDIDATE_BUILD_OK' } });
  assert.equal((await readFile(path.join(candidateDistRoot, 'index.html'), 'utf8')).includes('Isolated Candidate Build'), true);
  assert.equal((await readFile(path.join(workspace.contentRoot, 'site.yml'), 'utf8')).includes('Isolated Candidate Build'), false);
});

test('candidate builder rejects an operation root outside its configured project before process execution', async (t) => {
  const workspace = await transactionWorkspace(t);
  const outside = await transactionWorkspace(t);
  let executions = 0;
  const operationRoot = path.join(outside.backupRoot, '20260812T120000Z-0003');
  const candidateContentRoot = path.join(operationRoot, '.candidate');
  const candidateDistRoot = path.join(operationRoot, 'candidate-dist');
  await mkdir(candidateContentRoot, { recursive: true });
  await mkdir(candidateDistRoot);
  const builder = createCandidateBuilder({ projectRoot: workspace.root, runProcess: async () => { executions += 1; return { exitCode: 0 }; } });
  await assert.rejects(builder({
    projectRoot: workspace.root,
    operationRoot,
    contentRoot: candidateContentRoot,
    distRoot: candidateDistRoot,
  }), (error) => error?.code === 'CANDIDATE_BUILD_FAILED');
  assert.equal(executions, 0);
});

test('candidate builder rejects a project source reparse point before process execution', async (t) => {
  const workspace = await transactionWorkspace(t);
  const operationRoot = path.join(workspace.backupRoot, '20260812T120000Z-0003');
  const candidateContentRoot = path.join(operationRoot, '.candidate');
  const candidateDistRoot = path.join(operationRoot, 'candidate-dist');
  const outside = path.join(workspace.parent, 'outside-build-source');
  const linked = path.join(workspace.root, 'linked-source');
  await mkdir(candidateContentRoot, { recursive: true });
  await mkdir(candidateDistRoot);
  await mkdir(outside);
  await writeFile(path.join(outside, 'sentinel.txt'), 'outside bytes\n');
  try { await symlink(outside, linked, 'junction'); }
  catch (error) {
    if (['EPERM', 'EACCES'].includes(error?.code)) { t.skip('junction creation unavailable'); return; }
    throw error;
  }
  let executions = 0;
  const builder = createCandidateBuilder({ projectRoot: workspace.root, runProcess: async () => { executions += 1; return { exitCode: 0 }; } });
  await assert.rejects(builder({ projectRoot: workspace.root, operationRoot, contentRoot: candidateContentRoot, distRoot: candidateDistRoot }), (error) => error?.code === 'CANDIDATE_BUILD_FAILED');
  assert.equal(executions, 0);
  assert.equal(await readFile(path.join(outside, 'sentinel.txt'), 'utf8'), 'outside bytes\n');
});

test('candidate source manifest excludes only the ignored portable Node runtime tree', async (t) => {
  const workspace = await transactionWorkspace(t);
  const operationRoot = path.join(workspace.backupRoot, '20260812T120000Z-0004');
  const candidateContentRoot = path.join(operationRoot, '.candidate');
  const candidateDistRoot = path.join(operationRoot, 'candidate-dist');
  const portableNode = path.join(workspace.root, '.local-editor', 'tools', 'node', 'node.exe');
  await mkdir(candidateContentRoot, { recursive: true });
  await mkdir(candidateDistRoot);
  await mkdir(path.dirname(portableNode), { recursive: true });
  await writeFile(portableNode, 'portable runtime before\n');
  const builder = createCandidateBuilder({
    projectRoot: workspace.root,
    runProcess: async () => {
      await writeFile(portableNode, 'portable runtime after\n');
      await writeFile(path.join(candidateDistRoot, 'index.html'), 'candidate\n');
      return { exitCode: 0, stdout: '', stderr: '' };
    },
  });
  assert.deepEqual(await builder({
    projectRoot: workspace.root,
    operationRoot,
    contentRoot: candidateContentRoot,
    distRoot: candidateDistRoot,
  }), { ok: true, diagnostic: { code: 'CANDIDATE_BUILD_OK' } });
  assert.equal(await readFile(portableNode, 'utf8'), 'portable runtime after\n');
});

test('candidate source manifest still detects writes beside the portable Node runtime tree', async (t) => {
  const workspace = await transactionWorkspace(t);
  const operationRoot = path.join(workspace.backupRoot, '20260812T120000Z-0004');
  const candidateContentRoot = path.join(operationRoot, '.candidate');
  const candidateDistRoot = path.join(operationRoot, 'candidate-dist');
  const protectedRecord = path.join(workspace.root, '.local-editor', 'tools', 'install-record.json');
  await mkdir(candidateContentRoot, { recursive: true });
  await mkdir(candidateDistRoot);
  await mkdir(path.dirname(protectedRecord), { recursive: true });
  await writeFile(protectedRecord, 'record before\n');
  const builder = createCandidateBuilder({ projectRoot: workspace.root, runProcess: async () => {
    await writeFile(protectedRecord, 'record after\n');
    await writeFile(path.join(candidateDistRoot, 'index.html'), 'candidate\n');
    return { exitCode: 0, stdout: '', stderr: '' };
  } });
  await assert.rejects(builder({
    projectRoot: workspace.root,
    operationRoot,
    contentRoot: candidateContentRoot,
    distRoot: candidateDistRoot,
  }), (error) => error?.code === 'CANDIDATE_BUILD_FAILED');
});

test('candidate source manifest never treats a portable runtime junction as ignored', async (t) => {
  const workspace = await transactionWorkspace(t);
  const operationRoot = path.join(workspace.backupRoot, '20260812T120000Z-0004');
  const candidateContentRoot = path.join(operationRoot, '.candidate');
  const candidateDistRoot = path.join(operationRoot, 'candidate-dist');
  const portableRoot = path.join(workspace.root, '.local-editor', 'tools', 'node');
  const outside = path.join(workspace.parent, 'outside-portable-runtime');
  await mkdir(candidateContentRoot, { recursive: true });
  await mkdir(candidateDistRoot);
  await mkdir(path.dirname(portableRoot), { recursive: true });
  await mkdir(outside);
  await writeFile(path.join(outside, 'node.exe'), 'outside runtime\n');
  await symlink(outside, portableRoot, 'junction');
  let executions = 0;
  const builder = createCandidateBuilder({ projectRoot: workspace.root, runProcess: async () => { executions += 1; return { exitCode: 0 }; } });
  await assert.rejects(builder({
    projectRoot: workspace.root,
    operationRoot,
    contentRoot: candidateContentRoot,
    distRoot: candidateDistRoot,
  }), (error) => error?.code === 'CANDIDATE_BUILD_FAILED');
  assert.equal(executions, 0);
});

test('candidate build permissions deny create, modify, and delete outside the active operation', async (t) => {
  const workspace = await transactionWorkspace(t);
  const operationRoot = path.join(workspace.backupRoot, '20260812T120000Z-0004');
  const candidateContentRoot = path.join(operationRoot, '.candidate');
  const candidateDistRoot = path.join(operationRoot, 'candidate-dist');
  await mkdir(candidateContentRoot, { recursive: true });
  await mkdir(candidateDistRoot);
  let call;
  const builder = createCandidateBuilder({ projectRoot: workspace.root, runProcess: async (executable, args, options) => {
    call = { executable, args, options };
    await writeFile(path.join(candidateDistRoot, 'index.html'), 'candidate\n');
    return { exitCode: 0, stdout: '', stderr: '' };
  } });
  await builder({ projectRoot: workspace.root, operationRoot, contentRoot: candidateContentRoot, distRoot: candidateDistRoot });
  const astroScript = path.join(workspace.root, 'node_modules', 'astro', 'bin', 'astro.mjs');
  const permissionArgs = call.args.slice(0, call.args.indexOf(astroScript));
  const canonicalSite = path.join(workspace.contentRoot, 'site.yml');
  const canonicalDist = path.join(workspace.distRoot, 'index.html');
  const forbidden = path.join(workspace.root, 'outside-build-write.txt');
  const resultPath = path.join(operationRoot, 'permission-probe.json');
  const originalSite = await readFile(canonicalSite);
  const originalDist = await readFile(canonicalDist);
  const probe = [
    "import { writeFile, unlink } from 'node:fs/promises';",
    'const outcomes=[];',
    "for (const [kind,action] of [['create',()=>writeFile(process.env.FORBIDDEN,'new')],['modify',()=>writeFile(process.env.CANONICAL_SITE,'changed')],['delete',()=>unlink(process.env.CANONICAL_DIST)]]) { try { await action(); outcomes.push([kind,'allowed']); } catch (error) { outcomes.push([kind,error?.code]); } }",
    "await writeFile(process.env.RESULT, JSON.stringify(outcomes));",
  ].join('');
  try {
    const exitCode = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [...permissionArgs, '--input-type=module', '-e', probe], { cwd: workspace.root, shell: false, windowsHide: true, env: { ...process.env, FORBIDDEN: forbidden, CANONICAL_SITE: canonicalSite, CANONICAL_DIST: canonicalDist, RESULT: resultPath } });
      child.once('error', reject); child.once('close', resolve);
    });
    assert.equal(exitCode, 0);
    const outcomes = JSON.parse(await readFile(resultPath, 'utf8'));
    assert.deepEqual(outcomes.map(([kind]) => kind), ['create', 'modify', 'delete']);
    assert.ok(outcomes.every(([, code]) => code === 'ERR_ACCESS_DENIED'));
    await assert.rejects(readFile(forbidden), (error) => error?.code === 'ENOENT');
    assert.deepEqual(await readFile(canonicalSite), originalSite);
    assert.deepEqual(await readFile(canonicalDist), originalDist);
  } finally {
    await rm(forbidden, { force: true });
    await writeFile(canonicalSite, originalSite);
    await writeFile(canonicalDist, originalDist);
  }
});
