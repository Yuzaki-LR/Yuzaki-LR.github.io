import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { load } from 'cheerio';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distRoot = path.join(projectRoot, 'dist');

const generatedRoutes = [
  '404.html',
  'index.html',
  'projects/communication-system-modelling/index.html',
  'projects/future-ocean-habitat/index.html',
  'projects/index.html',
  'projects/life-support-system/index.html',
  'research/index.html',
];

const approvedImages = [
  '/assets/projects/communication-channel-capacity.png',
  '/assets/projects/communication-filter-results.png',
  '/assets/projects/future-ocean-habitat-master-system.png',
  '/assets/projects/future-ocean-habitat-udc-flow.png',
  '/assets/projects/life-support-efficiency.png',
  '/assets/projects/life-support-hvac-control.png',
];

const expectedCurrentNavigation = new Map([
  ['404.html', null],
  ['index.html', 'About'],
  ['projects/communication-system-modelling/index.html', 'Projects'],
  ['projects/future-ocean-habitat/index.html', 'Projects'],
  ['projects/index.html', 'Projects'],
  ['projects/life-support-system/index.html', 'Projects'],
  ['research/index.html', 'Research'],
]);

function normalizedText(value) {
  return value.replace(/[\t\n\f\r ]+/g, ' ').trim();
}

function classTokens(element) {
  const value = element.attr('class') ?? '';
  return value.trim() === '' ? [] : value.trim().split(/[\t\n\f\r ]+/);
}

function exactlyOne(elements, description) {
  assert.equal(elements.length, 1, `expected exactly one ${description}, found ${elements.length}`);
  return elements.eq(0);
}

async function recursiveHtmlFiles(directory, prefix = '') {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const relativePath = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      files.push(...await recursiveHtmlFiles(path.join(directory, entry.name), relativePath));
    } else if (entry.isFile() && entry.name.endsWith('.html')) {
      files.push(relativePath);
    }
  }

  return files.sort();
}

async function generatedDocuments() {
  const documents = [];

  for (const route of generatedRoutes) {
    const filename = path.join(distRoot, ...route.split('/'));
    assert.ok(existsSync(filename), `expected generated document ${route}`);
    const raw = await readFile(filename, 'utf8');
    documents.push({ route, raw, $: load(raw, { sourceCodeLocationInfo: true }) });
  }

  return documents;
}

function routeUrl(route) {
  if (route === 'index.html') return '/';
  if (route.endsWith('/index.html')) return `/${route.slice(0, -'index.html'.length)}`;
  return `/${route}`;
}

async function assertInternalTargetExists(targetUrl, context) {
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(targetUrl.pathname);
  } catch {
    assert.fail(`${context} contains an invalid percent-encoded path`);
  }

  let relativePath = decodedPath.replace(/^\/+/, '');
  if (relativePath === '') relativePath = 'index.html';
  else if (decodedPath.endsWith('/')) relativePath = `${relativePath}index.html`;

  const target = path.resolve(distRoot, ...relativePath.split('/'));
  const relativeTarget = path.relative(distRoot, target);
  assert.ok(
    relativeTarget !== '..'
      && !relativeTarget.startsWith(`..${path.sep}`)
      && !path.isAbsolute(relativeTarget),
    `${context} escapes dist`,
  );
  assert.ok(existsSync(target), `${context} resolves to missing output ${relativePath}`);
  assert.ok((await stat(target)).isFile(), `${context} must resolve to a file`);
}

test('fresh build emits exactly the approved HTML route set', async () => {
  assert.deepEqual(await recursiveHtmlFiles(distRoot), generatedRoutes);
});

test('every generated document has exact identity, metadata, landmarks, and keyboard entry', async () => {
  for (const { route, $ } of await generatedDocuments()) {
    const html = exactlyOne($('html'), `${route} html element`);
    assert.ok(html[0].sourceCodeLocation, `${route} html element must be present in emitted markup`);
    assert.equal(html.attr('lang'), 'en', `${route} html lang`);

    const title = exactlyOne($('title'), `${route} title`);
    assert.notEqual(normalizedText(title.text()), '', `${route} title must not be empty`);
    const description = exactlyOne($('meta[name="description"]'), `${route} description meta`);
    assert.notEqual((description.attr('content') ?? '').trim(), '', `${route} description must not be empty`);

    const header = exactlyOne($('header'), `${route} header`);
    const nav = exactlyOne($('nav[aria-label="Primary"]'), `${route} primary navigation`);
    assert.equal(
      header.find('nav[aria-label="Primary"]')[0],
      nav[0],
      `${route} primary navigation must be inside header`,
    );
    const aside = exactlyOne($('aside[aria-label="Profile"]'), `${route} profile aside`);
    const main = exactlyOne($('main#main-content[tabindex="-1"]'), `${route} main landmark`);
    const footer = exactlyOne($('footer'), `${route} footer`);
    assert.ok(header[0] && nav[0] && aside[0] && main[0] && footer[0]);
    const mainTargets = $('[id="main-content"]');
    assert.equal(mainTargets.length, 1, `${route} must have one exact skip-link target id`);
    assert.equal(mainTargets[0], main[0], `${route} skip-link target must be the main landmark`);

    const skipLinks = $('a').filter((_, element) => classTokens($(element)).includes('skip-link'));
    const skipLink = exactlyOne(skipLinks, `${route} real skip link`);
    assert.equal(skipLink.attr('href'), '#main-content', `${route} skip-link href`);
    assert.equal(normalizedText(skipLink.text()), 'Skip to main content', `${route} skip-link text`);

    const email = exactlyOne(
      aside.find('a[href="mailto:yxw1331@student.bham.ac.uk"]'),
      `${route} verified profile email link`,
    );
    assert.equal(normalizedText(email.text()), 'yxw1331@student.bham.ac.uk', `${route} email text`);

    const documentH1 = exactlyOne($('h1'), `${route} document h1`);
    const mainH1 = exactlyOne(main.find('h1'), `${route} main h1`);
    assert.equal(documentH1[0], mainH1[0], `${route} document h1 must be inside main`);
  }
});

test('every main landmark follows an unskipped semantic heading hierarchy', async () => {
  for (const { route, $ } of await generatedDocuments()) {
    const main = exactlyOne($('main#main-content[tabindex="-1"]'), `${route} main landmark`);
    const headings = main.find('h1,h2,h3,h4,h5,h6').toArray();
    assert.ok(headings.length > 0, `${route} main must contain a heading`);
    assert.equal(headings[0].tagName.toLowerCase(), 'h1', `${route} first main heading must be h1`);

    let previousLevel = 1;
    for (const heading of headings.slice(1)) {
      const level = Number(heading.tagName.slice(1));
      assert.ok(
        level <= previousLevel + 1,
        `${route} heading ${normalizedText($(heading).text())} skips from h${previousLevel} to h${level}`,
      );
      previousLevel = level;
    }
  }
});

test('active navigation matches each generated route and remains scoped to primary navigation', async () => {
  for (const { route, $ } of await generatedDocuments()) {
    const nav = exactlyOne($('nav[aria-label="Primary"]'), `${route} primary navigation`);
    const currentElements = $('[aria-current]');
    const expectedText = expectedCurrentNavigation.get(route);

    if (expectedText === null) {
      assert.equal(currentElements.length, 0, `${route} must not mark a navigation link current`);
      continue;
    }

    const current = exactlyOne(currentElements, `${route} current navigation element`);
    assert.equal(current[0].tagName.toLowerCase(), 'a', `${route} current element must be an anchor`);
    assert.equal(current.attr('aria-current'), 'page', `${route} current link aria-current`);
    assert.equal(normalizedText(current.text()), expectedText, `${route} current link text`);
    assert.equal(
      nav.find('[aria-current]')[0],
      current[0],
      `${route} current link must be inside primary navigation`,
    );
  }
});

test('all real internal anchors resolve within the generated site and same-page fragments target exact ids', async () => {
  const origin = 'https://generated-site.invalid';

  for (const { route, $ } of await generatedDocuments()) {
    const baseUrl = new URL(routeUrl(route), origin);

    for (const anchor of $('a').toArray()) {
      const href = $(anchor).attr('href');
      assert.ok(href && href.trim() !== '', `${route} anchor must have a non-empty href`);
      if (/^mailto:/i.test(href)) continue;

      const targetUrl = new URL(href, baseUrl);
      if (/^https?:/i.test(targetUrl.protocol) && targetUrl.origin !== origin) continue;
      assert.equal(targetUrl.origin, origin, `${route} anchor ${href} uses an unsupported internal scheme`);
      await assertInternalTargetExists(targetUrl, `${route} anchor ${href}`);

      if (targetUrl.pathname === baseUrl.pathname && targetUrl.hash !== '') {
        const targetId = decodeURIComponent(targetUrl.hash.slice(1));
        const matches = $('[id]').filter((_, element) => $(element).attr('id') === targetId);
        assert.equal(matches.length, 1, `${route} fragment ${targetUrl.hash} must target one exact id`);
      }
    }
  }
});

test('all real images are accessible and the site emits each approved image source exactly once', async () => {
  const observedSources = [];
  const origin = 'https://generated-site.invalid';

  for (const { route, $ } of await generatedDocuments()) {
    const baseUrl = new URL(routeUrl(route), origin);

    for (const image of $('img').toArray()) {
      const element = $(image);
      const alt = (element.attr('alt') ?? '').trim();
      const source = (element.attr('src') ?? '').trim();
      assert.ok(alt.length >= 20, `${route} image alt must contain at least 20 trimmed characters`);
      assert.notEqual(source, '', `${route} image src must not be empty`);
      observedSources.push(source);

      const targetUrl = new URL(source, baseUrl);
      if (targetUrl.origin === origin) {
        await assertInternalTargetExists(targetUrl, `${route} image ${source}`);
      }
    }
  }

  assert.deepEqual(observedSources.sort(), approvedImages);
});

test('raw generated HTML excludes private identifiers, unsupported statuses, and local filesystem paths', async () => {
  const combined = (await generatedDocuments()).map(({ raw }) => raw).join('\n');
  const forbiddenPatterns = [
    /2775688/i,
    /OneDrive/i,
    /IDP2 Assignment/i,
    /student number/i,
    /Zhigang Zeng/i,
    /Cheng Yan/i,
    /Junyu Wang/i,
    /Jie Li/i,
    /\bCV\b/i,
    /\bunder peer review\b/i,
    /\baccepted\b/i,
    /\bin press\b/i,
    /\bpublished\b/i,
  ];

  for (const pattern of forbiddenPatterns) {
    assert.doesNotMatch(combined, pattern, `generated HTML must exclude ${pattern}`);
  }
  assert.doesNotMatch(
    combined,
    /(?:file:\/\/\/|[A-Za-z]:[\\/]|\\\\[^\\/\s]+[\\/][^\\/\s]+|(?:^|[\s"'=(])\/(?:Users|home|tmp|var|private|mnt|rds|workspace)(?:[\\/]))/i,
    'generated HTML must exclude absolute local filesystem paths',
  );
});

test('404 output exposes the exact not-found contract without a current primary-navigation link', async () => {
  const filename = path.join(distRoot, '404.html');
  assert.ok(existsSync(filename), 'expected generated document 404.html');
  const raw = await readFile(filename, 'utf8');
  const $ = load(raw, { sourceCodeLocationInfo: true });
  const main = exactlyOne($('main#main-content[tabindex="-1"]'), '404 main landmark');

  assert.equal(normalizedText(exactlyOne($('title'), '404 title').text()), 'Page not found | Yunxi Wu');
  assert.equal(
    exactlyOne($('meta[name="description"]'), '404 description meta').attr('content'),
    'The requested page could not be found.',
  );
  assert.equal(normalizedText(exactlyOne(main.find('h1'), '404 main h1').text()), 'Page not found');
  assert.ok(
    normalizedText(main.text()).includes('The requested page does not exist or has moved.'),
    '404 main must contain the not-found explanation',
  );

  const returnLinks = main.find('a').filter((_, element) => (
    $(element).attr('href') === '/'
      && normalizedText($(element).text()) === 'Return to About'
  ));
  exactlyOne(returnLinks, '404 return link');
  assert.equal(main.find('a').length, 1, '404 main must contain exactly one link');
  assert.equal($('nav[aria-label="Primary"] [aria-current]').length, 0, '404 primary navigation must have no current link');
});

test('robots output is exactly the approved permissive policy with only an optional final newline', async () => {
  const filename = path.join(distRoot, 'robots.txt');
  assert.ok(existsSync(filename), 'expected generated robots.txt');
  const robots = await readFile(filename, 'utf8');
  assert.ok(
    robots === 'User-agent: *\nAllow: /' || robots === 'User-agent: *\nAllow: /\n',
    'robots.txt must contain only the approved permissive policy',
  );
});
