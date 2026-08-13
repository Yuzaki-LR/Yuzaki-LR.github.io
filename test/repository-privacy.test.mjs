import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const textExtensions = new Set([
  '.astro',
  '.css',
  '.gitignore',
  '.html',
  '.js',
  '.json',
  '.md',
  '.mjs',
  '.py',
  '.ts',
  '.txt',
  '.yaml',
  '.yml',
]);
const binaryExtensions = new Set(['.png']);

const approvedTitlePhraseOracles = new Set([
  'Computer Vision',
  'Future Ocean Habitat',
  'Group Coordinator',
  'Ongoing Work',
  'Research Interests',
  'Times New Roman',
  'Yunxi Wu',
]);

const sevenDigitIdentifier = /\b\d{7}\b/u;
const titlePhraseOracle = /\/(?<body>[A-Z][a-z]+(?: [A-Z][a-z]+){1,2}(?:\|[A-Z][a-z]+(?: [A-Z][a-z]+){1,2})*)\/[dgimsuvy]*/gu;

function trackedPaths() {
  return execFileSync('git', ['-c', `safe.directory=${projectRoot}`, 'ls-files', '-z'], {
    cwd: projectRoot,
    encoding: 'utf8',
  }).split('\0').filter(Boolean);
}

function privacyViolations(relativePath, source) {
  const violations = [];
  const normalizedSource = source.normalize('NFKC');

  if (sevenDigitIdentifier.test(normalizedSource)) {
    violations.push(`${relativePath}: contains a seven-digit identifier`);
  }

  for (const match of normalizedSource.matchAll(titlePhraseOracle)) {
    const phrases = match.groups.body.split('|');
    if (phrases.some((phrase) => !approvedTitlePhraseOracles.has(phrase))) {
      violations.push(`${relativePath}: contains a non-public personal-name oracle`);
      break;
    }
  }

  return violations;
}

function scanIndexedAndWorkingTexts({ paths = trackedPaths(), indexText = (relativePath) => execFileSync('git', ['-c', `safe.directory=${projectRoot}`, 'show', `:${relativePath}`], { cwd: projectRoot, encoding: 'utf8' }), workingText = (relativePath) => {
  const target = path.join(projectRoot, relativePath);
  return existsSync(target) ? readFileSync(target, 'utf8') : undefined;
} } = {}) {
  const unclassified = [];
  const violations = [];
  for (const relativePath of paths) {
    const extension = path.extname(relativePath);
    if (binaryExtensions.has(extension)) continue;
    if (relativePath !== '.gitignore' && !textExtensions.has(extension)) { unclassified.push(relativePath); continue; }
    const indexed = indexText(relativePath);
    violations.push(...privacyViolations(`${relativePath} (index)`, indexed));
    const working = workingText(relativePath);
    if (working !== undefined && working !== indexed) violations.push(...privacyViolations(`${relativePath} (working tree)`, working));
  }
  if (unclassified.length) throw new Error(`unclassified tracked files: ${unclassified.join(', ')}`);
  return violations;
}

test('every Git-tracked text file excludes private identifiers and non-public name oracles', () => {
  assert.deepEqual(scanIndexedAndWorkingTexts(), []);
});

test('repository privacy scan rejects sanitized identifier and collaborator-name sentinels', () => {
  const identifierSentinel = ['1234', '567'].join('');
  const collaboratorSentinel = ['Private', 'Collaborator'].join(' ');
  const syntheticSource = `student: ${identifierSentinel}\npattern: /${collaboratorSentinel}/i`;

  assert.deepEqual(privacyViolations('synthetic-sentinel.txt', syntheticSource), [
    'synthetic-sentinel.txt: contains a seven-digit identifier',
    'synthetic-sentinel.txt: contains a non-public personal-name oracle',
  ]);
});

test('privacy scan retains an index-only tracked source when its working-tree file is absent', () => {
  const identifierSentinel = ['1234', '567'].join('');
  assert.deepEqual(scanIndexedAndWorkingTexts({
    paths: ['deleted.md'],
    indexText: () => `student: ${identifierSentinel}`,
    workingText: () => undefined,
  }), ['deleted.md (index): contains a seven-digit identifier']);
});

test('repository privacy scan classifies every tracked source, test, doc, workflow, and config file', () => {
  const textPathSentinel = ['docs', 'sentinel.md'].join('/');
  const binaryPathSentinel = ['public', 'sentinel.png'].join('/');
  const unclassifiedPathSentinel = ['docs', 'sentinel.private'].join('/');

  assert.equal(textExtensions.has(path.extname(textPathSentinel)), true);
  assert.equal(binaryExtensions.has(path.extname(binaryPathSentinel)), true);
  assert.equal(textExtensions.has(path.extname(unclassifiedPathSentinel)), false);
  assert.equal(binaryExtensions.has(path.extname(unclassifiedPathSentinel)), false);
});
