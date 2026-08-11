import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { distRoot, readDist } from './helpers.mjs';

const projectIds = [
  'communication-system-modelling',
  'future-ocean-habitat',
  'life-support-system',
];

const routes = projectIds.map((id) => `projects/${id}/index.html`);

function mainContent(html) {
  const match = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/);
  assert.ok(match, 'expected a main element');
  return match[1];
}

function headingElements(html) {
  return [...mainContent(html).matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/g)].map((match) => ({
    level: Number(match[1]),
    text: match[2],
  }));
}

function sectionContent(html, heading) {
  const match = mainContent(html).match(
    new RegExp(`<section\\b[^>]*>\\s*<h2\\b[^>]*>${heading}<\\/h2>([\\s\\S]*?)<\\/section>`),
  );
  assert.ok(match, `expected a ${heading} section`);
  return match[1];
}

test('projects index and exactly the approved detail routes are generated', async () => {
  const index = await readDist('projects/index.html');
  assert.match(index, /Future Ocean Habitat/);
  assert.match(index, /Life-Support System/);
  assert.match(index, /Communication-System Modelling/);
  for (const route of routes) assert.ok((await readDist(route)).includes('<h1'));

  const entries = await readdir(path.join(distRoot, 'projects'), { withFileTypes: true });
  const generatedIds = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  assert.deepEqual(generatedIds, projectIds);
});

test('project lists use a semantic heading hierarchy', async () => {
  const projectsIndexHeadings = headingElements(await readDist('projects/index.html'));
  assert.deepEqual(projectsIndexHeadings.map(({ level }) => level), [1, 2, 2, 2]);
  assert.match(projectsIndexHeadings[1].text, /Future Ocean Habitat/);
  assert.match(projectsIndexHeadings[2].text, /Life-Support System/);
  assert.match(projectsIndexHeadings[3].text, /Communication-System Modelling/);

  const homepageHeadings = headingElements(await readDist('index.html'));
  assert.deepEqual(homepageHeadings.map(({ level }) => level), [1, 2, 3, 3, 3]);
  assert.equal(homepageHeadings[1].text, 'Selected Projects');
});

test('project pages preserve the approved evidence-section heading order', async () => {
  const sectionHeadings = [
    'Overview',
    'My Contribution',
    'Technical Approach',
    'Results &amp; Validation',
    'Evidence Gallery',
    'Reflection &amp; Next Steps',
  ];

  for (const route of routes) {
    const headings = headingElements(await readDist(route));
    assert.equal(headings[0].level, 1, `${route} must begin its main content with an h1`);
    assert.deepEqual(headings.slice(1), sectionHeadings.map((text) => ({ level: 2, text })));
  }
});

test('project pages expose verified contribution and result boundaries', async () => {
  const group = await readDist(routes[1]);
  assert.match(group, /Group project/);
  const groupContribution = sectionContent(group, 'My Contribution');
  assert.match(groupContribution, /Group Coordinator/);
  assert.match(groupContribution, /WP3 Energy, WP5 Systems, and WP6B Underwater Data Centre/);
  assert.match(groupContribution, /team output/);
  const groupResults = sectionContent(group, 'Results &amp; Validation');
  assert.match(groupResults, /concept-design calculations/);
  assert.match(groupResults, /not measured operating results/);

  const life = await readDist(routes[2]);
  assert.match(life, /Individual design/);
  const lifeResults = sectionContent(life, 'Results &amp; Validation');
  assert.match(lifeResults, /97\.7%/);
  assert.match(lifeResults, /documented model configuration/);
  assert.match(lifeResults, /simulation result and is not presented as measured physical-system efficiency/);
  assert.doesNotMatch(lifeResults, /(?:is|was|achieved) (?:a )?(?:measured|experimental)\b/i);

  const communication = await readDist(routes[0]);
  assert.match(communication, /Individual laboratory/);
  const communicationResults = sectionContent(communication, 'Results &amp; Validation');
  assert.match(communicationResults, /average BER of 0\.0593/);
  assert.match(communicationResults, /lowest reported MSE of 4\.04 [^0-9]+ 10\^-2/);
  assert.match(communicationResults, /tested filters and parameter ranges/);
  assert.match(communicationResults, /simulated signal, noise conditions, parameter ranges, and evaluation method/);
  assert.doesNotMatch(
    communicationResults,
    /\b(?:experimentally|experimental|measured|physical-system|physical system|real-world|real world|operational|hardware|field[- ]tested)\b/i,
  );
});
