# Yunxi Wu Academic Website

This repository contains the academic website of Yunxi Wu, a BEng Electronic and Electrical Engineering student at the University of Birmingham.

## Quick start

```bat
启动网站编辑器.bat
```

For normal content changes, start with the local visual editor. Double-click this file in Windows Explorer. The editor opens a local browser session and keeps its command window open while it runs. See [maintenance guidance](docs/maintenance.md) for saving, recovery, image review, and the manual Markdown/YAML route.

## Local development

Manual Markdown/YAML editing is the secondary route. Install the locked dependencies, then run each check separately as needed:

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm build
pnpm test
pnpm dev
```

Project and research records live in `src/content/projects/` and `src/content/research/`. Page routes are in `src/pages/`, shared presentation code is in `src/components/`, `src/layouts/`, and `src/styles/`, and sanitised project evidence images are stored beside their project records. The evidence register is `docs/content-evidence.md`; maintenance guidance is in `docs/maintenance.md`.

## Publishing boundary

This repository is only prepared for GitHub Pages; it has not been published by this local task. Do not create or connect a remote, push, or publish without approval of both the exact GitHub account and its verified `<verified-username>.github.io` user-site repository target.
