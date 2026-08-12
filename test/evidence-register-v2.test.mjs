import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { loadProjects } from '../src/lib/content/repository.mjs';
import { loadEvidenceRegister, projectRoot } from './helpers.mjs';

const assetNumericSignal = /\d+(?:\.\d+)?(?:\s*(?:%|kW|MW|kV|V|L(?:\/day)?|GHz|K|dB|km|ppm|°C))?/gi;
const assetConclusionSignal = /\b(?:achieved|deployed|demonstrated|proved|validated|supports?|establishes?|outperformed|improved|reduced|increased)\b/gi;
const assetSignals = (...texts) => [...new Set(texts.flatMap((text) => [...text.matchAll(assetNumericSignal), ...text.matchAll(assetConclusionSignal)].map(({ 0: signal }) => signal.toLowerCase())))].sort();

function visibleAssets(projects) {
  return projects.flatMap((project) => project.sections.flatMap(({ blocks }) => blocks)
    .filter(({ type, hidden }) => type === 'image' && !hidden)
    .map((block) => {
      const match = block.markdown.match(/^!\[([^\]]+)\]\(([^)]+)\)\s*\n+(.+)$/s);
      assert.ok(match, `${project.slug}:${block.id} malformed image block`);
      return { project: project.slug, destination: `src/content/projects/${project.slug}/${match[2].replace(/^\.\//, '')}`, alt: match[1].trim(), caption: match[3].trim() };
    }));
}

function assertAssetSurfaceAgreement(register, selection, projects) {
  const visible = visibleAssets(projects);
  const manifestById = new Map(selection.assets.map((asset) => [asset.id, asset]));
  const registerByDestination = new Map(register.assets.map((asset) => [asset.destination, asset]));
  assert.equal(registerByDestination.size, register.assets.length, 'register destinations must be unique');
  for (const surface of visible) {
    const row = registerByDestination.get(surface.destination);
    assert.ok(row, `${surface.destination} must have an evidence row`);
    assert.equal(row.project, surface.project, `${row.assetId}.project`);
    assert.equal(row.destination, manifestById.get(row.assetId)?.destination, `${row.assetId}.manifest destination`);
    assert.equal(row.alt, surface.alt, `${row.assetId}.alt`);
    assert.equal(row.caption, surface.caption, `${row.assetId}.caption`);
    assert.deepEqual(assetSignals(surface.alt, surface.caption), assetSignals(row.alt, row.caption), `${row.assetId} numeric/conclusion signals`);
  }
  assert.equal(visible.length, register.assets.length, 'every register row must be visible exactly once');
}

test('canonical evidence register has one complete v2 row per visible asset', async () => {
  const [register, projects, selection] = await Promise.all([
    loadEvidenceRegister(),
    loadProjects(),
    readFile(path.join(projectRoot, 'scripts', 'evidence-crops.json'), 'utf8').then(JSON.parse),
  ]);
  const visible = visibleAssets(projects);
  assertAssetSurfaceAgreement(register, selection, projects);
  const idByDestination = new Map(selection.assets.map(({ id, destination }) => [destination, id]));
  const visibleRows = visible.map((asset) => ({ ...asset, assetId: idByDestination.get(asset.destination) }));
  assert.ok(visibleRows.every(({ assetId }) => assetId), 'every visible asset must be in the selection manifest');
  assert.deepEqual(new Set(register.assets.map(({ assetId }) => assetId)), new Set(visibleRows.map(({ assetId }) => assetId)));
  assert.equal(new Set(register.assets.map(({ assetId }) => assetId)).size, register.assets.length);
  assert.equal(new Set(visible.map(({ destination }) => destination.toLowerCase())).size, visible.length);
  const visibleById = new Map(visibleRows.map((asset) => [asset.assetId, asset]));
  for (const asset of register.assets) {
    for (const field of ['assetId', 'project', 'destination', 'alt', 'caption', 'sourceDocumentType', 'cropOrTransformRule', 'factualPurpose', 'ownership', 'limitation', 'outputSha256', 'colourSpace']) {
      assert.equal(typeof asset[field], 'string', `${asset.assetId}.${field}`);
      assert.ok(asset[field].trim(), `${asset.assetId}.${field}`);
    }
    assert.ok(Number.isSafeInteger(asset.width) && asset.width > 0, `${asset.assetId}.width`);
    assert.ok(Number.isSafeInteger(asset.height) && asset.height > 0, `${asset.assetId}.height`);
    assert.deepEqual(asset.metadataKeys, [], `${asset.assetId}.metadataKeys`);
    assert.match(asset.outputSha256, /^[a-f0-9]{64}$/);
    assert.ok((Number.isSafeInteger(asset.physicalPage) && asset.physicalPage > 0) !== (typeof asset.sourceImageName === 'string' && asset.sourceImageName.length > 0), `${asset.assetId} source locator`);
    const visibleAsset = visibleById.get(asset.assetId);
    assert.equal(visibleAsset.project, asset.project, `${asset.assetId}.project`);
    assert.ok(visibleAsset.alt.length >= 40, `${asset.assetId}.alt`);
    assert.ok(visibleAsset.caption.length >= 40, `${asset.assetId}.caption`);
    assert.notEqual(visibleAsset.alt, visibleAsset.caption, `${asset.assetId} alt must describe the visual rather than repeat its caption`);
    assert.doesNotMatch(visibleAsset.alt, /^(?:fig(?:ure)?|table)\b/i, `${asset.assetId}.alt`);
    assert.doesNotMatch(visibleAsset.caption, /^(?:fig(?:ure)?|table)\b/i, `${asset.assetId}.caption`);
    const bytes = await readFile(path.join(projectRoot, ...asset.destination.split('/')));
    const metadata = await sharp(bytes).metadata();
    assert.equal(createHash('sha256').update(bytes).digest('hex'), asset.outputSha256, `${asset.assetId}.outputSha256`);
    assert.equal(metadata.width, asset.width, `${asset.assetId}.width`);
    assert.equal(metadata.height, asset.height, `${asset.assetId}.height`);
    assert.equal(metadata.space, asset.colourSpace, `${asset.assetId}.colourSpace`);
    assert.doesNotMatch(JSON.stringify(asset), /(?:[A-Z]:[\\/]|OneDrive|student number|teammate|group member|assignment instructions|\.pdf\b)/i);
  }
});

test('unsupported numeric or conclusion wording in image alt or caption is rejected by the asset oracle', async () => {
  const [register, projects, selection] = await Promise.all([
    loadEvidenceRegister(),
    loadProjects(),
    readFile(path.join(projectRoot, 'scripts', 'evidence-crops.json'), 'utf8').then(JSON.parse),
  ]);
  const mutated = structuredClone(projects);
  const image = mutated.flatMap(({ sections }) => sections).flatMap(({ blocks }) => blocks).find(({ type, hidden }) => type === 'image' && !hidden);
  image.markdown = image.markdown.replace(/\n[^\n]+$/, '\nPhysical prototype achieved 999 kW.');
  assert.throws(() => assertAssetSurfaceAgreement(register, selection, mutated), /caption/);
});

test('a wrong register destination cannot be reconciled with the manifest and visible Markdown', async () => {
  const [register, projects, selection] = await Promise.all([
    loadEvidenceRegister(), loadProjects(), readFile(path.join(projectRoot, 'scripts', 'evidence-crops.json'), 'utf8').then(JSON.parse),
  ]);
  register.assets[0].destination = register.assets[0].destination.replace(/[^/]+$/, 'wrong.png');
  assert.throws(() => assertAssetSurfaceAgreement(register, selection, projects), /evidence row|destination/);
});
