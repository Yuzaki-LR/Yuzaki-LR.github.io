import assert from 'node:assert/strict';
import { access, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { readFixture, withContentCodecWorkspace } from './helpers.mjs';
import { parseProjectFile, serializeProjectFile } from '../src/lib/content/project-file.mjs';
import { parseResearchFile, serializeResearchFile } from '../src/lib/content/research-file.mjs';
import { parsePageFile, serializePageFile } from '../src/lib/content/page-file.mjs';
import { parseSiteYaml, serializeSiteYaml, writeCandidateBundle } from '../src/lib/content/bundle.mjs';
import { adoptEditorIds, validatePage, validateProject, validateResearch, validateSite, validateThemeContrast } from '../src/lib/content/schema.mjs';
import { renderSafeBlock } from '../src/lib/content/safe-render.mjs';

const base = `---\nkind: individual\ncategory: Display\ntitle: X\nshortTitle: X\nsummary: Summary\nrole: Role\nmethods: [Method]\nfeatured: false\norder: 1\n---\n`;
const INVALID_INDIVIDUAL_SOURCE = `${base}<!-- editor:section id="sectionx1" kind="contribution" hidden="false" -->\n## My Role and Contribution\n<!-- editor:block id="blockx001" type="paragraph" hidden="false" -->\nText\n`;
const INVALID_TEAM_SOURCE = `${base.replace('kind: individual', 'kind: team')}<!-- editor:section id="sectionx2" kind="standard" hidden="false" -->\n## Overview\n<!-- editor:block id="blockx002" type="paragraph" hidden="false" -->\nText\n`;
const VALID_TEAM_SOURCE = `${INVALID_TEAM_SOURCE}\n<!-- editor:section id="sectionx3" kind="contribution" hidden="false" -->\n## My Role and Contribution\n<!-- editor:block id="blockx003" type="paragraph" hidden="false" -->\nText\n`;
const completeSite = () => ({
  name: 'Yunxi', degree: 'Degree', institution: 'Institution', email: 'yunxi@example.test', intro: 'Intro', interests: [],
  avatar: { mode: 'hidden' }, links: { github: null, linkedin: null, googleScholar: null, orcid: null, custom: [] },
  theme: { text: '#17212b', background: '#ffffff', surface: '#f7f8f9', accent: '#2d587a' }, navigation: [],
});

test('supported Markdown round-trips semantically and advanced bytes survive exactly', async () => {
  const source = await readFixture('advanced/index.md');
  const parsed = parseProjectFile(source);
  validateProject(parsed);
  assert.equal(parsed.sections[0].blocks.at(-1).type, 'advanced');
  assert.equal(parsed.sections[0].blocks.at(-1).raw, '<details>\r\nraw body\r\n</details>');
  assert.deepEqual(parseProjectFile(serializeProjectFile(parsed)), parsed);
});
test('ownership is semantic rather than heading-text inference', () => {
  assert.throws(() => validateProject(parseProjectFile(INVALID_INDIVIDUAL_SOURCE)), /individual project cannot contain a contribution section/);
  assert.throws(() => validateProject(parseProjectFile(INVALID_TEAM_SOURCE)), /team project requires exactly one contribution section/);
  assert.equal(validateProject(parseProjectFile(VALID_TEAM_SOURCE)).sections.filter((section) => section.kind === 'contribution').length, 1);
});

test('site, page and research records round-trip and research edits remain stable', () => {
  const site = parseSiteYaml('name: Yunxi\ntheme:\n  text: "#111111"\n  background: "#ffffff"\n  surface: "#ffffff"\n  accent: "#0055aa"\n  focus: "#0055aa"\n');
  assert.deepEqual(parseSiteYaml(serializeSiteYaml(site)), site);
  const page = parsePageFile('<!-- editor:section id="sectionp1" kind="standard" hidden="false" -->\n## About\n<!-- editor:block id="blockp001" type="paragraph" hidden="false" -->\nAbout text\n');
  assert.deepEqual(parsePageFile(serializePageFile(page)), page);
  const research = parseResearchFile('---\ntitle: Research\nstatus: "Submitted manuscript — Under editorial review"\nsummary: Summary\norder: 1\n---\n<!-- editor:section id="sectionr1" kind="standard" hidden="false" -->\n## Notes\n<!-- editor:block id="blockr001" type="paragraph" hidden="false" -->\nBody\n');
  assert.deepEqual(parseResearchFile(serializeResearchFile(research)), research);
  const edited = structuredClone(research); edited.frontmatter.title = 'Edited';
  assert.equal(parseResearchFile(serializeResearchFile(edited)).frontmatter.title, 'Edited');
  assert.equal(validateResearch(research).frontmatter.order, 1);
});

test('candidate bundles reject incomplete site configuration before creating output', async () => {
  await withContentCodecWorkspace(async ({ root }) => {
    const about = parsePageFile('## About\nA\n'); adoptEditorIds(about, (() => { let n = 0; return () => `aboutcfg${++n}`; })());
    for (const site of [{ ...completeSite(), name: undefined }, { ...completeSite(), avatar: undefined }, { ...completeSite(), theme: undefined }, { ...completeSite(), navigation: undefined }]) {
      await assert.rejects(writeCandidateBundle({ root, draft: { site, about, projects: [], research: [], images: [] } }), /site configuration is invalid/);
      await assert.rejects(access(path.join(root, '.candidate')));
    }
  });
});

test('research folders are the sole slug identity and research YAML cannot contain slug', async () => {
  const source = '---\ntitle: Research\nsummary: Summary\norder: 1\nslug: forbidden\n---\n<!-- editor:section id="sectionr3" kind="standard" hidden="false" -->\n## Notes\n<!-- editor:block id="blockr003" type="paragraph" hidden="false" -->\nBody\n';
  assert.throws(() => validateResearch(parseResearchFile(source)), /research frontmatter/);
  const research = parseResearchFile(source.replace('slug: forbidden\n', ''));
  await withContentCodecWorkspace(async ({ root }) => {
    const about = parsePageFile('## About\nA\n'); adoptEditorIds(about, (() => { let n = 0; return () => `aboutrun${++n}`; })());
    await writeCandidateBundle({ root, draft: { site: completeSite(), about, projects: [], research: [{ slug: 'folder-identity', document: research }], images: [] } });
    const emitted = await readFile(path.join(root, '.candidate', 'research', 'folder-identity.md'), 'utf8');
    assert.doesNotMatch(emitted, /^slug:/m);
  });
});

test('unmarked Markdown receives ids only in candidate output', async () => {
  const source = `${base}## Overview\nUnmarked text\n`;
  const first = parseProjectFile(source);
  const second = parseProjectFile(source);
  const factory = (() => { let n = 0; return () => `stableid${++n}`; })();
  adoptEditorIds(first, factory);
  const factoryAgain = (() => { let n = 0; return () => `stableid${++n}`; })();
  adoptEditorIds(second, factoryAgain);
  assert.deepEqual(first, second);
  assert.equal(source.includes('editor:'), false);
  await withContentCodecWorkspace(async ({ root }) => {
    const about = parsePageFile('## About\nText\n'); adoptEditorIds(about, (() => { let n = 0; return () => `aboutid${++n}`; })());
    const manifest = await writeCandidateBundle({ root, draft: { site: completeSite(), about, projects: [{ slug: 'project', document: first }], research: [], images: [] } });
    assert.ok(manifest.files.some((file) => file.endsWith('projects/project/index.md')));
    assert.match(await readFile(path.join(root, '.candidate', 'projects', 'project', 'index.md'), 'utf8'), /editor:/);
    assert.equal(source.includes('editor:'), false);
  });
});

test('candidate bundles require every collection before writing and emit every complete record', async () => {
  const project = parseProjectFile(`${base}<!-- editor:section id="sectiond1" kind="standard" hidden="false" -->\n## Overview\n<!-- editor:block id="blockd001" type="paragraph" hidden="false" -->\nOne\n`);
  const research = parseResearchFile('---\ntitle: R\nsummary: S\norder: 1\n---\n<!-- editor:section id="sectiond2" kind="standard" hidden="false" -->\n## Notes\n<!-- editor:block id="blockd002" type="paragraph" hidden="false" -->\nTwo\n');
  await withContentCodecWorkspace(async ({ root }) => {
    await assert.rejects(writeCandidateBundle({ root, draft: { site: completeSite(), about: {}, projects: [], research: [] } }), /images collection/);
    await assert.rejects(access(path.join(root, '.candidate')));
    const about = parsePageFile('## About\nA\n'); adoptEditorIds(about, (() => { let n = 0; return () => `aboutid${++n}`; })());
    const manifest = await writeCandidateBundle({ root, draft: { site: completeSite(), about, projects: [{ slug: 'one-project', document: project }, { slug: 'two-project', document: project }], research: [{ slug: 'one-research', document: research }, { slug: 'two-research', document: research }], images: [] } });
    assert.deepEqual(manifest.files.filter((file) => file.includes('/projects/')).sort(), ['.candidate/projects/one-project/index.md', '.candidate/projects/two-project/index.md']);
    assert.deepEqual(manifest.files.filter((file) => file.includes('/research/')).sort(), ['.candidate/research/one-research.md', '.candidate/research/two-research.md']);
    assert.deepEqual(parseSiteYaml(await readFile(path.join(root, '.candidate', 'site.yml'), 'utf8')), completeSite());
  });
});

test('candidate slugs are confined and reject traversal forms before any outside write', async () => {
  const project = parseProjectFile(`${base}<!-- editor:section id="sectione1" kind="standard" hidden="false" -->\n## Overview\n<!-- editor:block id="blocke001" type="paragraph" hidden="false" -->\nSafe\n`);
  await withContentCodecWorkspace(async ({ root, parent }) => {
    const outside = path.join(parent, 'escaped.md'); const about = parsePageFile('## About\nA\n'); adoptEditorIds(about, (() => { let n = 0; return () => `aboutid${++n}`; })());
    for (const slug of ['..', '../escaped', '/absolute', ['C:', '\\', 'drive'].join(''), '%2e%2e']) await assert.rejects(writeCandidateBundle({ root, draft: { site: completeSite(), about, projects: [{ slug, document: project }], research: [], images: [] } }), /stable slug/);
    await assert.rejects(access(outside));
  });
});

test('candidate operation roots are new snapshots with no stale records or images', async () => {
  await withContentCodecWorkspace(async ({ root }) => {
    await mkdir(path.join(root, '.candidate')); await writeFile(path.join(root, '.candidate', 'stale.md'), 'stale');
    const about = parsePageFile('## About\nA\n'); adoptEditorIds(about, (() => { let n = 0; return () => `aboutid${++n}`; })());
    await assert.rejects(writeCandidateBundle({ root, draft: { site: completeSite(), about, projects: [], research: [], images: [] } }), /candidate.*exists/);
    assert.equal(await readFile(path.join(root, '.candidate', 'stale.md'), 'utf8'), 'stale');
  });
});

test('candidate records and logical image destinations are unique, explicit, and non-flat', async () => {
  await withContentCodecWorkspace(async ({ root }) => {
    const project = parseProjectFile(`${base}<!-- editor:section id="sectionh1" kind="standard" hidden="false" -->\n## Overview\n<!-- editor:block id="blockh001" type="paragraph" hidden="false" -->\nOne\n`); project.slug = 'one-project';
    const research = parseResearchFile('---\ntitle: R\nsummary: S\norder: 1\n---\n<!-- editor:section id="sectionh2" kind="standard" hidden="false" -->\n## Notes\n<!-- editor:block id="blockh002" type="paragraph" hidden="false" -->\nTwo\n'); research.slug = 'one-research';
    const about = parsePageFile('## About\nA\n'); adoptEditorIds(about, (() => { let n = 0; return () => `aboutid${++n}`; })());
    const common = { site: completeSite(), about, research: [ { slug: 'one-research', document: research } ], images: [] };
    await assert.rejects(writeCandidateBundle({ root, draft: { ...common, projects: [{ slug: 'one-project', document: project }, { slug: 'one-project', document: project }] } }), /duplicate slug/);
    await assert.rejects(writeCandidateBundle({ root, draft: { ...common, projects: [{ slug: 'other-project', document: project }] } }), /document slug/);
    await assert.rejects(writeCandidateBundle({ root, draft: { ...common, projects: [], images: [{ destination: 'avatar.png', bytes: Buffer.from('x') }] } }), /logical image destination/);
  });
});

test('candidate image replacements are explicit and collisions fail before candidate creation', async () => {
  await withContentCodecWorkspace(async ({ root }) => {
    const about = parsePageFile('## About\nA\n'); adoptEditorIds(about, (() => { let n = 0; return () => `aboutid${++n}`; })());
    const draft = { site: completeSite(), about, projects: [], research: [], images: [{ destination: 'site-images/avatar.png', bytes: Buffer.from('old') }] };
    const manifest = await writeCandidateBundle({ root, draft, uploads: [{ destination: 'site-images/avatar.png', bytes: Buffer.from('new') }] });
    assert.equal(await readFile(path.join(root, '.candidate', 'site-images', 'avatar.png'), 'utf8'), 'new'); assert.ok(manifest.files.includes('.candidate/site-images/avatar.png'));
  });
  await withContentCodecWorkspace(async ({ root }) => {
    const about = parsePageFile('## About\nA\n'); adoptEditorIds(about, (() => { let n = 0; return () => `aboutid${++n}`; })());
    await assert.rejects(writeCandidateBundle({ root, draft: { site: completeSite(), about, projects: [], research: [], images: [{ destination: 'site-images/a.png', bytes: Buffer.from('a') }, { destination: 'site-images/a.png', bytes: Buffer.from('b') }] } }), /duplicate image destination/);
    await assert.rejects(access(path.join(root, '.candidate')));
  });
});

test('candidate destinations reject Windows aliases before creating any output', async () => {
  const draftFor = (images) => {
    const about = parsePageFile('## About\nA\n'); adoptEditorIds(about, (() => { let n = 0; return () => `aboutwin${++n}`; })());
    return { site: completeSite(), about, projects: [], research: [], images };
  };
  for (const destination of ['site-images/name. ', 'site-images/name.', 'site-images/CON.png', 'site-images/NUL.txt', 'site-images/COM1.png', 'site-images/name:stream.png']) {
    await withContentCodecWorkspace(async ({ root }) => {
      await assert.rejects(writeCandidateBundle({ root, draft: draftFor([{ destination, bytes: Buffer.from('x') }]) }), /logical image destination|candidate destination/);
      await assert.rejects(access(path.join(root, '.candidate')));
    });
  }
  await withContentCodecWorkspace(async ({ root }) => {
    await assert.rejects(writeCandidateBundle({ root, draft: draftFor([{ destination: 'site-images/A.png', bytes: Buffer.from('A') }, { destination: 'site-images/a.png', bytes: Buffer.from('a') }]) }), /duplicate image destination|duplicate candidate destination/);
    await assert.rejects(access(path.join(root, '.candidate')));
  });
  await withContentCodecWorkspace(async ({ root }) => {
    await assert.rejects(writeCandidateBundle({ root, draft: draftFor([{ destination: 'site-images/a.png', bytes: Buffer.from('draft') }]), uploads: [{ destination: 'site-images/A.png', bytes: Buffer.from('first') }, { destination: 'site-images/a.png', bytes: Buffer.from('second') }] }), /duplicate image destination|duplicate candidate destination/);
    await assert.rejects(access(path.join(root, '.candidate')));
  });
});

test('candidate rejects reparse escape before outside bytes change', async (t) => {
  await withContentCodecWorkspace(async ({ root, parent, sentinel }) => {
    const target = path.join(parent, 'outside'); await mkdir(target); await writeFile(path.join(target, 'outside.txt'), 'unchanged');
    try { await symlink(target, path.join(root, '.candidate'), 'junction'); } catch { t.skip('symlink creation unavailable'); return; }
    const about = parsePageFile('## About\nA\n'); adoptEditorIds(about, (() => { let n = 0; return () => `aboutid${++n}`; })());
    await assert.rejects(writeCandidateBundle({ root, draft: { site: completeSite(), about, projects: [], research: [], images: [] } }), /candidate.*exists|reparse/);
    assert.equal(await readFile(path.join(target, 'outside.txt'), 'utf8'), 'unchanged'); assert.equal(await readFile(sentinel, 'utf8'), 'content-codec-test-sentinel\n');
  });
});

test('unmarked supported AST nodes become ordered blocks and round-trip independently', () => {
  const source = `${base}## Overview\nFirst paragraph.\n\n- unordered\n- list\n\n1. ordered\n2. list\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n![Image](images/a.png)\n\n### Detail\n`;
  const parsed = parseProjectFile(source);
  assert.deepEqual(parsed.sections[0].blocks.map((block) => block.type), ['paragraph', 'list', 'list', 'table', 'image', 'subheading']);
  assert.equal(parsed.pendingEditorIds, true);
  const factory = (() => { let n = 0; return () => `stableid${++n}`; })();
  adoptEditorIds(parsed, factory);
  assert.deepEqual(parseProjectFile(serializeProjectFile(parsed)), parsed);
});

test('exact schemas reject bad project types, duplicate non-project ids and malformed blocks while render boundary deactivates unsafe links', () => {
  const invalid = parseProjectFile(VALID_TEAM_SOURCE);
  invalid.frontmatter.order = 1.5;
  assert.throws(() => validateProject(invalid), /frontmatter/);
  invalid.frontmatter.order = 1;
  invalid.frontmatter.featured = 'false';
  assert.throws(() => validateProject(invalid), /frontmatter/);
  invalid.frontmatter.featured = false; invalid.frontmatter.unexpected = true;
  assert.throws(() => validateProject(invalid), /frontmatter/);
  const page = parsePageFile('<!-- editor:section id="sectionf1" kind="standard" hidden="false" -->\n## About\n<!-- editor:block id="blockf001" type="paragraph" hidden="false" -->\n[unsafe](javascript:alert(1))\n');
  assert.doesNotThrow(() => validateResearch({ frontmatter: { title: 'R', summary: 'S', order: 1 }, ...page }));
  assert.equal(renderSafeBlock(page.sections[0].blocks[0]), '<p>unsafe</p>');
  const duplicatePage = structuredClone(page); duplicatePage.sections[0].blocks[0].markdown = 'safe'; duplicatePage.sections[0].blocks[0].id = duplicatePage.sections[0].id;
  assert.throws(() => validatePage(duplicatePage), /duplicate editor id/);
  const duplicateResearch = { frontmatter: { title: 'R', summary: 'S', order: 1 }, ...structuredClone(page) }; duplicateResearch.sections[0].blocks[0].markdown = 'safe'; duplicateResearch.sections[0].blocks[0].id = duplicateResearch.sections[0].id;
  assert.throws(() => validateResearch(duplicateResearch), /duplicate editor id/);
  const typed = parsePageFile('<!-- editor:section id="sectionz1" kind="standard" hidden="false" -->\n## Exact\n<!-- editor:block id="blockz001" type="paragraph" hidden="false" -->\nText\n');
  typed.sections[0].blocks[0].raw = 'impossible';
  assert.throws(() => validatePage(typed), /block contract/);
  delete typed.sections[0].blocks[0].raw; typed.sections[0].blocks[0].unknown = true;
  assert.throws(() => validatePage(typed), /block contract/);
  delete typed.sections[0].blocks[0].unknown; typed.sections[0].unknown = true;
  assert.throws(() => validatePage(typed), /section contract/);
  const unknownResearch = parseResearchFile('---\ntitle: R\nsummary: S\norder: 1\nunexpected: true\n---\n<!-- editor:section id="sectionz2" kind="standard" hidden="false" -->\n## Exact\n<!-- editor:block id="blockz002" type="advanced" hidden="false" -->\n<details>raw</details>\n');
  assert.throws(() => validateResearch(unknownResearch), /research frontmatter/);
});

test('edited supported blocks use Markdown serialization without rewriting advanced raw blocks', () => {
  const document = parsePageFile('<!-- editor:section id="sectiong1" kind="standard" hidden="false" -->\n## About\n<!-- editor:block id="blockg001" type="paragraph" hidden="false" -->\nOld text\n<!-- editor:block id="blockg002" type="advanced" hidden="false" -->\n<details>\nraw\n</details>\n');
  document.sections[0].blocks[0].markdown = 'New **formatted** text'; document.sections[0].blocks[0].edited = true;
  const output = serializePageFile(document);
  assert.match(output, /New \*\*formatted\*\* text/);
  assert.match(output, /<details>\nraw\n<\/details>/);
});

test('edited list table image and h3 reload semantically with immediate caption in image block', () => {
  const document = parsePageFile('<!-- editor:section id="sectioni1" kind="standard" hidden="false" -->\n## Types\n<!-- editor:block id="blocki001" type="list" hidden="false" -->\n- one\n<!-- editor:block id="blocki002" type="table" hidden="false" -->\n| A |\n| - |\n| 1 |\n<!-- editor:block id="blocki003" type="image" hidden="false" -->\n![Image](images/a.png)\n*Caption: one.*\n<!-- editor:block id="blocki004" type="subheading" hidden="false" -->\n### Detail\n');
  for (const block of document.sections[0].blocks) block.edited = true;
  const reloaded = parsePageFile(serializePageFile(document));
  assert.deepEqual(reloaded.sections[0].blocks.map((block) => block.type), ['list', 'table', 'image', 'subheading']);
  assert.match(reloaded.sections[0].blocks[2].markdown, /Caption: one/);
});

test('mixed newlines are deterministic and advanced terminal newline bytes survive', () => {
  const source = '<!-- editor:section id="sectionj1" kind="standard" hidden="false" -->\r\n## Mixed\n<!-- editor:block id="blockj001" type="advanced" hidden="false" -->\r\n<details>\r\nraw\r\n</details>\r\n';
  const parsed = parsePageFile(source);
  assert.equal(parsed.newline, '\r\n');
  assert.equal(parsed.sections[0].blocks[0].raw, '<details>\r\nraw\r\n</details>');
  assert.equal(serializePageFile(parsed), '<!-- editor:section id="sectionj1" kind="standard" hidden="false" -->\r\n## Mixed\r\n<!-- editor:block id="blockj001" type="advanced" hidden="false" -->\r\n<details>\r\nraw\r\n</details>\r\n');
});

test('unsafe paths, URLs, duplicate ids, malformed markers and inaccessible themes are rejected', () => {
  const project = parseProjectFile(INVALID_TEAM_SOURCE.replace('kind="standard"', 'kind="contribution"'));
  project.sections[0].blocks[0].id = 'bad';
  assert.throws(() => validateProject(project), /stable editor id/);
  assert.throws(() => validateSite({ ...completeSite(), theme: { text: '#777777', background: '#ffffff', surface: '#ffffff', accent: '#777777', focus: '#777777' } }), /正文\/背景/);
  assert.throws(() => validateThemeContrast({ text: '#777777', background: '#ffffff', surface: '#ffffff', accent: '#777777', focus: '#777777' }), /正文\/背景/);
});

test('malformed markers remain unowned raw Markdown and duplicate ids are rejected', () => {
  const malformed = parseProjectFile(`${base}<!-- editor:section id="bad" kind="standard" hidden="false" -->\n## Overview\nText\n`);
  assert.equal(malformed.pendingEditorIds, true);
  const duplicate = parseProjectFile(VALID_TEAM_SOURCE.replace('blockx003', 'sectionx2'));
  assert.throws(() => validateProject(duplicate), /duplicate editor id/);
});

test('contrast boundaries use the WCAG thresholds for normal text and focus', () => {
  assert.throws(
    () => validateThemeContrast({ text: '#949494', background: '#ffffff', surface: '#ffffff', accent: '#000000', focus: '#000000' }),
    (error) => error.message.includes('required 4.5:1'),
  );
  assert.throws(
    () => validateThemeContrast({ text: '#949494', background: '#ffffff', surface: '#ffffff', accent: '#000000', focus: '#000000', largeText: 'yes' }),
    (error) => error.message.includes('required 4.5:1'),
  );
  assert.throws(
    () => validateThemeContrast({ text: '#000000', background: '#ffffff', surface: '#ffffff', accent: '#000000', focus: '#969696' }),
    (error) => error.message.includes('required 3:1'),
  );
});

test('shared contrast contract retains exact Chinese field and ratio diagnostics', () => {
  assert.throws(
    () => validateThemeContrast({ text:'#777777',background:'#ffffff',surface:'#ffffff',accent:'#000000',focus:'#000000' }),
    /正文\/背景: required 4\.5:1, actual 4\.48:1/,
  );
  const result=validateThemeContrast({text:'#17212b',background:'#ffffff',surface:'#f7f8f9',accent:'#2d587a'});
  assert.equal(result.valid,true);assert.equal(result.checks.length,6);assert.equal(result.checks[0].field,'text/background');
});
