import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { lstat, readFile, readdir, realpath, stat } from 'node:fs/promises';
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
  ['index.html', { text: 'About', href: '/' }],
  ['projects/communication-system-modelling/index.html', { text: 'Projects', href: '/projects/' }],
  ['projects/future-ocean-habitat/index.html', { text: 'Projects', href: '/projects/' }],
  ['projects/index.html', { text: 'Projects', href: '/projects/' }],
  ['projects/life-support-system/index.html', { text: 'Projects', href: '/projects/' }],
  ['research/index.html', { text: 'Research', href: '/research/' }],
]);

function normalizedText(value) {
  return value
    .replace(/[\t\n\f\r ]+/g, ' ')
    .replace(/^[\t\n\f\r ]+|[\t\n\f\r ]+$/g, '');
}

function htmlAsciiTrim(value) {
  return value.replace(/^[\t\n\f\r ]+|[\t\n\f\r ]+$/g, '');
}

function asciiCaseFold(value) {
  return value.replace(/[A-Z]/g, (character) => character.toLowerCase());
}

function hidesContent(node) {
  const tagName = (node.tagName ?? '').toLowerCase();
  if (['script', 'style', 'template'].includes(tagName)) return true;

  const attributes = node.attribs ?? {};
  if (Object.hasOwn(attributes, 'hidden')) return true;
  if (!Object.hasOwn(attributes, 'aria-hidden')) return false;
  return asciiCaseFold(htmlAsciiTrim(attributes['aria-hidden'])) === 'true';
}

function classTokens(element) {
  const value = element.attr('class') ?? '';
  return value.split(/[\t\n\f\r ]+/).filter((token) => token !== '');
}

function visibleText(element) {
  const selectedAndAncestors = [...element.toArray(), ...element.parents().toArray()];
  if (selectedAndAncestors.some((node) => hidesContent(node))) return '';

  const clone = element.clone();
  clone.find('*').filter((_, node) => hidesContent(node)).remove();
  return normalizedText(clone.text());
}

function decodedAttributeValues($) {
  return $('*').toArray().flatMap((element) => Object.values(element.attribs ?? {}));
}

function normalizedPrivacyText(value) {
  return value.normalize('NFKC').replace(/[\s\p{Z}]+/gu, ' ').trim();
}

const privacyContextBoundaryTags = new Set([
  'address',
  'article',
  'aside',
  'blockquote',
  'body',
  'caption',
  'dd',
  'details',
  'dialog',
  'div',
  'dl',
  'dt',
  'fieldset',
  'figcaption',
  'figure',
  'footer',
  'form',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hgroup',
  'html',
  'hr',
  'legend',
  'li',
  'main',
  'menu',
  'nav',
  'ol',
  'p',
  'pre',
  'search',
  'section',
  'summary',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'tr',
  'ul',
  'a',
  'button',
  'datalist',
  'input',
  'label',
  'meter',
  'optgroup',
  'option',
  'output',
  'progress',
  'select',
  'textarea',
  'head',
  'noscript',
  'script',
  'style',
  'template',
  'title',
  'audio',
  'canvas',
  'iframe',
  'math',
  'object',
  'svg',
  'video',
]);

function decodedTextContexts($) {
  const contextChunks = [];

  function append(currentContext, value) {
    const context = currentContext ?? [];
    if (currentContext === null) contextChunks.push(context);
    context.push(value);
    return context;
  }

  function visitInline(node, currentContext) {
    if (node.type === 'text') return append(currentContext, node.data ?? '');

    const tagName = (node.tagName ?? '').toLowerCase();
    if (tagName === 'br') return append(currentContext, ' ');
    if (privacyContextBoundaryTags.has(tagName)) {
      visitBoundary(node);
      return null;
    }

    let context = currentContext;
    for (const child of node.children ?? []) context = visitInline(child, context);
    return context;
  }

  function visitBoundary(node) {
    let currentContext = null;

    for (const child of node.children ?? []) {
      const tagName = (child.tagName ?? '').toLowerCase();
      if (privacyContextBoundaryTags.has(tagName)) {
        visitBoundary(child);
        currentContext = null;
      } else {
        currentContext = visitInline(child, currentContext);
      }
    }
  }

  visitBoundary($.root()[0]);
  return contextChunks
    .map((chunks) => normalizedPrivacyText(chunks.join('')))
    .filter((context) => context !== '');
}

function externalWebUrl(value) {
  const candidate = normalizedPrivacyText(value);
  if (candidate === '' || /[\s\p{Z}]/u.test(candidate)) return null;

  try {
    const url = new URL(candidate);
    return /^(?:http|https):$/i.test(url.protocol) && url.hostname !== '' ? url : null;
  } catch {
    return null;
  }
}

function assertNoAbsoluteLocalPath(value, context) {
  const candidate = normalizedPrivacyText(value);
  if (candidate === '') return;

  const fileUriPattern = /(?<![A-Za-z0-9+.-])file:[\\/]+/i;
  const driveOrUncPattern = /(?:(?<![A-Za-z0-9])[A-Za-z]:[\\/]|\\\\[^\\/\s]+[\\/][^\\/\s]+)/i;
  const posixLocalRootPattern = /(?<![A-Za-z0-9._~-])\/(?:Users|home|tmp|var|private|mnt|rds|workspace)(?:[\\/]|$)/i;
  assert.doesNotMatch(candidate, fileUriPattern, `${context} must exclude absolute file URIs`);
  assert.doesNotMatch(candidate, driveOrUncPattern, `${context} must exclude absolute local paths`);

  const webUrl = externalWebUrl(candidate);
  if (webUrl) {
    assert.doesNotMatch(
      `${webUrl.search}\n${webUrl.hash}`,
      posixLocalRootPattern,
      `${context} must not hide a separate local path outside its web pathname`,
    );
    return;
  }

  assert.doesNotMatch(candidate, posixLocalRootPattern, `${context} must exclude absolute local paths`);
}

function exactlyOne(elements, description) {
  assert.equal(elements.length, 1, `expected exactly one ${description}, found ${elements.length}`);
  return elements.eq(0);
}

function filesystemIdentity(canonicalPath) {
  return process.platform === 'win32' ? canonicalPath.toLowerCase() : canonicalPath;
}

async function recursiveHtmlFiles(directory, prefix = '', state = null) {
  const canonicalRoot = state?.canonicalRoot ?? await realpath(distRoot);
  const visitedDirectories = state?.visitedDirectories ?? new Set();
  const directoryContext = prefix === '' ? 'dist root' : `generated directory ${prefix}`;
  const directoryInfo = await lstat(directory);
  assert.ok(!directoryInfo.isSymbolicLink(), `${directoryContext} must not be a symlink or junction`);
  assert.ok(directoryInfo.isDirectory(), `${directoryContext} must be a directory`);

  const canonicalDirectory = await realpath(directory);
  assertCanonicalContainment(canonicalRoot, canonicalDirectory, directoryContext);
  const identity = filesystemIdentity(canonicalDirectory);
  assert.ok(!visitedDirectories.has(identity), `${directoryContext} creates an inventory cycle`);
  visitedDirectories.add(identity);

  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const relativePath = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    const absolutePath = path.join(directory, entry.name);
    const entryInfo = await lstat(absolutePath);
    assert.ok(
      !entryInfo.isSymbolicLink(),
      `generated output ${relativePath} must not be a symlink or junction`,
    );

    const canonicalEntry = await realpath(absolutePath);
    assertCanonicalContainment(canonicalRoot, canonicalEntry, `generated output ${relativePath}`);

    if (entryInfo.isDirectory()) {
      files.push(...await recursiveHtmlFiles(absolutePath, relativePath, {
        canonicalRoot,
        visitedDirectories,
      }));
    } else if (entryInfo.isFile() && path.extname(entry.name).toLowerCase() === '.html') {
      files.push(relativePath);
    } else {
      assert.ok(entryInfo.isFile(), `generated output ${relativePath} must be a file or directory`);
    }
  }

  return files.sort();
}

async function generatedDocuments() {
  const documents = [];

  for (const route of await recursiveHtmlFiles(distRoot)) {
    const candidate = path.join(distRoot, ...route.split('/'));
    const filename = await canonicalExistingFile(candidate, `generated document ${route}`);
    const raw = await readFile(filename, 'utf8');
    documents.push({
      route,
      filename,
      raw,
      $: load(raw, { sourceCodeLocationInfo: true }),
    });
  }

  return documents;
}

function routeUrl(route) {
  if (route === 'index.html') return '/';
  if (route.endsWith('/index.html')) return `/${route.slice(0, -'index.html'.length)}`;
  return `/${route}`;
}

function assertCanonicalContainment(canonicalRoot, canonicalTarget, context) {
  const relativeTarget = path.relative(canonicalRoot, canonicalTarget);
  assert.ok(
    relativeTarget !== '..'
      && !relativeTarget.startsWith(`..${path.sep}`)
      && !path.isAbsolute(relativeTarget),
    `${context} escapes canonical dist`,
  );
}

async function canonicalExistingFile(target, context) {
  assert.ok(existsSync(target), `${context} resolves to missing output`);
  const targetInfo = await lstat(target);
  assert.ok(!targetInfo.isSymbolicLink(), `${context} must not be a symlink or junction`);
  const [canonicalRoot, canonicalTarget] = await Promise.all([realpath(distRoot), realpath(target)]);
  assertCanonicalContainment(canonicalRoot, canonicalTarget, context);
  assert.ok(targetInfo.isFile(), `${context} must be a file`);
  assert.ok((await stat(canonicalTarget)).isFile(), `${context} must resolve to a file`);
  return canonicalTarget;
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
  return canonicalExistingFile(target, `${context} (${relativePath})`);
}

test('fresh build emits exactly the approved HTML route set', async () => {
  assert.deepEqual(await recursiveHtmlFiles(distRoot), generatedRoutes);
});

test('every generated document has exact identity, metadata, landmarks, and keyboard entry', async () => {
  for (const { route, $ } of await generatedDocuments()) {
    const html = exactlyOne($('html'), `${route} html element`);
    assert.ok(html[0].sourceCodeLocation, `${route} html element must be present in emitted markup`);
    assert.equal(html.attr('lang'), 'en', `${route} html lang`);

    const head = exactlyOne($('head'), `${route} total head element`);
    const body = exactlyOne($('body'), `${route} total body element`);
    assert.ok(head[0].sourceCodeLocation, `${route} head element must be present in emitted markup`);
    assert.ok(body[0].sourceCodeLocation, `${route} body element must be present in emitted markup`);

    const title = exactlyOne($('title'), `${route} total title`);
    assert.ok(head.find('title')[0] === title[0], `${route} title must be inside head`);
    assert.notEqual(normalizedText(title.text()), '', `${route} title must not be empty`);
    const description = exactlyOne($('meta[name="description"]'), `${route} total description meta`);
    assert.ok(
      head.find('meta[name="description"]')[0] === description[0],
      `${route} description meta must be inside head`,
    );
    assert.notEqual((description.attr('content') ?? '').trim(), '', `${route} description must not be empty`);

    const header = exactlyOne($('header'), `${route} total header`);
    const nav = exactlyOne($('nav'), `${route} total nav`);
    assert.equal(nav.attr('aria-label'), 'Primary', `${route} nav aria-label`);
    assert.ok(
      header.find('nav')[0] === nav[0],
      `${route} primary navigation must be inside header`,
    );
    const aside = exactlyOne($('aside'), `${route} total aside`);
    assert.equal(aside.attr('aria-label'), 'Profile', `${route} aside aria-label`);
    const main = exactlyOne($('main'), `${route} total main`);
    assert.equal(main.attr('id'), 'main-content', `${route} main id`);
    assert.equal(main.attr('tabindex'), '-1', `${route} main tabindex`);
    const footer = exactlyOne($('footer'), `${route} total footer`);
    assert.ok(body.find('header')[0] === header[0], `${route} header must be inside body`);
    assert.ok(body.find('aside')[0] === aside[0], `${route} aside must be inside body`);
    assert.ok(body.find('main')[0] === main[0], `${route} main must be inside body`);
    assert.ok(body.find('footer')[0] === footer[0], `${route} footer must be inside body`);
    const mainTargets = $('[id="main-content"]');
    assert.equal(mainTargets.length, 1, `${route} must have one exact skip-link target id`);
    assert.ok(mainTargets[0] === main[0], `${route} skip-link target must be the main landmark`);

    const skipLinks = $('a').filter((_, element) => classTokens($(element)).includes('skip-link'));
    const skipLink = exactlyOne(skipLinks, `${route} real skip link`);
    assert.equal(skipLink.attr('href'), '#main-content', `${route} skip-link href`);
    assert.equal(visibleText(skipLink), 'Skip to main content', `${route} visible skip-link text`);

    const email = exactlyOne(
      aside.find('a[href="mailto:yxw1331@student.bham.ac.uk"]'),
      `${route} verified profile email link`,
    );
    assert.equal(visibleText(email), 'yxw1331@student.bham.ac.uk', `${route} visible email text`);

    const documentH1 = exactlyOne($('h1'), `${route} document h1`);
    const mainH1 = exactlyOne(main.find('h1'), `${route} main h1`);
    assert.ok(documentH1[0] === mainH1[0], `${route} document h1 must be inside main`);
    assert.notEqual(visibleText(mainH1), '', `${route} main h1 must have visible text`);
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
        `${route} heading ${visibleText($(heading))} skips from h${previousLevel} to h${level}`,
      );
      assert.notEqual(visibleText($(heading)), '', `${route} h${level} must have visible text`);
      previousLevel = level;
    }
  }
});

test('active navigation matches each generated route and remains scoped to primary navigation', async () => {
  for (const { route, $ } of await generatedDocuments()) {
    const nav = exactlyOne($('nav[aria-label="Primary"]'), `${route} primary navigation`);
    const currentElements = $('[aria-current]');
    const expected = expectedCurrentNavigation.get(route);

    if (expected === null) {
      assert.equal(currentElements.length, 0, `${route} must not mark a navigation link current`);
      continue;
    }

    const current = exactlyOne(currentElements, `${route} current navigation element`);
    assert.equal(current[0].tagName.toLowerCase(), 'a', `${route} current element must be an anchor`);
    assert.equal(current.attr('aria-current'), 'page', `${route} current link aria-current`);
    assert.equal(visibleText(current), expected.text, `${route} visible current-link text`);
    assert.equal(current.attr('href'), expected.href, `${route} current-link href`);
    assert.ok(
      nav.find('[aria-current]')[0] === current[0],
      `${route} current link must be inside primary navigation`,
    );
  }
});

test('all real internal anchors resolve within the generated site and same-page fragments target exact ids', async () => {
  const origin = 'https://generated-site.invalid';

  for (const { route, filename, $ } of await generatedDocuments()) {
    const baseUrl = new URL(routeUrl(route), origin);

    for (const anchor of $('a').toArray()) {
      const href = $(anchor).attr('href');
      assert.ok(href && normalizedText(href) !== '', `${route} anchor must have a non-empty href`);
      if (/^mailto:/i.test(href)) continue;

      const targetUrl = new URL(href, baseUrl);
      if (/^https?:/i.test(targetUrl.protocol) && targetUrl.origin !== origin) continue;
      assert.equal(targetUrl.origin, origin, `${route} anchor ${href} uses an unsupported internal scheme`);
      const targetFile = await assertInternalTargetExists(targetUrl, `${route} anchor ${href}`);

      if (targetFile === filename && targetUrl.hash !== '') {
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
      const source = element.attr('src') ?? '';
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

test('raw and decoded generated output exclude private identifiers, unsupported statuses, and local paths', async () => {
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
  for (const { route, raw, $ } of await generatedDocuments()) {
    const decodedContexts = decodedTextContexts($);
    const decodedAttributes = decodedAttributeValues($);

    for (const pattern of forbiddenPatterns) {
      assert.doesNotMatch(raw, pattern, `${route} raw HTML must exclude ${pattern}`);

      decodedContexts.forEach((value, index) => {
        assert.doesNotMatch(
          value,
          pattern,
          `${route} decoded text context ${index + 1} must exclude ${pattern}`,
        );
      });
      decodedAttributes.forEach((value, index) => {
        assert.doesNotMatch(
          normalizedPrivacyText(value),
          pattern,
          `${route} decoded attribute ${index + 1} must exclude ${pattern}`,
        );
      });
    }

    decodedContexts.forEach((value, index) => {
      assertNoAbsoluteLocalPath(value, `${route} decoded text context ${index + 1}`);
    });
    decodedAttributes.forEach((value, index) => {
      assertNoAbsoluteLocalPath(value, `${route} decoded attribute ${index + 1}`);
    });
  }
});

test('404 output exposes the exact not-found contract without a current primary-navigation link', async () => {
  const filename = path.join(distRoot, '404.html');
  assert.ok(existsSync(filename), 'expected generated document 404.html');
  const raw = await readFile(filename, 'utf8');
  const $ = load(raw, { sourceCodeLocationInfo: true });
  const main = exactlyOne($('main'), '404 total main landmark');
  assert.equal(main.attr('id'), 'main-content', '404 main id');
  assert.equal(main.attr('tabindex'), '-1', '404 main tabindex');

  assert.equal(normalizedText(exactlyOne($('title'), '404 title').text()), 'Page not found | Yunxi Wu');
  assert.equal(
    exactlyOne($('meta[name="description"]'), '404 description meta').attr('content'),
    'The requested page could not be found.',
  );
  assert.equal(visibleText(exactlyOne(main.find('h1'), '404 main h1')), 'Page not found');

  const explanationParagraphs = main.find('p').filter((_, element) => (
    visibleText($(element)) === 'The requested page does not exist or has moved.'
  ));
  exactlyOne(
    explanationParagraphs,
    '404 visible not-found explanation paragraph',
  );

  const returnLinks = main.find('a').filter((_, element) => (
    $(element).attr('href') === '/'
      && visibleText($(element)) === 'Return to About'
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
