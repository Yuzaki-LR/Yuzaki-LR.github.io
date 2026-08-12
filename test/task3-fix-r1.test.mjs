import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import { writeCandidateBundle } from '../src/lib/content/bundle.mjs';
import { parsePageFile } from '../src/lib/content/page-file.mjs';
import { parseProjectFile } from '../src/lib/content/project-file.mjs';
import { parseResearchFile } from '../src/lib/content/research-file.mjs';
import { loadSiteRepository } from '../src/lib/content/repository.mjs';
import { toPublicSiteModel } from '../src/lib/content/render-model.mjs';
import { listStaticAssetRoutes } from '../src/lib/content/asset-routes.mjs';
import { GET as projectGet } from '../src/pages/assets/projects/[slug]/[name].png.ts';
import { GET as siteGet } from '../src/pages/assets/site/[name].png.ts';
import { distRoot, projectRoot, withAstroBuildLock, withContentCodecWorkspace } from './helpers.mjs';

const site = { name: 'Candidate', degree: 'Degree', institution: 'Institution', email: 'candidate@example.test', intro: 'Intro', interests: [], avatar: { mode: 'image', src: './site-images/avatar.png', alt: 'Avatar' }, links: { github: null, linkedin: null, googleScholar: null, orcid: null, custom: [] }, theme: { background: '#ffffff', surface: '#f7f8f9', text: '#17212b', accent: '#2d587a' }, navigation: [{ label: 'About', href: '/' }] };
const about = () => parsePageFile('<!-- editor:section id="aboutfx01" kind="standard" hidden="false" -->\n## Current direction\n<!-- editor:block id="aboutfx02" type="paragraph" hidden="false" -->\nDirection\n');
const project = () => parseProjectFile('---\nkind: individual\ncategory: Example\ntitle: Project\nshortTitle: Project\nsummary: Summary\nrole: Role\nmethods: [Method]\nfeatured: false\norder: 1\n---\n<!-- editor:section id="projectf1" kind="standard" hidden="false" -->\n## Overview\n<!-- editor:block id="projectf2" type="image" hidden="false" -->\n![Result](./images/result.png)\n');
const research = () => parseResearchFile('---\ntitle: Candidate research\nsummary: Summary\norder: 1\n---\n<!-- editor:section id="researchf1" kind="standard" hidden="false" -->\n## Scope\n<!-- editor:block id="researchf2" type="paragraph" hidden="false" -->\nResearch\n');
async function png() { return readFile(path.join(projectRoot, 'test', 'fixtures', 'content-v2', 'one-image', 'projects', 'sample-project', 'images', 'result.png')); }
async function runBuild(contentRoot) {
  return withAstroBuildLock(async () => {
    const child = spawn(process.execPath, [path.join(projectRoot, 'node_modules', 'astro', 'bin', 'astro.mjs'), 'build'], {
      cwd: projectRoot,
      env: { ...process.env, NODE_ENV: 'test', TEST_SITE_CONTENT_ROOT: contentRoot },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    const [code] = await once(child, 'close');
    return { code, stderr };
  });
}

test('complete canonical candidate reloads pages/about, site-images avatar, project image, public hrefs and hashes', async () => {
  await withContentCodecWorkspace(async ({ root }) => {
    const bytes = await png();
    const candidate = await writeCandidateBundle({ root, draft: { site, about: about(), projects: [{ slug: 'sample-project', document: project() }], research: [{ slug: 'candidate-research', document: research() }], images: [{ destination: 'site-images/avatar.png', bytes }, { destination: 'projects/sample-project/images/result.png', bytes }] } });
    assert.ok(candidate.files.includes('.candidate/research/candidate-research.md'));
    await assert.rejects(access(path.join(candidate.root, 'research', 'candidate-research', 'index.md')));
    const repository = await loadSiteRepository({ contentRoot: candidate.root });
    assert.equal(repository.research[0].slug, 'candidate-research');
    const model = toPublicSiteModel(repository, { base: '/repo/' });
    assert.equal(model.profile.avatar.src, '/repo/assets/site/avatar.png');
    assert.deepEqual(model.navigation, [{ label: 'About', href: '/repo/' }]);
    assert.deepEqual(listStaticAssetRoutes(repository).map((entry) => entry.pathname), ['/assets/projects/sample-project/result.png', '/assets/site/avatar.png']);
    assert.equal(repository.images.find((entry) => entry.kind === 'site').sha256, createHash('sha256').update(bytes).digest('hex'));
    const { code, stderr } = await runBuild(candidate.root);
    assert.equal(code, 0, `candidate build should succeed: ${stderr}`);
    const [emittedSite, emittedProject] = await Promise.all([
      readFile(path.join(distRoot, 'assets', 'site', 'avatar.png')),
      readFile(path.join(distRoot, 'assets', 'projects', 'sample-project', 'result.png')),
    ]);
    const expectedHash = createHash('sha256').update(bytes).digest('hex');
    assert.equal(createHash('sha256').update(emittedSite).digest('hex'), expectedHash);
    assert.equal(createHash('sha256').update(emittedProject).digest('hex'), expectedHash);
  });
});

test('static asset routing rejects case aliases and dedupes an exact duplicate reference', () => {
  assert.throws(() => listStaticAssetRoutes({ images: [{ kind: 'site', name: 'A.png', relativeSource: './site-images/A.png' }, { kind: 'site', name: 'a.png', relativeSource: './site-images/a.png' }] }), /case collision/);
  assert.equal(listStaticAssetRoutes({ images: [{ kind: 'project', slug: 'sample-project', name: 'result.png', relativeSource: './images/result.png' }, { kind: 'project', slug: 'sample-project', name: 'result.png', relativeSource: './images/result.png' }] }).length, 1);
});

test('binary endpoints fail closed for mismatched kind, slug, and stem params', () => {
  const projectAsset = { kind: 'project', slug: 'sample-project', name: 'result.png', relativeSource: './images/result.png', bytes: new Uint8Array([1]) };
  const siteAsset = { kind: 'site', name: 'avatar.png', relativeSource: './site-images/avatar.png', bytes: new Uint8Array([1]) };
  assert.equal(projectGet({ params: { slug: 'wrong', name: 'result' }, props: { asset: projectAsset } }).status, 404);
  assert.equal(projectGet({ params: { slug: 'sample-project', name: 'wrong' }, props: { asset: siteAsset } }).status, 404);
  assert.equal(siteGet({ params: { name: 'wrong' }, props: { asset: siteAsset } }).status, 404);
});

test('default repository loading is independent of the caller cwd', async () => {
  const other = path.join(projectRoot, 'tmp'); await mkdir(other, { recursive: true });
  const child = spawn(process.execPath, ['--input-type=module', '-e', "import { loadSiteRepository } from '../src/lib/content/repository.mjs'; console.log((await loadSiteRepository()).site.name)"], { cwd: other, env: { ...process.env, TEST_SITE_CONTENT_ROOT: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = ''; child.stdout.setEncoding('utf8'); child.stdout.on('data', (data) => { stdout += data; });
  const [code] = await once(child, 'close');
  assert.equal(code, 0); assert.equal(stdout.trim(), 'Yunxi Wu');
});
