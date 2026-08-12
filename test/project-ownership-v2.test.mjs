import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import { load } from 'cheerio';
import { loadProjectFixture, projectRoot, readBuiltRoute } from './helpers.mjs';
import { validateProject } from '../src/lib/content/schema.mjs';

const individuals = ['life-support-system', 'communication-system-modelling'];

async function sourceRecord(slug) {
  const nested = path.join(projectRoot, 'src', 'content', 'projects', slug, 'index.md');
  try { return { nested: true, source: await readFile(nested, 'utf8') }; }
  catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    return { nested: false, source: await readFile(path.join(projectRoot, 'src', 'content', 'projects', `${slug}.md`), 'utf8') };
  }
}

test('individual projects expose no contribution surface in source, semantics, or DOM', async () => {
  for (const slug of individuals) {
    const record = await sourceRecord(slug);
    if (record.nested) {
      const project = await loadProjectFixture(slug);
      assert.equal(project.sections.some((section) => section.kind === 'contribution'), false);
    } else {
      assert.equal((matter(record.source).data.contributions ?? []).length, 0);
    }
    assert.doesNotMatch(record.source, /kind="contribution"|^contributions:/m);
    const $ = load(await readBuiltRoute(`/projects/${slug}/`));
    assert.equal($('[data-section-kind="contribution"]').length, 0);
  }
});

test('team project has exactly one protected contribution and no internal code', async () => {
  const record = await sourceRecord('future-ocean-habitat');
  if (record.nested) {
    const project = await loadProjectFixture('future-ocean-habitat');
    const contributions = project.sections.filter((section) => section.kind === 'contribution');
    assert.equal(contributions.length, 1);
    assert.equal(contributions[0].title, 'My Role and Contribution');
  }
  assert.equal((record.source.match(/kind="contribution"/g) ?? []).length, 1);
  assert.doesNotMatch(record.source, /\bWP\d+[A-Z]?\b/);
  const $ = load(await readBuiltRoute('/projects/future-ocean-habitat/'));
  const contribution = $('[data-section-kind="contribution"]');
  assert.equal(contribution.length, 1);
  assert.equal(contribution.find('h2').text().trim(), 'My Role and Contribution');
  assert.notEqual(contribution.clone().children('h2').remove().end().text().trim(), '');
  assert.doesNotMatch($.root().text(), /\bWP\d+[A-Z]?\b/);
});

test('team contribution requires actual non-empty visible text', () => {
  const document = {
    frontmatter: { kind: 'team', category: 'Team', title: 'Fixture', shortTitle: 'Fixture', summary: 'Fixture', role: 'Fixture', methods: ['Fixture'], featured: false, order: 1 },
    sections: [
      { id: 'fixture-standard', kind: 'standard', hidden: false, title: 'Context', blocks: [{ id: 'fixture-context', type: 'paragraph', hidden: false, markdown: 'Context.' }] },
      { id: 'fixture-contribution', kind: 'contribution', hidden: false, title: 'My Role and Contribution', blocks: [{ id: 'fixture-empty-text', type: 'paragraph', hidden: false, markdown: '   ' }] },
    ],
  };
  assert.throws(() => validateProject(document), /contribution.*non-empty visible text/i);
});
