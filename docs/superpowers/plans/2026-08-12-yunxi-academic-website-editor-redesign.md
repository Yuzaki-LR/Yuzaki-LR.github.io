# Yunxi Wu Academic Website Editor Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the first website's generic project presentation with evidence-led graduate-application content and add a Chinese, local-only visual editor that safely edits the same Markdown/YAML source used by the public Astro site.

**Architecture:** One shared content layer parses, validates, serialises, and loads site configuration, research records, project Markdown, and project-owned images from `src/content`. Astro consumes that layer for the public static site and emits content-local images through static resource endpoints; a loopback-only Node editor service exposes the same model to a native HTML/CSS/JavaScript client. Drafts stay in memory until a journalled candidate build passes, after which the canonical content tree and last-known-good `dist` are promoted with recoverable backups.

**Tech Stack:** Node.js 24.14.0 target (`>=22.12.0` engine), pnpm 11.16.0, Astro 7.2.0, TypeScript 6.0.3, Zod 4.4.3, YAML 2.9.0, gray-matter 4.0.3, unified 11.0.5, remark-parse 11.0.0, remark-stringify 11.0.0, remark-gfm 4.0.1, sharp 0.35.3, Cheerio 1.2.0, Node built-in HTTP/test/crypto/fs APIs, native browser HTML/CSS/JavaScript, GitHub Pages.

## Global Constraints

- The authoritative design is `docs/superpowers/specs/2026-08-12-yunxi-academic-website-editor-redesign-design.zh-CN.md`; the 2026-08-11 specifications, plan, implementation oracles, evidence choices, and local acceptance record are historical only.
- Start implementation from the commit that adds this plan, whose parent is approved specification commit `6623ddc9636fd92d3653ecea3250c342408f1486`, on `feature/yunxi-academic-website`; record that exact plan-commit hash in the execution ledger before Task 1 and stop if the worktree is dirty for unrelated reasons.
- Do not create or connect a remote, push, enable GitHub Pages, publish, or change GitHub account/repository settings.
- Do not modify, move, rename, or delete source PDFs, DOCX, SLX, MATLAB files, TIF files, or any file outside the website worktree. Source material is read-only.
- Public name is `Yunxi Wu`; public email is exactly `yxw1331@student.bham.ac.uk`; no CV link is rendered.
- Public prose is English-first; editor controls, errors, confirmations, recovery instructions, and launcher messages are Chinese.
- Individual projects contain no contribution semantic block, editor field, heading, empty section, or hidden placeholder.
- Team projects contain exactly one non-empty semantic contribution section with the fixed public title `My Role and Contribution`.
- Public content and generated output use full subsystem names, never internal work-package codes.
- Manuscript status remains exactly `Submitted manuscript — Under editorial review` unless the user supplies new editorial evidence in a later approval boundary.
- Most public body text remains Times New Roman-led; manual colours must satisfy WCAG AA text/link contrast and at least 3:1 focus-indicator contrast.
- The editor binds only to `127.0.0.1` (or an explicitly tested equivalent loopback address), has no telemetry, and sends no content to third parties.
- Draft edits and imported image bytes remain in memory until the user presses `保存并生成网站`.
- Failed validation/build/promotion leaves the canonical content tree, including all content-owned images, and the last-known-good `dist` byte-identical.
- Backups live only under `.local-editor/backups/`; fewer than 20 are all retained, and only the editor-created, manifest-validated oldest records are removed after a 21st record is created.
- No system-level installation, administrator privilege, or `PATH` mutation is allowed. A missing runtime may be installed only as a verified portable copy under `.local-editor/tools/`.
- Tests may mutate only task-owned fixtures or explicitly copied generated output. Every controlled mutation must restore the original SHA-256 bytes in `finally` cleanup.
- Every test workspace is created only at `.local-editor/runtime/tests/<random>/` through `createTestWorkspace()`, includes an editor-test sentinel/manifest, and may delete recursively only after realpath plus sentinel verification. Escape-target fixtures use a sibling inside that same test-run root; no system temporary directory or project-external target is used.
- `.local-editor/execution-ledger.json` is the ignored machine-readable task ledger: `{ planCommit, tasks: [{ number, acceptedCommit, specReview, qualityReview, report }] }`. The controller writes it only after both reviews pass and the final task commit is fixed; Task 14 reads the exact accepted Task 13 hash from this file. It never enters Git or `dist`.
- Every task follows RED → minimal GREEN → controlled mutation → focused regression → full regression → diff/scope review → two required reviews → fix/re-review → one final accepted local commit. No skipped tests, no push.
- Each implementation task receives a fresh subagent, then a spec-compliance review and a code-quality review before its final commit. The implementation may create a temporary local checkpoint commit for diff-based review; all findings are fixed and re-reviewed, then the task is squashed/amended into exactly the prescribed single accepted commit before the ledger advances. Review metadata is written only after the final commit hash is stable.

## Canonical File Map

### Toolchain and commands

- Modify: `package.json` — exact dependencies and editor/test scripts.
- Modify: `pnpm-lock.yaml` — locked direct dependency graph.
- Modify: `.gitignore` — exclude `.local-editor/` and generated editor state.
- Modify: `astro.config.mjs` — accept candidate content/output roots only through validated environment variables.
- Create: `启动网站编辑器.bat` — foreground Windows launcher with project-local Node fallback.

### Shared content layer

- Create: `src/lib/content/types.mjs` — JSDoc public types and constants.
- Create: `src/lib/content/schema.mjs` — Zod schemas and ownership/status/colour rules.
- Create: `src/lib/content/markdown.mjs` — reversible supported Markdown parser/serialiser.
- Create: `src/lib/content/project-file.mjs` — gray-matter frontmatter plus Markdown document codec.
- Create: `src/lib/content/page-file.mjs` — About-page codec using the same reversible block model.
- Create: `src/lib/content/research-file.mjs` — research-record frontmatter/body parser and serialiser.
- Create: `src/lib/content/repository.mjs` — canonical filesystem loader and manifest hashing.
- Create: `src/lib/content/bundle.mjs` — complete site/About/research/project/image draft-to-candidate bundle writer.
- Create: `src/lib/content/render-model.mjs` — public/editor-neutral view models.
- Create: `src/lib/content/asset-routes.mjs` — maps content-local images to base-aware public resource routes.
- Create: `src/pages/assets/projects/[slug]/[name].png.ts` and `src/pages/assets/site/[name].png.ts` — prerendered binary resource endpoints.
- Create: `src/content/site.yml` — public profile, theme, navigation, and optional links.
- Create when used: `src/content/site-images/avatar.png` — optional profile image owned by the editable content tree.
- Create: `src/content/pages/about.md` — editable homepage/About prose.
- Replace: `src/content/projects/*.md` with `src/content/projects/<slug>/index.md`.
- Retain and migrate: `src/content/research/more-electric-aircraft.md`.
- Delete after migration: `src/content.config.ts` and `src/data/site.mjs` if no production import remains.

### Public site

- Create: `src/components/ContentBlocks.astro` — semantic rendering for supported blocks.
- Create: `src/components/ProjectDocument.astro` — project metadata and section renderer.
- Modify: `src/components/ProfileSidebar.astro`, `ProjectListItem.astro`, `EvidenceGallery.astro`, `SiteNav.astro`, `SiteFooter.astro`.
- Modify: `src/layouts/BaseLayout.astro` and `src/styles/global.css`.
- Modify: `src/pages/index.astro`, `src/pages/research.astro`, `src/pages/projects/index.astro`, `src/pages/projects/[id].astro`, `src/pages/404.astro`.
- The binary resource endpoints export `getStaticPaths()` from `asset-routes.mjs`, then return validated PNG bytes with `Content-Type: image/png`, a content-length, and no source-path metadata. This is the Astro-documented static-endpoint mechanism; a focused smoke test must prove the exact emitted filenames before Task 3 is accepted.
- Store each project image only at `src/content/projects/<slug>/images/<safe-name>.png`; Markdown keeps the human-editable relative reference `./images/<safe-name>.png`, and `asset-routes.mjs` maps it to the base-aware endpoint URL.
- Store the optional avatar only under `src/content/site-images/`; no tracked mirror is maintained under `public/`.

### Editor service

- Create: `editor/server/main.mjs` — foreground entrypoint and lifecycle.
- Create: `editor/server/app.mjs` — route table and dependency injection.
- Create: `editor/server/auth.mjs` — loopback Host/Origin/session/CSRF policy.
- Create: `editor/server/path-policy.mjs` — canonical confinement and logical-ID validation.
- Create: `editor/server/upload-store.mjs` — session-memory image buffers.
- Create: `editor/server/image-service.mjs` — sharp decode, auto-orient, metadata removal, deterministic naming.
- Create: `editor/server/build-service.mjs` — candidate Astro build with isolated roots.
- Create: `editor/server/transaction-service.mjs` — manifests, journal, promotion, recovery, conflicts, restore, retention.
- Create: `editor/server/operation-lock.mjs` — process and cross-process exclusion for every mutating/recovery operation.
- Create: `editor/server/repository-service.mjs` — bootstrap and draft bundle conversion.
- Create: `editor/server/runtime-locator.mjs` — compatible PATH/project-local Node discovery for the launcher.
- Create: `editor/server/portable-runtime-installer.mjs` — verified, confined ZIP staging used only when the runtime is absent.

### Editor client

- Create: `editor/client/index.html` — accessible Chinese editor shell.
- Create: `editor/client/styles.css` — responsive three-pane editor UI.
- Create: `editor/client/app.mjs` — bootstrap, routing, actions, save/conflict/restore orchestration.
- Create: `editor/client/draft-store.mjs` — immutable draft operations and dirty tracking.
- Create: `editor/client/forms.mjs` — profile/research/project/appearance inspectors.
- Create: `editor/client/preview.mjs` — iframe preview from shared render models.
- Create: `editor/client/image-controls.mjs` — select, preview, caption/alt, replace, hide, delete, reorder.
- Create: `editor/shared/preview-model.mjs` — pure draft-to-preview projection shared by client and parity tests.

### Tests and documentation

- Create fixtures under `test/fixtures/content-v2/`, `test/fixtures/images/`, and `editor/test/fixtures/`.
- Create: `scripts/evidence-crops.mjs`, `scripts/evidence-crops.json` — reproducible, path-parameterised evidence conversion instructions with no external absolute paths.
- Modify: `test/helpers.mjs` — retain existing generated-output helpers and add the shared test interfaces below.
- Create focused tests listed in each task below; replace stale fixed-count/oracle tests rather than weakening them.
- Rewrite `docs/content-evidence.md`, `docs/maintenance.md`, and `README.md`.
- Create final acceptance record only at `docs/qa/2026-08-12-editor-redesign-local-acceptance.md` after every gate passes.

---

### Task 1: Lock the redesign dependencies and local-state boundary

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `pnpm-workspace.yaml`
- Modify: `.gitignore`
- Create/Test: `editor/test/toolchain.test.mjs`

**Interfaces:**
- Produces exact direct imports used later: `zod`, `unified`, `remark-parse`, `remark-stringify`, `remark-gfm`, and `sharp`.
- Produces scripts: `editor`, `test:unit`, and the fail-closed full `test` pipeline.
- If an editor test directory has not yet been populated, create the Task 1 contract file before changing the full `test` glob; the command must never depend on a non-matching glob being ignored.

- [ ] **Step 1: Write the failing dependency/ignore contract**

```js
// editor/test/toolchain.test.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const packageJson = JSON.parse(await readFile(new URL('../../package.json', import.meta.url)));
const ignore = await readFile(new URL('../../.gitignore', import.meta.url), 'utf8');
const workspace = await readFile(new URL('../../pnpm-workspace.yaml', import.meta.url), 'utf8');

test('editor dependencies and scripts are exact and local state is ignored', () => {
  assert.deepEqual(
    Object.fromEntries(['zod', 'unified', 'remark-parse', 'remark-stringify', 'remark-gfm', 'sharp']
      .map((name) => [name, packageJson.devDependencies[name]])),
    {
      zod: '4.4.3', unified: '11.0.5', 'remark-parse': '11.0.0',
      'remark-stringify': '11.0.0', 'remark-gfm': '4.0.1', sharp: '0.35.3',
    },
  );
  assert.equal(packageJson.scripts.editor, 'node editor/server/main.mjs');
  assert.match(packageJson.scripts.test, /editor\/test\/\*\.test\.mjs/);
  assert.match(ignore, /^\.local-editor\/$/m);
  assert.match(workspace, /^  sharp: true$/m);
});
```

- [ ] **Step 2: Run RED**

Run: `node --test editor/test/toolchain.test.mjs`
Expected: FAIL because the six direct dependencies, editor script, and `.local-editor/` rule are absent.

- [ ] **Step 3: Add exact dependencies and scripts**

First add `sharp: true` alongside the existing `esbuild: true` entry in `pnpm-workspace.yaml`; do not use a wildcard build-script approval. Then run:

Run: `pnpm add --save-dev --save-exact zod@4.4.3 unified@11.0.5 remark-parse@11.0.0 remark-stringify@11.0.0 remark-gfm@4.0.1 sharp@0.35.3`

Set scripts to:

```json
{
  "editor": "node editor/server/main.mjs",
  "test:unit": "node --test test/*.test.mjs editor/test/*.test.mjs",
  "test": "astro check && astro build && node --test test/*.test.mjs editor/test/*.test.mjs"
}
```

Add only `.local-editor/` to `.gitignore`; do not broaden ignore rules to hide arbitrary archives or documents.

- [ ] **Step 4: Verify GREEN and frozen install**

Run: `node --test editor/test/toolchain.test.mjs`
Expected: PASS.

Run: `pnpm install --frozen-lockfile`
Expected: exit 0 with `package.json` and `pnpm-lock.yaml` hashes unchanged.

- [ ] **Step 5: Controlled mutation**

Temporarily remove the `.local-editor/` line in a copied fixture or in-memory source passed to the assertion; verify the focused test fails only for the local-state boundary, then restore exact bytes.

- [ ] **Step 6: Full gate and commit**

Run: `pnpm test`
Expected: current fresh static build and all existing tests plus Task 1 test pass with zero skip/todo; record actual route/test counts rather than turning the current seven routes into a new permanent oracle.

Commit: `chore: add local editor dependencies`

---

### Task 2: Implement the reversible Markdown/YAML content contract

**Files:**
- Create: `src/lib/content/types.mjs`
- Create: `src/lib/content/schema.mjs`
- Create: `src/lib/content/markdown.mjs`
- Create: `src/lib/content/project-file.mjs`
- Create: `src/lib/content/page-file.mjs`
- Create: `src/lib/content/research-file.mjs`
- Create: `src/lib/content/bundle.mjs`
- Create: `test/fixtures/content-v2/individual/index.md`
- Create: `test/fixtures/content-v2/team/index.md`
- Create: `test/fixtures/content-v2/advanced/index.md`
- Modify: `test/helpers.mjs`
- Test: `test/content-codec.test.mjs`

**Interfaces:**
- Produces `parseProjectFile(source: string): ProjectDocument`.
- Produces `serializeProjectFile(document: ProjectDocument): string`.
- Produces `parseResearchFile(source: string): ResearchDocument`.
- Produces `serializeResearchFile(document: ResearchDocument): string`, `parsePageFile(source): PageDocument`, and `serializePageFile(document): string`.
- Produces `parseSiteYaml(source): SiteConfig`, `serializeSiteYaml(site): string`, and `writeCandidateBundle({ root, draft, uploads }): Promise<BundleManifest>`; the bundle includes `site.yml`, About, all research records, every project record, site images, and project images.
- Produces `validateProject(document): ProjectDocument`, `validateResearch(document): ResearchDocument`, and `validateSite(value): SiteConfig`.
- Produces `validateThemeContrast(theme): ThemeContrastResult`, which computes sRGB relative luminance and blocks save unless normal text/link combinations meet WCAG AA (4.5:1; 3:1 only for qualifying large text) and every focus indicator meets 3:1 against adjacent configured backgrounds. Failure includes the exact Chinese field and required/actual ratio.
- `ProjectDocument` has `{ slug, frontmatter, sections, newline, trailingNewline }`; folder name is the single slug identity and frontmatter must not duplicate it. Every section has `{ id, kind, hidden, title, blocks }`.
- Supported block union: `subheading`, `paragraph`, `list`, `table`, `image`, `advanced`.
- Test helper added here: `readFixture(relativePath: string): Promise<string>` resolves only under `test/fixtures/content-v2/` after realpath confinement.
- Unmarked supported Markdown is parsed into `pendingEditorIds`; `adoptEditorIds(document, idFactory)` assigns session-stable IDs in memory, and markers are written only by a successful candidate bundle promotion. Failed/unsaved drafts never alter the source.

- [ ] **Step 1: Write codec and ownership RED tests**

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { parseProjectFile, serializeProjectFile } from '../src/lib/content/project-file.mjs';
import { validateProject, validateResearch } from '../src/lib/content/schema.mjs';

test('supported Markdown round-trips semantically and advanced bytes survive exactly', async () => {
  const source = await readFixture('advanced/index.md');
  const parsed = parseProjectFile(source);
  assert.equal(parsed.sections[0].blocks.at(-1).type, 'advanced');
  assert.equal(parsed.sections[0].blocks.at(-1).raw, '<details>\r\nraw body\r\n</details>');
  assert.deepEqual(parseProjectFile(serializeProjectFile(parsed)), parsed);
});

test('ownership is semantic rather than heading-text inference', () => {
  const individualWithContribution = parseProjectFile(INVALID_INDIVIDUAL_SOURCE);
  const teamWithoutContribution = parseProjectFile(INVALID_TEAM_SOURCE);
  const validTeam = parseProjectFile(VALID_TEAM_SOURCE);
  assert.throws(() => validateProject(individualWithContribution), /个人项目不能包含贡献章节/);
  assert.throws(() => validateProject(teamWithoutContribution), /团队项目必须包含且仅包含一个/);
  assert.equal(validateProject(validTeam).sections.filter((s) => s.kind === 'contribution').length, 1);
});
```

Define the three uppercase source constants in the same test from literal, privacy-safe frontmatter plus marker snippets; do not leave them as implicit globals.

Fixtures must cover LF, CRLF, final/no-final newline, bold/italic/link paragraphs, ordered/unordered lists, GFM tables, h3, image plus `*Caption:*`, hidden blocks, malformed/duplicate IDs, a contribution heading with the wrong semantic marker, and unsupported raw HTML.

Also round-trip `site.yml`, About, and multiple research records; add/edit/delete one research record and assert serialize→reload stability. For unmarked Markdown, assert two parses with an injected deterministic ID factory produce a stable draft, canonical bytes remain unchanged before promotion, and only the successful bundle contains the new markers.

- [ ] **Step 2: Run RED**

Run: `node --test test/content-codec.test.mjs`
Expected: `ERR_MODULE_NOT_FOUND` for the new codec modules.

- [ ] **Step 3: Define exact constants and schemas**

```js
export const PROJECT_KINDS = Object.freeze(['individual', 'team']);
export const BLOCK_TYPES = Object.freeze(['subheading', 'paragraph', 'list', 'table', 'image', 'advanced']);
export const CONTRIBUTION_TITLE = 'My Role and Contribution';
export const MANUSCRIPT_STATUS = 'Submitted manuscript — Under editorial review';
export const EDITOR_ID = /^[a-z][a-z0-9-]{7,63}$/;
```

Use Zod refinements to enforce semantic ownership, stable IDs, a fixed contribution title, safe relative image paths, URL protocols `https:`/`mailto:`, non-empty visible sections, and colour strings limited to six-digit hexadecimal values.

Project frontmatter schema is exact: `{ kind, category, title, shortTitle, summary, role, methods, featured, order, date?, status? }`. `kind` is behavioral and `category` is display-only. The directory supplies `slug`; reject any frontmatter slug field to prevent two identity sources.

Theme tests use boundary colour pairs around 4.5:1 and 3:1, cover text/background, text/surface, accent link/background, accent link/surface and focus/adjacent surfaces, and prove unsafe manual colours are rejected before bundle writing.

- [ ] **Step 4: Implement positional parsing and deterministic serialisation**

Use `unified().use(remarkParse).use(remarkGfm)` and AST `position.start.offset`/`position.end.offset` to retain raw source slices. Do not enable dangerous/raw HTML rendering. Unsupported pure-Markdown nodes remain raw for round-trip preservation; unsupported HTML nodes render publicly and in preview as escaped code/text, never as executable DOM. Recognise only exact editor comments:

```js
const marker = /^<!-- editor:(section|block) id="([a-z][a-z0-9-]{7,63})"(?: kind="(standard|contribution)")?(?: type="([a-z]+)")? hidden="(true|false)" -->$/;
```

Use `remark-stringify`/`remark-gfm` only for edited supported nodes. Preserve each `advanced.raw` byte-for-byte, preserve detected newline style, and never rewrite an unsupported node as plain text.

- [ ] **Step 5: Run GREEN, mutation, and full regression**

Run: `node --test test/content-codec.test.mjs`
Expected: all focused cases pass.

Controlled mutations, one at a time:

- change a team section marker from `kind="contribution"` to `kind="standard"` → ownership test fails;
- delete one byte inside the raw `<details>` block → exact-raw assertion fails;
- replace one CRLF with LF inside an advanced block → byte-preservation assertion fails.

Restore fixture hashes after every mutation. Run `pnpm test`; expect all tests pass.

Mutate `serializeResearchFile` to omit a body block, let an unsupported node be rewritten, or write adopted IDs before successful promotion; the corresponding round-trip/source-hash test must fail.

- [ ] **Step 6: Commit**

Commit: `feat: add reversible content codec`

---

### Task 3: Move profile, About, and research data to the shared repository

**Files:**
- Create: `src/content/site.yml`
- Create: `src/content/pages/about.md`
- Create: `src/lib/content/repository.mjs`
- Create: `src/lib/content/render-model.mjs`
- Create: `src/lib/content/asset-routes.mjs`
- Create: `src/pages/assets/projects/[slug]/[name].png.ts`, `src/pages/assets/site/[name].png.ts`
- Modify: `src/content/research/more-electric-aircraft.md`
- Modify: `src/layouts/BaseLayout.astro`
- Modify: `src/components/ProfileSidebar.astro`, `SiteNav.astro`, `SiteFooter.astro`, `ManuscriptEntry.astro`
- Modify: `src/pages/index.astro`, `src/pages/research.astro`, `src/pages/404.astro`
- Delete after import audit: `src/data/site.mjs`
- Modify: `test/site-data.test.mjs`, `test/shell-output.test.mjs`, `test/research-output.test.mjs`
- Modify: `test/helpers.mjs`
- Test: `test/site-config-v2.test.mjs`

**Interfaces:**
- Produces `loadSiteRepository({ contentRoot }): Promise<SiteRepository>`; asset bytes are validated through content-relative image references and remain inside that root.
- Produces `computeRepositoryManifest(repositoryRoot): Promise<{ hash, files }>` using SHA-256 over sorted POSIX-relative paths and bytes.
- Produces `toPublicSiteModel(repository): PublicSiteModel`, consumed by Astro and the editor bootstrap API.
- Produces `toPublicAssetHref({ kind, slug, relativeSource, base }): string` and `listStaticAssetRoutes(repository): StaticAssetRoute[]`; only validated `./images/<safe-name>.png` and site-image references are accepted.
- Test helper added here: `copyRepositoryFixture(name: string): Promise<{ root, cleanup }>` copies `test/fixtures/content-v2/<name>/` into a sentinel-protected child of `createTestWorkspace()` and returns an idempotent cleanup function.

- [ ] **Step 1: Replace the fixed-object oracle with failing configuration behavior tests**

```js
test('empty optional profile fields render no placeholder or layout slot', async () => {
  const fixture = await copyRepositoryFixture('empty-optionals');
  try {
    const repository = await loadSiteRepository({ contentRoot: fixture.root });
    assert.deepEqual(toPublicSiteModel(repository).profile.links, []);
    assert.equal(toPublicSiteModel(repository).profile.avatar.mode, 'hidden');
  } finally { await fixture.cleanup(); }
});

test('the verified manuscript status cannot silently advance', async () => {
  const source = await readFixture('research/more-electric-aircraft.md');
  const advanced = { ...parseResearchFile(source), status: 'Accepted' };
  assert.throws(() => validateResearch(advanced), /未经证据批准的稿件状态/);
});

test('content-local images map to one base-aware static resource route', async () => {
  const fixture = await copyRepositoryFixture('one-image');
  try {
    const repository = await loadSiteRepository({ contentRoot: fixture.root });
    assert.deepEqual(listStaticAssetRoutes(repository).map(({ pathname }) => pathname), [
      '/assets/projects/sample-project/result.png',
    ]);
    assert.equal(
      toPublicAssetHref({ kind: 'project', slug: 'sample-project', relativeSource: './images/result.png', base: '/repo/' }),
      '/repo/assets/projects/sample-project/result.png',
    );
  } finally { await fixture.cleanup(); }
});
```

`parseResearchFile` uses gray-matter plus the research Zod schema and returns no filesystem data.

Define the `one-image` fixture inside `test/fixtures/content-v2/`. Update old tests so they derive navigation/research cardinality from loaded content rather than importing `site.mjs`.

- [ ] **Step 2: Run RED**

Run: `node --test test/site-config-v2.test.mjs test/site-data.test.mjs test/research-output.test.mjs`
Expected: failure because the YAML repository loader does not exist.

- [ ] **Step 3: Add the exact initial site configuration**

```yaml
name: Yunxi Wu
degree: BEng Electronic and Electrical Engineering
institution: University of Birmingham
email: yxw1331@student.bham.ac.uk
intro: >-
  I am a BEng Electronic and Electrical Engineering student at the University of Birmingham, working across systems modelling, control and signal processing while developing toward research in Embodied AI, Computer Vision and Robotics.
interests:
  - Embodied AI
  - Machine Learning
  - Computer Vision
  - Robotics
avatar:
  mode: initials
links:
  github: null
  linkedin: null
  googleScholar: null
  orcid: null
  custom: []
theme:
  background: '#ffffff'
  surface: '#f7f8f9'
  text: '#17212b'
  accent: '#2d587a'
navigation:
  - { label: About, href: / }
  - { label: Projects, href: /projects/ }
  - { label: Research, href: /research/ }
```

`about.md` contains the current-direction paragraph as editable Markdown. Schema supports optional GitHub, LinkedIn, Google Scholar, ORCID, ordered custom links, and optional public profile fields; `null`, absent, hidden, or empty arrays render nothing and reserve no spacing.

- [ ] **Step 4: Implement loaders and consume them from Astro**

Use URL-relative default roots so tests can inject fixtures and candidate builds can set validated roots. `BaseLayout.astro` receives `site` as an explicit prop, emits validated CSS variables, and derives metadata/navigation from the repository. Each binary endpoint exports `getStaticPaths()` using `listStaticAssetRoutes()`, then reads only the confined path bound to the current params and returns PNG bytes. A fresh-build test proves the fixture is emitted at the mapped route with identical SHA-256 and no source-path metadata. No component imports `src/data/site.mjs` after migration.

- [ ] **Step 5: GREEN, controlled mutations, and commit**

Run focused tests and `pnpm build`; expect generated pages to keep the exact public identity/status with no CV or empty link/avatar slots.

Mutate one custom link to invalid `javascript:` → loader rejects. Mutate `avatar.mode` to `image` without an asset → loader rejects. Restore exact bytes.

Run `pnpm test`; expect zero failures/skips. Delete `src/data/site.mjs` only after `rg` proves no production/test import remains.

Commit: `refactor: load profile and research content`

---

### Task 4: Migrate and rewrite all three project records

**Files:**
- Create: `src/content/projects/future-ocean-habitat/index.md`
- Create: `src/content/projects/life-support-system/index.md`
- Create: `src/content/projects/communication-system-modelling/index.md`
- Create/Rewrite before content assertions: `docs/content-evidence.md` with claim-level entries; Task 5 later adds asset records to the same register.
- Create: `src/components/ContentBlocks.astro`
- Create: `src/components/ProjectDocument.astro`
- Modify: `src/components/ProjectListItem.astro`
- Modify: `src/pages/projects/index.astro`, `src/pages/projects/[id].astro`
- Delete after route migration: three flat files under `src/content/projects/`
- Delete after import audit: `src/content.config.ts`
- Replace stale assertions: `test/content-source.test.mjs`, `test/project-routes.test.mjs`
- Modify: `test/helpers.mjs`
- Test: `test/project-ownership-v2.test.mjs`, `test/project-claims-v2.test.mjs`

**Interfaces:**
- `loadProjects()` returns sorted `ProjectDocument[]` from nested `index.md` records.
- `ProjectDocument.astro` receives `{ project: ProjectDocument }` and renders frontmatter plus sections in source order.
- `ContentBlocks.astro` receives `{ blocks: Block[] }`; supported Markdown nodes use the shared safe renderer, while advanced HTML is escaped and displayed as text/code, never injected as raw DOM.
- Test helpers added here: `loadProjectFixture(slug): Promise<ProjectDocument>` delegates to the production repository loader; `readBuiltRoute(route): Promise<string>` reads only a confined HTML route under fresh `dist`.
- Preserve the existing public slugs exactly: `life-support-system`, `communication-system-modelling`, and `future-ocean-habitat`; moving a flat record into its folder must not change its published route. `loadProjects()` derives `project.slug` only from the validated directory name.
- `loadEvidenceRegister(): EvidenceRegister` exposes claim records to content tests and later asset records to Task 5; public project claims reference stable `claimId` values in test fixtures/register mapping, not raw prose snapshots.

- [ ] **Step 1: Write RED behavior tests before changing production content**

```js
test('individual records and DOM contain no contribution surface', async () => {
  for (const slug of ['life-support-system', 'communication-system-modelling']) {
    const project = await loadProjectFixture(slug);
    assert.equal(project.sections.some((s) => s.kind === 'contribution'), false);
    const $ = load(await readBuiltRoute(`/projects/${slug}/`));
    assert.equal($('h2').filter((_, el) => /contribution/i.test($(el).text())).length, 0);
  }
});

test('team record has one protected contribution section and no internal codes', async () => {
  const project = await loadProjectFixture('future-ocean-habitat');
  assert.equal(project.sections.filter((s) => s.kind === 'contribution').length, 1);
  assert.equal(project.sections.find((s) => s.kind === 'contribution').title, 'My Role and Contribution');
  assert.doesNotMatch(serializeProjectFile(project), /\bWP\d+[A-Z]?\b/);
  assert.doesNotMatch(await readBuiltRoute('/projects/future-ocean-habitat/'), /\bWP\d+[A-Z]?\b/);
});
```

Before the content mutation, write claim-level evidence-register records for every public number and conclusion below. Each stable `claimId` records source material type, physical page or code location, ownership, one of the exact five fact classes (`design target / specification`, `analytical calculation`, `model estimate`, `reported simulation result`, `implementation cross-check`), permitted wording, and limitation; it contains no absolute path/private identity/full source text. Claims tests require all five classes to be understood, load the register as the oracle, assert every registered public claim occurs only with its permitted qualifier, and prohibit `built`, `deployed`, `experimentally validated`, `measured efficiency`, `real-time capable`, `statistically significant`, and equivalent unsupported status vocabulary. Task 4 may not commit until register completeness and content agreement both pass.

- [ ] **Step 2: Run RED against the first-version records**

Run: `pnpm build && node --test test/project-ownership-v2.test.mjs test/project-claims-v2.test.mjs`
Expected: fail because individual records still contain contribution arrays, the route always renders `My Contribution`, public team copy contains internal codes, and life-support copy says 97.7%.

- [ ] **Step 3: Write the final evidence-led English project copy**

Life-support record:

- Frontmatter: `kind: individual`; `category: Individual detailed-design project`; `title: Multi-Domain Life-Support Power and Control Simulation`; `shortTitle: Life-Support Power and Control`; `summary: An individual Simulink/Simscape design coupling power conversion with water, atmospheric-gas, thermal and humidity regulation for a future ocean habitat.`; `role: Designer and modeller of the individually submitted detailed design`; `methods: [MATLAB/Simulink, Simscape Electrical, Simscape Fluids, Closed-loop control]`; `featured: true`; `order: 2`.
- Sections in order: `Engineering Challenge`, `Coupled System Architecture`, `Control Strategy`, `Simulation Evidence`, `Model Limitations and Next Steps`, `Selected Technical Evidence`.
- Open with: `Life-support demand cannot be represented credibly as a bank of fixed resistors: pumps, electrolysis, ventilation and thermal management switch with water inventory and cabin conditions.`
- State the attribution boundary: this is an individual detailed design, model, and report within the larger team habitat concept; it does not claim personal authorship of the whole habitat.
- Make the flagship contribution explicit as coupled closed-loop modelling across electrical, rotational-mechanical, moist-air/thermal, gas-concentration, and water-inventory domains—not merely a list of subsystems.
- Explain the disturbed 690 V three-phase source, DC link, protected/filtered conversion, regulated 180 V distribution bus, and coupling to water intake/desalination/recovery/distribution, oxygen generation, carbon-dioxide removal, HVAC and dehumidification.
- Explain supervisory O₂/CO₂/water/temperature/dew-point feedback and lower-layer feedforward + PI + filtering + PWM.
- State that, under the documented disturbance and load-switching sequence, the simulated 180 V bus remained close to reference while DC-link voltage/current changed; make no unsupported ripple/settling claim.
- State only reported simulation ranges: water 600–1200 L, desalination about 1200 L/day, O₂ 20.5–21.5%, CO₂ near 400 ppm, temperature within 15–30 °C, dew point below 12 °C.
- State `approximately 97.6% for the documented model configuration` and immediately say it is a cumulative simulated input-output energy ratio, not measured physical-system or converter efficiency; some average-value converter elements use idealised efficiency settings.
- Close with rated-point/empirical-model, manufacturer-map, higher-fidelity SWRO/HVAC, thermal-port, ageing/fault, and experimental-validation limits.

Communication record:

- Frontmatter: `kind: individual`; `category: Individual laboratory project`; `title: Communication-System Modelling and Filter Optimisation`; `shortTitle: Communication-System Modelling`; `summary: Built a reproducible MATLAB study connecting thermal-noise theory, distance-dependent attenuation and coherent OOK demodulation with a controlled comparison of four filtering methods under AWGN.`; `role: Individual modelling, implementation and analysis`; `methods: [MATLAB, Signal processing, BER and MSE analysis]`; `featured: true`; `order: 3`.
- Sections in order: `System Model`, `Filter-Optimisation Pipeline`, `Results and Engineering Interpretation`, `Validation and Limitations`, `Selected Technical Evidence`.
- State capacity values 2.835/4.698/7.504 Gb/s at the model point nearest 290 K for 0.5/1/2 GHz.
- State SNR 103.86 dB at 0 km and 63.86 dB at 20 km under 2 dB/km.
- Describe fixed seed, nine noise amplitudes, moving-median/FFT/fourth-order Butterworth/fourth-order Chebyshev, centre-bit sampling and threshold 0.25.
- State that only median-window search uses MSE to break equal-BER parameter ties; FFT/IIR searches select the first minimum-BER candidate; final overall ranking uses average BER then average MSE.
- State Butterworth's reported average BER 0.0593 and MSE 4.04 × 10⁻² only for this deterministic 15-bit, nine-condition simulation.
- State BER resolution 1/15 per condition and 1/135 for the nine-condition average; each noise amplitude has one fixed-seed realisation and parameter tuning/evaluation use the same simulated signal. Explain that `filtfilt`, known noise level and fixed decision threshold limit real-time interpretation, while Excel/closed-form calculations are implementation cross-checks rather than independent predictive validation. Reject generalisation and statistical-significance claims.

Team habitat record:

- Frontmatter: `kind: team`; `category: Team systems-design project`; `title: Future Ocean Habitat — Integrated Systems Concept Design`; `shortTitle: Future Ocean Habitat`; `summary: A team systems-design concept for a future ocean habitat, integrating energy, communication and control, thermal management and an underwater data centre across shared engineering interfaces.`; `role: Group Coordinator; lead for the Energy System, Communication, Monitoring and Control Systems, and Underwater Data Centre`; `methods: [Systems engineering, Requirements analysis, Concept design]`; `featured: true`; `order: 1`.
- Sections in order: `Design Context`, `My Role and Contribution`, `Technical Highlights`, `Outcomes and Limits`, `Selected Technical Evidence`.
- Use the approved contribution paragraph verbatim from the specification.
- Use full names `Energy System`, `Communication, Monitoring and Control Systems`, and `Underwater Data Centre`.
- State the fixed-point OTEC design result as about 2.298 MW gross for a 1.500 MW net target, about 0.729 MW pumping, 0.069 MW auxiliary and 11 model iterations.
- State the 6.6 kV dual bus, 690 V local distribution, N-1 paths, S0–S4 shedding, and supercapacitor/LFP/hydrogen timescale concept.
- State the 250 kW UDC design load, four hydraulically isolated/thermally coupled loops, 40–45 °C technical loop, 43/33 °C heat-recovery bus and 10–14 °C seawater rejection.
- State the selected single-fault concept case preserves 200 kW/80% service with 1+1 pumps/heat exchangers and isolation; label all values as design/model estimates.
- Separate team output from personal leadership; prohibit sole authorship, built/deployed/tested claims and AI safety-control claims. State that safety authority remains with deterministic local control and interlocks, and do not present a single deployment-depth conclusion.

- [ ] **Step 4: Implement the semantic renderer and remove stale schema/oracles**

Render only visible sections. Derive contribution behavior from `section.kind`, not title regex. Use project summary metadata followed by ordered h2 sections. If a project has no images, render no evidence heading or empty gallery.

Delete the old flat records and `src/content.config.ts` only after `rg` proves no import/reference remains. Rewrite old tests to load canonical documents dynamically; do not preserve fixed six-section, fixed three-project, or fixed six-image assumptions.

- [ ] **Step 5: GREEN and controlled mutations**

Run: `pnpm build && node --test test/content-source.test.mjs test/project-routes.test.mjs test/project-ownership-v2.test.mjs test/project-claims-v2.test.mjs`
Expected: PASS.

Mutations:

- add a contribution marker to life support → schema and DOM contract fail;
- remove team contribution marker while retaining its heading text → semantic contract fails;
- change `97.6%` to `97.7%` → claim test fails;
- reinsert one internal code into visible team copy → public-code test fails;
- change communication copy to say every filter uses MSE tie-breaking → claim test fails.

Restore hashes after each mutation and run `pnpm test`, then continue to the required reviews.

- [ ] **Step 6: Complete both reviews, collapse to one accepted task commit, and update the ledger**

Run the specification-compliance and code-quality reviews on a temporary checkpoint. Fix and re-review every finding, then squash/amend the Task 4 work to the single commit below. After verifying its stable hash and clean scope, record it in `.local-editor/execution-ledger.json`. The same review-before-final-commit procedure applies to every Task 1–13 `commit` step, even where it is not repeated verbatim.

Commit: `feat: rewrite project evidence narratives`

---

### Task 5: Replace the six first-version images with six re-audited initial evidence assets

**Files:**
- Create: `scripts/evidence-crops.mjs`
- Create: `scripts/evidence-crops.json`
- Create: six PNG files under paired project directories in `src/content/projects/<slug>/images/`
- Modify: three project `index.md` files to add image blocks and captions
- Rewrite: `docs/content-evidence.md`
- Replace: `test/assets.test.mjs`
- Test: `test/evidence-register-v2.test.mjs`
- Remove after successful replacement: the six first-version derivative PNGs in `public/assets/projects/`; no source document or source image outside the worktree is changed.

**Interfaces:**
- `cropRenderedPage({ input, output, pageWidthPt, pageHeightPt, boxPt }): Promise<AssetRecord>`.
- `convertSourceImage({ input, output, trimBackground }): Promise<AssetRecord>`.
- Each `AssetRecord` contains `{ sha256, width, height, colourSpace, metadataKeys }`.
- Initial-selection tests read the six approved asset IDs/relative destinations from `scripts/evidence-crops.json`; generic repository/output tests derive future asset sets from visible Markdown image blocks and never hard-code a permanent global count.

- [ ] **Step 1: Read the PDF skill and establish source immutability**

Before touching evidence, the task agent reads the complete `pdf:pdf` skill. Record SHA-256 and byte size for each read-only source used. Render only locked physical pages to `.local-editor/runtime/evidence-source/`; never render covers or identity/contribution pages.

The crop configuration uses PDF point coordinates, not fragile screenshot pixels. `boxPt` is `[left, top, right, bottom]` in PDF points from the upper-left of the page after applying the page rotation to the MediaBox; edges are half-open. At render resolution `dpi`, convert with `floor(left*dpi/72)`, `floor(top*dpi/72)`, `ceil(right*dpi/72)`, `ceil(bottom*dpi/72)`, clamp inward to the rotated raster, and record the final pixel box. Every page—not only the two team pages—must first render uncropped and be checked for rotation, MediaBox size and the proposed overlay before an output is written:

```json
{
  "formatVersion": 1,
  "coordinateSystem": "rotated-mediabox-upper-left-points-half-open",
  "assets": [
    {
      "id": "life-support-bus-control",
      "sourceKind": "pdf-page",
      "sourceId": "life-support-report",
      "page": 9,
      "boxPt": [72, 72, 523, 381],
      "destination": "src/content/projects/life-support-system/images/bus-control.png"
    },
    {
      "id": "life-support-environmental-regulation",
      "sourceKind": "pdf-page",
      "sourceId": "life-support-report",
      "page": 17,
      "boxPt": [72, 72, 523, 643],
      "destination": "src/content/projects/life-support-system/images/environmental-regulation.png"
    },
    {
      "id": "communication-mse-ber",
      "sourceKind": "source-image",
      "sourceId": "communication-source-images",
      "sourceName": "MSE BER.tif",
      "transform": "auto-orient-and-trim-uniform-white",
      "destination": "src/content/projects/communication-system-modelling/images/mse-ber.png"
    },
    {
      "id": "communication-median-window-sensitivity",
      "sourceKind": "source-image",
      "sourceId": "communication-source-images",
      "sourceName": "窗口敏感性图.tif",
      "transform": "auto-orient-and-trim-uniform-white",
      "destination": "src/content/projects/communication-system-modelling/images/median-window-sensitivity.png"
    },
    {
      "id": "habitat-otec-convergence",
      "sourceKind": "pdf-page",
      "sourceId": "habitat-team-report",
      "page": 130,
      "boxPt": [151, 76, 468, 335],
      "destination": "src/content/projects/future-ocean-habitat/images/otec-convergence.png"
    },
    {
      "id": "habitat-udc-thermal-loops",
      "sourceKind": "pdf-page",
      "sourceId": "habitat-team-report",
      "page": 371,
      "boxPt": [94, 148, 515, 425],
      "destination": "src/content/projects/future-ocean-habitat/images/udc-thermal-loops.png"
    }
  ]
}
```

Parse this as a discriminated union: `pdf-page` requires only `{ sourceId, page, boxPt, destination }` beyond common ID fields; `source-image` requires only `{ sourceId, sourceName, transform, destination }`. Reject missing, extra or cross-variant fields. At execution, the controller maps these three stable IDs to the already user-supplied read-only sources through an ignored `.local-editor/runtime/evidence-source-bindings.json`; `scripts/evidence-crops.mjs` receives that binding file explicitly, confines every output to the worktree, opens inputs read-only, records source hashes, and never writes a path into tracked config/registers.

The two group boxes are initial point conversions from the audited 827×1170 render coordinates. If any overlay includes a caption edge, tighten inward without adding content, update `boxPt` with the final reviewed coordinates, then regenerate. This is a safe-boundary calibration, not permission to include adjacent text.

Communication sources are the original high-resolution `MSE BER.tif` and `窗口敏感性图.tif` corresponding to report result figures. Use `sharp(...).rotate().trim({ background: '#ffffff', threshold: 10 }).png()` to remove only uniform outer whitespace; keep axes, legends and panel labels.

- [ ] **Step 2: Write RED asset/evidence tests**

Tests assert:

- the initial selection manifest contains exactly the six approved IDs/destinations above and RED fails because each destination is missing before generation;
- every visible project image resolves to exactly one file inside that project's slug directory;
- every file decodes as static RGB/RGBA PNG with no EXIF/XMP/IPTC/ICC/text metadata;
- captions and alts are separate non-empty Markdown fields and do not start with `Fig.`/`Figure`/`Table`;
- evidence register has exactly one entry per visible asset and records source document type, physical page or source-image name, crop/conversion rule, factual purpose, ownership, and limitation;
- register contains no absolute path, student-number pattern, teammate list, or source-document full text.

```js
const selection = await readInitialEvidenceSelection();
for (const item of selection.assets) {
  await assert.rejects(access(item.destination), { code: 'ENOENT' });
}
for (const project of await loadProjects()) {
  for (const block of visibleImageBlocks(project)) {
    const asset = await resolveProjectImage(project, block.src);
    assert.equal(asset.projectSlug, project.slug);
    assert.equal(asset.format, 'png');
    assert.deepEqual(asset.metadataKeys, []);
    assert.doesNotMatch(block.caption, /^(?:fig(?:ure)?|table)\b/i);
    assert.ok(block.alt.trim());
  }
}
assert.deepEqual(await registeredAssetIds(), await visibleAssetIds());
```

Run RED before creating outputs or adding Markdown image blocks; expect six missing approved destinations plus the stale-old-asset assertion. After GREEN, generic visible-block/register equality replaces the initial missing-file assertion.

- [ ] **Step 3: Produce exact outputs without modifying sources**

Output files:

```text
src/content/projects/life-support-system/images/bus-control.png
src/content/projects/life-support-system/images/environmental-regulation.png
src/content/projects/communication-system-modelling/images/mse-ber.png
src/content/projects/communication-system-modelling/images/median-window-sensitivity.png
src/content/projects/future-ocean-habitat/images/otec-convergence.png
src/content/projects/future-ocean-habitat/images/udc-thermal-loops.png
```

Use these editable captions:

- `Feedforward and PI feedback control used to regulate the 180 V life-support bus.`
- `Simulated oxygen, carbon-dioxide, cabin-temperature and dew-point regulation under the documented operating sequence.`
- `Mean-squared error and bit-error rate across the four optimised filtering pipelines in the documented simulation.`
- `Median-window selection and the trade-off between noise suppression and edge preservation.`
- `Fixed-point convergence of the coupled gross-generation and parasitic-load calculation.`
- `Four hydraulically isolated but thermally coupled loops linking rack cooling, heat recovery and seawater rejection.`

Write specific alt text that describes axes/blocks rather than repeating captions.

- [ ] **Step 4: Original-detail inspection and privacy/provenance gate**

Inspect each final PNG individually at original detail. Confirm no visible `Fig.`, report caption, page header/footer, student data, teammate data, rubric text, or unintended adjacent paragraph. Confirm the microgrid product-icon image is not used. Compare source hashes after processing to the preflight hashes; they must be identical.

Delete only the six Git-tracked first-version derivative PNGs after the new Markdown references and all tests are green; Git history makes those website derivatives recoverable. Delete scratch renders only inside `.local-editor/runtime/evidence-source/` after their outputs and source hashes are verified.

- [ ] **Step 5: Mutation, full gate, and commit**

Mutate one copied PNG by adding metadata → metadata test fails. Mutate one caption to start `Fig. 1` → caption test fails. Point one Markdown image across slug directories → confinement test fails. Restore bytes.

Run `pnpm test`, inspect built image copies and hashes, run repository privacy scan, complete the required reviews/fixes/re-reviews, and include only scripts/config, six outputs, three Markdown files, register, and tests in the final accepted commit.

Commit: `feat: replace project evidence assets`

---

### Task 6: Finish the dynamic public presentation and generated-output audit

**Files:**
- Modify: `src/components/ContentBlocks.astro`, `ProjectDocument.astro`, `ProjectListItem.astro`, `EvidenceGallery.astro`
- Modify: `src/layouts/BaseLayout.astro`
- Modify: `src/styles/global.css`
- Modify: `test/dist-audit.test.mjs`, `test/focus-contrast.test.mjs`
- Test: `test/dynamic-site-v2.test.mjs`

**Interfaces:**
- Public DOM uses stable semantic class names only; editor markers never enter `dist`.
- Audit discovers routes from built anchors/files and projects from canonical records, not a fixed route count.

- [ ] **Step 1: Write RED layout/semantic tests**

Assert one h1, source-ordered h2, h3 only inside h2 sections, no empty `section`/`figure`, optional profile fields absent without gaps, actual theme variables, project-owned image paths, keyboard-reachable full-size image links, and no horizontal overflow indicators in CSS.

```js
for (const project of await loadProjects()) {
  const $ = load(await readBuiltRoute(`/projects/${project.slug}/`));
  assert.equal($('main h1').length, 1);
  assert.deepEqual($('main > section > h2').map((_, el) => $(el).text().trim()).get(), visibleSectionTitles(project));
  assert.equal($('main section:empty, main figure:empty').length, 0);
  assert.equal($('main h3').filter((_, el) => $(el).closest('section').children('h2').length !== 1).length, 0);
  assert.equal($('figure a[href] img[alt]').length, visibleImageBlocks(project).length);
}
```

- [ ] **Step 2: Run RED and implement restrained presentation**

Use compact project metadata, readable line length, Times-led body type, responsive evidence grid, and full-size image links. Do not add decorative gradients, animated cards, theme toggles, or application-style chrome to the public site.

- [ ] **Step 3: Replace stale fixed-count audit behavior**

The generated audit must:

- build first or prove output freshness;
- enumerate HTML case-insensitively and reject out-of-root junctions;
- resolve links/fragments relative to the GitHub user-site root;
- derive expected project and image routes from canonical content;
- scan decoded visible and hidden contexts, attributes, metadata, and the Git-tracked repository for privacy/local paths;
- exclude historical specifications only from public-copy terminology assertions, never from privacy scanning.

- [ ] **Step 4: Controlled mutations and browser visual check**

Mutate one project order, remove one asset, add an empty optional link, insert an internal code, and inject editor markup into `dist`; each relevant assertion must fail. Restore bytes and rebuild.

Start a temporary local production preview through the approved server helper. Inspect at 375×812, 768×900, and 1280×900: About, Projects, all three detail pages, Research, and 404. Check focus, reading order, image clarity, full-size links, and `scrollWidth === clientWidth`. Stop the server and verify the port closes.

- [ ] **Step 5: Full gate and commit**

Run `pnpm check`, `pnpm build`, focused tests, full `pnpm test`, `git diff --check`, repository privacy scan, and clean status review.

Commit: `feat: refine evidence-led public site`

---

### Task 7: Add a read-only, loopback-secured editor service

**Files:**
- Create: `editor/server/auth.mjs`
- Create: `editor/server/path-policy.mjs`
- Create: `editor/server/repository-service.mjs`
- Create: `editor/server/app.mjs`
- Create: `editor/server/main.mjs`
- Create: `editor/client/index.html`
- Create: `editor/client/styles.css`
- Modify: `test/helpers.mjs` to add the sentinel-protected editor test workspace factory
- Test: `editor/test/auth.test.mjs`, `editor/test/path-policy.test.mjs`, `editor/test/read-api.test.mjs`

**Interfaces:**
- `createSessionSecrets(randomBytes): { sessionToken, csrfToken }`.
- `startEditor({ projectRoot, preferredPort, token, csrfToken, repositoryService }): Promise<{ server, origin, close }>` binds loopback first, derives `origin` only from the socket's actual `localAddress/localPort`, then injects it into the request listener; no caller-supplied Host/origin is trusted.
- `guardRequest({ request, origin, routeClass, session, contentTypes, bodyLimit }): GuardResult` always requires exactly one Host equal to the socket-derived authority. For `navigation`/static GET, Origin may be absent but must equal the derived origin if present; the one-time bootstrap additionally requires same-origin-compatible `Sec-Fetch-Site`/`Sec-Fetch-Mode` when those browser headers are present. For authenticated sensitive GET, require exact Host/session and reject a present wrong Origin. Every state-changing request requires exactly one exact Origin plus the session-bound CSRF token.
- `serializePublicError(error): { ok: false, code, messageZh, field, details }` allowlists logical fields and strips stacks, paths, tokens, environment and source bytes; Tasks 9–11 reuse this one function.
- `assertConfinedPath({ root, relativePath, mustExist, operation }): Promise<string>`; every walker/read/copy/rename/delete caller supplies the operation and receives a just-in-time confinement result.
- `repositoryService.bootstrap(): Promise<{ baseManifestHash, csrfToken, site, about, research, projects }>` only after a valid session cookie; the CSRF token is session-bound and rotates on server restart.

- [ ] **Step 1: Write RED security tests**

Use `createTestWorkspace()` and an ephemeral port. Derive expected origin from the actual bound socket. Drive the real browser for the positive bootstrap/navigation path and prove its ordinary no-Origin top-level GET succeeds, sets `HttpOnly; SameSite=Strict; Path=/`, and redirects. Raw-request tests require exact Host; reject missing/duplicate Host and any present wrong Origin (wrong scheme/port, `null`, userinfo, prefix/suffix). For state-changing requests, reject missing/duplicate/wrong Origin and missing/wrong CSRF. Verify appropriate `Sec-Fetch-Site`/mode handling without assuming unsupported clients send those headers. Wrong/missing session is rejected and no CORS allow-origin is emitted. External interface binding is impossible through `startEditor`. Authenticated `/api/bootstrap` returns the session's CSRF token, while unauthenticated/cross-session access cannot obtain or use it. Restart rotates both tokens. Require `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, and CSP `default-src 'self'; connect-src 'self'; img-src 'self' blob: data:; frame-src 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'; form-action 'self'` with no external script/style origin. Preview iframe tests require a restrictive sandbox and prevent top-level/external navigation.

Path tests reject `..`, absolute Windows/POSIX paths, drive-relative paths, UNC/device forms, alternate-data-stream colons, trailing-dot/space aliases, percent/double-percent traversal, mixed separators, NUL, reserved device names, unsafe backup IDs, and a real Windows junction/symlink/reparse point placed at every walker/copy/rename/delete boundary. Non-existing output paths are checked segment-by-segment through the nearest existing real ancestor and rechecked immediately before a destructive rename/delete; manifest walkers fail closed on every reparse point rather than following it.

```js
test('bootstrap is loopback/session bound and cannot be replayed', async (t) => {
  const fixture = await startEditorFixture(t);
  const first = await fixture.request('/?session=' + fixture.startupToken);
  assert.equal(first.status, 302);
  assert.match(first.headers.get('set-cookie'), /HttpOnly; SameSite=Strict; Path=\//);
  assert.equal((await fixture.request('/?session=' + fixture.startupToken)).status, 401);
  assert.equal((await fixture.request('/api/bootstrap', { host: 'host.invalid' })).status, 403);
});

test('canonical confinement rejects an escaping reparse point', async (t) => {
  const { root, relativeJunction, cleanup } = await createEscapingJunctionFixture();
  t.after(cleanup);
  await assert.rejects(assertConfinedPath({ root, relativePath: relativeJunction, mustExist: true }), /越出网站目录/);
});
```

`createTestWorkspace()` is implemented in `test/helpers.mjs` at this task if not already present; it is the only editor test-root factory used from this point onward.

- [ ] **Step 2: Run RED**

Run: `node --test editor/test/auth.test.mjs editor/test/path-policy.test.mjs editor/test/read-api.test.mjs`
Expected: module-not-found failures only.

- [ ] **Step 3: Implement the minimal read-only server**

Routes are limited to:

```text
GET /?session=<startup-token>   one-time cookie bootstrap and redirect
GET /                          editor shell
GET /assets/*                  editor-owned static files
GET /api/bootstrap             canonical public content plus base manifest
GET /api/health                { ok: true }
```

Reject every other method with 405 and every unknown path with 404. `startEditor` binds with `server.listen({ host: '127.0.0.1', port: preferredPort })`, reads the actual socket port after `listening`, then constructs the guarded listener/origin; do not accept host/origin from a request or configuration file.

Add an injected outbound-request detector around browser/editor integration tests. Exercise bootstrap, preview and normal editing, and fail if any request target is not the editor's exact loopback origin. No server production module may import an outbound HTTP client or call `fetch`.

- [ ] **Step 4: GREEN and mutation matrix**

Run focused tests. Mutate Host validation to accept arbitrary hosts, Origin matching to `startsWith`, or path checking to lexical-only; each security test must fail. Restore exact bytes. Verify read routes make no canonical or `.local-editor` file changes by comparing manifests before/after.

- [ ] **Step 5: Full gate and commit**

Run `pnpm test`; the automated outbound-request assertion must pass. Complete the required reviews/fixes/re-reviews before the final accepted commit.

Commit: `feat: add secure local editor shell`

---

### Task 8: Implement the visual draft model and live preview

**Files:**
- Create: `editor/client/draft-store.mjs`
- Create: `editor/client/forms.mjs`
- Create: `editor/client/preview.mjs`
- Create: `editor/client/app.mjs`
- Modify: `editor/client/index.html`, `editor/client/styles.css`
- Create: `editor/shared/preview-model.mjs`
- Test: `editor/test/draft-store.test.mjs`, `editor/test/preview-contract.test.mjs`

**Interfaces:**
- `createDraftStore(bootstrap): DraftStore` with `getState`, `subscribe`, `dispatch`, `isDirty`, and `reset`.
- Actions: `field/set`, `item/add`, `item/copy`, `item/hide`, `item/remove`, `item/move`, `project/create`, `project/remove`, `project/confirm-remove`, `project/change-kind`, `project/confirm-kind-change`.
- Pure helpers exported for focused tests: `createProject({ kind, title, slugCandidate })`, `generateSlug(title)`, `reserveSlug(candidate, existingSlugs)`, `isContribution(section)`, `removeSection(project, sectionId)`, and `changeKind(project, nextKind)`; store actions call these same helpers.
- `toPreviewModel(draft, route): PreviewModel`; `renderPreview(model, iframeDocument): void`.
- Appearance draft fields cover the approved static theme only: background, surface, text, accent, avatar mode/image/initials/hidden, and ordered optional profile links. Typography remains the fixed Times New Roman-led policy; there is no arbitrary font selector or public runtime theme switcher. Saving runs the shared colour-contrast validator.
- `toCandidateBundle(draft, uploadStore): CandidateBundle` is the sole bridge to Task 10 and covers `site.yml`, About, the complete research set (including additions/deletions), all projects, and content-owned images; it delegates all bytes to the Task 2 serialisers rather than constructing Markdown/YAML ad hoc.

- [ ] **Step 1: Write RED pure-behavior tests**

Tests cover every approved edit surface: site identity, About, add/edit/delete research records, theme, ordered optional links, avatar modes, project creation/slug reservation, all supported block types, hide/delete/copy/move, keyboard-equivalent reorder, dirty reset, and unsaved navigation warning.

Ownership tests require:

```js
const individual = createProject({ kind: 'individual', title: 'Sample Project', slugCandidate: 'sample-project' });
const team = createProject({ kind: 'team', title: 'Team Project', slugCandidate: 'team-project' });
assert.equal(individual.sections.some(isContribution), false);
assert.equal(team.sections.filter(isContribution).length, 1);
const contributionId = team.sections.find(isContribution).id;
assert.throws(() => removeSection(team, contributionId), /团队项目的贡献章节不能删除/);
assert.equal(changeKind(individual, 'team').pendingContributionRequired, true);
```

Test ASCII normalisation, empty/illegal titles, reserved names, duplicate and case-fold collisions, encoded traversal, stable slug after title edits, and explicit user confirmation before changing an already published slug. Project removal requires a diff plus second confirmation, affects only the in-memory/new canonical generation, and remains recoverable from backup. The folder name is canonical; frontmatter never contains a second slug field.

The conversion contract is exact: confirming individual→team inserts one empty protected contribution section and keeps save disabled until its body is non-empty; confirming team→individual removes that semantic section from the draft only after showing its diff. A normal section can be renamed/reordered/hidden/removed, but a team contribution section can be reordered and edited only—never renamed, hidden, duplicated, or removed while `kind: team`.

- [ ] **Step 2: Run RED and implement immutable actions**

The store never calls `fetch` except through injected API functions and never writes disk. Deleting blocks removes them only from the in-memory draft. A team→individual conversion returns a pending diff and requires a distinct confirmation action.

- [ ] **Step 3: Build the accessible Chinese visual shell**

Left navigation labels are exactly `全站资料`, `首页`, `研究与稿件`, `项目`, `外观`, `备份`. The centre contains an iframe preview. The right inspector uses Chinese labels/errors and appropriate input types. Every drag action has adjacent `上移`/`下移` buttons; drag is enhancement, not the only operation.

Clicking a preview element posts its stable editor ID and focuses the matching inspector control. Preview styles reuse `src/styles/global.css` plus a small editor-only selection outline. Preview content comes only from escaped render models; never insert user strings with unsafe `innerHTML`. Every `隐藏` control has an adjacent Chinese warning that hidden content remains in Markdown and may be visible in a future public source repository; tests require the warning in the same control group, not only in documentation.

- [ ] **Step 4: Prove preview/public parity**

For canonical fixtures, compare normalised main-landmark heading order, text, links, figures, alt, captions, hidden-state omission, and project ownership between `PreviewModel` output and freshly built Astro HTML. This is semantic parity; editor-only selection attributes are excluded from the comparison.

- [ ] **Step 5: Mutation, full gate, and commit**

Mutate `item/move` to duplicate instead of move, allow deletion of team contribution, or render one empty link; focused tests fail. Restore, run `pnpm test`, then manually open the read-only editor to confirm Chinese shell and three viewport buttons without saving.

Commit: `feat: add visual draft editing`

---

### Task 9: Add in-memory image import and sanitisation

**Files:**
- Create: `editor/server/upload-store.mjs`
- Create: `editor/server/image-service.mjs`
- Create: `editor/client/image-controls.mjs`
- Modify: `editor/server/app.mjs`, `editor/client/app.mjs`, `editor/client/forms.mjs`
- Create image fixtures: `editor/test/fixtures/oriented.jpg`, `metadata.png`, `oversized-header.png`, `corrupt.tif`
- Test: `editor/test/image-service.test.mjs`, `editor/test/upload-api.test.mjs`

**Interfaces:**
- `createUploadStore({ maxFileBytes: 200 * 1024 * 1024, maxSessionBytes: 400 * 1024 * 1024, maxUploadCount: 12, maxConcurrentDecodes: 1, maxPixels: 120 * 1000 * 1000 }): UploadStore`.
- `sanitiseImage({ bytes, originalName }): Promise<{ bytes, width, height, mime: 'image/png', safeName, sha256 }>`.
- `POST /api/uploads` accepts exactly one `application/octet-stream` body after the Task 7 session cookie, exact Host/Origin, `X-Editor-CSRF`, declared length, streaming limits, and a validated `X-Editor-Filename` value all pass; response is `{ uploadId, width, height, safeName }`. There is no multipart parser and no server preview URL.
- Upload IDs are 128-bit random hex and exist only in server memory until save/session close.

- [ ] **Step 1: Write RED image behavior/security tests**

Assert PNG/JPEG/WebP/TIFF decode, EXIF orientation is applied to pixels, output is PNG with no EXIF/XMP/IPTC/ICC/text metadata, visible dimensions are preserved after orientation, Unicode/Windows-reserved filenames become safe ASCII stems, identical-name/different-content files get deterministic eight-hex hash suffixes, animated/damaged/over-limit inputs fail in Chinese, and source buffers remain byte-identical.

API tests send bytes, never an external path. Named fixtures `windows-absolute-path`, `posix-home-path`, `file-uri-path`, and `parent-traversal-path` are rejected before image code runs; construct their raw strings inside the untracked test-mutation harness so tracked source and documentation contain no real-looking local path literal. Missing/wrong cookie, Host, Origin, CSRF, media type, length, filename, file/session/count limits, truncated/overlong streams, and a second concurrent decode all fail before bytes enter the upload store. Cross-session upload IDs remain unusable.

- [ ] **Step 2: Run RED and implement sharp pipeline**

```js
const image = sharp(bytes, { limitInputPixels: 120_000_000, animated: false, failOn: 'error' });
const output = await image.rotate().png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer({ resolveWithObject: true });
```

Do not call `.withMetadata()`. Verify output metadata with a fresh `sharp(output.data).metadata()` read before storing it.

Route errors pass through the shared allowlist error serialiser from Task 7. Inject fake decoder errors containing a stack, local-path sentinel, token, environment value, and raw-byte sentinel; the response may expose only `{ ok, code, messageZh, field, details }` with sanitised details.

- [ ] **Step 3: Add visual controls without disk writes**

Project controls support local select, preview, replace, hide, remove, move, English caption, and English alt. The same pipeline handles avatar image import/replacement; avatar mode changes to initials/hidden update only the draft, and a successful save may remove the canonical avatar reference/file only inside the new content generation so backups retain it. The browser creates the preview blob URL directly from selected local bytes while the server returns only the sanitised upload ID and dimensions; revoke the client URL on replace/remove/session close. Before save, show the Chinese warning that metadata cleaning cannot detect visible `Fig.`, report captions or private pixels.

- [ ] **Step 4: Mutation and source-hash proof**

Mutate the pipeline to call `.withMetadata()` → metadata fixture fails. Mutate filename sanitisation to retain `..` → path test fails. Mutate orientation handling by removing `.rotate()` → oriented fixture fails. Restore exact bytes.

- [ ] **Step 5: Full gate and commit**

Run focused tests and `pnpm test`. Compare all source fixture hashes before/after. Confirm no upload file exists under the worktree after tests.

Commit: `feat: add safe visual image imports`

---

### Task 10: Implement journalled candidate saves, conflicts, backups, and recovery

**Files:**
- Create: `editor/server/build-service.mjs`
- Create: `editor/server/transaction-service.mjs`
- Create: `editor/server/operation-lock.mjs`
- Modify: `astro.config.mjs`
- Test: `editor/test/transaction-service.test.mjs`, `editor/test/recovery.test.mjs`, `editor/test/backup-retention.test.mjs`, `editor/test/operation-lock.test.mjs`

**Interfaces:**
- `createTransactionService({ projectRoot, contentRoot, distRoot, backupRoot, buildCandidate, clock, idFactory, failpoint }): TransactionService`.
- `save({ baseManifestHash, bundle, uploads, conflictResolutionToken? }): Promise<SaveResult>`.
- `archiveDraft({ baseManifestHash, bundle, uploads }): Promise<BackupSummary>` records a recoverable draft-only operation while holding the same lease and never promotes canonical content or `dist`.
- `listBackups(): Promise<BackupSummary[]>`.
- `diffBackup(id): Promise<BackupDiff>`.
- `restore({ id, confirmationToken }): Promise<SaveResult>`.
- `recoverIncompleteTransactions(): Promise<RecoveryResult[]>`.
- `acquireOperationLock({ backupRoot, ownerNonce, pid, startedAt }): Promise<OperationLease>` uses an exclusive-create lock record plus owner nonce; stale-lock recovery is allowed only after liveness and journal state are proven, and every save/archive/restore/recover/retention operation holds the same lease through its final durable journal update.
- `issueConfirmation({ sessionId, action, targetId, diffHash, draftHash, canonicalManifestHash, now }): ConfirmationToken` creates a single-use, short-lived server record bound to the session, action, target backup/conflict, exact viewed diff/draft, and current canonical generation. Consumption re-hashes canonical state; mismatch, expiry, replay, wrong session/action/target, or server restart returns 409/403 with zero write.
- `recoverBeforeListen(): Promise<RecoveryStartupResult>` runs under the operation lease before `server.listen()`. Missing, corrupt, contradictory, or hash-inconsistent journal state is never guessed: startup exposes no editor/write listener and returns a sanitised Chinese recovery instruction through the foreground console only.

- [ ] **Step 1: Write RED transaction tests with injected failures**

Use sentinel-protected roots from `createTestWorkspace()` containing canonical `src/content` (including project/site images) and `dist`. Assert:

- validation failure before candidate creation writes no operation record;
- candidate validation/build failure creates a diagnostic operation record but leaves all canonical/output hashes unchanged;
- stale `baseManifestHash` returns a conflict with file-level diff and no write;
- explicit resolution first snapshots the external version, then promotes the confirmed draft;
- a second request and a separately spawned editor process both receive `OPERATION_BUSY` while one lease is held; they cannot build, prune, save, archive, restore, or recover concurrently;
- after candidate validation/build completes and while still holding the lease, the service recomputes the canonical content manifest immediately before the first promotion rename; a controlled external edit at that boundary returns 409, snapshots the external generation, and performs no promotion;
- inject an external edit after that pre-promotion hash but before the old-content rename. After the old tree is moved into `before/`, re-hash the moved tree against the locked generation before promoting any candidate. Mismatch restores it and returns 409; if an external process recreated the canonical path during the rename window, fail closed and preserve both trees without deleting or overwriting either;
- for that recreated-canonical-path scenario, assert the running editor atomically enters `recovery-only`: `/api/save`, `/api/uploads`, archive and restore cannot mutate (503 or listener closure), both tree hashes stay byte-identical, and only a sanitised Chinese console recovery instruction is emitted. After restart, `recoverBeforeListen()` refuses to listen while preserving both trees. A controlled mutation that continues serving writes or listens on restart must fail this test;
- interruption immediately before and after every durable boundary—old-content rename, new-content promotion, old-dist rename, new-dist promotion, journal-temp flush, operation-directory flush where supported, and journal rename—recovers to either complete old or complete new state, never a mixture;
- restore shows diff token, creates pre-restore backup, and is itself recoverable;
- after a restore/override diff is issued, inject an external edit; token consumption must return 409 and keep content/dist byte-identical. Cross-session, wrong-backup, wrong-action, expired and replayed tokens are rejected;
- successful, failed-after-candidate, and pre-restore records all count toward the same 20-record limit; record 21 prunes only the oldest valid editor record, and restoring from a backup never mutates that source backup;
- directories without the exact editor manifest/version are never deleted.
- corrupt/missing/contradictory journal records and ambiguous old/new manifests cause fail-closed startup before listening; no canonical bytes are guessed or changed.

```js
for (const boundary of durablePromotionBoundaries()) {
  test(`recovery is all-old or all-new around ${boundary}`, async (t) => {
    const fixture = await transactionFixture({ failAt: boundary });
    t.after(fixture.cleanup);
    await assert.rejects(fixture.service.save(fixture.changedDraft));
    await fixture.restartAndRecover();
    assert.ok([
      fixture.oldStateHash,
      fixture.newStateHash,
    ].includes(await fixture.combinedCanonicalHash()));
  });
}
```

- [ ] **Step 2: Run RED**

Run: `node --test editor/test/transaction-service.test.mjs editor/test/recovery.test.mjs editor/test/backup-retention.test.mjs`
Expected: missing service modules.

- [ ] **Step 3: Implement manifest and journal formats**

```json
{
  "formatVersion": 1,
  "operationId": "<UTC basic timestamp>-0001",
  "kind": "save",
  "createdAt": "2026-08-12T12:00:00.000Z",
  "phase": "candidate-built",
  "baseManifestHash": "64-lowercase-hex",
  "before": { "content": {}, "dist": {} },
  "candidate": { "content": {}, "dist": {} }
}
```

Manifest hashes use sorted POSIX-relative path, NUL separator, byte length, NUL, and file bytes. Ignore mtime. Copy candidates under the same backup operation root. Write journal updates to a sibling temporary file, flush, then rename.

Every manifest/copy/rename/prune walk calls the Task 7 segment-wise confinement helper, rejects reparse points, and revalidates the nearest real ancestor immediately before mutation. Backup and operation identifiers are parsed as logical IDs, never interpolated raw from a URL.

- [ ] **Step 4: Add isolated candidate build support**

`astro.config.mjs` accepts `EDITOR_CONTENT_ROOT`, `EDITOR_OUT_DIR`, and `EDITOR_CACHE_DIR` only when `EDITOR_CANDIDATE_BUILD=1`; resolve and realpath-check all roots under the active operation directory. Static resource endpoints enumerate image bytes from the candidate content root, so no second public-asset root exists. Normal builds ignore these variables and retain canonical defaults.

`buildCandidate` uses `process.execPath` plus a fixed local script and argument array with `shell: false`, an allowlisted minimal environment, Astro telemetry off, `TEMP`/`TMP`/cache/log paths inside the active operation, and captured bounded logs. It rejects non-zero exit or any output escaping the candidate root. Snapshot the entire worktree before/after an injected failed build and allow changes only inside the active operation. A fake build error containing stack, absolute-path, environment, session/CSRF and source-byte sentinels must be reduced to a stable internal diagnostic plus the public allowlist error shape.

- [ ] **Step 5: Implement promotion and recovery**

Acquire the operation lease before the first manifest comparison and keep it through retention and the final journal flush. Use a phase journal around each explicit rename operation. Re-hash canonical content immediately before promotion; if it differs from the locked base generation, abort without rename and return a conflict. Move the old content tree into the operation's `before/`, then re-hash those moved bytes and require equality with the locked generation before promoting the candidate. If they differ, restore only when the canonical path is still absent; if that path was externally recreated, preserve both trees, mark the journal `manual-recovery-required`, expose no write listener, and never delete/overwrite the new external tree. Apply the same generation checks to `dist`. Update the durable journal before/after each boundary. On startup, recovery first acquires the same lease, then uses boundary state plus manifest hashes to finish a provably complete promotion or restore all `before/` directories. Never recursively remove a path until its segment-wise confinement is reverified under the active operation or old-backup root.

- [ ] **Step 6: Mutation matrix, full gate, and commit**

Mutate manifest ordering, skip the pre-promotion or moved-before re-hash, bypass the process lock, bypass the `recovery-only` transition/listen block, delete journal/directory flush, accept an unmanifested 21st directory, follow a nested reparse point, and inject each before/after failpoint. Focused tests must detect every change. Restore exact bytes.

Run focused tests, `pnpm test`, diff check, and ensure all task test-workspace roots are removed by sentinel-checked cleanup.

Commit: `feat: add recoverable editor saves`

---

### Task 11: Connect authenticated write APIs and the Chinese save/backup UI

**Files:**
- Modify: `editor/server/app.mjs`, `editor/server/repository-service.mjs`, `editor/server/transaction-service.mjs`, `editor/server/main.mjs`
- Modify: `editor/client/app.mjs`, `editor/client/forms.mjs`, `editor/client/index.html`, `editor/client/styles.css`
- Test: `editor/test/write-api.test.mjs`, `editor/test/editor-integration.test.mjs`

**Interfaces:**
- `POST /api/save` → 200 `SaveResult`, 409 `ConflictResult`, or 422 Chinese validation/build errors.
- `POST /api/drafts/archive` stores a draft-only operation record without canonical promotion.
- `GET /api/backups` → summaries only, never raw local paths.
- `POST /api/backups/:id/diff` → diff plus one-time confirmation token.
- `POST /api/backups/:id/restore` requires that token.
- Every write, including upload/archive/diff/restore, reuses Task 7 `guardRequest` with the socket-derived exact origin, session cookie, `Content-Type`, body limit, and `X-Editor-CSRF`; Task 11 adds no alternate Host/Origin implementation.

- [ ] **Step 1: Write RED end-to-end API tests**

Start the app on an ephemeral loopback port with services rooted in `createTestWorkspace()` and reuse the Task 7 origin matrix for every new write route. Test missing/wrong CSRF, cookie, content type, oversized body, replayed/cross-session/wrong-target/expired/stale-diff confirmation token, cross-session upload ID, stale manifest, invalid project type, unsafe colour, unsupported Markdown, candidate build failure, successful save, draft archive, backup diff, restore, and server restart recovery.

Every negative case compares canonical content (including images) and `dist` manifests before and after; they must match.

```js
for (const request of invalidWriteRequests()) {
  test(`failed write is byte-preserving: ${request.name}`, async (t) => {
    const fixture = await writableEditorFixture(t);
    const before = await fixture.canonicalAndDistManifest();
    const response = await fixture.request(request);
    assert.ok([401, 403, 409, 413, 415, 422].includes(response.status));
    assert.deepEqual(await fixture.canonicalAndDistManifest(), before);
  });
}
```

- [ ] **Step 2: Run RED and implement routes**

Use a route table with explicit method/path/body limits; no catch-all filesystem route. Error JSON is:

```json
{
  "ok": false,
  "code": "CONTENT_CONFLICT",
  "messageZh": "磁盘内容已在编辑器外修改，未覆盖任何文件。",
  "field": null,
  "details": []
}
```

Never include stack traces, absolute paths, tokens, source bytes, or raw build environment in responses.

Inject validation/build/transaction exceptions carrying each forbidden sentinel and assert the response serialiser returns only allowlisted `code`, Chinese `messageZh`, optional logical `field`, and sanitised `details`. Browser integration records every request during bootstrap, edit, upload, preview and save; any non-loopback origin is a test failure.

- [ ] **Step 3: Implement manual save/conflict/restore UI**

The primary button is exactly `保存并生成网站`. While saving, disable duplicate submissions and show current phase. On success, update the base manifest and clear dirty state. On conflict, show diff and choices: `重新载入磁盘版本`, `把当前草稿保存到备份`, `查看差异后覆盖`; the last requires a second confirmation and server-issued token.

Backup page lists time, operation type and status. Restore first shows text/config/image diff, then a separate `确认恢复` action.

- [ ] **Step 4: Browser behavior verification and mutations**

Use small browser calls. Edit a paragraph without saving and prove content/dist hashes unchanged; refresh warning appears. Trigger a build error and prove Chinese error plus unchanged hashes. Perform a valid save in an isolated fixture site, reload, and prove preview/public content parity. Do not use the real canonical site for failure mutations.

Mutate CSRF check, change conflict status from 409 to 200, or let failed save clear dirty state; tests fail. Restore.

- [ ] **Step 5: Full gate and commit**

Run `pnpm test`, repository privacy scan, static `dist` editor-leak scan, and clean process/port check.

Commit: `feat: connect safe editor workflows`

---

### Task 12: Add the double-click Windows launcher and lifecycle guarantees

**Files:**
- Create: `启动网站编辑器.bat`
- Modify: `editor/server/main.mjs`
- Create: `editor/server/runtime-locator.mjs`
- Create: `editor/server/portable-runtime-installer.mjs`
- Test: `editor/test/runtime-locator.test.mjs`, `editor/test/portable-runtime-installer.test.mjs`, `editor/test/launcher.test.mjs`
- Modify: `.gitignore` only if a narrower project-local runtime subpath is needed beyond `.local-editor/`

**Interfaces:**
- `locateNode({ projectRoot, envPath }): Promise<{ executable, source: 'project-local'|'path', version }>`.
- `stagePortableRuntime({ zipBytes, checksumsBytes, toolsRoot, expectedVersion }): Promise<RuntimeInstallRecord>` validates the official checksum and a strict Node ZIP entry allowlist, rejects absolute/drive/UNC/ADS/`..`/reparse entries, extracts to a new confined staging directory, verifies `node.exe --version`, then promotes the directory without following links.
- `main()` prints one machine-readable `EDITOR_READY=<loopback-url>` line after listening and accepts `EDITOR_NO_OPEN=1` for tests.
- `buildService.close()` aborts and awaits every child build. Foreground process handles `SIGINT`, `SIGTERM`, parent stdin closure, and uncaught startup errors by aborting builds, closing server, clearing session uploads, releasing a proven-owned operation lock, and leaving the journal recoverable. Startup calls Task 10 `recoverBeforeListen()` first; ambiguous recovery means no listener and a Chinese console error.

- [ ] **Step 1: Write RED runtime and lifecycle tests**

Test preference order `.local-editor/tools/node/node.exe` then compatible PATH Node; reject versions below `22.12.0`; missing runtime returns Chinese instructions without download. Installer fixtures include zip-slip, absolute, drive, UNC, ADS, duplicate/case-fold collision, symlink/reparse metadata, unexpected top-level entry, corrupt ZIP and checksum mismatch; all leave tools bytes unchanged. Spawn launcher with `EDITOR_NO_OPEN=1`, read ready URL, hit health endpoint, terminate the foreground command, and verify the port refuses connection and no child PID remains. Repeat while an injected long-running candidate child is active; the child exits, then restart performs journal recovery before exposing any route.

```js
test('closing the foreground launcher leaves no editor listener', async (t) => {
  const run = await spawnLauncherFixture({ env: { EDITOR_NO_OPEN: '1' } });
  t.after(run.cleanup);
  const { url } = await run.waitForReady();
  assert.deepEqual(await (await fetch(new URL('/api/health', url))).json(), { ok: true });
  await run.closeForegroundWindow();
  await assert.rejects(fetch(new URL('/api/health', url)));
  assert.equal(await run.hasLiveDescendant(), false);
});
```

- [ ] **Step 2: Implement launcher without system mutation**

The batch file resolves `%~dp0`, changes only its process working directory, checks project-local Node first, falls back to `where node`, then runs Node in the foreground. It never calls `setx`, writes registry, requests elevation, runs a package install, or downloads software. It displays Chinese startup/failure/close-window instructions.

- [ ] **Step 3: Provision a project-local portable runtime only if required on this machine**

If neither project-local nor PATH Node satisfies the engine, download official `node-v24.14.0-win-x64.zip` and `SHASUMS256.txt` from `https://nodejs.org/dist/v24.14.0/` into a new confined `.local-editor/runtime/install-<nonce>/` staging directory, verify the exact official checksum entry, run `stagePortableRuntime`, then directory-promote only the verified tool. Record URL, version, checksum, install time and destination in `.local-editor/runtime/runtime-install.json`. Do not modify PATH or any system directory. Runtime ZIPs/tools are never auto-deleted under the 20-backup rule; only a later explicit user approval may remove them.

- [ ] **Step 4: Manual double-click acceptance**

Double-click the launcher. Verify browser opens the authenticated Chinese editor, no terminal commands are needed, only loopback is listening, and closing the launcher window stops the service. Repeat with the preferred port occupied; verify a different loopback port or a clear Chinese error.

- [ ] **Step 5: Mutation, full gate, and commit**

Mutate runtime order to prefer PATH over project-local and mutate server host to `0.0.0.0`; tests fail. Restore. Run `pnpm test`, check port/process cleanup, complete the required reviews/fixes/re-reviews, and include only launcher/runtime locator/installer/tests in the final accepted commit—not `.local-editor` contents.

Commit: `feat: add local editor launcher`

---

### Task 13: Rewrite maintenance and privacy documentation

**Files:**
- Modify: `README.md`
- Rewrite: `docs/maintenance.md`
- Modify: `docs/content-evidence.md` only if implementation paths/hashes changed after Task 5
- Test: `test/maintenance-v2.test.mjs`, `test/repository-privacy.test.mjs`

**Interfaces:**
- User documentation names visual editing first and manual Markdown/YAML editing second.
- Public/deployment boundary remains explicit and unchanged.

- [ ] **Step 1: Write RED documentation behavior tests**

Parse prose with explicit section-heading and exact-command assertions, not broad regex existence. Require sections for double-click startup, Chinese editor workflow, unsaved drafts, project type rules, image limits, safe save, conflicts, 20 backups, restore, manual Markdown markers, portable runtime boundary, full test command, and no-publish boundary.

Repository privacy test must enumerate every tracked file fail-closed, include new editor/client/batch extensions, NFKC-normalise text, reject generic seven-digit identifiers and non-public-name oracle forms, and classify unknown extensions as failure.

```js
test('every tracked file is classified and privacy-scanned', async () => {
  const tracked = await gitTrackedFilesWithProcessLocalSafeDirectory();
  for (const path of tracked) {
    const classification = classifyTrackedPath(path);
    assert.notEqual(classification, 'unknown', `unclassified tracked file: ${path}`);
    if (classification === 'text') assertPrivacySafeText(normaliseNfkc(await readFile(path, 'utf8')), path);
  }
});
```

- [ ] **Step 2: Run RED and write concise user-facing docs**

README quick start begins with `启动网站编辑器.bat`. Maintenance explains:

- individual/team creation and protected contribution behavior;
- direct Markdown/YAML locations and supported syntax;
- hidden content is not private in a public source repository;
- images are copied and metadata-cleaned but visible pixels need human review;
- save/conflict/restore semantics and editor-owned backup deletion boundary;
- system software is never installed silently;
- publication remains a separate approval.

- [ ] **Step 3: Mutation and full gate**

Inject a safe generic seven-digit sentinel into a copied tracked-text fixture → repository scan fails. Remove the no-publish paragraph → maintenance test fails. Add an unclassified tracked extension through a sentinel-protected alternate Git index inside `createTestWorkspace()` → scanner fails. Restore and remove fixtures.

Run `pnpm test`, `git diff --check`, tracked privacy scan, then complete the required reviews/fixes/re-reviews before the final accepted commit.

Commit: `docs: document local visual editing`

---

### Task 14: Run complete local acceptance and record only verified results

**Files:**
- Create after all gates pass: `docs/qa/2026-08-12-editor-redesign-local-acceptance.md`
- Test: no new behavior test unless acceptance reveals a missing oracle; any revealed bug first receives a focused RED test in its owning test file.

**Interfaces:**
- Produces the only valid acceptance record for the redesign.
- Does not create a remote, push, deploy, or change publication settings.

- [ ] **Step 1: Verify the exact start boundary**

Require named feature branch, the exact accepted Task 13 commit recorded by the execution ledger, clean tree, remote count zero, no listener on editor/preview ports, and no untracked source/document/archive material. Run frozen install and prove manifest/lock hashes unchanged.

- [ ] **Step 2: Run all independent machine gates**

Run separately and record exact outputs:

```text
pnpm check
pnpm build
node --test test/*.test.mjs
node --test editor/test/*.test.mjs
pnpm test
git diff --check
```

Require 0 errors, 0 warnings, 0 hints, 0 failures, 0 skipped, 0 cancelled, 0 todo. Record dynamic page/project/image counts from the fresh build, not expected constants.

- [ ] **Step 3: Run privacy, evidence, and source-immutability gates**

Scan the entire Git-tracked repository and fresh `dist`; inspect raw archive/document absence; inspect editor-leak absence; verify every public image against evidence register and original-detail visual record; recheck read-only source hashes captured in Task 5. Record limitations honestly.

- [ ] **Step 4: Run real-browser public-site acceptance**

At 375×812, 768×900 and 1280×900 inspect all public routes. Verify Times-led body, semantic headings, keyboard focus, no horizontal overflow, correct project ownership, readable images/full-size links, optional-field collapse, no internal codes, no `Fig.` in visible images/captions, and exact manuscript status.

- [ ] **Step 5: Run real-browser editor acceptance**

Launch with the double-click entrypoint. Verify Chinese navigation, preview selection, profile/research/project/appearance editing, individual/team templates, protected contribution behavior, all block operations, three viewport modes, image import/replacement/reorder/caption/alt, unsaved warning, build-failure preservation, external-edit conflict, successful save, backup diff and restore. Run destructive behavior only against a copied fixture repository; use the canonical repository only for read-only and a final approved content save.

Close launcher and confirm zero listener/process residue.

- [ ] **Step 6: Write acceptance record only after PASS**

Record date, exact commit, tool/runtime versions, commands, actual counts, source/image inspection list, public/browser viewport evidence, editor behavior matrix, privacy scopes, initial sandbox/path failure recoveries, and explicit statements `remote count: 0`, `push: not performed`, `deployment: not performed`.

If any gate fails or visual inspection is incomplete, do not create the record or commit; write only an ignored task report and return to the owning task.

- [ ] **Step 7: Commit and post-commit verification**

Stage exactly the acceptance record. Commit: `docs: record editor redesign acceptance`.

At committed HEAD rerun `pnpm test`, committed diff check, tracked privacy scan, clean status, remote count, and port/process checks. No push.

---

## Self-Review Checklist for This Plan

- [x] Every approved specification section maps to at least one task: authority/scope (Global), content model (2–4), images (5/9), public presentation (6), visual editing (7–8/11), transaction/backup/conflict (10–11), local security (7/9–12), documentation (13), and acceptance (14).
- [x] Individual/team ownership is enforced in schema, source, editor store, public DOM, API, and mutation tests.
- [x] The content codec defines exact marker syntax, supported blocks, unknown-byte preservation, line endings, and stable IDs.
- [x] Editor draft, upload, save, conflict, backup, restore, recovery, and launcher interfaces are named consistently across tasks.
- [x] Candidate builds never write canonical content first; failpoints cover every promotion boundary and the external-write rename window.
- [x] Backups under 20 are retained, 21 prunes only a valid editor-created oldest record, and restore creates a counted pre-restore record.
- [x] Image selection is exact, sources remain read-only, final assets have editable captions/alts, and original-detail visual inspection is mandatory.
- [x] Project numerical claims and limitations match the source audits; old 97.7%, universal MSE tie-breaking, internal codes, and unsupported validation claims are explicitly rejected.
- [x] Tests are dynamic for future project/image/route counts and do not preserve first-version cardinality oracles.
- [x] No task authorises system installation, PATH change, external file mutation, remote creation, push, or deployment.
- [x] Unresolved drafting-token, vague-step, undefined-interface, tracked-local-path, and continuous-seven-digit scans return no match; intentional UI terms such as “empty placeholder” and test-runner `todo` counts are exempted by exact context.

## Execution Handoff

Implementation should use **Subagent-Driven Development**: one fresh implementation subagent per task, followed by a specification-compliance reviewer and a code-quality reviewer. Complete all findings and re-reviews before advancing. Task reports stay Git-ignored; every accepted task ends in its exact local commit, with no push.
