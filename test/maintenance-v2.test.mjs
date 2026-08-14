import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function markdownSections(source) {
  const headings = [...source.matchAll(/^## (.+)$/gmu)];
  return new Map(headings.map((match, index) => [
    match[1],
    source.slice(match.index + match[0].length, headings[index + 1]?.index),
  ]));
}

test('quick start leads with the local visual-editor launcher', async () => {
  const readme = await readFile(path.join(projectRoot, 'README.md'), 'utf8');
  const sections = markdownSections(readme);
  assert.equal([...sections.keys()][0], 'Quick start', 'Quick start must be the first level-two README section');
  assert.equal(sections.has('Quick start'), true, 'README needs a Quick start section');
  assert.match(sections.get('Quick start'), /^\s*```(?:bat|cmd)?\s*\n启动网站编辑器\.bat\s*\n```/u);
});

test('maintenance checklist covers local editing, recovery, manual files, and publication approval', async () => {
  const maintenance = await readFile(path.join(projectRoot, 'docs', 'maintenance.md'), 'utf8');
  const sections = markdownSections(maintenance);
  const requiredHeadings = [
    'Start the local editor',
    'Chinese editor workflow',
    'Unsaved drafts',
    'Project types and required records',
    'Images and privacy review',
    'Save safely',
    'Resolve conflicts',
    'Backups: keep the newest 20',
    'Restore a backup',
    'Manual Markdown and YAML editing',
    'Portable runtime boundary',
    'Run the full verification',
    'Publication remains a separate approval',
  ];

  for (const heading of requiredHeadings) {
    assert.equal(sections.has(heading), true, `maintenance checklist is missing ${heading}`);
  }
  assert.match(
    sections.get('Manual Markdown and YAML editing'),
    /About content is in `src\/content\/pages\/about\.md`/u,
    'manual-editing guidance must name the canonical About record',
  );
  assert.match(sections.get('Run the full verification'), /```sh\s*\npnpm test\s*\n```/u);
  assert.match(
    sections.get('Publication remains a separate approval'),
    /local editor save, a backup restore, and passing tests do not approve publication/u,
  );
});
