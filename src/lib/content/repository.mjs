import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSiteYaml } from './bundle.mjs';
import { parsePageFile } from './page-file.mjs';
import { parseProjectFile } from './project-file.mjs';
import { parseResearchFile } from './research-file.mjs';
import { validatePage, validateProject, validateResearch, validateSite } from './schema.mjs';
import { parseAssetName } from './asset-routes.mjs';

const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const slugPattern = /^[a-z][a-z0-9-]{0,62}$/;
const moduleContentRoot = fileURLToPath(new URL('../../content/', import.meta.url));
async function defaultContentRoot() {
  if (process.env.NODE_ENV === 'test' && process.env.TEST_SITE_CONTENT_ROOT) return path.resolve(process.env.TEST_SITE_CONTENT_ROOT);
  try { if ((await stat(moduleContentRoot)).isDirectory()) return moduleContentRoot; } catch { /* Astro prerender bundles this module outside src. */ }
  return path.resolve(process.cwd(), 'src/content');
}

function fail(message) { throw new Error(message); }
async function realDirectory(value, message) {
  const resolved = await realpath(value);
  const stat = await lstat(resolved);
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail(message);
  return resolved;
}
function contained(root, target) {
  const relative = path.relative(root, target);
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative);
}
async function regularFile(root, relative, message) {
  const target = path.resolve(root, ...relative.split('/'));
  if (!contained(root, target)) fail(message);
  let resolved;
  try { resolved = await realpath(target); } catch { fail(message); }
  if (!contained(root, resolved)) fail(message);
  const stat = await lstat(resolved);
  if (!stat.isFile() || stat.isSymbolicLink()) fail(message);
  return resolved;
}
function imageSources(document) {
  return document.sections.flatMap((section) => section.blocks)
    .filter((block) => block.type === 'image')
    .map((block) => (block.markdown.match(/^!\[[^\]]*\]\(([^)]+)\)/m)?.[1]));
}
async function loadProjectImages(root, slug, document) {
  const images = [];
  for (const source of imageSources(document)) {
    let name;
    try { name = parseAssetName(source); } catch { fail('project image must be a content-local PNG'); }
    const sourcePath = await regularFile(root, `projects/${slug}/images/${name}`, 'project image escapes content root');
    const bytes = await readFile(sourcePath);
    if (!bytes.subarray(0, pngSignature.length).equals(pngSignature)) fail('project image is not a PNG');
    const previous = images.find((image) => image.name === name);
    if (!previous) images.push({ kind: 'project', slug, name, relativeSource: source, sourcePath, bytes, sha256: createHash('sha256').update(bytes).digest('hex') });
  }
  return images;
}
async function loadProjectRecords(root) {
  const directory = path.join(root, 'projects');
  try { await lstat(directory); } catch { return []; }
  const records = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isDirectory() || !slugPattern.test(entry.name)) continue;
    const sourcePath = await regularFile(root, `projects/${entry.name}/index.md`, 'project record is invalid');
    const document = parseProjectFile(await readFile(sourcePath, 'utf8'));
    document.slug = entry.name;
    validateProject(document);
    records.push({ slug: entry.name, document, sourcePath, images: await loadProjectImages(root, entry.name, document) });
  }
  return records.sort((a, b) => a.document.frontmatter.order - b.document.frontmatter.order);
}
export async function loadProjects({ contentRoot } = {}) {
  contentRoot ??= await defaultContentRoot();
  const root = await realDirectory(contentRoot instanceof URL ? contentRoot : contentRoot, 'content root is invalid');
  return (await loadProjectRecords(root)).map(({ document }) => document);
}
async function loadResearch(root) {
  const directory = path.join(root, 'research');
  const records = [];
  try {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.md') || !slugPattern.test(entry.name.slice(0, -3))) fail('research layout is invalid');
      const slug = entry.name.slice(0, -3);
      const sourcePath = await regularFile(root, `research/${entry.name}`, 'research record is invalid');
      const document = parseResearchFile(await readFile(sourcePath, 'utf8'));
      validateResearch(document);
      records.push({ slug, document, sourcePath });
    }
  } catch (error) { if (error?.code === 'ENOENT') return []; throw error; }
  return records.sort((a, b) => a.document.frontmatter.order - b.document.frontmatter.order);
}
export async function computeRepositoryManifest(repositoryRoot) {
  const root = await realDirectory(repositoryRoot, 'repository root is invalid');
  const files = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(target);
      else if (entry.isFile()) {
        const resolved = await realpath(target);
        if (!contained(root, resolved)) fail('repository file escapes root');
        files.push(path.relative(root, resolved).replace(/\\/g, '/'));
      } else fail('repository contains unsupported entry');
    }
  }
  await visit(root); files.sort();
  const hash = createHash('sha256');
  for (const file of files) { hash.update(file); hash.update('\0'); hash.update(await readFile(path.join(root, ...file.split('/')))); hash.update('\0'); }
  return { hash: hash.digest('hex'), files };
}
export async function loadSiteRepository({ contentRoot } = {}) {
  contentRoot ??= await defaultContentRoot();
  const root = await realDirectory(contentRoot instanceof URL ? contentRoot : contentRoot, 'content root is invalid');
  const sitePath = await regularFile(root, 'site.yml', 'site configuration is invalid');
  const aboutPath = await regularFile(root, 'pages/about.md', 'about page is invalid');
  const site = parseSiteYaml(await readFile(sitePath, 'utf8'));
  validateSite(site);
  const about = parsePageFile(await readFile(aboutPath, 'utf8'));
  validatePage(about);
  const [projects, research, manifest] = await Promise.all([loadProjectRecords(root), loadResearch(root), computeRepositoryManifest(root)]);
  const images = projects.flatMap((project) => project.images);
  if (site.avatar.mode === 'image') {
    const source = site.avatar.src;
    let name;
    try { name = parseAssetName(source, 'site'); } catch { fail('site avatar must be a content-local PNG'); }
    const sourcePath = await regularFile(root, `site-images/${name}`, 'site avatar escapes content root');
    const bytes = await readFile(sourcePath);
    if (!bytes.subarray(0, pngSignature.length).equals(pngSignature)) fail('site avatar is not a PNG');
    images.push({ kind: 'site', name, relativeSource: source, sourcePath, bytes, sha256: createHash('sha256').update(bytes).digest('hex') });
  }
  return { root, site, about, projects, research, images, manifest };
}
