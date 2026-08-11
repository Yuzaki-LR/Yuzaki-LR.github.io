import test from 'node:test';
import assert from 'node:assert/strict';
import { site } from '../src/data/site.mjs';

test('site identity contains only verified public profile facts', () => {
  assert.equal(site.name, 'Yunxi Wu');
  assert.equal(site.degree, 'BEng Electronic and Electrical Engineering');
  assert.equal(site.institution, 'University of Birmingham');
  assert.equal(site.email, 'yxw1331@student.bham.ac.uk');
  assert.deepEqual(site.interests, ['Embodied AI', 'Computer Vision', 'Robotics']);
});

test('primary navigation has the approved three routes and no CV', () => {
  assert.deepEqual(site.navigation, [
    { label: 'About', href: '/' },
    { label: 'Projects', href: '/projects/' },
    { label: 'Research', href: '/research/' },
  ]);
  assert.doesNotMatch(JSON.stringify(site), /\bCV\b/i);
});

test('intro distinguishes current engineering work from future research direction', () => {
  assert.match(site.intro, /systems design, modelling, control, and signal processing/);
  assert.match(site.intro, /developing toward research/);
  assert.doesNotMatch(site.intro, /researcher in|specialist in|expert in/i);
});
