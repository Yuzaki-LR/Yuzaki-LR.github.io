import { execFile } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { lstat, mkdir, open, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { Uint8ArrayReader, Uint8ArrayWriter, ZipReader } from '@zip.js/zip.js';

const execFileAsync = promisify(execFile);
const MAX_ARCHIVE_BYTES = 256 * 1024 * 1024;
const MAX_ENTRY_BYTES = 256 * 1024 * 1024;
const MAX_TOTAL_BYTES = 768 * 1024 * 1024;
const MAX_ENTRIES = 20_000;
export const OFFICIAL_PORTABLE_NODE_VERSION = '24.14.0';
export const OFFICIAL_PORTABLE_NODE_SHA256 = '313fa40c0d7b18575821de8cb17483031fe07d95de5994f6f435f3b345f85c66';
const allowedRootFiles = new Set([
  'CHANGELOG.md', 'LICENSE', 'README.md', 'corepack', 'corepack.cmd', 'install_tools.bat',
  'node.exe', 'node_etw_provider.man', 'nodevars.bat', 'npm', 'npm.cmd', 'npm.ps1', 'npx', 'npx.cmd', 'npx.ps1',
]);
const allowedRootDirectories = new Set(['node_modules']);
const reservedWindowsName = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

function invalid() {
  const messageZh = '便携 Node.js 运行时校验失败，未更改现有工具目录。';
  return Object.assign(new Error(messageZh), { code: 'PORTABLE_RUNTIME_INVALID', messageZh });
}

function samePath(first, second) {
  const left = path.resolve(first);
  const right = path.resolve(second);
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
}

function contained(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function sameManifest(first, second) {
  if (first.size !== second.size) return false;
  for (const [name, value] of first) if (second.get(name) !== value) return false;
  return true;
}

async function plainTreeManifest(root) {
  const rootInfo = await lstat(root);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw invalid();
  const resolvedRoot = await realpath(root);
  if (!samePath(resolvedRoot, root)) throw invalid();
  const manifest = new Map();
  async function visit(directory) {
    const directoryBefore = await lstat(directory);
    if (!directoryBefore.isDirectory() || directoryBefore.isSymbolicLink() || !contained(resolvedRoot, await realpath(directory))) throw invalid();
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name))) {
      const target = path.join(directory, entry.name);
      const before = await lstat(target);
      if (before.isSymbolicLink() || !contained(resolvedRoot, await realpath(target))) throw invalid();
      const relative = path.relative(resolvedRoot, target).replace(/\\/g, '/');
      if (before.isDirectory()) {
        manifest.set(relative, 'directory');
        await visit(target);
      } else if (before.isFile()) {
        if (before.nlink !== 1) throw invalid();
        const handle = await open(target, 'r');
        try {
          const opened = await handle.stat();
          if (!opened.isFile() || opened.nlink !== 1 || opened.dev !== before.dev || opened.ino !== before.ino) throw invalid();
          const bytes = await handle.readFile();
          const after = await lstat(target);
          if (!after.isFile() || after.isSymbolicLink() || after.nlink !== 1 || after.dev !== opened.dev || after.ino !== opened.ino || after.size !== bytes.length) throw invalid();
          manifest.set(relative, `file:${bytes.length}:${createHash('sha256').update(bytes).digest('hex')}`);
        } finally { await handle.close(); }
      } else throw invalid();
    }
    const directoryAfter = await lstat(directory);
    if (!directoryAfter.isDirectory() || directoryAfter.isSymbolicLink() || directoryAfter.dev !== directoryBefore.dev || directoryAfter.ino !== directoryBefore.ino) throw invalid();
  }
  await visit(resolvedRoot);
  return manifest;
}

function inputBytes(value) {
  if (!Buffer.isBuffer(value) && !(value instanceof Uint8Array)) throw invalid();
  return Buffer.from(value);
}

function checksumFrom(checksumsBytes, filename) {
  const source = inputBytes(checksumsBytes);
  if (source.length < 1 || source.length > 4 * 1024 * 1024) throw invalid();
  const lines = source.toString('utf8').replace(/\r\n/g, '\n').split('\n');
  const records = [];
  for (const line of lines) {
    const match = /^([a-f0-9]{64})  (\S+)$/.exec(line);
    if (match?.[2] === filename) records.push(match[1]);
  }
  if (records.length !== 1) throw invalid();
  return records[0];
}

function validateName(entry, prefix, names) {
  const raw = Buffer.from(entry.rawFilename ?? []);
  if (!raw.length || [...raw].some((byte) => byte < 0x20 || byte > 0x7e)) throw invalid();
  const filename = raw.toString('ascii');
  if (filename !== entry.filename || filename.includes('\\') || filename.includes('\0') || filename.includes(':') || filename.startsWith('/') || filename.startsWith('//') || path.posix.isAbsolute(filename) || path.win32.isAbsolute(filename) || /^[a-zA-Z]:/.test(filename)) throw invalid();
  const directoryName = filename.endsWith('/') ? filename.slice(0, -1) : filename;
  const segments = directoryName.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..' || /[. ]$/.test(segment) || reservedWindowsName.test(segment))) throw invalid();
  const folded = directoryName.toLowerCase();
  if (names.has(folded)) throw invalid();
  names.add(folded);
  if (filename === `${prefix}/`) {
    if (!entry.directory) throw invalid();
    return '';
  }
  if (!filename.startsWith(`${prefix}/`)) throw invalid();
  const relative = filename.slice(prefix.length + 1);
  const rootPart = relative.split('/')[0];
  if (!allowedRootFiles.has(rootPart) && !allowedRootDirectories.has(rootPart)) throw invalid();
  if (relative.includes('/') && !allowedRootDirectories.has(rootPart)) throw invalid();
  if (allowedRootFiles.has(rootPart) && entry.directory) throw invalid();
  if (allowedRootDirectories.has(rootPart) && relative === rootPart && !entry.directory) throw invalid();
  return relative;
}

function validateMetadata(entry) {
  if (entry.encrypted || !Number.isSafeInteger(entry.uncompressedSize) || entry.uncompressedSize < 0 || entry.uncompressedSize > MAX_ENTRY_BYTES || ![0, 8].includes(entry.compressionMethod)) throw invalid();
  const attributes = Number(entry.externalFileAttributes) >>> 0;
  if ((attributes & 0x400) !== 0 || entry.setuid || entry.setgid || entry.sticky) throw invalid();
  const mode = entry.unixMode ?? ((attributes >>> 16) & 0xffff);
  const type = mode & 0o170000;
  if (type && type !== 0o040000 && type !== 0o100000) throw invalid();
  if (entry.directory && type === 0o100000) throw invalid();
  if (!entry.directory && type === 0o040000) throw invalid();
}

async function safeToolsRoot(toolsRoot) {
  if (typeof toolsRoot !== 'string' || !path.isAbsolute(toolsRoot)) throw invalid();
  let info;
  try { info = await lstat(toolsRoot); } catch { throw invalid(); }
  if (!info.isDirectory() || info.isSymbolicLink()) throw invalid();
  const resolved = await realpath(toolsRoot);
  if (!samePath(resolved, toolsRoot)) throw invalid();
  return resolved;
}

async function destinationAbsent(destination) {
  try { await lstat(destination); } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw invalid();
  }
  throw invalid();
}

async function verifiedEntries(zipBytes, expectedVersion) {
  const prefix = `node-v${expectedVersion}-win-x64`;
  const reader = new ZipReader(new Uint8ArrayReader(zipBytes), {
    useWebWorkers: false,
    strictness: 'strict',
    checkAmbiguity: true,
    checkOverlappingEntry: true,
    checkCrc32: true,
  });
  try {
    const entries = await reader.getEntries({ strictness: 'strict', checkAmbiguity: true });
    if (!entries.length || entries.length > MAX_ENTRIES) throw invalid();
    const names = new Set();
    let totalBytes = 0;
    let executableEntries = 0;
    let rootDirectories = 0;
    const validated = [];
    for (const entry of entries) {
      validateMetadata(entry);
      const relative = validateName(entry, prefix, names);
      totalBytes += entry.uncompressedSize;
      if (!Number.isSafeInteger(totalBytes) || totalBytes > MAX_TOTAL_BYTES) throw invalid();
      if (relative.toLowerCase() === 'node.exe') executableEntries += 1;
      if (!relative) rootDirectories += 1;
      validated.push({ entry, relative });
    }
    if (executableEntries !== 1 || rootDirectories !== 1) throw invalid();
    return { reader, validated };
  } catch (error) {
    await reader.close().catch(() => {});
    if (error?.code === 'PORTABLE_RUNTIME_INVALID') throw error;
    throw invalid();
  }
}

async function installPortableRuntime({ zipBytes, checksumsBytes, toolsRoot, expectedVersion: requestedVersion } = {}, trustAnchor) {
  let stagingRoot;
  let stagingCreated = false;
  let promotedDestination;
  let reader;
  try {
    const { version: expectedVersion, checksum: trustedChecksum, hooks = {} } = trustAnchor ?? {};
    if (!/^\d+\.\d+\.\d+$/.test(expectedVersion ?? '') || !/^[a-f0-9]{64}$/.test(trustedChecksum ?? '') || (requestedVersion !== undefined && requestedVersion !== expectedVersion)) throw invalid();
    const archive = inputBytes(zipBytes);
    if (archive.length < 22 || archive.length > MAX_ARCHIVE_BYTES) throw invalid();
    const filename = `node-v${expectedVersion}-win-x64.zip`;
    const expectedChecksum = checksumFrom(checksumsBytes, filename);
    const actualChecksum = createHash('sha256').update(archive).digest('hex');
    if (expectedChecksum !== trustedChecksum || actualChecksum !== trustedChecksum) throw invalid();
    const root = await safeToolsRoot(toolsRoot);
    const destination = path.join(root, 'node');
    await destinationAbsent(destination);
    const verified = await verifiedEntries(archive, expectedVersion);
    reader = verified.reader;

    stagingRoot = path.join(root, `.node-stage-${randomBytes(16).toString('hex')}`);
    await mkdir(stagingRoot);
    stagingCreated = true;
    for (const { entry, relative } of verified.validated) {
      if (!relative) continue;
      const destinationPath = path.join(stagingRoot, ...relative.split('/'));
      if (entry.directory) await mkdir(destinationPath, { recursive: true });
      else {
        await mkdir(path.dirname(destinationPath), { recursive: true });
        const bytes = await entry.getData(new Uint8ArrayWriter(), {
          checkAmbiguity: true,
          checkCrc32: true,
          checkOverlappingEntry: true,
        });
        await writeFile(destinationPath, bytes, { flag: 'wx', mode: 0o600 });
      }
    }
    await reader.close();
    reader = undefined;
    const extractedManifest = await plainTreeManifest(stagingRoot);
    const executable = path.join(stagingRoot, 'node.exe');
    const { stdout, stderr } = await execFileAsync(executable, ['--version'], {
      encoding: 'utf8', timeout: 10_000, windowsHide: true, maxBuffer: 1024,
    });
    if (stderr.trim() || stdout.trim() !== `v${expectedVersion}`) throw invalid();
    await hooks.afterExecutableCheck?.({ stagingRoot });
    if (!sameManifest(extractedManifest, await plainTreeManifest(stagingRoot))) throw invalid();
    if (!samePath(await safeToolsRoot(root), root)) throw invalid();
    await destinationAbsent(destination);
    if (!sameManifest(extractedManifest, await plainTreeManifest(stagingRoot))) throw invalid();
    await hooks.afterPrePromotionProof?.({ stagingRoot });
    await rename(stagingRoot, destination);
    promotedDestination = destination;
    stagingRoot = undefined;
    stagingCreated = false;
    if (!sameManifest(extractedManifest, await plainTreeManifest(destination))) throw invalid();
    const promotedExecutable = path.join(destination, 'node.exe');
    const promotedExecutableInfo = await lstat(promotedExecutable);
    if (!promotedExecutableInfo.isFile() || promotedExecutableInfo.isSymbolicLink() || !samePath(await realpath(promotedExecutable), promotedExecutable)) throw invalid();
    promotedDestination = undefined;
    return {
      version: `v${expectedVersion}`,
      checksum: actualChecksum,
      installedAt: new Date().toISOString(),
      destination,
    };
  } catch (error) {
    if (error?.code === 'PORTABLE_RUNTIME_INVALID') throw error;
    throw invalid();
  } finally {
    let cleanupFailed = false;
    try { await reader?.close(); } catch { cleanupFailed = true; }
    if (stagingRoot && stagingCreated) try { await rm(stagingRoot, { recursive: true, force: true }); } catch { cleanupFailed = true; }
    if (promotedDestination) try { await rm(promotedDestination, { recursive: true, force: true }); } catch { cleanupFailed = true; }
    if (cleanupFailed) throw invalid();
  }
}

export function stagePortableRuntime(options = {}) {
  return installPortableRuntime(options, {
    version: OFFICIAL_PORTABLE_NODE_VERSION,
    checksum: OFFICIAL_PORTABLE_NODE_SHA256,
  });
}

export function createPortableRuntimeInstallerForTesting({ expectedVersion, trustedChecksum, hooks = {} } = {}) {
  if (!/^\d+\.\d+\.\d+$/.test(expectedVersion ?? '') || !/^[a-f0-9]{64}$/.test(trustedChecksum ?? '') || !hooks || typeof hooks !== 'object' || Array.isArray(hooks)) throw invalid();
  const allowedHooks = new Set(['afterExecutableCheck', 'afterPrePromotionProof']);
  if (Object.entries(hooks).some(([name, value]) => !allowedHooks.has(name) || typeof value !== 'function')) throw invalid();
  const trustAnchor = Object.freeze({ version: expectedVersion, checksum: trustedChecksum, hooks: Object.freeze({ ...hooks }) });
  return (options = {}) => installPortableRuntime(options, trustAnchor);
}
