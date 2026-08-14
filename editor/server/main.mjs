import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { startEditor } from './app.mjs';
import { createCandidateBuilder } from './build-service.mjs';
import { assertConfinedPath } from './path-policy.mjs';
import { createRepositoryService } from './repository-service.mjs';
import { isCompatibleNodeVersion, locateNode } from './runtime-locator.mjs';
import { createTransactionService } from './transaction-service.mjs';

const execFileAsync = promisify(execFile);
const recoveryInstruction = '检测到无法自动恢复的编辑记录，请保留现场并人工检查。\n';
const startupFailureInstruction = '网站编辑器启动失败，请保留此窗口中的提示并联系维护者。\n';

function startupAborted() {
  return Object.assign(new Error('editor startup aborted'), { code: 'STARTUP_ABORTED' });
}

async function defaultOpenBrowser(url) {
  if (process.platform !== 'win32') throw new Error('unsupported browser launcher');
  await execFileAsync(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', 'start', '', url], {
    windowsHide: true,
    timeout: 10_000,
    maxBuffer: 1024,
  });
}

function closeOwned(editor, buildService) {
  let closePromise;
  return () => {
    closePromise ??= (async () => {
      const results = await Promise.allSettled([
        buildService?.close?.(),
        editor?.close?.(),
      ]);
      const errors = results.filter((result) => result.status === 'rejected').map((result) => result.reason);
      if (errors.length) throw new AggregateError(errors, 'editor shutdown failed');
    })();
    return closePromise;
  };
}

function sameExecutable(first, second) {
  const left = path.resolve(first);
  const right = path.resolve(second);
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
}

export async function runEditorMain({
  projectRoot = path.resolve(process.cwd()),
  token = randomBytes(32).toString('hex'),
  csrfToken = randomBytes(32).toString('hex'),
  buildService,
  repositoryService,
  transactionService,
  start = startEditor,
  env = process.env,
  openBrowser = defaultOpenBrowser,
  stdout = process.stdout,
  stderr = process.stderr,
  signal,
} = {}) {
  let editor;
  let ownedBuildService = buildService;
  try {
    if (signal?.aborted) throw startupAborted();
    if (!isCompatibleNodeVersion(process.version)) throw new Error('Node.js runtime is incompatible');
    const runtime = await locateNode({
      projectRoot,
      envPath: env.PATH ?? env.Path ?? process.env.PATH ?? process.env.Path,
    });
    const actualExecutable = await realpath(process.execPath);
    if (!sameExecutable(runtime.executable, actualExecutable)) throw new Error('Node.js runtime identity mismatch');
    const projectInfo = await lstat(projectRoot);
    if (!projectInfo.isDirectory() || projectInfo.isSymbolicLink()) throw new Error('project root is unsafe');
    const projectReal = await realpath(projectRoot);
    const localRoot = path.join(projectReal, '.local-editor');
    const backupRoot = path.join(localRoot, 'backups');
    await assertConfinedPath({ root: projectReal, relativePath: '.local-editor', mustExist: false, operation: 'copy' });
    await mkdir(localRoot, { recursive: true });
    await assertConfinedPath({ root: projectReal, relativePath: '.local-editor', mustExist: true, operation: 'copy' });
    await assertConfinedPath({ root: projectReal, relativePath: '.local-editor/backups', mustExist: false, operation: 'copy' });
    await mkdir(backupRoot, { recursive: true });
    await assertConfinedPath({ root: projectReal, relativePath: '.local-editor/backups', mustExist: true, operation: 'copy' });
    const localReal = await realpath(localRoot);
    const backupReal = await realpath(backupRoot);
    if (path.dirname(localReal) !== projectReal || path.dirname(backupReal) !== localReal || (await lstat(localReal)).isSymbolicLink() || (await lstat(backupReal)).isSymbolicLink()) throw new Error('backup root is unsafe');
    repositoryService ??= createRepositoryService({ projectRoot, csrfToken });
    if (!transactionService) {
      ownedBuildService ??= createCandidateBuilder({ projectRoot });
      transactionService = createTransactionService({
        projectRoot,
        contentRoot: path.join(projectRoot, 'src', 'content'),
        distRoot: path.join(projectRoot, 'dist'),
        backupRoot: backupReal,
        buildCandidate: ownedBuildService,
      });
    }
    editor = await start({ projectRoot, preferredPort: 0, token, csrfToken, repositoryService, transactionService, signal });
    const readyUrl = `${editor.origin}/?session=${token}`;
    if (env.EDITOR_NO_OPEN !== '1') await openBrowser(readyUrl);
    stdout.write(`EDITOR_READY=${readyUrl}\n`);
    return { ok: true, exitCode: 0, editor, buildService: ownedBuildService, close: closeOwned(editor, ownedBuildService) };
  } catch (error) {
    let cleanupFailed = false;
    try { await closeOwned(editor, ownedBuildService)(); } catch { cleanupFailed = true; }
    if (error?.code === 'STARTUP_ABORTED' && !cleanupFailed) return { ok: false, exitCode: 0 };
    stderr.write(error?.code === 'RECOVERY_REQUIRED' ? recoveryInstruction : startupFailureInstruction);
    return { ok: false, exitCode: 1 };
  }
}

export async function runEditorForeground({ processRef = process, ...options } = {}) {
  const stdin = processRef.stdin;
  const startupController = new AbortController();
  const shutdownAlreadyRequested = Boolean(stdin?.readableEnded || stdin?.destroyed);
  let shutdownRequested = false;
  let resolveShutdown;
  const shutdownRequest = new Promise((resolve) => { resolveShutdown = resolve; });
  const requestShutdown = () => {
    if (shutdownRequested) return;
    shutdownRequested = true;
    startupController.abort();
    resolveShutdown();
  };
  for (const signal of ['SIGINT', 'SIGTERM']) processRef.once(signal, requestShutdown);
  stdin?.once('end', requestShutdown);
  stdin?.once('close', requestShutdown);
  if (stdin && !stdin.isTTY && !stdin.destroyed) stdin.resume();
  if (shutdownAlreadyRequested || stdin?.readableEnded || stdin?.destroyed) requestShutdown();
  try {
    const result = await runEditorMain({ ...options, signal: startupController.signal });
    if (!result.ok) return result.exitCode;
    if (!shutdownRequested) await shutdownRequest;
    try { await result.close(); return 0; } catch { return 1; }
  } finally {
    for (const signal of ['SIGINT', 'SIGTERM']) processRef.off(signal, requestShutdown);
    stdin?.off('end', requestShutdown);
    stdin?.off('close', requestShutdown);
    if (stdin && !stdin.isTTY && !stdin.destroyed) stdin.pause();
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : undefined;
if (invokedPath === fileURLToPath(import.meta.url)) process.exitCode = await runEditorForeground();
