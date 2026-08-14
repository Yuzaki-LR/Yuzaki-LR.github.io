# Website maintenance

Use the visual editor for ordinary content work. Manual Markdown/YAML editing remains available when it is the more appropriate reviewed workflow.

## Start the local editor

In Windows Explorer, double-click `启动网站编辑器.bat`. It starts the editor locally and opens the browser when it is ready. Keep the command window open while editing; closing it stops the local editor.

## Chinese editor workflow

The editor interface is in Chinese. Review the visible page content, choose the relevant content panel, make one coherent set of changes, and use the editor's save action only after reviewing the draft. The editor changes local files only; it does not publish the website.

## Unsaved drafts

Changes remain a browser draft until a save succeeds. Do not treat a tab refresh, a browser close, or a computer restart as a saved draft. If work must be preserved before resolving a problem, use the draft-backup action and verify that a backup record appears.

## Project types and required records

Create an **individual** project only for an individual detailed design, model, report, or other evidence-backed individual work. It cannot contain a contribution section.

Create a **team** project for team output. It must contain exactly one visible contribution section with non-empty text describing the person's contribution. Do not infer individual authorship or responsibility from a team result. Keep title, summary, role, methods, evidence limits, and outcome wording within verified source evidence.

## Images and privacy review

The editor accepts a still PNG, JPEG, WebP, or TIFF input and stores a metadata-cleaned PNG. Each input is limited to 200 MiB; a draft can hold at most 12 uploads and 400 MiB in total, and each image must be no more than 120 million pixels. Metadata cleaning does not make visible pixels private-safe: a human must inspect the crop, labels, screenshots, and any embedded personal or coursework information before saving.

Hidden content is not private in a public source repository. Never add original coursework PDFs, student numbers, assignment instructions, teammate data, local filesystem paths, an unpublished full manuscript, or inactive social links. Use only public-facing summaries supported by `docs/content-evidence.md`.

## Save safely

Before saving, review the draft, image captions, and claimed ownership. A successful save validates the candidate content and builds the website before promoting the local content and generated output together. Do not edit the same content files manually while an editor save is in progress.

## Resolve conflicts

If content changed outside the editor after the draft began, saving returns a conflict and does not overwrite the disk version. Review the shown differences. You may keep the current draft as a backup, reload the disk version, or explicitly inspect the difference and confirm an overwrite. Do not use overwrite confirmation as a substitute for reviewing the conflict.

## Backups: keep the newest 20

The editor keeps the newest 20 completed backup records for its own save, draft-archive, and restore operations. The editor, not a manual deletion step, owns removal of older editor backups. A backup is local recovery material, not a publication or Git history replacement.

## Restore a backup

Open the backup panel, inspect the saved difference, and use its one-time restore confirmation only for the selected backup. Restore writes local content and generated output through the same protected process, then reloads the editor. Review the restored website and rerun the full verification before any later handoff.

## Manual Markdown and YAML editing

Direct editing is secondary to the visual editor. Site-wide data is in `src/content/site.yml`; project records are Markdown files under `src/content/projects/`; research records are Markdown files under `src/content/research/`; and the About content is in `src/content/pages/about.md`.

Project and research Markdown use YAML front matter followed by `##` sections. Keep editor marker comments, section identifiers, block identifiers, and `kind` values intact. Use ordinary Markdown for paragraphs, lists, tables, and image blocks. For a project image, use the generated local form `![Alt text](./images/file.png)` and keep a caption beneath it. Individual projects have no contribution section; team projects have exactly one protected contribution section.

## Portable runtime boundary

The launcher uses a compatible local Node.js runtime. If it cannot find one, it reports the problem and stops. It never downloads software, installs system software, or silently changes the system `PATH`. A portable runtime, when supplied by a maintainer, belongs under `.local-editor/tools/node` and is separate from normal system software.

## Run the full verification

Run the complete check after manual edits, a restore, or a significant editor save:

```sh
pnpm test
```

For a fresh dependency install, use `pnpm install --frozen-lockfile` first. Review the rendered pages and image captions after the checks finish.

## Publication remains a separate approval

Content approval, a local editor save, a backup restore, and passing tests do not approve publication. Creating or connecting a remote, pushing, enabling GitHub Pages, or making the site public requires separate human approval for the exact verified GitHub account and repository.

For a future GitHub user site, first verify the account name and use the repository name `<verified-username>.github.io`. In the repository, a human must then select **Settings > Pages > Build and deployment > Source > GitHub Actions**. Do not configure a project-site subpath.
