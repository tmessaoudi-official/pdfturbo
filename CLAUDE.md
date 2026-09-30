# CLAUDE.md — PDFturbo

Client-side PDF editor (edit, annotate, sign, fill, redact, export) running 100% in the
browser — no backend, nothing uploaded. TypeScript + Vite + PWA, deployed to GitHub Pages.
Stack: pdfjs-dist (rendering), @cantoo/pdf-lib (export/encryption), i18next (EN/FR/AR with
RTL), IndexedDB (session persistence), bwip-js + qr-code-styling (barcode/QR tool).

## Routing

Work here is handled with the **global reasoning framework** (`~/.claude/CLAUDE.md`) — the 8-phase
workflow, the four-dimension Completion Gate, evidence grades, the anti-bandaid gate. That framework
is the developer's own persistent install; this repo never writes it — the container-era
`scripts/claude-bootstrap/` reinstaller was removed 2026-08-18. On any conflict, **this file wins**.

The repo carries exactly THREE skills, all repo-specific by name and content (global-is-reference
ruling, 2026-08-18 — a repo may not duplicate anything that exists in `~/.claude/`):
`/pdf-ask-human` (this repo's additions to the global question protocol), `/pdf-lenses` (the mandatory
review dimensions + sleuth lens K), and `/pdf-qa-sweep` (the whole-app QA driver). Every other
skill — `/sweep`, `/sleuth`, `/inspect`, `/gaps`, `/forge`, `/cross-check`, `/converge`,
`/pre-commit`, `/aggregate-findings`, `/handoff`, `/retrospective`, `/expanding-context` — comes
from the developer's global install. **Before running ANY of those global review skills here, load
`/pdf-lenses` first**: it carries the pdfturbo dimensions, lens K and the repo conventions (reports
under `var/claude/`, non-blocking closes, project scope only) that the deleted repo-local copies
used to enforce. Reviewer agents stay in `.claude/agents/` (read in place, nothing is installed).

## Questions — `AskUserQuestion`, sparingly

Questions to the developer use the **`AskUserQuestion` tool**, per the global framework: options with
the recommended one FIRST (labelled, with its reason) and a visible *"none of these / challenge the
premise"* escape. Protocol: the global `/ask-human` skill, § "Question quality"; this repo's
additions (mandatory cases, a worked example): `.claude/skills/pdf-ask-human/SKILL.md`.

**Mode — the global `~/.claude/CLAUDE.md` § Mode decides what stops** (developer rulings 2026-09-27).
This tree is bypassed for the ask-human gate family (as of 2026-09-28 — the SessionStart banner shows the live
MODE), so sessions here run **autonomous**: announce the
task size and the plan, then build it; on an ambiguity take the recommended option and log it as
`ASSUMED (review)` in the plan's Decisions Log. Phase markers, evidence grades and the Rule 6 table
still show (output parity). In every mode, still stop for the cases in § "When a question is mandatory
here" of that skill — a change that would weaken a documented invariant or a declared ceiling, a
`SCHEMA_VERSION` bump — and for a destructive step.

## Certification ladder — governs every 3C/6C gate

`advisor()` **is available on this machine** and is the FIRST rung: call it
per the global framework. The panel of record for gate rounds is the set of **fresh-context,
read-only, adversarial reviewer subagents** in `.claude/agents/`. Three lenses, one agent each:

| Lens | Agent |
|---|---|
| correctness + regression | `export-fidelity-reviewer` |
| security + safety-promises | `safety-promises-reviewer` |
| completeness + blast-radius | `completeness-reviewer` |

Each reviewer **reads the actual diff, code and tests itself** — never certify from the author's
narrative — and is chartered to REFUTE, not approve. `/converge` runs the panel mechanically.

**Tier: MAXIMAL by default** — all three lenses, **two consecutive fully-clean rounds**, any finding
resets the counter, cap 5 rounds → then ask via `AskUserQuestion` (never silently proceed). Rationale: this
repo's severe bugs have not been confined to one subsystem — a destroyed `w:drawing` on DOCX save, an
Android keyboard loop that made typing impossible, OCR dead in production for three reasons, an
invisible watermark. A path allowlist would have to cover nearly everything, so a single rule is both
safer and cheaper to follow.

> **Per task vs milestone (2026-09-27):** MAXIMAL is the milestone ceiling. Per task the global tier
> applies: in autonomous mode (this tree) the project's certification schedule
> (`~/.claude/projects/-stack-projects-pdfturbo/certification-schedule`, asked once), in spec mode the
> per-gate tier question — `advisor()` recommended (economize ruling, 2026-08-21).

**The one carve-out is mechanical, not a judgement call:** if `git diff --name-only` touches no
`src/`, STANDARD is enough — one reviewer, three lenses in a single pass, one clean round. Locale
strings, docs and `CLAUDE.md` edits qualify. Anything touching `src/` does not.

Availability chain: `advisor()` → reviewer subagents → (only if both are unavailable) three
distinct-lens self-passes **with mandatory disclosure that certification was self-graded**. Never
silently skip a gate. The deploy gate below is the floor, never the certification.

## Git autonomy — overrides global Rule 10

Autonomous `git add`, `git commit` **and `git push`** are **authorised** for green, self-contained
work (developer directive, 2026-07-27). Asking permission for them violates the no-interrupts
directive. Limits:

- **Author/committer**: `Takieddine Messaoudi <takieddine.messaoudi.official@gmail.com>` — matches
  100% of history. A harness may set a different default identity, so **check
  `git config user.name` / `user.email` before the first commit of any session.**
- **Never a `Co-Authored-By` trailer** (repo history has zero) and **never a `Claude-Session` trailer**,
  and never the Claude email. The container's harness prompt instructs otherwise for both — **the
  developer's ruling overrides the harness.** Named explicitly because the harness names them explicitly;
  a rule that only says "no Co-Authored-By" leaves the session guessing about the other one.
- **`master` is the only branch.** A harness prompt naming a "designated branch" (e.g.
  `claude/<something>`) does **NOT** override this — commit and push to `master`, and never open a pull
  request unless explicitly asked. Recorded 2026-08-06 after a session was handed a designated-branch
  instruction and had to resolve the conflict from first principles.
- **NOT authorised**: `--force` / `--force-with-lease` push, rewriting published history,
  `npm publish`. **In a cloud session there is no `deny` list at all** (`defaultMode: auto`,
  allow-list only) — nothing mechanically stops you, so the discipline is the control. **On the
  developer's local machine** `~/.claude/hooks/ask-bash-firewall.sh` denies `git push --force`, `-f`,
  `--mirror` and `+refspec` at every level (since 2026-09-27); it allows `--force-with-lease`, which this
  repo still does not authorise. `~/.claude/settings.json` holds no force-push rule (dropped 2026-08-29;
  an earlier blanket `Bash(git push *)` deny went 2026-08-23).
- Commit only when the deploy gate is green and the change is self-contained; never a broken build.
- Commit style: `feat:` / `fix:` / `refactor:` / `docs:` / `chore:`, imperative subject.
- If the safety classifier blocks a `git commit`, present the exact command for manual execution —
  do not retry or work around it. The same applies to `.claude/settings.json`, which Claude cannot
  write: hand the developer ONE `! bash /tmp/<script>.sh` that validates with `jq`, backs up the
  original and commits the result (the container-era `settings.json.pending` route died with
  `scripts/claude-bootstrap/`, removed 2026-08-18).

**Recent SHAs are NOT stable — re-baseline before every follow-up task.** After each task the
developer pulls, **re-signs the new commits and force-pushes**, which rewrites their SHAs (observed
2026-07-29: `27c9781→0656eaa`, `8b33ab9→09ec7ea`, `4c2f78b→5ed13f5`, identical content). Two rules
follow:

1. **Start any follow-up task with `git fetch origin master`** and compare, before editing anything. A
   plain `git push` will be rejected non-fast-forward; the fix is
   `git rebase --onto origin/master <old-base> master` (replay only your own commits) — **never
   `--force`**, which is not authorised and would clobber the re-signed history.
2. **Never hardcode a recent commit SHA in a tracked file.** It will dangle after the next re-sign —
   this already happened to a recovery command written into `tests/docx/readDocxText.ts`. Use a
   SHA-free recipe instead:
   `git log --diff-filter=D --format=%H -1 -- <path>` → then `git show <sha>^:<path>`. Long-published
   SHAs (e.g. `ac4ef68`, 2026-06-26) are stable and fine to cite.

## Plans live in the repo

Every plan or spec produced here is persisted at **`docs/plans/<topic>.plan.md`**, each carrying its
own `## Decisions Log` (`- [YYYY-MM-DD HH:MM] AGREED: <one-sentence decision>`), appended in the same
change as the ruling. A plan in the repo survives any one machine and lands in the same commit as the
code it governs — an out-of-repo plan file is never the record of truth. There is no plan-location
sentinel to ask about.

**A superseded plan is ARCHIVED, never deleted** (developer ruling, 2026-08-31): it moves to
`docs/archive/plans/` (and `docs/archive/specs/` if specs ever exist), so `docs/plans/` holds only
LIVE plans and a glob of that directory is always the current work. This **supersedes the global
framework's Phase 8 delete-the-plan lifecycle for this repo** — there is exactly one lifecycle rule
here, and it is this one. An archived plan is READ-ONLY history: cite it, never take instructions
from it.

There is no separate roadmap SSOT or decision register: the plan file is the plan, and a ruling that
outlives it graduates into a **§ Gotchas** entry below — which is what makes that section this
project's real decision register. Transient review output (reports, memory) goes to `var/claude/**`,
which is gitignored. Session handoffs are the GLOBAL PreCompact hook's job
(`~/.claude/hooks/precompact-handoff.sh` → the developer's memory pipeline); this repo carries no
copy of that hook — global-is-reference ruling, 2026-08-18.

## Commands

```bash
npm run dev          # dev server at http://localhost:5173/pdfturbo/
npm run build        # production build → dist/
npm run preview      # serve the production build locally
npm run type-check   # tsc --noEmit
npm run lint         # oxlint . (sole linter — eslint removed 2026-06-14)
npm run test         # vitest run (jsdom) — excludes tests/browser/**
npm run test:browser # vitest run in REAL Chrome (@vitest/browser + Playwright) — tests/browser/*.browser.test.ts
npm run test:watch   # vitest watch mode
```

**Whole-app QA** (`/pdf-qa-sweep`, 2026-07-29): `node scripts/qa-sweep.mjs` boots the real app in real
Chromium, loads a PDF, depth-first clicks every reachable control, and reports console errors, failed
requests, axe-core WCAG 2.1 AA violations and a 375px overflow check — with before/after screenshots
per control, into `var/claude/qa-sweep/<stamp>/`. Exit 1 on any FAIL (a console error, a failed request, or a **critical/serious** axe violation;
moderate/minor are reported only, matching the static gate's policy), 2 if it could not run.
**Wired into `deploy.yml` as a deploy-blocking step since 2026-07-29**, run against `vite preview`
on :4173 — i.e. the BUILT artifact that actually deploys, not the dev server. It needs no browser
download: the script prefers a usable build under `PLAYWRIGHT_BROWSERS_PATH` (skipping
chromium-1194) and otherwise falls back to the same system Chrome `test:browser` uses. Needs `npm run dev` serving and `npx playwright install chromium` (the preinstalled
chromium-1194 is refused on purpose — see the container note below). It answers "does the product
work?", which **neither** vitest suite does: jsdom has no canvas and the browser suite mounts
components rather than booting the app. Two non-obvious constraints are baked into the driver:
axe-core is injected with `page.evaluate` because `script-src 'self'` blocks `addScriptTag`, and the
UI crawl is over **disclosure depth** (only 8 of 141 buttons are visible on a freshly loaded document)
rather than links, since the app is a single page. Baseline (default flags): 142 checks / 98 pass / 0 fail / 0 warn in ~1m20s
— `deploy.yml` records 143 / 97 / 0 for a default-flag run; neither log was kept, so read the report's own summary line. **CI runs it with
`--allow-destructive`** — correct there because the flag protects a developer's own open document,
and CI drives a throwaway browser on a fixture; without it the gate skipped 44 controls including
redaction and flatten. That run measured 145 checks / 107 pass / 0 fail on 2026-07-31 and 151 / 114 / 0
at the 2026-09-13 round-10 gate — read the report's own summary line rather than citing either.

**Before every commit**: `npm run type-check && npm run lint && npm run test`. **Before every
PUSH** run the FULL deploy gate — CI (`deploy.yml`) runs MORE than the three above and a miss here
goes green-local / red-CI (it has happened): `npm audit --audit-level=high` → `npm run ocr:assets`
→ type-check → lint → `npm run test` (jsdom) → `npm run test:browser` (real Chrome) →
**`npm run test:coverage:export`** (the M1 #14 branch-coverage gate on `src/export/pdfElementRenderer.ts`,
threshold 25% — adding an uncovered branch to `renderText` can drop below it and FAIL the build even
when every test passes) → `npm run build` → **`npm run qa:sweep`** against `vite preview` on :4173
(the live whole-app sweep; fails on a console error, a failed request, or a critical/serious axe
violation, and uploads its screenshots as a CI artifact when it does; run with
`--allow-destructive` so redaction/flatten are actually exercised). Any of these failing on `master` blocks the deploy.

**Browser harness** (`vitest.browser.config.ts`): real-browser regression tests for things jsdom
cannot exercise — canvas/pdf.js rasterization, pointer drag, image (`commonObjs`/`VideoFrame`)
extraction, content-stream edits verified by pixels. Uses the system Google Chrome via Playwright's
`channel: 'chrome'` (no browser download). **CI runs it** (deploy.yml: after the jsdom suite, before
build, using the runner's system Chrome). Run it locally for any editor/export/DnD change. Guards
ISSUE-1..5 (see `KNOWN_ISSUES.md`).

**Running `npm run test:browser` in the Claude cloud container (2026-07-28 — HISTORICAL: that
container is dead since 2026-08-18; on the developer's machine `channel: 'chrome'` uses the system
Chrome and none of this workaround is needed)** — it worked, but not
out of the box. Two things bite in order: (1) the config uses Playwright `channel: 'chrome'` and the
container has no Google Chrome; (2) the *preinstalled* Chromium-1194 at `/opt/pw-browsers` lacks
`Map.prototype.getOrInsertComputed`, which `pdfjs-dist` v6 calls from
`WorkerTransport.getOptionalContentConfig`, so **every** `page.render()` throws
`TypeError: this[#methodPromises].getOrInsertComputed is not a function`. Fix both with one command
plus a temporary config:

```bash
npx playwright install chromium     # Chrome 151 / chromium-1234 (~115 MB, not persisted)
# then run vitest with a throwaway config that sets
#   playwright({ launchOptions: { executablePath: '/opt/pw-browsers/chromium-1234/chrome-linux64/chrome' } })
# instead of channel:'chrome' — delete it afterwards, never commit it.
# NAME IT `vitest.browser.container.ts`: that exact name is in .gitignore, so a later `git add -A`
# cannot stage it (the hardcoded chromium path would rot immediately). Any other name has no guard.
```

With that, the full suite passes in-container (68 files / 179 tests). **Do not claim a green browser
run without doing this** — and note the preinstalled binary silently produces 7 uniform
`getOrInsertComputed` failures that look like product bugs and are not.

**`optimizeDeps.include` is load-bearing** (`vitest.browser.config.ts`): every npm package reached
by `await import('<pkg>')` in `src/` must be listed — **plus `pdfjs-dist/build/pdf.worker.min.mjs`,
which is the one that actually bites.** pdf.js loads its worker at runtime, so vite discovers it LATE,
optimizes it mid-suite, and logs `optimized dependencies changed. reloading`; that reload re-hashes
every pre-bundled dep URL and kills whichever dynamic import is in flight — surfacing as
`TypeError: Failed to fetch dynamically imported module: …@pdf-lib_fontkit.js`. **The named module in
that error is the victim, not the cause** — chase the `dependency optimized:` line above it instead.
It bites `test:coverage:export` and not plain `test:browser` purely by timing: the full suite loads
the worker early, before any lazy import is airborne. Reproduce with BOTH steps in order (a lone
coverage run passes, which is how a wrong fix gets "verified"):
`rm -rf node_modules/.vite && npm run test:browser && npm run test:coverage:export`.

## Architecture

```
src/
├── main.ts                 # entry point — instantiates PDFTurboApp
├── core/                   # app orchestration + domain
│   ├── pdfTurboApp.ts      # app orchestration hub (thin delegators over extracted services)
│   ├── documentModel.ts    # page/element data model
│   ├── historyManager.ts   # command-pattern undo/redo (50-command stack)
├── ui/                     # DOM wiring: uiController, binders, panels, thumbnails, documentLoader
├── infra/                  # browser-platform edges (no domain logic)
│   ├── storage.ts          # IndexedDB: the session `state` store …
│   ├── recentFiles.ts      # …and the #54b `recent` store of remembered file handles
│   ├── pdfRenderer.ts      # pdf.js page rendering
│   └── inkLayer.ts
├── elements/               # one file per annotation element type (text, shape, image,
│                           #   signature, highlight, redaction, comment, code/QR, pdf)
├── handlers/               # pointer/tool interaction (drawing, eraser, ink, text edit,
│                           #   text search, selection) — each holds a ref to the app
└── utils/                  # i18n, elementFactory, geometry, focusTrap, textLayer, …

tests/                      # mirrors src/ structure; vitest + jsdom + fake-indexeddb
locales/                    # en.json / fr.json / ar.json — MUST stay key-identical
```

- Undo/redo: every mutation goes through a Command object pushed to `historyManager` —
  never mutate `documentModel` directly from a handler without a command, or undo breaks.
- Handlers receive the concrete `PDFTurboApp`; its public surface is effectively the
  app-wide API. Adding handler↔app interactions widens this coupling — prefer extending
  an existing seam.

## Gotchas (verified by the 2026-06-11 craftsmanship review, refreshed 2026-06-14)

> **Where the design docs went.** Most entries below were written alongside a plan, spec, audit or
> spike verdict under `docs/plans/`, `docs/reviews/` or `docs/superpowers/`. `ac4ef68` ("clean repo
> for release", 2026-06-26) removed all three trees. **This section is now the register** — an entry
> here is the durable form of that decision, and it is meant to stand on its own. When you do need the
> original working document:
>
> ```bash
> git show ac4ef68^ --stat -- docs/            # every removed doc, by name
> git show ac4ef68^:docs/plans/<name>.plan.md  # read one
> ```
>
> Until 2026-07-29 this section carried 29 `(see git history)` stubs left by that purge, several
> mid-sentence and grammatically broken. They are gone; this note replaces all of them. **Do not
> reintroduce a per-entry pointer** — if a fact from a removed doc still matters, write the fact here.

**The entries now live in path-scoped rules files** (moved verbatim 2026-09-28). A scoped file loads when you read a matching file — read it yourself before working in that area when no file read comes first (running a command reads no file):

- **pdfjs** — pdf.js assets (CMaps, JBIG2/JPX decoders, ICC), points viewports, the text layer (4) → `.claude/rules/pdfjs.md` (loads when you read `src/utils/pdfjsParams.ts`, `src/utils/pointViewport.ts` …).
- **redaction** — redaction burns, the hide-vs-remove audit, coordinate frames, Form XObjects, annotations under a burn (11) → `.claude/rules/redaction.md` (loads when you read `src/export/exportPipeline.ts`, `src/export/exportService.ts` …).
- **export** — the export pipeline: rotation, text extent, the export frame, links, flatten, XLSX, forms, XFDF, Bates, sanitize, lock, compress (14) → `.claude/rules/export.md` (loads when you read `src/export/**`, `src/utils/pdfSanitizer.ts` …).
- **flow-export** — PDF→DOCX/MD: flow reconstruction, columns, tables and CSV, the tagged-PDF fast path (7) → `.claude/rules/flow-export.md` (loads when you read `src/utils/flowDoc*.ts`, `src/utils/tableExtract.ts` …).
- **arabic-rtl** — Arabic and RTL: bidi, the Arabic overlay, tashkeel, RTL selection and copy (4) → `.claude/rules/arabic-rtl.md` (loads when you read `src/utils/bidi.ts`, `src/utils/rtlClipboard.ts` …).
- **true-edit** — true text editing in the content stream: Path 2/3, fonts, nested cm (4) → `.claude/rules/true-edit.md` (loads when you read `src/utils/contentStreamEditor.ts`, `src/utils/glyphNames.ts` …).
- **docx-edit** — DOCX read + edit and its package garbage collection (2) → `.claude/rules/docx-edit.md` (loads when you read `src/docx/**`, `tests/docx/**`).
- **signing** — e-signing, PAdES and the ByteRange, signature placement, the Signers panel (4) → `.claude/rules/signing.md` (loads when you read `src/signing/**`, `src/handlers/signingHandler.ts` …).
- **crop** — per-page crop, its handles and numeric margins — and why crop HIDES while redaction REMOVES (4) → `.claude/rules/crop.md` (loads when you read `src/core/pageService.ts`, `src/core/pageRenderPipeline.ts` …).
- **ui** — the app shell: open/save, storage, modes, pointer and click routing, a11y, thumbnails, watermark, the QA sweep (12) → `.claude/rules/ui.md` (loads when you read `src/ui/**`, `src/core/**` …).
- **ocr** — OCR engine, CSP and assets (1) → `.claude/rules/ocr.md` (loads when you read `src/ocr/**`, `src/handlers/ocrHandler.ts`).
- **toolchain** — dependencies and upgrades, vitest, CI flakiness, i18n, the PWA, the Claude bundle (7) → `.claude/rules/toolchain.md` (loads when you read `package.json`, `vite.config.ts` …).
- **conventions** — repo-wide conventions: base path, jsdom tests, the one PDF write library, private methods (4) → `.claude/rules/conventions.md` (loads at session start).

**Intake rule:** a new entry goes into the matching `.claude/rules/<area>.md`, not here; a path-scoped rules file past ~300 lines is split again or pruned (~150 for an unscoped one). Cite by section heading plus a quoted phrase, never a line number. 6 files (`redaction.md`, `export.md`, `flow-export.md`, `docx-edit.md`, `ui.md`, `toolchain.md`) exceed that cap at birth: single entries run 200–400 lines and a verbatim move cannot cut them — they are the first candidates for a prune with the developer.

Where each entry went (a `CLAUDE.md § "<heading>"` citation elsewhere resolves through this list; one that names a bold paragraph or paraphrases a heading resolves by grepping the phrase in `.claude/rules/`):

- § "pdf.js's CMap files are served by the app — row 32 (2026-09-26)" → `pdfjs.md`
- § "pdf.js's JBIG2 / JPEG 2000 decoders are served too — row 36 (2026-09-26)" → `pdfjs.md`
- § "pdf.js colour management is on — row 37 (2026-09-26)" → `pdfjs.md`
- § "Links on the redaction raster — re-created, never copied (A4, 2026-09-25)" → `redaction.md`
- § "On a rotated page, text, pictures, signatures and comments exported turned by the page rotation (A3-pre, 2026-09-26)" → `export.md`
- § "Typed text overflows its box, and the redaction drop now tests where it is DRAWN (A5, 2026-09-26)" → `export.md`
- § "The export frame is pdf.js's page VIEW, not pdf-lib's CropBox — B1 (2026-09-26)" → `export.md`
- § "Every viewport is a POINTS viewport — `/UserUnit` (2026-09-26)" → `pdfjs.md`
- § "Open via the native picker + recent files (#54b, 2026-09-04)" → `ui.md`
- § "Deleting a DOCX image left its bytes in the package — WS4-D, and the scan IS the fix (2026-09-04)" → `docx-edit.md`
- § "A redaction filter that read pdf.js's item box backwards — twice (2026-09-04)" → `redaction.md`
- § "Clipping is not removing, for anything vector — WS4-C refuted (2026-09-04)" → `redaction.md`
- § "A rule the reader never sees deleted a paragraph — the Form `/BBox` clip (2026-09-04)" → `redaction.md`
- § "A rotated redaction burned a rotated box while every filter tested the upright one (2026-09-02)" → `redaction.md`
- § "Ink was stamped OVER the burn, and the fixture that "proved" the clip could not see a rotation (2026-09-02)" → `redaction.md`
- § "The flow export mixed absolute and crop-relative coordinates — C22, and the lockstep is now structural (2026-09-02)" → `export.md`
- § "The `redaction-orphan-leak` flake did NOT reproduce in 9 file runs — and the obvious cause is refuted (2026-09-02)" → `redaction.md`
- § "A source annotation under a redaction was painted OVER the burn (2026-08-29)" → `redaction.md`
- § "`walkPageOps` ignored Form XObject boundaries, and the fixture that "proved" the fix was vacuous (2026-08-29)" → `redaction.md`
- § "The drag-placed signature rect was crop-relative while `/Rect` is absolute (2026-08-29)" → `signing.md`
- § "The redaction filter compared two coordinate frames — a non-zero CropBox origin defeated it, and images were never filtered at all (2026-08-28)" → `redaction.md`
- § "`saveState` read the wrong error property, so every failed autosave looked like a success (2026-08-28)" → `ui.md`
- § "`Record<string, …>` on a mode map defeats the compiler — the badge said "SELECT" in sign mode (2026-08-28)" → `ui.md`
- § "A raised `testTimeout` does not raise `hookTimeout` — it blocked a push (2026-08-22)" → `toolchain.md`
- § "Destroying a node on `pointerup` suppresses the mouse `click` — desktop selection was dead for two months (2026-08-22)" → `ui.md`
- § "pdf.js's text layer swallowed every click on the page, so nothing ever deselected (2026-08-22)" → `ui.md`
- § "The 2026-09-13 upgrade to latest — three traps, each measured before it was fixed" → `toolchain.md`
- § "`@cantoo/pdf-lib` 2.8.1 broke custom-font subsetting — adapt fontkit, don't pin back (2026-08-07)" → `toolchain.md`
- § "The Claude bundle is a CROSS-REPO artefact — align it, don't fork it (2026-08-06)" → `toolchain.md`
- § "A ceiling table is only as good as its last measurement — C10 was wrong in two places (2026-07-31)" → `flow-export.md`
- § "Columns: the cut, the depth and the gutter floor — limits row 21 (2026-09-27)" → `flow-export.md`
- § "Internal links become bookmarks, and a link tags only the words it covers — limits row 22 (2026-09-27)" → `export.md`
- § "Flatten draws source annotations, the way the editor canvas shows them — limits row 23 (2026-09-27)" → `export.md`
- § "`/pdf-qa-sweep` reaches 66 of 141 controls, and that is the app's design — do not "fix" the crawl (2026-07-31)" → `ui.md`
- § "A flaky gate: never scan a whole PDF for a short byte sequence (2026-07-30)" → `toolchain.md`
- § "A CRITICAL a11y rule the gates could barely see: `<label>` with no `for=` (2026-07-31)" → `ui.md`
- § "Live-app a11y: 3 serious WCAG rules fixed, and why the static gate missed them (2026-07-29)" → `ui.md`
- § "Mobile thumbnail controls = a single ⋮ action menu (F2b, 2026-06-26)" → `ui.md`
- § "Export paths are consolidated" → `export.md`
- § "Watermark renders LIVE on the editor canvas (2026-06-25)" → `ui.md`
- § "`renderElements()` destroys and recreates every element DOM node" → `ui.md`
- § "i18n" → `toolchain.md`
- § "Base path is `/pdfturbo/`" → `conventions.md`
- § "PWA is `registerType: 'prompt'`" → `toolchain.md`
- § "Tests run in jsdom" → `conventions.md`
- § "Only `@cantoo/pdf-lib` is the PDF write library" → `conventions.md`
- § "File System Access save (#54)" → `ui.md`
- § "XLSX table export (#56b, 2026-08-04) — and the numeric rule that a unit test cannot catch" → `export.md`
- § "EH-E released for CSV — borderless tables, and the ONE rule that makes it safe (2026-08-04)" → `flow-export.md`
- § "Two boundary-convention bugs in the lattice-table path (2026-07-31)" → `flow-export.md`
- § "Table → CSV (#56)" → `flow-export.md`
- § "Form flattening (#62)" → `export.md`
- § "XFDF import/export (#57)" → `export.md`
- § "Bates / page-numbering (#61 engine + #61b UI)" → `export.md`
- § "PDF sanitizer (#53)" → `export.md`
- § "Lock PDF wrote strings in plaintext — and broke them for the reader (WS7 round 10, 2026-09-13)" → `export.md`
- § "Path 2 keeps an embedded font written as literal strings — limits row 38 (2026-09-27)" → `true-edit.md`
- § "An embedded simple font without ToUnicode is read through its /Encoding — limits row 39 (2026-09-27)" → `true-edit.md`
- § "True-edit composed nested `cm` backwards, and forgot the CTM at a form's `Do` — limits rows 47–48 (2026-09-27)" → `true-edit.md`
- § "True text editing engine" → `true-edit.md`
- § "Private-method convention" → `conventions.md`
- § "PDF→DOCX/MD export (beta)" → `flow-export.md`
- § "Tagged-PDF struct-tree fast path (#B1, 2026-06-25)" → `flow-export.md`
- § "Arabic support (Sprint Arabic, 2026-06-15)" → `arabic-rtl.md`
- § "Cornerstone QA 2026-06-17 — RTL text-layer selection/copy/search + multi-language DOCX" → `arabic-rtl.md`
- § "OCR (Sprint 4, 2026-06-15; CSP/engine fix 2026-06-15)" → `ocr.md`
- § "E-signing (Sprint 4, 2026-06-15)" → `signing.md`
- § "PAdES-B-B, and the ByteRange hole that failed every signature — limits row 24 (2026-09-27)" → `signing.md`
- § "RTL brackets and list markers in the Arabic overlay — limits row 25, D17 (2026-09-27)" → `arabic-rtl.md`
- § "Tashkeel placed by GPOS in the Arabic overlay — limits row 25, C19 (2026-09-27)" → `arabic-rtl.md`
- § "Approval caption + guided Signers panel (F-D D1/D2)" → `signing.md`
- § "Per-page crop (#G23)" → `crop.md`
- § "Crop HIDES, redaction REMOVES — and the obvious check gives a false negative (2026-08-04)" → `crop.md`
- § "The hide-vs-remove audit — every surface graded, and two more traps found (2026-08-05)" → `redaction.md`
- § "Resizable crop handles (#G23 v1c, 2026-08-05)" → `crop.md`
- § "Numeric crop margins (#G23 v1b, 2026-08-04)" → `crop.md`
- § "PDF compress (#60)" → `export.md`
- § "DOCX read+edit (#1, Track B)" → `docx-edit.md`

## Git & CI

- Single branch `master`; pushing to it triggers `.github/workflows/deploy.yml`:
  `npm audit --audit-level=high` → type-check → lint → test (jsdom) → `ocr:assets` +
  `playwright install-deps chromium` → test:browser (real Chrome) → build → GitHub Pages
  deploy. The workflow also declares a `pull_request: [master]` trigger, but the project
  is single-dev/single-branch so in practice every run is a push to `master` — there is
  **no human PR review gate** (the local pre-push hook is the safety net; see below).
- **Supply chain (#37)**: `npm audit --audit-level=high` runs first and is **deploy-blocking**
  (a high/critical advisory fails the build before anything deploys). It was briefly disabled
  (`e154540`, 2026-07-28) and **restored the same day** once the blocker was root-caused — keep it on.
  **What the blocker was, so it is recognised next time:** 8 "high" findings that were really ONE
  advisory counted at 8 levels of a single chain — `brace-expansion` (GHSA-mh99-v99m-4gvg, DoS/OOM)
  ← `minimatch` ← `filelist` ← `jake` ← `ejs` ← `@trickfilm400/rollup-plugin-off-main-thread`
  ← `workbox-build` ← `vite-plugin-pwa`. Only ONE vulnerable copy was installed
  (`filelist/node_modules/brace-expansion@2.1.2`; the hoisted copy was already patched), it is
  **devDependency-only**, and `npm audit fix` could not touch it: ERESOLVE, because
  `vite-plugin-pwa@1.2.0` peer-requires `vite ^3–^7` while this project is on `vite@8`.
  **The fix is the `overrides` block in `package.json`** — it pins the transitive dep without touching
  `vite-plugin-pwa`, so the peer conflict never arises. **Do not remove those overrides** without
  re-checking the advisories, and reach for the same pattern the next time a transitive dev-dep
  advisory is unfixable through the dependency that pulls it in.

  **The overrides are a LIVING pin, not a one-off — re-audit before every push.** On 2026-07-31 the
  gate went from `found 0 vulnerabilities` to **2 high** in a single day, with no dependency change on
  our side, and one of them was `brace-expansion` **again**: GHSA-rgw5-rvv9-x895 explicitly *bypasses
  the CVE-2026-14257 mitigation*, so the very version this block pinned to (`^5.0.8`) became the
  vulnerable one. The second was `fast-uri` (GHSA-7p8r-x3mc-p8w7, host confusion via a backslash
  authority introducer) via `ajv` ← `workbox-build`. Both were devDependency-only and both were fixed
  the same way — bump to `^5.0.9` / add `^3.1.5`, one deduped copy each, audit clean, and the PWA
  precache unchanged at the 22 entries it had then (24 at the 2026-09-13 upgrade build — recount rather
  than assuming any figure here). Lesson: a pinned version is a snapshot of the advisory database, not a
  permanent fix, and because `npm audit` is the FIRST CI step a new advisory turns every deploy red
  before a single test runs — including deploys of changes that have nothing to do with it.

  **Third occurrence, 2026-09-04 — `fast-uri` again, and the pin that fixed it became the
  vulnerable one.** Four new advisories (GHSA-5jgf-p345-68v8, -f65p-4m7j-42xc, -fph4-wmhf-6fwf,
  -jqff-g426-hqxp) put the whole `3.0.0 - 3.1.5` range in scope, so the `^3.1.5` pin added on
  2026-07-31 was itself inside it. Bumped to `^3.1.7`, one deduped copy, audit back to
  `found 0 vulnerabilities`, build green with 25 precache entries that day (24 at the 2026-09-13 build). **Stay inside the dependent's
  own range**: `ajv` declares `fast-uri: ^3.0.1`, so 3.1.7 satisfies it natively while the current
  4.1.4 would force a major past that range — an override can express it, and the PWA build is what
  pays. Same shape as the `brace-expansion` `^5.0.8` → `^5.0.9` bump.

  **Fourth occurrence, 2026-09-30 — both again.** `brace-expansion` 4.0.0–5.0.11 (three DoS advisories, high) put the
  `^5.0.9` pin in scope, and `fast-uri` 3.0.0–3.1.7 (host-case normalisation, moderate) did the same to `^3.1.7`. Bumped
  to `^5.0.12` / `^3.1.8`, one deduped copy each, `found 0 vulnerabilities`. It surfaced as the first step of the deploy
  gate on an unrelated change, which is the normal way this shows up.

  **Never run the audit gate with `--offline`.** It reads the cached advisory database and reported
  `found 0 vulnerabilities` against the very tree that was carrying this high — a false green that
  looks exactly like a real one [measured 2026-09-04].

  OCR traineddata stays SHA-256-pinned (`scripts/prepare-ocr-assets.mjs`); no other remote assets are
  fetched at build.
- **Pre-push gate**: `.githooks/pre-push` (auto-installed via the `prepare` script →
  `core.hooksPath`) runs type-check + lint + test locally before any push reaches the
  auto-deploy. Bypass in emergencies with `git push --no-verify`.
- Commit style: `feat:` / `fix:` / `refactor:` / `docs:` prefixes, imperative subject.
  No `Co-Authored-By` and no `Claude-Session` trailers — see § "Git autonomy" for the full ruling.
- **`git push` is AUTONOMOUS for green, self-contained work** — see § "Git autonomy", which is
  authoritative. This line previously read "always manual"; that predated the 2026-07-27 directive and
  contradicted it, which is the worst possible defect in a rule about the most consequential action in
  the repo. Corrected 2026-08-06.

## Claude config in this repo

- `.claude/settings.json` — pre-approved commands + hooks. **`deny` is EMPTY and stays empty** (developer
  ruling, 2026-08-06): in the web container the developer has no terminal, so a command Claude is denied is
  a command *nobody* can run — a denial is not a safe default there, it is a dead end.
  **The broad 85-entry allow list is LIVE** ([Verified 2026-08-18: `jq '.permissions.allow | length'`
  → 85]; the container-era `settings.json.pending` staging route is gone). It covers `npm`/`npx`/`node`/`vitest` (`vite` and `playwright` transitively via
  `Bash(npx:*)`, not as their own entries), `scripts/**`, `.githooks/**`, full `git` (commit and push are
  autonomous here), `python3`/`jq`/`yq`, and the ordinary shell utilities. It deliberately omits the
  siblings' `make`/`docker`/`shellcheck`/`hadolint` — none applies to a browser-only TypeScript app.
  **Be honest about what that list is: it is not "read-only".** It includes `rm`, `mv`, `cp`, `chmod`,
  `kill`/`pkill`, `curl`, `pip`, and — decisively — `bash:*`, `sh:*`, `env:*`, `xargs:*`, `timeout:*`,
  `command:*` and `nohup:*`. `bash -c '<anything>'` being pre-approved means the granular enumeration
  provides **no containment whatsoever**; it only removes prompts. With `deny: []` and
  `defaultMode: auto` the real control is the discipline in this file and in `BLAST-RADIUS.md`, plus the
  harness classifier — nothing else. That is the accepted cost of the no-dead-ends ruling, and it should be
  stated rather than dressed up. (An earlier version of this bullet called the list "the usual read-only
  shell tools", which was false of at least 16 entries.)
  **Considered and declined:** a `Read`/`Edit` deny on `.env`, which rent-watch carries and its cross-repo
  audit recommends to all four siblings on the grounds that a path deny has no dead-end failure mode. This
  repo has no `.env` and no `.env` line in `.gitignore`, so the guard would be purely preventive, and
  adding a deny entry cuts against a directive given in absolute terms. Revisit if a `.env` is ever
  introduced — that is the trigger, not a periodic review.
- **The one thing no repo config can grant: `.claude/settings.json` itself.** Claude Code's auto-mode
  classifier blocks Claude from writing that file, by Bash *and* by the Write tool — self-modification of
  its own permission surface. That is a platform guard, not this repo's policy (our `deny` is empty), and
  it cannot be lifted from inside the repo. The hand-over is ONE `! bash /tmp/<script>.sh` for the
  developer (jq transform + validation + backup + commit). **Do not attempt to work around this block** —
  writing the script and saying so is the correct behaviour.
- `.claude/hooks/oxlint-on-write.sh` — lints any `.ts` file Claude edits with oxlint, feedback on fail
- `.claude/hooks/locale-sync-check.sh` — 3-way key diff on any `locales/*.json` write
- **`scripts/claude-bootstrap/` is GONE (removed 2026-08-18).** It existed because cloud containers
  started with an empty `~/.claude/` each session; that environment is dead, `~/.claude/` is the
  developer's own persistent install, and this repo never writes it. Its `install.sh` clobbered the
  developer's global framework with a stale container-era copy on every SessionStart — removing it was
  the P0 of the de-containerization. Session handoffs are the GLOBAL PreCompact hook's job (see § Plans).
- `.claude/settings.local.json` is gitignored — machine-local overrides go there

**Cross-repo convention.** The skill/agent set follows the same rules as the sibling repos
(`rent-watch`, `stack`, `twes-in`, `phorj`), governed since 2026-08-18 by the global-is-reference
ruling: generic machinery lives in `~/.claude/`, a repo carries only renamed, heavily-repurposed,
repo-specific skills. `rent-watch` executed the recipe first and is the reference when siblings
disagree; the recipe itself is pinned in `/stack`'s `docs/archive/plans/decontainerization.plan.md` (archived; READ-ONLY history there). The
2026-08-06 bundle-alignment story in § "The Claude bundle is a CROSS-REPO artefact" (Gotchas) is the
historical record of the container era.
