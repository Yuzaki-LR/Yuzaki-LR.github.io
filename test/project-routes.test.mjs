import test from 'node:test';
import assert from 'node:assert/strict';
import { readDist } from './helpers.mjs';

const routes = [
  'projects/future-ocean-habitat/index.html',
  'projects/life-support-system/index.html',
  'projects/communication-system-modelling/index.html',
];

test('projects index and three detail routes are generated', async () => {
  const index = await readDist('projects/index.html');
  assert.match(index, /Future Ocean Habitat/);
  assert.match(index, /Life-Support System/);
  assert.match(index, /Communication-System Modelling/);
  for (const route of routes) assert.ok((await readDist(route)).includes('<h1'));
});

test('project pages preserve the approved evidence-section order', async () => {
  for (const route of routes) {
    const html = await readDist(route);
    const headings = [
      'Overview',
      'My Contribution',
      'Technical Approach',
      'Results &amp; Validation',
      'Evidence Gallery',
      'Reflection &amp; Next Steps',
    ];
    let previous = -1;
    for (const heading of headings) {
      const position = html.indexOf(heading);
      assert.ok(position > previous, `${route} has an incorrect section order at ${heading}`);
      previous = position;
    }
  }
});

test('project pages expose verified contribution and result boundaries', async () => {
  const group = await readDist(routes[0]);
  assert.match(group, /Group project/);
  assert.match(group, /Group Coordinator/);
  assert.match(group, /WP3 Energy, WP5 Systems, and WP6B Underwater Data Centre/);
  assert.match(group, /team output/);

  const life = await readDist(routes[1]);
  assert.match(life, /Individual design/);
  assert.match(life, /97\.7%/);
  assert.match(life, /simulation result/);

  const communication = await readDist(routes[2]);
  assert.match(communication, /Individual laboratory/);
  assert.match(communication, /0\.0593/);
  assert.match(communication, /4\.04 × 10\^-2/);
});
