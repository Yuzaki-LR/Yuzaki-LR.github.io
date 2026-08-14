import { randomBytes } from 'node:crypto';
import { mkdir, lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startEditor } from './app.mjs';
import { createCandidateBuilder } from './build-service.mjs';
import { createRepositoryService } from './repository-service.mjs';
import { createTransactionService } from './transaction-service.mjs';
import { assertConfinedPath } from './path-policy.mjs';

const recoveryInstruction = '检测到无法自动恢复的编辑记录，请保留现场并人工检查。\n';

export async function runEditorMain({
  projectRoot = path.resolve(process.cwd()),
  token = randomBytes(32).toString('hex'),
  csrfToken = randomBytes(32).toString('hex'),
  repositoryService,
  transactionService,
  start = startEditor,
  stdout = process.stdout,
  stderr = process.stderr,
} = {}) {
  try {
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
    const localReal = await realpath(localRoot), backupReal = await realpath(backupRoot);
    if (path.dirname(localReal) !== projectReal || path.dirname(backupReal) !== localReal || (await lstat(localReal)).isSymbolicLink() || (await lstat(backupReal)).isSymbolicLink()) throw new Error('backup root is unsafe');
    repositoryService ??= createRepositoryService({ projectRoot, csrfToken });
    transactionService ??= createTransactionService({
      projectRoot,
      contentRoot: path.join(projectRoot, 'src', 'content'),
      distRoot: path.join(projectRoot, 'dist'),
      backupRoot: backupReal,
      buildCandidate: createCandidateBuilder({ projectRoot }),
    });
    const editor = await start({ projectRoot, preferredPort: 0, token, csrfToken, repositoryService, transactionService });
    stdout.write(`${editor.origin}/?session=${token}\n`);
    return { ok: true, exitCode: 0, editor };
  } catch {
    stderr.write(recoveryInstruction);
    return { ok: false, exitCode: 1 };
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : undefined;
if (invokedPath === fileURLToPath(import.meta.url)) {
  const result = await runEditorMain();
  if (!result.ok) process.exitCode = result.exitCode;
  else for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await result.editor.close(); process.exit(0); });
}
