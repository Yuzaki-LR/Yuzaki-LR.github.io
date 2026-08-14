import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import test from 'node:test';
import { createTestWorkspace } from '../../test/helpers.mjs';
import { startEditor } from '../server/app.mjs';
import { runEditorMain } from '../server/main.mjs';

async function unusedPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen({ host: '127.0.0.1', port: 0 }, resolve);
  });
  const address = server.address();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

function cannotConnect(port) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    socket.setTimeout(500);
    socket.once('connect', () => { socket.destroy(); reject(new Error('editor unexpectedly listened')); });
    socket.once('timeout', () => { socket.destroy(); reject(new Error('listener probe timed out')); });
    socket.once('error', (error) => error.code === 'ECONNREFUSED' ? resolve() : reject(error));
  });
}

function request(origin, target, { method = 'GET', headers = {}, body } = {}) {
  const url = new URL(target, origin);
  return new Promise((resolve, reject) => {
    const value = http.request({ hostname: url.hostname, port: url.port, path: url.pathname + url.search, method, headers }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, body: Buffer.concat(chunks), headers: response.headers }));
    });
    value.once('error', reject);
    value.end(body);
  });
}

async function treeHash(root) {
  const hash = createHash('sha256');
  async function visit(directory) {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const target = path.join(directory, entry.name);
      hash.update(path.relative(root, target).replace(/\\/g, '/')); hash.update('\0');
      if (entry.isDirectory()) await visit(target);
      else hash.update(await readFile(target));
    }
  }
  await visit(root);
  return hash.digest('hex');
}

test('an empty sentinel workspace has no incomplete transactions to recover', async (t) => {
  const { createTransactionService } = await import('../server/transaction-service.mjs');
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
    buildCandidate: async () => assert.fail('recovery must not build'),
  });
  assert.deepEqual(await service.recoverIncompleteTransactions(), []);
});

test('startup rejects a canonical root replaced by a junction even with no pending journal', async (t) => {
  const { createTransactionService } = await import('../server/transaction-service.mjs');
  const workspace = await createTestWorkspace(); t.after(workspace.cleanup);
  const contentRoot = path.join(workspace.root, 'src', 'content');
  const savedContentRoot = `${contentRoot}-safe`;
  const distRoot = path.join(workspace.root, 'dist');
  const backupRoot = path.join(workspace.root, '.local-editor', 'backups');
  await mkdir(distRoot, { recursive: true }); await mkdir(backupRoot, { recursive: true });
  await rename(contentRoot, savedContentRoot);
  try { await symlink(savedContentRoot, contentRoot, 'junction'); }
  catch (error) {
    await rename(savedContentRoot, contentRoot);
    if (['EPERM', 'EACCES'].includes(error?.code)) { t.skip('junction creation unavailable'); return; }
    throw error;
  }
  try {
    const service = createTransactionService({ projectRoot: workspace.root, contentRoot, distRoot, backupRoot, buildCandidate: async () => assert.fail('unsafe root must not build') });
    assert.deepEqual(await service.recoverBeforeListen(), { ok: false, recoveryOnly: true, messageZh: '检测到无法自动恢复的编辑记录，请保留现场并人工检查。' });
  } finally {
    await rm(contentRoot);
    await rename(savedContentRoot, contentRoot);
  }
});

test('unknown journal phase is fail-closed and leaves every byte in place', async (t) => {
  const { createTransactionService } = await import('../server/transaction-service.mjs');
  const workspace = await createTestWorkspace(); t.after(workspace.cleanup);
  const contentRoot = path.join(workspace.root, 'src', 'content');
  const distRoot = path.join(workspace.root, 'dist');
  const backupRoot = path.join(workspace.root, '.local-editor', 'backups');
  await mkdir(distRoot, { recursive: true }); await writeFile(path.join(distRoot, 'index.html'), 'old dist\n'); await mkdir(backupRoot, { recursive: true });
  const bootstrap = await import('../server/repository-service.mjs').then(({ createRepositoryService }) => createRepositoryService({ projectRoot: workspace.root, csrfToken: 'csrf' }).bootstrap());
  const input = { baseManifestHash: bootstrap.baseManifestHash, bundle: { baseManifestHash: bootstrap.baseManifestHash, sessionId: 'a'.repeat(32), content: { site: bootstrap.site, about: bootstrap.about, projects: bootstrap.projects, research: bootstrap.research }, images: bootstrap.images.map(({ destination, sha256 }) => ({ kind: 'canonical', destination, sha256 })) }, uploads: [] };
  const options = { projectRoot: workspace.root, contentRoot, distRoot, backupRoot, clock: () => new Date('2026-08-12T12:00:00.000Z'), idFactory: () => '20260812T120000Z-0001', buildCandidate: async ({ distRoot: target }) => writeFile(path.join(target, 'index.html'), 'candidate\n') };
  await createTransactionService(options).save(input);
  const journalPath = path.join(backupRoot, '20260812T120000Z-0001', 'journal.json');
  const journal = JSON.parse(await readFile(journalPath, 'utf8')); journal.phase = 'invented-phase'; await writeFile(journalPath, `${JSON.stringify(journal)}\n`);
  const before = { content: await treeHash(contentRoot), dist: await treeHash(distRoot), journal: await readFile(journalPath) };
  const service = createTransactionService(options);
  assert.deepEqual(await service.recoverBeforeListen(), { ok: false, recoveryOnly: true, messageZh: '检测到无法自动恢复的编辑记录，请保留现场并人工检查。' });
  assert.deepEqual({ content: await treeHash(contentRoot), dist: await treeHash(distRoot), journal: await readFile(journalPath) }, before);
});

test('journal manifests reject non-canonical relative paths before recovery can trust them', async (t) => {
  const { createTransactionService } = await import('../server/transaction-service.mjs');
  const workspace = await createTestWorkspace(); t.after(workspace.cleanup);
  const contentRoot = path.join(workspace.root, 'src', 'content');
  const distRoot = path.join(workspace.root, 'dist');
  const backupRoot = path.join(workspace.root, '.local-editor', 'backups');
  await mkdir(distRoot, { recursive: true }); await writeFile(path.join(distRoot, 'index.html'), 'old dist\n'); await mkdir(backupRoot, { recursive: true });
  const bootstrap = await import('../server/repository-service.mjs').then(({ createRepositoryService }) => createRepositoryService({ projectRoot: workspace.root, csrfToken: 'csrf' }).bootstrap());
  const input = { baseManifestHash: bootstrap.baseManifestHash, bundle: { baseManifestHash: bootstrap.baseManifestHash, sessionId: 'a'.repeat(32), content: { site: bootstrap.site, about: bootstrap.about, projects: bootstrap.projects, research: bootstrap.research }, images: bootstrap.images.map(({ destination, sha256 }) => ({ kind: 'canonical', destination, sha256 })) }, uploads: [] };
  const options = { projectRoot: workspace.root, contentRoot, distRoot, backupRoot, clock: () => new Date('2026-08-12T12:00:00.000Z'), idFactory: () => '20260812T120000Z-0001', buildCandidate: async ({ distRoot: target }) => writeFile(path.join(target, 'index.html'), 'candidate\n') };
  await createTransactionService(options).save(input);
  const journalPath = path.join(backupRoot, '20260812T120000Z-0001', 'journal.json');
  const journal = JSON.parse(await readFile(journalPath, 'utf8'));
  const [firstPath, firstEntry] = Object.entries(journal.before.content.files)[0];
  delete journal.before.content.files[firstPath];
  journal.before.content.files['../outside.txt'] = firstEntry;
  await writeFile(journalPath, `${JSON.stringify(journal)}\n`);
  const before = { content: await treeHash(contentRoot), dist: await treeHash(distRoot), journal: await readFile(journalPath) };
  const service = createTransactionService(options);
  assert.deepEqual(await service.recoverBeforeListen(), { ok: false, recoveryOnly: true, messageZh: '检测到无法自动恢复的编辑记录，请保留现场并人工检查。' });
  assert.deepEqual({ content: await treeHash(contentRoot), dist: await treeHash(distRoot), journal: await readFile(journalPath) }, before);
});

test('failed recoverBeforeListen refuses the listener and exposes only a sanitised recovery result', async () => {
  const port = await unusedPort();
  const privateText = `${process.cwd()} TOKEN=private source bytes`;
  let unexpectedlyStarted;
  try {
    await assert.rejects(
      startEditor({
      projectRoot: process.cwd(),
      preferredPort: port,
      token: 'startup-A',
      csrfToken: 'csrf-A',
      repositoryService: { bootstrap: async () => ({ csrfToken: 'csrf-A' }) },
      transactionService: {
        recoverBeforeListen: async () => ({ ok: false, recoveryOnly: true, messageZh: '检测到无法自动恢复的编辑记录，请保留现场并人工检查。', internal: privateText }),
        runMutation: async () => assert.fail('failed startup must not mutate'),
        isRecoveryOnly: () => true,
      },
      }).then((editor) => { unexpectedlyStarted = editor; return editor; }),
      (error) => {
        assert.equal(error?.code, 'RECOVERY_REQUIRED');
        assert.equal(error?.messageZh, '检测到无法自动恢复的编辑记录，请保留现场并人工检查。');
        assert.doesNotMatch(JSON.stringify(error), /TOKEN=|source bytes|yunxi-academic-website/i);
        return true;
      },
    );
  } finally {
    await unexpectedlyStarted?.close();
  }
  await cannotConnect(port);
});

test('the editor refuses to listen when the transaction recovery gate is omitted', async () => {
  const port = await unusedPort();
  let unexpectedlyStarted;
  let closes = 0;
  const uploadStore = { sessionId: 'a'.repeat(32), close: () => { closes += 1; } };
  try {
    await assert.rejects(
      startEditor({
        projectRoot: process.cwd(), preferredPort: port, token: 'startup-A', csrfToken: 'csrf-A',
        repositoryService: { bootstrap: async () => ({ csrfToken: 'csrf-A' }) }, uploadStore,
      }).then((editor) => {
        unexpectedlyStarted = editor;
        throw new Error('editor listened without a transaction recovery gate');
      }),
      (error) => error?.code === 'RECOVERY_REQUIRED',
    );
  } finally {
    await unexpectedlyStarted?.close();
  }
  assert.equal(closes, 1);
  await cannotConnect(port);
});

test('startup abort in the real Node listen window rejects boundedly and leaves no listener', { timeout: 5_000 }, async () => {
  const port = await unusedPort();
  const controller = new AbortController();
  const originalListen = http.Server.prototype.listen;
  let listeningServer;
  let uploadCloses = 0;
  http.Server.prototype.listen = function listenAndAbort(...args) {
    const result = originalListen.apply(this, args);
    listeningServer = this;
    controller.abort();
    return result;
  };
  let outcome;
  try {
    const startup = startEditor({
      projectRoot: process.cwd(),
      preferredPort: port,
      token: 'startup-A',
      csrfToken: 'csrf-A',
      repositoryService: { bootstrap: async () => ({ csrfToken: 'csrf-A' }) },
      transactionService: {
        recoverBeforeListen: async () => ({ ok: true, recoveryOnly: false, results: [] }),
        runMutation: async (action) => action(),
      },
      uploadStore: { sessionId: 'a'.repeat(32), close: () => { uploadCloses += 1; } },
      signal: controller.signal,
    });
    outcome = await Promise.race([
      startup.then(() => ({ state: 'resolved' }), (error) => ({ state: 'rejected', error })),
      new Promise((resolve) => setTimeout(() => resolve({ state: 'timeout' }), 750)),
    ]);
  } finally {
    http.Server.prototype.listen = originalListen;
    if (listeningServer?.listening) await new Promise((resolve, reject) => listeningServer.close((error) => error ? reject(error) : resolve()));
  }
  assert.equal(outcome.state, 'rejected');
  assert.equal(outcome.error?.code, 'STARTUP_ABORTED');
  assert.equal(listeningServer?.listening, false);
  assert.equal(listeningServer?.listenerCount('error'), 0);
  assert.deepEqual(listeningServer?.rawListeners('listening').filter((listener) => (listener.listener ?? listener).name === 'onListening'), []);
  assert.equal(listeningServer?.listenerCount('close'), 0);
  assert.equal(uploadCloses, 1);
  await cannotConnect(port);
});

test('the command entrypoint emits only the fixed Chinese recovery instruction and no URL', async () => {
  let stdout = '';
  let stderr = '';
  const privateText = `${process.cwd()} TOKEN=private source bytes`;
  const result = await runEditorMain({
    projectRoot: process.cwd(),
    token: 'startup-A',
    csrfToken: 'csrf-A',
    repositoryService: { bootstrap: async () => ({ csrfToken: 'csrf-A' }) },
    transactionService: {
      recoverBeforeListen: async () => ({ ok: false, recoveryOnly: true, internal: privateText }),
      runMutation: async () => assert.fail('failed startup must not mutate'),
      isRecoveryOnly: () => true,
    },
    stdout: { write(value) { stdout += value; } },
    stderr: { write(value) { stderr += value; } },
  });
  assert.deepEqual(result, { ok: false, exitCode: 1 });
  assert.equal(stdout, '');
  assert.equal(stderr, '检测到无法自动恢复的编辑记录，请保留现场并人工检查。\n');
  assert.doesNotMatch(`${stdout}${stderr}`, /https?:|TOKEN=|source bytes|yunxi-academic-website|stack/i);
});

test('the command entrypoint creates its confined backup root and recovers before starting', async (t) => {
  const workspace = await createTestWorkspace(); t.after(workspace.cleanup);
  let recovered = false;
  let stdout = '';
  const result = await runEditorMain({
    projectRoot: workspace.root,
    token: 'startup-A', csrfToken: 'csrf-A',
    repositoryService: { bootstrap: async () => ({ csrfToken: 'csrf-A' }) },
    start: async ({ transactionService }) => {
      const startup = await transactionService.recoverBeforeListen();
      assert.deepEqual(startup, { ok: true, recoveryOnly: false, results: [] });
      recovered = true;
      return { origin: 'http://127.0.0.1:12345', close: async () => {} };
    },
    env: { EDITOR_NO_OPEN: '1', PATH: path.dirname(process.execPath) },
    stdout: { write(value) { stdout += value; } }, stderr: { write() { assert.fail('successful startup must not write stderr'); } },
  });
  assert.equal(result.ok, true); assert.equal(recovered, true);
  assert.equal(stdout, 'EDITOR_READY=http://127.0.0.1:12345/?session=startup-A\n');
  assert.deepEqual(await readdir(path.join(workspace.root, '.local-editor', 'backups')), []);
});

test('the command entrypoint rejects a local-editor junction before any outside directory write', async (t) => {
  const workspace = await createTestWorkspace(); t.after(workspace.cleanup);
  const outside = path.join(workspace.parent, 'outside-main-target'); await mkdir(outside);
  try { await symlink(outside, path.join(workspace.root, '.local-editor'), 'junction'); }
  catch (error) { if (['EPERM', 'EACCES'].includes(error?.code)) { t.skip('junction creation unavailable'); return; } throw error; }
  let started = false; let stderr = '';
  const result = await runEditorMain({
    projectRoot: workspace.root,
    start: async () => { started = true; throw new Error('must not start'); },
    env: { EDITOR_NO_OPEN: '1', PATH: path.dirname(process.execPath) },
    stdout: { write() { assert.fail('unsafe startup must not emit URL'); } }, stderr: { write(value) { stderr += value; } },
  });
  assert.deepEqual(result, { ok: false, exitCode: 1 }); assert.equal(started, false);
  assert.equal(stderr, '网站编辑器启动失败，请保留此窗口中的提示并联系维护者。\n');
  assert.deepEqual(await readdir(outside), []);
});

test('runtime recovery-only blocks uploads before decoding or upload-store mutation', async (t) => {
  let recoveryOnly = false;
  let decodes = 0;
  let reservations = 0;
  const uploadStore = {
    sessionId: 'a'.repeat(32), maxFileBytes: 1024, maxPixels: 1024,
    beginDecode() { reservations += 1; return () => {}; },
    add() { throw new Error('upload store must not mutate'); },
    remove() { throw new Error('upload store must not mutate'); },
    close() {},
  };
  const editor = await startEditor({
    projectRoot: process.cwd(), preferredPort: 0, token: 'startup-A', csrfToken: 'csrf-A', uploadStore,
    repositoryService: { bootstrap: async () => ({ csrfToken: 'csrf-A' }) },
    transactionService: {
      recoverBeforeListen: async () => ({ ok: true, recoveryOnly: false, results: [] }),
      runMutation: async (action) => {
        if (recoveryOnly) throw Object.assign(new Error('recovery only'), { code: 'RECOVERY_REQUIRED' });
        return action();
      },
      isRecoveryOnly: () => recoveryOnly,
    },
    imageDecoder: async () => { decodes += 1; return { bytes: Buffer.from([1]), width: 1, height: 1, mime: 'image/png', safeName: 'safe-12345678.png', sha256: 'b'.repeat(64) }; },
  });
  t.after(editor.close);
  const authority = new URL(editor.origin).host;
  const bootstrap = await request(editor.origin, '/?session=startup-A', { headers: { Host: authority } });
  const cookie = bootstrap.headers['set-cookie'][0].split(';')[0];
  recoveryOnly = true;
  const response = await request(editor.origin, '/api/uploads', {
    method: 'POST',
    headers: {
      Host: authority, Origin: editor.origin, Cookie: cookie, 'X-Editor-CSRF': 'csrf-A',
      'Content-Type': 'application/octet-stream', 'Content-Length': '1', 'X-Editor-Content-Length': '1', 'X-Editor-Filename': 'safe.png',
    },
    body: Buffer.from([1]),
  });
  assert.equal(response.status, 503);
  assert.equal(decodes, 0);
  assert.equal(reservations, 0);
  const deleted = await request(editor.origin, `/api/uploads/${'b'.repeat(32)}`, {
    method: 'DELETE', headers: { Host: authority, Origin: editor.origin, Cookie: cookie, 'X-Editor-CSRF': 'csrf-A' },
  });
  assert.equal(deleted.status, 503);
});

test('a recreated canonical path preserves both trees and restart refuses to listen', async (t) => {
  const { createTransactionService } = await import('../server/transaction-service.mjs');
  const { createRepositoryService } = await import('../server/repository-service.mjs');
  const workspace = await createTestWorkspace(); t.after(workspace.cleanup);
  const contentRoot = path.join(workspace.root, 'src', 'content');
  const distRoot = path.join(workspace.root, 'dist');
  const backupRoot = path.join(workspace.root, '.local-editor', 'backups');
  await mkdir(distRoot, { recursive: true }); await writeFile(path.join(distRoot, 'index.html'), 'old dist\n'); await mkdir(backupRoot, { recursive: true });
  const bootstrap = await createRepositoryService({ projectRoot: workspace.root, csrfToken: 'csrf' }).bootstrap();
  const input = {
    baseManifestHash: bootstrap.baseManifestHash,
    bundle: { baseManifestHash: bootstrap.baseManifestHash, sessionId: 'a'.repeat(32), content: { site: { ...bootstrap.site, name: 'Candidate' }, about: bootstrap.about, projects: bootstrap.projects, research: bootstrap.research }, images: bootstrap.images.map(({ destination, sha256 }) => ({ kind: 'canonical', destination, sha256 })) },
    uploads: [],
  };
  let externalHash;
  const options = {
    projectRoot: workspace.root, contentRoot, distRoot, backupRoot,
    clock: () => new Date('2026-08-12T12:00:00.000Z'), idFactory: () => '20260812T120000Z-0001',
    buildCandidate: async ({ distRoot: target }) => writeFile(path.join(target, 'index.html'), 'candidate dist\n'),
  };
  const service = createTransactionService({ ...options, failpoint: async (boundary) => {
    if (boundary === 'after-old-content-rename') {
      await mkdir(contentRoot, { recursive: true });
      await writeFile(path.join(contentRoot, 'external.txt'), 'external canonical generation\n');
      externalHash = await treeHash(contentRoot);
    }
  } });
  await assert.rejects(service.save(input), (error) => error?.code === 'RECOVERY_REQUIRED');
  const movedRoot = path.join(backupRoot, '20260812T120000Z-0001', 'before', 'content');
  const movedHash = await treeHash(movedRoot);
  assert.equal(await treeHash(contentRoot), externalHash);
  assert.notEqual(movedHash, externalHash);
  assert.equal(service.isRecoveryOnly(), true);
  const journal = JSON.parse(await readFile(path.join(backupRoot, '20260812T120000Z-0001', 'journal.json'), 'utf8'));
  assert.equal(journal.phase, 'manual-recovery-required');
  const frozen = { content: await treeHash(contentRoot), dist: await treeHash(distRoot), journal: await readFile(path.join(backupRoot, '20260812T120000Z-0001', 'journal.json')) };
  for (const operation of [
    () => service.save(input),
    () => service.archiveDraft(input),
    () => service.restore({}),
  ]) {
    await assert.rejects(operation(), (error) => error?.code === 'RECOVERY_REQUIRED');
    assert.deepEqual({ content: await treeHash(contentRoot), dist: await treeHash(distRoot), journal: await readFile(path.join(backupRoot, '20260812T120000Z-0001', 'journal.json')) }, frozen);
  }

  const restarted = createTransactionService(options);
  const startup = await restarted.recoverBeforeListen();
  assert.deepEqual(startup, { ok: false, recoveryOnly: true, messageZh: '检测到无法自动恢复的编辑记录，请保留现场并人工检查。' });
  assert.equal(restarted.isRecoveryOnly(), true);
  assert.equal(await treeHash(contentRoot), externalHash);
  assert.equal(await treeHash(movedRoot), movedHash);
});

test('a crash after old-content rename recovers the complete old state', async (t) => {
  const { createTransactionService } = await import('../server/transaction-service.mjs');
  const { createRepositoryService } = await import('../server/repository-service.mjs');
  const workspace = await createTestWorkspace(); t.after(workspace.cleanup);
  const contentRoot = path.join(workspace.root, 'src', 'content');
  const distRoot = path.join(workspace.root, 'dist');
  const backupRoot = path.join(workspace.root, '.local-editor', 'backups');
  await mkdir(distRoot, { recursive: true }); await writeFile(path.join(distRoot, 'index.html'), 'old dist\n'); await mkdir(backupRoot, { recursive: true });
  const old = { content: await treeHash(contentRoot), dist: await treeHash(distRoot) };
  const bootstrap = await createRepositoryService({ projectRoot: workspace.root, csrfToken: 'csrf' }).bootstrap();
  const input = {
    baseManifestHash: bootstrap.baseManifestHash,
    bundle: { baseManifestHash: bootstrap.baseManifestHash, sessionId: 'a'.repeat(32), content: { site: { ...bootstrap.site, name: 'Candidate' }, about: bootstrap.about, projects: bootstrap.projects, research: bootstrap.research }, images: bootstrap.images.map(({ destination, sha256 }) => ({ kind: 'canonical', destination, sha256 })) },
    uploads: [],
  };
  const options = {
    projectRoot: workspace.root, contentRoot, distRoot, backupRoot,
    clock: () => new Date('2026-08-12T12:00:00.000Z'), idFactory: () => '20260812T120000Z-0001',
    buildCandidate: async ({ distRoot: target }) => writeFile(path.join(target, 'index.html'), 'candidate dist\n'),
  };
  const crashing = createTransactionService({ ...options, failpoint: (boundary) => {
    if (boundary === 'after-old-content-rename') throw new Error('simulated crash');
  } });
  await assert.rejects(crashing.save(input), /simulated crash/);
  const restarted = createTransactionService(options);
  assert.deepEqual(await restarted.recoverIncompleteTransactions(), [{ operationId: '20260812T120000Z-0001', status: 'recovered-old' }]);
  assert.deepEqual({ content: await treeHash(contentRoot), dist: await treeHash(distRoot) }, old);
  assert.deepEqual(await restarted.recoverBeforeListen(), { ok: true, recoveryOnly: false, results: [] });
});

test('contradictory moved-dist recovery proves every tree before changing canonical bytes', async (t) => {
  const { createTransactionService } = await import('../server/transaction-service.mjs');
  const { createRepositoryService } = await import('../server/repository-service.mjs');
  const workspace = await createTestWorkspace(); t.after(workspace.cleanup);
  const contentRoot = path.join(workspace.root, 'src', 'content');
  const distRoot = path.join(workspace.root, 'dist');
  const backupRoot = path.join(workspace.root, '.local-editor', 'backups');
  await mkdir(distRoot, { recursive: true }); await writeFile(path.join(distRoot, 'index.html'), 'old dist\n'); await mkdir(backupRoot, { recursive: true });
  const bootstrap = await createRepositoryService({ projectRoot: workspace.root, csrfToken: 'csrf' }).bootstrap();
  const input = {
    baseManifestHash: bootstrap.baseManifestHash,
    bundle: { baseManifestHash: bootstrap.baseManifestHash, sessionId: 'a'.repeat(32), content: { site: { ...bootstrap.site, name: 'Candidate' }, about: bootstrap.about, projects: bootstrap.projects, research: bootstrap.research }, images: bootstrap.images.map(({ destination, sha256 }) => ({ kind: 'canonical', destination, sha256 })) },
    uploads: [],
  };
  const operationId = '20260812T120000Z-0001';
  const options = {
    projectRoot: workspace.root, contentRoot, distRoot, backupRoot,
    clock: () => new Date('2026-08-12T12:00:00.000Z'), idFactory: () => operationId,
    buildCandidate: async ({ distRoot: target }) => writeFile(path.join(target, 'index.html'), 'candidate dist\n'),
  };
  let injectedDistEdit = false;
  const crashing = createTransactionService({ ...options, failpoint: async (boundary, context) => {
    if (!injectedDistEdit && boundary === 'before-journal-temp-flush' && context?.phase === 'before-old-dist-rename') {
      injectedDistEdit = true;
      await writeFile(path.join(distRoot, 'index.html'), 'external dist generation\n');
    }
    if (boundary === 'before-conflict-new-content-rollback') throw new Error('simulated moved-dist rollback crash');
  } });
  await assert.rejects(crashing.save(input), /simulated moved-dist rollback crash/);
  assert.equal(injectedDistEdit, true);

  const operationRoot = path.join(backupRoot, operationId);
  const journalPath = path.join(operationRoot, 'journal.json');
  assert.equal(JSON.parse(await readFile(journalPath, 'utf8')).phase, 'before-conflict-new-content-rollback');
  const movedSitePath = path.join(operationRoot, 'before', 'content', 'site.yml');
  await writeFile(movedSitePath, `${await readFile(movedSitePath, 'utf8')}\n# contradictory generation\n`);
  const frozen = { tree: await treeHash(workspace.root), journal: await readFile(journalPath), canonicalContent: await treeHash(contentRoot) };

  const restarted = createTransactionService(options);
  assert.deepEqual(await restarted.recoverBeforeListen(), { ok: false, recoveryOnly: true, messageZh: '检测到无法自动恢复的编辑记录，请保留现场并人工检查。' });
  assert.equal(await readdir(contentRoot).then(() => true, () => false), true);
  assert.deepEqual({ tree: await treeHash(workspace.root), journal: await readFile(journalPath), canonicalContent: await treeHash(contentRoot) }, frozen);
});

test('startup proves every incomplete transaction before mutating any transaction', async (t) => {
  const { createTransactionService } = await import('../server/transaction-service.mjs');
  const { createRepositoryService } = await import('../server/repository-service.mjs');
  const workspace = await createTestWorkspace(); t.after(workspace.cleanup);
  const contentRoot = path.join(workspace.root, 'src', 'content');
  const distRoot = path.join(workspace.root, 'dist');
  const backupRoot = path.join(workspace.root, '.local-editor', 'backups');
  await mkdir(distRoot, { recursive: true }); await writeFile(path.join(distRoot, 'index.html'), 'old dist\n'); await mkdir(backupRoot, { recursive: true });
  const bootstrap = await createRepositoryService({ projectRoot: workspace.root, csrfToken: 'csrf' }).bootstrap();
  const input = {
    baseManifestHash: bootstrap.baseManifestHash,
    bundle: { baseManifestHash: bootstrap.baseManifestHash, sessionId: 'a'.repeat(32), content: { site: { ...bootstrap.site, name: 'Candidate' }, about: bootstrap.about, projects: bootstrap.projects, research: bootstrap.research }, images: bootstrap.images.map(({ destination, sha256 }) => ({ kind: 'canonical', destination, sha256 })) },
    uploads: [],
  };
  const firstId = '20260812T120000Z-0001';
  const secondId = '20260812T120000Z-0002';
  const options = {
    projectRoot: workspace.root, contentRoot, distRoot, backupRoot,
    clock: () => new Date('2026-08-12T12:00:00.000Z'), idFactory: () => firstId,
    buildCandidate: async ({ distRoot: target }) => writeFile(path.join(target, 'index.html'), 'candidate dist\n'),
  };
  const crashing = createTransactionService({ ...options, failpoint: (boundary) => {
    if (boundary === 'after-new-content-promotion') throw new Error('simulated crash');
  } });
  await assert.rejects(crashing.save(input), /simulated crash/);
  const firstRoot = path.join(backupRoot, firstId);
  const secondRoot = path.join(backupRoot, secondId);
  await cp(firstRoot, secondRoot, { recursive: true, errorOnExist: true });
  const secondJournalPath = path.join(secondRoot, 'journal.json');
  const secondJournal = JSON.parse(await readFile(secondJournalPath, 'utf8'));
  secondJournal.operationId = secondId;
  await writeFile(secondJournalPath, `${JSON.stringify(secondJournal)}\n`);
  const before = await treeHash(workspace.root);

  const restarted = createTransactionService(options);
  assert.deepEqual(await restarted.recoverBeforeListen(), { ok: false, recoveryOnly: true, messageZh: '检测到无法自动恢复的编辑记录，请保留现场并人工检查。' });
  assert.equal(await treeHash(workspace.root), before);
  assert.equal(JSON.parse(await readFile(path.join(firstRoot, 'journal.json'), 'utf8')).phase, 'before-new-content-promotion');
  assert.equal(JSON.parse(await readFile(secondJournalPath, 'utf8')).phase, 'before-new-content-promotion');
});

const promotionBoundaries = [
  'before-old-content-rename', 'after-old-content-rename',
  'before-new-content-promotion', 'after-new-content-promotion',
  'before-old-dist-rename', 'after-old-dist-rename',
  'before-new-dist-promotion', 'after-new-dist-promotion',
];

for (const [index, boundary] of promotionBoundaries.entries()) {
  test(`recovery is complete old state around ${boundary}`, async (t) => {
    const { createTransactionService } = await import('../server/transaction-service.mjs');
    const { createRepositoryService } = await import('../server/repository-service.mjs');
    const workspace = await createTestWorkspace(); t.after(workspace.cleanup);
    const contentRoot = path.join(workspace.root, 'src', 'content');
    const distRoot = path.join(workspace.root, 'dist');
    const backupRoot = path.join(workspace.root, '.local-editor', 'backups');
    await mkdir(distRoot, { recursive: true }); await writeFile(path.join(distRoot, 'index.html'), 'old dist\n'); await mkdir(backupRoot, { recursive: true });
    const old = { content: await treeHash(contentRoot), dist: await treeHash(distRoot) };
    const bootstrap = await createRepositoryService({ projectRoot: workspace.root, csrfToken: 'csrf' }).bootstrap();
    const input = {
      baseManifestHash: bootstrap.baseManifestHash,
      bundle: { baseManifestHash: bootstrap.baseManifestHash, sessionId: 'a'.repeat(32), content: { site: { ...bootstrap.site, name: `Candidate ${index}` }, about: bootstrap.about, projects: bootstrap.projects, research: bootstrap.research }, images: bootstrap.images.map(({ destination, sha256 }) => ({ kind: 'canonical', destination, sha256 })) },
      uploads: [],
    };
    const operationId = `20260812T1200${String(index).padStart(2, '0')}Z-0001`;
    const options = {
      projectRoot: workspace.root, contentRoot, distRoot, backupRoot,
      clock: () => new Date(`2026-08-12T12:00:${String(index).padStart(2, '0')}.000Z`), idFactory: () => operationId,
      buildCandidate: async ({ distRoot: target }) => writeFile(path.join(target, 'index.html'), `candidate ${index}\n`),
    };
    const crashing = createTransactionService({ ...options, failpoint: (name) => {
      if (name === boundary) throw new Error(`crash:${boundary}`);
    } });
    await assert.rejects(crashing.save(input), new RegExp(`crash:${boundary}`));
    const restarted = createTransactionService(options);
    assert.deepEqual(await restarted.recoverIncompleteTransactions(), [{ operationId, status: 'recovered-old' }]);
    assert.deepEqual({ content: await treeHash(contentRoot), dist: await treeHash(distRoot) }, old);
    assert.deepEqual(await restarted.recoverBeforeListen(), { ok: true, recoveryOnly: false, results: [] });
  });
}

const journalBoundaries = [
  'before-journal-temp-flush', 'after-journal-temp-flush',
  'before-journal-rename', 'after-journal-rename', 'after-operation-directory-flush',
];

for (const [index, boundary] of journalBoundaries.entries()) {
  test(`recovery is complete old state around ${boundary}`, async (t) => {
    const { createTransactionService } = await import('../server/transaction-service.mjs');
    const { createRepositoryService } = await import('../server/repository-service.mjs');
    const workspace = await createTestWorkspace(); t.after(workspace.cleanup);
    const contentRoot = path.join(workspace.root, 'src', 'content');
    const distRoot = path.join(workspace.root, 'dist');
    const backupRoot = path.join(workspace.root, '.local-editor', 'backups');
    await mkdir(distRoot, { recursive: true }); await writeFile(path.join(distRoot, 'index.html'), 'old dist\n'); await mkdir(backupRoot, { recursive: true });
    const old = { content: await treeHash(contentRoot), dist: await treeHash(distRoot) };
    const bootstrap = await createRepositoryService({ projectRoot: workspace.root, csrfToken: 'csrf' }).bootstrap();
    const operationId = `20260812T1201${String(index).padStart(2, '0')}Z-0001`;
    const input = { baseManifestHash: bootstrap.baseManifestHash, bundle: { baseManifestHash: bootstrap.baseManifestHash, sessionId: 'a'.repeat(32), content: { site: { ...bootstrap.site, name: `Journal ${index}` }, about: bootstrap.about, projects: bootstrap.projects, research: bootstrap.research }, images: bootstrap.images.map(({ destination, sha256 }) => ({ kind: 'canonical', destination, sha256 })) }, uploads: [] };
    const options = { projectRoot: workspace.root, contentRoot, distRoot, backupRoot, clock: () => new Date(`2026-08-12T12:01:${String(index).padStart(2, '0')}.000Z`), idFactory: () => operationId, buildCandidate: async ({ distRoot: target }) => writeFile(path.join(target, 'index.html'), `candidate ${index}\n`) };
    let fired = false;
    const crashing = createTransactionService({ ...options, failpoint: (name, context) => {
      if (!fired && name === boundary && context?.phase === 'before-old-content-rename') { fired = true; throw new Error(`crash:${boundary}`); }
    } });
    await assert.rejects(crashing.save(input), new RegExp(`crash:${boundary}`));
    assert.equal(fired, true);
    const restarted = createTransactionService(options);
    assert.deepEqual(await restarted.recoverIncompleteTransactions(), [{ operationId, status: 'recovered-old' }]);
    assert.deepEqual({ content: await treeHash(contentRoot), dist: await treeHash(distRoot) }, old);
  });
}

test('an interrupted archive journal becomes a safe terminal record without changing canonical trees', async (t) => {
  const { createTransactionService } = await import('../server/transaction-service.mjs');
  const { createRepositoryService } = await import('../server/repository-service.mjs');
  const workspace = await createTestWorkspace(); t.after(workspace.cleanup);
  const contentRoot = path.join(workspace.root, 'src', 'content');
  const distRoot = path.join(workspace.root, 'dist');
  const backupRoot = path.join(workspace.root, '.local-editor', 'backups');
  await mkdir(distRoot, { recursive: true }); await writeFile(path.join(distRoot, 'index.html'), 'old dist\n'); await mkdir(backupRoot, { recursive: true });
  const old = { content: await treeHash(contentRoot), dist: await treeHash(distRoot) };
  const bootstrap = await createRepositoryService({ projectRoot: workspace.root, csrfToken: 'csrf' }).bootstrap();
  const input = { baseManifestHash: bootstrap.baseManifestHash, bundle: { baseManifestHash: bootstrap.baseManifestHash, sessionId: 'a'.repeat(32), content: { site: { ...bootstrap.site, name: 'Archived draft' }, about: bootstrap.about, projects: bootstrap.projects, research: bootstrap.research }, images: bootstrap.images.map(({ destination, sha256 }) => ({ kind: 'canonical', destination, sha256 })) }, uploads: [] };
  const operationId = '20260812T121000Z-0001';
  const options = { projectRoot: workspace.root, contentRoot, distRoot, backupRoot, clock: () => new Date('2026-08-12T12:10:00.000Z'), idFactory: () => operationId, buildCandidate: async () => assert.fail('archive recovery must not build') };
  const crashing = createTransactionService({ ...options, failpoint: (name, context) => {
    if (name === 'after-journal-rename' && context?.phase === 'preparing-candidate') throw new Error('crash:archive-preparing');
  } });
  await assert.rejects(crashing.archiveDraft(input), /crash:archive-preparing/);
  const restarted = createTransactionService(options);
  assert.deepEqual(await restarted.recoverIncompleteTransactions(), [{ operationId, status: 'candidate-failed' }]);
  assert.deepEqual({ content: await treeHash(contentRoot), dist: await treeHash(distRoot) }, old);
  const journal = JSON.parse(await readFile(path.join(backupRoot, operationId, 'journal.json'), 'utf8'));
  assert.equal(journal.phase, 'candidate-failed');
  assert.deepEqual(await restarted.recoverBeforeListen(), { ok: true, recoveryOnly: false, results: [] });
});

for (const [index, boundary] of [...promotionBoundaries, ...journalBoundaries].entries()) {
  test(`restore recovery is complete old state around ${boundary}`, async (t) => {
    const { createTransactionService } = await import('../server/transaction-service.mjs');
    const { createRepositoryService } = await import('../server/repository-service.mjs');
    const workspace = await createTestWorkspace(); t.after(workspace.cleanup);
    const contentRoot = path.join(workspace.root, 'src', 'content');
    const distRoot = path.join(workspace.root, 'dist');
    const backupRoot = path.join(workspace.root, '.local-editor', 'backups');
    await mkdir(distRoot, { recursive: true }); await writeFile(path.join(distRoot, 'index.html'), 'old dist\n'); await mkdir(backupRoot, { recursive: true });
    const old = { content: await treeHash(contentRoot), dist: await treeHash(distRoot) };
    const bootstrap = await createRepositoryService({ projectRoot: workspace.root, csrfToken: 'csrf' }).bootstrap();
    const input = { baseManifestHash: bootstrap.baseManifestHash, bundle: { baseManifestHash: bootstrap.baseManifestHash, sessionId: 'a'.repeat(32), content: { site: { ...bootstrap.site, name: `Restore source ${index}` }, about: bootstrap.about, projects: bootstrap.projects, research: bootstrap.research }, images: bootstrap.images.map(({ destination, sha256 }) => ({ kind: 'canonical', destination, sha256 })) }, uploads: [] };
    const archiveId = `20260812T1211${String(index).padStart(2, '0')}Z-0001`;
    const restoreId = `20260812T1212${String(index).padStart(2, '0')}Z-0001`;
    const archive = createTransactionService({ projectRoot: workspace.root, contentRoot, distRoot, backupRoot, clock: () => new Date(`2026-08-12T12:11:${String(index).padStart(2, '0')}.000Z`), idFactory: () => archiveId, buildCandidate: async () => assert.fail('archive must not build') });
    await archive.archiveDraft(input);
    let fired = false;
    const options = { projectRoot: workspace.root, contentRoot, distRoot, backupRoot, clock: () => new Date(`2026-08-12T12:12:${String(index).padStart(2, '0')}.000Z`), idFactory: () => restoreId, buildCandidate: async ({ distRoot: target }) => writeFile(path.join(target, 'index.html'), `restored ${index}\n`) };
    const crashing = createTransactionService({ ...options, failpoint: (name, context) => {
      const journalBoundary = journalBoundaries.includes(boundary);
      if (!fired && name === boundary && (!journalBoundary || context?.phase === 'before-old-content-rename')) { fired = true; throw new Error(`crash:restore:${boundary}`); }
    } });
    const viewed = await crashing.diffBackup(archiveId, { sessionId: 'a'.repeat(32) });
    await assert.rejects(crashing.restore({ id: archiveId, sessionId: 'a'.repeat(32), confirmationToken: viewed.confirmation.token }), new RegExp(`crash:restore:${boundary}`));
    assert.equal(fired, true);
    const restarted = createTransactionService(options);
    assert.deepEqual(await restarted.recoverIncompleteTransactions(), [{ operationId: restoreId, status: 'recovered-old' }]);
    assert.deepEqual({ content: await treeHash(contentRoot), dist: await treeHash(distRoot) }, old);
    assert.deepEqual(await restarted.recoverBeforeListen(), { ok: true, recoveryOnly: false, results: [] });
  });
}
