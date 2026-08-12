import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { projectRoot } from './helpers.mjs';
import { loadSiteRepository } from '../src/lib/content/repository.mjs';
import { copyRepositoryFixture } from './helpers.mjs';

const raceChildPath = path.join(projectRoot, 'test', 'task3-r3-lock-race-child.mjs');
const childDeadlineMs = 3_000;

function waitForChildClose(child, label, timeoutMs = childDeadlineMs) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const onClose = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      child.off('close', onClose);
      reject(new Error(`${label} close timed out`));
    }, timeoutMs);
    child.once('close', onClose);
  });
}

async function createLockFixture() {
  const root = await mkdtemp(path.join(projectRoot, '.task3-lock-test-'));
  const sentinel = path.join(root, '.sentinel');
  const lockPath = path.join(root, 'build.lock');
  await writeFile(sentinel, 'task3-lock-test-sentinel\n');
  return {
    root,
    lockPath,
    cleanup: async () => {
      assert.equal(await readFile(sentinel, 'utf8'), 'task3-lock-test-sentinel\n');
      await rm(root, { recursive: true, force: true });
    },
  };
}

async function lockEntries(fixture) {
  return (await readdir(fixture.root)).filter((name) => name !== '.sentinel').sort();
}

async function runRaceChild(operation, fixture, replacement = '', contender = '') {
  const child = spawn(process.execPath, [raceChildPath, operation, fixture.lockPath, replacement, contender], {
    cwd: projectRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  try {
    await waitForChildClose(child, `${operation} race child`);
    assert.equal(child.exitCode, 0, stderr);
    return stdout.trim();
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await waitForChildClose(child, `${operation} race child reap`);
    assert.equal(child.exitCode !== null || child.signalCode !== null, true, `${operation} race child remained live`);
  }
}

test('race-child close/reap has a bounded deadline', async () => {
  const fixture = await createLockFixture();
  const child = spawn(process.execPath, [raceChildPath, 'stall', fixture.lockPath], {
    cwd: projectRoot,
    stdio: 'ignore',
  });
  try {
    await assert.rejects(waitForChildClose(child, 'stalled race child', 100), /stalled race child close timed out/);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await waitForChildClose(child, 'stalled race child reap');
    assert.equal(child.exitCode !== null || child.signalCode !== null, true, 'stalled race child remained live after cleanup');
    assert.deepEqual(await lockEntries(fixture), []);
    await fixture.cleanup();
  }
});

test('Astro build lock recovers a killed owner and leaves no live or claim residue', async () => {
  const fixture = await createLockFixture();
  const child = spawn(process.execPath, [raceChildPath, 'hold', fixture.lockPath], {
    cwd: projectRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const ready = new Promise((resolve, reject) => {
    child.stdout.on('data', () => { if (stdout.includes('ACQUIRED')) resolve(); });
    child.once('error', reject);
    child.once('close', (code) => reject(new Error(`lock child closed early (${code}): ${stderr}`)));
  });
  try {
    await Promise.race([ready, new Promise((_, reject) => setTimeout(() => reject(new Error('lock child readiness timed out')), childDeadlineMs))]);
    child.kill();
    await waitForChildClose(child, 'killed lock child reap');
    assert.equal(child.exitCode !== null || child.signalCode !== null, true, 'killed lock child remained live');
    assert.equal(await runRaceChild('acquire-release', fixture), 'RELEASED');
    assert.deepEqual(await lockEntries(fixture), []);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await waitForChildClose(child, 'killed lock child final reap');
    assert.equal(child.exitCode !== null || child.signalCode !== null, true, 'killed lock child remained live after finalizer');
    await fixture.cleanup();
  }
});

test('Astro build lock preserves malformed metadata fail-closed', async () => {
  const fixture = await createLockFixture();
  const malformed = 'not-lock-metadata\n';
  try {
    await writeFile(fixture.lockPath, malformed, { flag: 'wx' });
    assert.equal(await runRaceChild('acquire', fixture), 'REJECTED:malformed build lock');
    assert.equal(await readFile(fixture.lockPath, 'utf8'), malformed);
    assert.deepEqual(await lockEntries(fixture), ['build.lock']);
  } finally {
    await fixture.cleanup();
  }
});

test('Astro build lock release restores a claimed replacement when live is absent', async () => {
  const fixture = await createLockFixture();
  const replacement = `${JSON.stringify({ version: 1, pid: process.pid, token: randomUUID() })}\n`;
  try {
    assert.equal(await runRaceChild('release-mismatch', fixture, replacement), 'REJECTED:build lock ownership changed');
    assert.equal(await readFile(fixture.lockPath, 'utf8'), replacement);
    assert.deepEqual(await lockEntries(fixture), ['build.lock']);
  } finally {
    await fixture.cleanup();
  }
});

test('Astro build lock release preserves a live contender created after its atomic claim', async () => {
  const fixture = await createLockFixture();
  const contender = `${JSON.stringify({ version: 1, pid: process.pid, token: randomUUID() })}\n`;
  try {
    assert.equal(await runRaceChild('release', fixture, '', contender), 'RELEASED');
    assert.equal(await readFile(fixture.lockPath, 'utf8'), contender);
    assert.deepEqual(await lockEntries(fixture), ['build.lock']);
  } finally {
    await fixture.cleanup();
  }
});

test('Astro build lock recovery restores a claimed replacement when live is absent', async () => {
  const fixture = await createLockFixture();
  const staleOwner = `${JSON.stringify({ version: 1, pid: 2_147_483_647, token: randomUUID() })}\n`;
  const replacement = `${JSON.stringify({ version: 1, pid: process.pid, token: randomUUID() })}\n`;
  try {
    await writeFile(fixture.lockPath, staleOwner, { flag: 'wx' });
    assert.equal(await runRaceChild('recover-mismatch', fixture, replacement), 'REJECTED:build lock ownership changed');
    assert.equal(await readFile(fixture.lockPath, 'utf8'), replacement);
    assert.deepEqual(await lockEntries(fixture), ['build.lock']);
  } finally {
    await fixture.cleanup();
  }
});

test('Astro build lock recovery never overwrites a third-party live owner after claiming a replacement', async () => {
  const fixture = await createLockFixture();
  const staleOwner = `${JSON.stringify({ version: 1, pid: 2_147_483_647, token: randomUUID() })}\n`;
  const replacement = `${JSON.stringify({ version: 1, pid: process.pid, token: randomUUID() })}\n`;
  const contender = `${JSON.stringify({ version: 1, pid: process.pid, token: randomUUID() })}\n`;
  try {
    await writeFile(fixture.lockPath, staleOwner, { flag: 'wx' });
    assert.equal(await runRaceChild('recover-three-party', fixture, replacement, contender), 'REJECTED:build lock ownership changed');
    assert.equal(await readFile(fixture.lockPath, 'utf8'), contender);
    const entries = await lockEntries(fixture);
    assert.equal(entries.length, 2);
    assert.equal(entries[0], 'build.lock');
    assert.match(entries[1], /^build\.lock\.claim-/);
    assert.equal(await readFile(path.join(fixture.root, entries[1]), 'utf8'), replacement);
  } finally {
    await fixture.cleanup();
  }
});

test('Astro build lock recovery preserves an ambiguous claim and fails closed clearly', async () => {
  const fixture = await createLockFixture();
  const staleOwner = `${JSON.stringify({ version: 1, pid: 2_147_483_647, token: randomUUID() })}\n`;
  const replacement = `${JSON.stringify({ version: 1, pid: process.pid, token: randomUUID() })}\n`;
  try {
    await writeFile(fixture.lockPath, staleOwner, { flag: 'wx' });
    assert.equal(await runRaceChild('recover-ambiguous', fixture, replacement), 'REJECTED:build lock claim recovery failed; claim preserved');
    const entries = await lockEntries(fixture);
    assert.equal(entries.length, 1);
    assert.match(entries[0], /^build\.lock\.claim-/);
    assert.equal(await readFile(path.join(fixture.root, entries[0]), 'utf8'), replacement);
  } finally {
    await fixture.cleanup();
  }
});

test('repository rejects nested research records instead of accepting an alternate layout', async () => {
  const fixture = await copyRepositoryFixture('one-image');
  try {
    await mkdir(path.join(fixture.root, 'research', 'nested-record'), { recursive: true });
    await writeFile(path.join(fixture.root, 'research', 'nested-record', 'index.md'), '---\ntitle: Nested\nsummary: Nested\norder: 1\n---\n\n## Notes\nNested\n');
    await assert.rejects(loadSiteRepository({ contentRoot: fixture.root }), /research layout is invalid/);
  } finally { await fixture.cleanup(); }
});
