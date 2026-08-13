import { cp, link, lstat, mkdir, mkdtemp, open, readFile, readdir, realpath, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import YAML from 'yaml';
import { loadProjects } from '../src/lib/content/repository.mjs';

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const distRoot = path.join(projectRoot, 'dist');

export function readDist(relativePath) {
  return readFile(path.join(distRoot, relativePath), 'utf8');
}

export async function readBuiltCss() {
  const assetDir = path.join(distRoot, '_astro');
  const files = await readdir(assetDir);
  const cssFiles = files.filter((file) => file.endsWith('.css'));
  return Promise.all(cssFiles.map((file) => readFile(path.join(assetDir, file), 'utf8')))
    .then((parts) => parts.join('\n'));
}

export async function loadProjectFixture(slug) {
  const projects = await loadProjects();
  const project = projects.find((entry) => entry.slug === slug);
  if (!project) throw new Error(`project fixture not found: ${slug}`);
  return project;
}

export async function readBuiltRoute(route) {
  if (typeof route !== 'string' || !/^\/(?:[a-z0-9-]+\/)*$/.test(route)) {
    throw new Error('built route must be a confined directory route');
  }
  const relative = route === '/' ? 'index.html' : `${route.slice(1)}index.html`;
  const root = await realpath(distRoot);
  const target = path.resolve(root, ...relative.split('/'));
  if (!target.startsWith(`${root}${path.sep}`) && target !== root) throw new Error('built route escapes dist');
  const resolved = await realpath(target);
  if (!resolved.startsWith(`${root}${path.sep}`)) throw new Error('built route escapes dist');
  return readFile(resolved, 'utf8');
}

export async function loadEvidenceRegister() {
  const source = await readFile(path.join(projectRoot, 'docs', 'content-evidence.md'), 'utf8');
  const match = source.match(/<!-- claim-register:start -->\s*```yaml\s*([\s\S]*?)```\s*<!-- claim-register:end -->/);
  if (!match) throw new Error('canonical claim register is missing');
  const value = YAML.parse(match[1]);
  if (!value || value.version !== 1 || !Array.isArray(value.supportedFactClasses) || !Array.isArray(value.claims) || !Array.isArray(value.assets)) throw new Error('canonical claim register is invalid');
  return value;
}

export async function readFixture(relativePath) {
  const fixtureRoot = await realpath(path.join(projectRoot, 'test', 'fixtures', 'content-v2'));
  const target = path.resolve(fixtureRoot, relativePath);
  if (target !== fixtureRoot && !target.startsWith(`${fixtureRoot}${path.sep}`)) {
    throw new Error('Fixture path escapes content-v2');
  }
  return readFile(await realpath(target), 'utf8');
}

export async function withContentCodecWorkspace(run) {
  const parent = await mkdtemp(path.join(projectRoot, '.content-codec-test-'));
  const sentinel = path.join(parent, '.content-codec-sentinel');
  const operationRoot = path.join(parent, 'operation');
  await writeFile(sentinel, 'content-codec-test-sentinel\n');
  await mkdir(operationRoot);
  try {
    return await run({ parent, root: operationRoot, sentinel });
  } finally {
    if (await readFile(sentinel, 'utf8') !== 'content-codec-test-sentinel\n') {
      throw new Error('content codec test workspace sentinel changed');
    }
    await rm(parent, { recursive: true, force: true });
  }
}

export async function copyRepositoryFixture(name) {
  if (!/^[a-z][a-z0-9-]*$/.test(name)) throw new Error('fixture name is invalid');
  const fixtureRoot = await realpath(path.join(projectRoot, 'test', 'fixtures', 'content-v2'));
  const source = await realpath(path.join(fixtureRoot, name));
  if (!source.startsWith(`${fixtureRoot}${path.sep}`)) throw new Error('fixture path escapes content-v2');
  const parent = await mkdtemp(path.join(projectRoot, '.site-repository-test-'));
  const sentinel = path.join(parent, '.site-repository-sentinel');
  const root = path.join(parent, 'content');
  await writeFile(sentinel, 'site-repository-test-sentinel\n');
  await cp(source, root, { recursive: true });
  let cleaned = false;
  return {
    root,
    cleanup: async () => {
      if (cleaned) return;
      cleaned = true;
      if (await readFile(sentinel, 'utf8') !== 'site-repository-test-sentinel\n') {
        throw new Error('site repository test workspace sentinel changed');
      }
      await rm(parent, { recursive: true, force: true });
    },
  };
}

const astroBuildLock = path.join(projectRoot, '.astro-build-test-lock');
const lockVersion = 1;
function lockOwner(source) {
  let value;
  try { value = JSON.parse(source); } catch { throw new Error('malformed build lock'); }
  if (!value || Object.keys(value).length !== 3 || value.version !== lockVersion || !Number.isSafeInteger(value.pid) || value.pid <= 0 || typeof value.token !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.token)) throw new Error('malformed build lock');
  return value;
}
async function claimAndDeleteBuildLock(metadata, claim) {
  try { await rename(astroBuildLock, claim); } catch (error) {
    if (error?.code === 'ENOENT') throw new Error('build lock ownership changed');
    throw error;
  }
  try {
    const entry = await lstat(claim);
    if (!entry.isFile() || entry.isSymbolicLink()) throw new Error('malformed build lock');
    if ((await readFile(claim, 'utf8')) !== metadata) throw new Error('build lock ownership changed');
    await unlink(claim);
  } catch (error) {
    try {
      await link(claim, astroBuildLock);
    } catch (recoveryError) {
      if (recoveryError?.code === 'EEXIST') throw error;
      throw new Error('build lock claim recovery failed; claim preserved', { cause: recoveryError });
    }
    try {
      await unlink(claim);
    } catch (recoveryError) {
      throw new Error('build lock claim recovery failed; claim preserved', { cause: recoveryError });
    }
    throw error;
  }
}
async function recoverDeadBuildLock() {
  const metadata = await readFile(astroBuildLock, 'utf8');
  const owner = lockOwner(metadata);
  try { process.kill(owner.pid, 0); return false; } catch (error) {
    if (error?.code !== 'ESRCH') return false;
  }
  const claim = `${astroBuildLock}.claim-${process.pid}-${randomUUID()}`;
  await claimAndDeleteBuildLock(metadata, claim);
  return true;
}
export async function acquireAstroBuildLock({ timeoutMs = 10_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    try {
      const handle = await open(astroBuildLock, 'wx');
      const owner = { version: lockVersion, pid: process.pid, token: randomUUID() };
      const metadata = `${JSON.stringify(owner)}\n`;
      try {
        await handle.writeFile(metadata);
      } catch (error) {
        await handle.close();
        try { await claimAndDeleteBuildLock(metadata, `${astroBuildLock}.claim-${process.pid}-${owner.token}`); } catch { /* Preserve an unproven replacement or claim. */ }
        throw error;
      }
      await handle.close();
      let released = false;
      return async () => {
        if (released) return;
        const claim = `${astroBuildLock}.claim-${process.pid}-${owner.token}`;
        await claimAndDeleteBuildLock(metadata, claim);
        released = true;
      };
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      if (await recoverDeadBuildLock()) continue;
      if (Date.now() >= deadline) throw new Error('timed out waiting for build lock');
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
}
export async function withAstroBuildLock(run) {
  const release = await acquireAstroBuildLock();
  try {
    return await run();
  } finally {
    await release();
  }
}

export async function createTestWorkspace() {
  const testsRoot = path.join(projectRoot, '.local-editor', 'runtime', 'tests');
  await mkdir(testsRoot, { recursive: true });
  const parent = await mkdtemp(path.join(testsRoot, 'task7-'));
  const sentinel = path.join(parent, '.editor-test-sentinel');
  const root = path.join(parent, 'project');
  await writeFile(sentinel, 'editor-test-workspace-v1\n');
  await mkdir(root);
  await cp(path.join(projectRoot, 'src', 'content'), path.join(root, 'src', 'content'), { recursive: true });
  let cleaned = false;
  return {
    parent,
    root,
    sentinel,
    cleanup: async () => {
      if (cleaned) return;
      const expectedParent = await realpath(parent);
      const expectedTests = await realpath(testsRoot);
      if (!expectedParent.startsWith(`${expectedTests}${path.sep}`)) throw new Error('editor test workspace escapes owned root');
      if (await readFile(sentinel, 'utf8') !== 'editor-test-workspace-v1\n') throw new Error('editor test workspace sentinel changed');
      cleaned = true;
      await rm(expectedParent, { recursive: true, force: true });
    },
  };
}
