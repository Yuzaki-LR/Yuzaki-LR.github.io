import test from 'node:test';
import assert from 'node:assert/strict';
import { readDist } from './helpers.mjs';

const manuscriptTitle = 'Progress on More Electric Aircraft Power Systems at High Energy Density and Carbon Emission: Challenges and Opportunities';
const exactStatus = 'Submitted manuscript \u2014 Under editorial review';

test('research page separates interests, ongoing work, and manuscript status', async () => {
  const html = await readDist('research/index.html');
  assert.match(html, /Research Interests/);
  assert.match(html, /Embodied AI/);
  assert.match(html, /Computer Vision/);
  assert.match(html, /Robotics/);
  assert.match(html, /Ongoing Work/);
  assert.ok(html.includes(manuscriptTitle));
  assert.ok(html.includes(exactStatus));
  assert.match(html, /First-author review manuscript/);
  assert.doesNotMatch(html, /under peer review|accepted|in press|published/i);
});

test('homepage includes the exact manuscript entry without a Publications heading', async () => {
  const html = await readDist('index.html');
  assert.ok(html.includes(manuscriptTitle));
  assert.ok(html.includes(exactStatus));
  assert.doesNotMatch(html, /<h[1-6][^>]*>\s*Publications\s*<\/h[1-6]>/i);
});
