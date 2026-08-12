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
    assertions: (data) => {
      assert.ok(data.contributions.includes('Contributed to WP1 and WP2.'));
      assert.ok(data.contributions.includes(
        'The complete habitat report was a team output; this page presents only the responsibilities and evidence attributable to Yunxi Wu.',
      ));
      assert.ok(data.results.some((result) => result.includes('250 kW')));
    },
  },
  {
    file: 'life-support-system.md',
    type: 'Individual design',
    role: 'Individual detailed design and simulation',
    assertions: (data) => {
      assert.ok(data.technicalApproach.some((approach) => approach.includes('180 V DC')));
      assert.ok(data.results.some((result) => (
        result.includes('Under the documented model configuration')
        && result.includes('97.7%')
        && result.includes('simulation result')
      )));
    },
  },
  {
    file: 'communication-system-modelling.md',
    type: 'Individual laboratory',
    role: 'Individual modelling, implementation, and analysis',
    assertions: (data) => {
      assert.ok(data.results.some((result) => (
        result.includes('average BER of 0.0593')
        && result.includes('MSE of 4.04 × 10^-2')
      )));
      assert.ok(data.results.some((result) => result.includes(
        'limited to the simulated signal, noise conditions, parameter ranges, and evaluation method',
      )));
    },
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

const approvedEvidenceSource = /^\/assets\/projects\/[a-z0-9]+(?:-[a-z0-9]+)*\.png$/;
const privateIdentifierPattern = /\b\d{7}\b/u;
const nonPublicNameSentinelPattern = new RegExp(['Private', 'Collaborator'].join('\\s+'), 'i');

async function readRecord(collection, file) {
  const source = await readFile(path.join(projectRoot, 'src', 'content', collection, file), 'utf8');
  return matter(source);
}

function privacyScanRecord({ data, content }) {
  const { evidence = [], ...remainingData } = data;
  const remainingEvidence = evidence.map(({ src, ...entry }) => (
    approvedEvidenceSource.test(src) ? entry : { ...entry, src }
  ));
  return JSON.stringify({ data: { ...remainingData, evidence: remainingEvidence }, content });
}

test('project records expose approved roles, six structured sections, and verified results', async () => {
  for (const project of projectCases) {
    const { data } = await readRecord('projects', project.file);
    assert.equal(data.type, project.type);
    assert.equal(data.role, project.role);
    assert.ok(projectSections.every((section) => Array.isArray(data[section]) && data[section].length > 0));
    project.assertions(data);
    assert.ok(data.evidence.every(({ src, alt, caption }) => (
      approvedEvidenceSource.test(src) && alt.length >= 20 && caption.length >= 20
    )));
  }
});

test('manuscript record exposes the exact title and editorial status', async () => {
  const { data } = await readRecord('research', 'more-electric-aircraft.md');
  assert.equal(
    data.title,
    'Progress on More Electric Aircraft Power Systems at High Energy Density and Carbon Emission: Challenges and Opportunities',
  );
  assert.equal(data.status, 'Submitted manuscript \u2014 Under editorial review');
  assert.notEqual(data.status, 'Submitted manuscript \u2013 Under editorial review');
  assert.equal(data.authorship, 'First-author review manuscript');
  assert.equal(data.scope.length, 3);
  assert.doesNotMatch(JSON.stringify(data), /under peer review|accepted|in press|published/i);
});

test('parsed frontmatter and Markdown body exclude sensitive source-document data', async () => {
  const records = await Promise.all([
    ...projectCases.map(({ file }) => readRecord('projects', file)),
    readRecord('research', 'more-electric-aircraft.md'),
  ]);
  const publishedRecord = records.map(privacyScanRecord).join('\n');
  assert.doesNotMatch(publishedRecord, privateIdentifierPattern);
  assert.doesNotMatch(publishedRecord, /OneDrive|IDP2 Assignment|student number/i);
  assert.doesNotMatch(publishedRecord, nonPublicNameSentinelPattern);
  assert.doesNotMatch(
    publishedRecord,
    /(?:[A-Z]:[\\/]|\\\\[^\\/\s]+[\\/]|(?:^|[\s"'(])(?:\.\.?[\\/]|~[\\/]|\/(?:home|Users)\/)|file:\/\/)/i,
  );
  assert.doesNotMatch(publishedRecord, /\.pdf(?:\b|[?#])/i);
});
