import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { copyRepositoryFixture, distRoot, projectRoot, withAstroBuildLock } from './helpers.mjs';

function run(args, options) {
  const child = spawn(process.execPath, args, options);
  let stderr = '';
  child.stderr?.setEncoding('utf8');
  child.stderr?.on('data', (chunk) => { stderr += chunk; });
  return once(child, 'close').then(([code]) => ({ code, stderr }));
}

test('a fresh build emits the confined project PNG byte-identically without source metadata', async () => {
  const fixture = await copyRepositoryFixture('one-image');
  try {
    const { code, stderr } = await withAstroBuildLock(() => run([path.join(projectRoot, 'node_modules', 'astro', 'bin', 'astro.mjs'), 'build'], {
      cwd: projectRoot,
      env: { ...process.env, NODE_ENV: 'test', TEST_SITE_CONTENT_ROOT: fixture.root },
      stdio: 'pipe',
    }));
    assert.equal(code, 0, `fixture content build should succeed: ${stderr}`);
    const [emitted, source] = await Promise.all([
      readFile(path.join(distRoot, 'assets', 'projects', 'sample-project', 'result.png')),
      readFile(path.join(fixture.root, 'projects', 'sample-project', 'images', 'result.png')),
    ]);
    assert.equal(createHash('sha256').update(emitted).digest('hex'), createHash('sha256').update(source).digest('hex'));
    assert.doesNotMatch(emitted.toString('latin1'), /sample-project|projects[\\/]|src[\\/]|content[\\/]/i);
  } finally { await fixture.cleanup(); }
});

test('fresh build under an Astro base emits base-aware internal navigation and focus tokens', async () => {
  const { code, stderr } = await withAstroBuildLock(() => run([path.join(projectRoot, 'node_modules', 'astro', 'bin', 'astro.mjs'), 'build'], {
    cwd: projectRoot, env: { ...process.env, BASE: '/repo/' }, stdio: 'pipe',
  }));
  assert.equal(code, 0, stderr);
  const html = await readFile(path.join(distRoot, 'index.html'), 'utf8');
  assert.match(html, /href="\/repo\/"/);
  assert.doesNotMatch(html, /href="\/\/repo\//);
  const css = (await readFile(path.join(distRoot, '_astro', (await (await import('node:fs/promises')).readdir(path.join(distRoot, '_astro'))).find((name) => name.endsWith('.css'))), 'utf8'));
  assert.match(css, /outline:3px solid var\(--focus\)/);
  const projectEntries = await readdir(path.join(distRoot, 'projects'), { withFileTypes: true });
  const projectHtml = await Promise.all(projectEntries.filter((entry) => entry.isDirectory()).map((entry) => readFile(path.join(distRoot, 'projects', entry.name, 'index.html'), 'utf8')));
  const evidenceSources = projectHtml.flatMap((document) => [...document.matchAll(/<img[^>]+src="([^"]+)"/g)].map((match) => match[1]).filter((source) => source.includes('/assets/')));
  assert.ok(evidenceSources.length > 0);
  assert.ok(evidenceSources.every((source) => source.startsWith('/repo/assets/')));
  assert.ok(evidenceSources.every((source) => !source.startsWith('/assets/')));
});
