import test from 'node:test';
import assert from 'node:assert/strict';
import { readBuiltCss, readDist } from './helpers.mjs';

test('homepage renders the approved academic shell', async () => {
  const html = await readDist('index.html');
  assert.match(html, /<html lang="en">/);
  assert.match(html, /href="#main-content"[^>]*>Skip to main content/);
  assert.match(html, /<main id="main-content"/);
  assert.match(html, /Yunxi Wu/);
  assert.match(html, /BEng Electronic and Electrical Engineering/);
  assert.match(html, /University of Birmingham/);
  assert.match(html, /mailto:yxw1331@student\.bham\.ac\.uk/);
  assert.match(html, />About<.*>Projects<.*>Research</s);
  assert.match(html, /(?:\u00A9|&copy;)\s+\d{4}\s+Yunxi Wu/);
  assert.doesNotMatch(html, /\u6F0F/);
  assert.doesNotMatch(html, /\bCV\b/i);
});

test('homepage declares an emitted favicon to avoid an implicit missing favicon request', async () => {
  const html = await readDist('index.html');
  assert.match(html, /<link rel="icon" href="\/favicon\.svg"/);
  assert.match(await readDist('favicon.svg'), /<svg\b/);
});

test('built CSS uses the approved restrained typography', async () => {
  const css = await readBuiltCss();
  assert.match(css, /Times New Roman/);
  assert.match(css, /#2d587a/i);
  assert.doesNotMatch(css, /linear-gradient|radial-gradient|@keyframes/i);
});

test('built CSS gives project-row h2 and h3 titles the former h3 treatment', async () => {
  const css = await readBuiltCss();
  const headingRule = css.match(/\.project-row h2,\.project-row h3\{([^}]*)\}/)?.[1] ?? '';
  assert.match(headingRule, /margin:0/);
  assert.match(headingRule, /padding:0/);
  assert.match(headingRule, /border:0/);
  assert.match(headingRule, /font-size:1\.18rem/);
  assert.match(headingRule, /font-weight:700/);
});
