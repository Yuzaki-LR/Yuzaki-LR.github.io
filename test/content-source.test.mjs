import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import { projectRoot } from './helpers.mjs';

const projectCases = [
  {
    file: 'future-ocean-habitat.md',
    type: 'Group project',
    role: 'Group Coordinator / Lead for WP3 Energy, WP5 Systems, and WP6B Underwater Data Centre',
    result: '250 kW',
  },
  {
    file: 'life-support-system.md',
    type: 'Individual design',
    role: 'Individual detailed design and simulation',
    result: '97.7%',
  },
  {
    file: 'communication-system-modelling.md',
    type: 'Individual laboratory',
    role: 'Individual modelling, implementation, and analysis',
    result: '0.0593',
  },
];

const projectSections = [
  'overview',
  'contributions',
  'technicalApproach',
  'results',
  'evidence',
  'reflection',
];

async function readRecord(collection, file) {
  const source = await readFile(path.join(projectRoot, 'src', 'content', collection, file), 'utf8');
  return matter(source).data;
}

test('project records expose approved roles, six structured sections, and verified results', async () => {
  for (const project of projectCases) {
    const data = await readRecord('projects', project.file);
    assert.equal(data.type, project.type);
    assert.equal(data.role, project.role);
    assert.ok(projectSections.every((section) => Array.isArray(data[section]) && data[section].length > 0));
    assert.ok(data.results.some((result) => result.includes(project.result)));
    assert.ok(data.evidence.every(({ src, alt, caption }) => (
      src.startsWith('/assets/projects/') && alt.length >= 20 && caption.length >= 20
    )));
  }
});

test('manuscript record exposes the exact title and editorial status', async () => {
  const data = await readRecord('research', 'more-electric-aircraft.md');
  assert.equal(
    data.title,
    'Progress on More Electric Aircraft Power Systems at High Energy Density and Carbon Emission: Challenges and Opportunities',
  );
  assert.equal(data.status, 'Submitted manuscript – Under editorial review');
  assert.equal(data.authorship, 'First-author review manuscript');
  assert.equal(data.scope.length, 3);
  assert.doesNotMatch(JSON.stringify(data), /under peer review|accepted|in press|published/i);
});

test('structured content data excludes sensitive source-document data', async () => {
  const records = await Promise.all([
    ...projectCases.map(({ file }) => readRecord('projects', file)),
    readRecord('research', 'more-electric-aircraft.md'),
  ]);
  const publishedData = JSON.stringify(records);
  assert.doesNotMatch(publishedData, /2775688|OneDrive|IDP2 Assignment|student number/i);
  assert.doesNotMatch(publishedData, /Zhigang Zeng|Cheng Yan|Junyu Wang|Jie Li/i);
});
