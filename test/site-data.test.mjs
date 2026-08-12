import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSiteRepository } from '../src/lib/content/repository.mjs';
import { toPublicSiteModel } from '../src/lib/content/render-model.mjs';

async function loadSite() {
  return toPublicSiteModel(await loadSiteRepository({ contentRoot: new URL('../src/content/', import.meta.url) }));
}

test('site identity contains only verified public profile facts', async () => {
  const site = await loadSite();
  assert.equal(site.profile.name, 'Yunxi Wu');
  assert.equal(site.profile.degree, 'BEng Electronic and Electrical Engineering');
  assert.equal(site.profile.institution, 'University of Birmingham');
  assert.equal(site.profile.email, 'yxw1331@student.bham.ac.uk');
  assert.deepEqual(site.profile.interests, ['Embodied AI', 'Machine Learning', 'Computer Vision', 'Robotics']);
});

test('primary navigation has the approved three routes and no CV', async () => {
  const site = await loadSite();
  assert.deepEqual(site.navigation, [
    { label: 'About', href: '/' },
    { label: 'Projects', href: '/projects/' },
    { label: 'Research', href: '/research/' },
  ]);
  assert.doesNotMatch(JSON.stringify(site), /\bCV\b/i);
});

test('intro distinguishes current engineering work from future research direction', async () => {
  const site = await loadSite();
  assert.match(site.profile.intro, /systems modelling, control and signal processing/);
  assert.match(site.profile.intro, /developing toward research/);
  assert.doesNotMatch(site.profile.intro, /researcher in|specialist in|expert in/i);
});
