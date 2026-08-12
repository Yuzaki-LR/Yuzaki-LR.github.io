import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { loadSiteRepository } from '../src/lib/content/repository.mjs';
import { toPublicSiteModel } from '../src/lib/content/render-model.mjs';
import { assetStem, listStaticAssetRoutes, parseAssetName, toPublicAssetHref } from '../src/lib/content/asset-routes.mjs';
import { parseResearchFile } from '../src/lib/content/research-file.mjs';
import { validateResearch } from '../src/lib/content/schema.mjs';
import { copyRepositoryFixture } from './helpers.mjs';

test('empty optional profile fields render no placeholder or layout slot', async () => {
  const fixture = await copyRepositoryFixture('empty-optionals');
  try {
    const repository = await loadSiteRepository({ contentRoot: fixture.root });
    const site = toPublicSiteModel(repository);
    assert.deepEqual(site.profile.links, []);
    assert.equal(site.profile.avatar.mode, 'hidden');
  } finally { await fixture.cleanup(); }
});

test('profile email remains a validated public contact field', async () => {
  const fixture = await copyRepositoryFixture('empty-optionals');
  try {
    const sourcePath = path.join(fixture.root, 'site.yml');
    const source = await readFile(sourcePath, 'utf8');
    await writeFile(sourcePath, source.replace('example@example.test', 'not-an-email'));
    await assert.rejects(loadSiteRepository({ contentRoot: fixture.root }), /site configuration is invalid/);
  } finally { await fixture.cleanup(); }
});

test('the verified manuscript status cannot silently advance', async () => {
  const source = await readFile(new URL('../src/content/research/more-electric-aircraft.md', import.meta.url), 'utf8');
  const advanced = parseResearchFile(source);
  advanced.frontmatter.status = 'Accepted';
  assert.throws(() => validateResearch(advanced), /research frontmatter is invalid/);
});

test('content-local images map to one base-aware static resource route', async () => {
  const fixture = await copyRepositoryFixture('one-image');
  try {
    const repository = await loadSiteRepository({ contentRoot: fixture.root });
    const [route] = listStaticAssetRoutes(repository);
    assert.deepEqual(listStaticAssetRoutes(repository).map(({ pathname }) => pathname), ['/assets/projects/sample-project/result.png']);
    assert.equal(toPublicAssetHref({ kind: 'project', slug: 'sample-project', relativeSource: './images/result.png', base: '/repo/' }), '/repo/assets/projects/sample-project/result.png');
    assert.equal(assetStem('./images/result.png'), 'result');
    assert.throws(() => parseAssetName('./images/result.v2.png'), /content-local PNG/);
    assert.equal(createHash('sha256').update(await readFile(route.sourcePath)).digest('hex'), route.sha256);
  } finally { await fixture.cleanup(); }
});

test('site avatar source maps through a base-aware public asset href', async () => {
  const fixture = await copyRepositoryFixture('empty-optionals');
  try {
    const sitePath = path.join(fixture.root, 'site.yml');
    const source = await readFile(sitePath, 'utf8');
    await writeFile(sitePath, source.replace('mode: hidden', 'mode: image\n  src: ./site-images/avatar.png\n  alt: Avatar'));
    await assert.rejects(loadSiteRepository({ contentRoot: fixture.root }), /site avatar/);
  } finally { await fixture.cleanup(); }
});
