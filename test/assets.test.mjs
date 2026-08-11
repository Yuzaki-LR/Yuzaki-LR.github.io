import test from 'node:test';
import assert from 'node:assert/strict';
import { crc32, inflateSync } from 'node:zlib';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { projectRoot } from './helpers.mjs';

const assets = [
  'communication-channel-capacity.png',
  'communication-filter-results.png',
  'future-ocean-habitat-master-system.png',
  'future-ocean-habitat-udc-flow.png',
  'life-support-efficiency.png',
  'life-support-hvac-control.png',
];

const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const allowedChunks = new Set(['IDAT', 'IEND', 'IHDR']);

function decodePng(bytes, asset) {
  assert.deepEqual(bytes.subarray(0, 8), pngSignature, `${asset} is not a PNG`);

  const chunks = [];
  let offset = pngSignature.length;
  while (offset < bytes.length) {
    assert.ok(offset + 12 <= bytes.length, `${asset} has a truncated PNG chunk`);
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    assert.ok(dataEnd + 4 <= bytes.length, `${asset} has a truncated ${type} chunk`);
    const expectedCrc = bytes.readUInt32BE(dataEnd);
    const actualCrc = crc32(bytes.subarray(offset + 4, dataEnd));
    assert.equal(actualCrc, expectedCrc, `${asset} has an invalid ${type} checksum`);
    chunks.push({ type, data: bytes.subarray(dataStart, dataEnd) });
    offset = dataEnd + 4;
    if (type === 'IEND') break;
  }

  assert.equal(offset, bytes.length, `${asset} has data after its IEND chunk`);
  assert.equal(chunks[0]?.type, 'IHDR', `${asset} does not start with IHDR`);
  assert.equal(chunks.at(-1)?.type, 'IEND', `${asset} does not end with IEND`);
  assert.equal(chunks[0].data.length, 13, `${asset} has an invalid IHDR`);
  assert.ok(chunks.some(({ type }) => type === 'IDAT'), `${asset} has no pixel data`);

  const header = chunks[0].data;
  const width = header.readUInt32BE(0);
  const height = header.readUInt32BE(4);
  assert.ok(width >= 400 && height >= 200, `${asset} dimensions ${width}x${height} are too small`);
  assert.equal(header[8], 8, `${asset} must use 8-bit channels`);
  assert.equal(header[9], 2, `${asset} must be RGB, without a palette or alpha channel`);
  assert.equal(header[12], 0, `${asset} must be non-interlaced`);

  const compressed = Buffer.concat(
    chunks.filter(({ type }) => type === 'IDAT').map(({ data }) => data),
  );
  const scanlines = inflateSync(compressed);
  assert.equal(
    scanlines.length,
    height * (1 + width * 3),
    `${asset} pixel payload does not decode to its declared RGB dimensions`,
  );
  assert.ok(
    chunks.every(({ type }) => allowedChunks.has(type)),
    `${asset} contains metadata or an unexpected ancillary chunk`,
  );
}

test('the project evidence directory contains exactly six sanitised PNG assets', async () => {
  const directory = path.join(projectRoot, 'public', 'assets', 'projects');
  const actual = (await readdir(directory)).sort();
  assert.deepEqual(actual, assets);
});

test('all six sanitised evidence assets decode as metadata-free RGB PNG files', async () => {
  for (const asset of assets) {
    const file = path.join(projectRoot, 'public', 'assets', 'projects', asset);
    const info = await stat(file);
    assert.ok(info.size > 5_000, `${asset} is unexpectedly small`);
    decodePng(await readFile(file), asset);
  }
});
