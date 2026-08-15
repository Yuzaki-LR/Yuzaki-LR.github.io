# Editor Redesign Local Acceptance — 2026-08-15

## Result and scope

- Result: **PASS**.
- Accepted implementation commit: `6ae89bdb4c2e210525979f5d1a072eda75b1a7ad`.
- Branch: `feature/yunxi-academic-website`.
- Working tree and index before this record: clean.
- Remote count: 0.
- Push: not performed.
- Deployment: not performed.
- Publication settings: not changed.
- This is a local acceptance only. Public hosting remains a separate approval boundary.

The accepted implementation includes the Task 13 baseline, isolated Astro test fixtures, the public favicon correction, sentinel-owned editor screenshot evidence, and the reviewed editor-managed content normalization. No factual profile, project, research, image, or manuscript-status value changed during final normalization.

## Runtime and reproducibility boundary

- Operating environment: Windows linked worktree.
- Project-managed Node.js: `v24.14.0`.
- Corepack: `0.34.6`.
- Corepack-managed pnpm: `11.16.0` (`packageManager: pnpm@11.16.0`).
- Astro: `7.2.0`.
- Git: `2.53.0.windows.3`.
- Frozen dependency installation: PASS; dependency state was already current.
- `package.json` SHA-256 before/after install: `5295bef28b1bc727ff7b98766bd314b86451509801af77d45984f2c5899018ff`.
- `pnpm-lock.yaml` SHA-256 before/after install: `dbff52a119512c677b4eb136af23559eb327f0aabaaadab2bc2f09dc0db19e78`.

## Independent machine gates

All commands ran separately at accepted implementation commit `6ae89bdb4c2e210525979f5d1a072eda75b1a7ad`.

| Command | Verified result |
| --- | --- |
| `pnpm check` | PASS; 92 files, 0 errors, 0 warnings, 0 hints |
| `pnpm build` | PASS; 7 HTML pages, 3 project-detail pages, 6 dynamic project PNG routes, 16 output files |
| `node --test test/*.test.mjs` | PASS; 144/144, 0 failed/cancelled/skipped/todo |
| `node --test editor/test/*.test.mjs` | PASS; 263/263, 0 failed/cancelled/skipped/todo |
| `pnpm test` | PASS; check 92 files with 0 diagnostics, build 7 pages, Node 407/407 with 0 failed/cancelled/skipped/todo |
| `git diff --check` | PASS; empty output |

## Privacy, evidence, and immutable sources

- Repository and generated-output privacy gates: PASS.
- Git-tracked inventory at the pre-record gate: 140 files.
- Untracked source/document/archive material: 0.
- Raw public document/archive material: 0.
- Generated editor/runtime/session/backup/restore leak matches: 0.
- Generated private-identifier, local-path, unsupported-status, and visible `Fig.` caption-prefix matches: 0.
- Intentional limitation: `editor/test/fixtures/corrupt.tif` is a tracked malformed-upload rejection fixture. It is test-only, classified by the privacy gate, and is not public evidence or generated output.

The six register-bound public PNGs were checked byte-for-byte against generated output and inspected at original detail:

| Evidence image | Dimensions | SHA-256 |
| --- | ---: | --- |
| Bus control | 902×618 | `61950303bb3af88908ef84595761af7e745f7bdf1035f262e573b2dccf4863e3` |
| Environmental regulation | 902×1142 | `e12b1e0e6f9174652195f28677dcc9943947c87e53efaa0df61243e5f914fc03` |
| MSE/BER | 9144×4096 | `d6071a4688c70476e68f2efe850fbd5cb50ebee18bed0a24be12aa3c75c65359` |
| Median-window sensitivity | 9508×4204 | `bbbefde2fd2b1b95901ad6fa2cd98315fced6216f03de98e46417d03bf8ae1c7` |
| OTEC convergence | 676×546 | `7d8eb12068406c6e91d5ab5117d46d81ec4b7e35168c39e5cb6beb43231cdcae` |
| UDC thermal loops | 882×566 | `9028f53a771633087e74b79549fe08ed13465aa0616b9dee27eeb31c9f6727e3` |

Axes, legends, panel labels, intended blocks, and intended borders were readable. No visible report caption, page header/footer, private identity, adjacent report prose, or unintended product icon was present.

Four external Task 5 sources were opened read-only for hashing. Their accepted hashes and sizes remained exact:

| Source class | Bytes | SHA-256 |
| --- | ---: | --- |
| Life-support report | 59012464 | `41b35e0e94cc99f3746ab2e28ea40ea666bf145a0476d81dfbf1516259b6d88e` |
| Future-ocean-habitat report | 220287611 | `067b771550e1965627a869dd328ef47608d5cdb9793a07a227fa9381e7597d06` |
| MSE/BER TIFF | 2,595,776 | `1dc90fbce1358db650b3e46660dbdc154539ea20e250570e326038a2b1046cfb` |
| Window-sensitivity TIFF | 2,377,302 | `b82db76d39a576d88063d3c70605b75236061d93d3078e32a89c03b3eeaa28e5` |

One historical source-binding record contains an unescaped backslash and cannot be parsed directly as JSON. Acceptance extracted only its four quoted source strings read-only and normalized them in memory for hashing; the record itself was not changed.

## Public-site real-browser acceptance

Real Chromium inspected all 7 canonical routes at all 3 required viewports, for 21/21 completed observations:

- Viewports: 375×812, 768×900, and 1280×900.
- Routes: `/`, `/projects/`, `/research/`, all 3 project-detail routes, and `/404.html`.
- Console errors/warnings: 0.
- Page exceptions: 0.
- Network loading failures: 0.
- Unexpected HTTP responses: 0.
- Dedicated browser profile present after cleanup: no.

The 21 screenshots were inspected. Verified behavior included Times-led body typography, semantic headings, visible first-Tab focus, no horizontal overflow, correct individual/team ownership, readable images and full-size links, collapse of absent optional fields, no internal editor identifiers, no visible `Fig.` prefixes, and exact manuscript status `Submitted manuscript — Under editorial review`.

The direct browser run initially exposed a missing favicon request. A base-aware emitted SVG favicon received a focused RED/GREEN fix and real-browser recheck before the complete 21-observation run. The audit harness also learned to decode below-fold lazy images and to use the exact protected heading `My Role and Contribution`; these changes strengthened observation without relaxing product assertions.

## Editor real-browser acceptance

- Real Chromium, launcher, read, and upload matrix: PASS; 47/47, 0 failed/cancelled/skipped/todo.
- Draft-store and preview-contract matrix: PASS; 27/27, 0 failed/cancelled/skipped/todo.
- Real double-click launcher selected the project-managed runtime, emitted one ready URL, bound loopback only, and closed its process tree and listener.
- Chinese navigation and editor surfaces: profile, homepage, research, projects, appearance, and backups verified.
- Preview selection and all three preview viewport modes verified.
- Individual/team templates and protected `My Role and Contribution` behavior verified.
- Block copy, hide, remove, reorder, stable IDs, safe preview, and supported block types verified.
- Image import, replacement, removal, preview revocation, English alt/caption controls, and privacy warning verified.
- Unsaved navigation warning and in-memory-only editing verified.
- Failed build preserved source and generated bytes and exposed only the Chinese public error.
- External edit produced the three conflict choices; stale draft archive preserved canonical bytes.
- Successful copied-fixture save, backup diff, confirmed restore, and restart recovery verified.

All destructive matrix behavior ran only against copied sentinel workspaces. A discovered historical screenshot path outside the sentinel boundary received a focused RED/GREEN correction; the final 47-test matrix proved screenshot evidence is owned and removed by its sentinel workspace. Historical evidence bytes and their pre-fix timestamp were restored exactly.

## Approved canonical save

The separately approved final canonical save used the authenticated local editor transaction path.

- Operation ID: `20260815T021307Z-0001`.
- Result manifest hash: `f263db148371f409896156e80550dfc542c67ff4dd00da969b7695d8000112ad`.
- Durable backup record: present.
- Operation lock after completion: absent.
- Structured bootstrap content and image descriptors before/after: identical.
- `public` bytes before/after: identical.
- `dist` bytes before/after: identical.

The no-edit preflight correctly found that the editor serializers would normalize five tracked text files. Human approval was obtained before promotion. Review confirmed only YAML/frontmatter quoting, folding, and list formatting changed in the three project records, the research record, and `site.yml`; no semantic value changed. Those bytes were committed separately as `6ae89bdb4c2e210525979f5d1a072eda75b1a7ad` before acceptance gates were rerun.

## Environment recoveries and final cleanup

- Initial sandbox attempts to update Astro-generated local cache files were denied; the same commands passed with approved project-local write permission.
- App-managed browser discovery had no available binding. Three wrapper strategies failed before child creation because of Windows process permission or command-transport quoting/module boundaries. The accepted browser run used the project-managed Astro preview and local Chromium CDP lifecycle directly.
- A first browser console failure was traced to an implicit missing favicon request and corrected with an owning behavior test.
- The first editor acceptance matrix exposed an out-of-sentinel historical screenshot destination; its owning test now writes only inside the sentinel workspace.
- The first canonical-save preflight stopped before `/api/save` because serializer normalization required explicit approval; no canonical byte changed during that stopped attempt.
- Final project-owned Node/Chromium/cmd process count: 0.
- Final watched listener count: 0.
- Final operation/build lock count: 0.
- Retained historical sentinel fixture: untouched.

## Publication boundary

- Remote count: 0.
- Remote created: no.
- Push: not performed.
- Deployment: not performed.
- Publication settings changed: no.

The editor redesign is accepted for local use at the exact implementation commit above. Any remote creation, push, hosting enablement, deployment, or publication remains separately authorized work.
