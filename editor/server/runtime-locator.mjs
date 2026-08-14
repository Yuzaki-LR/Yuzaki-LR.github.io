import { execFile } from 'node:child_process';
import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { assertConfinedPath } from './path-policy.mjs';

const execFileAsync = promisify(execFile);
const minimumVersion = [22, 12, 0];

function runtimeFailure(code, messageZh) {
  return Object.assign(new Error(messageZh), { code, messageZh });
}

function samePath(first, second) {
  const left = path.resolve(first);
  const right = path.resolve(second);
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
}

export function isCompatibleNodeVersion(value) {
  const match = /^v(\d+)\.(\d+)\.(\d+)$/.exec(value ?? '');
  if (!match) return false;
  const version = match.slice(1).map(Number);
  for (let index = 0; index < minimumVersion.length; index += 1) {
    if (version[index] > minimumVersion[index]) return true;
    if (version[index] < minimumVersion[index]) return false;
  }
  return true;
}

async function executableVersion(executable) {
  try {
    const { stdout, stderr } = await execFileAsync(executable, ['--version'], {
      encoding: 'utf8', timeout: 5_000, windowsHide: true, maxBuffer: 1024,
    });
    if (stderr.trim()) return undefined;
    const version = stdout.trim();
    return isCompatibleNodeVersion(version) ? version : undefined;
  } catch { return undefined; }
}

async function existingSafeFile(candidate) {
  let info;
  try { info = await lstat(candidate); }
  catch (error) {
    if (error?.code === 'ENOENT') return undefined;
    throw error;
  }
  if (!info.isFile() || info.isSymbolicLink()) throw runtimeFailure('NODE_RUNTIME_UNSAFE', '检测到不安全的 Node.js 运行时文件，请人工检查。');
  const resolved = await realpath(candidate);
  if (!samePath(resolved, candidate)) throw runtimeFailure('NODE_RUNTIME_UNSAFE', '检测到不安全的 Node.js 运行时文件，请人工检查。');
  return resolved;
}

function pathDirectories(envPath) {
  if (typeof envPath !== 'string') return [];
  return envPath.split(path.delimiter).map((value) => value.trim().replace(/^"(.*)"$/, '$1')).filter((value) => path.isAbsolute(value));
}

export async function locateNode({ projectRoot, envPath } = {}) {
  if (typeof projectRoot !== 'string' || !path.isAbsolute(projectRoot)) throw runtimeFailure('NODE_RUNTIME_UNSAFE', '项目目录无效，无法检查 Node.js 运行时。');
  const projectInfo = await lstat(projectRoot);
  if (!projectInfo.isDirectory() || projectInfo.isSymbolicLink()) throw runtimeFailure('NODE_RUNTIME_UNSAFE', '项目目录不安全，无法检查 Node.js 运行时。');
  const projectReal = await realpath(projectRoot);
  if (!samePath(projectReal, projectRoot)) throw runtimeFailure('NODE_RUNTIME_UNSAFE', '项目目录不安全，无法检查 Node.js 运行时。');

  const localRelative = '.local-editor/tools/node/node.exe';
  const localCandidate = path.join(projectReal, ...localRelative.split('/'));
  let localExecutable;
  try {
    await assertConfinedPath({ root: projectReal, relativePath: localRelative, mustExist: true, operation: 'read' });
    localExecutable = await existingSafeFile(localCandidate);
  } catch (error) {
    if (error?.code === 'ENOENT') localExecutable = undefined;
    else if (error?.code === 'NODE_RUNTIME_UNSAFE') throw error;
    else throw runtimeFailure('NODE_RUNTIME_UNSAFE', '检测到不安全的 Node.js 运行时路径，请人工检查。');
  }
  if (localExecutable) {
    const version = await executableVersion(localExecutable);
    if (version) return { executable: localExecutable, source: 'project-local', version };
  }

  for (const directory of pathDirectories(envPath)) {
    const executable = await existingSafeFile(path.resolve(directory, 'node.exe'));
    if (!executable) continue;
    const version = await executableVersion(executable);
    if (version) return { executable, source: 'path', version };
  }
  throw runtimeFailure('NODE_RUNTIME_REQUIRED', '未找到兼容的 Node.js（需要 22.12.0 或更高版本）。请将便携运行时放入项目的 .local-editor/tools/node 目录后重新启动；本程序不会下载软件或修改系统 PATH。');
}
