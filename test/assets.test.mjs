import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { loadProjects } from '../src/lib/content/repository.mjs';
import { projectRoot } from './helpers.mjs';

const approved = [
  ['life-support-bus-control', 'src/content/projects/life-support-system/images/bus-control.png'],
  ['life-support-environmental-regulation', 'src/content/projects/life-support-system/images/environmental-regulation.png'],
  ['communication-mse-ber', 'src/content/projects/communication-system-modelling/images/mse-ber.png'],
  ['communication-median-window-sensitivity', 'src/content/projects/communication-system-modelling/images/median-window-sensitivity.png'],
  ['habitat-otec-convergence', 'src/content/projects/future-ocean-habitat/images/otec-convergence.png'],
  ['habitat-udc-thermal-loops', 'src/content/projects/future-ocean-habitat/images/udc-thermal-loops.png'],
];
const stale = [
  'communication-channel-capacity.png', 'communication-filter-results.png',
  'future-ocean-habitat-master-system.png', 'future-ocean-habitat-udc-flow.png',
  'life-support-efficiency.png', 'life-support-hvac-control.png',
];
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const metadataChunks = new Set(['eXIf', 'iCCP', 'iTXt', 'tEXt', 'zTXt']);

async function manifestSource() {
  return JSON.parse(await readFile(path.join(projectRoot, 'scripts', 'evidence-crops.json'), 'utf8'));
}

function visibleImages(project) {
  return project.sections.flatMap(({ blocks }) => blocks)
    .filter(({ type, hidden }) => type === 'image' && !hidden)
    .map((block) => {
      const match = block.markdown.match(/^!\[([^\]]+)\]\(([^)]+)\)\s*\n+(.+)$/s);
      assert.ok(match, `${project.slug}:${block.id} requires separate alt, source and caption fields`);
      return { block, alt: match[1].trim(), source: match[2].trim(), caption: match[3].trim() };
    });
}

function chunkTypes(bytes, name) {
  assert.deepEqual(bytes.subarray(0, 8), pngSignature, `${name} is not a PNG`);
  const types = [];
  let offset = 8;
  while (offset < bytes.length) {
    assert.ok(offset + 12 <= bytes.length, `${name} has a truncated PNG chunk`);
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    offset += 12 + length;
    assert.ok(offset <= bytes.length, `${name} has a truncated ${type} chunk`);
    types.push(type);
    if (type === 'IEND') break;
  }
  assert.equal(offset, bytes.length, `${name} has bytes after IEND`);
  return types;
}

test('initial evidence selection is exactly the approved six and all outputs exist', async () => {
  const { parseEvidenceManifest } = await import('../scripts/evidence-crops.mjs');
  const manifest = parseEvidenceManifest(await manifestSource(), { root: projectRoot });
  assert.deepEqual(manifest.assets.map(({ id, destination }) => [id, destination]), approved);
  assert.deepEqual(manifest.assets.find(({ id }) => id === 'habitat-otec-convergence').boxPt, [130, 76, 468, 349], 'reviewed OTEC crop must retain both complete axis titles and units');
  for (const { destination } of manifest.assets) await access(path.join(projectRoot, ...destination.split('/')));
});

test('generic evidence suites derive asset cardinality instead of hard-coding the initial six', async () => {
  const source = await readFile(path.join(projectRoot, 'test', 'project-claims-v2.test.mjs'), 'utf8');
  assert.doesNotMatch(source, /assets\.length\s*,\s*6|assets\.length\s*===?\s*6/);
});

test('evidence manifest rejects invalid variants and unsafe or colliding destinations', async () => {
  const { parseEvidenceManifest } = await import('../scripts/evidence-crops.mjs');
  const source = await manifestSource();
  const reject = (mutate, pattern) => {
    const value = structuredClone(source);
    mutate(value);
    assert.throws(() => parseEvidenceManifest(value, { root: projectRoot }), pattern);
  };
  reject((value) => { value.assets[0].transform = 'auto-orient-and-trim-uniform-white'; }, /unexpected|variant/i);
  reject((value) => { delete value.assets[0].page; }, /missing|page|required/i);
  reject((value) => { value.assets[2].page = 1; }, /unexpected|variant/i);
  reject((value) => { value.assets[0].destination = '../escaped.png'; }, /destination/i);
  reject((value) => { value.assets[0].destination = 'C:/escaped.png'; }, /destination/i);
  reject((value) => { value.assets[1].destination = value.assets[0].destination; }, /collision/i);
  reject((value) => { value.assets[1].destination = value.assets[0].destination.replace('bus-control.png', 'BUS-CONTROL.png'); }, /collision/i);
});

test('legacy public derivatives are absent after replacement', async () => {
  const directory = path.join(projectRoot, 'public', 'assets', 'projects');
  const actual = await readdir(directory);
  assert.deepEqual(actual.filter((name) => stale.includes(name)), []);
});

test('visible project images are confined metadata-free static RGB or RGBA PNGs', async () => {
  for (const project of await loadProjects()) {
    for (const { block, alt, source, caption } of visibleImages(project)) {
      assert.ok(alt, `${project.slug}:${block.id} alt`);
      assert.ok(caption, `${project.slug}:${block.id} caption`);
      assert.doesNotMatch(alt, /^(?:fig(?:ure)?|table)\b/i, `${project.slug}:${block.id} alt`);
      assert.doesNotMatch(caption, /^(?:fig(?:ure)?|table)\b/i, `${project.slug}:${block.id} caption`);
      assert.match(source, /^\.\/images\/[a-z0-9][a-z0-9_-]*\.png$/i);
      const name = source.slice('./images/'.length);
      const file = path.join(projectRoot, 'src', 'content', 'projects', project.slug, 'images', name);
      const bytes = await readFile(file);
      const metadata = await sharp(bytes, { animated: true }).metadata();
      assert.equal(metadata.format, 'png', name);
      assert.equal(metadata.pages ?? 1, 1, `${name} must be static`);
      assert.ok(metadata.channels === 3 || metadata.channels === 4, `${name} must be RGB/RGBA`);
      assert.equal(metadata.space, 'srgb', `${name} colour space`);
      assert.ok(metadata.width >= 400 && metadata.height >= 200, `${name} must remain legible`);
      assert.equal(metadata.hasProfile, false, `${name} must not retain ICC`);
      assert.equal(metadata.exif, undefined, `${name} must not retain EXIF`);
      assert.equal(metadata.xmp, undefined, `${name} must not retain XMP`);
      assert.equal(metadata.iptc, undefined, `${name} must not retain IPTC`);
      assert.deepEqual(chunkTypes(bytes, name).filter((type) => metadataChunks.has(type)), [], `${name} text/profile metadata`);
    }
  }
});
