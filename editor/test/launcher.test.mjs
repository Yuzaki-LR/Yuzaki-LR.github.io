import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { EventEmitter, once } from 'node:events';
import { copyFile, cp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { PassThrough } from 'node:stream';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createTestWorkspace } from '../../test/helpers.mjs';
import { createCandidateBuilder } from '../server/build-service.mjs';
import * as mainModule from '../server/main.mjs';
import { createRepositoryService } from '../server/repository-service.mjs';
import { createTransactionService } from '../server/transaction-service.mjs';

const projectRoot = fileURLToPath(new URL('../..', import.meta.url));
const launcherPath = path.join(projectRoot, '启动网站编辑器.bat');
const execFileAsync = promisify(execFile);
const systemDirectory = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32');
const commandInterpreter = path.join(systemDirectory, 'cmd.exe');

function waitForLine(stream, pattern, timeoutMs = 15_000) {
  return new Promise((resolve, reject) => {
    let source = '';
    const timer = setTimeout(() => finish(new Error(`launcher output timeout: ${source}`)), timeoutMs);
    const onData = (chunk) => {
      source += chunk.toString('utf8');
      const match = pattern.exec(source);
      if (match) finish(undefined, match);
    };
    const onError = (error) => finish(error);
    function finish(error, value) {
      clearTimeout(timer);
      stream.off('data', onData);
      stream.off('error', onError);
      if (error) reject(error); else resolve(value);
    }
    stream.on('data', onData);
    stream.once('error', onError);
  });
}

function waitForExit(child, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    if (child.exitCode !== null) return resolve(child.exitCode);
    const timer = setTimeout(() => reject(new Error('launcher did not exit')), timeoutMs);
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('exit', (code) => { clearTimeout(timer); resolve(code); });
  });
}

test('main emits one machine-readable ready URL and owns editor plus build shutdown', async (t) => {
  const workspace = await createTestWorkspace();
  t.after(workspace.cleanup);
  let buildCloses = 0;
  let editorCloses = 0;
  let browserOpens = 0;
  let stdout = '';
  const buildService = Object.assign(async () => {}, { close: async () => { buildCloses += 1; } });
  const result = await mainModule.runEditorMain({
    projectRoot: workspace.root,
    token: 'startup-A',
    csrfToken: 'csrf-A',
    buildService,
    repositoryService: { bootstrap: async () => ({ csrfToken: 'csrf-A' }) },
    transactionService: {
      recoverBeforeListen: async () => ({ ok: true, recoveryOnly: false, results: [] }),
      runMutation: async (action) => action(),
    },
    start: async () => ({ origin: 'http://127.0.0.1:12345', close: async () => { editorCloses += 1; } }),
    env: { EDITOR_NO_OPEN: '1', PATH: path.dirname(process.execPath) },
    openBrowser: async () => { browserOpens += 1; },
    stdout: { write(value) { stdout += value; } },
    stderr: { write() { assert.fail('successful startup must not write stderr'); } },
  });

  assert.equal(stdout, 'EDITOR_READY=http://127.0.0.1:12345/?session=startup-A\n');
  assert.equal(browserOpens, 0);
  assert.equal(typeof result.close, 'function');
  const firstClose = result.close();
  const secondClose = result.close();
  assert.equal(firstClose, secondClose);
  await firstClose;
  assert.equal(buildCloses, 1);
  assert.equal(editorCloses, 1);
});

test('main reports a fixed generic error and closes owned resources when browser opening fails', async (t) => {
  const workspace = await createTestWorkspace();
  t.after(workspace.cleanup);
  let buildCloses = 0;
  let editorCloses = 0;
  let stdout = '';
  let stderr = '';
  const privateText = `${workspace.root} TOKEN=private browser failure`;
  const buildService = Object.assign(async () => {}, { close: async () => { buildCloses += 1; } });
  const result = await mainModule.runEditorMain({
    projectRoot: workspace.root,
    token: 'startup-A',
    csrfToken: 'csrf-A',
    buildService,
    repositoryService: { bootstrap: async () => ({ csrfToken: 'csrf-A' }) },
    transactionService: {
      recoverBeforeListen: async () => ({ ok: true, recoveryOnly: false, results: [] }),
      runMutation: async (action) => action(),
    },
    start: async () => ({ origin: 'http://127.0.0.1:12345', close: async () => { editorCloses += 1; } }),
    env: { PATH: path.dirname(process.execPath) },
    openBrowser: async () => { throw new Error(privateText); },
    stdout: { write(value) { stdout += value; } },
    stderr: { write(value) { stderr += value; } },
  });

  assert.deepEqual(result, { ok: false, exitCode: 1 });
  assert.equal(stdout, '');
  assert.equal(stderr, '网站编辑器启动失败，请保留此窗口中的提示并联系维护者。\n');
  assert.doesNotMatch(stderr, /TOKEN=|browser failure|yunxi-academic-website/i);
  assert.equal(buildCloses, 1);
  assert.equal(editorCloses, 1);
});

test('batch launcher never expands EDITOR_NO_OPEN as command text', async () => {
  const source = await readFile(launcherPath, 'utf8');
  assert.doesNotMatch(source, /%EDITOR_NO_OPEN%/i);
  assert.equal(source.match(/if defined EDITOR_INTERACTIVE pause/gi)?.length, 3);
  assert.match(source, /set EDITOR_NO_OPEN 2>nul\|.*findstr\.exe"? \/x \/c:"EDITOR_NO_OPEN=1" >nul\r?\nif not errorlevel 1 set "EDITOR_INTERACTIVE="/i);
});

test('foreground stdin closure waits for editor and build cleanup', async () => {
  assert.equal(typeof mainModule.runEditorForeground, 'function');
  const processRef = new EventEmitter();
  processRef.stdin = new PassThrough();
  let buildCloses = 0;
  let editorCloses = 0;
  let ready;
  const buildService = Object.assign(async () => {}, { close: async () => { buildCloses += 1; } });
  const foreground = mainModule.runEditorForeground({
    processRef,
    projectRoot,
    token: 'startup-A', csrfToken: 'csrf-A',
    buildService,
    repositoryService: { bootstrap: async () => ({ csrfToken: 'csrf-A' }) },
    transactionService: { recoverBeforeListen: async () => ({ ok: true, recoveryOnly: false, results: [] }), runMutation: async (action) => action() },
    start: async () => ({ origin: 'http://127.0.0.1:12345', close: async () => { editorCloses += 1; } }),
    env: { EDITOR_NO_OPEN: '1', PATH: path.dirname(process.execPath) },
    stdout: { write(value) { ready = value; queueMicrotask(() => processRef.stdin.end()); } },
    stderr: { write() { assert.fail('foreground success must not write stderr'); } },
  });
  assert.equal(await foreground, 0);
  assert.match(ready, /^EDITOR_READY=/);
  assert.equal(buildCloses, 1);
  assert.equal(editorCloses, 1);
  assert.equal(processRef.listenerCount('SIGINT'), 0);
  assert.equal(processRef.listenerCount('SIGTERM'), 0);
});

test('foreground remembers stdin closure that arrives while startup is still pending', async () => {
  const processRef = new EventEmitter();
  processRef.stdin = new PassThrough();
  processRef.stdin.resume();
  let observedSignal;
  let buildCloses = 0;
  const foreground = mainModule.runEditorForeground({
    processRef,
    projectRoot,
    token: 'startup-A', csrfToken: 'csrf-A',
    buildService: Object.assign(async () => {}, { close: async () => { buildCloses += 1; } }),
    repositoryService: { bootstrap: async () => ({ csrfToken: 'csrf-A' }) },
    transactionService: { recoverBeforeListen: async () => ({ ok: true, recoveryOnly: false, results: [] }), runMutation: async (action) => action() },
    start: async ({ signal }) => {
      observedSignal = signal;
      await new Promise((_resolve, reject) => {
        if (signal.aborted) reject(Object.assign(new Error('aborted'), { code: 'STARTUP_ABORTED' }));
        else signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { code: 'STARTUP_ABORTED' })), { once: true });
      });
      assert.fail('aborted startup must not return an editor listener');
    },
    env: { EDITOR_NO_OPEN: '1', PATH: path.dirname(process.execPath) }, stdout: { write() {} }, stderr: { write() {} },
  });
  processRef.stdin.end();
  const outcome = await Promise.race([foreground, new Promise((resolve) => setTimeout(() => resolve('timeout'), 500))]);
  assert.equal(outcome, 0);
  assert.equal(observedSignal?.aborted, true);
  assert.equal(buildCloses, 1);
});

test('foreground aborts pending recovery before a listener exists and closes its build service', async () => {
  const processRef = new EventEmitter();
  processRef.stdin = new PassThrough();
  processRef.stdin.resume();
  let markRecoveryStarted;
  const recoveryStarted = new Promise((resolve) => { markRecoveryStarted = resolve; });
  let releaseRecovery;
  const recoveryGate = new Promise((resolve) => { releaseRecovery = resolve; });
  let buildCloses = 0;
  let stdout = '';
  let stderr = '';
  const foreground = mainModule.runEditorForeground({
    processRef,
    projectRoot,
    token: 'startup-A', csrfToken: 'csrf-A',
    buildService: Object.assign(async () => {}, { close: async () => { buildCloses += 1; } }),
    repositoryService: { bootstrap: async () => ({ csrfToken: 'csrf-A' }) },
    transactionService: {
      recoverBeforeListen: async () => { markRecoveryStarted(); return recoveryGate; },
      runMutation: async (action) => action(),
    },
    env: { EDITOR_NO_OPEN: '1', PATH: path.dirname(process.execPath) },
    stdout: { write(value) { stdout += value; } },
    stderr: { write(value) { stderr += value; } },
  });
  await recoveryStarted;
  processRef.stdin.end();
  const outcome = await Promise.race([
    foreground,
    new Promise((resolve) => setTimeout(() => resolve('timeout'), 500)),
  ]);
  if (outcome === 'timeout') {
    releaseRecovery({ ok: true, recoveryOnly: false, results: [] });
    await foreground;
  }
  assert.equal(outcome, 0);
  assert.equal(buildCloses, 1);
  assert.equal(stdout, '');
  assert.equal(stderr, '');
  assert.equal(processRef.listenerCount('SIGINT'), 0);
  assert.equal(processRef.listenerCount('SIGTERM'), 0);
});

test('foreground startup abort fails closed when owned build cleanup fails', async () => {
  const processRef = new EventEmitter();
  processRef.stdin = new PassThrough();
  processRef.stdin.resume();
  let markRecoveryStarted;
  const recoveryStarted = new Promise((resolve) => { markRecoveryStarted = resolve; });
  const privateFailure = `${projectRoot} private cleanup failure`;
  let stderr = '';
  const foreground = mainModule.runEditorForeground({
    processRef,
    projectRoot,
    buildService: Object.assign(async () => {}, { close: async () => { throw new Error(privateFailure); } }),
    repositoryService: { bootstrap: async () => ({ csrfToken: 'csrf-A' }) },
    transactionService: {
      recoverBeforeListen: async () => { markRecoveryStarted(); return new Promise(() => {}); },
      runMutation: async (action) => action(),
    },
    env: { EDITOR_NO_OPEN: '1', PATH: path.dirname(process.execPath) },
    stdout: { write() { assert.fail('aborted startup must not become ready'); } },
    stderr: { write(value) { stderr += value; } },
  });
  await recoveryStarted;
  processRef.stdin.end();
  assert.equal(await Promise.race([foreground, new Promise((resolve) => setTimeout(() => resolve('timeout'), 500))]), 1);
  assert.equal(stderr, '网站编辑器启动失败，请保留此窗口中的提示并联系维护者。\n');
  assert.doesNotMatch(stderr, /private cleanup|yunxi-academic-website/i);
});

test('foreground does not create a listener when parent stdin already ended before startup', async () => {
  const processRef = new EventEmitter();
  processRef.stdin = new PassThrough();
  processRef.stdin.resume();
  processRef.stdin.end();
  await once(processRef.stdin, 'end');
  let editorCloses = 0;
  let buildCloses = 0;
  const foreground = mainModule.runEditorForeground({
    processRef,
    projectRoot,
    token: 'startup-A', csrfToken: 'csrf-A',
    buildService: Object.assign(async () => {}, { close: async () => { buildCloses += 1; } }),
    repositoryService: { bootstrap: async () => ({ csrfToken: 'csrf-A' }) },
    transactionService: { recoverBeforeListen: async () => ({ ok: true, recoveryOnly: false, results: [] }), runMutation: async (action) => action() },
    start: async () => ({ origin: 'http://127.0.0.1:12345', close: async () => { editorCloses += 1; } }),
    env: { EDITOR_NO_OPEN: '1', PATH: path.dirname(process.execPath) }, stdout: { write() {} }, stderr: { write() {} },
  });
  const outcome = await Promise.race([foreground, new Promise((resolve) => setTimeout(() => resolve('timeout'), 500))]);
  assert.equal(outcome, 0);
  assert.equal(editorCloses, 0);
  assert.equal(buildCloses, 1);
});

test('launcher setup failure terminates the child tree before propagating the error', async (t) => {
  const setupFailure = new Error('launcher setup failure sentinel');
  let child;
  let readyUrl;
  let descendants = [];
  let unexpectedlyStarted;
  let observed;
  try {
    unexpectedlyStarted = await startLauncher(t, {
      observeChild(value) { child = value; },
      waitForReady: async (stream) => {
        const match = await waitForLine(stream, /EDITOR_READY=(http:\/\/127\.0\.0\.1:\d+\/\?session=[a-f0-9]+)/);
        readyUrl = match[1];
        descendants = await descendantPids(child.pid);
        assert.ok(descendants.length >= 1);
        throw setupFailure;
      },
    });
  } catch (error) { observed = error; }
  finally {
    if (unexpectedlyStarted) await stopLauncher(unexpectedlyStarted.child, unexpectedlyStarted.descendants);
  }
  assert.equal(observed, setupFailure);
  assert.ok(child);
  assert.equal(processIsAlive(child.pid), false);
  assert.deepEqual(descendants.filter(processIsAlive), []);
  await assert.rejects(fetch(new URL('/api/health', readyUrl)));
});

async function descendantPids(rootPid) {
  const command = "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId | ConvertTo-Json -Compress";
  const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-Command', command], { encoding: 'utf8', windowsHide: true, timeout: 10_000 });
  const parsed = JSON.parse(stdout);
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  const descendants = new Set();
  let parents = new Set([rootPid]);
  while (parents.size) {
    const children = rows.filter((row) => parents.has(row.ParentProcessId)).map((row) => row.ProcessId);
    parents = new Set(children.filter((pid) => !descendants.has(pid)));
    for (const pid of parents) descendants.add(pid);
  }
  return [...descendants];
}

async function processRows(pids) {
  const command = "Get-CimInstance Win32_Process | Select-Object ProcessId,Name,ExecutablePath,CommandLine | ConvertTo-Json -Compress";
  const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-Command', command], { encoding: 'utf8', windowsHide: true, timeout: 10_000 });
  const parsed = JSON.parse(stdout);
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  return rows.filter((row) => pids.includes(row.ProcessId));
}

function processIsAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

async function stopLauncher(child, knownDescendants = []) {
  const currentDescendants = child?.pid ? await descendantPids(child.pid) : [];
  const ownedDescendants = [...new Set([...knownDescendants, ...currentDescendants])];
  const terminate = async (pid) => {
    try {
      await execFileAsync(path.join(systemDirectory, 'taskkill.exe'), ['/PID', String(pid), '/T', '/F'], { windowsHide: true, timeout: 10_000 });
    } catch (error) {
      if (processIsAlive(pid)) throw error;
    }
  };
  if (child.exitCode === null) {
    await terminate(child.pid);
    await waitForExit(child);
  }
  for (const pid of ownedDescendants) {
    if (processIsAlive(pid)) await terminate(pid);
  }
  const survivors = ownedDescendants.filter(processIsAlive);
  if (processIsAlive(child.pid) || survivors.length) throw new Error(`launcher cleanup left descendants: ${survivors.join(',')}`);
}

async function createLauncherWorkspace() {
  const workspace = await createTestWorkspace();
  await cp(path.join(projectRoot, 'src'), path.join(workspace.root, 'src'), { recursive: true, force: true });
  const editorRoot = path.join(workspace.root, 'editor');
  await mkdir(editorRoot);
  await cp(path.join(projectRoot, 'editor', 'server'), path.join(editorRoot, 'server'), { recursive: true });
  await cp(path.join(projectRoot, 'editor', 'client'), path.join(editorRoot, 'client'), { recursive: true });
  await cp(path.join(projectRoot, 'dist'), path.join(workspace.root, 'dist'), { recursive: true });
  const isolatedLauncherPath = path.join(workspace.root, path.basename(launcherPath));
  await copyFile(launcherPath, isolatedLauncherPath);
  return { ...workspace, launcherPath: isolatedLauncherPath };
}

async function spawnLauncher(t, { workspace, runtimePath = [path.dirname(process.execPath), process.env.PATH].filter(Boolean).join(path.delimiter), env = {}, observeChild = () => {} } = {}) {
  const ownedWorkspace = workspace ?? await createLauncherWorkspace();
  let child;
  const owned = { child: undefined, descendants: [], workspace: ownedWorkspace };
  t.after(async () => {
    const errors = [];
    try { if (child) await stopLauncher(child, owned.descendants); } catch (error) { errors.push(error); }
    try { await ownedWorkspace.cleanup(); } catch (error) { errors.push(error); }
    if (errors.length) throw new AggregateError(errors, 'launcher test cleanup failed');
  });
  child = spawn(commandInterpreter, ['/d', '/c', ownedWorkspace.launcherPath], {
    cwd: ownedWorkspace.root,
    env: { ...process.env, PATH: runtimePath, EDITOR_NO_OPEN: '1', ...env },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  owned.child = child;
  observeChild(child);
  return owned;
}

async function startLauncher(t, { waitForReady = (stream) => waitForLine(stream, /EDITOR_READY=(http:\/\/127\.0\.0\.1:\d+\/\?session=[a-f0-9]+)/), ...options } = {}) {
  const owned = await spawnLauncher(t, options);
  const { child } = owned;
  try {
    const [, readyUrl] = await waitForReady(child.stdout);
    owned.readyUrl = readyUrl;
    owned.descendants = await descendantPids(child.pid);
    assert.ok(owned.descendants.length >= 1, 'launcher must own a foreground node process');
    return owned;
  } catch (error) {
    await stopLauncher(child, owned.descendants);
    throw error;
  }
}

async function authenticatedHealth(readyUrl) {
  const cookie = await authenticateLauncher(readyUrl);
  return fetch(new URL('/api/health', readyUrl), { headers: { Cookie: cookie } });
}

async function authenticateLauncher(readyUrl) {
  const url = new URL(readyUrl);
  const bootstrap = await new Promise((resolve, reject) => {
    const request = http.get({ hostname: url.hostname, port: url.port, path: `${url.pathname}${url.search}`, headers: { Host: url.host } }, resolve);
    request.once('error', reject);
  });
  assert.equal(bootstrap.statusCode, 302);
  bootstrap.resume();
  const cookie = bootstrap.headers['set-cookie']?.[0]?.split(';')[0];
  assert.ok(cookie);
  return cookie;
}

test('closing the foreground launcher leaves no editor listener', { timeout: 25_000 }, async (t) => {
  const run = await startLauncher(t);
  const ready = new URL(run.readyUrl);
  assert.equal(ready.hostname, '127.0.0.1');
  const response = await authenticatedHealth(run.readyUrl);
  assert.deepEqual(await response.json(), { ok: true });

  run.child.stdin.end();
  assert.equal(await waitForExit(run.child), 0);
  await assert.rejects(fetch(new URL('/api/health', run.readyUrl)));
  assert.deepEqual(run.descendants.filter(processIsAlive), []);
});

test('a second launcher uses a different loopback port while the first listener is occupied', { timeout: 30_000 }, async (t) => {
  const first = await startLauncher(t);
  const second = await startLauncher(t);
  const firstUrl = new URL(first.readyUrl);
  const secondUrl = new URL(second.readyUrl);
  assert.equal(firstUrl.hostname, '127.0.0.1');
  assert.equal(secondUrl.hostname, '127.0.0.1');
  assert.notEqual(firstUrl.port, secondUrl.port);
  assert.equal((await authenticatedHealth(first.readyUrl)).status, 200);
  assert.equal((await authenticatedHealth(second.readyUrl)).status, 200);
  first.child.stdin.end();
  second.child.stdin.end();
  assert.equal(await waitForExit(first.child), 0);
  assert.equal(await waitForExit(second.child), 0);
  assert.deepEqual([...first.descendants, ...second.descendants].filter(processIsAlive), []);
});

test('foreground close settles an active candidate child and lock before restart recovery serves a route', { timeout: 30_000 }, async (t) => {
  const workspace = await createTestWorkspace();
  const contentRoot = path.join(workspace.root, 'src', 'content');
  const distRoot = path.join(workspace.root, 'dist');
  const backupRoot = path.join(workspace.root, '.local-editor', 'backups');
  const astroScript = path.join(workspace.root, 'node_modules', 'astro', 'bin', 'astro.mjs');
  await mkdir(distRoot);
  await writeFile(path.join(distRoot, 'index.html'), '<!doctype html><title>old</title>\n');
  await mkdir(backupRoot, { recursive: true });
  await mkdir(path.dirname(astroScript), { recursive: true });
  await writeFile(astroScript, [
    "import { spawn } from 'node:child_process';",
    "import { writeFile } from 'node:fs/promises';",
    "import path from 'node:path';",
    "const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',windowsHide:true});",
    "await writeFile(path.join(process.env.EDITOR_OPERATION_ROOT,'active-child.pid'),String(child.pid));",
    "await new Promise(()=>{});",
  ].join(''));
  const builder = createCandidateBuilder({ projectRoot: workspace.root, timeoutMs: 20_000 });
  const repositoryService = createRepositoryService({ projectRoot: workspace.root, csrfToken: 'csrf-integration' });
  const transactionService = createTransactionService({ projectRoot: workspace.root, contentRoot, distRoot, backupRoot, buildCandidate: builder });
  const processRef = new EventEmitter();
  processRef.stdin = new PassThrough();
  processRef.stdin.resume();
  let foreground;
  let restarted;
  t.after(async () => {
    processRef.stdin.end();
    if (foreground) await foreground;
    if (restarted?.ok) await restarted.close();
    await builder.close();
    await workspace.cleanup();
  });
  let resolveReady;
  const ready = new Promise((resolve) => { resolveReady = resolve; });
  foreground = mainModule.runEditorForeground({
    processRef,
    projectRoot: workspace.root,
    token: 'a'.repeat(64),
    csrfToken: 'csrf-integration',
    buildService: builder,
    repositoryService,
    transactionService,
    env: { EDITOR_NO_OPEN: '1', PATH: path.dirname(process.execPath) },
    stdout: { write(value) { const match = /^EDITOR_READY=(.+)\n$/.exec(value); if (match) resolveReady(match[1]); } },
    stderr: { write() { assert.fail('active build shutdown must not report a startup failure'); } },
  });
  const readyUrl = await ready;
  const cookie = await authenticateLauncher(readyUrl);
  const bootstrapResponse = await fetch(new URL('/api/bootstrap', readyUrl), { headers: { Cookie: cookie } });
  assert.equal(bootstrapResponse.status, 200);
  const bootstrap = await bootstrapResponse.json();
  const payload = {
    baseManifestHash: bootstrap.baseManifestHash,
    sessionId: bootstrap.uploadSessionId,
    content: { site: bootstrap.site, about: bootstrap.about, projects: bootstrap.projects, research: bootstrap.research },
    images: bootstrap.images.map(({ destination, sha256 }) => ({ kind: 'canonical', destination, sha256 })),
  };
  const encoded = JSON.stringify(payload);
  const saveRequest = fetch(new URL('/api/save', readyUrl), {
    method: 'POST',
    headers: { Cookie: cookie, Origin: new URL(readyUrl).origin, 'Content-Type': 'application/json', 'X-Editor-CSRF': 'csrf-integration' },
    body: encoded,
  });
  let operationId;
  let childPid;
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline && !childPid) {
    for (const entry of await readdir(backupRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^\d{8}T\d{6}Z-\d{4}$/.test(entry.name)) continue;
      try {
        childPid = Number(await readFile(path.join(backupRoot, entry.name, 'active-child.pid'), 'utf8'));
        operationId = entry.name;
      } catch (error) { if (error?.code !== 'ENOENT') throw error; }
    }
    if (!childPid) await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.ok(Number.isSafeInteger(childPid) && childPid > 0, 'candidate child must become active');
  assert.equal(processIsAlive(childPid), true);
  await readFile(path.join(backupRoot, '.operation.lock'), 'utf8');

  processRef.stdin.end();
  assert.equal(await foreground, 0);
  const saveResponse = await saveRequest;
  assert.equal(saveResponse.status, 422);
  assert.equal(processIsAlive(childPid), false);
  await assert.rejects(readFile(path.join(backupRoot, '.operation.lock')), (error) => error?.code === 'ENOENT');
  const journal = JSON.parse(await readFile(path.join(backupRoot, operationId, 'journal.json'), 'utf8'));
  assert.equal(journal.phase, 'candidate-failed');

  const restartRepository = createRepositoryService({ projectRoot: workspace.root, csrfToken: 'csrf-restart' });
  const restartBuilder = Object.assign(async () => assert.fail('terminal candidate failure must not rebuild on restart'), { close: async () => {} });
  const restartTransaction = createTransactionService({ projectRoot: workspace.root, contentRoot, distRoot, backupRoot, buildCandidate: restartBuilder });
  let recoveredBeforeRoute = false;
  const recover = restartTransaction.recoverBeforeListen.bind(restartTransaction);
  restartTransaction.recoverBeforeListen = async () => { const result = await recover(); recoveredBeforeRoute = true; return result; };
  restarted = await mainModule.runEditorMain({
    projectRoot: workspace.root,
    token: 'b'.repeat(64),
    csrfToken: 'csrf-restart',
    buildService: restartBuilder,
    repositoryService: { bootstrap: async () => { assert.equal(recoveredBeforeRoute, true); return restartRepository.bootstrap(); } },
    transactionService: restartTransaction,
    env: { EDITOR_NO_OPEN: '1', PATH: path.dirname(process.execPath) },
    stdout: { write() {} },
    stderr: { write() { assert.fail('terminal candidate failure must restart normally'); } },
  });
  assert.equal(restarted.ok, true);
  const restartUrl = `${restarted.editor.origin}/?session=${'b'.repeat(64)}`;
  const restartCookie = await authenticateLauncher(restartUrl);
  const restartedBootstrap = await fetch(new URL('/api/bootstrap', restartUrl), { headers: { Cookie: restartCookie } });
  assert.equal(restartedBootstrap.status, 200);
  assert.equal(recoveredBeforeRoute, true);
  await restarted.close();
  restarted = undefined;
});

test('real batch launcher executes the safe project-local node before a compatible PATH node', { timeout: 25_000 }, async (t) => {
  const workspace = await createLauncherWorkspace();
  const localNode = path.join(workspace.root, '.local-editor', 'tools', 'node', 'node.exe');
  const pathNodeDirectory = path.join(workspace.root, 'path-runtime');
  await mkdir(path.dirname(localNode), { recursive: true });
  await mkdir(pathNodeDirectory);
  await copyFile(process.execPath, localNode);
  await copyFile(process.execPath, path.join(pathNodeDirectory, 'node.exe'));
  const run = await startLauncher(t, { workspace, runtimePath: [pathNodeDirectory, systemDirectory].join(path.delimiter) });
  const rows = await processRows(run.descendants);
  const nodeRows = rows.filter((row) => row.Name?.toLowerCase() === 'node.exe');
  assert.equal(nodeRows.length, 1);
  assert.match(nodeRows[0].ExecutablePath.toLowerCase(), /[\\/]\.local-editor[\\/]tools[\\/]node[\\/]node\.exe$/);
  assert.doesNotMatch(nodeRows[0].ExecutablePath.toLowerCase(), /[\\/]path-runtime[\\/]node\.exe$/);
  run.child.stdin.end();
  assert.equal(await waitForExit(run.child), 0);
});

test('real batch launcher rejects a project-local runtime directory junction before listening', { timeout: 25_000 }, async (t) => {
  const workspace = await createLauncherWorkspace();
  const localNodeDirectory = path.join(workspace.root, '.local-editor', 'tools', 'node');
  const junctionTarget = path.join(workspace.root, 'runtime-junction-target');
  await mkdir(path.dirname(localNodeDirectory), { recursive: true });
  await mkdir(junctionTarget);
  await copyFile(process.execPath, path.join(junctionTarget, 'node.exe'));
  await symlink(junctionTarget, localNodeDirectory, 'junction');
  const marker = path.join(workspace.root, 'unsafe-runtime-executed');
  const preload = path.join(workspace.root, 'unsafe-runtime-marker.cjs');
  await writeFile(preload, [
    "const fs = require('node:fs');",
    "const actual = fs.realpathSync(process.execPath).toLowerCase();",
    "const unsafe = fs.realpathSync(process.env.EDITOR_UNSAFE_NODE_TARGET).toLowerCase();",
    "if (actual === unsafe) fs.writeFileSync(process.env.EDITOR_UNSAFE_NODE_MARKER, 'executed');",
  ].join('\n'));
  const run = await spawnLauncher(t, {
    workspace,
    env: {
      NODE_OPTIONS: '--require=./unsafe-runtime-marker.cjs',
      EDITOR_UNSAFE_NODE_TARGET: path.join(junctionTarget, 'node.exe'),
      EDITOR_UNSAFE_NODE_MARKER: marker,
    },
  });
  try {
    const outcome = await Promise.race([
      waitForLine(run.child.stdout, /EDITOR_READY=/).then(() => 'ready'),
      waitForExit(run.child).then((code) => `exit:${code}`),
    ]);
    assert.equal(outcome, 'exit:1');
    assert.deepEqual(await descendantPids(run.child.pid), []);
    await assert.rejects(readFile(marker), (error) => error?.code === 'ENOENT');
  } finally {
    await rm(localNodeDirectory, { force: true });
    await rm(junctionTarget, { recursive: true, force: true });
  }
});
