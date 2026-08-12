import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { projectRoot } from './helpers.mjs';
import {
  convertSourceImage,
  cropRenderedPage,
  generateEvidenceAssets,
  parseEvidenceManifest,
} from '../scripts/evidence-crops.mjs';

const manifestHeader = { formatVersion: 1, coordinateSystem: 'rotated-mediabox-upper-left-points-half-open' };
const destination = (name) => `src/content/projects/sample-project/images/${name}.png`;
const sourceAsset = (id, sourceName, name = id) => ({ id, sourceKind: 'source-image', sourceId: 'shared-images', sourceName, transform: 'auto-orient-and-trim-uniform-white', destination: destination(name) });

async function withWorkspace(run) {
  const runtime = path.join(projectRoot, '.local-editor', 'runtime', 'tests');
  await mkdir(runtime, { recursive: true });
  const root = await mkdtemp(path.join(runtime, 'task5-r1-'));
  const sentinel = path.join(root, '.task5-r1-sentinel');
  await writeFile(sentinel, 'task5-r1\n');
  try { return await run({ root, sentinel }); }
  finally {
    assert.equal(await readFile(sentinel, 'utf8'), 'task5-r1\n');
    assert.ok((await realpath(root)).startsWith(`${await realpath(runtime)}${path.sep}`));
    await rm(root, { recursive: true, force: true });
  }
}

async function png(file, colour) {
  await mkdir(path.dirname(file), { recursive: true });
  await sharp({ create: { width: 24, height: 16, channels: 3, background: colour } }).png().toFile(file);
}

async function fixture(root, assets = [sourceAsset('first-asset', 'shared-a.tif'), sourceAsset('second-asset', 'shared-b.tif')]) {
  const source = path.join(root, 'sources', 'shared.png');
  await png(source, '#224466');
  const manifestPath = path.join(root, 'manifest.json');
  const bindingPath = path.join(root, 'bindings.json');
  await writeFile(manifestPath, JSON.stringify({ ...manifestHeader, assets }));
  await writeFile(bindingPath, JSON.stringify({ 'shared-images': Object.fromEntries(assets.map(({ sourceName }) => [sourceName, source])) }));
  const originals = new Map();
  for (const asset of assets) {
    const output = path.join(root, ...asset.destination.split('/'));
    await png(output, '#aa5500');
    originals.set(asset.destination, await readFile(output));
  }
  return { manifestPath, bindingPath, source, assets, originals };
}

function hashes(root, assets) {
  return Promise.all(assets.map(async ({ destination: relative }) => createHash('sha256').update(await readFile(path.join(root, ...relative.split('/')))).digest('hex')));
}

test('manifest rejects Windows aliases, encoded paths and every non-canonical destination form', () => {
  const valid = { ...manifestHeader, assets: [sourceAsset('safe-asset', 'source.tif', 'safe')] };
  for (const name of ['CON', 'con.png', 'PRN.txt', 'AUX.png', 'NUL.png', 'COM1.png', 'com9.txt', 'LPT1.png', 'lpt9.txt', 'name.', 'name ', 'name:ads', 'name%2e', 'name%3aads']) {
    const value = structuredClone(valid);
    value.assets[0].destination = destination(name).replace(/\.png\.png$/, '.png');
    assert.throws(() => parseEvidenceManifest(value, { root: projectRoot }), /destination/i, name);
  }
  const backslash = String.fromCharCode(92);
  for (const unsafe of ['C:relative.png', ['C:', '/', 'absolute.png'].join(''), [backslash, backslash, 'server', backslash, 'share', backslash, 'a.png'].join(''), [backslash, backslash, '?', backslash, 'C:', backslash, 'a.png'].join(''), '//server/share/a.png', '../a.png']) {
    const value = structuredClone(valid); value.assets[0].destination = unsafe;
    assert.throws(() => parseEvidenceManifest(value, { root: projectRoot }), /destination/i, unsafe);
  }
});

test('direct crop and conversion APIs reject outside and reparse output escapes', async () => withWorkspace(async ({ root }) => {
  const input = path.join(root, 'input.png'); await png(input, '#ffffff');
  await assert.rejects(convertSourceImage({ input, outputRoot: root, destination: '../outside.png', trimBackground: false }), /destination|outside/i);
  await assert.rejects(cropRenderedPage({ input, outputRoot: root, destination: '../crop.png', pageWidthPt: 12, pageHeightPt: 8, boxPt: [0, 0, 2, 2] }), /destination|outside/i);
  const outside = path.join(root, 'outside'); await mkdir(outside);
  const images = path.join(root, 'safe', 'images'); await mkdir(path.dirname(images), { recursive: true });
  await symlink(outside, images, 'junction');
  await assert.rejects(convertSourceImage({ input, outputRoot: root, destination: 'safe/images/result.png', trimBackground: false }), /reparse|symbolic|junction/i);
  await assert.rejects(lstat(path.join(outside, 'result.png')));
}));

test('direct APIs reject caller-controlled roots outside the module worktree before any write', async () => withWorkspace(async ({ root }) => {
  const input = path.join(root, 'input.png'); await png(input, '#ffffff');
  const outsideRoot = path.dirname(projectRoot);
  const blockingFile = path.join(projectRoot, 'package.json');
  const before = await readFile(blockingFile);
  await assert.rejects(
    convertSourceImage({ input, outputRoot: outsideRoot, destination: `${path.basename(projectRoot)}/package.json/result.png`, trimBackground: false }),
    /fixed module worktree boundary/i,
  );
  assert.deepEqual(await readFile(blockingFile), before);
  await assert.rejects(lstat(path.join(blockingFile, 'result.png')));

  const alias = path.join(root, 'outside-root-alias');
  await symlink(outsideRoot, alias, 'junction');
  await assert.rejects(
    cropRenderedPage({ input, outputRoot: alias, destination: `${path.basename(projectRoot)}/package.json/result.png`, pageWidthPt: 12, pageHeightPt: 8, boxPt: [0, 0, 2, 2] }),
    /fixed module worktree boundary/i,
  );
  assert.deepEqual(await readFile(blockingFile), before);
}));

test('direct APIs still accept a real non-reparse output root inside the module worktree', async () => withWorkspace(async ({ root }) => {
  const input = path.join(root, 'input.png'); await png(input, '#ffffff');
  const result = await convertSourceImage({ input, outputRoot: root, destination: 'valid/result.png', trimBackground: false });
  assert.match(result.sha256, /^[a-f0-9]{64}$/);
  assert.equal((await lstat(path.join(root, 'valid', 'result.png'))).isFile(), true);
}));

test('crop uses floor, ceil and inward clamp and returns the exact AssetRecord contract', async () => withWorkspace(async ({ root }) => {
  const input = path.join(root, 'page.png'); await sharp({ create: { width: 100, height: 80, channels: 3, background: '#ffffff' } }).png().toFile(input);
  const record = await cropRenderedPage({ input, outputRoot: root, destination: 'out/crop.png', pageWidthPt: 50, pageHeightPt: 40, boxPt: [-2, 1.2, 60, 10.1] });
  assert.deepEqual(Object.keys(record).sort(), ['colourSpace', 'height', 'metadataKeys', 'sha256', 'width']);
  assert.equal(record.width, 100);
  assert.equal(record.height, 19);
  assert.equal(record.colourSpace, 'srgb');
  assert.deepEqual(record.metadataKeys, []);
  assert.match(record.sha256, /^[a-f0-9]{64}$/);
}));

test('generation rejects a reparse destination and leaves every canonical output unchanged', async () => withWorkspace(async ({ root }) => {
  const data = await fixture(root);
  const before = await hashes(root, data.assets);
  const images = path.join(root, 'src', 'content', 'projects', 'sample-project', 'images');
  const moved = path.join(root, 'canonical-images'); await rename(images, moved); await symlink(moved, images, 'junction');
  await assert.rejects(generateEvidenceAssets({ ...data, root }), /reparse|symbolic|junction/i);
  const after = await Promise.all(data.assets.map(async ({ destination: relative }) => createHash('sha256').update(await readFile(path.join(moved, path.basename(relative)))).digest('hex')));
  assert.deepEqual(after, before);
}));

test('generation snapshots shared sources once and source mutation leaves all canonical outputs unchanged', async () => withWorkspace(async ({ root }) => {
  const data = await fixture(root);
  const before = await hashes(root, data.assets);
  let calls = 0;
  const transformers = { convert: async (options) => {
    const result = await convertSourceImage(options);
    if (++calls === 1) await png(data.source, '#ff0000');
    return result;
  } };
  await assert.rejects(generateEvidenceAssets({ ...data, root, transformers }), /source changed/i);
  assert.deepEqual(await hashes(root, data.assets), before);
}));

test('later asset failure leaves all canonical outputs unchanged', async () => withWorkspace(async ({ root }) => {
  const data = await fixture(root);
  const before = await hashes(root, data.assets);
  let calls = 0;
  const transformers = { convert: async (options) => {
    if (++calls === 2) throw new Error('injected later asset failure');
    return convertSourceImage(options);
  } };
  await assert.rejects(generateEvidenceAssets({ ...data, root, transformers }), /later asset failure/);
  assert.deepEqual(await hashes(root, data.assets), before);
}));

test('promotion failure rolls every canonical output back byte-identically', async () => withWorkspace(async ({ root }) => {
  const data = await fixture(root);
  const before = await hashes(root, data.assets);
  let promotions = 0;
  const fileOps = { rename: async (from, to) => {
    if (from.includes(`${path.sep}candidates${path.sep}`) && ++promotions === 2) throw new Error('injected promotion failure');
    return rename(from, to);
  } };
  await assert.rejects(generateEvidenceAssets({ ...data, root, fileOps }), /promotion failure/);
  assert.deepEqual(await hashes(root, data.assets), before);
}));

test('successful generation promotes every candidate as one complete set', async () => withWorkspace(async ({ root }) => {
  const data = await fixture(root);
  const before = await hashes(root, data.assets);
  const result = await generateEvidenceAssets({ ...data, root });
  const after = await hashes(root, data.assets);
  assert.equal(result.assets.length, data.assets.length);
  assert.ok(after.every((hash, index) => hash !== before[index]));
  assert.deepEqual(after, result.assets.map(({ sha256 }) => sha256));
}));

test('a generator mutation cannot bypass staging and write a candidate directly to a canonical destination', async () => withWorkspace(async ({ root }) => {
  const data = await fixture(root);
  const before = await hashes(root, data.assets);
  const transformers = { convert: async ({ destination: _destination, ...options }) => convertSourceImage({ ...options, outputRoot: root, destination: data.assets[0].destination }) };
  await assert.rejects(generateEvidenceAssets({ ...data, root, transformers }), /candidate|AssetRecord|generated/i);
  assert.deepEqual(await hashes(root, data.assets), before);
}));
