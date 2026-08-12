# Yunxi Wu Academic Website Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a restrained, English-first academic website for Yunxi Wu, validate it locally, and prepare a GitHub Pages deployment workflow without creating or publishing to a remote repository before separate user approval.

**Architecture:** Astro generates a fully static multi-page site. Shared identity data lives in one JavaScript module; project and manuscript records live in schema-validated local content collections; reusable Astro components render the academic sidebar, navigation, project entries, manuscript entry, and evidence gallery. Node's built-in test runner audits source facts and the generated `dist/` output.

**Tech Stack:** Node.js 24.14.0, pnpm 11.16.0, Astro 7.2.0, `@astrojs/check` 0.9.10, TypeScript 6.0.3, HTML, CSS, Markdown frontmatter, Node built-in tests, Python/Pillow for one-time evidence sanitisation, GitHub Actions, GitHub Pages.

## Global Constraints

- Public website language is English.
- Public name is exactly `Yunxi Wu`.
- Degree line is exactly `BEng Electronic and Electrical Engineering` at `University of Birmingham`.
- Public email is exactly `yxw1331@student.bham.ac.uk` and must be a working `mailto:` link.
- Primary navigation contains exactly `About`, `Projects`, and `Research`; version 1 has no CV page or CV download.
- Research interests are `Embodied AI`, `Computer Vision`, and `Robotics`; they must not be presented as completed research outcomes.
- Manuscript status is exactly `Submitted manuscript — Under editorial review`; do not use `under peer review`, `accepted`, `in press`, or `published`.
- Times New Roman is the primary font for headings and the clear majority of body text. Sans-serif is limited to small navigation, metadata, and interface labels.
- Visual direction is white, restrained, text-led, and academic: no gradients, oversized portfolio hero, parallax, or decorative animation.
- Team work must be labelled as team work. The Future Ocean Habitat page must state Yunxi Wu's exact role boundaries.
- Do not publish original coursework PDFs, student numbers, assignment instructions, teammate names, local paths, or the unpublished manuscript full text.
- Do not show dead social links. GitHub, LinkedIn, and profile-photo controls remain absent until verified inputs exist; use the `YW` monogram.
- No database, authentication, analytics, contact-form backend, CMS, search, blog, theme switcher, or Chinese public-site duplicate in version 1.
- Public deployment is a separate approval boundary. Do not create a remote, push, or enable GitHub Pages during local implementation.
- Use the official current GitHub Pages workflow actions verified for this plan: `actions/checkout@v7`, `withastro/action@v6`, and `actions/deploy-pages@v5`.
- Use frequent focused commits. Before every completion claim, run the task's stated verification commands and inspect their actual output.

---

## File Map

### Project and toolchain

- `package.json` — exact dependency and script contract.
- `pnpm-lock.yaml` — reproducible dependency resolution.
- `astro.config.mjs` — static output, trailing slashes, and optional `SITE_URL` canonical origin.
- `tsconfig.json` — Astro strict TypeScript checking.
- `.github/workflows/deploy.yml` — prepared GitHub Pages workflow; not executed locally.
- `.gitignore` — generated and temporary files.

### Shared data and content

- `src/data/site.mjs` — single source of truth for identity, email, navigation, interests, and approved introductory copy.
- `src/content.config.ts` — schemas for `projects` and `research` collections.
- `src/content/projects/*.md` — three structured project records.
- `src/content/research/more-electric-aircraft.md` — submitted manuscript record.

### Layout and components

- `src/layouts/BaseLayout.astro` — HTML metadata, skip link, site shell, sidebar, main content, and footer.
- `src/components/SiteNav.astro` — three-item primary navigation and active state.
- `src/components/ProfileSidebar.astro` — monogram, verified identity, interests, and public email.
- `src/components/SiteFooter.astro` — restrained site footer.
- `src/components/ProjectListItem.astro` — compact project summary row.
- `src/components/EvidenceGallery.astro` — accessible project evidence figures.
- `src/components/ManuscriptEntry.astro` — exact manuscript title and status.
- `src/styles/global.css` — complete approved visual system and responsive behaviour.

### Routes

- `src/pages/index.astro` — About/homepage.
- `src/pages/projects/index.astro` — projects index.
- `src/pages/projects/[id].astro` — statically generated project-detail pages.
- `src/pages/research.astro` — research interests, ongoing direction, and manuscript.
- `src/pages/404.astro` — static not-found page.

### Public evidence

- `scripts/sanitise_png.py` — deterministic figure crop and metadata-free PNG export helper.
- `public/assets/projects/future-ocean-habitat-master-system.png`
- `public/assets/projects/future-ocean-habitat-udc-flow.png`
- `public/assets/projects/life-support-hvac-control.png`
- `public/assets/projects/life-support-efficiency.png`
- `public/assets/projects/communication-channel-capacity.png`
- `public/assets/projects/communication-filter-results.png`
- `docs/content-evidence.md` — internal provenance and sanitisation record without local absolute paths.

### Verification and maintenance

- `test/site-data.test.mjs` — verified identity and navigation contract.
- `test/shell-output.test.mjs` — generated shell, typography, email, and navigation.
- `test/content-source.test.mjs` — required factual content and forbidden source data.
- `test/project-routes.test.mjs` — project routes, section order, roles, and results.
- `test/research-output.test.mjs` — research wording and manuscript status.
- `test/assets.test.mjs` — required sanitised PNG files.
- `test/dist-audit.test.mjs` — route, link, semantic, image-alt, and privacy audit.
- `test/deployment-config.test.mjs` — workflow versions and dynamic site origin.
- `test/helpers.mjs` — reusable output-reading helpers.
- `README.md` — local use and project overview.
- `docs/maintenance.md` — safe content-update instructions.
- `docs/qa/2026-08-11-local-acceptance.md` — verified local acceptance record created only after every final check passes.

---

### Task 1: Establish the Astro toolchain and verified site-data contract

**Files:**
- Create: `package.json`
- Create: `pnpm-lock.yaml` through `pnpm install`
- Create: `astro.config.mjs`
- Create: `tsconfig.json`
- Create: `src/data/site.mjs`
- Create: `test/site-data.test.mjs`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: approved identity and copy from the design specification.
- Produces: named export `site` with `name`, `degree`, `institution`, `email`, `intro`, `currentDirection`, `interests`, and `navigation`. All later components import this object.

- [ ] **Step 1: Write the failing site-data test**

Create `test/site-data.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { site } from '../src/data/site.mjs';

test('site identity contains only verified public profile facts', () => {
  assert.equal(site.name, 'Yunxi Wu');
  assert.equal(site.degree, 'BEng Electronic and Electrical Engineering');
  assert.equal(site.institution, 'University of Birmingham');
  assert.equal(site.email, 'yxw1331@student.bham.ac.uk');
  assert.deepEqual(site.interests, ['Embodied AI', 'Computer Vision', 'Robotics']);
});

test('primary navigation has the approved three routes and no CV', () => {
  assert.deepEqual(site.navigation, [
    { label: 'About', href: '/' },
    { label: 'Projects', href: '/projects/' },
    { label: 'Research', href: '/research/' },
  ]);
  assert.doesNotMatch(JSON.stringify(site), /\bCV\b/i);
});

test('intro distinguishes current engineering work from future research direction', () => {
  assert.match(site.intro, /systems design, modelling, control, and signal processing/);
  assert.match(site.intro, /developing toward research/);
  assert.doesNotMatch(site.intro, /researcher in|specialist in|expert in/i);
});
```

- [ ] **Step 2: Run the test and confirm the expected failure**

Run:

```powershell
node --test test/site-data.test.mjs
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `src/data/site.mjs`.

- [ ] **Step 3: Create the exact toolchain files**

Create `package.json`:

```json
{
  "name": "yunxi-wu-academic-website",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@11.16.0",
  "engines": {
    "node": ">=22.12.0"
  },
  "scripts": {
    "dev": "astro dev",
    "check": "astro check",
    "build": "astro build",
    "test": "node --test"
  },
  "devDependencies": {
    "@astrojs/check": "0.9.10",
    "astro": "7.2.0",
    "typescript": "6.0.3"
  }
}
```

Create `astro.config.mjs`:

```js
import { defineConfig } from 'astro/config';

const site = process.env.SITE_URL;

export default defineConfig({
  output: 'static',
  trailingSlash: 'always',
  build: {
    inlineStylesheets: 'never',
  },
  ...(site ? { site } : {}),
});
```

Create `tsconfig.json`:

```json
{
  "extends": "astro/tsconfigs/strict"
}
```

Append these entries to `.gitignore`:

```gitignore
tmp/
.pnpm-store/
```

- [ ] **Step 4: Create the verified site-data module**

Create `src/data/site.mjs`:

```js
export const site = Object.freeze({
  name: 'Yunxi Wu',
  degree: 'BEng Electronic and Electrical Engineering',
  institution: 'University of Birmingham',
  email: 'yxw1331@student.bham.ac.uk',
  intro:
    'I am a BEng Electronic and Electrical Engineering student at the University of Birmingham. My current academic work spans systems design, modelling, control, and signal processing. I am developing toward research in Embodied AI, Computer Vision, and Robotics.',
  currentDirection:
    'I am currently developing projects and technical foundations in Embodied AI, Computer Vision, and Robotics. Completed outcomes will be added only when supporting evidence is ready.',
  interests: ['Embodied AI', 'Computer Vision', 'Robotics'],
  navigation: [
    { label: 'About', href: '/' },
    { label: 'Projects', href: '/projects/' },
    { label: 'Research', href: '/research/' },
  ],
});
```

- [ ] **Step 5: Install dependencies and generate the lockfile**

Run:

```powershell
pnpm install
```

Expected: `pnpm-lock.yaml` is created; Astro resolves to 7.2.0, `@astrojs/check` to 0.9.10, and TypeScript to 6.0.3 without peer-dependency errors.

- [ ] **Step 6: Run the focused test and verify it passes**

Run:

```powershell
node --test test/site-data.test.mjs
```

Expected: 3 tests PASS.

- [ ] **Step 7: Commit the foundation**

```powershell
git add .gitignore package.json pnpm-lock.yaml astro.config.mjs tsconfig.json src/data/site.mjs test/site-data.test.mjs
git commit -m "build: establish Astro site foundation"
```

---

### Task 2: Build the shared academic shell and restrained visual system

**Files:**
- Create: `src/layouts/BaseLayout.astro`
- Create: `src/components/SiteNav.astro`
- Create: `src/components/ProfileSidebar.astro`
- Create: `src/components/SiteFooter.astro`
- Create: `src/styles/global.css`
- Create: `src/pages/index.astro`
- Create: `test/helpers.mjs`
- Create: `test/shell-output.test.mjs`

**Interfaces:**
- Consumes: `site` from `src/data/site.mjs`.
- Produces: `BaseLayout` props `{ title: string, description: string, activeNav?: 'About' | 'Projects' | 'Research' }`; all public pages use this layout.
- Produces: `readDist(relativePath: string): Promise<string>` from `test/helpers.mjs` for later output tests.

- [ ] **Step 1: Write the failing generated-shell test**

Create `test/helpers.mjs`:

```js
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const distRoot = path.join(projectRoot, 'dist');

export function readDist(relativePath) {
  return readFile(path.join(distRoot, relativePath), 'utf8');
}

export async function readBuiltCss() {
  const assetDir = path.join(distRoot, '_astro');
  const files = await readdir(assetDir);
  const cssFiles = files.filter((file) => file.endsWith('.css'));
  return Promise.all(cssFiles.map((file) => readFile(path.join(assetDir, file), 'utf8')))
    .then((parts) => parts.join('\n'));
}
```

Create `test/shell-output.test.mjs`:

```js
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
  assert.doesNotMatch(html, /\bCV\b/i);
});

test('built CSS uses the approved restrained typography', async () => {
  const css = await readBuiltCss();
  assert.match(css, /Times New Roman/);
  assert.match(css, /#2d587a/i);
  assert.doesNotMatch(css, /linear-gradient|radial-gradient|@keyframes/i);
});
```

- [ ] **Step 2: Run the shell test and confirm failure**

Run:

```powershell
node --test test/shell-output.test.mjs
```

Expected: FAIL because `dist/index.html` does not exist.

- [ ] **Step 3: Create the navigation, profile, and footer components**

Create `src/components/SiteNav.astro`:

```astro
---
import { site } from '../data/site.mjs';

interface Props {
  active?: 'About' | 'Projects' | 'Research';
}

const { active } = Astro.props;
---

<nav class="site-nav" aria-label="Primary">
  <a class="site-name" href="/">{site.name}</a>
  <ul>
    {site.navigation.map((item) => (
      <li>
        <a href={item.href} aria-current={active === item.label ? 'page' : undefined}>
          {item.label}
        </a>
      </li>
    ))}
  </ul>
</nav>
```

Create `src/components/ProfileSidebar.astro`:

```astro
---
import { site } from '../data/site.mjs';
---

<aside class="profile-sidebar" aria-label="Profile">
  <div class="monogram" aria-hidden="true">YW</div>
  <h2>{site.name}</h2>
  <p class="profile-degree">{site.degree}</p>
  <p class="profile-institution">{site.institution}</p>

  <section class="sidebar-section" aria-labelledby="interests-heading">
    <h3 id="interests-heading">Research Interests</h3>
    <ul>
      {site.interests.map((interest) => <li>{interest}</li>)}
    </ul>
  </section>

  <section class="sidebar-section" aria-labelledby="contact-heading">
    <h3 id="contact-heading">Contact</h3>
    <a class="email-link" href={`mailto:${site.email}`}>{site.email}</a>
  </section>
</aside>
```

Create `src/components/SiteFooter.astro`:

```astro
---
import { site } from '../data/site.mjs';
---

<footer class="site-footer">
  <span>© {new Date().getFullYear()} {site.name}</span>
  <span>{site.degree}</span>
</footer>
```

- [ ] **Step 4: Create the shared layout with metadata and skip navigation**

Create `src/layouts/BaseLayout.astro`:

```astro
---
import SiteFooter from '../components/SiteFooter.astro';
import SiteNav from '../components/SiteNav.astro';
import ProfileSidebar from '../components/ProfileSidebar.astro';
import '../styles/global.css';

interface Props {
  title: string;
  description: string;
  activeNav?: 'About' | 'Projects' | 'Research';
}

const { title, description, activeNav } = Astro.props;
const canonical = Astro.site ? new URL(Astro.url.pathname, Astro.site).toString() : undefined;
---

<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width" />
    <meta name="description" content={description} />
    <meta property="og:type" content="website" />
    <meta property="og:title" content={title} />
    <meta property="og:description" content={description} />
    {canonical && <meta property="og:url" content={canonical} />}
    {canonical && <link rel="canonical" href={canonical} />}
    <meta name="twitter:card" content="summary" />
    <title>{title}</title>
  </head>
  <body>
    <a class="skip-link" href="#main-content">Skip to main content</a>
    <header class="site-header">
      <SiteNav active={activeNav} />
    </header>
    <div class="page-shell">
      <ProfileSidebar />
      <main id="main-content" tabindex="-1">
        <slot />
      </main>
    </div>
    <SiteFooter />
  </body>
</html>
```

- [ ] **Step 5: Create the full base stylesheet**

Create `src/styles/global.css`:

```css
:root {
  color-scheme: light;
  --background: #ffffff;
  --surface: #f7f8f9;
  --text: #292d32;
  --muted: #656c73;
  --rule: #dfe2e6;
  --accent: #2d587a;
  --accent-soft: #edf2f5;
  --content-width: 1040px;
}

* {
  box-sizing: border-box;
}

html {
  background: var(--background);
  color: var(--text);
  font-family: "Times New Roman", Times, serif;
  line-height: 1.62;
  scroll-behavior: auto;
}

body {
  margin: 0;
  min-width: 320px;
  background: var(--background);
  font-size: 17px;
}

a {
  color: var(--accent);
  text-decoration-thickness: 1px;
  text-underline-offset: 0.16em;
}

a:hover {
  text-decoration-thickness: 2px;
}

a:focus-visible,
button:focus-visible,
[tabindex]:focus-visible {
  outline: 3px solid #8da9bd;
  outline-offset: 3px;
}

.skip-link {
  position: fixed;
  top: 0.75rem;
  left: 0.75rem;
  z-index: 20;
  padding: 0.55rem 0.8rem;
  background: var(--text);
  color: #fff;
  transform: translateY(-180%);
}

.skip-link:focus {
  transform: translateY(0);
}

.site-header {
  border-bottom: 1px solid var(--rule);
}

.site-nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: min(100% - 2rem, var(--content-width));
  min-height: 68px;
  margin: 0 auto;
  font-family: Arial, "Helvetica Neue", sans-serif;
  font-size: 0.82rem;
}

.site-name {
  color: var(--text);
  font-family: "Times New Roman", Times, serif;
  font-size: 1.28rem;
  text-decoration: none;
}

.site-nav ul {
  display: flex;
  gap: 1.5rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.site-nav a[aria-current="page"] {
  color: var(--text);
  font-weight: 700;
  text-decoration: underline;
}

.page-shell {
  display: grid;
  grid-template-columns: 230px minmax(0, 1fr);
  gap: 3rem;
  width: min(100% - 2rem, var(--content-width));
  margin: 0 auto;
  padding: 3rem 0 4rem;
}

.profile-sidebar {
  align-self: start;
  padding-right: 2rem;
  border-right: 1px solid var(--rule);
  text-align: center;
}

.monogram {
  display: grid;
  place-items: center;
  width: 112px;
  height: 112px;
  margin: 0 auto 1rem;
  border-radius: 50%;
  background: #e6e9ed;
  color: #555e67;
  font-size: 2rem;
}

.profile-sidebar h2 {
  margin: 0;
  font-size: 1.45rem;
  font-weight: 400;
}

.profile-degree,
.profile-institution {
  margin: 0.35rem 0 0;
  color: var(--muted);
  font-size: 0.98rem;
  line-height: 1.4;
}

.sidebar-section {
  margin-top: 1.8rem;
  text-align: left;
}

.sidebar-section h3 {
  margin: 0 0 0.55rem;
  padding-bottom: 0.38rem;
  border-bottom: 1px solid var(--rule);
  font-family: Arial, "Helvetica Neue", sans-serif;
  font-size: 0.72rem;
  letter-spacing: 0.07em;
  text-transform: uppercase;
}

.sidebar-section ul {
  margin: 0;
  padding: 0;
  list-style: none;
}

.sidebar-section li {
  margin: 0.35rem 0;
}

.email-link {
  overflow-wrap: anywhere;
}

main {
  min-width: 0;
}

main h1 {
  margin: 0 0 1rem;
  font-size: clamp(2rem, 4vw, 2.65rem);
  font-weight: 400;
  line-height: 1.12;
}

main h2 {
  margin: 2.6rem 0 1rem;
  padding-bottom: 0.45rem;
  border-bottom: 1px solid #bfc5cb;
  font-size: 1.55rem;
  font-weight: 400;
}

main h3 {
  font-size: 1.18rem;
}

.lead {
  max-width: 760px;
  margin: 0;
  color: #4e545b;
  font-size: 1.08rem;
}

.notice {
  margin-top: 2rem;
  padding: 1rem 1.1rem;
  border-left: 3px solid #8a9dac;
  background: var(--surface);
}

.site-footer {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  padding: 1.1rem max(1rem, calc((100% - var(--content-width)) / 2));
  border-top: 1px solid var(--rule);
  background: #fafafa;
  color: var(--muted);
  font-size: 0.88rem;
}

@media (max-width: 760px) {
  .site-nav {
    align-items: flex-start;
    flex-direction: column;
    gap: 0.6rem;
    padding: 1rem 0;
  }

  .site-nav ul {
    width: 100%;
    justify-content: space-between;
    gap: 0.75rem;
  }

  .page-shell {
    grid-template-columns: 1fr;
    gap: 2rem;
    padding-top: 2rem;
  }

  .profile-sidebar {
    padding: 0 0 2rem;
    border-right: 0;
    border-bottom: 1px solid var(--rule);
  }

  .sidebar-section {
    max-width: 360px;
    margin-right: auto;
    margin-left: auto;
  }

  .site-footer {
    flex-direction: column;
  }
}
```

- [ ] **Step 6: Create the production About introduction**

Create `src/pages/index.astro`:

```astro
---
import BaseLayout from '../layouts/BaseLayout.astro';
import { site } from '../data/site.mjs';
---

<BaseLayout
  title="Yunxi Wu | Electronic and Electrical Engineering"
  description="Academic profile of Yunxi Wu, a BEng Electronic and Electrical Engineering student at the University of Birmingham."
  activeNav="About"
>
  <h1>About</h1>
  <p class="lead">{site.intro}</p>
  <div class="notice">
    <strong>Current direction</strong>
    <p>{site.currentDirection}</p>
  </div>
</BaseLayout>
```

- [ ] **Step 7: Build and run the shell tests**

Run separately:

```powershell
pnpm check
```

```powershell
pnpm build
```

```powershell
node --test test/site-data.test.mjs test/shell-output.test.mjs
```

Expected: Astro check reports zero errors, static build succeeds, and all 5 tests PASS.

- [ ] **Step 8: Commit the shared shell**

```powershell
git add src/layouts src/components src/styles src/pages/index.astro test/helpers.mjs test/shell-output.test.mjs
git commit -m "feat: add restrained academic site shell"
```

---

### Task 3: Add schema-validated project and manuscript records

**Files:**
- Create: `src/content.config.ts`
- Create: `src/content/projects/future-ocean-habitat.md`
- Create: `src/content/projects/life-support-system.md`
- Create: `src/content/projects/communication-system-modelling.md`
- Create: `src/content/research/more-electric-aircraft.md`
- Create: `test/content-source.test.mjs`

**Interfaces:**
- Consumes: approved factual project and manuscript evidence.
- Produces: content collection `projects`, whose entries expose `data.title`, `data.shortTitle`, `data.summary`, `data.type`, `data.role`, `data.tools`, `data.order`, `data.featured`, five structured section arrays, and `data.evidence`.
- Produces: content collection `research`, whose entries expose `data.title`, `data.status`, `data.authorship`, `data.summary`, `data.scope`, and `data.order`.

- [ ] **Step 1: Write the failing source-content test**

Create `test/content-source.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { projectRoot } from './helpers.mjs';

const projectCases = [
  ['future-ocean-habitat.md', ['Group project', 'WP3 Energy', 'WP5 Systems', 'WP6B Underwater Data Centre']],
  ['life-support-system.md', ['Individual design', '180 V DC', '97.7%']],
  ['communication-system-modelling.md', ['Individual laboratory', '0.0593', '4.04 × 10^-2']],
];

test('project source records contain required roles, sections, and verified results', async () => {
  for (const [file, fragments] of projectCases) {
    const source = await readFile(path.join(projectRoot, 'src', 'content', 'projects', file), 'utf8');
    for (const key of ['overview:', 'contributions:', 'technicalApproach:', 'results:', 'evidence:', 'reflection:']) {
      assert.match(source, new RegExp(`^${key}`, 'm'), `${file} is missing ${key}`);
    }
    for (const fragment of fragments) assert.ok(source.includes(fragment), `${file} is missing ${fragment}`);
  }
});

test('manuscript record uses the exact title and editorial status', async () => {
  const source = await readFile(
    path.join(projectRoot, 'src', 'content', 'research', 'more-electric-aircraft.md'),
    'utf8',
  );
  assert.ok(source.includes('Progress on More Electric Aircraft Power Systems at High Energy Density and Carbon Emission: Challenges and Opportunities'));
  assert.ok(source.includes('Submitted manuscript — Under editorial review'));
  assert.ok(source.includes('First-author review manuscript'));
  assert.doesNotMatch(source, /under peer review|accepted|in press|published/i);
});

test('content records exclude sensitive source-document data', async () => {
  const files = [
    ...projectCases.map(([file]) => path.join(projectRoot, 'src', 'content', 'projects', file)),
    path.join(projectRoot, 'src', 'content', 'research', 'more-electric-aircraft.md'),
  ];
  const combined = (await Promise.all(files.map((file) => readFile(file, 'utf8')))).join('\n');
  assert.doesNotMatch(combined, /\b\d{7}\b/);
  assert.doesNotMatch(combined, /non-public collaborator-name sentinel/i);
});
```

- [ ] **Step 2: Run the source-content test and confirm failure**

Run:

```powershell
node --test test/content-source.test.mjs
```

Expected: FAIL with `ENOENT` because the content files do not exist.

- [ ] **Step 3: Define strict collection schemas**

Create `src/content.config.ts`:

```ts
import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const evidence = z.object({
  src: z.string().startsWith('/assets/projects/'),
  alt: z.string().min(20),
  caption: z.string().min(20),
});

const projects = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/projects' }),
  schema: z.object({
    title: z.string(),
    shortTitle: z.string(),
    summary: z.string(),
    type: z.enum(['Group project', 'Individual design', 'Individual laboratory']),
    role: z.string(),
    tools: z.array(z.string()).min(2),
    order: z.number().int().positive(),
    featured: z.boolean(),
    overview: z.array(z.string()).min(1),
    contributions: z.array(z.string()).min(1),
    technicalApproach: z.array(z.string()).min(1),
    results: z.array(z.string()).min(1),
    evidence: z.array(evidence).min(2),
    reflection: z.array(z.string()).min(1),
  }),
});

const research = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/research' }),
  schema: z.object({
    title: z.string(),
    status: z.literal('Submitted manuscript — Under editorial review'),
    authorship: z.literal('First-author review manuscript'),
    summary: z.string(),
    scope: z.array(z.string()).min(3),
    order: z.number().int().positive(),
  }),
});

export const collections = { projects, research };
```

- [ ] **Step 4: Create the Future Ocean Habitat record**

Create `src/content/projects/future-ocean-habitat.md`:

```markdown
---
title: "Future Ocean Habitat — Integrated Systems Concept Design"
shortTitle: "Future Ocean Habitat"
summary: "Integrated systems concept design for a self-sufficient future ocean habitat, with explicit attribution of coordination and work-package leadership."
type: "Group project"
role: "Group Coordinator / Lead for WP3 Energy, WP5 Systems, and WP6B Underwater Data Centre"
tools:
  - "Systems engineering"
  - "Requirements analysis"
  - "Concept design"
order: 1
featured: true
overview:
  - >-
    The Future Ocean Habitat was a group concept-design project for a self-sufficient deep-sea habitat. The work integrated life support, energy, control and communications, carbon management, an underwater data centre, and subsea operations into one system architecture.
contributions:
  - "Served as Group Coordinator/Leader."
  - "Led WP3 Energy, WP5 Systems, and WP6B Underwater Data Centre."
  - "Contributed to WP1 and WP2."
  - "The complete habitat report was a team output; this page presents only the responsibilities and evidence attributable to Yunxi Wu."
technicalApproach:
  - >-
    The team used requirements decomposition and work-package interfaces to connect material, energy, data, control, and operational flows. My work focused on coordinating these interfaces and developing the energy, system-level control, and underwater data-centre contributions.
  - >-
    The underwater data-centre concept linked compute demand, electrical supply, closed-loop cooling, seawater heat rejection, waste-heat recovery, monitoring, and safe degraded modes.
results:
  - >-
    The master system block diagram established the main interfaces among life support, energy, automation, communications, carbon treatment, the underwater data centre, and subsea operations.
  - >-
    The underwater data-centre work package used a continuous 250 kW IT-load design point to size cooling, heat rejection, and heat-reuse paths. These values are concept-design calculations, not measured operating results.
evidence:
  - src: "/assets/projects/future-ocean-habitat-master-system.png"
    alt: "Master system block diagram linking the habitat life-support, energy, automation, data-centre, carbon-treatment, and subsea modules."
    caption: "Master system block diagram from the group concept design; cropped to remove schedule and coursework context."
  - src: "/assets/projects/future-ocean-habitat-udc-flow.png"
    alt: "Functional flow diagram for the underwater data centre, including computing, power, cooling, monitoring, and external interfaces."
    caption: "Underwater data-centre functional flow used to connect IT demand, electrical supply, cooling, heat recovery, and monitoring."
reflection:
  - >-
    This project developed experience in coordinating a large systems concept, tracing interfaces across work packages, and separating subsystem optimisation from whole-system integration. It also showed the importance of stating contribution boundaries clearly when presenting team engineering work.
---
```

- [ ] **Step 5: Create the Life-Support System record**

Create `src/content/projects/life-support-system.md`:

```markdown
---
title: "Life-Support System — Power and Control Simulation"
shortTitle: "Life-Support Power and Control"
summary: "Individual multi-domain design and simulation of a 180 V DC power and control system for a future ocean-habitat life-support system."
type: "Individual design"
role: "Individual detailed design and simulation"
tools:
  - "MATLAB Simulink"
  - "Simscape"
  - "Closed-loop control"
order: 2
featured: true
overview:
  - >-
    This individual detailed-design project modelled the electrical supply and supervisory control of a future ocean-habitat life-support system. The model connected electrical conversion to water, gas, mechanical, thermal, and humidity-control loads.
contributions:
  - "Developed the individual Simulink/Simscape model and report."
  - "Modelled the 180 V DC bus, converter behaviour, subsystem loads, protection, and efficiency measurement."
  - "Designed the hierarchical control relationships for water processing, oxygen generation, carbon-dioxide removal, HVAC, and humidity management."
technicalApproach:
  - >-
    The design used a 180 V DC bus with PI and PWM converter control, demand-based source-load matching, inrush-current limiting, pre-charge paths, and DC-link buffering.
  - >-
    Life-support demand was represented across water intake, reverse osmosis, recovery and distribution, oxygen generation, carbon-dioxide removal, HVAC, and dew-point or humidity control. Supervisory logic enabled loads in response to process variables rather than operating every load continuously.
results:
  - >-
    Under the documented model configuration, the submitted simulation reports a cumulative efficiency of 97.7%. This is a simulation result and is not presented as measured physical-system efficiency.
  - >-
    Instantaneous input-output power ratios were affected by energy release from DC-link and buffer capacitors, so cumulative energy efficiency was used as the more meaningful system-level measure.
evidence:
  - src: "/assets/projects/life-support-hvac-control.png"
    alt: "Simulink model showing HVAC and humidity-management control subsystems coupled to the life-support electrical load."
    caption: "HVAC and humidity-management section of the individual multi-domain control model."
  - src: "/assets/projects/life-support-efficiency.png"
    alt: "Cumulative energy-efficiency simulation curve rising and settling at approximately 97.7 percent."
    caption: "Cumulative energy-efficiency result for the documented simulation configuration."
reflection:
  - >-
    The model demonstrated why power-electronic control and physical-process control must be evaluated together. A future extension would add component calibration from hardware data and uncertainty analysis around process demand and conversion losses.
---
```

- [ ] **Step 6: Create the Communication-System record**

Create `src/content/projects/communication-system-modelling.md`:

```markdown
---
title: "Communication-System Modelling and Filter Optimisation"
shortTitle: "Communication-System Modelling"
summary: "Individual MATLAB investigation of channel capacity, SNR, AWGN demodulation, and filter performance using BER and MSE."
type: "Individual laboratory"
role: "Individual modelling, implementation, and analysis"
tools:
  - "MATLAB"
  - "Signal processing"
  - "BER and MSE analysis"
order: 3
featured: true
overview:
  - >-
    This individual laboratory project investigated communication-channel behaviour and coherent OOK/AM demodulation under additive white Gaussian noise. The work combined analytical relationships with reproducible MATLAB simulation.
contributions:
  - "Implemented the channel-capacity, BER, SNR-distance, demodulation, parameter-search, and filter-comparison analysis in MATLAB."
  - "Used a fixed random seed and consistent noise conditions for comparative testing."
  - "Used BER as the primary selection metric and MSE as the tie-breaker."
technicalApproach:
  - >-
    The first analysis examined Shannon capacity and BER under bandwidth and temperature variation, followed by SNR degradation with distance at 2 dB/km attenuation.
  - >-
    The demodulation study compared moving-median, FFT, Butterworth, and Chebyshev filters after parameter sweeps across the same noise-power conditions.
results:
  - >-
    Among the tested filters and parameter ranges, the Butterworth configuration achieved the lowest reported average BER of 0.0593 and the lowest reported MSE of 4.04 × 10^-2.
  - >-
    The result is limited to the simulated signal, noise conditions, parameter ranges, and evaluation method documented in the laboratory work.
evidence:
  - src: "/assets/projects/communication-channel-capacity.png"
    alt: "Shannon channel-capacity curves plotted against temperature for three different bandwidth scenarios."
    caption: "Channel capacity versus temperature under decreased, nominal, and increased bandwidth scenarios."
  - src: "/assets/projects/communication-filter-results.png"
    alt: "Table comparing average BER and MSE for moving-median, FFT, Butterworth, and Chebyshev filters."
    caption: "Optimised filter comparison showing the reported average BER and MSE values."
reflection:
  - >-
    The exercise reinforced the need to compare filters with consistent data, parameter searches, and evaluation metrics. A stronger future study would use independent validation signals and confidence intervals across repeated noise realisations.
---
```

- [ ] **Step 7: Create the manuscript record**

Create `src/content/research/more-electric-aircraft.md`:

```markdown
---
title: "Progress on More Electric Aircraft Power Systems at High Energy Density and Carbon Emission: Challenges and Opportunities"
status: "Submitted manuscript — Under editorial review"
authorship: "First-author review manuscript"
summary: "A review of technologies, architectures, integration constraints, and representative cases in more-electric aircraft power systems."
scope:
  - "Integrated starter-generators, thermal management, and electro-hydrostatic actuation"
  - "Wide-bandgap devices, insulation and partial-discharge constraints, and variable-frequency AC"
  - "Power-management strategies, backup power, and representative aircraft or electrified-propulsion cases"
order: 1
---
```

- [ ] **Step 8: Run schema and source-content verification**

Run separately:

```powershell
pnpm check
```

```powershell
node --test test/content-source.test.mjs
```

Expected: Astro validates both collections; all 3 source tests PASS.

- [ ] **Step 9: Commit the factual content layer**

```powershell
git add src/content.config.ts src/content test/content-source.test.mjs
git commit -m "content: add verified academic project records"
```

---

### Task 4: Build the projects index and evidence-led detail routes

**Files:**
- Create: `src/components/ProjectListItem.astro`
- Create: `src/components/EvidenceGallery.astro`
- Create: `src/pages/projects/index.astro`
- Create: `src/pages/projects/[id].astro`
- Create: `test/project-routes.test.mjs`
- Modify: `src/pages/index.astro`
- Modify: `src/styles/global.css`

**Interfaces:**
- Consumes: `CollectionEntry<'projects'>` records from Task 3.
- Produces: `/projects/` and `/projects/{entry.id}/` static routes.
- Produces: `ProjectListItem` prop `{ project: CollectionEntry<'projects'> }` and `EvidenceGallery` prop `{ evidence: CollectionEntry<'projects'>['data']['evidence'] }`.

- [ ] **Step 1: Write the failing project-route test**

Create `test/project-routes.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readDist } from './helpers.mjs';

const routes = [
  'projects/future-ocean-habitat/index.html',
  'projects/life-support-system/index.html',
  'projects/communication-system-modelling/index.html',
];

test('projects index and three detail routes are generated', async () => {
  const index = await readDist('projects/index.html');
  assert.match(index, /Future Ocean Habitat/);
  assert.match(index, /Life-Support System/);
  assert.match(index, /Communication-System Modelling/);
  for (const route of routes) assert.ok((await readDist(route)).includes('<h1'));
});

test('project pages preserve the approved evidence-section order', async () => {
  for (const route of routes) {
    const html = await readDist(route);
    const headings = [
      'Overview',
      'My Contribution',
      'Technical Approach',
      'Results &amp; Validation',
      'Evidence Gallery',
      'Reflection &amp; Next Steps',
    ];
    let previous = -1;
    for (const heading of headings) {
      const position = html.indexOf(heading);
      assert.ok(position > previous, `${route} has an incorrect section order at ${heading}`);
      previous = position;
    }
  }
});

test('project pages expose verified contribution and result boundaries', async () => {
  const group = await readDist(routes[0]);
  assert.match(group, /Group project/);
  assert.match(group, /Group Coordinator/);
  assert.match(group, /WP3 Energy, WP5 Systems, and WP6B Underwater Data Centre/);
  assert.match(group, /team output/);

  const life = await readDist(routes[1]);
  assert.match(life, /Individual design/);
  assert.match(life, /97\.7%/);
  assert.match(life, /simulation result/);

  const communication = await readDist(routes[2]);
  assert.match(communication, /Individual laboratory/);
  assert.match(communication, /0\.0593/);
  assert.match(communication, /4\.04 × 10<sup>−2<\/sup>|4\.04 × 10\^-2/);
});
```

- [ ] **Step 2: Build before implementation and confirm route-test failure**

Run:

```powershell
pnpm build
```

Then run:

```powershell
node --test test/project-routes.test.mjs
```

Expected: FAIL because `dist/projects/index.html` does not exist.

- [ ] **Step 3: Create compact project and evidence components**

Create `src/components/ProjectListItem.astro`:

```astro
---
import type { CollectionEntry } from 'astro:content';

interface Props {
  project: CollectionEntry<'projects'>;
}

const { project } = Astro.props;
---

<article class="project-row">
  <div>
    <h3><a href={`/projects/${project.id}/`}>{project.data.title}</a></h3>
    <p>{project.data.summary}</p>
  </div>
  <dl class="project-meta">
    <div><dt>Type</dt><dd>{project.data.type}</dd></div>
    <div><dt>Role</dt><dd>{project.data.role}</dd></div>
  </dl>
</article>
```

Create `src/components/EvidenceGallery.astro`:

```astro
---
import type { CollectionEntry } from 'astro:content';

interface Props {
  evidence: CollectionEntry<'projects'>['data']['evidence'];
}

const { evidence } = Astro.props;
---

<div class="evidence-grid">
  {evidence.map((item) => (
    <figure>
      <img src={item.src} alt={item.alt} loading="lazy" decoding="async" />
      <figcaption>{item.caption}</figcaption>
    </figure>
  ))}
</div>
```

- [ ] **Step 4: Create the projects index**

Create `src/pages/projects/index.astro`:

```astro
---
import { getCollection } from 'astro:content';
import ProjectListItem from '../../components/ProjectListItem.astro';
import BaseLayout from '../../layouts/BaseLayout.astro';

const projects = (await getCollection('projects')).sort((a, b) => a.data.order - b.data.order);
---

<BaseLayout
  title="Projects | Yunxi Wu"
  description="Selected electronic and electrical engineering projects by Yunxi Wu."
  activeNav="Projects"
>
  <h1>Projects</h1>
  <p class="lead">Selected work in systems engineering, power and control simulation, and communication-system analysis.</p>
  <div class="project-list">
    {projects.map((project) => <ProjectListItem project={project} />)}
  </div>
</BaseLayout>
```

- [ ] **Step 5: Create the static project-detail route**

Create `src/pages/projects/[id].astro`:

```astro
---
import { getCollection } from 'astro:content';
import type { CollectionEntry } from 'astro:content';
import EvidenceGallery from '../../components/EvidenceGallery.astro';
import BaseLayout from '../../layouts/BaseLayout.astro';

export async function getStaticPaths() {
  const projects = await getCollection('projects');
  return projects.map((project) => ({
    params: { id: project.id },
    props: { project },
  }));
}

interface Props {
  project: CollectionEntry<'projects'>;
}

const { project } = Astro.props;
const data = project.data;
---

<BaseLayout
  title={`${data.shortTitle} | Yunxi Wu`}
  description={data.summary}
  activeNav="Projects"
>
  <p class="eyebrow">{data.type}</p>
  <h1>{data.title}</h1>
  <p class="lead">{data.summary}</p>

  <dl class="project-summary">
    <div><dt>Role</dt><dd>{data.role}</dd></div>
    <div><dt>Methods and tools</dt><dd>{data.tools.join(' · ')}</dd></div>
  </dl>

  <section><h2>Overview</h2>{data.overview.map((paragraph) => <p>{paragraph}</p>)}</section>
  <section><h2>My Contribution</h2><ul>{data.contributions.map((item) => <li>{item}</li>)}</ul></section>
  <section><h2>Technical Approach</h2>{data.technicalApproach.map((paragraph) => <p>{paragraph}</p>)}</section>
  <section><h2>Results &amp; Validation</h2>{data.results.map((paragraph) => <p>{paragraph}</p>)}</section>
  <section><h2>Evidence Gallery</h2><EvidenceGallery evidence={data.evidence} /></section>
  <section><h2>Reflection &amp; Next Steps</h2>{data.reflection.map((paragraph) => <p>{paragraph}</p>)}</section>
</BaseLayout>
```

- [ ] **Step 6: Add selected projects to the homepage**

Replace `src/pages/index.astro` with:

```astro
---
import { getCollection } from 'astro:content';
import ProjectListItem from '../components/ProjectListItem.astro';
import BaseLayout from '../layouts/BaseLayout.astro';
import { site } from '../data/site.mjs';

const projects = (await getCollection('projects'))
  .filter((project) => project.data.featured)
  .sort((a, b) => a.data.order - b.data.order);
---

<BaseLayout
  title="Yunxi Wu | Electronic and Electrical Engineering"
  description="Academic profile of Yunxi Wu, a BEng Electronic and Electrical Engineering student at the University of Birmingham."
  activeNav="About"
>
  <h1>About</h1>
  <p class="lead">{site.intro}</p>

  <section>
    <h2>Selected Projects</h2>
    <div class="project-list">
      {projects.map((project) => <ProjectListItem project={project} />)}
    </div>
  </section>

  <div class="notice">
    <strong>Current direction</strong>
    <p>{site.currentDirection}</p>
  </div>
</BaseLayout>
```

- [ ] **Step 7: Append the exact project styles**

Append to `src/styles/global.css`:

```css
.eyebrow,
.project-meta,
.project-summary dt {
  font-family: Arial, "Helvetica Neue", sans-serif;
  font-size: 0.75rem;
}

.eyebrow {
  margin: 0 0 0.55rem;
  color: var(--accent);
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.project-list {
  border-top: 1px solid var(--rule);
}

.project-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(180px, 0.42fr);
  gap: 2rem;
  padding: 1.25rem 0;
  border-bottom: 1px solid var(--rule);
}

.project-row h3,
.project-row p {
  margin: 0;
}

.project-row p {
  margin-top: 0.4rem;
  color: var(--muted);
}

.project-meta,
.project-summary {
  margin: 0;
}

.project-meta div,
.project-summary div {
  margin-bottom: 0.55rem;
}

.project-meta dt,
.project-summary dt {
  color: var(--muted);
  font-weight: 700;
  text-transform: uppercase;
}

.project-meta dd,
.project-summary dd {
  margin: 0.12rem 0 0;
}

.project-summary {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1rem;
  margin-top: 1.5rem;
  padding: 1rem;
  border: 1px solid var(--rule);
  background: var(--surface);
}

.evidence-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1.25rem;
}

.evidence-grid figure {
  margin: 0;
}

.evidence-grid img {
  display: block;
  width: 100%;
  height: auto;
  border: 1px solid var(--rule);
  background: #fff;
}

.evidence-grid figcaption {
  margin-top: 0.55rem;
  color: var(--muted);
  font-size: 0.9rem;
}

@media (max-width: 680px) {
  .project-row,
  .project-summary,
  .evidence-grid {
    grid-template-columns: 1fr;
  }
}
```

- [ ] **Step 8: Build and verify all project routes**

Run separately:

```powershell
pnpm check
```

```powershell
pnpm build
```

```powershell
node --test test/project-routes.test.mjs
```

Expected: check and build succeed; all 3 project-route tests PASS.

- [ ] **Step 9: Commit the project experience**

```powershell
git add src/components/ProjectListItem.astro src/components/EvidenceGallery.astro src/pages/index.astro src/pages/projects src/styles/global.css test/project-routes.test.mjs
git commit -m "feat: add evidence-led project pages"
```

---

### Task 5: Complete the Research page and homepage manuscript entry

**Files:**
- Create: `src/components/ManuscriptEntry.astro`
- Create: `src/pages/research.astro`
- Create: `test/research-output.test.mjs`
- Modify: `src/pages/index.astro`
- Modify: `src/styles/global.css`

**Interfaces:**
- Consumes: `CollectionEntry<'research'>` records from Task 3 and `site.interests` / `site.currentDirection` from Task 1.
- Produces: `/research/` and a shared `ManuscriptEntry` component with prop `{ entry: CollectionEntry<'research'> }`.

- [ ] **Step 1: Write the failing research-output test**

Create `test/research-output.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readDist } from './helpers.mjs';

const manuscriptTitle = 'Progress on More Electric Aircraft Power Systems at High Energy Density and Carbon Emission: Challenges and Opportunities';
const exactStatus = 'Submitted manuscript — Under editorial review';

test('research page separates interests, ongoing work, and manuscript status', async () => {
  const html = await readDist('research/index.html');
  assert.match(html, /Research Interests/);
  assert.match(html, /Embodied AI/);
  assert.match(html, /Computer Vision/);
  assert.match(html, /Robotics/);
  assert.match(html, /Ongoing Work/);
  assert.ok(html.includes(manuscriptTitle));
  assert.ok(html.includes(exactStatus));
  assert.match(html, /First-author review manuscript/);
  assert.doesNotMatch(html, /under peer review|accepted|in press|published/i);
});

test('homepage includes the exact manuscript entry without a Publications heading', async () => {
  const html = await readDist('index.html');
  assert.ok(html.includes(manuscriptTitle));
  assert.ok(html.includes(exactStatus));
  assert.doesNotMatch(html, /<h[1-6][^>]*>\s*Publications\s*<\/h[1-6]>/i);
});
```

- [ ] **Step 2: Build and confirm the research test fails**

Run:

```powershell
pnpm build
```

Then run:

```powershell
node --test test/research-output.test.mjs
```

Expected: FAIL because `dist/research/index.html` does not exist.

- [ ] **Step 3: Create the manuscript component**

Create `src/components/ManuscriptEntry.astro`:

```astro
---
import type { CollectionEntry } from 'astro:content';

interface Props {
  entry: CollectionEntry<'research'>;
}

const { entry } = Astro.props;
---

<article class="manuscript-entry">
  <p class="manuscript-status">{entry.data.status}</p>
  <h3>{entry.data.title}</h3>
  <p><strong>{entry.data.authorship}.</strong> {entry.data.summary}</p>
  <ul>
    {entry.data.scope.map((item) => <li>{item}</li>)}
  </ul>
</article>
```

- [ ] **Step 4: Create the complete Research route**

Create `src/pages/research.astro`:

```astro
---
import { getCollection } from 'astro:content';
import ManuscriptEntry from '../components/ManuscriptEntry.astro';
import BaseLayout from '../layouts/BaseLayout.astro';
import { site } from '../data/site.mjs';

const manuscripts = (await getCollection('research')).sort((a, b) => a.data.order - b.data.order);
---

<BaseLayout
  title="Research | Yunxi Wu"
  description="Research interests, ongoing direction, and submitted manuscript by Yunxi Wu."
  activeNav="Research"
>
  <h1>Research</h1>

  <section>
    <h2>Research Interests</h2>
    <ul class="interest-list">
      {site.interests.map((interest) => <li>{interest}</li>)}
    </ul>
  </section>

  <section>
    <h2>Ongoing Work</h2>
    <p>{site.currentDirection}</p>
  </section>

  <section>
    <h2>Research &amp; Manuscripts</h2>
    {manuscripts.map((entry) => <ManuscriptEntry entry={entry} />)}
  </section>
</BaseLayout>
```

- [ ] **Step 5: Add the manuscript entry to the homepage**

In `src/pages/index.astro`, add these imports and data query in the frontmatter:

```astro
import ManuscriptEntry from '../components/ManuscriptEntry.astro';

const manuscripts = (await getCollection('research')).sort((a, b) => a.data.order - b.data.order);
```

Insert this section between Selected Projects and Current direction:

```astro
<section>
  <h2>Research &amp; Manuscripts</h2>
  {manuscripts.map((entry) => <ManuscriptEntry entry={entry} />)}
</section>
```

- [ ] **Step 6: Append the research styles**

Append to `src/styles/global.css`:

```css
.interest-list {
  display: flex;
  flex-wrap: wrap;
  gap: 0.55rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.interest-list li {
  padding: 0.35rem 0.65rem;
  border: 1px solid var(--rule);
  background: var(--surface);
}

.manuscript-entry {
  padding: 1.1rem 0;
  border-bottom: 1px solid var(--rule);
}

.manuscript-status {
  margin: 0 0 0.55rem;
  color: #725d22;
  font-family: Arial, "Helvetica Neue", sans-serif;
  font-size: 0.78rem;
  font-weight: 700;
}

.manuscript-entry h3,
.manuscript-entry p {
  margin-top: 0;
}
```

- [ ] **Step 7: Build and run the research tests**

Run separately:

```powershell
pnpm check
```

```powershell
pnpm build
```

```powershell
node --test test/research-output.test.mjs
```

Expected: check and build succeed; both research-output tests PASS.

- [ ] **Step 8: Commit the research experience**

```powershell
git add src/components/ManuscriptEntry.astro src/pages/index.astro src/pages/research.astro src/styles/global.css test/research-output.test.mjs
git commit -m "feat: add research and manuscript pages"
```

---

### Task 6: Prepare six sanitised evidence assets with recorded provenance

**Files:**
- Create: `scripts/sanitise_png.py`
- Create: `public/assets/projects/future-ocean-habitat-master-system.png`
- Create: `public/assets/projects/future-ocean-habitat-udc-flow.png`
- Create: `public/assets/projects/life-support-hvac-control.png`
- Create: `public/assets/projects/life-support-efficiency.png`
- Create: `public/assets/projects/communication-channel-capacity.png`
- Create: `public/assets/projects/communication-filter-results.png`
- Create: `docs/content-evidence.md`
- Create: `test/assets.test.mjs`

**Interfaces:**
- Consumes: the exact six public paths already declared in the project content records.
- Produces: metadata-free RGB PNG files and a repository-safe provenance record containing source filename, one-based PDF page number, figure/table label, public caption, and sanitisation decision.

- [ ] **Step 1: Write the failing asset test**

Create `test/assets.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { projectRoot } from './helpers.mjs';

const assets = [
  'future-ocean-habitat-master-system.png',
  'future-ocean-habitat-udc-flow.png',
  'life-support-hvac-control.png',
  'life-support-efficiency.png',
  'communication-channel-capacity.png',
  'communication-filter-results.png',
];

const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

test('all six sanitised evidence assets are valid non-empty PNG files', async () => {
  for (const asset of assets) {
    const file = path.join(projectRoot, 'public', 'assets', 'projects', asset);
    const info = await stat(file);
    assert.ok(info.size > 5_000, `${asset} is unexpectedly small`);
    const bytes = await readFile(file);
    assert.deepEqual(bytes.subarray(0, 8), pngSignature, `${asset} is not a PNG`);
  }
});
```

- [ ] **Step 2: Run the asset test and confirm failure**

Run:

```powershell
node --test test/assets.test.mjs
```

Expected: FAIL with `ENOENT` for the first missing PNG.

- [ ] **Step 3: Create the deterministic crop-and-clean helper**

Create `scripts/sanitise_png.py`:

```python
from __future__ import annotations

import argparse
from pathlib import Path
from PIL import Image


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Crop a rendered PDF page and save a metadata-free RGB PNG."
    )
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("left", type=int)
    parser.add_argument("top", type=int)
    parser.add_argument("right", type=int)
    parser.add_argument("bottom", type=int)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    box = (args.left, args.top, args.right, args.bottom)
    if args.right <= args.left or args.bottom <= args.top:
        raise ValueError(f"Invalid crop box: {box}")

    with Image.open(args.input) as source:
        width, height = source.size
        if not (0 <= args.left < args.right <= width and 0 <= args.top < args.bottom <= height):
            raise ValueError(f"Crop box {box} exceeds source size {(width, height)}")
        cleaned = source.crop(box).convert("RGB")
        args.output.parent.mkdir(parents=True, exist_ok=True)
        cleaned.save(args.output, format="PNG", optimize=True)


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Render and crop the two Future Ocean Habitat figures**

Use the PDF workflow to render the following one-based pages at 200 DPI into `tmp/pdfs/evidence/`, then inspect the full page before cropping:

1. `IDP2 Assignment 1 group 14.pdf`, page 18, **Fig. 4 Master system block diagram**. Crop only Fig. 4 and its figure caption. Exclude the Gantt chart, group number, dates, page margin, and surrounding report text. Save as `public/assets/projects/future-ocean-habitat-master-system.png`.
2. The same PDF, page 336, **Fig. 140 Function Flow of UDC**. Crop only the functional-flow diagram and its figure caption. Exclude the requirements table above it and material-selection text below it. Save as `public/assets/projects/future-ocean-habitat-udc-flow.png`.

Use `scripts/sanitise_png.py` for the final crop so each output is a new RGB PNG with no copied PDF metadata.

- [ ] **Step 5: Render and crop the two Life-Support System figures**

Render these pages at 200 DPI and inspect them before cropping:

1. `IDP2 Assignment2 Report Yunxi Wu.pdf`, page 8, **Fig. 6 Load of HVAC and Humidity Management System**. Crop the model figure and its figure caption; exclude the page number and surrounding report paragraph. Save as `public/assets/projects/life-support-hvac-control.png`.
2. The same PDF, page 21, **Fig. 24 Cumulative Energy Efficiency**. Crop the upper efficiency plot and its figure caption only; exclude Fig. 25 and the page number. Preserve the visible 97.7% annotation. Save as `public/assets/projects/life-support-efficiency.png`.

Use `scripts/sanitise_png.py` for both final files.

- [ ] **Step 6: Render and crop the two Communication-System figures**

Render these pages at 200 DPI and inspect them before cropping:

1. `Communication Lab4 report Yunxi Wu.pdf`, page 6, **Fig. 2 Shannon Channel Capacity vs. Temperature Under Different Bandwidth Scenarios**. Crop the graph and its figure caption; exclude the surrounding report discussion and page footer. Save as `public/assets/projects/communication-channel-capacity.png`.
2. The same PDF, page 31, **Table 1 Average BER and MSE for each filter**. Crop the table and the single explanatory sentence that identifies Butterworth as the lowest average BER/MSE result. Exclude the following limitations section and page margin. Save as `public/assets/projects/communication-filter-results.png`.

Use `scripts/sanitise_png.py` for both final files.

- [ ] **Step 7: Record exact repository-safe provenance**

Create `docs/content-evidence.md` with this exact structure and content:

```markdown
# Public Project Evidence Register

This register records the source and sanitisation decision for each public website image. Original coursework files remain outside the repository.

| Public asset | Source document | PDF page | Source label | Sanitisation decision |
| --- | --- | ---: | --- | --- |
| `future-ocean-habitat-master-system.png` | `IDP2 Assignment 1 group 14.pdf` | 18 | Fig. 4 Master system block diagram | Figure and caption only; schedule, group number, dates, and surrounding report text removed. |
| `future-ocean-habitat-udc-flow.png` | `IDP2 Assignment 1 group 14.pdf` | 336 | Fig. 140 Function Flow of UDC | Figure and caption only; requirements and material-selection text removed. |
| `life-support-hvac-control.png` | `IDP2 Assignment2 Report Yunxi Wu.pdf` | 8 | Fig. 6 Load of HVAC and Humidity Management System | Figure and caption only; page number and report paragraph removed. |
| `life-support-efficiency.png` | `IDP2 Assignment2 Report Yunxi Wu.pdf` | 21 | Fig. 24 Cumulative Energy Efficiency | Upper plot and caption only; adjacent loss plot and page number removed. |
| `communication-channel-capacity.png` | `Communication Lab4 report Yunxi Wu.pdf` | 6 | Fig. 2 Shannon Channel Capacity vs. Temperature | Graph and caption only; surrounding report text and footer removed. |
| `communication-filter-results.png` | `Communication Lab4 report Yunxi Wu.pdf` | 31 | Table 1 Average BER and MSE for each filter | Table and result sentence only; limitations discussion and page margin removed. |

## Public-use rules

- Do not add an original report page or PDF to the repository.
- Do not add student numbers, group-member names, assignment instructions, or grading material.
- Preserve captions that identify content as a concept diagram, model view, simulation plot, or tested filter comparison.
- Re-run the visual and privacy review whenever an asset is replaced.
```

- [ ] **Step 8: Perform the visual privacy check**

Open each final PNG at original detail and require all of the following before continuing:

- figure text and axes are legible;
- no student number, group-member name, assignment instruction, grading information, comment, or page footer remains;
- the crop contains the exact figure or table named in `docs/content-evidence.md`;
- the 97.7%, 0.0593, and 4.04 × 10^-2 evidence remains readable where applicable;
- no crop is clipped or dominated by blank page margins.

Delete `tmp/pdfs/evidence/` after all six outputs pass inspection.

- [ ] **Step 9: Run asset and build verification**

Run separately:

```powershell
node --test test/assets.test.mjs
```

```powershell
pnpm build
```

Expected: the asset test PASSes and Astro copies all six files into `dist/assets/projects/`.

- [ ] **Step 10: Commit the sanitised evidence**

```powershell
git add scripts/sanitise_png.py public/assets/projects docs/content-evidence.md test/assets.test.mjs
git commit -m "content: add sanitised project evidence"
```

---

### Task 7: Add the not-found route and comprehensive generated-output audit

**Files:**
- Create: `src/pages/404.astro`
- Create: `public/robots.txt`
- Create: `test/dist-audit.test.mjs`

**Interfaces:**
- Consumes: final routes and assets from Tasks 2–6.
- Produces: static `404.html`, crawler policy, and a generated-output acceptance test covering links, semantic landmarks, privacy, image alternatives, and prohibited CV/manuscript wording.

- [ ] **Step 1: Write the failing generated-output audit**

Create `test/dist-audit.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { distRoot } from './helpers.mjs';

const expectedHtml = [
  'index.html',
  'projects/index.html',
  'projects/future-ocean-habitat/index.html',
  'projects/life-support-system/index.html',
  'projects/communication-system-modelling/index.html',
  'research/index.html',
  '404.html',
];

async function walkHtml(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return walkHtml(full);
    return entry.name.endsWith('.html') ? [full] : [];
  }));
  return nested.flat();
}

function internalTarget(href) {
  const pathname = href.split('#')[0].split('?')[0];
  if (!pathname || pathname === '/') return path.join(distRoot, 'index.html');
  const clean = pathname.replace(/^\//, '').replace(/\/$/, '');
  return path.join(distRoot, clean, 'index.html');
}

test('all approved static routes exist', async () => {
  for (const relative of expectedHtml) await access(path.join(distRoot, relative));
});

test('every generated page has one h1, English language, main landmark, and verified email', async () => {
  for (const file of await walkHtml(distRoot)) {
    const html = await readFile(file, 'utf8');
    assert.equal((html.match(/<h1\b/g) ?? []).length, 1, `${file} must have exactly one h1`);
    assert.match(html, /<html lang="en">/);
    assert.match(html, /<main id="main-content"/);
    assert.match(html, /mailto:yxw1331@student\.bham\.ac\.uk/);
  }
});

test('internal links resolve to generated output', async () => {
  for (const file of await walkHtml(distRoot)) {
    const html = await readFile(file, 'utf8');
    const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((match) => match[1]);
    for (const href of hrefs) {
      if (/^(?:https?:|mailto:|#)/.test(href)) continue;
      await access(internalTarget(href));
    }
  }
});

test('public output contains no sensitive or prohibited wording', async () => {
  const html = (await Promise.all((await walkHtml(distRoot)).map((file) => readFile(file, 'utf8')))).join('\n');
  assert.doesNotMatch(html, /\b\d{7}\b/);
  assert.doesNotMatch(html, /non-public collaborator-name sentinel/i);
  assert.doesNotMatch(html, /\bCV\b/i);
  assert.doesNotMatch(html, /under peer review|accepted|in press|published/i);
});

test('every generated image has non-empty alternative text', async () => {
  for (const file of await walkHtml(distRoot)) {
    const html = await readFile(file, 'utf8');
    for (const match of html.matchAll(/<img\b[^>]*>/g)) {
      assert.match(match[0], /\balt="[^"]+"/, `${file} contains an image without descriptive alt text`);
    }
  }
});
```

- [ ] **Step 2: Build and confirm the audit fails on the missing 404 route**

Run:

```powershell
pnpm build
```

Then run:

```powershell
node --test test/dist-audit.test.mjs
```

Expected: FAIL because `dist/404.html` is missing.

- [ ] **Step 3: Create the static 404 page**

Create `src/pages/404.astro`:

```astro
---
import BaseLayout from '../layouts/BaseLayout.astro';
---

<BaseLayout
  title="Page not found | Yunxi Wu"
  description="The requested page could not be found."
>
  <h1>Page not found</h1>
  <p>The requested page does not exist or has moved.</p>
  <p><a href="/">Return to About</a></p>
</BaseLayout>
```

- [ ] **Step 4: Add the crawler policy**

Create `public/robots.txt`:

```text
User-agent: *
Allow: /
```

- [ ] **Step 5: Run the complete local generated-output suite**

Run separately:

```powershell
pnpm check
```

```powershell
pnpm build
```

```powershell
node --test
```

Expected: Astro check and build succeed; every Node test PASSes, including all expected routes, links, semantics, privacy rules, and image alternatives.

- [ ] **Step 6: Commit the output audit**

```powershell
git add src/pages/404.astro public/robots.txt test/dist-audit.test.mjs
git commit -m "test: audit generated academic site output"
```

---

### Task 8: Prepare GitHub Pages deployment and maintenance documentation

**Files:**
- Create: `.github/workflows/deploy.yml`
- Create: `README.md`
- Create: `docs/maintenance.md`
- Create: `test/deployment-config.test.mjs`

**Interfaces:**
- Consumes: `astro.config.mjs` support for the `SITE_URL` environment variable and the committed `pnpm-lock.yaml`.
- Produces: a workflow that derives the final origin from `github.repository_owner`, builds on `main`, and deploys only after the repository owner enables GitHub Actions as the Pages source.

- [ ] **Step 1: Write the failing deployment-configuration test**

Create `test/deployment-config.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { projectRoot } from './helpers.mjs';

test('GitHub Pages workflow uses the approved official action versions', async () => {
  const workflow = await readFile(path.join(projectRoot, '.github', 'workflows', 'deploy.yml'), 'utf8');
  assert.match(workflow, /branches: \[main\]/);
  assert.match(workflow, /uses: actions\/checkout@v7/);
  assert.match(workflow, /uses: withastro\/action@v6/);
  assert.match(workflow, /uses: actions\/deploy-pages@v5/);
  assert.match(workflow, /SITE_URL: https:\/\/\$\{\{ github\.repository_owner \}\}\.github\.io/);
  assert.doesNotMatch(workflow, /USERNAME|YOUR_NAME|example\.com/i);
});

test('Astro reads the canonical origin from SITE_URL without a hard-coded account', async () => {
  const config = await readFile(path.join(projectRoot, 'astro.config.mjs'), 'utf8');
  assert.match(config, /process\.env\.SITE_URL/);
  assert.doesNotMatch(config, /github\.io['"]/i);
});

test('maintenance documentation preserves the privacy and publishing boundaries', async () => {
  const guide = await readFile(path.join(projectRoot, 'docs', 'maintenance.md'), 'utf8');
  assert.match(guide, /Do not commit original coursework PDFs/);
  assert.match(guide, /Submitted manuscript — Under editorial review/);
  assert.match(guide, /explicit approval/);
  assert.doesNotMatch(guide, /\bCV\b/i);
});
```

- [ ] **Step 2: Run the deployment test and confirm failure**

Run:

```powershell
node --test test/deployment-config.test.mjs
```

Expected: FAIL because `.github/workflows/deploy.yml` and the maintenance guide do not exist.

- [ ] **Step 3: Create the official GitHub Pages workflow**

Create `.github/workflows/deploy.yml`:

```yaml
name: Deploy to GitHub Pages

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@v7
      - name: Install, build, and upload site
        uses: withastro/action@v6
        env:
          SITE_URL: https://${{ github.repository_owner }}.github.io

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v5
```

- [ ] **Step 4: Create the repository README**

Create `README.md`:

````markdown
# Yunxi Wu Academic Website

English-first academic profile for Yunxi Wu, a BEng Electronic and Electrical Engineering student at the University of Birmingham.

## Local commands

```powershell
pnpm install
pnpm check
pnpm build
pnpm test
pnpm dev
```

Run `check`, `build`, and `test` separately and require all three to pass before proposing a public update.

## Content locations

- Verified identity and navigation: `src/data/site.mjs`
- Project records: `src/content/projects/`
- Research record: `src/content/research/`
- Sanitised public images: `public/assets/projects/`
- Evidence provenance: `docs/content-evidence.md`
- Maintenance rules: `docs/maintenance.md`

## Publication boundary

This repository is prepared for GitHub Pages but must not be connected to a remote repository or published without Yunxi Wu's explicit approval of the exact GitHub account and repository target.
````

- [ ] **Step 5: Create the maintenance guide**

Create `docs/maintenance.md`:

```markdown
# Website Maintenance Guide

## Update a project

1. Edit the matching file under `src/content/projects/`.
2. Preserve the `type`, `role`, contribution boundary, and evidence captions.
3. Add only results that can be traced to verified source material.
4. Run `pnpm check`, `pnpm build`, and `pnpm test` as separate commands.

## Add a project

1. Add one Markdown record under `src/content/projects/` using every field enforced by `src/content.config.ts`.
2. Label the work as `Group project`, `Individual design`, or `Individual laboratory`.
3. For group work, state Yunxi Wu's contribution and the boundary of the team output.
4. Add at least two sanitised evidence images and register them in `docs/content-evidence.md`.
5. Add the expected route to the generated-output tests.

## Update manuscript status

The current public status is exactly `Submitted manuscript — Under editorial review`.

Do not change it to `under peer review`, `accepted`, `in press`, or `published` without new verified editorial evidence. When the status genuinely changes, update the research record and its tests in the same commit.

## Privacy rules

- Do not commit original coursework PDFs.
- Do not commit student numbers, assignment instructions, teammate personal data, local file paths, or the unpublished manuscript full text.
- Re-crop and visually inspect every replacement evidence image.
- Keep unavailable social links absent rather than adding inactive links.

## Publishing rule

Local commits do not authorise public publication. Creating a remote repository, pushing, or enabling GitHub Pages requires explicit approval for the exact GitHub account and repository.
```

- [ ] **Step 6: Run deployment and full verification**

Run separately:

```powershell
node --test test/deployment-config.test.mjs
```

```powershell
pnpm check
```

```powershell
pnpm build
```

```powershell
node --test
```

Expected: the deployment tests and full test suite PASS; the static build remains successful.

- [ ] **Step 7: Commit the prepared deployment workflow**

```powershell
git add .github/workflows/deploy.yml README.md docs/maintenance.md test/deployment-config.test.mjs
git commit -m "ci: prepare GitHub Pages deployment"
```

---

### Task 9: Run final local acceptance and present the site for user review

**Files:**
- Create after all checks pass: `docs/qa/2026-08-11-local-acceptance.md`

**Interfaces:**
- Consumes: the complete static site, lockfile, tests, evidence assets, and workflow from Tasks 1–8.
- Produces: a clean local acceptance record and a user-visible local preview. It does not produce a remote repository or public URL.

- [ ] **Step 1: Verify the committed dependency graph from a clean install**

Run:

```powershell
pnpm install --frozen-lockfile
```

Expected: installation succeeds without changing `pnpm-lock.yaml`.

- [ ] **Step 2: Run each final quality gate separately**

Run:

```powershell
pnpm check
```

Expected: zero Astro or TypeScript errors.

Run:

```powershell
pnpm build
```

Expected: static build succeeds and generates the seven expected HTML files plus six public project PNGs.

Run:

```powershell
node --test
```

Expected: every test PASSes with zero failures, skips, or cancellations.

- [ ] **Step 3: Check repository and output privacy**

Run:

```powershell
git status --short --branch
```

Expected: clean `main` branch before writing the acceptance record.

Run:

```powershell
rg -n "\b[0-9]{7}\b|non-public collaborator-name sentinel|under peer review|accepted|in press|published|\bCV\b" src public dist
```

Expected: no matches.

- [ ] **Step 4: Create the acceptance record only after Steps 1–3 pass**

Create `docs/qa/2026-08-11-local-acceptance.md` with exactly:

```markdown
# Local Website Acceptance — 2026-08-11

- Frozen dependency installation: PASS
- Astro and TypeScript check: PASS
- Static production build: PASS
- Node test suite: PASS
- Expected route audit: PASS
- Internal-link audit: PASS
- Semantic and image-alt audit: PASS
- Sensitive-content scan: PASS
- Six evidence images visually reviewed: PASS
- Remote repository created: NO
- Public deployment performed: NO

The local site is ready for Yunxi Wu's factual and visual review. Public GitHub Pages deployment remains a separate approval boundary.
```

- [ ] **Step 5: Commit the verified acceptance record**

```powershell
git add docs/qa/2026-08-11-local-acceptance.md
git commit -m "docs: record local website acceptance"
```

- [ ] **Step 6: Start the local preview and hand it to the user**

Run `pnpm dev` in a retained process, use the exact local URL printed by Astro, and open it once in the app. Keep the development server available while the user reviews About, Projects, all three project pages, Research, and the mobile-width layout manually.

Do not perform remote GitHub operations. Ask the user for factual corrections and visual feedback first.

- [ ] **Step 7: Stop at the public publishing boundary**

After the user approves the finished local site, request:

1. the exact GitHub username;
2. confirmation that the target repository must be named from that verified username using GitHub's user-site naming rule; and
3. explicit approval to create or connect that exact remote, push `main`, and enable GitHub Pages.

Only after those three items are provided should a separate publication action be executed and verified.

---

## Self-Review Checklist for This Plan

- Spec coverage: identity, email, no-CV decision, Times New Roman typography, three routes, three projects, manuscript status, evidence, privacy, accessibility, responsive layout, GitHub Pages workflow, and approval boundary each map to a task.
- Scope: the site is one cohesive static subsystem; no separate sub-project specification is needed.
- Content types: `ProjectListItem`, `EvidenceGallery`, and `ManuscriptEntry` consume the exact collection names and data properties defined in `src/content.config.ts`.
- Route names: tests and page files consistently use `future-ocean-habitat`, `life-support-system`, and `communication-system-modelling`.
- Evidence paths: content records, asset tests, provenance documentation, and final public filenames are identical.
- Status wording: every public implementation uses `Submitted manuscript — Under editorial review` exactly.
- Deployment: `SITE_URL` is injected by GitHub Actions; no GitHub account name is invented or hard-coded.
- Authority: local implementation ends before remote creation, push, or Pages activation.

## Execution Handoff

The plan is complete only after it is reviewed against the approved specification and committed locally. Execution must use one of the sub-skills named in the header and proceed task by task with the stated test and commit gates.
