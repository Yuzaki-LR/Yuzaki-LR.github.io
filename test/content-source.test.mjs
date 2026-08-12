import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { loadProjects } from '../src/lib/content/repository.mjs';
import { projectRoot } from './helpers.mjs';

const expected = [
  ['future-ocean-habitat', 'team', 'Team systems-design project'],
  ['life-support-system', 'individual', 'Individual detailed-design project'],
  ['communication-system-modelling', 'individual', 'Individual laboratory project'],
];

test('canonical projects load dynamically in declared order with stable folder slugs', async () => {
  const projects = await loadProjects();
  assert.deepEqual(projects.map(({ slug, frontmatter }) => [slug, frontmatter.kind, frontmatter.category]), expected);
  assert.deepEqual(projects.map(({ frontmatter }) => frontmatter.order), [1, 2, 3]);
  for (const project of projects) {
    assert.ok(project.sections.length > 0);
    assert.ok(project.sections.every((section) => section.blocks.some((block) => !block.hidden)));
  }
});

test('public project records exclude private or raw-source material', async () => {
  const sources = await Promise.all(expected.map(([slug]) => readFile(path.join(projectRoot, 'src', 'content', 'projects', slug, 'index.md'), 'utf8')));
  const corpus = sources.join('\n');
  assert.doesNotMatch(corpus, /\b\d{7}\b|OneDrive|student number|grading|assignment instructions/i);
  assert.doesNotMatch(corpus, /(?:[A-Z]:[\\/]|file:\/\/|\.pdf\b)/i);
});

test('manuscript record retains the exact submitted status', async () => {
  const source = await readFile(path.join(projectRoot, 'src', 'content', 'research', 'more-electric-aircraft.md'), 'utf8');
  assert.match(source, /Submitted manuscript — Under editorial review/);
  assert.doesNotMatch(source, /under peer review|accepted|in press|published/i);
});
