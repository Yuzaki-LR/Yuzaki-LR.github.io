import { createHash, randomUUID } from 'node:crypto';
import { copyFile, lstat, mkdir, readFile, realpath, rename, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const coordinateSystem = 'rotated-mediabox-upper-left-points-half-open';
const commonKeys = ['id', 'sourceKind', 'sourceId', 'destination'];
const variantKeys = {
  'pdf-page': [...commonKeys, 'page', 'boxPt'],
  'source-image': [...commonKeys, 'sourceName', 'transform'],
};
const segment = /^[a-z0-9][a-z0-9_-]*$/;
const filename = /^[a-z0-9][a-z0-9_-]*\.png$/i;
const reservedDevice = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
const pngMetadataChunks = new Set(['eXIf', 'iCCP', 'iTXt', 'tEXt', 'zTXt']);
const moduleWorktree = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const moduleWorktreeReal = await realpath(moduleWorktree);

function fail(message, cause) { throw new Error(message, cause ? { cause } : undefined); }
function exactKeys(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) fail(`${label} has missing or unexpected variant fields`);
}
function samePath(left, right) { return path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase(); }
function inside(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export function validateRelativeOutput(destination) {
  if (typeof destination !== 'string' || !destination || destination.includes('\\') || destination.includes('%') || destination.includes(':') || path.isAbsolute(destination) || path.win32.isAbsolute(destination) || /^[a-z]:/i.test(destination) || /^\/{2}/.test(destination)) fail('destination is invalid');
  const parts = destination.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..' || /[. ]$/.test(part) || reservedDevice.test(part))) fail('destination is invalid');
  return parts;
}

function confinedDestination(destination, root) {
  const parts = validateRelativeOutput(destination);
  if (parts.length !== 6 || parts[0] !== 'src' || parts[1] !== 'content' || parts[2] !== 'projects' || !segment.test(parts[3]) || parts[4] !== 'images' || !filename.test(parts[5])) fail('destination is invalid');
  const target = path.resolve(root, ...parts);
  if (!inside(root, target) || samePath(root, target)) fail('destination is outside the worktree');
  return target;
}

async function entry(pathname) {
  try { return await lstat(pathname); } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function secureRoot(root) {
  const absolute = path.resolve(root);
  if (!inside(moduleWorktree, absolute)) fail('output root is outside the fixed module worktree boundary');
  const info = await lstat(absolute);
  if (!info.isDirectory() || info.isSymbolicLink()) fail('output root violates the fixed module worktree boundary through a reparse or symbolic link');
  const canonical = await realpath(absolute);
  if (!inside(moduleWorktreeReal, canonical) || !samePath(absolute, canonical)) fail('output root violates the fixed module worktree boundary through a reparse or junction');
  return canonical;
}

async function secureDirectoryChain(root, directory, { create = false } = {}) {
  const canonicalRoot = await secureRoot(root);
  const absolute = path.resolve(directory);
  if (!inside(canonicalRoot, absolute)) fail('destination is outside output root');
  const relative = path.relative(canonicalRoot, absolute);
  let current = canonicalRoot;
  for (const part of relative ? relative.split(path.sep) : []) {
    current = path.join(current, part);
    let info = await entry(current);
    if (!info && create) {
      try { await mkdir(current); } catch (error) { if (error?.code !== 'EEXIST') throw error; }
      info = await lstat(current);
    }
    if (!info) continue;
    if (!info.isDirectory() || info.isSymbolicLink()) fail('destination parent is a reparse, junction or symbolic link');
    if (!samePath(current, await realpath(current))) fail('destination parent is a reparse or junction');
  }
  return absolute;
}

async function confinedOutput(outputRoot, destination, { createParent = false } = {}) {
  const parts = validateRelativeOutput(destination);
  const root = await secureRoot(outputRoot);
  const target = path.resolve(root, ...parts);
  if (!inside(root, target) || samePath(root, target)) fail('destination is outside output root');
  await secureDirectoryChain(root, path.dirname(target), { create: createParent });
  const targetEntry = await entry(target);
  if (targetEntry?.isSymbolicLink()) fail('destination is a reparse or symbolic link');
  if (targetEntry && !samePath(target, await realpath(target))) fail('destination is a reparse or junction');
  return target;
}

export function parseEvidenceManifest(value, { root = process.cwd() } = {}) {
  exactKeys(value, ['formatVersion', 'coordinateSystem', 'assets'], 'manifest');
  if (value.formatVersion !== 1 || value.coordinateSystem !== coordinateSystem || !Array.isArray(value.assets)) fail('manifest header is invalid');
  const ids = new Set();
  const destinations = new Set();
  const assets = value.assets.map((asset, index) => {
    const keys = variantKeys[asset?.sourceKind];
    if (!keys) fail(`assets[${index}] sourceKind is invalid`);
    exactKeys(asset, keys, `assets[${index}]`);
    if (typeof asset.id !== 'string' || !segment.test(asset.id) || ids.has(asset.id)) fail(`assets[${index}] id is invalid or duplicated`);
    if (typeof asset.sourceId !== 'string' || !segment.test(asset.sourceId)) fail(`assets[${index}] sourceId is invalid`);
    confinedDestination(asset.destination, root);
    const destinationKey = asset.destination.toLowerCase();
    if (destinations.has(destinationKey)) fail('destination collision');
    ids.add(asset.id); destinations.add(destinationKey);
    if (asset.sourceKind === 'pdf-page') {
      if (!Number.isSafeInteger(asset.page) || asset.page < 1) fail(`assets[${index}] page is required`);
      if (!Array.isArray(asset.boxPt) || asset.boxPt.length !== 4 || !asset.boxPt.every(Number.isFinite) || asset.boxPt[0] < 0 || asset.boxPt[1] < 0 || asset.boxPt[2] <= asset.boxPt[0] || asset.boxPt[3] <= asset.boxPt[1]) fail(`assets[${index}] boxPt is invalid`);
    } else {
      if (typeof asset.sourceName !== 'string' || path.basename(asset.sourceName) !== asset.sourceName) fail(`assets[${index}] sourceName is invalid`);
      if (asset.transform !== 'auto-orient-and-trim-uniform-white') fail(`assets[${index}] transform is invalid`);
    }
    return structuredClone(asset);
  });
  return { formatVersion: 1, coordinateSystem, assets };
}

function pngChunkTypes(bytes) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (!bytes.subarray(0, 8).equals(signature)) fail('generated asset is not PNG');
  const types = [];
  let offset = 8;
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) fail('generated PNG is truncated');
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    offset += 12 + length;
    if (offset > bytes.length) fail('generated PNG is truncated');
    types.push(type);
    if (type === 'IEND') break;
  }
  if (offset !== bytes.length) fail('generated PNG has trailing bytes');
  return types;
}

async function record(output) {
  const bytes = await readFile(output);
  const metadata = await sharp(bytes, { animated: true }).metadata();
  const metadataKeys = ['exif', 'xmp', 'iptc', 'icc'].filter((key) => metadata[key] !== undefined);
  metadataKeys.push(...pngChunkTypes(bytes).filter((type) => pngMetadataChunks.has(type)));
  return { sha256: createHash('sha256').update(bytes).digest('hex'), width: metadata.width, height: metadata.height, colourSpace: metadata.space, metadataKeys };
}

function validateAssetRecord(value) {
  exactKeys(value, ['sha256', 'width', 'height', 'colourSpace', 'metadataKeys'], 'AssetRecord');
  if (!/^[a-f0-9]{64}$/.test(value.sha256) || !Number.isSafeInteger(value.width) || value.width < 1 || !Number.isSafeInteger(value.height) || value.height < 1 || value.colourSpace !== 'srgb' || !Array.isArray(value.metadataKeys) || value.metadataKeys.length) fail('AssetRecord is invalid');
  return value;
}

export async function cropRenderedPage({ input, outputRoot, destination, pageWidthPt, pageHeightPt, boxPt }) {
  const output = await confinedOutput(outputRoot, destination, { createParent: true });
  const metadata = await sharp(input).metadata();
  if (!metadata.width || !metadata.height || !Number.isFinite(pageWidthPt) || !Number.isFinite(pageHeightPt)) fail('rendered page dimensions are invalid');
  const dpiX = metadata.width * 72 / pageWidthPt;
  const dpiY = metadata.height * 72 / pageHeightPt;
  const dpi = Math.round((dpiX + dpiY) / 2);
  if (Math.abs(dpiX - dpi) > 0.1 || Math.abs(dpiY - dpi) > 0.1) fail('rendered page DPI does not match its rotated MediaBox');
  const scale = dpi / 72;
  const left = Math.max(0, Math.floor(boxPt[0] * scale));
  const top = Math.max(0, Math.floor(boxPt[1] * scale));
  const right = Math.min(metadata.width, Math.ceil(boxPt[2] * scale));
  const bottom = Math.min(metadata.height, Math.ceil(boxPt[3] * scale));
  if (right <= left || bottom <= top) fail('crop box is empty after clamping');
  await confinedOutput(outputRoot, destination);
  await sharp(input).extract({ left, top, width: right - left, height: bottom - top }).removeAlpha().png().toFile(output);
  return validateAssetRecord(await record(output));
}

export async function convertSourceImage({ input, outputRoot, destination, trimBackground }) {
  const output = await confinedOutput(outputRoot, destination, { createParent: true });
  let pipeline = sharp(input).rotate();
  if (trimBackground) pipeline = pipeline.trim({ background: '#ffffff', threshold: 10 });
  await confinedOutput(outputRoot, destination);
  await pipeline.removeAlpha().png().toFile(output);
  return validateAssetRecord(await record(output));
}

export async function readEvidenceManifest(input, options) {
  return parseEvidenceManifest(JSON.parse(await readFile(input, 'utf8')), options);
}

async function sourceRecord(input) {
  const [bytes, info] = await Promise.all([readFile(input), stat(input)]);
  return { sha256: createHash('sha256').update(bytes).digest('hex'), bytes: info.size };
}

function boundInput(bindings, asset) {
  const binding = bindings[asset.sourceId];
  const input = asset.sourceKind === 'source-image' ? binding?.[asset.sourceName] : binding;
  if (typeof input !== 'string' || !path.isAbsolute(input)) fail(`source binding is missing for ${asset.id}`);
  return input;
}

async function promoteAll({ root, operationRoot, assets, fileOps }) {
  const states = [];
  try {
    for (const asset of assets) {
      const canonical = await confinedOutput(root, asset.destination, { createParent: true });
      const candidateDestination = `candidates/${asset.destination}`;
      const backupDestination = `backups/${asset.destination}`;
      const candidate = await confinedOutput(operationRoot, candidateDestination);
      const backup = await confinedOutput(operationRoot, backupDestination, { createParent: true });
      const state = { asset, canonical, candidate, backup, backed: false, promoted: false };
      states.push(state);
      if (await entry(canonical)) {
        await confinedOutput(root, asset.destination);
        await confinedOutput(operationRoot, backupDestination);
        await fileOps.rename(canonical, backup);
        state.backed = true;
      }
      try {
        await confinedOutput(operationRoot, candidateDestination);
        await secureDirectoryChain(root, path.dirname(canonical));
        await fileOps.rename(candidate, canonical);
        state.promoted = true;
      } catch (error) {
        if (state.backed) {
          await secureDirectoryChain(root, path.dirname(canonical));
          await fileOps.rename(backup, canonical);
          state.backed = false;
        }
        throw error;
      }
    }
  } catch (error) {
    try {
      for (const state of [...states].reverse()) {
        if (state.promoted) {
          const failedDestination = `failed/${state.asset.destination}`;
          const failed = await confinedOutput(operationRoot, failedDestination, { createParent: true });
          await secureDirectoryChain(root, path.dirname(state.canonical));
          await fileOps.rename(state.canonical, failed);
          state.promoted = false;
        }
        if (state.backed) {
          await secureDirectoryChain(root, path.dirname(state.canonical));
          await fileOps.rename(state.backup, state.canonical);
          state.backed = false;
        }
      }
    } catch (rollbackError) {
      fail('asset promotion rollback failed; operation staging and backup artifacts retained', rollbackError);
    }
    throw error;
  }
}

async function snapshotCanonicalOutputs(root, operationRoot, assets) {
  const snapshots = [];
  for (const asset of assets) {
    const canonical = await confinedOutput(root, asset.destination, { createParent: true });
    const original = await entry(canonical);
    const snapshotDestination = `originals/${asset.destination}`;
    const snapshot = await confinedOutput(operationRoot, snapshotDestination, { createParent: true });
    const identity = original ? await sourceRecord(canonical) : null;
    if (original) {
      await confinedOutput(root, asset.destination);
      await confinedOutput(operationRoot, snapshotDestination);
      await copyFile(canonical, snapshot);
    }
    snapshots.push({ asset, canonical, snapshot, snapshotDestination, identity });
  }
  return snapshots;
}

async function restoreUnexpectedCanonicalChanges(root, operationRoot, snapshots, fileOps) {
  const changed = [];
  for (const state of snapshots) {
    const current = await entry(state.canonical);
    const identity = current ? await sourceRecord(state.canonical) : null;
    if (!state.identity !== !identity || (identity && (identity.sha256 !== state.identity.sha256 || identity.bytes !== state.identity.bytes))) changed.push(state);
  }
  for (const state of [...changed].reverse()) {
    if (await entry(state.canonical)) {
      const failedDestination = `failed-prepromotion/${state.asset.destination}`;
      const failed = await confinedOutput(operationRoot, failedDestination, { createParent: true });
      await secureDirectoryChain(root, path.dirname(state.canonical));
      await fileOps.rename(state.canonical, failed);
    }
    if (state.identity) {
      await confinedOutput(operationRoot, state.snapshotDestination);
      await secureDirectoryChain(root, path.dirname(state.canonical));
      await fileOps.rename(state.snapshot, state.canonical);
    }
  }
  if (changed.length) fail('generated candidate bypassed the confined operation staging directory');
}

export async function generateEvidenceAssets({ manifestPath, bindingPath, root, renderedPages = {}, transformers = {}, fileOps = {} }) {
  root = await secureRoot(root);
  const [manifest, bindings] = await Promise.all([
    readEvidenceManifest(manifestPath, { root }),
    readFile(bindingPath, 'utf8').then(JSON.parse),
  ]);
  const inputs = manifest.assets.map((asset) => ({ asset, input: boundInput(bindings, asset) }));
  const sources = new Map();
  for (const { input } of inputs) {
    const canonical = await realpath(input);
    const key = canonical.toLowerCase();
    if (!sources.has(key)) sources.set(key, { input: canonical, ...await sourceRecord(canonical) });
  }
  const runtime = await secureDirectoryChain(root, path.join(root, '.local-editor', 'runtime'), { create: true });
  const operationRoot = path.join(runtime, `evidence-generation-${randomUUID()}`);
  await mkdir(operationRoot);
  await secureRoot(operationRoot);
  const effectiveFileOps = { rename: fileOps.rename ?? rename };
  const canonicalSnapshots = await snapshotCanonicalOutputs(root, operationRoot, manifest.assets);
  const crop = transformers.crop ?? cropRenderedPage;
  const convert = transformers.convert ?? convertSourceImage;
  const assets = [];
  try {
    for (const { asset, input } of inputs) {
      const destination = `candidates/${asset.destination}`;
      let result;
      if (asset.sourceKind === 'pdf-page') {
        const page = renderedPages[`${asset.sourceId}:${asset.page}`];
        if (!page) fail(`reviewed rendered page is missing for ${asset.id}`);
        result = await crop({ input: page.input, outputRoot: operationRoot, destination, pageWidthPt: page.pageWidthPt, pageHeightPt: page.pageHeightPt, boxPt: asset.boxPt });
      } else {
        result = await convert({ input, outputRoot: operationRoot, destination, trimBackground: true });
      }
      await restoreUnexpectedCanonicalChanges(root, operationRoot, canonicalSnapshots, effectiveFileOps);
      assets.push({ ...asset, ...validateAssetRecord(result) });
    }
  } catch (error) {
    try { await restoreUnexpectedCanonicalChanges(root, operationRoot, canonicalSnapshots, effectiveFileOps); } catch (restoreError) {
      if (!/bypassed the confined/.test(restoreError.message)) fail('pre-promotion canonical restoration failed; operation staging and backup artifacts retained', restoreError);
    }
    throw error;
  }
  for (const before of sources.values()) {
    const after = await sourceRecord(before.input);
    if (after.sha256 !== before.sha256 || after.bytes !== before.bytes) fail(`source changed while processing ${before.input}`);
  }
  await promoteAll({ root, operationRoot, assets, fileOps: effectiveFileOps });
  return { assets, sources: [...sources.values()] };
}

async function main() {
  const [manifestPath, bindingPath] = process.argv.slice(2);
  if (!manifestPath || !bindingPath) fail('usage: evidence-crops.mjs <manifest> <bindings>');
  const root = await realpath(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
  const scratch = path.join(root, '.local-editor', 'runtime', 'evidence-source');
  const result = await generateEvidenceAssets({ manifestPath, bindingPath, root, renderedPages: {
    'life-support-report:9': { input: path.join(scratch, 'life-page-9.png'), pageWidthPt: 595.276, pageHeightPt: 841.89 },
    'life-support-report:17': { input: path.join(scratch, 'life-page-17.png'), pageWidthPt: 595.276, pageHeightPt: 841.89 },
    'habitat-team-report:130': { input: path.join(scratch, 'team-page-130.png'), pageWidthPt: 595.2, pageHeightPt: 841.92 },
    'habitat-team-report:371': { input: path.join(scratch, 'team-page-371.png'), pageWidthPt: 595.2, pageHeightPt: 841.92 },
  } });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
