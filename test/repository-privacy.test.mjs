import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createTestWorkspace } from './helpers.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const textExtensions = new Set([
  '.astro', '.bat', '.css', '.html', '.js', '.json', '.md', '.mjs', '.py', '.ts', '.txt', '.yaml', '.yml',
]);
const textBasenames = new Set(['.gitattributes', '.gitignore']);
const binaryExtensions = new Set(['.png']);
const approvedBinaryPaths = new Set(['editor/test/fixtures/oriented.jpg', 'editor/test/fixtures/corrupt.tif']);
const approvedTitlePhraseOracles = new Set([
  'Computer Vision', 'Future Ocean Habitat', 'Group Coordinator', 'Ongoing Work', 'Research Interests', 'Times New Roman', 'Yunxi Wu',
]);
const sevenDigitIdentifier = /\b\d{7}\b/u;
const titlePhraseOracle = /\/(?<body>[A-Z][a-z]+(?: [A-Z][a-z]+){1,2}(?:\|[A-Z][a-z]+(?: [A-Z][a-z]+){1,2})*)\/[dgimsuvy]*/gu;

function git(argumentsList, { root = projectRoot, indexFile, input } = {}) {
  return execFileSync('git', ['-c', `safe.directory=${root}`, ...argumentsList], {
    cwd: root,
    encoding: 'utf8',
    input,
    env: { ...process.env, ...(indexFile ? { GIT_INDEX_FILE: indexFile } : {}) },
  });
}

function gitTrackedFilesWithProcessLocalSafeDirectory({ root = projectRoot, indexFile } = {}) {
  return git(['ls-files', '-z'], { root, indexFile }).split('\0').filter(Boolean);
}

function classifyTrackedPath(relativePath) {
  if (approvedBinaryPaths.has(relativePath) || binaryExtensions.has(path.extname(relativePath).toLowerCase())) return 'binary';
  if (textBasenames.has(path.basename(relativePath)) || textExtensions.has(path.extname(relativePath).toLowerCase())) return 'text';
  return 'unknown';
}

function assertPrivacySafeText(source, relativePath) {
  const normalizedSource = source.normalize('NFKC');
  assert.doesNotMatch(normalizedSource, sevenDigitIdentifier, `${relativePath}: contains a seven-digit identifier`);
  for (const match of normalizedSource.matchAll(titlePhraseOracle)) {
    const phrases = match.groups.body.split('|');
    assert.equal(
      phrases.some((phrase) => !approvedTitlePhraseOracles.has(phrase)),
      false,
      `${relativePath}: contains a non-public personal-name oracle`,
    );
  }
}

function scanIndexedAndWorkingTexts({
  root = projectRoot,
  indexFile,
  paths = gitTrackedFilesWithProcessLocalSafeDirectory({ root, indexFile }),
  indexText = (relativePath) => git(['show', `:${relativePath}`], { root, indexFile }),
  workingText = (relativePath) => {
    const target = path.join(root, ...relativePath.split('/'));
    return existsSync(target) ? readFileSync(target, 'utf8') : undefined;
  },
} = {}) {
  for (const relativePath of paths) {
    const classification = classifyTrackedPath(relativePath);
    assert.notEqual(classification, 'unknown', `unclassified tracked file: ${relativePath}`);
    if (classification !== 'text') continue;
    const indexed = indexText(relativePath);
    assertPrivacySafeText(indexed, `${relativePath} (index)`);
    const working = workingText(relativePath);
    if (working !== undefined && working !== indexed) assertPrivacySafeText(working, `${relativePath} (working tree)`);
  }
}

test('every tracked file is classified and privacy-scanned', () => {
  scanIndexedAndWorkingTexts();
});

test('privacy scan rejects a generic seven-digit identifier in a copied tracked-text fixture', async (t) => {
  const workspace = await createTestWorkspace();
  t.after(workspace.cleanup);
  git(['init'], { root: workspace.root });
  git(['add', 'src'], { root: workspace.root });
  const fixture = path.join(workspace.root, 'src', 'content', 'site.yml');
  await writeFile(fixture, `${readFileSync(fixture, 'utf8')}\nprivacy-sentinel: ${['765', '4321'].join('')}\n`);

  assert.throws(
    () => scanIndexedAndWorkingTexts({ root: workspace.root }),
    /site\.yml \(working tree\): contains a seven-digit identifier/,
  );
});

test('privacy scan rejects a dynamically constructed non-public name oracle in a copied tracked-text fixture', async (t) => {
  const workspace = await createTestWorkspace();
  t.after(workspace.cleanup);
  git(['init'], { root: workspace.root });
  git(['add', 'src'], { root: workspace.root });
  const fixture = path.join(workspace.root, 'src', 'content', 'site.yml');
  const nonPublicNameOracle = ['Private', 'Collaborator'].join(' ');
  await writeFile(fixture, `${readFileSync(fixture, 'utf8')}\nprivacy-oracle: /${nonPublicNameOracle}/i\n`);

  assert.throws(
    () => scanIndexedAndWorkingTexts({ root: workspace.root }),
    /site\.yml \(working tree\): contains a non-public personal-name oracle/,
  );
});

test('privacy scan fails closed for an unclassified extension in a sentinel-protected alternate Git index', async (t) => {
  const workspace = await createTestWorkspace();
  t.after(workspace.cleanup);
  git(['init'], { root: workspace.root });
  await mkdir(path.join(workspace.root, 'notes'), { recursive: true });
  await writeFile(path.join(workspace.root, 'notes', 'privacy-sentinel.private'), 'safe alternate-index fixture\n');
  const alternateIndex = path.join(workspace.parent, 'privacy-sentinel.index');
  git(['read-tree', '--empty'], { root: workspace.root, indexFile: alternateIndex });
  const objectId = git(['hash-object', '-w', '--stdin'], {
    root: workspace.root,
    input: 'safe alternate-index fixture\n',
  }).trim();
  git(['update-index', '--add', '--cacheinfo', `100644,${objectId},notes/privacy-sentinel.private`], {
    root: workspace.root,
    indexFile: alternateIndex,
  });

  assert.throws(
    () => scanIndexedAndWorkingTexts({ root: workspace.root, indexFile: alternateIndex }),
    /unclassified tracked file: notes\/privacy-sentinel\.private/,
  );
});

test('privacy scan retains an index-only tracked source when its working-tree file is absent', () => {
  assert.throws(
    () => scanIndexedAndWorkingTexts({
      paths: ['deleted.md'],
      indexText: () => `student: ${['1234', '567'].join('')}`,
      workingText: () => undefined,
    }),
    /deleted\.md \(index\): contains a seven-digit identifier/,
  );
});
