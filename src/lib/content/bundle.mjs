import { lstat, mkdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { stringify, parse } from 'yaml';
import { serializeProjectFile } from './project-file.mjs';
import { serializeResearchFile } from './research-file.mjs';
import { serializePageFile } from './page-file.mjs';
import { validatePage, validateProject, validateResearch, validateSite } from './schema.mjs';

const slugPattern = /^[a-z][a-z0-9-]{0,62}$/;
const imageSegment = /^[a-zA-Z0-9][a-zA-Z0-9_-]*\.png$/;
const reservedDosDevice = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
export function parseSiteYaml(source) { return parse(source); }
export function serializeSiteYaml(site) { return stringify(site); }
function fail(message) { throw new Error(message); }
function slugOf(value) { if (typeof value !== 'string' || !slugPattern.test(value)) fail('stable slug is required'); return value; }
function windowsDestinationKey(value) {
  if (typeof value !== 'string' || value.includes('\\')) fail('candidate destination is invalid');
  const segments = value.split('/');
  if (!segments.length || segments.some((segment) => !segment || segment === '.' || segment === '..' || /[\x00-\x1f:]/.test(segment) || /[. ]$/.test(segment) || reservedDosDevice.test(segment))) fail('candidate destination is invalid');
  return segments.join('/').toLowerCase();
}
function exactPath(root, destination) {
  windowsDestinationKey(destination);
  const target = path.resolve(root, ...destination.split('/'));
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) fail('candidate path escapes root');
  return target;
}
function imageDestination(value, projectSlugs) {
  if (typeof value !== 'string' || value.includes('\\') || value.includes('%') || value.startsWith('/') || value.includes('..')) fail('logical image destination is invalid');
  const parts = value.split('/');
  const site = parts.length === 2 && parts[0] === 'site-images' && imageSegment.test(parts[1]);
  const project = parts.length === 4 && parts[0] === 'projects' && projectSlugs.has(parts[1]) && parts[2] === 'images' && imageSegment.test(parts[3]);
  if (!site && !project) fail('logical image destination is invalid');
  windowsDestinationKey(value);
  return value;
}
function bytesOf(entry) { if (!(entry?.bytes instanceof Uint8Array)) fail('image bytes are required'); return entry.bytes; }
function uniqueRecords(records, label) {
  const seen = new Set();
  for (const record of records) { const slug = slugOf(record?.slug); if (seen.has(slug)) fail(`duplicate slug in ${label}`); seen.add(slug); }
  return seen;
}
function prepareDraft(draft, uploads) {
  if (!draft || typeof draft !== 'object') fail('candidate draft is required');
  for (const key of ['site', 'about', 'projects', 'research', 'images']) if (!(key in draft)) fail(`candidate draft requires ${key} collection`);
  if (!Array.isArray(draft.projects) || !Array.isArray(draft.research) || !Array.isArray(draft.images) || !Array.isArray(uploads)) fail('candidate collections must be arrays');
  validateSite(draft.site); validatePage(draft.about);
  const projectSlugs = uniqueRecords(draft.projects, 'projects'); uniqueRecords(draft.research, 'research');
  for (const record of draft.projects) { if (record.document?.slug !== undefined && record.document.slug !== record.slug) fail('record document slug must match record slug'); validateProject({ ...record.document, slug: record.slug }); }
  for (const record of draft.research) { validateResearch(record.document); }
  const images = new Map();
  for (const image of draft.images) { const destination = imageDestination(image?.destination, projectSlugs); const key = windowsDestinationKey(destination); if (images.has(key)) fail('duplicate image destination'); images.set(key, { destination, bytes: bytesOf(image) }); }
  const replacement = new Set();
  for (const image of uploads) { const destination = imageDestination(image?.destination, projectSlugs); const key = windowsDestinationKey(destination); if (replacement.has(key)) fail('duplicate image destination'); replacement.add(key); const existing = images.get(key); if (existing && existing.destination !== destination) fail('duplicate image destination'); images.set(key, { destination, bytes: bytesOf(image) }); }
  if (draft.site.avatar.mode === 'image' && !images.has(windowsDestinationKey(draft.site.avatar.src.slice('./'.length)))) fail('image avatar source is missing from candidate images');
  const writes = [
    ['site.yml', stringify(draft.site)], ['pages/about.md', serializePageFile(draft.about)],
    ...draft.projects.map((record) => [`projects/${record.slug}/index.md`, serializeProjectFile({ ...record.document, slug: record.slug })]),
    ...draft.research.map((record) => [`research/${record.slug}.md`, serializeResearchFile(record.document)]),
    ...[...images.values()].map(({ destination, bytes }) => [destination, bytes]),
  ];
  const destinations = new Set(); for (const [destination] of writes) { const key = windowsDestinationKey(destination); if (destinations.has(key)) fail('duplicate candidate destination'); destinations.add(key); }
  return writes;
}
async function assertNewCandidate(root) {
  const rootStat = await lstat(root); if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) fail('operation root is not a real directory');
  const rootReal = await realpath(root); const candidate = exactPath(rootReal, '.candidate');
  try { await lstat(candidate); fail('candidate directory already exists'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  return { rootReal, candidate };
}
export async function writeCandidateBundle({ root, draft, uploads = [] }) {
  const writes = prepareDraft(draft, uploads);
  const { rootReal, candidate } = await assertNewCandidate(root);
  await mkdir(candidate);
  const files = [];
  for (const [destination, content] of writes) { const target = exactPath(candidate, destination); await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, content); files.push(target); }
  return { root: candidate, files: files.map((file) => path.relative(rootReal, file).replace(/\\/g, '/')) };
}
