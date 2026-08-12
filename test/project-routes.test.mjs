import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { load } from 'cheerio';
import { loadProjects } from '../src/lib/content/repository.mjs';
import { renderSafeBlock } from '../src/lib/content/safe-render.mjs';
import { distRoot, readBuiltRoute } from './helpers.mjs';

test('project routes are discovered from canonical records', async () => {
  const projects = await loadProjects();
  const index = load(await readBuiltRoute('/projects/'));
  for (const project of projects) {
    assert.equal(index(`a[href$="/projects/${project.slug}/"]`).length, 1);
    assert.equal(load(await readBuiltRoute(`/projects/${project.slug}/`))('main h1').length, 1);
  }
  const generated = (await readdir(path.join(distRoot, 'projects'), { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  assert.deepEqual(generated, projects.map(({ slug }) => slug).sort());
});

test('project lists and documents preserve semantic heading hierarchy', async () => {
  const projects = await loadProjects();
  const projectIndex = load(await readBuiltRoute('/projects/'));
  assert.equal(projectIndex('main > h1').length, 1);
  assert.deepEqual(projectIndex('main article h2').map((_, el) => projectIndex(el).text().trim()).get(), projects.map(({ frontmatter }) => frontmatter.title));
  const home = load(await readBuiltRoute('/'));
  assert.equal(home('main section').filter((_, el) => home(el).find('h2').first().text() === 'Selected Projects').find('article h3').length, projects.filter(({ frontmatter }) => frontmatter.featured).length);

  for (const project of projects) {
    const $ = load(await readBuiltRoute(`/projects/${project.slug}/`));
    assert.equal($('main > h1').length, 1);
    assert.deepEqual($('main > section > h2').map((_, el) => $(el).text().trim()).get(), project.sections.filter((section) => !section.hidden).map(({ title }) => title));
    assert.equal($('main h1').length, 1);
    assert.equal($('main h3').filter((_, el) => !$(el).closest('section').length).length, 0);
  }
});

test('visible image surfaces render from canonical blocks and metadata uses readable separators', async () => {
  for (const project of await loadProjects()) {
    const $ = load(await readBuiltRoute(`/projects/${project.slug}/`));
    const visibleImages = project.sections.flatMap(({ blocks }) => blocks).filter(({ type, hidden }) => type === 'image' && !hidden);
    assert.equal($('figure').length, visibleImages.length);
    assert.equal($('h2').filter((_, el) => /gallery/i.test($(el).text())).length, 0);
    assert.equal($('dt').filter((_, el) => $(el).text() === 'Methods and tools').next('dd').text(), project.frontmatter.methods.join(' · '));
  }
});

test('advanced HTML is displayed as escaped code rather than raw DOM', () => {
  const rendered = renderSafeBlock({ type: 'advanced', raw: '<script>alert("unsafe")</script>' });
  assert.equal(rendered, '<pre><code>&lt;script&gt;alert(&quot;unsafe&quot;)&lt;/script&gt;</code></pre>');
  assert.doesNotMatch(rendered, /<script>/);
});
