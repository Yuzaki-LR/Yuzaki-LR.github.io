import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { load } from 'cheerio';
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
  return [...html.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/g)].map((match) => ({
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
  const projectsIndexHeadings = headingElements(mainContent(await readDist('projects/index.html')));
  assert.deepEqual(projectsIndexHeadings.map(({ level }) => level), [1, 2, 2, 2]);
  assert.match(projectsIndexHeadings[1].text, /Future Ocean Habitat/);
  assert.match(projectsIndexHeadings[2].text, /Life-Support System/);
  assert.match(projectsIndexHeadings[3].text, /Communication-System Modelling/);

  const selectedProjects = headingElements(
    sectionContent(await readDist('index.html'), 'Selected Projects'),
  );
  assert.deepEqual(selectedProjects.map(({ level }) => level), [3, 3, 3]);
  assert.match(selectedProjects[0].text, /Future Ocean Habitat/);
  assert.match(selectedProjects[1].text, /Life-Support System/);
  assert.match(selectedProjects[2].text, /Communication-System Modelling/);
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
    const headings = headingElements(mainContent(await readDist(route)));
    assert.equal(headings[0].level, 1, `${route} must begin its main content with an h1`);
    assert.deepEqual(headings.slice(1), sectionHeadings.map((text) => ({ level: 2, text })));
  }
});

test('project summaries use a readable middle dot between methods and tools', async () => {
  const expectedTools = {
    'projects/communication-system-modelling/index.html':
      'MATLAB · Signal processing · BER and MSE analysis',
    'projects/future-ocean-habitat/index.html':
      'Systems engineering · Requirements analysis · Concept design',
    'projects/life-support-system/index.html':
      'MATLAB Simulink · Simscape · Closed-loop control',
  };

  for (const route of routes) {
    const $ = load(await readDist(route));
    const main = $('main#main-content');
    assert.equal(main.length, 1, `${route} must have exactly one main#main-content`);

    const summary = main.find('dl.project-summary');
    assert.equal(summary.length, 1, `${route} must have exactly one project summary`);

    const labels = summary.find('dt').filter((_, element) =>
      $(element).text().replace(/\s+/g, ' ').trim() === 'Methods and tools');
    assert.equal(labels.length, 1, `${route} must have exactly one Methods and tools label`);

    const row = labels.first().parent();
    const values = row.children('dd');
    assert.equal(values.length, 1, `${route} must have exactly one associated tools value`);
    assert.equal(labels.first().next('dd').length, 1, `${route} tools value must follow its label`);

    const text = values.text().replace(/\s+/g, ' ').trim();
    assert.equal(text, expectedTools[route]);
    assert.doesNotMatch(text, /\u8def/, `${route} must not render U+8DEF as a separator`);
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
