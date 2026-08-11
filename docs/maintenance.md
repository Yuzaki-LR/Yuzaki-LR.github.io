# Website maintenance

## Update or add a project

1. Update an existing record or add a Markdown record under `src/content/projects/`. Keep every overview, role, contribution, method, result, and reflection statement within the boundaries of verified source evidence. Do not infer individual contributions from a group outcome.
2. Add at least two sanitised evidence images for each new project under `public/assets/projects/`. Update `docs/content-evidence.md` with the source boundary and sanitisation record for every added image.
3. Re-crop and review every evidence image before use. Confirm that the final crop communicates the intended evidence while excluding private, irrelevant, or unsupported material.
4. Run the frozen install, checks, build, and tests documented in the README, then review the rendered project page and its image captions.

## Research status

The only currently verified manuscript status is `Submitted manuscript — Under editorial review`. Do not replace it with accepted, published, in press, peer-reviewed, or any other stronger status unless new evidence has been verified and the content boundary has been approved.

## Privacy and evidence rules

Never add original coursework PDFs, student numbers, assignment instructions, teammate data, local filesystem paths, an unpublished full manuscript, or inactive social links. Use only sanitised excerpts and public-facing summaries supported by the evidence register. Do not add a CV link or claim.

## Publishing remains separate

Content approval does not approve publication. Creating or connecting a remote, pushing, enabling GitHub Pages, or making the site public remains a separate human approval boundary tied to an exact verified GitHub account and repository.

For a future GitHub user site, first verify the account name and use the repository name `<verified-username>.github.io`. In the repository, a human must then select **Settings > Pages > Build and deployment > Source > GitHub Actions**. Do not configure a project-site subpath.

The deployment workflow currently follows verified major tags for its GitHub Actions dependencies. During maintenance, verify new upstream releases before updating those tags; for stronger supply-chain immutability, consider pinning reviewed releases to immutable commit SHAs. This local preparation did not enable dependency or security automation.
