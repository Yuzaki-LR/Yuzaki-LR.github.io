import { createHash, randomBytes } from 'node:crypto';
import * as nodeFsSync from 'node:fs';
import * as nodeFs from 'node:fs/promises';
import path from 'node:path';
import { acquireOperationLock, isStructurallyValidOperationJournal } from './operation-lock.mjs';
import { assertConfinedPath, createConfinedFileSystem } from './path-policy.mjs';
import { serializeSiteYaml, writeCandidateBundle } from '../../src/lib/content/bundle.mjs';
import { loadSiteRepository } from '../../src/lib/content/repository.mjs';
import { serializePageFile } from '../../src/lib/content/page-file.mjs';
import { serializeProjectFile } from '../../src/lib/content/project-file.mjs';
import { serializeResearchFile } from '../../src/lib/content/research-file.mjs';
import { validatePage, validateProject, validateResearch, validateSite } from '../../src/lib/content/schema.mjs';
import { parseImageBlock } from '../../src/lib/content/image-block.mjs';

const SHA256 = /^[a-f0-9]{64}$/;
const OPERATION_ID = /^\d{8}T\d{6}Z-\d{4}$/;
const SAFE_DESTINATION = /^(?:site-images\/[a-zA-Z0-9][a-zA-Z0-9_-]*\.png|projects\/[a-z][a-z0-9-]{0,62}\/images\/[a-zA-Z0-9][a-zA-Z0-9_-]*\.png)$/;
const WRITABLE_TERMINAL_PHASES = new Set([
  'complete',
  'candidate-failed',
  'conflict-before-promotion',
  'conflict-restored-before-content-promotion',
  'conflict-restored-before-dist-promotion',
  'recovered-old',
]);

function failure(code, message, properties) {
  return Object.assign(new Error(message), { code, ...(properties ?? {}) });
}

function assertSaveInput({ baseManifestHash, bundle, uploads }) {
  if (!SHA256.test(baseManifestHash ?? '') || !bundle || typeof bundle !== 'object' || Array.isArray(bundle) || bundle.baseManifestHash !== baseManifestHash || !bundle.content || !Array.isArray(bundle.images) || (!Array.isArray(uploads) && typeof uploads?.resolveUpload !== 'function')) {
    throw failure('BAD_INPUT', '候选保存请求无效');
  }
}

function assertCandidateInput({ bundle, uploads }) {
  try {
    validateSite(bundle.content.site);
    validatePage(bundle.content.about);
    const projectSlugs = new Set();
    for (const record of bundle.content.projects ?? []) {
      if (!/^[a-z][a-z0-9-]{0,62}$/.test(record?.slug ?? '') || projectSlugs.has(record.slug)) throw new Error('project slug is invalid');
      projectSlugs.add(record.slug);
      validateProject({ ...record.document, slug: record.slug });
    }
    const researchSlugs = new Set();
    for (const record of bundle.content.research ?? []) {
      if (!/^[a-z][a-z0-9-]{0,62}$/.test(record?.slug ?? '') || researchSlugs.has(record.slug)) throw new Error('research slug is invalid');
      researchSlugs.add(record.slug);
      validateResearch(record.document);
    }
    const required = new Map();
    const addRequired = (destination) => {
      const key = destination.toLowerCase();
      const existing = required.get(key);
      if (existing && existing !== destination) throw new Error('image reference case alias');
      required.set(key, destination);
    };
    if (bundle.content.site.avatar.mode === 'image') addRequired(bundle.content.site.avatar.src.slice(2));
    const scan = (document, projectSlug) => {
      for (const section of document.sections ?? []) for (const block of section.blocks ?? []) if (block.type === 'image') {
        const parsed = parseImageBlock(block.markdown);
        if (!parsed) throw new Error('image syntax is invalid');
        if (projectSlug) {
          if (!/^\.\/images\/[a-zA-Z0-9][a-zA-Z0-9_-]*\.png$/.test(parsed.source)) throw new Error('project image reference is invalid');
          addRequired(`projects/${projectSlug}/images/${parsed.source.slice('./images/'.length)}`);
        } else if (/^\.\/site-images\/[a-zA-Z0-9][a-zA-Z0-9_-]*\.png$/.test(parsed.source)) addRequired(parsed.source.slice(2));
      }
    };
    scan(bundle.content.about);
    for (const record of bundle.content.research ?? []) scan(record.document);
    for (const record of bundle.content.projects ?? []) scan(record.document, record.slug);
    const destinations = new Set();
    for (const descriptor of bundle.images) {
      if (!descriptor || !['canonical', 'upload'].includes(descriptor.kind) || !SAFE_DESTINATION.test(descriptor.destination ?? '')) throw new Error('image destination is invalid');
      const key = descriptor.destination.toLowerCase();
      if (destinations.has(key)) throw new Error('duplicate image destination');
      destinations.add(key);
      if (descriptor.kind === 'canonical' && !SHA256.test(descriptor.sha256 ?? '')) throw new Error('canonical image hash is invalid');
      if (descriptor.kind === 'upload' && (!/^[a-f0-9]{32}$/.test(descriptor.uploadId ?? '') || !/^[a-f0-9]{32}$/.test(descriptor.sessionId ?? ''))) throw new Error('upload image binding is invalid');
    }
    if (destinations.size !== required.size || [...required].some(([key, destination]) => !destinations.has(key) || !bundle.images.some((descriptor) => descriptor.destination === destination))) throw new Error('candidate image bindings are incomplete');
    bundleFileHashes(bundle, uploads);
  } catch {
    throw failure('BAD_INPUT', '候选保存请求无效');
  }
}

async function syncDirectory(directory, filesystem) {
  const handle = await filesystem.open(directory, 'r');
  try { await handle.sync(); }
  catch (error) { if (process.platform !== 'win32' || !['EPERM', 'EINVAL'].includes(error?.code)) throw error; }
  finally { await handle.close(); }
}

async function treeManifest(root, filesystem) {
  const rootInfo = await filesystem.lstat(root);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw failure('BAD_INPUT', '目录包含重解析点');
  const rootReal = await filesystem.realpath(root);
  const files = [];
  async function visit(relativeDirectory) {
    const directory = relativeDirectory
      ? await assertConfinedPath({ root, relativePath: relativeDirectory, mustExist: true, operation: 'walker', filesystem })
      : rootReal;
    for (const entry of (await filesystem.readdir(directory, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name))) {
      const relative = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      const target = await assertConfinedPath({ root, relativePath: relative, mustExist: true, operation: 'walker', filesystem });
      const info = await filesystem.lstat(target);
      if (info.isSymbolicLink()) throw failure('BAD_INPUT', '目录包含重解析点');
      if (info.isDirectory()) await visit(relative);
      else if (info.isFile()) {
        const bytes = await filesystem.readFile(target);
        files.push({ path: relative, bytes, length: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
      } else throw failure('BAD_INPUT', '目录包含不支持的条目');
    }
  }
  await visit('');
  files.sort((left, right) => left.path.localeCompare(right.path));
  const hash = createHash('sha256');
  const compatibilityHash = createHash('sha256');
  for (const file of files) {
    hash.update(file.path); hash.update('\0'); hash.update(String(file.length)); hash.update('\0'); hash.update(file.bytes);
    compatibilityHash.update(file.path); compatibilityHash.update('\0'); compatibilityHash.update(file.bytes); compatibilityHash.update('\0');
  }
  return { hash: hash.digest('hex'), compatibilityHash: compatibilityHash.digest('hex'), files: Object.fromEntries(files.map((file) => [file.path, { length: file.length, sha256: file.sha256 }])) };
}

function operationIdOf(now, idFactory, sequence = 1) {
  if (!(now instanceof Date) || Number.isNaN(now.valueOf())) throw failure('INTERNAL_ERROR', '操作时钟无效');
  const generated = idFactory?.() ?? `${now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}-${String(sequence).padStart(4, '0')}`;
  if (!OPERATION_ID.test(generated)) throw failure('INTERNAL_ERROR', '操作标识无效');
  return { operationId: generated, createdAt: now.toISOString() };
}

async function createOperationRoot(backupRoot, operationId, filesystem) {
  const rootInfo = await filesystem.lstat(backupRoot);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw failure('RECOVERY_REQUIRED', '备份根目录不安全');
  const root = await filesystem.realpath(backupRoot);
  const target = await assertConfinedPath({ root: backupRoot, relativePath: operationId, mustExist: false, operation: 'copy', filesystem });
  await filesystem.realpath(backupRoot);
  await filesystem.mkdir(target);
  await syncDirectory(root, filesystem);
  return target;
}

async function writeJournal(operationRoot, journal, filesystem, failpoint) {
  const source = `${JSON.stringify(journal, null, 2)}\n`;
  const nonce = randomBytes(8).toString('hex');
  const temporaryName = `.journal-${nonce}.tmp`;
  const temporary = await assertConfinedPath({ root: operationRoot, relativePath: temporaryName, mustExist: false, operation: 'copy', filesystem });
  const destination = await assertConfinedPath({ root: operationRoot, relativePath: 'journal.json', mustExist: false, operation: 'rename', filesystem });
  const handle = await filesystem.open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(source, 'utf8');
    await failpoint?.('before-journal-temp-flush', { operationId: journal.operationId, phase: journal.phase });
    await handle.sync();
    await failpoint?.('after-journal-temp-flush', { operationId: journal.operationId, phase: journal.phase });
  } finally { await handle.close(); }
  await failpoint?.('before-journal-rename', { operationId: journal.operationId, phase: journal.phase });
  await filesystem.rename(temporary, destination);
  await failpoint?.('after-journal-rename', { operationId: journal.operationId, phase: journal.phase });
  await syncDirectory(operationRoot, filesystem);
  await failpoint?.('after-operation-directory-flush', { operationId: journal.operationId, phase: journal.phase });
}

async function materialiseBundle({ operationRoot, contentRoot, bundle, uploads, filesystem }) {
  const canonical = [];
  const uploaded = [];
  for (const descriptor of bundle.images) {
    if (descriptor?.kind === 'canonical' && typeof descriptor.destination === 'string' && SHA256.test(descriptor.sha256 ?? '')) {
      const target = await assertConfinedPath({ root: contentRoot, relativePath: descriptor.destination, mustExist: true, operation: 'read', filesystem });
      const bytes = await filesystem.readFile(target);
      if (createHash('sha256').update(bytes).digest('hex') !== descriptor.sha256) throw failure('CONFLICT', '规范图片已改变');
      canonical.push({ destination: descriptor.destination, bytes });
    } else if (descriptor?.kind === 'upload' && typeof uploads?.resolveUpload === 'function') {
      const resolved = uploads.resolveUpload({ uploadId: descriptor.uploadId, sessionId: descriptor.sessionId });
      if (!resolved) throw failure('BAD_INPUT', '上传图片引用已失效');
      uploaded.push({ destination: descriptor.destination, bytes: resolved.bytes });
    } else throw failure('BAD_INPUT', '候选图片引用无效');
  }
  const draft = { ...structuredClone(bundle.content), images: canonical };
  const written = await writeCandidateBundle({ root: operationRoot, draft, uploads: uploaded });
  await loadSiteRepository({ contentRoot: written.root });
  return written.root;
}

async function validateImageBindings({ contentRoot, bundle, uploads, filesystem }) {
  for (const descriptor of bundle.images) {
    if (descriptor.kind === 'canonical') {
      let target;
      try { target = await assertConfinedPath({ root: contentRoot, relativePath: descriptor.destination, mustExist: true, operation: 'read', filesystem }); }
      catch { throw failure('BAD_INPUT', '规范图片引用无效'); }
      const info = await filesystem.lstat(target);
      if (!info.isFile() || info.isSymbolicLink()) throw failure('BAD_INPUT', '规范图片引用无效');
      const bytes = await filesystem.readFile(target);
      if (createHash('sha256').update(bytes).digest('hex') !== descriptor.sha256) throw failure('CONFLICT', '规范图片已改变');
    } else if (!uploads?.resolveUpload?.({ uploadId: descriptor.uploadId, sessionId: descriptor.sessionId })) {
      throw failure('BAD_INPUT', '上传图片引用已失效');
    }
  }
}

function bundleFileHashes(bundle, uploads) {
  const content = bundle.content;
  const files = new Map();
  const add = (relative, value) => {
    const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
    files.set(relative, createHash('sha256').update(bytes).digest('hex'));
  };
  add('site.yml', serializeSiteYaml(content.site));
  add('pages/about.md', serializePageFile(content.about));
  for (const record of content.projects ?? []) add(`projects/${record.slug}/index.md`, serializeProjectFile({ ...record.document, slug: record.slug }));
  for (const record of content.research ?? []) add(`research/${record.slug}.md`, serializeResearchFile(record.document));
  for (const descriptor of bundle.images) {
    if (descriptor.kind === 'canonical') files.set(descriptor.destination, descriptor.sha256);
    else {
      const value = uploads?.resolveUpload?.({ uploadId: descriptor.uploadId, sessionId: descriptor.sessionId });
      if (!value?.bytes) throw failure('BAD_INPUT', '上传图片引用已失效');
      add(descriptor.destination, value.bytes);
    }
  }
  return files;
}

function fileDiff(current, desired) {
  const currentFiles = new Map(Object.entries(current.files).map(([name, value]) => [name, value.sha256]));
  return {
    added: [...desired.keys()].filter((name) => !currentFiles.has(name)).sort(),
    removed: [...currentFiles.keys()].filter((name) => !desired.has(name)).sort(),
    changed: [...desired].filter(([name, hash]) => currentFiles.has(name) && currentFiles.get(name) !== hash).map(([name]) => name).sort(),
  };
}

function hashesFromManifest(manifest) {
  return new Map(Object.entries(manifest.files).map(([name, value]) => [name, value.sha256]));
}

function hashJson(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function conflictTargetId({ diffHash, draftHash, canonicalManifestHash }) {
  const digest = hashJson({ diffHash, draftHash, canonicalManifestHash });
  const digits = [...digest.slice(0, 14)].map((value) => String(Number.parseInt(value, 16) % 10)).join('');
  return `${digits.slice(0, 8)}T${digits.slice(8)}Z-0000`;
}

function conflictContext({ current, desired, bundle }) {
  const diff = fileDiff(current, desired);
  const diffHash = hashJson(diff);
  const draftHash = hashJson([...desired].sort(([left], [right]) => left.localeCompare(right)));
  const canonicalManifestHash = current.hash;
  return {
    diff,
    targetId: conflictTargetId({ diffHash, draftHash, canonicalManifestHash }),
    diffHash,
    draftHash,
    canonicalManifestHash,
    baseManifestHash: bundle.baseManifestHash,
  };
}

async function copyTree({ projectRoot, sourceRoot, destinationRoot, filesystem }) {
  await confinedProjectPath(projectRoot, sourceRoot, true, 'copy', filesystem);
  await confinedProjectPath(projectRoot, destinationRoot, false, 'copy', filesystem);
  await filesystem.mkdir(destinationRoot);
  async function visit(relativeDirectory) {
    const sourceDirectory = relativeDirectory ? path.join(sourceRoot, ...relativeDirectory.split('/')) : sourceRoot;
    const destinationDirectory = relativeDirectory ? path.join(destinationRoot, ...relativeDirectory.split('/')) : destinationRoot;
    for (const entry of (await filesystem.readdir(sourceDirectory, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name))) {
      const relative = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      const source = await assertConfinedPath({ root: sourceRoot, relativePath: relative, mustExist: true, operation: 'copy', filesystem });
      const destination = await assertConfinedPath({ root: destinationRoot, relativePath: relative, mustExist: false, operation: 'copy', filesystem });
      const info = await filesystem.lstat(source);
      if (info.isSymbolicLink()) throw failure('BAD_INPUT', '备份目录包含重解析点');
      if (info.isDirectory()) { await filesystem.mkdir(destination); await visit(relative); }
      else if (info.isFile()) { await filesystem.realpath(destinationDirectory); await filesystem.copyFile(source, destination); }
      else throw failure('BAD_INPUT', '备份目录包含不支持的条目');
    }
  }
  await visit('');
  await syncDirectory(destinationRoot, filesystem);
}

function parseJournal(source, expectedId) {
  let value;
  try { value = JSON.parse(source); } catch { throw failure('RECOVERY_REQUIRED', '恢复日志损坏'); }
  if (!isStructurallyValidOperationJournal(value, expectedId)) {
    throw failure('RECOVERY_REQUIRED', '恢复日志状态矛盾');
  }
  return value;
}

async function editorOperationDirectories(backupRoot, filesystem) {
  const root = await filesystem.realpath(backupRoot);
  const operations = [];
  for (const entry of await filesystem.readdir(root, { withFileTypes: true })) {
    if (entry.name === '.operation.lock' || entry.name.startsWith('.operation.lock.')) continue;
    if (!entry.isDirectory() || !OPERATION_ID.test(entry.name)) continue;
    const operationRoot = await assertConfinedPath({ root, relativePath: entry.name, mustExist: true, operation: 'walker', filesystem });
    const journalPath = await assertConfinedPath({ root: operationRoot, relativePath: 'journal.json', mustExist: true, operation: 'read', filesystem });
    operations.push({ operationRoot, journal: parseJournal(await filesystem.readFile(journalPath, 'utf8'), entry.name) });
  }
  operations.sort((left, right) => left.journal.operationId.localeCompare(right.journal.operationId));
  return operations;
}

function backupSummary(journal) {
  return { id: journal.operationId, kind: journal.kind, phase: journal.phase, createdAt: journal.createdAt };
}

function backupContentSource(record) {
  if (record.journal.kind === 'archive') return { root: path.join(record.operationRoot, '.candidate'), manifest: record.journal.candidate.content };
  return { root: path.join(record.operationRoot, 'before', 'content'), manifest: record.journal.before.content };
}

async function assertNoReparseTree(root, filesystem) {
  const rootInfo = await filesystem.lstat(root);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw failure('RECOVERY_REQUIRED', '备份目录包含重解析点');
  async function visit(directory) {
    for (const entry of await filesystem.readdir(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      const info = await filesystem.lstat(target);
      if (info.isSymbolicLink()) throw failure('RECOVERY_REQUIRED', '备份目录包含重解析点');
      if (info.isDirectory()) await visit(target);
      else if (!info.isFile()) throw failure('RECOVERY_REQUIRED', '备份目录包含不支持的条目');
    }
  }
  await visit(root);
}

function removeTreeImmediately({ projectRoot, operationRoot, synchronousFilesystem }) {
  const projectInfo = synchronousFilesystem.lstatSync(projectRoot);
  const operationInfo = synchronousFilesystem.lstatSync(operationRoot);
  if (!projectInfo.isDirectory() || projectInfo.isSymbolicLink() || !operationInfo.isDirectory() || operationInfo.isSymbolicLink()) throw failure('RECOVERY_REQUIRED', '备份路径身份已改变');
  const projectReal = synchronousFilesystem.realpathSync(projectRoot);
  const operationReal = synchronousFilesystem.realpathSync(operationRoot);
  const relative = path.relative(projectReal, operationReal);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw failure('RECOVERY_REQUIRED', '备份路径超出项目目录');
  const visit = (directory) => {
    for (const entry of synchronousFilesystem.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      const info = synchronousFilesystem.lstatSync(target);
      if (info.isSymbolicLink()) throw failure('RECOVERY_REQUIRED', '备份目录包含重解析点');
      if (info.isDirectory()) visit(target);
      else if (!info.isFile()) throw failure('RECOVERY_REQUIRED', '备份目录包含不支持的条目');
    }
  };
  visit(operationReal);
  synchronousFilesystem.rmSync(operationReal, { recursive: true });
}

async function applyRetention({ backupRoot, projectRoot, filesystem, synchronousFilesystem, protectedOperationId }) {
  const operations = await editorOperationDirectories(backupRoot, filesystem);
  const valid = operations.filter(({ journal }) => ['complete', 'candidate-failed', 'recovered-old', 'conflict-before-promotion', 'conflict-restored-before-content-promotion', 'conflict-restored-before-dist-promotion'].includes(journal.phase));
  const excess = Math.max(0, valid.length - 20);
  const removable = valid.filter(({ journal }) => journal.operationId !== protectedOperationId);
  for (const { operationRoot, journal } of removable.slice(0, excess)) {
    const root = await filesystem.realpath(backupRoot);
    await assertConfinedPath({ root, relativePath: journal.operationId, mustExist: true, operation: 'delete', filesystem });
    await assertNoReparseTree(operationRoot, filesystem);
    removeTreeImmediately({ projectRoot, operationRoot, synchronousFilesystem });
    await syncDirectory(root, filesystem);
  }
}

function relativeWithin(root, target) {
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw failure('BAD_INPUT', '事务路径超出项目目录');
  return relative.replace(/\\/g, '/');
}

async function confinedProjectPath(projectRoot, target, mustExist, operation, filesystem) {
  return assertConfinedPath({ root: projectRoot, relativePath: relativeWithin(projectRoot, target), mustExist, operation, filesystem });
}

async function exists(target, filesystem) {
  try { await filesystem.lstat(target); return true; }
  catch (error) { if (error?.code === 'ENOENT') return false; throw error; }
}

async function manifestOrAbsent(target, filesystem) {
  if (!(await exists(target, filesystem))) return undefined;
  return treeManifest(target, filesystem);
}

function sameManifest(actual, expected) {
  return Boolean(actual && expected && actual.hash === expected.hash);
}

async function renameBoundaryWithFilesystem({ projectRoot, source, destination, name, filesystem, confinedFilesystem, failpoint }) {
  await confinedProjectPath(projectRoot, source, true, 'rename', filesystem);
  await confinedProjectPath(projectRoot, destination, false, 'rename', filesystem);
  await failpoint?.(`before-${name}`);
  await confinedFilesystem.rename(relativeWithin(projectRoot, source), relativeWithin(projectRoot, destination));
  const sourceParent = path.dirname(source);
  const destinationParent = path.dirname(destination);
  await syncDirectory(sourceParent, filesystem);
  if (path.resolve(destinationParent) !== path.resolve(sourceParent)) await syncDirectory(destinationParent, filesystem);
  await failpoint?.(`after-${name}`);
}

export function createTransactionService({
  projectRoot,
  contentRoot,
  distRoot,
  backupRoot,
  buildCandidate,
  clock = () => new Date(),
  idFactory,
  failpoint,
  filesystem = nodeFs,
  synchronousFilesystem = nodeFsSync,
}) {
  if (![projectRoot, contentRoot, distRoot, backupRoot].every((value) => typeof value === 'string' && value) || typeof buildCandidate !== 'function') {
    throw failure('BAD_INPUT', '事务服务配置无效');
  }
  if (failpoint !== undefined && typeof failpoint !== 'function') throw failure('BAD_INPUT', '故障注入配置无效');
  if (failpoint) {
    const injected = failpoint;
    failpoint = async (...args) => {
      try { return await injected(...args); }
      catch (error) {
        if (error && typeof error === 'object') Object.defineProperty(error, 'editorInjectedFailpoint', { value: true });
        throw error;
      }
    };
  }
  const resolvedProjectRoot = path.resolve(projectRoot);
  for (const target of [contentRoot, distRoot, backupRoot]) {
    const relative = path.relative(resolvedProjectRoot, path.resolve(target));
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw failure('BAD_INPUT', '事务根目录超出项目目录');
  }
  async function assertFixedRoots({ allowMissingCanonical = false } = {}) {
    for (const target of [contentRoot, distRoot, backupRoot]) {
      await assertConfinedPath({
        root: resolvedProjectRoot,
        relativePath: relativeWithin(resolvedProjectRoot, path.resolve(target)),
        mustExist: target === backupRoot || !allowMissingCanonical,
        operation: 'walker',
        filesystem,
      });
    }
  }
  const confinedFilesystem = createConfinedFileSystem({ root: resolvedProjectRoot, filesystem, synchronousFilesystem });
  const renameBoundary = (options) => renameBoundaryWithFilesystem({ ...options, confinedFilesystem });
  async function allocateOperationRoot() {
    const now = clock();
    if (idFactory) {
      const identity = operationIdOf(now, idFactory);
      return { ...identity, operationRoot: await createOperationRoot(backupRoot, identity.operationId, filesystem) };
    }
    for (let sequence = 1; sequence <= 9999; sequence += 1) {
      const identity = operationIdOf(now, undefined, sequence);
      try { return { ...identity, operationRoot: await createOperationRoot(backupRoot, identity.operationId, filesystem) }; }
      catch (error) { if (error?.code !== 'EEXIST') throw error; }
    }
    throw failure('INTERNAL_ERROR', '操作标识空间已耗尽');
  }
  async function withLease(action, { allowMissingCanonical = false } = {}) {
    await assertFixedRoots({ allowMissingCanonical });
    const lease = await acquireOperationLock({
      backupRoot,
      ownerNonce: randomBytes(16).toString('hex'),
      pid: process.pid,
      startedAt: new Date().toISOString(),
      filesystem,
    });
    try { await assertFixedRoots({ allowMissingCanonical }); return await action(); } finally { await lease.release(); }
  }

  let recoveryOnly = false;
  const confirmations = new Map();

  function assertWritable() {
    if (recoveryOnly) throw failure('RECOVERY_REQUIRED', '检测到无法自动恢复的编辑记录，请保留现场并人工检查。');
  }

  async function assertPersistentWritable() {
    assertWritable();
    let operations;
    try { operations = await editorOperationDirectories(backupRoot, filesystem); }
    catch {
      recoveryOnly = true;
      throw failure('RECOVERY_REQUIRED', '检测到无法自动恢复的编辑记录，请保留现场并人工检查。');
    }
    try { for (const { operationRoot } of operations) await assertNoReparseTree(operationRoot, filesystem); }
    catch {
      recoveryOnly = true;
      throw failure('RECOVERY_REQUIRED', '检测到无法自动恢复的编辑记录，请保留现场并人工检查。');
    }
    if (operations.some(({ journal }) => !WRITABLE_TERMINAL_PHASES.has(journal.phase))) {
      recoveryOnly = true;
      throw failure('RECOVERY_REQUIRED', '检测到无法自动恢复的编辑记录，请保留现场并人工检查。');
    }
  }

  async function withMutationLease(action) {
    if (typeof action !== 'function') throw failure('BAD_INPUT', '编辑事务操作无效');
    return withLease(async () => {
      await assertPersistentWritable();
      return action();
    });
  }

  async function retainBackups(protectedOperationId) {
    try { await applyRetention({ backupRoot, projectRoot: resolvedProjectRoot, filesystem, synchronousFilesystem, protectedOperationId }); }
    catch {
      recoveryOnly = true;
      throw failure('RECOVERY_REQUIRED', '检测到无法自动恢复的编辑记录，请保留现场并人工检查。');
    }
  }

  function issueConfirmation({ sessionId, action, targetId, diffHash, draftHash, canonicalManifestHash, now }) {
    if (!/^[a-f0-9]{32}$/.test(sessionId ?? '') || !['restore', 'conflict'].includes(action) || !OPERATION_ID.test(targetId ?? '') || ![diffHash, draftHash, canonicalManifestHash].every((value) => SHA256.test(value ?? '')) || !(now instanceof Date) || Number.isNaN(now.valueOf())) throw failure('BAD_INPUT', '确认请求无效');
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(now.valueOf() + 5 * 60 * 1000).toISOString();
    confirmations.set(token, { sessionId, action, targetId, diffHash, draftHash, canonicalManifestHash, expiresAt });
    return { token, expiresAt };
  }

  function consumeConfirmation({ token, sessionId, action, targetId }) {
    if (!/^[a-f0-9]{64}$/.test(token ?? '')) throw failure('FORBIDDEN', '确认记录无效');
    const record = confirmations.get(token);
    if (!record || record.sessionId !== sessionId || record.action !== action || record.targetId !== targetId) throw failure('FORBIDDEN', '确认记录不匹配');
    if (clock().valueOf() > new Date(record.expiresAt).valueOf()) {
      confirmations.delete(token);
      throw failure('FORBIDDEN', '确认记录已过期');
    }
    confirmations.delete(token);
    const { expiresAt, ...result } = record;
    return result;
  }

  function confirmationToken(value) {
    if (typeof value === 'string') return value;
    if (value && typeof value === 'object' && !Array.isArray(value)) return value.token;
    return undefined;
  }

  async function persistManualRecovery(operationRoot, journal) {
    recoveryOnly = true;
    journal.phase = 'manual-recovery-required';
    try { await writeJournal(operationRoot, journal, filesystem, failpoint); }
    catch { /* The in-memory gate remains closed; restart will prove or refuse the retained state. */ }
  }

  async function promoteCandidate({ operationRoot, journal, before, candidateContentRoot, candidateDistRoot, desired }) {
    let promotionStarted = false;
    try {
      const immediatelyBefore = { content: await treeManifest(contentRoot, filesystem), dist: await treeManifest(distRoot, filesystem) };
      if (immediatelyBefore.content.hash !== before.content.hash || immediatelyBefore.dist.hash !== before.dist.hash) {
        journal.phase = 'conflict-before-promotion';
        await writeJournal(operationRoot, journal, filesystem, failpoint);
        throw failure('CONFLICT', '规范内容在推广前已改变', { diff: fileDiff(immediatelyBefore.content, desired) });
      }
      const operationDevice = (await filesystem.stat(operationRoot)).dev;
      for (const target of [contentRoot, distRoot, candidateContentRoot, candidateDistRoot]) {
        if ((await filesystem.stat(target)).dev !== operationDevice) throw failure('CROSS_VOLUME', '候选目录与规范目录不在同一卷');
      }
      const beforeRoot = path.join(operationRoot, 'before');
      await confinedProjectPath(projectRoot, beforeRoot, false, 'copy', filesystem);
      await filesystem.mkdir(beforeRoot);
      await syncDirectory(operationRoot, filesystem);
      const beforeContentRoot = path.join(beforeRoot, 'content');
      const beforeDistRoot = path.join(beforeRoot, 'dist');

      promotionStarted = true;
      journal.phase = 'before-old-content-rename';
      await writeJournal(operationRoot, journal, filesystem, failpoint);
      await renameBoundary({ projectRoot, source: contentRoot, destination: beforeContentRoot, name: 'old-content-rename', filesystem, failpoint });
      journal.phase = 'old-content-renamed';
      await writeJournal(operationRoot, journal, filesystem, failpoint);
      const movedContent = await treeManifest(beforeContentRoot, filesystem);
      if (movedContent.hash !== before.content.hash) {
        if (!(await exists(contentRoot, filesystem))) {
          journal.conflict = { content: movedContent };
          journal.phase = 'before-conflict-content-restore';
          await writeJournal(operationRoot, journal, filesystem, failpoint);
          await renameBoundary({ projectRoot, source: beforeContentRoot, destination: contentRoot, name: 'old-content-restore', filesystem, failpoint });
          journal.phase = 'conflict-restored-before-content-promotion';
          await writeJournal(operationRoot, journal, filesystem, failpoint);
          throw failure('CONFLICT', '规范内容在移动期间已改变');
        }
        await persistManualRecovery(operationRoot, journal);
        throw failure('RECOVERY_REQUIRED', '检测到无法自动恢复的编辑记录，请保留现场并人工检查。');
      }

      journal.phase = 'before-new-content-promotion';
      await writeJournal(operationRoot, journal, filesystem, failpoint);
      if (await exists(contentRoot, filesystem)) {
        await persistManualRecovery(operationRoot, journal);
        throw failure('RECOVERY_REQUIRED', '检测到无法自动恢复的编辑记录，请保留现场并人工检查。');
      }
      await renameBoundary({ projectRoot, source: candidateContentRoot, destination: contentRoot, name: 'new-content-promotion', filesystem, failpoint });
      journal.phase = 'new-content-promoted';
      await writeJournal(operationRoot, journal, filesystem, failpoint);

      journal.phase = 'before-old-dist-rename';
      await writeJournal(operationRoot, journal, filesystem, failpoint);
      await renameBoundary({ projectRoot, source: distRoot, destination: beforeDistRoot, name: 'old-dist-rename', filesystem, failpoint });
      journal.phase = 'old-dist-renamed';
      await writeJournal(operationRoot, journal, filesystem, failpoint);
      const movedDist = await treeManifest(beforeDistRoot, filesystem);
      if (movedDist.hash !== before.dist.hash) {
        if (await exists(distRoot, filesystem)) {
          await persistManualRecovery(operationRoot, journal);
          throw failure('RECOVERY_REQUIRED', '检测到无法自动恢复的编辑记录，请保留现场并人工检查。');
        }
        journal.conflict = { dist: movedDist };
        journal.phase = 'before-conflict-new-content-rollback'; await writeJournal(operationRoot, journal, filesystem, failpoint);
        await renameBoundary({ projectRoot, source: contentRoot, destination: candidateContentRoot, name: 'conflict-new-content-rollback', filesystem, failpoint });
        journal.phase = 'conflict-new-content-rolled-back'; await writeJournal(operationRoot, journal, filesystem, failpoint);
        journal.phase = 'before-conflict-old-content-restore'; await writeJournal(operationRoot, journal, filesystem, failpoint);
        await renameBoundary({ projectRoot, source: beforeContentRoot, destination: contentRoot, name: 'conflict-old-content-restore', filesystem, failpoint });
        journal.phase = 'conflict-old-content-restored'; await writeJournal(operationRoot, journal, filesystem, failpoint);
        journal.phase = 'before-conflict-dist-restore'; await writeJournal(operationRoot, journal, filesystem, failpoint);
        await renameBoundary({ projectRoot, source: beforeDistRoot, destination: distRoot, name: 'conflict-dist-restore', filesystem, failpoint });
        journal.phase = 'conflict-restored-before-dist-promotion'; await writeJournal(operationRoot, journal, filesystem, failpoint);
        throw failure('CONFLICT', '规范输出在移动期间已改变');
      }
      if (await exists(distRoot, filesystem)) {
        await persistManualRecovery(operationRoot, journal);
        throw failure('RECOVERY_REQUIRED', '检测到无法自动恢复的编辑记录，请保留现场并人工检查。');
      }

      journal.phase = 'before-new-dist-promotion';
      await writeJournal(operationRoot, journal, filesystem, failpoint);
      await renameBoundary({ projectRoot, source: candidateDistRoot, destination: distRoot, name: 'new-dist-promotion', filesystem, failpoint });
      journal.phase = 'new-dist-promoted';
      await writeJournal(operationRoot, journal, filesystem, failpoint);
      const promoted = { content: await treeManifest(contentRoot, filesystem), dist: await treeManifest(distRoot, filesystem) };
      if (promoted.content.hash !== journal.candidate.content.hash || promoted.dist.hash !== journal.candidate.dist.hash) {
        await persistManualRecovery(operationRoot, journal);
        throw failure('RECOVERY_REQUIRED', '检测到无法自动恢复的编辑记录，请保留现场并人工检查。');
      }
      journal.phase = 'complete';
      await writeJournal(operationRoot, journal, filesystem, failpoint);
      return promoted;
    } catch (error) {
      if (error?.editorInjectedFailpoint || error?.code === 'CONFLICT' || error?.code === 'RECOVERY_REQUIRED' || !promotionStarted) throw error;
      await persistManualRecovery(operationRoot, journal);
      throw failure('RECOVERY_REQUIRED', '检测到无法自动恢复的编辑记录，请保留现场并人工检查。');
    }
  }

  return {
    issueConfirmation,
    consumeConfirmation,
    runMutation: withMutationLease,
    async save(input) {
      return withMutationLease(async () => {
        assertSaveInput(input ?? {});
        assertCandidateInput(input);
        const desired = bundleFileHashes(input.bundle, input.uploads);
        try {
          await validateImageBindings({ contentRoot, bundle: input.bundle, uploads: input.uploads, filesystem });
        } catch (error) {
          if (error?.code === 'CONFLICT' && !error.confirmationContext) {
            const current = await treeManifest(contentRoot, filesystem);
            const context = conflictContext({ current, desired, bundle: input.bundle });
            Object.assign(error, { diff: context.diff, confirmationContext: context });
          }
          throw error;
        }
        const before = { content: await treeManifest(contentRoot, filesystem), dist: await treeManifest(distRoot, filesystem) };
        const context = conflictContext({ current: before.content, desired, bundle: input.bundle });
        if (input.conflictResolutionToken) {
          const confirmed = consumeConfirmation({ token: confirmationToken(input.conflictResolutionToken), sessionId: input.sessionId, action: 'conflict', targetId: context.targetId });
          if (confirmed.diffHash !== context.diffHash || confirmed.draftHash !== context.draftHash || confirmed.canonicalManifestHash !== context.canonicalManifestHash) {
            throw failure('CONFLICT', '确认后的内容已改变', { diff: context.diff, confirmationContext: context });
          }
        } else if (before.content.compatibilityHash !== input.baseManifestHash) {
          throw failure('CONFLICT', '规范内容已改变', { diff: context.diff, confirmationContext: context });
        }
        const { operationId, createdAt, operationRoot } = await allocateOperationRoot();
        const journal = { formatVersion: 1, operationId, kind: 'save', createdAt, phase: 'preparing-candidate', baseManifestHash: input.baseManifestHash, before, candidate: {} };
        await writeJournal(operationRoot, journal, filesystem, failpoint);
        let candidateContentRoot;
        const candidateDistRoot = path.join(operationRoot, 'candidate-dist');
        try {
          candidateContentRoot = await materialiseBundle({ operationRoot, contentRoot, bundle: input.bundle, uploads: input.uploads, filesystem });
          await filesystem.mkdir(candidateDistRoot);
          await buildCandidate({ projectRoot, operationRoot, contentRoot: candidateContentRoot, distRoot: candidateDistRoot });
          journal.candidate = { content: await treeManifest(candidateContentRoot, filesystem), dist: await treeManifest(candidateDistRoot, filesystem) };
          journal.phase = 'candidate-built';
          await writeJournal(operationRoot, journal, filesystem, failpoint);
        } catch (error) {
          journal.phase = 'candidate-failed';
          journal.diagnostic = { code: 'CANDIDATE_BUILD_FAILED' };
          await writeJournal(operationRoot, journal, filesystem, failpoint);
          await retainBackups();
          throw failure('CANDIDATE_BUILD_FAILED', '候选构建失败');
        }

        let promoted;
        try {
          promoted = await promoteCandidate({ operationRoot, journal, before, candidateContentRoot, candidateDistRoot, desired });
        } catch (error) {
          if (error?.code === 'CONFLICT' && !error.confirmationContext) {
            const current = await treeManifest(contentRoot, filesystem);
            const context = conflictContext({ current, desired, bundle: input.bundle });
            Object.assign(error, { diff: context.diff, confirmationContext: context });
          }
          throw error;
        }
        await retainBackups();
        return { ok: true, operationId, manifestHash: promoted.content.compatibilityHash };
      });
    },
    async archiveDraft(input) {
      return withMutationLease(async () => {
        assertSaveInput(input ?? {});
        assertCandidateInput(input);
        await validateImageBindings({ contentRoot, bundle: input.bundle, uploads: input.uploads, filesystem });
        const before = { content: await treeManifest(contentRoot, filesystem), dist: await treeManifest(distRoot, filesystem) };
        const { operationId, createdAt, operationRoot } = await allocateOperationRoot();
        const journal = { formatVersion: 1, operationId, kind: 'archive', createdAt, phase: 'preparing-candidate', baseManifestHash: input.baseManifestHash, before, candidate: {} };
        await writeJournal(operationRoot, journal, filesystem, failpoint);
        const candidateContentRoot = await materialiseBundle({ operationRoot, contentRoot, bundle: input.bundle, uploads: input.uploads, filesystem });
        journal.candidate = { content: await treeManifest(candidateContentRoot, filesystem), dist: before.dist };
        journal.phase = 'complete';
        await writeJournal(operationRoot, journal, filesystem, failpoint);
        await retainBackups();
        return backupSummary(journal);
      });
    },
    async listBackups() {
      return withLease(async () => (await editorOperationDirectories(backupRoot, filesystem)).map(({ journal }) => backupSummary(journal)));
    },
    async diffBackup(id, { sessionId } = {}) {
      if (!OPERATION_ID.test(id ?? '') || !/^[a-f0-9]{32}$/.test(sessionId ?? '')) throw failure('BAD_INPUT', '备份标识无效');
      return withLease(async () => {
        const record = (await editorOperationDirectories(backupRoot, filesystem)).find(({ journal }) => journal.operationId === id);
        if (!record || record.journal.phase !== 'complete') throw failure('NOT_FOUND', '备份不存在');
        const source = backupContentSource(record);
        const candidate = await treeManifest(source.root, filesystem);
        if (!sameManifest(candidate, source.manifest)) throw failure('RECOVERY_REQUIRED', '备份内容哈希不一致');
        const canonical = await treeManifest(contentRoot, filesystem);
        const desired = hashesFromManifest(candidate);
        const diff = fileDiff(canonical, desired);
        const diffHash = hashJson(diff);
        const draftHash = candidate.hash;
        const confirmation = issueConfirmation({ sessionId, action: 'restore', targetId: id, diffHash, draftHash, canonicalManifestHash: canonical.hash, now: clock() });
        return { id, diff, diffHash, draftHash, canonicalManifestHash: canonical.hash, confirmation };
      });
    },
    async restore(input = {}) {
      return withMutationLease(async () => {
        if (!OPERATION_ID.test(input.id ?? '') || !/^[a-f0-9]{32}$/.test(input.sessionId ?? '') || !confirmationToken(input.confirmationToken)) throw failure('BAD_INPUT', '恢复请求无效');
        const record = (await editorOperationDirectories(backupRoot, filesystem)).find(({ journal }) => journal.operationId === input.id);
        if (!record || record.journal.phase !== 'complete') throw failure('NOT_FOUND', '备份不存在');
        const confirmation = consumeConfirmation({ token: confirmationToken(input.confirmationToken), sessionId: input.sessionId, action: 'restore', targetId: input.id });
        const current = { content: await treeManifest(contentRoot, filesystem), dist: await treeManifest(distRoot, filesystem) };
        const source = backupContentSource(record);
        const sourceRoot = source.root;
        const sourceManifest = await treeManifest(sourceRoot, filesystem);
        if (!sameManifest(sourceManifest, source.manifest)) throw failure('RECOVERY_REQUIRED', '备份内容哈希不一致');
        if (current.content.hash !== confirmation.canonicalManifestHash || sourceManifest.hash !== confirmation.draftHash || hashJson(fileDiff(current.content, hashesFromManifest(sourceManifest))) !== confirmation.diffHash) throw failure('CONFLICT', '确认后的内容已改变');
        const { operationId, createdAt, operationRoot } = await allocateOperationRoot();
        const candidateContentRoot = path.join(operationRoot, '.candidate');
        await copyTree({ projectRoot, sourceRoot, destinationRoot: candidateContentRoot, filesystem });
        const candidateDistRoot = path.join(operationRoot, 'candidate-dist');
        await filesystem.mkdir(candidateDistRoot);
        const journal = { formatVersion: 1, operationId, kind: 'restore', sourceBackupId: input.id, createdAt, phase: 'preparing-candidate', baseManifestHash: current.content.compatibilityHash, before: current, candidate: {} };
        await writeJournal(operationRoot, journal, filesystem, failpoint);
        try {
          await loadSiteRepository({ contentRoot: candidateContentRoot });
          await buildCandidate({ projectRoot, operationRoot, contentRoot: candidateContentRoot, distRoot: candidateDistRoot });
          journal.candidate = { content: await treeManifest(candidateContentRoot, filesystem), dist: await treeManifest(candidateDistRoot, filesystem) };
          journal.phase = 'candidate-built';
          await writeJournal(operationRoot, journal, filesystem, failpoint);
        } catch {
          journal.phase = 'candidate-failed'; journal.diagnostic = { code: 'CANDIDATE_BUILD_FAILED' };
          await writeJournal(operationRoot, journal, filesystem, failpoint); await retainBackups(input.id);
          throw failure('CANDIDATE_BUILD_FAILED', '候选构建失败');
        }
        const promoted = await promoteCandidate({
          operationRoot,
          journal,
          before: current,
          candidateContentRoot,
          candidateDistRoot,
          desired: hashesFromManifest(journal.candidate.content),
        });
        await retainBackups(input.id);
        return { ok: true, operationId, manifestHash: promoted.content.compatibilityHash };
      });
    },
    async recoverIncompleteTransactions() {
      return withLease(async () => {
        const results = [];
        let operations;
        try { operations = await editorOperationDirectories(backupRoot, filesystem); }
        catch (error) {
          recoveryOnly = true;
          throw failure('RECOVERY_REQUIRED', '检测到无法自动恢复的编辑记录，请保留现场并人工检查。');
        }
        const startupBlockers = [];
        for (const record of operations) {
          const { operationRoot, journal } = record;
          try { await assertNoReparseTree(operationRoot, filesystem); }
          catch {
            startupBlockers.push({ operationId: journal.operationId, status: 'unproven' });
            continue;
          }
          if (journal.phase === 'manual-recovery-required') {
            startupBlockers.push({ operationId: journal.operationId, status: 'manual-recovery-required' });
            continue;
          }
          if (journal.phase !== 'complete') continue;
          try {
            const source = backupContentSource(record);
            if (!sameManifest(await manifestOrAbsent(source.root, filesystem), source.manifest)) throw new Error('backup source mismatch');
            if (journal.kind !== 'archive') {
              const beforeDistRoot = path.join(operationRoot, 'before', 'dist');
              if (!sameManifest(await manifestOrAbsent(beforeDistRoot, filesystem), journal.before.dist)) throw new Error('backup dist mismatch');
            }
          } catch {
            startupBlockers.push({ operationId: journal.operationId, status: 'unproven' });
          }
        }
        if (startupBlockers.length > 0) {
          recoveryOnly = true;
          return startupBlockers;
        }
        const incomplete = operations.filter(({ journal }) => !WRITABLE_TERMINAL_PHASES.has(journal.phase));
        if (incomplete.length > 1) {
          recoveryOnly = true;
          return incomplete.map(({ journal }) => ({ operationId: journal.operationId, status: 'unproven' }));
        }
        for (const { operationRoot, journal } of operations) {
          if (journal.phase === 'complete' || journal.phase === 'candidate-failed' || journal.phase === 'conflict-before-promotion' || journal.phase === 'conflict-restored-before-content-promotion' || journal.phase === 'conflict-restored-before-dist-promotion' || journal.phase === 'recovered-old') continue;
          if (journal.kind === 'archive' && journal.phase === 'preparing-candidate') {
            const current = { content: await manifestOrAbsent(contentRoot, filesystem), dist: await manifestOrAbsent(distRoot, filesystem) };
            if (!sameManifest(current.content, journal.before.content) || !sameManifest(current.dist, journal.before.dist)) {
              recoveryOnly = true;
              results.push({ operationId: journal.operationId, status: 'unproven' });
              continue;
            }
            journal.phase = 'candidate-failed';
            journal.diagnostic = { code: 'ARCHIVE_INTERRUPTED' };
            await writeJournal(operationRoot, journal, filesystem, failpoint);
            results.push({ operationId: journal.operationId, status: 'candidate-failed' });
            continue;
          }
          const beforeContentRoot = path.join(operationRoot, 'before', 'content');
          const beforeDistRoot = path.join(operationRoot, 'before', 'dist');
          const candidateContentRoot = path.join(operationRoot, '.candidate');
          const candidateDistRoot = path.join(operationRoot, 'candidate-dist');
          const state = {
            content: await manifestOrAbsent(contentRoot, filesystem), beforeContent: await manifestOrAbsent(beforeContentRoot, filesystem), candidateContent: await manifestOrAbsent(candidateContentRoot, filesystem),
            dist: await manifestOrAbsent(distRoot, filesystem), beforeDist: await manifestOrAbsent(beforeDistRoot, filesystem), candidateDist: await manifestOrAbsent(candidateDistRoot, filesystem),
          };
          if (journal.conflict?.content) {
            if (sameManifest(state.beforeContent, journal.conflict.content) && !state.content) await renameBoundary({ projectRoot, source: beforeContentRoot, destination: contentRoot, name: 'recovery-conflict-content', filesystem, failpoint });
            else if (!sameManifest(state.content, journal.conflict.content)) { recoveryOnly = true; results.push({ operationId: journal.operationId, status: 'unproven' }); continue; }
            journal.phase = 'conflict-restored-before-content-promotion'; await writeJournal(operationRoot, journal, filesystem, failpoint);
            results.push({ operationId: journal.operationId, status: 'conflict-restored-before-content-promotion' });
            continue;
          }
          if (journal.conflict?.dist) {
            const contentKnown = [state.content, state.beforeContent, state.candidateContent].filter(Boolean).every((value) => sameManifest(value, journal.before.content) || sameManifest(value, journal.candidate.content));
            const distKnown = [state.dist, state.beforeDist, state.candidateDist].filter(Boolean).every((value) => sameManifest(value, journal.conflict.dist) || sameManifest(value, journal.candidate.dist));
            const contentGenerationsEqual = journal.before.content.hash === journal.candidate.content.hash;
            const canonicalIsOld = sameManifest(state.content, journal.before.content);
            const canonicalIsCandidate = sameManifest(state.content, journal.candidate.content);
            const beforeHasOld = sameManifest(state.beforeContent, journal.before.content);
            const candidateHasCandidate = sameManifest(state.candidateContent, journal.candidate.content);
            let moveCandidateContent = false;
            let restoreOldContent = false;
            let contentProven = false;
            if (contentGenerationsEqual) {
              const presentLocations = [state.content, state.beforeContent, state.candidateContent].filter(Boolean).length;
              const initial = canonicalIsOld && beforeHasOld && !state.candidateContent;
              const candidateRolledBack = !state.content && beforeHasOld && candidateHasCandidate;
              const oldRestored = canonicalIsOld && !state.beforeContent && candidateHasCandidate;
              contentProven = contentKnown && presentLocations === 2 && (initial || candidateRolledBack || oldRestored);
              restoreOldContent = candidateRolledBack;
            } else {
              const initial = canonicalIsCandidate && beforeHasOld && !state.candidateContent;
              const candidateRolledBack = !state.content && beforeHasOld && candidateHasCandidate;
              const oldRestored = canonicalIsOld && !state.beforeContent && candidateHasCandidate;
              contentProven = contentKnown && (initial || candidateRolledBack || oldRestored);
              moveCandidateContent = initial;
              restoreOldContent = initial || candidateRolledBack;
            }
            const canonicalHasConflictDist = sameManifest(state.dist, journal.conflict.dist);
            const beforeHasConflictDist = sameManifest(state.beforeDist, journal.conflict.dist);
            const candidateHasCandidateDist = sameManifest(state.candidateDist, journal.candidate.dist);
            const distProven = distKnown && candidateHasCandidateDist && ((canonicalHasConflictDist && !state.beforeDist) || (!state.dist && beforeHasConflictDist));
            if (!contentProven || !distProven) {
              recoveryOnly = true;
              results.push({ operationId: journal.operationId, status: 'unproven' });
              continue;
            }
            if (moveCandidateContent) await renameBoundary({ projectRoot, source: contentRoot, destination: candidateContentRoot, name: 'recovery-conflict-new-content', filesystem, failpoint });
            if (restoreOldContent) await renameBoundary({ projectRoot, source: beforeContentRoot, destination: contentRoot, name: 'recovery-conflict-old-content', filesystem, failpoint });
            if (!state.dist) await renameBoundary({ projectRoot, source: beforeDistRoot, destination: distRoot, name: 'recovery-conflict-dist', filesystem, failpoint });
            journal.phase = 'conflict-restored-before-dist-promotion'; await writeJournal(operationRoot, journal, filesystem, failpoint);
            results.push({ operationId: journal.operationId, status: 'conflict-restored-before-dist-promotion' });
            continue;
          }
          const contentOldLocations = [sameManifest(state.content, journal.before.content), sameManifest(state.beforeContent, journal.before.content)].filter(Boolean).length;
          const contentNewLocations = [sameManifest(state.content, journal.candidate.content), sameManifest(state.candidateContent, journal.candidate.content)].filter(Boolean).length;
          const distOldLocations = [sameManifest(state.dist, journal.before.dist), sameManifest(state.beforeDist, journal.before.dist)].filter(Boolean).length;
          const distNewLocations = [sameManifest(state.dist, journal.candidate.dist), sameManifest(state.candidateDist, journal.candidate.dist)].filter(Boolean).length;
          const contentKnown = [state.content, state.beforeContent, state.candidateContent].filter(Boolean).every((value) => sameManifest(value, journal.before.content) || sameManifest(value, journal.candidate.content));
          const distKnown = [state.dist, state.beforeDist, state.candidateDist].filter(Boolean).every((value) => sameManifest(value, journal.before.dist) || sameManifest(value, journal.candidate.dist));
          if (contentOldLocations !== 1 || contentNewLocations !== 1 || distOldLocations !== 1 || distNewLocations !== 1 || !contentKnown || !distKnown) {
            recoveryOnly = true;
            results.push({ operationId: journal.operationId, status: 'unproven' });
            continue;
          }
          if (sameManifest(state.content, journal.candidate.content)) {
            await renameBoundary({ projectRoot, source: contentRoot, destination: candidateContentRoot, name: 'recovery-new-content', filesystem, failpoint });
            state.content = undefined;
          }
          if (!state.content) await renameBoundary({ projectRoot, source: beforeContentRoot, destination: contentRoot, name: 'recovery-old-content', filesystem, failpoint });
          if (sameManifest(state.dist, journal.candidate.dist)) {
            await renameBoundary({ projectRoot, source: distRoot, destination: candidateDistRoot, name: 'recovery-new-dist', filesystem, failpoint });
            state.dist = undefined;
          }
          if (!state.dist) await renameBoundary({ projectRoot, source: beforeDistRoot, destination: distRoot, name: 'recovery-old-dist', filesystem, failpoint });
          journal.phase = 'recovered-old';
          await writeJournal(operationRoot, journal, filesystem, failpoint);
          results.push({ operationId: journal.operationId, status: 'recovered-old' });
        }
        return results;
      }, { allowMissingCanonical: true });
    },
    async recoverBeforeListen() {
      let results;
      try { results = await this.recoverIncompleteTransactions(); }
      catch (error) {
        recoveryOnly = true;
        return { ok: false, recoveryOnly: true, messageZh: '检测到无法自动恢复的编辑记录，请保留现场并人工检查。' };
      }
      if (recoveryOnly) return { ok: false, recoveryOnly: true, messageZh: '检测到无法自动恢复的编辑记录，请保留现场并人工检查。' };
      return { ok: true, recoveryOnly: false, results };
    },
    isRecoveryOnly() { return recoveryOnly; },
  };
}
