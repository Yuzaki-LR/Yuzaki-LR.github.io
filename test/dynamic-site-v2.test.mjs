import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { load } from 'cheerio';
import { loadProjects, loadSiteRepository } from '../src/lib/content/repository.mjs';
import { toPublicAssetHref } from '../src/lib/content/asset-routes.mjs';
import { projectRoot, readBuiltRoute } from './helpers.mjs';

function visibleSections(project) {
  return project.sections.filter((section) => (
    !section.hidden && section.blocks.some((block) => !block.hidden)
  ));
}

function visibleImages(project) {
  return visibleSections(project).flatMap((section) => section.blocks)
    .filter((block) => !block.hidden && block.type === 'image');
}

function imageSource(block) {
  const source = block.markdown.match(/^!\[[^\]]*\]\(([^)]+)\)/m)?.[1];
  assert.ok(source, 'visible image block must contain Markdown image syntax');
  return source;
}

test('project documents expose canonical semantic sections and keyboard-reachable owned evidence', async () => {
  for (const project of await loadProjects()) {
    const $ = load(await readBuiltRoute(`/projects/${project.slug}/`));
    const sections = visibleSections(project);
    const images = visibleImages(project);

    assert.equal($('main h1').length, 1, `${project.slug} must have one main h1`);
    assert.deepEqual(
      $('main > section > h2').map((_, element) => $(element).text().trim()).get(),
      sections.map((section) => section.title),
      `${project.slug} must preserve canonical visible section order`,
    );
    assert.equal($('main section:empty, main figure:empty').length, 0, `${project.slug} must not emit empty structure`);
    assert.equal(
      $('main h3').filter((_, element) => $(element).closest('section').children('h2').length !== 1).length,
      0,
      `${project.slug} h3 headings must belong to an h2 section`,
    );

    const linkedImages = $('main figure > a[href] > img[alt]');
    assert.equal(linkedImages.length, images.length, `${project.slug} evidence must link to full-size images`);
    linkedImages.each((index, image) => {
      const expected = toPublicAssetHref({
        kind: 'project',
        slug: project.slug,
        relativeSource: imageSource(images[index]),
      });
      assert.equal($(image).attr('src'), expected, `${project.slug} image must use its owned asset route`);
      assert.equal($(image).parent('a').attr('href'), expected, `${project.slug} full-size link must target the rendered asset`);
      assert.notEqual(($(image).attr('alt') ?? '').trim(), '', `${project.slug} image alt must not be empty`);
    });

    assert.equal($('[data-block-id], [data-section-kind], [data-editor-id]').length, 0, `${project.slug} must not expose editor identifiers`);
    assert.doesNotMatch($.html(), /<!--\s*editor:/i, `${project.slug} must not expose editor markers`);
  }
});

test('project lists follow canonical order without fixed project assumptions', async () => {
  const projects = await loadProjects();
  const expectedHrefs = projects.map((project) => `/projects/${project.slug}/`);
  const $ = load(await readBuiltRoute('/projects/'));
  assert.deepEqual(
    $('.project-list .project-row h2 a').map((_, element) => $(element).attr('href')).get(),
    expectedHrefs,
  );
});

test('public shell emits actual canonical theme values and collapses absent optional profile fields', async () => {
  const repository = await loadSiteRepository();
  const $ = load(await readBuiltRoute('/'));
  const style = $('body').attr('style') ?? '';
  const expectedTheme = {
    background: repository.site.theme.background,
    surface: repository.site.theme.surface,
    text: repository.site.theme.text,
    accent: repository.site.theme.accent,
    focus: repository.site.theme.focus ?? repository.site.theme.accent,
  };
  for (const [name, value] of Object.entries(expectedTheme)) {
    assert.match(style, new RegExp(`--${name}\\s*:\\s*${value.replace('#', '\\#')}(?:;|$)`, 'i'));
  }

  assert.equal($('.profile-sidebar section:empty, .profile-sidebar li:empty, .profile-sidebar a[href=""]').length, 0);
  if (!repository.site.links.github) assert.equal($('.profile-sidebar a').filter((_, element) => $(element).text().trim() === 'GitHub').length, 0);
  if (!repository.site.links.linkedin) assert.equal($('.profile-sidebar a').filter((_, element) => $(element).text().trim() === 'LinkedIn').length, 0);
});

test('responsive CSS prevents content overflow without hiding document overflow', async () => {
  const css = await readFile(path.join(projectRoot, 'src', 'styles', 'global.css'), 'utf8');
  assert.doesNotMatch(css, /(?:html|body)[^{]*\{[^}]*overflow-x\s*:\s*(?:hidden|clip)/is);
  assert.match(css, /(?:img|\.evidence-grid\s+img)[^{]*\{[^}]*max-width\s*:\s*100%/is);
  assert.match(css, /(?:pre|table)[^{]*\{[^}]*overflow-x\s*:\s*auto/is);
});
