import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import test from 'node:test';
import { createTestWorkspace } from '../../test/helpers.mjs';
import { createDraftStore, toCandidateBundle } from '../client/draft-store.mjs';
import { startEditor } from '../server/app.mjs';
import { createRepositoryService } from '../server/repository-service.mjs';
import { createTransactionService } from '../server/transaction-service.mjs';

const privateLeak = (...segments) => ['FORBIDDEN-C:', ...segments].join('\\');

async function treeHash(root) {
  const hash = createHash('sha256');
  async function visit(directory) {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name))) {
      const target = path.join(directory, entry.name);
      hash.update(path.relative(root, target));
      if (entry.isDirectory()) await visit(target);
      else hash.update(await readFile(target));
    }
  }
  await visit(root);
  return hash.digest('hex');
}

async function request(origin, target, { method = 'GET', headers = {}, body } = {}) {
  const url = new URL(target, origin);
  return new Promise((resolve, reject) => {
    const outgoing = http.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers,
      setHost: Object.keys(headers).some((name) => name.toLowerCase() === 'host'),
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({
        status: response.statusCode,
        headers: response.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    outgoing.on('error', reject);
    if (body !== undefined) outgoing.end(body);
    else outgoing.end();
  });
}

async function rawHeaderRequest(origin, target, { method = 'POST', headers, body }) {
  const url = new URL(target, origin);
  return new Promise((resolve, reject) => {
    const outgoing = http.request({ hostname: url.hostname, port: url.port, path: target, method, headers }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    outgoing.on('error', reject);
    outgoing.end(body);
  });
}

async function fixture(t, overrides = {}) {
  const workspace = await createTestWorkspace();
  const calls = [];
  const transactionService = {
    recoverBeforeListen: async () => ({ ok: true, recoveryOnly: false, results: [] }),
    runMutation: async (action) => action(),
    save: async (input) => {
      calls.push(input);
      return { ok: true, operationId: '20260814T120000Z-0001', manifestHash: 'b'.repeat(64) };
    },
    archiveDraft: async (input) => {
      calls.push({ action: 'archive', input });
      return { id: '20260814T120000Z-0002', kind: 'archive', phase: 'complete', createdAt: '2026-08-14T12:00:00.000Z' };
    },
    listBackups: async () => [{ id: '20260814T120000Z-0002', kind: 'archive', phase: 'complete', createdAt: '2026-08-14T12:00:00.000Z', localPath: 'FORBIDDEN-SENTINEL' }],
    diffBackup: async (id, context) => {
      calls.push({ action: 'diff', id, context });
      return { id, diff: { added: ['pages/new.md'], removed: [], changed: ['site.yml'] }, diffHash: 'c'.repeat(64), draftHash: 'd'.repeat(64), canonicalManifestHash: 'e'.repeat(64), confirmation: { token: 'f'.repeat(64), expiresAt: '2026-08-14T12:05:00.000Z' } };
    },
    restore: async (input) => {
      calls.push({ action: 'restore', input });
      return { ok: true, operationId: '20260814T120000Z-0003', manifestHash: 'c'.repeat(64) };
    },
    issueConfirmation: ({ sessionId }) => ({ token: '9'.repeat(64), expiresAt: '2026-08-14T12:05:00.000Z', sessionId: `${sessionId}-FORBIDDEN` }),
    ...overrides,
  };
  const editor = await startEditor({
    projectRoot: workspace.root,
    token: 'startup-A',
    csrfToken: 'csrf-A',
    repositoryService: { bootstrap: async () => ({ baseManifestHash: 'a'.repeat(64), csrfToken: 'csrf-A' }) },
    transactionService,
  });
  t.after(async () => { await editor.close(); await workspace.cleanup(); });
  const authority = new URL(editor.origin).host;
  const bootstrap = await request(editor.origin, '/?session=startup-A', { headers: { Host: authority } });
  return { workspace, editor, authority, cookie: bootstrap.headers['set-cookie'][0].split(';')[0], calls };
}

function candidate() {
  return {
    baseManifestHash: 'a'.repeat(64),
    sessionId: '1'.repeat(32),
    content: { site: {}, about: {}, research: [], projects: [] },
    images: [],
  };
}

test('authenticated save route promotes the Task 8 candidate through the transaction service', async (t) => {
  const value = await fixture(t);
  const body = JSON.stringify(candidate());
  const response = await request(value.editor.origin, '/api/save', {
    method: 'POST',
    body,
    headers: {
      Host: value.authority,
      Origin: value.editor.origin,
      Cookie: value.cookie,
      'X-Editor-CSRF': 'csrf-A',
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(response.body), { ok: true, operationId: '20260814T120000Z-0001', manifestHash: 'b'.repeat(64) });
  assert.equal(value.calls.length, 1);
  assert.equal(value.calls[0].baseManifestHash, candidate().baseManifestHash);
  assert.deepEqual(value.calls[0].bundle, candidate());
  assert.equal(value.calls[0].sessionId, value.editor.uploadStore.sessionId);
  assert.equal(value.calls[0].uploads, value.editor.uploadStore);
});

test('save without CSRF is rejected before mutation and preserves the sentinel workspace', async (t) => {
  const value = await fixture(t);
  const before = await treeHash(value.workspace.root);
  const body = JSON.stringify(candidate());
  const response = await request(value.editor.origin, '/api/save', {
    method: 'POST',
    body,
    headers: {
      Host: value.authority,
      Origin: value.editor.origin,
      Cookie: value.cookie,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    },
  });
  assert.equal(response.status, 403);
  assert.equal(value.calls.length, 0);
  assert.equal(await treeHash(value.workspace.root), before);
});

function stateHeaders(value, body) {
  return {
    Host: value.authority,
    Origin: value.editor.origin,
    Cookie: value.cookie,
    'X-Editor-CSRF': 'csrf-A',
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  };
}

test('the closed write route table exposes archive, backup diff, and confirmed restore only', async (t) => {
  const value = await fixture(t);
  const candidateBody = JSON.stringify(candidate());
  const archive = await request(value.editor.origin, '/api/drafts/archive', { method: 'POST', body: candidateBody, headers: stateHeaders(value, candidateBody) });
  assert.equal(archive.status, 200);
  assert.deepEqual(JSON.parse(archive.body), { ok: true, backup: { id: '20260814T120000Z-0002', kind: 'archive', status: 'complete', createdAt: '2026-08-14T12:00:00.000Z' } });

  const backups = await request(value.editor.origin, '/api/backups', { headers: { Host: value.authority, Cookie: value.cookie } });
  assert.equal(backups.status, 200);
  assert.deepEqual(JSON.parse(backups.body), { ok: true, backups: [{ id: '20260814T120000Z-0002', kind: 'archive', status: 'complete', createdAt: '2026-08-14T12:00:00.000Z' }] });
  assert.equal(backups.body.includes('FORBIDDEN-SENTINEL'), false);

  const diffBody = '{}';
  const diff = await request(value.editor.origin, '/api/backups/20260814T120000Z-0002/diff', { method: 'POST', body: diffBody, headers: stateHeaders(value, diffBody) });
  assert.equal(diff.status, 200);
  assert.deepEqual(JSON.parse(diff.body), { ok: true, id: '20260814T120000Z-0002', diff: { added: ['pages/new.md'], removed: [], changed: ['site.yml'] }, confirmation: { token: 'f'.repeat(64), expiresAt: '2026-08-14T12:05:00.000Z' } });

  const restoreBody = JSON.stringify({ confirmationToken: 'f'.repeat(64) });
  const restore = await request(value.editor.origin, '/api/backups/20260814T120000Z-0002/restore', { method: 'POST', body: restoreBody, headers: stateHeaders(value, restoreBody) });
  assert.equal(restore.status, 200);
  assert.deepEqual(JSON.parse(restore.body), { ok: true, operationId: '20260814T120000Z-0003', manifestHash: 'c'.repeat(64) });

  assert.equal((await request(value.editor.origin, '/api/backups/20260814T120000Z-0002', { headers: { Host: value.authority, Cookie: value.cookie } })).status, 404);
  assert.equal((await request(value.editor.origin, '/api/save?path=anything', { method: 'POST', body: candidateBody, headers: stateHeaders(value, candidateBody) })).status, 404);
  assert.equal((await request(value.editor.origin, '/api/backups', { method: 'DELETE', headers: { Host: value.authority, Cookie: value.cookie } })).status, 405);
});

test('each JSON write enforces authentication, exact media type, and its body limit before mutation', async (t) => {
  const value = await fixture(t);
  const before = await treeHash(value.workspace.root);
  const body = JSON.stringify(candidate());
  const cases = [
    { name: 'wrong cookie', headers: { ...stateHeaders(value, body), Cookie: 'editor_session=wrong' }, expected: 401 },
    { name: 'wrong origin', headers: { ...stateHeaders(value, body), Origin: 'http://evil.invalid' }, expected: 403 },
    { name: 'wrong CSRF', headers: { ...stateHeaders(value, body), 'X-Editor-CSRF': 'wrong' }, expected: 403 },
    { name: 'wrong media type', headers: { ...stateHeaders(value, body), 'Content-Type': 'text/plain' }, expected: 415 },
    { name: 'oversized declared body', headers: { ...stateHeaders(value, body), 'Content-Length': String(2 * 1024 * 1024 + 1) }, expected: 413, requestBody: undefined },
  ];
  for (const valueCase of cases) {
    const response = await request(value.editor.origin, '/api/save', { method: 'POST', body: valueCase.requestBody ?? body, headers: valueCase.headers });
    assert.equal(response.status, valueCase.expected, valueCase.name);
    assert.equal(await treeHash(value.workspace.root), before, valueCase.name);
  }
  assert.equal(value.calls.length, 0);
});

test('conflicts return only a sanitised diff and a server-issued one-time confirmation', async (t) => {
  const forbidden = privateLeak('private', 'source.md-secret-token');
  const conflict = Object.assign(new Error(forbidden), {
    code: 'CONFLICT',
    field: forbidden,
    details: [{ field: forbidden, messageZh: forbidden }],
    stack: forbidden,
    diff: { added: ['pages/new.md'], removed: [], changed: ['site.yml'] },
    confirmationContext: { targetId: '20260814T120000Z-0009', diffHash: '1'.repeat(64), draftHash: '2'.repeat(64), canonicalManifestHash: '3'.repeat(64), forbidden },
  });
  const value = await fixture(t, { save: async () => { throw conflict; } });
  const body = JSON.stringify(candidate());
  const response = await request(value.editor.origin, '/api/save', { method: 'POST', body, headers: stateHeaders(value, body) });
  assert.equal(response.status, 409);
  assert.deepEqual(JSON.parse(response.body), {
    ok: false,
    code: 'CONTENT_CONFLICT',
    messageZh: '磁盘内容已在编辑器外修改，未覆盖任何文件。',
    field: null,
    details: [],
    diff: { added: ['pages/new.md'], removed: [], changed: ['site.yml'] },
    confirmation: { token: '9'.repeat(64), expiresAt: '2026-08-14T12:05:00.000Z' },
  });
  assert.equal(response.body.includes(forbidden), false);
});

async function realFixture(t, { failBuild = false, editCanonicalDuringBuild = false, clock } = {}) {
  const workspace = await createTestWorkspace();
  const contentRoot = path.join(workspace.root, 'src', 'content');
  const distRoot = path.join(workspace.root, 'dist');
  const backupRoot = path.join(workspace.root, '.local-editor', 'backups');
  await mkdir(distRoot, { recursive: true });
  await mkdir(backupRoot, { recursive: true });
  await writeFile(path.join(distRoot, 'index.html'), await readFile(path.join(contentRoot, 'site.yml')));
  const repositoryService = createRepositoryService({ projectRoot: workspace.root, csrfToken: 'csrf-A' });
  const transactionService = createTransactionService({
    projectRoot: workspace.root,
    contentRoot,
    distRoot,
    backupRoot,
    buildCandidate: async ({ contentRoot: candidateContentRoot, distRoot: candidateDistRoot }) => {
      if (failBuild) throw new Error(privateLeak('private', 'build-environment'));
      await writeFile(path.join(candidateDistRoot, 'index.html'), await readFile(path.join(candidateContentRoot, 'site.yml')));
      if (editCanonicalDuringBuild) {
        const canonicalSite = path.join(contentRoot, 'site.yml');
        await writeFile(canonicalSite, `${await readFile(canonicalSite, 'utf8')}\n# external edit during build\n`);
      }
    },
    ...(clock ? { clock } : {}),
  });
  const editor = await startEditor({ projectRoot: workspace.root, token: 'startup-A', csrfToken: 'csrf-A', repositoryService, transactionService });
  const editors = [editor];
  t.after(async () => { for (const owned of editors.reverse()) await owned.close(); await workspace.cleanup(); });
  const authority = new URL(editor.origin).host;
  const navigation = await request(editor.origin, '/?session=startup-A', { headers: { Host: authority } });
  const cookie = navigation.headers['set-cookie'][0].split(';')[0];
  const bootstrapResponse = await request(editor.origin, '/api/bootstrap', { headers: { Host: authority, Cookie: cookie } });
  const bootstrap = JSON.parse(bootstrapResponse.body);
  const store = createDraftStore(bootstrap);
  const bundle = toCandidateBundle(store.getState(), {
    sessionId: bootstrap.uploadSessionId,
    uploads: [],
    resolveCanonical: () => true,
    resolveUpload: () => undefined,
  });
  return {
    workspace, contentRoot, distRoot, backupRoot, editor, authority, cookie, bootstrap, bundle, repositoryService, transactionService,
    async addSession(startupToken, ownedTransactionService = transactionService) {
      const owned = await startEditor({ projectRoot: workspace.root, token: startupToken, csrfToken: 'csrf-A', repositoryService, transactionService: ownedTransactionService });
      editors.push(owned);
      const ownedAuthority = new URL(owned.origin).host;
      const navigation = await request(owned.origin, `/?session=${startupToken}`, { headers: { Host: ownedAuthority } });
      return { editor: owned, authority: ownedAuthority, cookie: navigation.headers['set-cookie'][0].split(';')[0] };
    },
  };
}

async function canonicalAndDist(fixture) {
  return { content: await treeHash(fixture.contentRoot), dist: await treeHash(fixture.distRoot) };
}

test('invalid project type, unsafe colour, and unsupported block type return 422 without writes', async (t) => {
  const value = await realFixture(t);
  const before = await canonicalAndDist(value);
  const invalidCandidates = [
    ['invalid project type', (bundle) => { bundle.content.projects[0].document.frontmatter.kind = 'external'; }],
    ['unsafe colour', (bundle) => { bundle.content.site.theme.accent = 'url(javascript:1)'; }],
    ['unsupported Markdown block', (bundle) => { bundle.content.about.sections[0].blocks[0].type = 'unsupported'; }],
  ];
  for (const [name, mutate] of invalidCandidates) {
    const bundle = structuredClone(value.bundle);
    mutate(bundle);
    const body = JSON.stringify(bundle);
    const response = await request(value.editor.origin, '/api/save', { method: 'POST', body, headers: stateHeaders(value, body) });
    assert.equal(response.status, 422, name);
    assert.deepEqual(JSON.parse(response.body), { ok: false, code: 'BAD_INPUT', messageZh: '请求无效。', field: null, details: [] }, name);
    assert.deepEqual(await canonicalAndDist(value), before, name);
  }
});

test('candidate build failure is Chinese, leak-free, and byte-preserving', async (t) => {
  const value = await realFixture(t, { failBuild: true });
  const before = await canonicalAndDist(value);
  const bundle = structuredClone(value.bundle);
  bundle.content.site.name = 'Build failure sentinel draft';
  const body = JSON.stringify(bundle);
  const response = await request(value.editor.origin, '/api/save', { method: 'POST', body, headers: stateHeaders(value, body) });
  assert.equal(response.status, 422);
  assert.deepEqual(JSON.parse(response.body), { ok: false, code: 'CANDIDATE_BUILD_FAILED', messageZh: '网站生成失败，请修正内容后重试。', field: null, details: [] });
  assert.equal(response.body.includes('FORBIDDEN'), false);
  assert.equal(response.body.includes(privateLeak('private')), false);
  assert.deepEqual(await canonicalAndDist(value), before);
});

test('successful save refreshes the manifest and its backup can be diffed and restored', async (t) => {
  const value = await realFixture(t);
  const before = await canonicalAndDist(value);
  const bundle = structuredClone(value.bundle);
  bundle.content.site.name = 'Saved through authenticated API';
  const body = JSON.stringify(bundle);
  const savedResponse = await request(value.editor.origin, '/api/save', { method: 'POST', body, headers: stateHeaders(value, body) });
  assert.equal(savedResponse.status, 200);
  const saved = JSON.parse(savedResponse.body);
  assert.equal(saved.ok, true);
  assert.match(saved.manifestHash, /^[a-f0-9]{64}$/);
  assert.notDeepEqual(await canonicalAndDist(value), before);
  const refreshed = JSON.parse((await request(value.editor.origin, '/api/bootstrap', { headers: { Host: value.authority, Cookie: value.cookie } })).body);
  assert.equal(refreshed.baseManifestHash, saved.manifestHash);
  assert.equal(refreshed.site.name, 'Saved through authenticated API');

  const backups = JSON.parse((await request(value.editor.origin, '/api/backups', { headers: { Host: value.authority, Cookie: value.cookie } })).body);
  const source = backups.backups.find((backup) => backup.id === saved.operationId);
  assert.ok(source);
  const diffBody = '{}';
  const diffResponse = await request(value.editor.origin, `/api/backups/${source.id}/diff`, { method: 'POST', body: diffBody, headers: stateHeaders(value, diffBody) });
  assert.equal(diffResponse.status, 200, diffResponse.body);
  const diff = JSON.parse(diffResponse.body);
  assert.ok(diff.diff.changed.includes('site.yml'));
  const restoreBody = JSON.stringify({ confirmationToken: diff.confirmation.token });
  const restoreResponse = await request(value.editor.origin, `/api/backups/${source.id}/restore`, { method: 'POST', body: restoreBody, headers: stateHeaders(value, restoreBody) });
  assert.equal(restoreResponse.status, 200, restoreResponse.body);
  assert.deepEqual(await canonicalAndDist(value), before);
});

test('a stale current draft archives without confirmation or canonical promotion', async (t) => {
  const value = await realFixture(t);
  const sitePath = path.join(value.contentRoot, 'site.yml');
  const external = (await readFile(sitePath, 'utf8')).replace(value.bootstrap.site.name, 'External disk edit');
  await writeFile(sitePath, external);
  const before = await canonicalAndDist(value);
  const bundle = structuredClone(value.bundle);
  bundle.content.site.name = 'Current unsaved browser draft';
  const saveBody = JSON.stringify(bundle);
  const conflictResponse = await request(value.editor.origin, '/api/save', { method: 'POST', body: saveBody, headers: stateHeaders(value, saveBody) });
  assert.equal(conflictResponse.status, 409);
  const archiveBody = JSON.stringify(bundle);
  const archiveResponse = await request(value.editor.origin, '/api/drafts/archive', { method: 'POST', body: archiveBody, headers: stateHeaders(value, archiveBody) });
  assert.equal(archiveResponse.status, 200, archiveResponse.body);
  assert.equal(JSON.parse(archiveResponse.body).backup.kind, 'archive');
  assert.deepEqual(await canonicalAndDist(value), before);
});

test('an external edit during candidate build still returns a confirmable 409 conflict', async (t) => {
  const value = await realFixture(t, { editCanonicalDuringBuild: true });
  const bundle = structuredClone(value.bundle);
  bundle.content.site.name = 'Draft racing an external edit';
  const body = JSON.stringify(bundle);
  const response = await request(value.editor.origin, '/api/save', { method: 'POST', body, headers: stateHeaders(value, body) });
  assert.equal(response.status, 409, response.body);
  const conflict = JSON.parse(response.body);
  assert.equal(conflict.code, 'CONTENT_CONFLICT');
  assert.match(conflict.confirmation.token, /^[a-f0-9]{64}$/);
  assert.ok(conflict.diff.changed.includes('site.yml'));
});

test('a stale canonical image returns a safe confirmable 409 without changing canonical or dist bytes', async (t) => {
  const value = await realFixture(t);
  const descriptor = value.bundle.images.find((image) => image.kind === 'canonical');
  assert.ok(descriptor, 'sentinel workspace must expose a canonical image');
  const imagePath = path.join(value.contentRoot, ...descriptor.destination.split('/'));
  await writeFile(imagePath, Buffer.concat([await readFile(imagePath), Buffer.from('external-image-edit')]));
  const before = await canonicalAndDist(value);
  const body = JSON.stringify(value.bundle);

  const response = await request(value.editor.origin, '/api/save', { method: 'POST', body, headers: stateHeaders(value, body) });

  assert.equal(response.status, 409, response.body);
  const conflict = JSON.parse(response.body);
  assert.equal(conflict.code, 'CONTENT_CONFLICT');
  assert.deepEqual(conflict.details, []);
  assert.match(conflict.confirmation.token, /^[a-f0-9]{64}$/);
  assert.ok(conflict.diff.changed.includes(descriptor.destination));
  assert.equal(response.body.includes(value.workspace.root), false);
  assert.deepEqual(await canonicalAndDist(value), before);
});

test('an unknown conflict token is rejected even while the submitted base still matches', async (t) => {
  const value = await realFixture(t);
  const before = await canonicalAndDist(value);
  const body = JSON.stringify({ ...value.bundle, conflictResolutionToken: 'f'.repeat(64) });

  const response = await request(value.editor.origin, '/api/save', { method: 'POST', body, headers: stateHeaders(value, body) });

  assert.equal(response.status, 403, response.body);
  assert.deepEqual(JSON.parse(response.body), { ok: false, code: 'FORBIDDEN', messageZh: '请求来源或确认记录无效。', field: null, details: [] });
  assert.deepEqual(await canonicalAndDist(value), before);
});

test('every Task 11 write route applies the complete state-request and body-limit matrix before mutation', async (t) => {
  const value = await realFixture(t);
  const candidateBody = JSON.stringify(value.bundle);
  const routes = [
    ['save', '/api/save', candidateBody, 2 * 1024 * 1024],
    ['archive', '/api/drafts/archive', candidateBody, 2 * 1024 * 1024],
    ['diff', '/api/backups/20260814T120000Z-0001/diff', '{}', 1024],
    ['restore', '/api/backups/20260814T120000Z-0001/restore', JSON.stringify({ confirmationToken: 'a'.repeat(64) }), 1024],
  ];
  for (const [routeName, target, body, limit] of routes) {
    const before = await canonicalAndDist(value);
    const valid = stateHeaders(value, body);
    const cases = [
      ['hostile Host', { ...valid, Host: 'evil.invalid' }, 403],
      ['missing Origin', Object.fromEntries(Object.entries(valid).filter(([name]) => name !== 'Origin')), 403],
      ['wrong Origin', { ...valid, Origin: `${value.editor.origin}.evil` }, 403],
      ['missing cookie', Object.fromEntries(Object.entries(valid).filter(([name]) => name !== 'Cookie')), 401],
      ['wrong cookie', { ...valid, Cookie: 'editor_session=wrong' }, 401],
      ['missing CSRF', Object.fromEntries(Object.entries(valid).filter(([name]) => name !== 'X-Editor-CSRF')), 403],
      ['wrong CSRF', { ...valid, 'X-Editor-CSRF': 'wrong' }, 403],
      ['wrong media type', { ...valid, 'Content-Type': 'text/plain' }, 415],
      ['oversized declared body', { ...valid, 'Content-Length': String(limit + 1) }, 413, undefined],
    ];
    for (const [caseName, headers, expected, requestBody = body] of cases) {
      const response = await request(value.editor.origin, target, { method: 'POST', headers, body: requestBody });
      assert.equal(response.status, expected, `${routeName}: ${caseName}: ${response.body}`);
      assert.deepEqual(await canonicalAndDist(value), before, `${routeName}: ${caseName}`);
    }
    const rawHeaders = Object.entries(valid).flatMap(([name, headerValue]) => [name, String(headerValue)]);
    rawHeaders.push('Origin', value.editor.origin);
    const duplicateOrigin = await rawHeaderRequest(value.editor.origin, target, { headers: rawHeaders, body });
    assert.equal(duplicateOrigin.status, 403, `${routeName}: duplicate Origin: ${duplicateOrigin.body}`);
    assert.deepEqual(await canonicalAndDist(value), before, `${routeName}: duplicate Origin`);
  }
});

test('restore confirmations reject wrong-target, cross-session, expired, stale-diff, and replayed use byte-exactly', async (t) => {
  let now = new Date('2026-08-14T12:00:00.000Z');
  const value = await realFixture(t, { clock: () => new Date(now) });
  const post = async (session, target, payload) => {
    const body = JSON.stringify(payload);
    return request(session.editor.origin, target, { method: 'POST', body, headers: stateHeaders(session, body) });
  };
  const archiveA = JSON.parse((await post(value, '/api/drafts/archive', value.bundle)).body).backup;
  const archiveB = JSON.parse((await post(value, '/api/drafts/archive', value.bundle)).body).backup;
  const issue = async (id, session = value) => JSON.parse((await post(session, `/api/backups/${id}/diff`, {})).body).confirmation.token;
  const assertRejectedWithoutWrites = async (name, session, target, token, expected) => {
    const before = await canonicalAndDist(value);
    const response = await post(session, target, { confirmationToken: token });
    assert.equal(response.status, expected, `${name}: ${response.body}`);
    assert.deepEqual(await canonicalAndDist(value), before, name);
    return response;
  };

  await assertRejectedWithoutWrites('wrong target', value, `/api/backups/${archiveB.id}/restore`, await issue(archiveA.id), 403);

  const second = await value.addSession('startup-B');
  await assertRejectedWithoutWrites('cross session', second, `/api/backups/${archiveA.id}/restore`, await issue(archiveA.id), 403);

  const expiring = await issue(archiveA.id);
  now = new Date('2026-08-14T12:06:00.000Z');
  await assertRejectedWithoutWrites('expired', value, `/api/backups/${archiveA.id}/restore`, expiring, 403);

  const stale = await issue(archiveA.id);
  const sitePath = path.join(value.contentRoot, 'site.yml');
  await writeFile(sitePath, `${await readFile(sitePath, 'utf8')}\n# stale diff sentinel\n`);
  await assertRejectedWithoutWrites('stale diff', value, `/api/backups/${archiveA.id}/restore`, stale, 409);

  const oneTime = await issue(archiveA.id);
  const restored = await post(value, `/api/backups/${archiveA.id}/restore`, { confirmationToken: oneTime });
  assert.equal(restored.status, 200, restored.body);
  await assertRejectedWithoutWrites('replay', value, `/api/backups/${archiveA.id}/restore`, oneTime, 403);
});

test('conflict confirmations reject wrong-action, cross-session, expired, stale-diff, and replayed use byte-exactly', async (t) => {
  let now = new Date();
  const value = await realFixture(t, { clock: () => new Date(now) });
  const post = async (session, target, payload) => {
    const body = JSON.stringify(payload);
    return request(session.editor.origin, target, { method: 'POST', body, headers: stateHeaders(session, body) });
  };
  const sitePath = path.join(value.contentRoot, 'site.yml');
  await writeFile(sitePath, `${await readFile(sitePath, 'utf8')}\n# external conflict generation one\n`);
  const draft = structuredClone(value.bundle);
  draft.content.site.name = 'Bound conflict draft';
  const issueConflict = async () => {
    const response = await post(value, '/api/save', draft);
    assert.equal(response.status, 409, response.body);
    return JSON.parse(response.body).confirmation.token;
  };
  const reject = async (name, session, token) => {
    const before = await canonicalAndDist(value);
    const response = await post(session, '/api/save', { ...draft, conflictResolutionToken: token });
    assert.ok([403, 409].includes(response.status), `${name}: ${response.body}`);
    assert.deepEqual(await canonicalAndDist(value), before, name);
  };

  const archived = JSON.parse((await post(value, '/api/drafts/archive', draft)).body).backup;
  const restoreToken = JSON.parse((await post(value, `/api/backups/${archived.id}/diff`, {})).body).confirmation.token;
  await reject('wrong action', value, restoreToken);

  const second = await value.addSession('startup-C');
  await reject('cross session', second, await issueConflict());

  const expired = await issueConflict();
  now = new Date(now.valueOf() + 6 * 60 * 1000);
  await reject('expired', value, expired);
  now = new Date();

  const stale = await issueConflict();
  await writeFile(sitePath, `${await readFile(sitePath, 'utf8')}\n# external conflict generation two\n`);
  await reject('stale diff', value, stale);

  const oneTime = await issueConflict();
  const saved = await post(value, '/api/save', { ...draft, conflictResolutionToken: oneTime });
  assert.equal(saved.status, 200, saved.body);
  await reject('replay', value, oneTime);
});

test('save rejects an upload ID bound to another editor session without changing canonical or dist bytes', async (t) => {
  const value = await realFixture(t);
  const second = await value.addSession('startup-D');
  const bytes = Buffer.from('cross-session-upload-sentinel');
  const uploaded = second.editor.uploadStore.add({
    bytes,
    width: 1,
    height: 1,
    mime: 'image/png',
    safeName: 'cross-session-12345678.png',
    sha256: createHash('sha256').update(bytes).digest('hex'),
  });
  const bundle = structuredClone(value.bundle);
  const descriptorIndex = bundle.images.findIndex((image) => image.kind === 'canonical');
  assert.notEqual(descriptorIndex, -1, 'sentinel workspace must expose a canonical image destination');
  bundle.images[descriptorIndex] = {
    kind: 'upload',
    destination: bundle.images[descriptorIndex].destination,
    uploadId: uploaded.uploadId,
    sessionId: second.editor.uploadStore.sessionId,
  };
  const before = await canonicalAndDist(value);
  const body = JSON.stringify(bundle);

  const response = await request(value.editor.origin, '/api/save', { method: 'POST', body, headers: stateHeaders(value, body) });

  assert.equal(response.status, 422, response.body);
  assert.equal(JSON.parse(response.body).code, 'BAD_INPUT');
  assert.deepEqual(await canonicalAndDist(value), before);
});

test('a restarted editor recovers completed transactions before serving the saved bootstrap and writes', async (t) => {
  const value = await realFixture(t);
  const savedBundle = structuredClone(value.bundle);
  savedBundle.content.site.name = 'Recovered after editor restart';
  const saveBody = JSON.stringify(savedBundle);
  const saved = await request(value.editor.origin, '/api/save', { method: 'POST', body: saveBody, headers: stateHeaders(value, saveBody) });
  assert.equal(saved.status, 200, saved.body);
  await value.editor.close();

  const restartedService = createTransactionService({
    projectRoot: value.workspace.root,
    contentRoot: value.contentRoot,
    distRoot: value.distRoot,
    backupRoot: value.backupRoot,
    buildCandidate: async ({ contentRoot: candidateContentRoot, distRoot: candidateDistRoot }) => {
      await writeFile(path.join(candidateDistRoot, 'index.html'), await readFile(path.join(candidateContentRoot, 'site.yml')));
    },
  });
  const restarted = await value.addSession('startup-restart', restartedService);
  const bootstrapResponse = await request(restarted.editor.origin, '/api/bootstrap', { headers: { Host: restarted.authority, Cookie: restarted.cookie } });
  assert.equal(bootstrapResponse.status, 200, bootstrapResponse.body);
  const bootstrap = JSON.parse(bootstrapResponse.body);
  assert.equal(bootstrap.site.name, 'Recovered after editor restart');

  const store = createDraftStore(bootstrap);
  const recoveredBundle = toCandidateBundle(store.getState(), {
    sessionId: bootstrap.uploadSessionId,
    uploads: [],
    resolveCanonical: () => true,
    resolveUpload: () => undefined,
  });
  const archiveBody = JSON.stringify(recoveredBundle);
  const archived = await request(restarted.editor.origin, '/api/drafts/archive', { method: 'POST', body: archiveBody, headers: stateHeaders(restarted, archiveBody) });
  assert.equal(archived.status, 200, archived.body);
  assert.equal(JSON.parse(archived.body).backup.kind, 'archive');
});
