import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from 'cheerio';
import { parseProjectFile } from '../src/lib/content/project-file.mjs';
import { validateProject } from '../src/lib/content/schema.mjs';
import { renderSafeBlock } from '../src/lib/content/safe-render.mjs';

function projectWith(markdown, type = 'paragraph') {
  return `---
kind: individual
category: Security fixture
title: Safe link fixture
shortTitle: Safe links
summary: Safe renderer behavior fixture.
role: Test fixture
methods: [Markdown]
featured: false
order: 99
---
<!-- editor:section id="safe-links-section" kind="standard" hidden="false" -->
## Safe links
<!-- editor:block id="safe-links-content" type="${type}" hidden="false" -->
${markdown}
`;
}

function parseValidateRender(markdown, base = '/repo/') {
  const project = parseProjectFile(projectWith(markdown));
  validateProject(project);
  return renderSafeBlock(project.sections[0].blocks[0], { projectSlug: 'safe-link-fixture', base });
}

test('validated project links reject executable schemes at the render boundary', () => {
  const dangerous = [
    '<javascript:alert(1)>',
    '<JaVaScRiPt:alert(1)>',
    '<data:text/html,boom>',
    '<vbscript:msgbox(1)>',
    '[label](javascript:alert(1))',
    '[label](jav&#x61;script:alert(1))',
    '[label](javascript&#58;alert(1))',
    '[label](java%73cript:alert(1))',
    '[label](java%0Dscript:alert(1))',
    '[label](%6aavascript:alert(1))',
    '[label](DATA:text/html,boom)',
  ];
  for (const markdown of dangerous) {
    const html = parseValidateRender(markdown);
    const $ = load(html);
    assert.equal($('a').length, 0, markdown);
    assert.match($.text(), /label|javascript|data|vbscript/i, markdown);
    assert.doesNotMatch(html, /href\s*=\s*["'][^"']*(?:javascript|data|vbscript)/i, markdown);
  }
});

test('validated project links preserve only explicit public and confined internal destinations', () => {
  const html = parseValidateRender('[web](https://example.com/?a=1&b=2) [mail](mailto:person@example.com) [root](/projects/) [relative](notes/methods) [fragment](#results)');
  const $ = load(html);
  assert.deepEqual($('a').map((_, element) => $(element).attr('href')).get(), [
    'https://example.com/?a=1&b=2',
    'mailto:person@example.com',
    '/repo/projects/',
    'notes/methods',
    '#results',
  ]);
  assert.match(html, /a=1&amp;b=2/);
});

test('project image blocks still route only through the Task 3 confined asset mapper', () => {
  const project = parseProjectFile(projectWith('![A confined project result](./images/result.png)', 'image'));
  validateProject(project);
  const html = renderSafeBlock(project.sections[0].blocks[0], { projectSlug: 'safe-link-fixture', base: '/repo/' });
  const $ = load(html);
  assert.equal($('img').attr('src'), '/repo/assets/projects/safe-link-fixture/result.png');
});

test('image blocks accept only one exact image with an optional following caption', () => {
  const accepted = parseProjectFile(projectWith('![A confined result](./images/result.png)\nA concise evidence caption.', 'image'));
  assert.doesNotThrow(() => validateProject(accepted));
  const acceptedHtml = renderSafeBlock(accepted.sections[0].blocks[0], { projectSlug: 'safe-link-fixture' });
  assert.equal(load(acceptedHtml)('figcaption').text(), 'A concise evidence caption.');

  const trailing = parseProjectFile(projectWith('![A confined result](./images/result.png) trailing prose', 'image'));
  assert.throws(() => validateProject(trailing), /image block syntax/i);

  const malformedHtml = renderSafeBlock(trailing.sections[0].blocks[0], { projectSlug: 'safe-link-fixture' });
  const $ = load(malformedHtml);
  assert.equal($('figure, img').length, 0);
  assert.match($('pre code').text(), /trailing prose/);
});
