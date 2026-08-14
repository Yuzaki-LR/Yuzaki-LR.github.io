import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, lstat, realpath, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

function failure() {
  return Object.assign(new Error('候选网站构建失败'), {
    code: 'CANDIDATE_BUILD_FAILED',
    diagnostic: { code: 'CANDIDATE_BUILD_FAILED' },
  });
}

function contained(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function realDirectory(value, label) {
  const info = await lstat(value);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`${label}不安全`);
  return realpath(value);
}

async function confinedDirectory(operationRoot, target, label) {
  const root = await realDirectory(operationRoot, '操作目录');
  const resolved = await realDirectory(target, label);
  if (!contained(root, resolved) || resolved === root) throw new Error(`${label}超出操作目录`);
  return resolved;
}

async function assertOutputTree(root) {
  let files = 0;
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      const info = await lstat(target);
      if (info.isSymbolicLink()) throw new Error('候选构建输出包含重解析点');
      const resolved = await realpath(target);
      if (!contained(root, resolved)) throw new Error('候选构建输出超出操作目录');
      if (info.isDirectory()) await visit(resolved);
      else if (info.isFile()) files += 1;
      else throw new Error('候选构建输出类型不安全');
    }
  }
  await visit(root);
  if (files === 0) throw new Error('候选构建没有生成输出');
}

async function sourceTreeManifest(projectRoot, operationRoot) {
  const files = new Map();
  const skipped = new Set(['.git', 'node_modules']);
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (directory === projectRoot && skipped.has(entry.name)) continue;
      const target = path.join(directory, entry.name);
      if (target === operationRoot || target.startsWith(`${operationRoot}${path.sep}`)) continue;
      if (target === path.join(projectRoot, '.local-editor', 'runtime') || target.startsWith(`${path.join(projectRoot, '.local-editor', 'runtime')}${path.sep}`)) continue;
      const info = await lstat(target);
      if (info.isSymbolicLink()) throw new Error('项目源码包含重解析点');
      if (info.isDirectory()) await visit(target);
      else if (info.isFile()) {
        const relative = path.relative(projectRoot, target).replace(/\\/g, '/');
        const bytes = await readFile(target);
        files.set(relative, `${bytes.length}:${createHash('sha256').update(bytes).digest('hex')}`);
      }
    }
  }
  await visit(projectRoot);
  return files;
}

function sameTree(first, second) {
  if (first.size !== second.size) return false;
  for (const [name, value] of first) if (second.get(name) !== value) return false;
  return true;
}

function limitedText(chunks, limit) {
  const bytes = Buffer.concat(chunks);
  return bytes.subarray(0, limit).toString('utf8');
}

function defaultProcessRunner(maxLogBytes, timeoutMs) {
  return (executable, args, options) => new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    const retain = (chunks, chunk, current) => {
      if (current >= maxLogBytes) return;
      chunks.push(chunk.subarray(0, maxLogBytes - current));
    };
    child.stdout.on('data', (chunk) => { retain(stdout, chunk, stdoutBytes); stdoutBytes += chunk.length; });
    child.stderr.on('data', (chunk) => { retain(stderr, chunk, stderrBytes); stderrBytes += chunk.length; });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeoutMs);
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('close', (exitCode) => {
      clearTimeout(timer);
      resolve({
        exitCode: timedOut ? -1 : exitCode,
        stdout: limitedText(stdout, maxLogBytes),
        stderr: limitedText(stderr, maxLogBytes),
        stdoutBytes,
        stderrBytes,
      });
    });
  });
}

function minimalEnvironment({ operationRoot, contentRoot, distRoot, tempRoot, cacheRoot }) {
  const env = {
    PATH: process.env.PATH ?? process.env.Path ?? '',
    NODE_ENV: 'production',
    EDITOR_CANDIDATE_BUILD: '1',
    EDITOR_OPERATION_ROOT: operationRoot,
    EDITOR_CONTENT_ROOT: contentRoot,
    EDITOR_OUT_DIR: distRoot,
    EDITOR_CACHE_DIR: cacheRoot,
    TEMP: tempRoot,
    TMP: tempRoot,
    APPDATA: tempRoot,
    NO_COLOR: '1',
    ASTRO_TELEMETRY_DISABLED: '1',
  };
  if (process.env.SystemRoot) env.SystemRoot = process.env.SystemRoot;
  if (process.env.SYSTEMROOT) env.SYSTEMROOT = process.env.SYSTEMROOT;
  return env;
}

async function writeLogSummary(logRoot, result, maxLogBytes) {
  const summary = {
    formatVersion: 1,
    exitCode: Number.isInteger(result?.exitCode) ? result.exitCode : -1,
    stdoutBytes: Number.isSafeInteger(result?.stdoutBytes) ? result.stdoutBytes : Buffer.byteLength(String(result?.stdout ?? '')),
    stderrBytes: Number.isSafeInteger(result?.stderrBytes) ? result.stderrBytes : Buffer.byteLength(String(result?.stderr ?? '')),
    retainedOutputBytes: 0,
    maxLogBytes,
  };
  await writeFile(path.join(logRoot, 'build-summary.json'), `${JSON.stringify(summary)}\n`, { encoding: 'utf8', flag: 'wx' });
}

export function createCandidateBuilder({
  projectRoot,
  runProcess,
  maxLogBytes = 64 * 1024,
  timeoutMs = 30_000,
} = {}) {
  if (typeof projectRoot !== 'string' || !path.isAbsolute(projectRoot)) throw new Error('项目目录无效');
  if (!Number.isSafeInteger(maxLogBytes) || maxLogBytes < 1 || maxLogBytes > 1024 * 1024) throw new Error('构建日志限制无效');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) throw new Error('构建时限无效');
  const execute = runProcess ?? defaultProcessRunner(maxLogBytes, timeoutMs);
  if (typeof execute !== 'function') throw new Error('构建执行器无效');

  return async function buildCandidate({ projectRoot: requestRoot, operationRoot, contentRoot, distRoot }) {
    try {
      const configuredProject = await realDirectory(projectRoot, '项目目录');
      const requestedProject = await realDirectory(requestRoot, '项目目录');
      if (configuredProject !== requestedProject) throw new Error('项目目录不匹配');
      const operation = await realDirectory(operationRoot, '操作目录');
      if (!contained(configuredProject, operation) || operation === configuredProject) throw new Error('操作目录超出项目目录');
      const content = await confinedDirectory(operation, contentRoot, '候选内容目录');
      const output = await confinedDirectory(operation, distRoot, '候选输出目录');
      const tempRoot = path.join(operation, 'build-temp');
      const cacheRoot = path.join(operation, 'build-cache');
      const logRoot = path.join(operation, 'build-logs');
      await mkdir(tempRoot);
      await mkdir(cacheRoot);
      await mkdir(logRoot);
      await confinedDirectory(operation, tempRoot, '构建临时目录');
      await confinedDirectory(operation, cacheRoot, '构建缓存目录');
      await confinedDirectory(operation, logRoot, '构建日志目录');

      const executable = process.execPath;
      const args = [
        '--permission',
        `--allow-fs-read=${configuredProject}`,
        `--allow-fs-write=${operation}`,
        '--allow-addons',
        '--allow-child-process',
        path.join(configuredProject, 'node_modules', 'astro', 'bin', 'astro.mjs'),
        'build',
      ];
      const options = {
        cwd: configuredProject,
        env: minimalEnvironment({ operationRoot: operation, contentRoot: content, distRoot: output, tempRoot, cacheRoot }),
        shell: false,
      };
      const beforeSource = await sourceTreeManifest(configuredProject, operation);
      let result;
      let executionError;
      try { result = await execute(executable, args, options); }
      catch (error) { executionError = error; }
      const afterSource = await sourceTreeManifest(configuredProject, operation);
      await writeLogSummary(logRoot, result, maxLogBytes);
      if (!sameTree(beforeSource, afterSource)) throw failure();
      if (executionError) throw failure();
      if (result?.exitCode !== 0) throw failure();
      await confinedDirectory(operation, output, '候选输出目录');
      await assertOutputTree(output);
      return { ok: true, diagnostic: { code: 'CANDIDATE_BUILD_OK' } };
    } catch (error) {
      if (error?.code === 'CANDIDATE_BUILD_FAILED') throw error;
      throw failure();
    }
  };
}
