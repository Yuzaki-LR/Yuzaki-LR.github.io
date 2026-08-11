# Yunxi Wu Academic Website

This repository contains the academic website of Yunxi Wu, a BEng Electronic and Electrical Engineering student at the University of Birmingham.

## Local development

Install the locked dependencies, then run each check separately as needed:

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm build
pnpm test
pnpm dev
```

Project and research records live in `src/content/projects/` and `src/content/research/`. Page routes are in `src/pages/`, shared presentation code is in `src/components/`, `src/layouts/`, and `src/styles/`, and sanitised project evidence images are in `public/assets/projects/`. The evidence register is `docs/content-evidence.md`; maintenance guidance is in `docs/maintenance.md`.

## Publishing boundary

This repository is only prepared for GitHub Pages; it has not been published by this local task. Do not create or connect a remote, push, or publish without approval of both the exact GitHub account and its verified `<verified-username>.github.io` user-site repository target.
