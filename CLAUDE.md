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
`/pdf-ask-human` (the question protocol with this repo's extra rules), `/pdf-lenses` (the mandatory
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
premise"* escape. Protocol details: `.claude/skills/pdf-ask-human/SKILL.md`.

> The container-era plain-text protocol and the `❓`/`⏹` end-of-reply markers are **RETIRED**
> (2026-08-18). They existed because `AskUserQuestion` timed out in the dead cloud container; on this
> machine it works, `askUserQuestionTimeout` is `"never"` globally, and the marker's rationale
> (a prose question being indistinguishable from a pause) dies with the prose protocol.

**Do not ask about routine work.** The standing directive for this repo is *no interrupts*: announce
the task size and the plan, then build it. Asking is reserved for the cases in
§ "When this protocol is mandatory" of that skill — chiefly a genuinely ambiguous request, or a change
that would weaken a documented invariant, a declared ceiling, or bump `SCHEMA_VERSION`.

## Certification ladder — governs every 3C/6C gate

`advisor()` **is available on this machine** (verified 2026-08-18) and is the FIRST rung: call it
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
  developer's local machine** `~/.claude/settings.json` does deny `git push --force`, `-f` and
  `--mirror` globally, and `ask-bash-firewall.sh` carries the same force patterns. Its blanket
  `Bash(git push *)` deny had made this section inert locally from the day it was written (the deny
  dates to 2026-04-24); it was dropped 2026-08-23.
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
rather than links, since the app is a single page. Baseline (default flags): 142 checks / 98 pass / 0 fail / 0 warn in ~1m20s. **CI runs it with
`--allow-destructive`** — correct there because the flag protects a developer's own open document,
and CI drives a throwaway browser on a fixture; without it the gate skipped 44 controls including
redaction and flatten. That run measures 145 checks / 107 pass / 0 fail.

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
│   ├── pdfRenderer.ts      # pdfjs page rendering
│   ├── uiController.ts     # toolbar/modal DOM wiring
│   ├── pageThumbnailPanel.ts, inkLayer.ts, storage.ts (IndexedDB)
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

### The redaction filter compared two coordinate frames — a non-zero CropBox origin defeated it, and images were never filtered at all (2026-08-28)

Three live leaks, each reproduced against shipping code with a passing control before any fix.

**1. The CropBox origin.** pdf.js reports text items in **absolute** PDF user space
(`item.transform[4]/[5]`); a redaction element's rect is relative to the **rendered** page box, i.e.
the CropBox. They differ by exactly `(viewBox[0], viewBox[1])`, which is `(0,0)` on almost every
page — so the two frames coincide, every fixture agrees, and the mismatch is invisible. Measured on
`/CropBox [50 50 350 350]` with the secret at absolute `100,300`: the flow model returned the
secret's paragraph verbatim and `_extractPageTableData` returned `SECRETWORD|PUBLICWORD`.

**The inventory is the lesson.** The repo already knew about this: `pdfElementRenderer`
(`cropOriginX/Y`) and the OCR burn (`unrot.viewBox[0]/[1]`) both add the origin, and the OCR one
even carries a comment naming the renderer as its precedent. **Both paths that BAKE pixels handled
it; both paths that EXTRACT text did not.** A concern known and solved in half the places it applies
is the repo's recurring shape — same as the `/Rotate` leak, same as the three-of-four `hookTimeout`.
`grep -rn "cropOrigin\|viewBox\[0\]" src/` is the one-line check.

**Fixed at the origin, not per call site:** `redactionRectToPageSpace` (geometry.ts) maps a display
rect into the items' frame, handling rotation and origin together; `isItemRedacted`'s third argument
is now `pageTopY` (`= viewBox[3]`), not `pageHeight` — those two numbers are equal only when the
origin is zero, which is why passing the height was right until it wasn't. `reconstructPage` takes an
optional trailing `viewBox`, defaulting to `[0,0,pageWidth,pageHeight]` so every existing caller and
all 58 call sites are byte-identical.

**A useful side effect, verified rather than assumed: the redaction filter is now structurally
independent of `getViewport`'s `rotation: 0`.** `viewBox` is rotation-invariant (only `width`/
`height` swap), so the filter no longer reads either. Mutating `{scale:1,rotation:0}` → `{scale:1}`
leaves the new guard 27/27 green. Note the honest negative that goes with it: **that mutation did not
produce a leak on the PRE-fix code either** — at 90° the wrong un-rotation dims and the wrong flip
base cancel for this geometry (14 failed either way, square or non-square crop). So do not record it
as "the rotation guard was vacuous and is now closed"; record it as "that argument is no longer
load-bearing for redaction" (it still is for layout dims — margins, column detection).

**2. Source IMAGES under a redaction were never filtered.** Four text channels were filtered and the
image channel was not, so a redaction over a picture removed the words on top and embedded the
picture whole. On a scan the whole page is one image XObject — the canonical redaction case, exactly
inverted. `imagePlacementRedacted` (exportService) now tests the placement, computing the footprint
from **all four corners of the unit square under the CTM**, not `|a|`/`|d|`: for a rotated placement
the `|a|/|d|` box is too SMALL, and under-dropping is the one direction a leak filter must never err
in. Drop-whole is deliberate and disclosed in `SECURITY.md` — one redaction now removes a scan from
these exports; burning the box into the bitmap (as the OCR path already does) is the follow-up.

**3. A square fixture cannot detect a dimension swap.** The first version of the guard used a 300×300
crop box. Sabotage found it: the rotation mutation changed nothing. Made it 300×240. The origin was
already asymmetric `(30,70)` for the same reason on the other axis — **apply that rule to BOTH axes,
and to the page box as well as the origin.**

Guards: `tests/browser/redaction-crop-origin.browser.test.ts` (27 — origin × 6 rotations × flow and
table, plus the image channel, plus a contract pin asserting pdf.js still reports absolute
coordinates so a future upgrade says so in one line) and `tests/utils/redactionPageSpace.test.ts` (12
pure, including an identity check against the mapping it replaced at every rotation). Sabotage-
verified: dropping the `viewBox` argument fails exactly the 6 flow rows, reverting the table path
exactly the 6 table rows, removing the image guard exactly the 2 image rows.

### `saveState` read the wrong error property, so every failed autosave looked like a success (2026-08-28)

`tx.onerror = () => reject(tx.error)`. Per the IndexedDB spec the step that *sets*
`transaction.error` is "abort a transaction", and it runs only **after** the request's error event
finishes dispatching — so inside `tx.onerror` the transaction has not aborted and `tx.error` is
`null`, while the failure sits on `request.error`. Measured against a real IDB implementation:
`{txErrorInOnError: 'NULL', reqErrorInOnError: 'ConstraintError', txErrorInOnAbort: 'ConstraintError'}`.

The consequence was total, not degraded. `saveState`'s catch re-threw only
`err instanceof DOMException && err.name === 'QuotaExceededError'`, and `null instanceof DOMException`
is `false` — so **every** write failure took the silent-skip arm, `saveState` RESOLVED, and
`toast.storageFull` was unreachable code. The user keeps editing a document that has silently stopped
being persisted and loses it on reload.

**The root cause was scope, not just the property.** `SessionManager._flush` already handles both
cases correctly (quota → toast, anything else → `silent()`), so the filter inside `saveState` was
redundant *and* was the thing that broke the contract. The swallow is now scoped to what its own
comment says it is for — the **open** failing (private browsing, permissions) — and any failure of
the **write** propagates.

`tests/core/sessionManager.test.ts` could not catch this: it `vi.mock`s `saveState` wholesale and
rejects with a hand-built DOMException, so both sides are green while the seam between them is
broken. **A test that mocks the collaborator it depends on proves nothing about the seam.**

Two more things came out of the same file. `clearState` had the identical wiring (fixed; its swallow
is deliberate, so there is no behavioural test to write — the dead branch was corrected so the next
person to make it report errors does not inherit it). And `openDB` **never closed its connection**:
every call opened a fresh one, so they accumulated for the life of the tab and blocked any later
`deleteDatabase`/version upgrade indefinitely. That is why the storage suite used to take 37s and now
takes 3s. Guard: `tests/core/storageErrors.test.ts`, whose deadline helper exists because the leak's
natural failure mode is a **hang** — an opaque 30s vitest timeout that reads as "slow test". It now
fails in 5s saying `saveState() never settled — a leaked IndexedDB connection is blocking it`.

### `Record<string, …>` on a mode map defeats the compiler — the badge said "SELECT" in sign mode (2026-08-28)

`uiController`'s `badgeKeys` covered 16 of `ToolMode`'s 17 members; `signRect` was missing from the
map **and** from `badge.*` in all three locales. With its `?? 'badge.select'` fallback, entering the
e-signature rectangle mode rendered the badge as **"SELECT"** while `.active` was toggled on — wrong
in a way nobody reports, because it looks like a real state rather than a missing string.

Fixed in three parts, and the third is the point: the map is `Record<ToolMode, string>` so the
compiler refuses a new mode that forgets its badge; the fallback is **deleted**, because a fallback
re-opens exactly this gap by turning a missing entry into a wrong label instead of a build failure;
and `ToolMode` is now derived from a runtime `TOOL_MODES` array (`typeof TOOL_MODES[number]` — the
type is unchanged) so a test can assert the half TypeScript cannot see, namely that the locale files
carry a string for every mode. Guard: `tests/ui/modeBadgeCoverage.test.ts`, both directions.

### A raised `testTimeout` does not raise `hookTimeout` — it blocked a push (2026-08-22)

`vitest.config.ts` raised `testTimeout` to 30s (`a214076`) because node-forge RSA-2048 keygen is slow
under full-suite CPU contention. `hookTimeout` was left at vitest's **10s default**, so a `beforeAll`
running that *identical* keygen got one third of the budget of a test running it. Three signing hooks
were patched individually with `}, 60_000)`; the fourth (`incrementalSigner.test.ts:106`) was missed
and eventually failed a real pre-push run — `Hook timed out in 10000ms` — **blocking the push**.

**It is contention, not a hang, and that is measured**: the failing hook's exact workload (keygen +
`loadP12`) runs in **242–466ms idle** and **564–2297ms under 8-way CPU saturation** on this machine.
So the operation was never close to broken; only the budget was. Re-measure rather than citing those
figures — they are one machine on one day.

**The fix is the config, not a fourth argument** (`hookTimeout: 60_000`, the value the three sibling
sites independently converged on). Patching the fourth site would have left the next hook someone
writes on the same 10s cliff. The three explicit `60_000` args are now redundant and deliberately
kept as local documentation.

**Two things worth carrying forward.** First, this is the global framework's "full-set coverage" trap
(Phase 6's semantic checklist — it has no section in this file) in its purest form — three of four members fixed one at a time, and the miss surfaced only when the unlucky one hit
a loaded machine. When a per-site workaround appears three times, the workaround is the bug report:
fix the origin. Second, `tests/infra/vitestTimeouts.test.ts` asserts the **effective config value**,
not the file text — a text regex would accept a present-but-too-small `hookTimeout`, which sabotage
confirmed (5s → the guard goes red on both assertions; absent → red as well).

### Destroying a node on `pointerup` suppresses the mouse `click` — desktop selection was dead for two months (2026-08-22)

Reported as *"adding text and then trying to edit it on desktop does not work — it works only on
mobile"*. It was not a text bug: **no annotation element of any type could be selected with a mouse
once it was unselected.** Root cause, in two coupled halves both from `c6bd71d` (2026-06-24,
*"fix(mobile): element drag no longer scrolls the page or lags"*):

1. `startDrag` engaged on the bare `pointerdown` with **no movement threshold** for mouse, so a plain
   click set `isDragging = true`.
2. That commit added `if (wasDragging || …) rebuildElementLayer()` to `_finish()`, which runs on
   `pointerup`. `rebuildElementLayer()` removes and recreates **every** `.pdf-element` node.

So a zero-movement click detached its own `mousedown` target before `mouseup` landed. **A mouse
`click` is only dispatched when mousedown and mouseup share a live common ancestor**, so Chrome
dispatched *no click at all* — measured: zero on the element **and** zero on the document.
`handleElementClick` → `selectElement` never ran.

**Why it looked like a mobile-only success, which is the genuinely non-obvious part: a
touch-derived click SURVIVES the same node swap.** Isolated in a synthetic page with identical DOM
mutation — mouse `0` clicks, touch `1` click. Pre-c6bd71d the drag path rebuilt the layer on every
`pointermove` and `_finish()` rebuilt nothing, so a click with no movement never triggered a rebuild
and selection worked. **Do not "verify" a pointer regression on touch and conclude the path is
fine.**

**Fix: the drag is deferred behind `_DRAG_THRESHOLD` for EVERY pointer type** (`_pendingTouchDrag` →
`_pendingDrag`), which is c6bd71d's own touch pattern generalised. `wasDragging` then *implies* real
movement, so its `_finish()` rebuild became correct as written and needed no second change. A mouse
press inside a text control still returns early and is left to the browser — that is what keeps
caret placement and drag-to-select-text alive. `startDrag` is gone; its `e.preventDefault()` (which
also suppressed native text selection during a drag) is replaced by `user-select:none` on
`.pdf-element`, with the inner control opting back in.

**Two traps for whoever reads this next.** First, `git blame` credits c6bd71d with the
`if (!isSelected) input.style.pointerEvents = 'none'` line in `elementLayerRenderer.ts` — **blame is
wrong there, the code was only MOVED into `_renderOne`.** That gate is older, so
click-to-select-then-click-to-focus (two clicks) is the ORIGINAL design; do not "restore" one-click
editing by adding auto-focus-on-select, and do not delete the gate. Second, this class is invisible
to jsdom, which does not model the mousedown/mouseup common-ancestor rule — a dispatched `click`
runs no matter what happened to the node. The jsdom guard therefore pins the *cause* (a press with
no movement must leave the handler idle and must not rebuild the layer, for both pointer types) and
`tests/browser/element-click-select.browser.test.ts` drives a **real mouse** for the outcome.
Sabotage-verified: re-committing the drag on pointerdown fails 3 browser + 6 jsdom cases.

### pdf.js's text layer swallowed every click on the page, so nothing ever deselected (2026-08-22)

Found while hunting the click-to-select regression above, and independent of it. The click that
deselects an annotation was bound to `<canvas id="pdfCanvas">`. But
`TextLayerManager.setPointerEvents(mode === 'select')` makes pdf.js's `.textLayer` interactive in
SELECT mode so PDF text can be selected and copied — and that layer is a **sibling overlay covering
the whole page**. So in exactly the mode where clicking empty page area should deselect, the click
landed on `.textLayer`, never reached the canvas, and `CanvasClickRouter`'s `selectElement(null)`
branch was **dead code on any page carrying a text layer**. Escape was the only way to deselect.

**Proven by single-variable experiment on the running app**, which is the technique worth copying
here: with the layer interactive, a click on empty page area leaves the element selected; setting
ONLY `document.querySelector('.textLayer').style.pointerEvents = 'none'` — changing nothing else —
makes the identical click deselect. The behaviour is also **page-type-inconsistent** (a page with no
text layer deselects fine), which is what marks it an accident rather than a design choice.

**The listener moved to `#canvasContainer`, gated on `isPageSurfaceClick`.** The gate is the whole
point and must not be dropped for a bare container listener: `#exportPreviewOverlay`, the ink
canvas and the annotation layer are children of that same container, and routing their clicks into
`handleCanvasClick` would deselect — and in `editText`/`fillBucket` modes run canvas-relative
coordinate maths — for clicks that are not page clicks at all. The surface is the canvas plus
anything inside `.textLayer`; pdf.js emits **one span per glyph**, so the real target is almost
never the layer node itself and the check has to be `closest`, not `===`. Annotation elements
already `stopPropagation` in `ElementLayerRenderer`, so they never arrive. Guard:
`tests/ui/binders/canvasClickRouting.test.ts` — sabotage-verified (rebinding to the canvas fails
exactly the text-layer case and nothing else).

**The same gate needed a THIRD branch: the grey area AROUND the page (2026-08-22, same day).**
Fixing the text layer fixed clicks *on* the page; a click *beside* it still did nothing.
`.canvas-container` is `padding: 20px` and `#pdfCanvas` is `margin: 0 auto` (`editor.css`), so
whenever the page is narrower than the viewport there is a band of the container's own
background next to it. **At fit-to-width that band is only 20px, which is why it reads as
negligible — but it grows with every zoom-out step: measured 909px canvas in a 1200px container,
a 146px gap after five clicks, unbounded below that.** So the deselect worked on the page and
silently failed on what looks like the same empty space.

The fix is a SECOND predicate, `isEmptyCanvasAreaClick`, composed with the first —
**deliberately not a looser `isPageSurfaceClick`**, because the grey margin is genuinely not the
page surface and saying so would make the name lie. **`target === container`, never
`closest('#canvasContainer')`**: every overlay lives INSIDE that container, so `closest` re-admits
exactly what the gate above exists to exclude. Sabotage-proven — swapping in `closest` fails the
descendant and overlay cases and nothing else.

Routing the margin through `handleCanvasClick` is safe in every mode, and this was checked rather
than assumed: the placement modes (`addText`/`addImage`/`addComment`/`addSignature`/`addCode`) and
the shape modes return early in `CanvasClickRouter`, so **no element can be dropped out there**;
`editText` maps the click to PDF content coords, finds no item within `TOLERANCE`, and re-shows its
hint; `fillBucket` bounds-tests shapes and ink (`hitTestShape` has no `Math.abs`, so a negative x
cannot match). Only the `select` branch does anything.

**Known bound, unmeasured:** on a platform with CLASSIC (space-taking) scrollbars, a click on the
container's scrollbar would also have `target === container` and would deselect. This Chrome uses
overlay scrollbars (`offsetWidth - clientWidth === 0`) and `::-webkit-scrollbar` sizing would not
force one, so it could not be reproduced — it is recorded rather than guessed at, and no guard was
written for a failure mode with no observed instance. If it ever surfaces, the one-line test is
`e.offsetX < container.clientWidth`.

Guards: the `isEmptyCanvasAreaClick` + wiring cases in the same jsdom file, and
`tests/browser/canvas-margin-deselect.browser.test.ts` — the browser one earns its place because
jsdom picks its own event target, so it assumes what a pointer in the gap hits; only a real layout
can show the gap exists and that no stretched overlay swallows the click first, which is the exact
shape of the bug this gate already had once.

### `@cantoo/pdf-lib` 2.8.1 broke custom-font subsetting — adapt fontkit, don't pin back (2026-08-07)

A lockfile-only bump (`^2.7.1` allowed 2.7.4 → **2.8.1**) turned CI red: **13 tests across 6 files**, every
one of them a custom-font embed, all dying identically:

```
TypeError: Cannot read properties of undefined (reading 'pos')
  |- Struct.encode                            @pdf-lib/fontkit
  |- TTFSubset.encode                         @pdf-lib/fontkit
  |- CustomFontSubsetEmbedder.serializeFont   @cantoo/pdf-lib
```

**Bisected, not guessed: 2.8.0 passes, 2.8.1 fails, nothing else changed.** 2.8.1 added feature-detection
to `serializeFont` — *"Upstream fontkit v2+ exposes sync `encode()`; @pdf-lib/fontkit uses Node-style
`encodeStream()`"* — and takes the `encode()` branch whenever the method merely EXISTS. `@pdf-lib/fontkit`
v1's subset does have an `encode`: restructure's low-level **`Struct.encode(stream)`**, which needs a
stream. Called bare it dereferences `undefined`.

**The discriminator is ARITY, not presence** — fontkit v2's sync `encode()` takes 0 args, v1's takes 1. So
`src/utils/fontkitAdapter.ts` wraps the registered module and hides `encode` only when
`encode.length > 0`, forcing the `encodeStream()` path v1 actually implements. Nothing is monkey-patched;
the real objects are untouched behind a `Proxy`. It self-obsoletes safely in both directions: if pdf-lib
fixes the detection the wrapper is inert, and on a real fontkit v2 it stops hiding anything.

**Rejected: `subset: false`.** That embeds the whole ~250 KB Noto Naskh Arabic face in every Arabic
export instead of the few glyphs used — a permanent size regression to dodge a transient upstream bug.
Also rejected: pinning back to 2.7.4/2.8.0 (developer ruling — keep the dependency current).

**EVERY `registerFontkit` must go through `adaptFontkit`.** Production has exactly one site
(`arabicOverlay.getArabicFont`), but three browser fixtures register fontkit themselves to build
subset-font PDFs, and they stayed red until routed through the adapter too — which is also what keeps a
fixture faithful to the real embed path. `grep -rn registerFontkit src/ tests/` is the check.

**The transferable part:** a dependency's *minor* bump inside a caret range can break a path no test of
ours touches directly, and the failure surfaced 500 lines deep in two vendored libraries. What identified
it in minutes was bisecting the single changed version with `npm i --no-save` and re-running ONE failing
file — not reading the stack trace harder. Note the whole diff was `package-lock.json`; `package.json`
never changed, so nothing in the repo's own history hints at it.

### The Claude bundle is a CROSS-REPO artefact — align it, don't fork it (2026-08-06)

Five repos share this bundle (`phorj` 07-23 → **pdfturbo** 07-28 → `twes-in` 08-02 → `stack` 08-06 →
`rent-watch` 08-06). The *file set* is identical in all five; every difference is content, and each repo
tailors the prose to its own invariants. **pdfturbo was second-oldest, so it had missed four rounds of
convention evolution.** Unified against `rent-watch` (newest) — seven items. What the exercise taught:

**1. A ported test is worth more than a ported doc, because it can fail.** `test-precompact-handoff.sh`
was missing here. Porting and running it immediately failed **5 of 35** assertions — this repo's
`precompact-handoff.sh` had no `<!-- manual -->` guard, so it would **clobber a handoff a human wrote**.
That is a live data-loss bug nobody would have found by reading. The newer 223-line hook was ported too
and the suite was 35/35. **The hook and its PreCompact registration are both GONE (2026-08-18)** — the
global-is-reference ruling removed every repo copy of something `~/.claude/` already owns, and handoffs
are the global PreCompact hook's job now [Verified 2026-08-19: `jq '.hooks | keys'` → `["PostToolUse"]`;
no `precompact-handoff.sh` under `.claude/hooks/`]. The lesson survives its subject: a ported test can
fail, and this one did.

**2. Env-var renames are the trap in a cross-repo port.** The test set `RENTWATCH_HANDOFF_DIR` while this
repo's hook reads `PDFTURBO_HANDOFF_DIR`. Left alone it would have exercised a default path and passed
while proving nothing — a green test that tests the wrong thing. Three vars needed remapping
(`_HANDOFF_DIR`, `_HANDOFF_LLM`, `_HANDOFF_MODEL`). **Grep the ported file for the OTHER repo's name
before running it, and don't trust a "clean" grep you printed unconditionally** — mine reported "portable
as-is" while the grep above it had found two hits.

**3. Two contradictory defaults in `/converge`.** Both `CERTIFY == reviewer` and `CERTIFY == self` were
labelled *(default)*. That is how a session talks itself into self-grading the work it just produced —
the exact blind spot the ladder exists to close, in the repo's highest-traffic skill. `self` is now
labelled a last-resort fallback requiring disclosure.

**4. The bundle documented machinery that does not exist, and believing it would silence gates.** The
autonomous-mode section described sentinels under `~/.claude/run/` and `~/.claude/state/`, a statusline
indicator, an `ask` permission tier and a bash firewall. **None exist here** [Verified 2026-08-06: both
dirs absent; `settings.json` keys are exactly `permissions`, `hooks`]. Replaced with the container-true
version, plus two dependent passages nobody had noticed — an "Active-plan statusline pointer" block and a
Phase 8 `rm -f` of a pointer that is never created. The § "Plans live in the repo" already said there is
no such pointer, so the bundle had been contradicting the project file.

**5. Two harness-vs-developer conflicts were unruled, and a session had to resolve them live.** The
container's harness prompt instructs a `Claude-Session` trailer and a `claude/<name>` designated branch.
The project rule said only "no `Co-Authored-By`" and never named the branch, so a session had to reason
from first principles (it omitted the trailers and pushed to `master` — correct). Both are now ruled
explicitly in `CLAUDE.md` § Git autonomy AND in the bundle's Rule 10. **Name the thing the harness names**;
a rule that covers the neighbouring case leaves the session guessing.

**6. `/cross-check --drift` is the tool this repo most needed and did not have.** Present in three of the
four siblings. Its `--drift` mode compares a doc against reality — and the 2026-08-05 session alone
produced five doc-vs-reality drifts (C10 false in two places, a `globalAlpha` mechanism absent from
`src/`, "every row is test-pinned" when 3 of 9 were not, an invented Type3 font gate, and a "four
surfaces" count contradicting its own five-row table). **Its example table had to be fully retargeted** —
inherited rows told the reader to query `config/sources.yaml` and `tests/fixtures/tenure/`, neither of
which exists here. A drift detector that names non-existent commands is worse than none.

**7. `completeness-reviewer` gained "do not invent a subject".** Adapted, not copied — rent-watch's
version is greenfield-specific. It exists because a review asserted a Type3 font gate on `deleteTextAt`
that lives only in `replaceTextAt`; a toast, a test and a `SECURITY.md` caveat were built for it before a
later round refuted all three. It also codifies verifying a NEGATIVE with a control, after a byte scan
read a pdf.js-detached buffer and laundered a live leak into a non-finding.

**The habit worth keeping: diff the bundle against the newest sibling whenever one of them is touched.**
Every file differed, so "the files are all there" proves nothing — compare headings and counts, then read
the deltas. Four of these seven were things actively wrong here, not features missing.

**ROUND 2 (same day, after the developer updated all four siblings). Nine more items — and the two most
useful were things round 1 got wrong or missed, which is why "we already swept" is not a reason to skip a
second pass.**

- **A real bug, from phorj: `log_obs` wrote to `~/.claude/logs/`**, wiped when the container is reclaimed,
  so every line a hook logged in a real session went where nobody could read it. Rule 13 satisfied on
  paper, useless in practice. Now `var/claude/logs/` in the repo. **And Rule 13 itself still mandated the
  dead-end path** — the code moved and the rule that requires it did not, so the file contradicted itself
  319 lines apart with both halves live in `~/.claude/CLAUDE.md`. Three of four siblings had already
  rewritten that rule; pdfturbo was the last. **When you change where something writes, grep for the rule
  that told it to write there.**
- **`install.sh` now copies UNCONDITIONALLY** (developer ruling: the repo is always the truth). `cp -u` was
  wrong in both directions, and its own header claimed the opposite — see § "Claude config in this repo".
  This **superseded a THINKING.md rule round 1 had ported hours earlier**, and made a *different* line
  actively harmful: `CLAUDE-global.md` still said "edit `~/.claude/THINKING.md`", which under unconditional
  copy is destroyed at the next SessionStart rather than merely diverging.
- **Round 1's absent-machinery sweep was NOT complete**, though its entry above reads as if it were. Three
  more instances surfaced: `§ Memory System Toggles` (a `session-remember` pipeline), `BLAST-RADIUS.md`'s
  registry section AND its state-sentinel paragraph (an `ask` tier and a bash firewall). Worse, the
  framework asserted `~/.claude/skills/` does not exist while the **host installs 40 skills there** — so a
  session was told to ignore `pdf`, `docx`, `xlsx`, `pptx` and the `grdf-*` org workflows. **A
  false-absence claim is as harmful as a false-presence one, and this class needed three passes to clear.**
- **Full autonomy, ruled: `deny` stays empty** — in the web container a denied command is one *nobody* can
  run. The allow list goes 13 → 85, staged as `settings.json.pending` because the classifier blocks Claude
  from writing its own permission surface (a platform guard, not repo policy — do not work around it).
  **Describe that list honestly**: it is not "read-only", and `bash:*` alone makes the enumeration
  containment-free. An earlier draft of that bullet said "the usual read-only shell tools", which was false
  of 16 entries.
- **A guard suite can be vacuous in a way `bash -n` and a green run never show.** `test-install.sh` case 7
  asserted "exit 0 when var/claude cannot be created" via `chmod 500` — which does not bind root, so it
  passed because the mkdir SUCCEEDED, and the asserted behaviour was in fact false (`set -e` + a failing
  `mkdir` exits 1). Fixed both ends: a file-in-the-way makes it genuinely fail, and the `mkdir` is now
  `|| true` so a hook never loses the session over a scratch directory. Reverting the guard fails exactly
  that case.

### A ceiling table is only as good as its last measurement — C10 was wrong in two places (2026-07-31)

`KNOWN_ISSUES.md` listed **C10** as *"DOCX 3+ column recursive layout — Reconstructor is 2-column"*.
That had been false since B6: `splitColumns` **is** recursive (`COLUMN_MAX_DEPTH = 2`) and
`tests/utils/flowDocColumns.test.ts` has asserted *"3 columns → three groups"* ever since. A same-day
cross-check table in `tests/blockers/README.md` repeated the error from the other direction ("only 1-
and 2-column are exercised") because it was written from the ceiling text instead of from the tests.

The real boundary came from measuring, and it is not the depth arithmetic either: **4 evenly-spaced
columns yield 3 groups, not 4**, because the gutter search is restricted to the inner 20–80% of each
region with a 5% minimum gap, so a level can decline to split well before the cap. Pinned in
`tests/blockers/layout-flatten.blockers.test.ts` at the boundary (3 works, 4 under-splits, words are
never lost — it degrades reading order, not content).

**The habit this should buy: re-measure a ceiling before citing it, and write the pin from the code
rather than from the prose.** Two documents agreed with each other and both were wrong, which is
exactly the failure a green test suite cannot catch. `C11` is the counter-case in the same pass — left
unpinned on purpose, because its only testable surface is an inline predicate in a private method and a
copied predicate pins nothing.

### `/pdf-qa-sweep` reaches 66 of 141 controls, and that is the app's design — do not "fix" the crawl (2026-07-31)

The sweep's `0 fail` covers **66 distinct controls of 141 in the DOM**. Every report now ends with
`Exercised N distinct control(s) of M` and **names** the rest, because 31 `SKIP became hidden` lines
buried among 150 entries read as thorough and are not. **Read that line before claiming the sweep
covers a feature** — `flattenBtn`, `sanitizeBtn`, `watermarkBtn`, `batesBtn`, `compressBtn`, `exportXlsxBtn` and the
DOCX/MD/XFDF export buttons are **never clicked** (a `deploy.yml` comment claimed otherwise; corrected).

**The cause is the product, not the driver.** `modalBinder.ts` registers the export flyout with
`closeWhen: 'any-click'`, and each file-menu item removes `.open` from its wrap in its own handler — so
the app shuts the container as soon as one child is used and every later sibling is legitimately hidden.
Only re-opening the toggle once per child could reach them. **Four shapes of that were built and
measured; all lost coverage overall** against the baseline `150 checks / 112 pass / 0 warn / 36 skip`:

| attempt | checks | pass | warn | skip |
|---|---|---|---|---|
| unwind only when something was revealed | 143 | 81 | 30 | 30 |
| re-click any parent when a sibling went hidden | 107 | 54 | 38 | 13 (+1 FAIL) |
| re-click flyout/menu toggles only | 132 | 78 | 33 | 21 |
| separate post-crawl container pass | 170 | 112 | 0 | 55 (+1 FAIL; a variant hung 15 min) |

A hidden-SKIP and a `blocked by` WARN are **the same phenomenon** — a container in the way — so trading
one for the other buys nothing and costs stability. The numbers live in `exercise()`; do not re-attempt
without beating them. Two traps found along the way, both worth knowing: `unwind()` inspects only the
**page centre**, so it is structurally blind to a toolbar flyout (which is why a naive re-open *closed*
them); and `exercise()` marks a control `visited` **before** its visibility check, so a second pass that
guards on `visited` silently skips exactly the controls it exists to reach.

Two robustness fixes landed from this: `page.setDefaultTimeout(6_000)` after boot (Playwright's 30s
default made 40 covered undo-clicks in the scenario reset hang the run for **20 minutes** with no
output — in CI a job timeout, i.e. an unactionable red), and crash containment around the crawl (this
container's Chromium SIGSEGVs non-deterministically; it used to throw out of `main()` → exit 2, **no
report and no CI artifact**. Now it records the crash and still prints).

### A flaky gate: never scan a whole PDF for a short byte sequence (2026-07-30)

`tests/browser/arabic-overlay.browser.test.ts` asserted
`expect(String.fromCharCode(...bytes)).not.toContain('(?')` — the ENTIRE saved PDF, FlateDecode
streams and the embedded font subset included — to prove the Arabic overlay had not fallen back to a
WinAnsi `?` substitution. Compressed bytes are effectively random, so `0x28 0x3F` appeared by
coincidence: **measured 2 failures in 8 local runs (25%)**, and it took down the CI run for `eabcc3f`.
The product was never wrong; the assertion was. A flaky test in a deploy-blocking pipeline blocks
deploys at random, which is why this is a defect and not a nuisance.

Now scoped to the page content stream, and stated positively:
`expect(stream).toMatch(/<[0-9A-Fa-f]+>\s*Tj/)` plus a negative on a literal-string show op carrying
`?`. **Two non-obvious details:** (1) `page.node.Contents()` is a `PDFArray` of stream refs, so each
must be looked up in `doc.context`; (2) pdf-lib **FlateDecode-compresses the content stream it
writes** (raw bytes open with `78 9C`), so it must be inflated first — `fflate`'s `unzlibSync`, already
a dependency via the DOCX OPC path. Asserting on the raw bytes matches nothing, which is how a first
attempt at this fix went 0/8 instead of 8/8.

Verified non-vacuous: the real stream is
`q BT 0 0 0 rg /NotoNaskhArabic-… 24 Tf 1 0 0 1 231.016 100 Tm <00010002000300040005> Tj ET Q`
(one hex show op, 5 CIDs for the 5 letters), the negative regex flags a synthetic `(?????) Tj`, and
does not match the real stream. 8/8 consecutive runs green.

**The general rule:** a byte-level assertion on a container format must be scoped to the decoded part
it is actually about. Whole-file `toContain` over compressed data is a coin flip.

### A CRITICAL a11y rule the gates could barely see: `<label>` with no `for=` (2026-07-31)

`/pdf-qa-sweep` caught axe `select-name` (**critical** — a tier above the three `serious` rules fixed on
2026-07-29) on `#blankPageSize`/`#blankPagePosition`, and caught it **by luck**: the rule fires only
while a control is VISIBLE, so it needed a run that happened to leave `blankPageModal` open. The cause
was systemic — **16 controls** sat beside a bare `<label>` with no `for=`, i.e. a visible label with
**zero** programmatic association to the sibling it labels. Chrome's own computed name, before → after:
`combobox:` (nameless) → `combobox "Mode"`. Worse, `#batesPrefix` reported `textbox "ACME-"` — it was
falling back to its **placeholder**, so AT announced an example value as the field's name.

Fixed by adding `for=` to all 16 (pure markup, existing i18n keys, no new strings; the labels also
become click targets, which is a bonus not a risk — nothing in `src/` reads label structure).

**The gate is now static, because the live one cannot be trusted for this.** `tests/ui/indexHtmlA11y.test.ts`
enumerates **every** `input`/`select`/`textarea` rather than four hand-picked ids: zero unnamed
`<select>` (that rule is critical), plus a **declining allowlist** `UNNAMED_OK` for the remainder and a
third test that fails if an entry becomes stale — so a fixed control cannot be left in the list. Proven
non-vacuous: reverting `index.html` fails 2 of the 3 and names all 16.

**The remaining 8 were closed the same day, with ZERO new i18n keys** — and the measurement that made
that possible is the reusable lesson. They were **never axe violations**: accname falls back to
`placeholder`, then `title`, so Chrome computed a name for every one and axe reported nothing. The
defect was the *fragility* of that fallback, and `#pdfPasswordInput` is the proof — it announced its
placeholder `"Enter password…"` while a perfectly good `<label>Password</label>` sat unassociated
directly above it. **Do not budget new strings for this class before probing Chrome's computed name;
the keys the placeholders already reference are the keys you need.** Fixes: `for=` on the password
label; `role="group"` + `aria-labelledby` on the `signX/Y/W/H` and `blankPageW/H` rows so a bare `"X"`
is announced with its group label; `data-i18n-aria` reusing the existing placeholder/title keys.

`UNNAMED_OK` is therefore down to **5** — hidden file/colour inputs that exist only to be `.click()`ed
by a visible button. That is a coherent permanent category, not a backlog: axe skips hidden nodes and
no user can focus them.

### Live-app a11y: 3 serious WCAG rules fixed, and why the static gate missed them (2026-07-29)

`/pdf-qa-sweep` found three `serious` axe violations in the **running** app that
`tests/browser/a11y-axe.browser.test.ts` cannot see. That test injects `index.html`'s static body with
`<script>` stripped, so `main.ts` never runs: no document is loaded, so **no thumbnails are rendered
and the canvas region does not scroll**, and the elements that fail are either absent or `display:none`
(axe skips hidden nodes). It gates on zero critical/serious and passes truthfully — it just cannot
reach these. Keep both gates; they answer different questions. Fixes:

1. **`nested-interactive` (2 nodes) — the real defect.** `.thumb-item` carried `role="button"` +
   `tabindex="0"` while also containing the rotate / export / delete buttons: a control inside a
   control. Its hand-rolled Enter/Space competed with the children's, and a screen reader announced a
   button within a button. Now the tile is a plain div (drag surface + positioning context only) and
   the nav affordance is a real `<button class="thumb-nav">` wrapping the image. `.thumb-label` stays
   a **direct child of the tile** so its `position:absolute` keeps anchoring there. **The Enter/Space
   handler was DELETED, not moved** — a native button does activation *and* Space-scroll suppression
   for free, so keeping it would fire `onNavigate` twice per Enter. Post-delete focus restoration now
   targets `.thumb-nav`; focusing the tile would silently drop focus to `<body>`. Native activation is
   **verified live** (2026-07-29): focusing the page-2 `.thumb-nav` and pressing Enter moves the page
   indicator to 2. jsdom cannot show this — it does not synthesise click from keydown, and a synthetic
   `KeyboardEvent` never runs a default action — so the jsdom test asserts only the structural
   precondition (the control is a real `<button>`) and the behaviour is guarded by
   `tests/browser/thumbnail-activation.browser.test.ts` (real Enter/Space via `userEvent`, asserting
   `onNavigate` fires **exactly once**). That guard is proven non-vacuous: reintroducing the deleted
   keydown handler fails it with 2 calls.
2. **`color-contrast` (2 nodes).** `.btn-success` `#10b981` on white was **2.53:1** — and its
   `:hover` `#059669` was **3.77:1**, never measured because axe does not test hover. Now `#0a855b`
   (4.65) / `#087d55` (5.15). `.toolbar-label` `#64748b` on `#f0f4f8` was **4.3:1** → `#616a78`
   (4.95). Both are the *lightest* values clearing 4.5:1, so the visual delta is minimal. `#64748b`
   elsewhere sits on white (4.76:1) and is left alone.
3. **`scrollable-region-focusable` (1 node) — FIXED 2026-07-31, and the ruling below still stands.**
   The rule is satisfied by the region containing focusable **content**, not only by the region itself
   being focusable — so `#pdfCanvas` (which already had `role="img"` + an i18n aria-label) is now
   `tabindex="0"`, and `#canvasContainer` keeps its `tabindex="-1"`. Both halves are asserted in
   `tests/ui/indexHtmlA11y.test.ts`. Verified live with a document loaded: the violation is present
   before and absent after, and with the canvas focused ArrowDown genuinely scrolls the region
   (`scrollTop` 20 → 100) — the keyboard access the rule exists to protect, actually working.
   **`A11Y_ACCEPTED` in `scripts/qa-sweep.mjs` is now EMPTY**, so the deploy gate has zero accepted
   exceptions; keep it that way. The history below is kept because the trade-off it describes is real
   and someone will re-propose `tabindex="0"` on the landmark:
   `#canvasContainer` was briefly changed `tabindex="-1"` → `"0"` on 2026-07-29 to satisfy the rule.
   The developer ruled on 2026-07-30 to keep the strict skip-nav idiom (`-1`) instead, so the landmark
   stays out of the tab order and a keyboard user reaches the page content without an extra stop —
   **that ruling was never overturned and still holds.** For one day the violation was therefore left
   open and carried as the sole `A11Y_ACCEPTED` entry, reported as `ACCEPT` on every run rather than
   hidden. What resolved it was noticing the rule accepts focusable *content*, so the landmark and the
   rule were never actually in conflict — only the first fix attempt was. The lesson worth keeping:
   **when a gate and a ruling appear to collide, re-read the rule before accepting a hole in the
   gate.** Note the static test cannot see the rule either way — its DOM never scrolls.

**Do not "fix" a contrast report without checking `opacity` has reached 1.** axe reads *composited*
colour, so a control caught mid fade-in reports the blend over the toolbar: `#textModeBtn` at
opacity 0.508 measured `#6f787f` (4.49, FAIL) when its real background is `#6c757d` (4.69, PASS) —
8 phantom violations whose count drifted run to run with load timing. `scripts/qa-sweep.mjs` now waits
for `document.getAnimations()` to settle before running axe.

### Mobile thumbnail controls = a single ⋮ action menu (F2b, 2026-06-26)

The per-thumbnail controls
(↺↻ rotate / 📄🖼 export / × delete) reveal on `:hover` on **desktop only**. On `≤640px` a 50×74px tile
can't host five 44px touch targets, so the media query in `pdf-layers.css` **hides** `.thumb-rotate`/
`.thumb-dl`/`.thumb-delete` (they stay in the DOM — desktop uses them) and **shows** a single `.thumb-more`
⋮ button that opens `_openActionMenu` — a body-anchored popup (`.thumb-action-menu` / `.thumb-action-menu-item`,
≥44px rows) with Rotate L/R, Export PDF, Export image (→ the existing format submenu), Delete. Both popups
share ONE open-menu state (`_openMenu`/`_closeMenu`/`_onMenu*`) and the shared `_positionMenu(menu, anchor)`,
which **flips the menu upward** when there's no room below (the thumbnail strip sits at the viewport bottom,
so it almost always opens up) + clamps horizontally. Guarded by the F2b jsdom tests in
`tests/ui/pageThumbnailPanel.test.ts` (wiring) + live @375px evidence (`qa-shots/f2b/`: overlays `display:none`,
rows measured 44px, menu fully in-viewport). i18n: one new key `thumbnail.moreActions` (ar reviewed 2026-07-30);
row labels reuse the existing `thumbnail.*` keys.

### Export paths are consolidated

(the historic triplication is RESOLVED): `downloadPDF`,
`downloadPage`, `downloadPageAsImage` on `pdfTurboApp.ts` are now thin
one-line delegators to `_exportService`; the shared rotation/cropbox/watermark/ink logic
lives once in `src/export/exportPipeline.ts` (`buildPageOverlays`) + `exportService.ts`
helpers (`_applyOverlaysToPage`, `_saveOrDownload`). Apply export fixes in
`exportService`/`exportPipeline`, not in three places.

### Watermark renders LIVE on the editor canvas (2026-06-25)

The watermark was historically
export-only (only `exportPreviewPanel` called `drawWatermark`), so enabling it showed *nothing*
while editing — read as "watermark not working." `PageRenderPipeline._renderWatermarkOverlay()`
now paints it onto a dedicated `#watermarkOverlay` canvas (z-index 1, pointer-events none, NOT the
pdf.js page canvas — keeps true-edit colour sampling / thumbnails clean), removed+recreated every
`renderCurrentPage`; `WatermarkPanel.apply()` re-renders so toggling is immediate. **De-dup
invariant**: the export-preview ghost draws its OWN watermark, so `_renderWatermarkOverlay` SKIPS
when `exportPreviewOpen`, `ExportPreviewPanel.show()` removes the live overlay, and `hide()`
re-renders to restore it — exactly one watermark in every mode (guarded by
`tests/core/pageRenderPipeline.test.ts` + `tests/ui/exportPreviewPanel.test.ts` +
`tests/browser/watermark-live.browser.test.ts`). The exported PDF is unchanged (pdf-lib
`drawWatermark` in `buildPageOverlays`, no double-bake). **Density is now 1–10 (0.5 steps),
font-size max 400** (angle ±180 and opacity 1–100 were already full); the export spacing uses the
shared pure `src/utils/watermarkDensity.ts` `densitySpacingFactor` (interpolated table preserving
the old integer-1..5 factors EXACTLY → byte-stable at integer densities). `apply()`/`_updatePreview()`
parse density with `parseFloat` (NOT `parseInt`, which truncated 1.5→1).

### `renderElements()` destroys and recreates every element DOM node

On each call.
Focus-restoration hacks depend on this; keyed identity is NOT preserved.

### i18n

Every user-visible string goes through `t()`; `escapeValue: true` is set
(`i18n.ts:70`) — i18next HTML-escapes interpolated values, so the XSS surface is small.
Still prefer `textContent` over `innerHTML` for any user/translation data, and never
disable escaping. The three locale files must stay key-identical (a hook checks this on
write). **Arabic review status — STRINGS COMPLETE (2026-07-30):** a native speaker reviewed and validated
**all 31 keys** that had carried `ar [Unverified]`, across two rounds (15, then a further 16 that the
first extraction missed: `findReplace.*`, `docxEditor.deleteImage`, `docxToolbar.insertImage`,
`sign.error.UNSUPPORTED_XREF`). Every entry read `ar reviewed 2026-07-30`, and **that review changed no
Arabic value** — the one issue reported turned out not to be one (see the `صف` vs `سطر` note below).
Do not re-add `ar [Unverified]` to an existing key; NEW keys start unverified as before.
**AMENDED 2026-08-05:** three reviewed values HAVE since been changed — `toolbar.cropTitle`,
`toast.modeHint.crop` and `toast.redactionPlaced`, because their wording contradicted the hide-vs-remove
grades (see that § for why). They are single-verb substitutions and are **pending a native pass**. So the
sign-off is no longer a blanket "nothing changed since"; check the pending count below before assuming a
key is reviewed.
**Sign-off covers STRING translations only.** The RTL *rendering* ceilings are untouched by it and
remain open: C18 (per-glyph select/copy/search precision), C19 (tashkeel/GPOS micro-positioning),
bracket mirroring in the overlay, and RTL list-marker placement. A reviewed string can still render
imperfectly — those are separate, and they need EH-B (HarfBuzz-WASM), not a translation pass.

**`صف` (table row) vs `سطر` (text line) — do not "fix" one into the other.** The reviewer flagged
`docxToolbar.addRow`/`deleteRow` as needing `سطر`, reading the French gloss *"Ajouter une ligne"*
— French *ligne* is ambiguous. Those buttons call `addRowAfter`/`deleteRow` from
**prosemirror-tables**, so they are TABLE rows and `صف` is correct; `formatting.lineSpacingLabel`
already uses `أسطر` for genuine text lines. Confirmed keep-`صف` by the reviewer. The file is
internally consistent on this distinction — preserve it.

### Base path is `/pdfturbo/`

(vite.config.ts) — asset URLs and SW scope depend on it.

### PWA is `registerType: 'prompt'`

(`vite.config.ts:12`) — a new deploy does NOT silently
swap open sessions; the SW waits and the app surfaces an update prompt (`toast.appUpdateAvailable`).
Pushes to `master` are still production releases (auto-deployed via GitHub Pages), but open
clients update only on user action / next load, not instantly.

### Tests run in jsdom

Canvas rendering, real PDF rasterization, and pointer gestures
are not exercised by `npm run test`. There is now a real-browser harness — `npm run test:browser`
(`tests/browser/*.browser.test.ts`, real Chrome) — that DOES exercise these; use it for
editor/export/DnD changes alongside `npm run dev` manual checks. CI runs both suites (deploy.yml).

### Only `@cantoo/pdf-lib` is the PDF write library

(the dead `pdf-lib` and `qpdf-wasm`
deps were removed 2026-06-11). Never add the bare `pdf-lib` back — it has been abandoned
upstream since ~2021.

### File System Access save (#54)

`src/utils/fileSystemAccess.ts` (`canUseFsSave`/`pickSaveTarget`/
`writeToHandle`, local types — the API is absent from some `lib.dom` versions, so no dep). `downloadPDF`
uses the native Save dialog on Chromium. **Non-obvious: `showSaveFilePicker` needs *transient user
activation*** — an `await` (e.g. PDF assembly) can outlive it, so the picker MUST be acquired BEFORE the
slow work (`pickSaveTarget` is called first in `downloadPDF`, then assemble, then `writeToHandle`).
Cancel (AbortError) → silent no-op; any non-abort failure → anchor-download fallback (progressive
enhancement). The picker is now used by **all the major byte exports** — `downloadPDF`,
`downloadPage`/`downloadPageRange`, `downloadFlattened`, `sanitizeAndDownload`, `compressAndDownload`,
`exportTableCsv`, `downloadPageAsImage`, **and `exportAsDocx`** (each calls `pickSaveTarget` FIRST, before
the heavy assembly, to stay within the transient-activation window). Only `exportAsMarkdown`/TXT and the
XFDF export stay plain `_downloadBlob`. **Automation note:** the native Save dialog can't be driven by
Playwright — to capture a download in a browser test, `delete window.showSaveFilePicker` to force the
anchor-download fallback. Open-via-picker + recent-files deferred (#54b).

### XLSX table export (#56b, 2026-08-04) — and the numeric rule that a unit test cannot catch

`📊 exportXlsxBtn` (export flyout) → `ExportService.exportTableXlsx` → `src/export/xlsxWriter.ts`.
**No new dependency:** XLSX is OPC, the same ZIP-of-XML-parts container as DOCX, and this repo already
writes OPC zips with fflate's `zipSync` (`src/docx/opcEdit.ts`). The writer is **dynamically imported**
so fflate stays out of the entry bundle — verified: `xlsxWriter-*.js` is its own chunk and `zipSync`
does not appear in `index-*.js`.

Detection is SHARED with the CSV export via a new private `ExportService._resolveTableGrid()` (lattice
first, then EH-E whitespace inference). The precedence lives in exactly one place on purpose — see
§ Export paths are consolidated for what happens here when it does not.

**Two ways XLSX must differ from the CSV writer, both easy to get wrong:**

1. **Do NOT reuse the CSV formula-injection guard.** `csvField` prefixes `= + - @` with an apostrophe
   because a CSV cell is parsed by the spreadsheet. In XLSX a formula is a distinct `<f>` element and a
   `t="inlineStr"` cell is text by construction, so copying the guard would corrupt data (a cell
   legitimately reading `-5` gains a visible apostrophe) while protecting against nothing.
2. **Numeric cells must be real numbers** — a text `"9.99"` cannot be summed, which is the entire
   reason to prefer XLSX over CSV. **The rule is subtler than it looks.** The obvious
   `String(Number(v)) === v` accepts `"9.99"` but REJECTS `"24.50"` and `"5.00"`, so a currency column
   comes out half numeric and half text. All 13 unit tests passed that bug because the fixture happened
   to use `9.99`; it was caught by exporting a real invoice-shaped table and reading the sheet XML.
   The fix compares against a canonical form that drops only **insignificant** trailing zeros, which
   preserves three protections as a side effect rather than as special cases: `007` stays text
   (significant leading zero), a 20-digit account number stays text (would lose IEEE precision), and
   `1,200` / `1e5` stay text. A trailing `.` also stays text — `"1."` is a numeral to JS but in a table
   it is almost always an ordinal marker.

**Verified by an INDEPENDENT reader, not just its own round-trip:** `openpyxl` loads the exported
workbook, reports `A1:C4`, types labels as `str` / Qty as `int` / Price as `float`, and **sums the Price
column to 39.49**. Note `libreoffice` is present in the cloud container but **`libreoffice-calc` is
not**, so `soffice --convert-to` fails on every spreadsheet — including a plain CSV. That failure looks
exactly like "the file I generated is corrupt" and is not; check whether the tool can open a trivial
file before believing it. Guards: `tests/export/xlsxWriter.test.ts` (15, asserting on the unzipped sheet
XML). The button is in the export flyout, so `/pdf-qa-sweep` never clicks it (the flyout closes on any
click) — it is covered by the live drive described above, not by the sweep.
i18n: one new key `toolbar.exportXlsxTitle` (**ar [Unverified]**; needs a native pass — as do the 7
`toolbar.cropMargin*` / `toast.cropMarginsTooLarge` keys added the same day — **12 values pending as of
2026-08-05**, these 8 plus the 3 re-worded in § The hide-vs-remove audit; that § is the count's home, so
update it there and here together). `toast.noTableFound` also dropped the word "ruled" in all three
locales, since neither table export is lattice-only any more — the Arabic edit is a word DELETION, so it
is verifiable at a glance.

### EH-E released for CSV — borderless tables, and the ONE rule that makes it safe (2026-08-04)

`src/utils/borderlessTable.ts` infers a table grid from text geometry when a page has no ruled lines,
closing **C13**. It is the only escape hatch that cost nothing structural — no dependency, no WASM, no
backend — which is why it was the one worth releasing.

**Design: synthesize pseudo-rules and reuse `buildTableGrid`.** Inferred row/column boundaries become
zero-height `RuleRect`s, so cell assignment, reading order, the empty-band pruning and every consumer
(CSV/DOCX/MD/TXT) are shared with the lattice path. One grid shape, one set of semantics — and the
boundary fix from `753c639` applies for free. Columns are **global whitespace bands** (an x-range no
text item crosses), which is stricter than per-line gap persistence and rejects prose by construction.

**The load-bearing rule is `MIN_SPANNING_RATIO`, and it is not obvious.** A two-column PAGE layout
produces exactly one clean global band, so band detection alone would call every two-column article a
two-column table. The discriminator: **in a table a single line spans multiple column bands; in a
multi-column page each line lives in exactly one.** Proven load-bearing — disabling that one check
makes the two-column-page test fail and *only* that test. Do not "simplify" it away.

**C9 (DOCX) stays UNWIRED — and as of 2026-08-05 that is a MEASURED decision, not a cautious one.**
A realistic corpus (`tests/browser/borderless-corpus.browser.test.ts`, real pdf.js extraction of 8 page
shapes) found the gate had **2 false positives out of 6 prose shapes**, both invisible to the unit tests:
a **side-by-side two-column article** (6×2) and a **bulleted list** (4×2). Both defeat
`MIN_SPANNING_RATIO` for the same reason — every line genuinely does span both bands — and the
two-column unit fixture had passed only because it stacked the columns sequentially, which no real layout
does. That fixture is now realistic and the gate has a second rule (`MAX_MEDIAN_CELL_WORDS`, measured:
tables median 1 word/cell, prose 4–5), after which the corpus is clean. **The remaining blocker is
corpus BREADTH, not gate tightness** — 6 synthetic shapes passing is not real-file evidence, and the
harm asymmetry below is unchanged.

**The harm asymmetry, which is why the bar is this high for DOCX and not for CSV.**
`exportTableCsv` runs only when the user explicitly asked for a table, so a false positive costs them
one discardable CSV. The DOCX path is different: `reconstructPage` **removes in-region words from the
paragraph flow**, so a phantom table there would silently mangle ordinary prose. Same engine, so C9 is
a wiring change plus a stricter threshold — but it should follow evidence from real files.

Guards: `tests/utils/borderlessTable.test.ts` (11 — the two refusal cases come FIRST because a phantom
table is worse than a missed one) + `tests/browser/borderless-table.browser.test.ts` (3, real pdf.js:
the lattice detector must find nothing, the borderless one recovers a 4×3 grid, and real prose is
refused). `TableTextItem.width` is a new OPTIONAL field — the lattice path ignores it, so ruled-table
output is byte-identical; the detector cannot find a column without knowing where text ENDS.

### Two boundary-convention bugs in the lattice-table path (2026-07-31)

Found by READING the code while scoping EH-E, not by a failing test — both were invisible to 25
existing flow-path test files. Worth knowing because the first is a **silent data-loss** shape this
repo has been bitten by before.

**1. Inclusive region vs half-open cells.** `_itemInRegion` (`flowDoc.ts`) accepts the table region
bbox **inclusively on all four sides**, while `buildTableGrid`'s cell bands were **half-open**
(`>= lo && < hi`), tiling only `[left,right) × [bottom,top)`. `reconstructPage` (`flowDoc.ts:1542`)
then **removes every in-region word from the paragraph flow** — so a word sitting exactly on the top
or right boundary was deleted from the flow AND landed in no cell, vanishing from DOCX/MD/TXT/CSV with
no warning. **Measured worse than that:** when such a word was the only text, every cell came out
empty, the grid was rejected as phantom, and `buildTableGrid` returned `null` — the whole table
disappeared. Fixed by making the outermost upper bound inclusive (last column, top row); the lower
bounds were already inclusive, so all four outer edges now match the region and internal bands stay
half-open, which is what stops two adjacent cells claiming the same item.

**2. Rows were not pruned, columns were.** The empty-column prune existed with a comment explaining
exactly why (an over-segmented vertical rule — one logical line detected as two bounds >tol apart —
creates a thin text-free band that emits a spurious `,,`). **Rows have the identical failure mode** (a
2px line drawn as two 1px strokes) and were left in, producing a blank CSV record and an empty row in
the exported DOCX table. The asymmetry was the bug and the column comment was already its
specification. Now pruned on both axes, keyed on "this band caught no text at all" — so a deliberate
blank spacer row whose band does carry text elsewhere is still preserved (guarded).

**The transferable lesson: when one function tests a boundary inclusively and its collaborator tests
the same boundary half-open, the gap is silent by construction.** Neither side looks wrong alone.
Guard: `tests/utils/tableExtractEdges.test.ts` (7 cases; all 4 defect cases fail on the pre-fix code,
two of them with `expected null not to be null`).

### Table → CSV (#56)

`src/utils/tableExtract.ts` (`clusterPositions`/`buildTableGrid`/`gridToCsv`, pure) +
`ExportService.exportTableCsv`. `walkPageOps` now emits **`vRules`** (thin *vertical* line-like rects) alongside
the horizontal `rules` — the horizontal filter (underline/strike) is byte-unchanged; vertical is a new
additive branch. buildTableGrid clusters h-rule y's → rows, v-rule x's → cols, assigns text by center.
**Corrected 2026-08-04** — this paragraph carried three claims that later work made false: lattice-only
(borderless now works via EH-E, see the § above), "plain download, no FS-Access picker" (both table
exports call `pickSaveTarget`, which is why the picker must precede the async extraction), and "XLSX
deferred (#56b)" (shipped — see § XLSX table export).

### Form flattening (#62)

⊞ export-flyout button → `ExportService.downloadFlattened()`. The default export
fills+flattens a source's AcroForm **only when the user typed values** into it; an opened PDF's untouched
fields therefore survive into the export as orphaned **widget annotations** (`copyPages` drops the document
`/AcroForm`, so `getForm().getFields()` is 0 in BOTH paths — the residue is the page `/Annots` Widget, not the
form catalog). `downloadFlattened` passes `_assemblePdfDoc(…, { flattenAllForms: true })` → `form.flatten()` runs
on **every** source unconditionally, baking each widget's appearance into the page content stream and removing
the annotation. The opts param defaults false → byte-identical for the other 3 `_assemblePdfDoc` callers
(downloadPDF / downloadPageRange / assemblePdfBytes). Gated by `VITE_FEATURE_FLATTEN` (#28 seam, default ON;
`main.ts` removes the button when off). The app's own overlay annotations are already baked by `buildPageOverlays`;
source **markup** annotations (notes/stamps authored elsewhere) = ceiling **#62b** — pdf-lib has no generic
markup-flatten, and the redaction-rasterize path + PNG export already cover that nuclear case.
**Form FILLS are undoable (#QA-2026-06-23 P1 fix):** the form-overlay change callback routes through
`app.handleFormInput` → `UndoRedoController.handleFormInput`, which sets `_formValues` live AND coalesces a
burst of edits to one field into a single `SetFormValueCmd` (`src/core/commands/formCmds.ts`) recorded after a
500ms idle (mirrors `handleTextInput`); `undo()`/`redo()` **flush** the in-flight edit (record, not discard).
Undo reverts the stored value and the existing `renderCurrentPage` re-render repaints the overlay input. The
old direct `setFormValue` mutation in the callback is gone (it stays on the app only for bulk session restore).

### XFDF import/export (#57)

`src/utils/xfdf.ts` is a **pure** codec (`buildXfdf`/`parseXfdf` via the platform
`DOMParser`, no dep) over a normalized `XfdfAnnot` record in **PDF user space** (points, y-UP, bottom-left,
0-based page). `src/export/xfdfMapping.ts` does the editor-display(top-left,y-DOWN)↔user-space flip
(`elementToXfdfAnnot`/`xfdfAnnotToElement`) + `pageHeightPt` (blank→blankHeight, source→pdf.js viewport).
Maps **highlight↔`<highlight>`, comment↔`<text>` (sticky note), text↔`<freetext>`** both ways; other subtypes
return null (skipped, never mis-mapped). Export = `ExportService.exportXfdf` (XFDF↓ flyout button, plain
download); import = `PDFTurboApp.importXfdf(file)` (XFDF↑ button → hidden `xfdfInput`; builds elements with the
target page's id and adds them in ONE undoable `MacroCmd` — `app.elements` is a flat all-pages array filtered by
`pageId` at render, so multi-page import just sets the right pageId). Gated by `VITE_FEATURE_XFDF` (#28 seam).
**Non-obvious:** import constructs elements **directly** (not via `ElementFactory.fromJSON`, whose `applyBase`
overrides `el.id` with `data.id` → `undefined` when absent); the element constructor auto-assigns `id` via
`_nextId`. Ceiling **#57b**: ink/stamp/square/circle/line subtypes, multi-line highlight QuadPoints, freetext DA
font appearance (fontSize rides a non-standard attr for app round-trip; Acrobat ignores it), form `<fields>`
data, rotated-page coordinate transform. Acrobat byte-exactness is unverifiable in-repo (no Acrobat) — the
internal export→import round-trip (tests) is the correctness guarantee.

### Bates / page-numbering (#61 engine + #61b UI)

`src/export/batesStamp.ts` is a **pure** engine
(`batesStampText` page-mode `N / total` vs bates-mode `prefix+padStart(digits)`; `batesPosition` 6 anchors,
bottom-left origin) + `drawBatesOnPage` in `exportPipeline.ts`, threaded through **all** export paths
(`exportService.ts` passes `documentModel.bates` + the page's **full-document** `pageNumber`/`pageCount` into
`_applyOverlaysToPage`/`rasterizePageWithRedactions`/blank branch — so a single-page or range export still reads
"5 / 10"). UI = `src/ui/batesPanel.ts` (mirrors `watermarkPanel.ts` but **no preview canvas** — Bates is
export-only by design; reuses the `.watermark-modal`/`.wm-*` CSS, so no new layout). `documentModel.bates`
defaults **disabled** → export byte-identical (the engine `ctx.bates?.enabled` guard no-ops). **Non-obvious:**
(1) `SavedState.bates` is **optional with NO `SCHEMA_VERSION` bump** — a pre-#61b blob lacks it and restores via
the model-default fallback (`documentLoader.ts`: `state.bates ?? documentModel.bates`), so legacy sessions are
NOT discarded; (2) input coercion uses a NaN-safe `intOr` (NOT `parseInt(...) || fallback`) so a deliberately
typed `startNumber=0` is preserved (the engine emits `ACME-000000`) — the `|| fallback` idiom silently rewrote 0;
(3) Esc-to-close lives in `keyboardBinder.ts` (every modal needs its own branch there — `trapFocus` only handles
Tab); (4) `documentModel.toJSON()` now includes `bates` (it's dead code today but a future autosave refactor
calling it must not silently drop Bates). Gated `VITE_FEATURE_BATES` (#28 seam). **#61c deferred**: full
restore-path integration test, malformed-blob restore hardening, off-page huge-startNumber cap.

### PDF sanitizer (#53)

`src/utils/pdfSanitizer.ts` `sanitizePdf(bytes)` strips `/Info`, XMP
`/Metadata`, `/OpenAction`, `/AA` (catalog + every page), and `/Names→/JavaScript` +
`/Names→/EmbeddedFiles` via pdf-lib key-deletion (no new dep; 1.31 KB lazy chunk). **Non-obvious:
it MUST load with `PDFDocument.load(bytes, { updateMetadata: false })`** — the default `true`
makes pdf-lib re-stamp `/Info` Producer + ModDate at *load time* (constructor → `updateInfoDict`),
silently re-injecting the metadata you're stripping. The same applies to any verification re-load.
Wired via `ExportService.sanitizeAndDownload()` (🧹 export-flyout button) over the **assembled**
export, not the raw source. Redaction-completeness check is deferred (#53b).

### True text editing engine

`src/utils/contentStreamEditor.ts` can genuinely delete/
replace existing PDF text via content-stream surgery (position-matched, not index-matched).
Wired into the edit-text tool (2026-06-11): `textEditHandler` tries a true edit first
(inline floating input; Enter applies, empty deletes, Esc cancels) and falls back to the
overlay approach when no content-stream match is found. The edit swaps `SourcePdf.bytes`
+ pdfjs doc via `ReplaceSourcePdfBytesCmd` (undoable; old pdfjs docs stay alive on the
history stack by design). See the design doc (recoverable — see the note opening this section) for
remaining limitations (cm transforms, XObjects, Helvetica fallback font — Phase B/C).
**ISSUE-2 fix (2026-06-14):** `replaceTextAt` has 3 paths — (1) literal byte-swap, now GATED by
`isByteSwapUnsafeFont()` so it NEVER runs for subset/CID/embedded fonts (byte≠glyph there → was the
heading "data-loss" bug); (2) subset glyph reuse via ToUnicode (keeps original font for in-subset
edits); (3) standard-font redraw emitted as in-stream text operators in ONE `writeBack` (do NOT use
pdf-lib `page.drawText` after `setPageContent` — it orphans the redraw). XObject-embedded targets
refuse before blanking (no delete-without-replacement). Guarded by
`tests/browser/issue2-true-edit.browser.test.ts`. **Honest restyle font-substitution (Slice B,
2026-06-20):** `replaceTextAt` returns `false | true | 'substituted'` (was `boolean`). Path 1/2 →
`true` (original font KEPT); refuse → `false`; Path 3 → `'substituted'` **only when the original was a
non-standard embedded font** (`byteSwapUnsafe` = subset/CID/FontFile/Differences) — a Path-3 redraw of
an ALREADY-standard base-14 font (e.g. a Helvetica that couldn't byte-swap in place, or a bold/italic
restyle of one) returns plain `true`, since it's redrawn in the SAME family with no real loss (no false
alarm). `textEditHandler.commit()` surfaces `toast.trueEditFontSubstituted` only on `'substituted'`;
the delete and size/color-only in-stream paths (font kept) keep `toast.trueTextDeleted`/`trueTextEdited`.
The base-14 substitution CEILING is unchanged — this LABELS it. Guards:
`tests/browser/trueedit-restyle.browser.test.ts` + the engine/handler jsdom tests. **Sequential-edit ghost fix (2026-06-19):** Path 3
BLANKS the original show op IN PLACE (`()Tj` / `[]TJ`) and APPENDS the redraw at end-of-stream, so two
ops share the origin. `findTarget` used to pick the blanked ghost (lower opIndex wins the distance tie)
on the NEXT edit → the live redraw lingered and the new text overlaid it (the reported "second edit
resets / text on top of each other / underline frozen" bug — manifests on ANY Path-3 edit: CID/subset
fonts always, and standard fonts when a restyle forces Path 3). Fix: `findTarget` now SKIPS empty-payload
ops (`showOpPayload(...).trim()===''`) in both the page-stream and XObject loops, so delete/replace/the
decoration-resize all target the live redraw. An empty op shows nothing, so it is never a valid edit
target anyway. Guards: `tests/utils/contentStreamSequentialEdit.test.ts` (jsdom: visible-payload count)
+ `tests/browser/trueedit-sequential.browser.test.ts` (real Chrome pixels: wide→short far-zone bare,
delete clears, 3× edits latest-only, underline tracks the 2nd edit). **Honest fallback (#1, 2026-06-17):** maximal
in-place coverage ("Option 2") is structurally bounded — Path 1 (standard fonts) + Path 2 (reuse
glyphs ALREADY in the embedded subset) ARE the ceiling. A NEW character absent from a subset/CID font
has no glyph outline in the PDF, so it cannot be drawn in the original font client-side (→ Path 3
base-14 substitute, or refuse → overlay). So `_emitOverlay` now surfaces `toast.trueEditOverlay`
("couldn't edit in place — added an editable overlay") on EVERY fallback (Arabic / subset-new-glyph /
Form XObject / encrypted source) — no more silent surprise; the Arabic overlay itself renders
correctly via the #3/#3b bidi path. Guarded by the overlay-fallback case in
`tests/handlers/textEditHandler.test.ts`. **Text modes are SEPARATE (Sprint 3, reverted the
ISSUE-5 unification):** `editText` edits EXISTING source text only — a blank-canvas click drops NO box
(it re-shows the editText hint). New text is created with the draw-to-place `addText` tool (the
split-button default), which sizes by drag and auto-switches to `select`. The old blank-drop trapped
the user in `editText` where elements are `pointer-events:none` (`toolModeManager.setMode`), so the box
was unselectable and every further click spawned another. Guarded by `issue5-unified-text.browser.test.ts`.
**Sprint 2 fixes (2026-06-14):** (A-1) a refused edit at commit time is **no longer a silent no-op** —
the handler captures overlay context (bbox + sampled bg/fg) when the inline input opens and falls back
to the redact+text overlay via shared `_emitOverlay` when `replaceTextAt` returns false. (A-2)
`replaceShowOpHex` now replaces the full payload in the first `TJ` hexstring AND blanks every other hex
item (no stale glyphs). (A-3) `cmapHexToUnicodeStr` decodes ToUnicode as UTF-16BE code units +
surrogate pairs (the old length-parity guess was wrong for ligatures/non-BMP). (A-4) `blankAllNearby`
only blanks true shadow duplicates (same fontKey+size+payload, captured pre-mutation). (A-5) Type3 /
vertical (`-V`) / invisible-`Tr` (mode 3/7) text now **refuse** true-edit (→ overlay) via `isType3Font`/
`isVerticalWritingFont` + `renderMode` on `TextOpInfo`. **(B-3, 2026-06-15)** non-WinAnsi new text
(CJK/Cyrillic/emoji) also refuses the Path-3 standard-font redraw via `hasNonWinAnsi()` (the WinAnsi
base-14 fallback would paint '?') → overlay; joins the Arabic refusal. **(B-1, 2026-06-15)** the
content-stream tokenizer (`consumeNumberBody`) now keeps `1e-3`/`2.5E+2` as ONE number token (the old
`[0-9.]` class split the exponent, corrupting round-trips) — guarded so a lone `e` stays an operator.

### Private-method convention

`_underscore` prefix throughout; oxlint's `no-unused-vars`
allows unused args/vars only when `_`-prefixed (`argsIgnorePattern`/`varsIgnorePattern`).
`no-underscore-dangle` is deliberately OFF in `.oxlintrc.json` so it doesn't fight this convention.

### PDF→DOCX/MD export (beta)

`src/utils/flowDoc.ts` reconstructs a flow model
(lines→paragraphs→headings/styles/RTL/lists/2-column) from pdf.js text items;
`flowDocWriters.ts` emits DOCX (via `docx` npm, **dynamically imported** — keep it that
way, it's a ~395 KB lazy chunk) + Markdown + TXT. Source-PDF text only — overlay
annotations are NOT exported. Heuristic thresholds are font-size-relative.
**MD/TXT parity (2026-06-15):** the Markdown/TXT writers now carry ordered-list ordinals
(`orderedMarker` + `computeOrderedOrdinals`, sharing `orderedRefKey`'s instance logic with the
DOCX writer — letters/roman/decimal per `listFormat`), list nesting (`'  '.repeat(listDepth)`),
and images (data-URI `![]` in MD, `[image]` in TXT) — previously all three were dropped.
Phase 2 (2026-06-13): added 2-column XY-cut (`detectColumnSplit`) and list detection
(`detectListPrefix`).
Phase 3 (2026-06-13): native DOCX ordered-list numbering via `w:numPr` + instance-based
restart (separate lists separated by body text restart at 1). Tests now unpack the DOCX
ZIP with `fflate` and assert `w:numPr` presence and multi-instance `numId` divergence.
**Phase 4 (2026-06-13)**: images — `getOperatorList` OPS.paintImageXObject + CTM tracking
in `_extractFlowDoc` → `FlowImage` (x/y/w/h/base64/mimeType) on `FlowPage.images?` →
`ImageRun` in DOCX (appended after text per page; pt→px at 96 DPI). Canvas extraction
requires a real browser (`_extractFlowDoc` renders each image-bearing page off-screen first
to populate `page.objs` before iterating; pdfjs-dist v6 stores images as `{ width, height,
bitmap?: ImageBitmap }`, not HTMLCanvasElement — bitmap is drawn onto a temp canvas for
base64. Browser QA required to verify on unviewed/un-scrolled pages).
**ISSUE-3 fix (2026-06-14):** an image reused across ≥2 pages is promoted by pdf.js to
`page.commonObjs` with a `g_` name; extraction now resolves `g_`-prefixed names from `commonObjs`
(not just `page.objs`) — bitmap typed as `CanvasImageSource` (v6 bitmaps are `VideoFrame`). Guarded by
`tests/browser/issue3-docx-images.browser.test.ts`. **ISSUE-4 fix:** `exportAsDocx` emits a file when
there is text OR images (image-only PDFs export their images instead of a silent no-op). Also:
**export-path dedup** — extracted `_applyOverlaysToPage` + `_saveOrDownload` helpers
in `exportService.ts`, eliminating the triplicated 10-param `buildPageOverlays` block.
**Sprint 2 fidelity (2026-06-14):** (B-1) real font faces via 28-entry `WORD_FONT_ALLOWLIST` +
`resolveWordFont` (strips subset/style/foundry suffix; unknown → serif/sans/mono fallback) instead of
collapsing every face to 3 generics. (B-2) page margins from per-page text bbox (Q1/Q3, outlier-robust,
clamped to ≤40% page dim) → `w:pgMar`. (B-3) paragraph/line spacing from baseline gaps → `w:spacing`.
(B-4) images are **floating-anchored** at PDF coords (`wp:anchor`/`wp:posOffset`, Y-flipped EMU), no
longer centered-trailing — still via `word/media/` (ISSUE-3/4 guard). (B-5) justified detection
(`AlignmentType.JUSTIFIED`) + first-line/left `w:ind`; `isCentered` tightened so full-width justified
blocks aren't misread as centered. Verified by a real-Chrome DOCX export QA (margins/spacing/fonts/
floating-image XML all present, 0 console errors). New tests: `tests/utils/flowDocFidelity.test.ts`,
`flowDocExtraction.test.ts`.
**Sprint 3 (2026-06-15):** ordered-list markers widened — `detectListPrefix` now recognizes decimal
`(1)`/`1)`, and lower/upper-alpha **paren forms** `a)`/`(a)`/`A)`/`(A)` (NEVER bare-dot `a.`/`A.`/`I.`,
to dodge author-initials), each carrying a docx `LevelFormat` (decimal/lowerLetter/upperLetter). The
writer maps each distinct (format,text) to its own numbering reference — legacy decimal `%1.` keeps the
`ordered-list` id — and restarts instances per-reference. `flowDocWriters.ts` `refKeyOf`/`usedRefs`.
**Fidelity scorecards** (honest done/reachable/ceiling).
**Sprint 3 batch 2 (2026-06-14) — DONE:** (1) **DOCX hyperlinks** — `exportService` reads
`page.getAnnotations()` (Link+url), passes `FlowLinkRect[]` to `reconstructPage`, which bbox-tags words
(`FlowRun.linkUrl`, in the merge key); the writer wraps same-url runs in `ExternalHyperlink` (blue +
underline) and the MD writer emits `[text](url)`. (2) **DOCX JPEG re-encode** — `pickImageMime`
(`flowDoc.ts`): alpha→PNG, large opaque (≥200×200)→JPEG q0.85; extraction samples canvas alpha + picks
the mime (was hardcoded PNG → multi-MB scans). (3) **List nesting** — `para.listDepth` now derived from
item x0 indent vs `colLeft` in font-size units (was hardcoded 0). (4) **Headings H4–H6** — `heading`
type widened to `0..6`, `assignHeadings` `slice(0,6)`, writer `HEADINGS` extended. (5) **True-edit TJ
kerning preservation** (biggest-ROI) — `replaceShowOpInPlace`/`replaceShowOpHex` now DISTRIBUTE the new
text across the existing TJ string/hex segments by original char/byte counts (last segment absorbs the
length delta) instead of collapsing/jamming into one segment — kerning numbers survive, neighbour glyphs
stop shifting. New `decodeLiteralString` measures segment lengths. The A2 no-stale-glyph guarantee still
holds. Guards: `tests/utils/{flowDoc,flowDocWriters,flowDocHyperlinks,flowDocImageMime,contentStreamEditor}.test.ts`
+ `tests/browser/issue3-docx-images.browser.test.ts` (Gap 7 JPEG).
**Sprint 4 fidelity DONE (2026-06-15):** super/subscript + roman lists (50ac4d5); spot-color/Separation
black-collapse fixed via the v6 hex-string color path (d7879fb). **(b) underline/strikethrough** —
`classifyRuleAsUnderline(rule, run)` (pure, y-up PDF space) matches thin filled/stroked rules from the
export op-walk to text-run baselines; rules are collected by decoding v6 `constructPath` args
`[paintOp, pathData, minMax]` and transforming the path-local minMax bbox by the CTM into Word space
(`Word.x/y = it.transform[4]/[5]`, the same space) → `FlowRun.underline/strikethrough` → docx `w:u`/`w:strike`.
Thresholds: height ≤ 0.18×fontSize (rejects shading), width > 3×height (rejects vertical bars), ≥50%
x-overlap, baseline band dy∈[-0.35,0.10]×size (underline) / [0.18,0.62] (strike). **(d) rotated-image
sizing** — `decomposeImageCtm([a,b,c,d,e,f])` → {scaleX,scaleY,rotation}; image extraction uses scaleX/scaleY
for true on-page size and stores `FlowImage.rotation` → docx `transformation.rotation` (DEGREES; docx
converts to 60000ths — NOT EMU). Guards: `tests/utils/flowDocUnderlineStrike.test.ts` (9),
`flowDocImageRotation.test.ts` (7), writer XML tests, `tests/browser/underline-strike.browser.test.ts`
(real pdf.js op-list → reconstructPage → DOCX e2e).
**List continuation merge DONE (2026-06-15):** a wrapped list item whose continuation line split into a
separate marker-less paragraph used to reset the writer's numbering instance (next item restarted at 1).
`reconstructColumn` now re-absorbs a single-line, body-sized, hanging-INDENTED (right of the marker),
marker-less paragraph directly after a list item back into that item — genuine body paragraphs (start at
the column-left edge) and real list items (carry a marker) stay separate. Guard: `tests/utils/flowDoc.test.ts`
(`reconstructColumn — wrapped list-item continuation merge`).
**Number-tokenizer exponent already DONE (B-1):** `consumeNumberBody` keeps `1e-3`/`2.5E+2` as one token in
BOTH the main loop and `tokenizeOne` (array parser) — verified 2026-06-15.
**Path-3 fill-color canvas-sample DONE (`d7879fb`, e2e-guarded 2026-06-15):** `resolveRedrawColor`
(precedence: style override > parsed `rg`/`g`/`k` > canvas-sampled `fallbackColor` > black) +
`replaceTextAt(…, fallbackColor)`; `textEditHandler` passes `sampledFallback =
hexToRgb01(overlayContext.textColor)` (the glyph color sampled in `_buildOverlayContext`), so
Separation/spot (`scn`) text no longer redraws black. Guards: `tests/utils/contentStreamColor.test.ts`
(pure `resolveRedrawColor`, incl. the scn-fallback case) + `tests/browser/truedit-spot-color.browser.test.ts`
(real pdf.js render of a Separation colorspace → forces Path-3 via Helvetica `é` edit → asserts the
redrawn glyph stays chromatic, and a no-fallback control redraws black). **All three `02-trueedit-matrix.md`
"reachable gaps" are now done** (Gap 1 TJ-kerning distribute, Gap 2 this, Gap 3 exponent).
**Ceiling** (genuinely hard client-side): lattice/borderless tables, vector→raster, recursive 3-col
XY-cut, exact subset-font faces; true-edit IN-PLACE Arabic (subset CID fonts lack the glyphs — structural),
true-edit cm-rotation Path-3 redraw, Type3; mixed LTR+RTL single-line reorder; tashkeel GPOS positioning.
**Decoration + graphics-state fidelity (#text-decoration, 2026-06-18):** PDF has NO underline/strike TEXT
attribute — they're SEPARATE thin filled `re` rects whose width is decoupled from the text, so a true-edit
that changed text LENGTH used to leave the rule frozen (longer edit → un-underlined tail; the reported bug).
`replaceTextAt`/`deleteTextAt` take `opts.adjustDecorations` (wired from `isEnabled('textDecor')`, #28 seam,
default ON; PURE behavior gate — no UI button, so vite needs NO define, env-undefined→ON like every flag).
Pure helpers in `contentStreamEditor.ts`: `locateDecorationRects` (CTM-aware walk, USER space) collects BOTH
decoration encodings — filled `re`+fill-painter rects (`kind:'rect'`) AND horizontal stroked lines
`mx my m  lx ly l  S` (`kind:'line'`, the Word/LibreOffice underline form; `DecorationRule` is a discriminated
union) → `matchDecorationForText` (reuses the export `classifyRuleAsUnderline` baseline-band+≥50%-overlap
classifier — SINGLE candidate only, else refuse) → `adjustedRuleWidth` (scale by new/old text-width ratio
measured in the matched standard font → path- AND scale-invariant; the old rule already bakes in Tz/CTM and
we keep them, so the ratio cancels — no separate hScale math; div-by-0 guarded). Resize rewrites the rect's
width operand OR the line's `l` endpoint x (relative to the fixed `m` anchor, draw-direction-preserving) IN
the same `writeBack` → atomic + undoable via the existing `ReplaceSourcePdfBytesCmd` (NO new command, NO schema
bump). Delete neutralises the paint op to `n` (fill for rect, stroke `S` for line) + clears its operands.
**The stroked-LINE form is the real-file fix (2026-06-19):** the original 2026-06-18 ship handled ONLY filled
`re` rects, so Word/LibreOffice underlines (drawn as `m…l…S`) stayed frozen — the reported "still not
propagated" symptom = a successful in-place edit whose stroked rule was refused, NOT the overlay path.
**NEGATIVE-height bbox normalization (#bg-fill, 2026-06-20):** PDF `re` allows a NEGATIVE height — iText/
JasperReports draw filled background BANDS top-down as `x y w -h re f` (real-world: a Navigo/IDFM invoice's
blue header band = `0.553 0.702 0.886 rg 27 719 540 -66 re f`). `locateDecorationRects` stored the SIGNED height,
and `classifyRuleAsUnderline`'s "too tall to be a decoration" guard `rule.height > 0.18*fontSize` is DEFEATED by a
negative value (`-66 > 1.98` is false) — so a 66pt full-width background fill was misclassified as the subtitle's
strikethrough and its width resized 540→120pt, WIPING the band (the reported "background color changes" bug; only
fired for runs whose baseline fell in the mis-computed band, e.g. the size-11 subtitle, not the size-18 heading —
hence "sometimes"). Fix: `locateDecorationRects` normalizes every `re` to its true positive bbox (`y0 = h<0 ? y+h : y`,
`height = |h|`); a genuine thin top-down underline normalizes to a thin positive height and still matches. Width keeps
its sign (a negative-width rect is already rejected by the classifier, so the width-operand resize never touches it).
Guard: `tests/utils/contentStreamEditor.test.ts` ("REFUSES a tall background rect drawn with NEGATIVE height" + the
thin-underline no-regression case).
**Non-obvious REFUSE gates (each = leave PDF unchanged, never guess):** sheared/rotated CTM (b or c ≠ 0); >1
in-band rule (double underline); a SLANTED line (m/l y differ) or POLYLINE (≥2 `l`); `s` (closepath+stroke,
ambiguous closing segment) — only plain `S`; and a rect/line whose painter ALSO closes an `m/l/c/v/y/h`
subpath (neutralising it would erase that vector art), refused via `sawOtherPath` + the single-segment
counts. **F10 + F13 + F3 byte-splice DONE (2026-06-24):**
**F10** — `prepareDecorationResize` now refuses (returns the null mutator) when the target run is `tilted`
(sheared/rotated/non-uniformly-scaled `textMatrix×CTM`; reuses the existing flag — NOT a new `tmTilted` — that
`addDecorationAt` already gates on), beside the F6 text-rise gate; the text edit still proceeds, only the
decoration geometry is left untouched. **F13** — new pure `ctmStackUnderflows(ops)` (a `Q` popping an empty
graphics-state stack) gates the same function (stale CTM ⇒ decoration geometry unreliable). **F3 hybrid
byte-splice (the deferred rewrite, now SHIPPED):** the tokenizer stamps `byteStart`/`byteEnd` on every `CsToken`
and `groupOps` stamps the op span on every `CsOp`; `findTarget` snapshots `source` + `origSerialized` (per-op
`serializeOp`) onto `EditTarget` pre-mutation; new `buildStreamContent(found, appendedTail)` diffs mutated-vs-snapshot
ops — **exactly ONE op changed (valid span) → splice that op's bytes into the original `source`, every other byte
(incl. inline-image/binary) verbatim + append the tail; ZERO ops changed + a tail (addDecorationAt) → keep `source`
verbatim + append; else → today's `serializeOps` (zero regression)**. `writeBack` (delete/size/color/Path1/Path2),
Path 3 (`+redraw`), and `addDecorationAt` (`+block`) all route through it; `redraw`/`block` already start with `\n`
so the fallback is byte-identical to the old `serializeOps(ops)+tail`. The F12 multi-stream PRESERVATION bound is
unchanged (an XObject edit writes that one stream via the builder). Guards: `tests/utils/contentStreamEditor.test.ts`
(F10 tilted-refuse, F13 `ctmStackUnderflows`+gate, byte-offset slice-back, `serializeOp`, `buildStreamContent`
splice/fallback/inline-image) + `tests/browser/trueedit-bytesplice.browser.test.ts` (real Chrome: inline image
survives a one-word edit byte-identical AND pdf.js renders the spliced stream). **Edge-case hardening F5–F8 (2026-06-20 audit):** F5 — `locateDecorationRects` now also refuses a **mirror / negative-scale CTM** (`ctm[0]<0 ||
ctm[3]<0`; flip-X/flip-Y/180°) for BOTH rect and stroked line (the line path uses `abs()` so a mirror silently
flipped resize direction; the `re` path was safe-by-luck only). F6 — `prepareDecorationResize` refuses when the
target run carries a non-zero **text rise (`Ts`, super/subscript)**: its reported baseline (origin.y, no rise
applied) is low-confidence and could match an unrelated nearby rule (cm-only sizing without Tm scale remains a
documented ceiling). F7 — the inline-image tokenizer (`findInlineImageEnd`) now scans for a **whitespace-delimited
`EI`** (preceded by whitespace, followed by ws/delimiter/EOF) from after the `ID` marker, falling back to the
legacy first-`EI` — a bare `indexOf('EI')` matched the byte pair "EI" inside binary image data and truncated the
image, corrupting the whole page on re-serialize (the one concrete corruption vector F3 would also have closed).
F8 — `locateTextOps` captures the `"` show op's `aw ac` operands as persistent word/char spacing (spec: `"` ≡
`aw Tw ac Tc string '`) so a later Path-3 redraw of that run uses correct spacing. **F9 — Path-3 build-then-blank
ordering:** `replaceTextAt` used to `blankShowOp` the original BEFORE embedding/encoding the redraw font, so any
throw in `embedFont`/`encodeText` (a CP1252-high char `€`/`Œ` whose base-14 AFM lacks a width) destroyed the
original with no replacement (silent data loss). It now builds the redraw string + runs the decoration resize
inside a `try`, and only blanks once the redraw is guaranteed; on throw it `return false` → the caller's overlay
fallback, original untouched. Success-path byte-output is unchanged (still blank + appended redraw). Path-3 redraw re-emits captured `Tc`/`Tw`/`Tz`/`Ts` — and (F2, 2026-06-19) `Tr` render mode + stroke
color (`RG`/`G`/`K`/`SC`/`SCN`, reset on `CS`) + line width (`w`) so stroked/outline text keeps its outline —
via `buildPath3Redraw`; `locateTextOps` stamps them onto `TextOpInfo` only when non-default → byte-identical for
plain ops. **F1 restyle (2026-06-19):** `replaceTextAt` computes `wantsRestyle` (style carries
bold/italic/fontFamily/color/fontSize) and SKIPS Path 1 & Path 2 → forces the isolated Path-3 redraw (the only
path that applies `style`; its own `q…Q` block, no neighbour bleed) — previously Path 1/2 swapped bytes and
silently dropped the restyle. No `style` ⇒ Path 1/2 byte-identical; a restyle Path 3 refuses (Arabic/non-WinAnsi/
XObject) → handler overlay carries the style. P2 (documented): stroke `w` line-width is not q/Q-stack-restored,
so a stale `w` may feed a wrong `height` to classification — affects match acceptance only (never resize geometry),
and a false match still requires a thin horizontal baseline-band line >50% across the text (= an underline).
**Text-attribute inventory (#text-attr, 2026-06-19) — what a true-edit preserves:** Path 1 (literal byte-swap)
and Path 2 (subset hex) mutate ONLY the show-op operand, so they preserve EVERY surrounding attribute by
construction (font/size/fill/stroke/Tc/Tw/Tz/Ts/Tr/Tm/CTM/alpha/dash/clip). Path 3 (standard-font redraw) is the
ONLY lossy path — it is appended at **end-of-stream** in an isolated `q…Q`, so it inherits the DEFAULT graphics
state and must re-emit each attribute explicitly: it DOES re-emit fill/font/size/Tc/Tw/Tz/Ts/Tr/stroke/`w` and
applies `style`. **Path-3 ceilings (all rare, all documented, no real-file repro → not coded):** (1) Tm
rotation/skew + CTM scale/rotation flattened to an axis-aligned `1 0 0 1 x y Tm` (F3/F4, the same cm-rotation
ceiling above); (2) embedded font face → standard substitute (the core Path-3 tradeoff — glyph shapes/metrics
shift slightly); (3) **ExtGState alpha (`ca`/`CA`)** is NOT captured by `locateTextOps`, so semi-transparent
(watermark/faded) text redraws fully opaque; (4) **line dash / cap / join** on stroked/outline text are not
captured → a dashed outline redraws solid; (5) **text-clip render modes 4–6** keep their FILL (visible) but lose
the clip side-effect (the appended redraw is past all page content, so nothing downstream is clipped) — modes
3/7 (invisible/clip-only) are refused → overlay. F1/F2 (restyle + stroke/width/Tr) shipped `9d67b84`; common-case
edits (Path 1/2 + the Path-3 attrs above) are fully covered.
**Max-fidelity Sub-project A (2026-06-25):** five fidelity gains, all gated/additive →
byte-identical at defaults. **A2 (`14f5a55`) Path-3 alpha:** `locateTextOps` records the active ExtGState resource
name; a Path-3 redraw of semi-transparent (watermark/faded) text recovers its `ca`/`CA` via `lookupExtGStateAlpha`
and, when alpha<1, `addPageExtGStateResource` adds a fresh ExtGState that `buildPath3Redraw` re-emits via `/GSx gs`
(was redrawn opaque). **A3a (`a5bc8f3`) XObject Path-1/2 true-edit:** font introspection is now XObject-aware — a
shared `getFontResourceDict` + optional `xObjectName` on `getPageFontEntry`/`isByteSwapUnsafeFont`/
`getPageFontToUnicode`/`getPageFontBaseName`/`getPageFontDescriptor`, so an XObject target's REAL font is seen
(else the page lookup misses it and defaults byte-swap-SAFE → Path-1 would corrupt an XObject CID font — the key
trap). New `isPath3OnlyTarget` gates `getEditableTextAt` + the `textEditHandler` hit: a Path-1/2-safe XObject target
edits in place (`writeBack`→`setFormXObjectContent`), a Path-3-only one overlays. `TextOpInfo.xObjectName` is
stamped by `findTarget`. **A1 (`6586c23`) Path-3 full affine:** `locateTextOps` captures the text→user linear
matrix (`textMatrix×CTM`) when non-identity + the BASE `Tf` size; `buildPath3Redraw` emits that matrix as the Tm
(was hard-coded identity) using the base size (or the scale double-applies) → rotated/scaled/sheared text redraws
in place instead of upright. **A3b (`5d0cb2e`) XObject Path-3:** the Path-3-in-XObject refuse is lifted — the
target's origin/textMatrix are XObject-LOCAL (the `Do` re-applies the page CTM at render), so the redraw writes the
XObject's own stream via `setFormXObjectContent` with the substitute font/gs added to the XObject's `/Resources`
(`getResourcesDict`/`ensureResourceSubDict`, XObject-aware `addPageFontResource`/`addPageExtGStateResource`); an
unresolvable XObject dict refuses → overlay. **A6 (`3b9a553`) polish:** A6a re-emits stroke dash/cap/join (`d`/`J`/
`j`) on a Path-3 outline redraw; A6b measures the decoration resize's new width at the NEW font size on a
size-change edit; A6c is a guard test for the already-correct rotated-page inline-input placement (anchored at the
click point). **Audit dropped A4 (Path-3 bold/italic face — already wired via `matchStandardFont :2027`) and A5
(non-WinAnsi/ligature refuse — already `hasNonWinAnsi :2004`) as ALREADY SHIPPED** (stale scorecards; code is
truth). Guards: the A1/A2/A3a/A6 cases in `tests/utils/contentStreamEditor.test.ts` + the rotated/XObject cases in
`tests/handlers/textEditHandler.test.ts` + `tests/browser/{trueedit-alpha,trueedit-xobject,trueedit-transform}.browser.test.ts`.
**Embedded-advance width (#text-decoration-width, 2026-06-19, fixes the "underline trails past the added text"
overshoot):** the resize scales the old rule by `newTextWidth/oldTextWidth`. Path 1/2 keep the EMBEDDED font, but
the widths used to be measured in a base-14 PROXY whose per-glyph metrics differ (measured: a real invoice font's
tabular DIGITS are ~25% wider than Helvetica's — proxy/actual 0.80 for digits vs 0.99 for letters), so any edit
that shifted the digit/letter MIX drifted the rule (adding letters to a digit run → overshoot tail). Now
`prepareDecorationResize` measures with the font's OWN advances via `getPageFontGlyphWidths` (CID `/W`+`/DW`,
**Identity encodings only** — else show-code ≠ CID; or simple `/Widths`+`/FirstChar`) + pure `embeddedTextWidth`
(maps each char→code via the ToUnicode reverse map, sums advances; null if any char unmapped → proxy fallback).
The closure gained `forceProxy`: **Path 3 passes it `true`** (it redraws in the standard font, so the proxy IS the
render font there); Path 1/2 default false. **Scoped by `reverseMap.size > 0`** → a base-14 font with no ToUnicode
keeps the proxy (which is exact there), so the Helvetica decoration tests are byte-unchanged. As a bonus, the
proxy font is now embedded only on the fallback, so the prior "tiny orphan font dict on every match" is gone in
the common case. **Path-3 absolute-anchor (2026-06-19, fixes the real-file overshoot the embedded-advance fix did
NOT reach):** on a PDF whose every font is a CID/Identity-H subset with **no ToUnicode** (a real Word/LibreOffice
invoice), `getPageFontGlyphWidths` returns null AND the reverseMap is empty, so the embedded path can't engage and
the edit takes **Path 3** (standard-font redraw). There `forceProxy=true`, and scaling `R_old` by `proxyNew/proxyOld`
OVERSHOOTS because `R_old` came from the ORIGINAL embedded font (`R_old ≠ proxyWidth(oldText)`) — measured live:
167.6pt rule × 1.539 (HelveticaBold ratio) = 258pt vs the 212pt the redraw actually renders → a ~46pt tail. Fix:
when `forceProxy`, set the rule to the **absolute redrawn width** `newW × (Tz hScale/100)` (the proxy IS the render
font in Path 3, starting at the same left edge), NOT `R_old × ratio`. Verified on the real file via the live app +
canvas pixel scan: overshoot 66px → 1px. Path 1/2 keep the ratio (correct there, `R_old` = embedded oldW). Known
P2: a Path-3 edit that ALSO changes fontSize measures `newW` at `target.fontSize`, not the new size (rare). **Ceiling #text-decoration-b:** highlight/background-rect resize, `re`-drawn-as-stroke (`re S`)
underline, decorations inside Form XObjects, rotated-CTM rects/lines; non-Identity CID encodings + ligature
ToUnicode keys fall back to the (approximate) proxy. Guards: `tests/utils/contentStreamEditor.test.ts` (rect+line
locate/match/adjust/redraw/capture/resize/delete + slanted/polyline/sheared/co-painted refusals;
`getPageFontGlyphWidths`/`embeddedTextWidth` CID-`/W` read + non-Identity null; a CID-digit underline that resizes
to the embedded width 26.4pt, NOT the 38.4pt proxy overshoot), `tests/browser/trueedit-underline-resize.browser.test.ts`
(real pdf.js pixels: BOTH rect and stroked-line underline extend under the new tail; OFF controls leave it bare).
**Richer PDF text toolbar (2026-06-21) — three sub-items.** The formatting toolbar (`index.html`) gained
**Underline / Strikethrough / Align** buttons (`underlineBtn`/`strikeBtn`/`alignBtn`), wired in
`formattingBinder.ts` → `pdfTurboApp` delegators → `FormattingService.toggleUnderline`/`toggleStrikethrough`/
`cycleAlign` (each a `MoveResizeCmd`, early-returns without a selected TextElement). **(C) overlay TextElement**
carries `underline`/`strikethrough`/`align` (`textElement.ts` + `elementFactory.ts`, **no SCHEMA_VERSION bump** —
the three are optional, `toJSON` omits when unset); DOM render sets `text-decoration`/`text-align`, and the
export bake (`pdfElementRenderer.renderText`) draws the lines via `page.drawLine` + applies an alignment x-offset
(`font.widthOfTextAtSize`). Decorations are gated `if (!elemRot && …)` — the rotation signal is **`elemRot`**
(numeric, 0 = unrotated), NOT `pdfRotVal` (= `degrees(-0)`, truthy even at 0°); rotated-element decoration is the
ceiling. **(B1) dead Bold/Italic during a true edit FIXED:** the toolbar's B/I clicks route to
`FormattingService.toggle*` which early-return with no selected element, so `btn-active-fmt` (which `commit()`
reads) never flipped. `textEditHandler._openTrueEditInput` now attaches **session-local** click toggles on
bold/italic (and underline/strike) that flip the class directly, removed on close so they never leak to
element-formatting clicks. **(B2) NEW underline/strike on true-edited EXISTING text** — `addDecorationAt(doc,
pageIndex, point, kind, tol)` appends a **standalone stroked line** (`buildStandaloneDecoration` → `q w RG m l S Q`)
at the text baseline, KEEPING the original font (no Path-3 substitution). Width is measured in the font's OWN
advances (`getPageFontGlyphWidths`/`embeddedTextWidth`) with a standard-font proxy fallback, × the `Tz` hScale;
underline sits at `baseline − 0.1·size`, strike at `baseline + 0.28·size`. **Refuse gates (leave PDF unchanged):**
a new `TextOpInfo.tilted` flag (set in `locateTextOps` when the text→user transform `textMatrix × CTM` is
rotated / sheared / non-uniformly scaled beyond Tz) and invisible render mode 3/7 and undecodable text. Wired in
`commit()` as ADD-only toggles (start OFF): a decoration-only commit takes the in-stream fast path + a no-op-save
guard; bold/text edits run `replaceTextAt` first, then `applyDecorations` appends to the (already-edited) doc
before save — both undoable via the existing `ReplaceSourcePdfBytesCmd`. Gated by the `textDecor` seam (default
ON). Guards: `tests/utils/contentStreamEditor.test.ts` (buildStandaloneDecoration + addDecorationAt underline/
strike geometry + tilted/no-match refusals), `tests/handlers/textEditHandler.test.ts` (decoration-only commit
calls addDecorationAt; no-toggle = no add + no save), `tests/browser/trueedit-add-decoration.browser.test.ts`
(real pdf.js pixels: underline below baseline, strike through glyph body, none cross-contaminates). Verified
live (synthetic PDF, screenshots in `qa-shots/b2-session/`): bold + underline + bold-underline all apply
in-place, same font, no overlay.
**Rich text toolbar Slice 1 (2026-06-21)** — 8 Tier-1 controls on overlay `TextElement`s via inline buttons + a
new "Text ⋮" popover (`src/ui/textOptionsPopover.ts`, **app-owned**, mirrors `batesPanel`; Esc branch added to
`keyboardBinder.ts`). New OPTIONAL `TextElement` fields `backgroundColor`/`lineHeight`/`opacity` (**no
SCHEMA_VERSION bump**; `toJSON` omits when unset, `elementFactory.fromJSON` reads with `?? default` so legacy
blobs restore). All mutations route through `FormattingService`: `setAlign`, `setLineHeight` (clamp 1–3),
`setTextOpacity` (clamp 0–1), `setTextBackground`/`clearTextBackground`, `transformCase` (pure
`src/utils/textCase.ts`, title-case preserves whitespace via capture-group split), `clearFormatting` (resets 10
fmt fields in ONE `MoveResizeCmd`, NOT `text`), and the **format painter** (`copyTextStyle`→`pasteTextStyle`,
`painterArmed`/`cancelPainter`; paste-on-select hook in `pdfTurboApp.selectElement`, armed-state cleared on
document load via `resetDocumentModel` so it can't leak across PDFs). Color presets/recent = pure
`src/utils/recentColors.ts` (localStorage try/catch, cap 8) rendered as a swatch row in `main.ts` (swatch click
sets `colorInput.value` + applies). Bake (`pdfElementRenderer.renderText`): bg rect (gated `!elemRot`, anchored
via the shared highlight/redaction `anchorForCenter`) + `fontSize * (lineHeight ?? 1.2)` + `opacity ?? 1` threaded
to text/decoration/rect. Discrete **L/C/R align buttons** (the old cycle stays for back-compat); the active one
gets `btn-active-fmt`, synced in `uiController.updateFormattingToolbar`. **Non-obvious:** (1) the **raster export
path** (`exportPipeline.ts`, used for redaction-bearing pages + thumbnails) honors lineHeight/opacity/
backgroundColor because it calls the SAME `renderText` — **corrected 2026-07-31**: this used to claim
`globalAlpha` scoped inside `ctx.save()/restore()`, which describes code that does not exist (`globalAlpha`
appears nowhere in `src/`; the only `ctx.save()/restore()` pair in `exportPipeline.ts` is in the **ink stroke**
rasterizer). There is exactly ONE text renderer, and `rasterizePageWithRedactions` runs it via
`buildPageOverlays` BEFORE rasterizing, so the attrs ride the pixel-guarded vector code. What was genuinely
unguarded is their survival through the extra **rasterize → `embedPng` round-trip**, now covered by
`tests/browser/raster-text-attrs.browser.test.ts` (opacity 0.5 must read PINK, not red — injecting
`opacity: 1` on the bg rect fails that case and only that case); (2) the editor `<textarea>` preview now sets
`style.lineHeight` (`_applyInputFormatting`) for parity with the bake. No feature flag (additive core-toolbar
improvement). Guards:
`tests/core/formattingService.test.ts`, `tests/utils/{textCase,recentColors}.test.ts`,
`tests/ui/{textOptionsPopover,uiController}.test.ts`, `tests/browser/{text-toolbar,text-toolbar-bake}.browser.test.ts`.
**Backlog/ceiling (Slice 2+):** Tier-2 (stroke/outline, char-spacing `Tc`, horizontal-scale `Tz`, justify,
whole-box sub/superscript), find&replace on overlay text, links, bullet/numbered lists, multi-run rich text
(ceiling); RTL direction-aware controls are gated behind the open Arabic-RTL P1 overflow defect.
**Rich text toolbar Slice 2 (Tier-2, 2026-06-21)** — 5 advanced controls on overlay `TextElement`s: text
**stroke/outline**, **character spacing** (`Tc`), **horizontal scale** (`Tz`), **justify** align, and whole-box
**super/subscript**. New OPTIONAL `TextElement` fields `strokeWidth`/`charSpacing`/`horizontalScale`/
`baselineShift:'super'|'sub'` + `TextAlign` widened to include `'justify'` (**no SCHEMA_VERSION bump**; `toJSON`
omits when unset, `elementFactory.fromJSON` rehydrates with type guards → legacy blobs restore). **The outline has
NO separate stroke color — it is painted in the element's OWN fill color** (the shared Slice-1 palette: presets +
recent + `#colorSwatchRow`); the Outline control is **width-only** (a standalone `<input type=color>` was removed as
a palette duplication, user call 2026-06-21). Mutations route
through `FormattingService`: `setTextStroke(width)`/`clearTextStroke`, `setCharSpacing` (clamp −5..20), `setHorizontalScale`
(clamp 50..200), `setBaselineShift('super'|'sub'|null)`, justify via the existing `setAlign('justify')` — each a
`MoveResizeCmd`, NaN-safe clamps (`Number.isFinite`, never `parseFloat(...)||x`), and `clearFormatting`/the format
painter carry all 5. **The core is the raw-operator bake** `src/export/styledText.ts` (`hasAdvancedText(te)`,
`effectiveLineWidth(font,line,size,charSpacing,horizontalScale)`, `drawStyledTextLine(page,opts)` via
`page.pushOperators` — the `arabicOverlay.ts` pattern): `renderText` takes the operator path **ONLY when
`hasAdvancedText(te) && !elemRot`**, else the existing `page.drawText` runs UNCHANGED → **byte-identical export for
every element without an advanced attr** (real-Chrome-guarded). **Non-obvious:** (1) stroke = render mode 2 via
`TextRenderingMode.FillAndOutline` (NOT `FillThenStroke`, which does not exist in `@cantoo/pdf-lib`) + `RG`(= the
fill color)/`w`;
(2) `Tz` has no named helper → `PDFOperator.of(PDFOperatorNames.SetTextHorizontalScaling, [PDFNumber.of(pct)])`;
(3) opacity reuses `page.maybeEmbedGraphicsState({opacity,borderOpacity})` (it's **private** → localized `(page as
any)` cast, gated `advanced && alpha<1`); (4) justify distributes `Tw = (boxW−lineW)/spaces` on NON-last lines only
(single/last line → normal alignment offset); (5) sub/super = 0.65× draw size + `Ts` rise (super +0.33×fontSize,
sub −0.15×fontSize); (6) the popover super/sub buttons **toggle** — re-clicking the active one clears to baseline
(reads `ctx.selectedText.baselineShift`); they stay mutually exclusive. UI: inline **J** button beside L/C/R
(`formattingBinder` → `app.setAlign`) + 4 popover rows wired in `textOptionsPopover.ts` (outline **width** (no
color — uses fill), letter-spacing, width%, x²/x₂); `uiController.updateFormattingToolbar` toggles `btn-active-fmt` + reflects values;
i18n `formatting.{justify,stroke,charSpacing,horizontalScale,baseline,superscript,subscript}` in en/fr/ar (ar
status UNRECONCILED — see § i18n; these predate the 2026-07-30 sign-off and carried the marker at that
date, so they were probably in the 31 reviewed and this marker is merely stale, but the repo cannot
prove it either way). No feature flag (additive). **Ceilings:** rotated element + advanced attr → `drawText` fallback
(attrs ignored, consistent with the `!elemRot` decoration gating); the Arabic overlay path NOW applies stroke/Tc/Tz
too (Feature 4, 2026-06-24 — see below); the **raster export path** (`exportPipeline.ts`, redaction pages +
thumbnails) applies these attrs through the same `renderText` and its rasterize round-trip is pixel-guarded
since 2026-07-31 by `tests/browser/raster-text-attrs.browser.test.ts` (see the correction in Slice 1 above —
`stroke`/`Tc`/`Tz` specifically are still vector-guarded only). Guards: `tests/export/styledText.test.ts`
(pure `hasAdvancedText`/`effectiveLineWidth`), `tests/core/formattingService.test.ts`, `tests/ui/{textOptionsPopover,
uiController}.test.ts`, `tests/browser/text-toolbar-slice2.browser.test.ts` (real Chrome: pdf.js OPS-38
`setTextRenderingMode` present in styled / ABSENT in plain → catches a silent regression to `drawText`).
**Backlog (Slice 3+):** RTL direction-aware controls, per-run/multi-run rich text (ceiling), true-edit of these
attrs. (find&replace on overlay text DONE `3b24c99`; bullet/numbered lists + overlay links + stroke/Tc/Tz on the
Arabic overlay DONE — see below.)
**Overlay bullet / numbered lists (Feature 2, 2026-06-24):** `TextElement.list?: 'bullet' | 'ordered'`
(OPTIONAL, **no `SCHEMA_VERSION` bump**; `toJSON` omits when unset, `elementFactory` reads with a type
guard → legacy blobs restore). One `\n`-line = one item (the overlay bake never auto-wraps). Pure
`src/utils/listMarkers.ts` (`listMarker(kind,ordinal)` → `'• '` / `'N. '`; `applyListMarkers(text,kind)`
prefixes each NON-EMPTY line, ordered ordinals count non-empty lines 1-based, blanks pass through). The
EXPORT is a single edit in `pdfElementRenderer.renderText` — `const lines = te.list ?
applyListMarkers(te.text, te.list) : te.text.split('\n')` — so markers ride through alignment/decoration/
the advanced-operator path AND the redaction-raster path (both go through `buildPageOverlays`→`renderText`);
**byte-identical when `list` unset**. The editor preview is a non-editable **marker gutter** (`.text-list-gutter`
in `editor.css`, built in `textElement.render()` with the input's font metrics, `pointer-events:none`, input
gets `padding-left`) — markers are kept OUT of `this.text` (no fragile prefix-and-strip that could eat a line
the user typed as "3. foo"). Mutations: `FormattingService.setListType(kind|null)`/`toggleList(kind)`
(`MoveResizeCmd`, undoable, in `clearFormatting` + format-painter set); UI = two toggle buttons in the Text ⋮
popover (`#bulletListBtn`/`#numberedListBtn`), `uiController.updateFormattingToolbar` reflects `te.list`.
i18n `formatting.{list,bulletList,numberedList}` (ar reviewed 2026-07-30). No feature flag (additive). **Ceiling
(v1):** nested/multi-level lists, custom marker styles (a/A/i, start-at-N), RTL/Arabic marker placement
(the ASCII marker still prefixes the logical Arabic line → drawn within the RTL shaping), and DOCX export of
overlay-text markers (overlay annotations aren't in the PDF→DOCX path). Guards:
`tests/utils/listMarkers.test.ts`, `tests/elements/textElement.test.ts` (model + gutter),
`tests/core/formattingService.test.ts`, `tests/ui/{textOptionsPopover,uiController}.test.ts`,
`tests/browser/text-list.browser.test.ts` (real Chrome: bullet/ordered export → pdf.js text has `•`/`1.`/`2.`,
plain control has none).
**Overlay text links (Feature 3, 2026-06-24):** `TextElement.linkUrl?: string` (OPTIONAL, **no
`SCHEMA_VERSION` bump**; `toJSON` omits when unset, `elementFactory` reads `typeof === 'string'`). The whole
text box becomes a clickable hyperlink. **Security:** `src/utils/linkUrl.ts` `sanitizeLinkUrl(raw)` allows ONLY
`http:`/`https:`/`mailto:` (a bare domain → `https://`); `javascript:`/`data:`/`vbscript:`/`file:`/empty → null
(blocks `/URI`-action injection). Sanitised at BOTH the service (`FormattingService.setLinkUrl`) AND the bake
(defence-in-depth vs a crafted saved blob). EXPORT: `pdfElementRenderer.renderText` appends a borderless `/Link`
annotation (`/A << /S /URI /URI (url) >>`, the `incrementalSigner.ts` `/Annots` idiom via a static
`@cantoo/pdf-lib` `PDFName`/`PDFArray`/`PDFNumber`/`PDFString` import + `addUriLinkAnnotation`) over the box rect
(same rotation-safe `rectAnchor`+swap-dims AABB as the background fill). Survives BOTH export paths (raster path
runs the same `renderText` on the same page object); byte-identical when unset/invalid; `pdfSanitizer` preserves
`/URI` so a link survives sanitize-and-download. Editor: a 🔗 badge (`.text-link-badge`) + dotted-underline
(`.text-element--linked` in `editor.css`) + the URL as the box `title`; text is NOT auto-restyled (user controls
colour/underline). `setLinkUrl` is a `MoveResizeCmd` (undoable); it is **NOT** in the format painter or
`clearFormatting` (a URL is per-element data, like `text`) — cleared via the popover's empty input. UI = a URL
input (`#textLinkInput`) in the Text ⋮ popover; i18n `formatting.{linkLabel,linkPlaceholder}` (ar reviewed 2026-07-30).
No feature flag. **Ceiling (v1):** per-run/partial-text links (needs multi-run rich text), internal GoTo links,
rotated-element link rect is the axis-aligned bbox (PDF `/Link` rects can't rotate), and the lossy
"flatten-to-images" compress path drops the annotation (it drops text too). Guards: `tests/utils/linkUrl.test.ts`,
`tests/elements/textElement.test.ts` (model + badge/title), `tests/core/formattingService.test.ts`,
`tests/ui/textOptionsPopover.test.ts`, `tests/browser/text-link.browser.test.ts` (real Chrome: export → pdf.js
`getAnnotations` has a Link with the sanitized `url`; a `javascript:` URL set directly → no annotation).
**Stroke / Tc / Tz on the Arabic overlay (Feature 4, 2026-06-24):** the Slice-2 advanced attrs `strokeWidth`,
`charSpacing` (Tc), `horizontalScale` (Tz) — previously Latin/WinAnsi-only — now apply to shaped RTL Arabic text
in the export. `arabicOverlay.ts` gains a PURE `buildArabicRunOps(fontKey, hex, x, y, size, color, style)` that
builds the per-run operator list mirroring `styledText.drawStyledTextLine`'s ordering — `q · BT · rg · [RG · w ·
Tr(FillAndOutline)] · Tf · [Tc] · [Tz] · Tm · Tj · ET · Q` — so the **no-style path is byte-identical** to the
prior CID emission (stroke colour = fill colour, the Slice-2 rule). PURE `effectiveArabicWidth(baseWidth,
glyphCount, charSpacing, horizontalScale)` does RTL right-alignment from the shaped **glyph count**
(`cidHex.length / 4`, the real 2-byte CID units — NOT `text.length`). Both `drawArabicLine` (pure-Arabic) and the
RTL runs of `drawBidiLine` (mixed line) route through these; `renderText` passes `te.{charSpacing,horizontalScale,
strokeWidth}` into `drawArabicLine`. **Ceiling:** `baselineShift`(super/sub) + `justify` stay Latin-only for
Arabic; in a mixed line the **Latin runs** keep `page.drawText` (no Tc/Tz/stroke — documented partial, consistent
with the Noto-vs-Helvetica per-run split); Tc width is approximated from the glyph count. Guards:
`tests/export/arabicOverlay.test.ts` (jsdom: `buildArabicRunOps` op-sequence — no-style q/BT/rg/Tf/Tm/Tj/ET/Q,
stroke→RG+w+Tr, Tc, Tz; `effectiveArabicWidth` math), `tests/browser/arabic-overlay.browser.test.ts` (real Chrome:
stroke→pdf.js `setTextRenderingMode`, Tz→`setHScale`, Tc→`setCharSpacing` present, ABSENT for a plain control).

### Tagged-PDF struct-tree fast path (#B1, 2026-06-25)

A tagged PDF (`page.getStructTree()` with
children) exports to DOCX/MD/TXT straight from the tags instead of the layout heuristics. `flowDoc.ts`
`buildMarkedContentMap(items)` splits a `getTextContent({includeMarkedContent:true})` stream into
`MCID→RawTextItem[]` (each text item attributed to the INNERMOST enclosing MCID; a no-MCID marked region
— `Artifact`/untagged — pushes a `null` stack spacer so its text is DROPPED, which is correct: PDF/UA
artifacts are non-content). `structTreeToFlow(tree, mcMap, fonts, w, h, redactions?)` walks the role tree in
document reading order → `H1`–`H6`→heading / `P`/`Note`/`Caption`/`Quote`→body / `L`+`LI`→list (depth from
nesting, ordered/bullet from the Lbl/inline marker via `detectListPrefix`) / `Table`+`TR`+`TH`/`TD`→`FlowTable`
grid (`THead`/`TBody`/`TFoot` row-groups recursed); `Figure` skipped (the raster image path handles it). It
**returns null** when the tree is absent or resolves ZERO text → caller falls through to the heuristic →
**byte-identical for untagged PDFs (~85% of files)**. Run quality is shared: `buildRunsFromLines` was
EXTRACTED from `buildParagraph` (same color/super-sub/underline/gap-space/coalesce logic) and is reused by
both paths. `reconstructPage` gained an optional `struct?: {tree, markedItems}` param: when set and the flow
resolves, it returns `{paragraphs, tables, tagged:true}` (margins still computed from `words`) and SKIPS the
column/heading heuristic; `assignHeadings` skips `page.tagged` pages (all 3 loops) so tag levels aren't
clobbered. `exportService._extractFlowDoc` fetches `getStructTree()` first, and ONLY when it has children
requests the marked-content text variant (filtering markers out for the heuristic/font path via `!('type' in
it)`) — an untagged page keeps the plain `getTextContent()` call (byte-identical extraction). **Non-obvious:**
(1) struct-tree leaves `{type:'content', id}` and `beginMarkedContentProps {id}` share the SAME id string
(verified 100% on the w3c fixture) — direct map lookup, no fuzzy correlation; (2) text items have NO `type`
key, markers do — that's the discriminator; (3) `FlowDoc`/`FlowPage` are export-transient (never persisted to
IndexedDB) so `tagged` needs no SCHEMA bump. **Ceiling:** a partially-tagged page drops its untagged
(artifact-classed) text by design (exact-replace contract); alignment/indent/spacing are NOT tag-derived
(left, or right for RTL); a multi-column tagged page's reading order rides the writer's y-sort (monotonic for
normal top-down docs). Gated purely by struct-tree PRESENCE (no feature flag). Guards:
`tests/utils/flowDocStructTree.test.ts` (10: map attribution/nesting, heading/body/list/ordered/table/null/
redaction, assignHeadings tagged-skip) + `tests/browser/docx-structtree.browser.test.ts` (2: real tagged PDF →
H1 + `<w:tbl>`; untagged → `reconstructPage` byte-identical with vs without the struct arg).

### Arabic support (Sprint Arabic, 2026-06-15)

— three parts:
- **DOCX export**: pdf.js returns RTL text in VISUAL order (each string bidi-reversed) tagged `dir:'rtl'`;
  Word re-applies bidi to `w:rtl` runs → double-reversal. `reverseRtlText` restores logical char order
  **and NFKC-normalizes** (P2, 2026-06-17) — many PDFs encode Arabic as Unicode PRESENTATION FORMS
  (U+FB50–FDFF / U+FE70–FEFF, pre-shaped glyphs); emitted verbatim they render disconnected in Word, so
  NFKC folds them to base letters (and expands ligatures, e.g. U+FEFB lam-alef → ل+ا) AFTER the reversal so
  a ligature's logical order stays correct. Guard: `tests/utils/flowDocArabic.test.ts`;
  `orderLineWords` orders an rtl line right-to-left (logical); **AR-1 (2026-06-15)** it now applies the
  UAX#9 L2 run-reversal at WORD level — an RTL line is segmented into same-direction runs and emitted
  right→left, but an embedded LTR run (Latin word / number) keeps forward order (the old blanket
  descending-x sort reversed it). Word-level only; `bidi-js` is installed but unused (a dedicated lib
  isn't needed for word granularity — deeper char-level bidi stays a documented partial). The writer emits
  complex-script attrs (`font.cs=Arial`, `bold/italics/sizeComplexScript`). All in `flowDoc.ts`/`flowDocWriters.ts`.
- **True-edit**: `replaceTextAt` REFUSES Arabic new-text before the Latin Path-3 redraw (it would emit '?')
  → routes to the overlay (mirrors the Type3/vertical refusals). Faithful Path-2 subset-glyph reuse still
  runs first for in-subset edits. Guard: `isArabicText()` (defined in `flowDoc.ts`, imported by `contentStreamEditor.ts`).
- **Overlay rendering** (`src/export/arabicOverlay.ts`): pdf-lib `drawText` CANNOT place shaped glyphs RTL
  (fontkit shapes logical-only; drawText paints LTR → mirrored). Fix: `font.encodeText(logical)` shapes
  (fontkit GSUB) + emits 2-byte subset CIDs **already in VISUAL order → do NOT reverse the CID pairs** →
  raw `Tj` via `page.pushOperators` against **Noto Naskh Arabic** (vendored **`src/assets/fonts/NotoNaskhArabic-Regular.ttf`**,
  OFL — `src/assets/fonts/OFL.txt`, lazy `?url`-fetched, embedded Type0/CID via `@pdf-lib/fontkit`; the embedded
  W-array advances glyphs). **MUST be a TTF/OTF, NEVER a `.woff`/`.woff2`** — fontkit/@cantoo-pdf-lib mis-embeds
  the WOFF1 of this font: the subset keeps only the `ا` glyph outline, every other glyph renders blank + a
  spurious 6th glyph + broken ToUnicode (`U+0002`). Root-caused live 2026-06-17 (pdf-lib's own `drawText` fails
  identically → font container, not RTL code); the prior `@fontsource/noto-naskh-arabic` woff dep is REMOVED.
  The TTF embeds cleanly (5 glyphs, full word renders, correct logical ToUnicode). Deps: `@pdf-lib/fontkit`
  (0 vulns; a single RTL run needs no bidi lib — `encodeText` is already visual; mixed LTR+RTL line reorder
  is a documented ceiling). `getArabicFont` is shared by the searchable-OCR Arabic layer, so this fix covers both.
  Browser-only (font fetch); wired in `pdfElementRenderer.ts` text branch, guarded by `isArabicText`,
  right-aligned. Guards: `tests/utils/flowDocArabic.test.ts`, `tests/export/arabicOverlay.test.ts`,
  `tests/browser/arabic-overlay.browser.test.ts` (rasterized: now asserts multi-glyph ink **width**, not just
  presence — catches the single-alef WOFF regression).

### Cornerstone QA 2026-06-17 — RTL text-layer selection/copy/search + multi-language DOCX

:
- **Text-layer selection / copy / search (RTL)**: pdf.js v6 builds the selection layer as one PER-GLYPH
  span, visual order, PRESENTATION FORMS, no spaces. (#6 `a293639`) a `copy` listener (`textLayer.ts._onCopy`)
  rebuilds logical, spaced, base-letter text from selected-span geometry via `reconstructLogicalText`
  (`rtlClipboard.ts`). (#6b `6e35874`) `TextSearchHandler.search` adds a normalized fallback — on a raw miss
  it matches the NFKC'd query against `reverseRtlText(str)` (visual→logical) + a plain NFKC fold (single
  glyphs / Latin ligatures like ﬁ), with an item-box highlight; LTR matching is byte-unchanged. (#6c
  `df21a26`) `alignSpanOrderToVisual` (in `textLayer.ts`, called at the end of `render`) re-appends spans in
  visual (top, then left) order so an Arabic drag-selection highlights without holes — DOM order was
  non-monotonic in x (measured 17/72 backward on one real-PDF line → ~45% of the band was gaps); after,
  72/0 monotonic, gaps 114px→21px. Spans are absolutely positioned (reorder is visually invisible); copy
  re-sorts by geometry (unaffected); the app's own search/highlight don't use pdf.js's findController. Gated
  to RTL/Arabic-DOMINANT pages (LTR multi-column reading order preserved). Ceilings: sub-character RTL
  highlight position is item-level; mixed LTR+RTL single-line bidi; SR reading order becomes visual L→R.
  Guards: `tests/utils/rtlClipboard.test.ts`, `tests/handlers/textSearchHandler.test.ts` (Arabic #6b),
  `tests/browser/arabic-selection.browser.test.ts` (#6c, real layout — jsdom can't lay out spans).
  **Cross-item Arabic search + multi-char copy fix (2026-06-21, `9b6fa35`+`2cfbb0f`):** the #6b
  per-item fallback found ZERO real Arabic matches — pdf.js splits a word across MANY per-glyph items, so a
  multi-glyph query never fits one `item.str`. KEY (verified live): pdf.js emits SINGLE glyphs in VISUAL
  position order but MULTI-char items/spans in NATIVE (LOGICAL) char order (the trailing "لام" of "السلام"
  is one logical-order item). So correct reconstruction orders tokens by READING POSITION (RTL → x-descending)
  and folds each NFKC-ONLY — NEVER reverses a token's internal chars (the old blanket `reverseRtlText(visual)`
  scrambled multi-char tokens: "السلام"→"السمال"). `TextSearchHandler.buildLogicalLines` (pure, exported) does
  this per-line with an item→offset token map → match maps to the covering items' union box; the Arabic line
  pass is gated to `isArabicText(query)` (Latin stays per-item, no double-count). `reconstructLogicalText`
  (copy) got the SAME no-internal-reverse fix → embedded LTR words/numbers ("PDFturbo"/"100%") now stay intact.
  This OVERTURNS the original #6b assumption (visual-order multi-char items) — its synthetic single-item
  fixture was unrealistic and was corrected to logical order. Selection ordering was already correct
  (`alignSpanOrderToVisual`); residual striped highlight at large fonts = inherent per-glyph-span SEAMS
  (cosmetic, not fixed). Ceilings: neutral bracket mirroring "(RTL)"→")RTL(" (UAX#9 L4), "الله" ligature
  reorder, multi-token LTR run order. Guards: `tests/handlers/textSearchHandler.test.ts` (per-glyph spanning),
  `tests/utils/rtlClipboard.test.ts` (multi-char span + embedded-LTR), `tests/browser/arabic-search.browser.test.ts`
  + `tests/browser/arabic-copy.browser.test.ts` (real pdf.js items). Fixture+gen: `scripts/gen-arabic-fixture.mjs`.
- **Shared char-level bidi engine (Feature 3 Slice 1, `11a3253`)**: `src/utils/bidi.ts` adopts
  **bidi-js@1.0.3 (MIT, full UAX#9)** — promoted transitive(jsdom)→**direct prod dep**; `src/types/bidi-js.d.ts`
  supplies types (none upstream). FOUR functions: `logicalToVisual(text,base)` (typed/user text → display order,
  brackets mirrored via `getReorderedString`); `visualToLogical(text,base)` (pdf.js visual order → logical;
  BOUNDED inverse: reverse line + re-reverse maximal LTR-type runs *trimming boundary WHITESPACE* + un-mirror
  RTL-context brackets — LTR-base input is identity); `visualRuns(text,base)` (logical → runs in visual L→R
  order, each run's text LOGICAL so fontkit shapes Arabic / Helvetica draws Latin); `logicalItemOrder<T>(itemsLToR,
  isRtl)` (item-level UAX#9 L2 — RTL-item runs reversed, embedded LTR-item runs forward, item internals untouched).
  **All four Arabic surfaces now route through it:** overlay `drawBidiLine`→`visualRuns` (the OLD hand-rolled
  `segmentBidiRuns`/`baseIsRtl` are DELETED — do not reintroduce); copy `reconstructLogicalText`→`logicalItemOrder`
  (SPAN-level); search `buildLogicalLines`→`logicalItemOrder` (ITEM-level, token→item map preserved); DOCX
  `reverseRtlText`→`visualToLogical` **only when the word is mixed-script** (pure-Arabic incl. presentation
  forms/ligatures keeps the blanket char-reverse — its contract). **Non-obvious (TDD-discovered):** (1) bidi-js is
  logical→visual ONLY — the 3 read surfaces need the inverse, which is an APPROXIMATION (perfect inversion from
  visual order alone is impossible). (2) a char-level reorder SCRAMBLES pdf.js multi-char tokens (`لام`/`PDF` arrive
  as ONE logical-order span) and breaks search's char offsets → copy/search MUST reorder at ITEM granularity, never
  char. (3) boundary whitespace must stay put when re-reversing an LTR run (else an inter-word space migrates →
  `مرحباWorld `). Every engine call falls back to the raw string on a bidi-js throw (never regress below prior
  behavior). **Ceiling:** overlay bracket display-mirroring (fontkit draws the logical glyph; the string surfaces
  DO mirror), tashkeel GPOS, shaped-ligature reorder → Feature 3 Slice 3 (evaluate-then-defer). Guards:
  `tests/utils/bidi.test.ts` (13) + the per-surface guards (`rtlClipboard`/`flowDocArabic`/`textSearchHandler`) +
  the extended `tests/browser/arabic-overlay.browser.test.ts`.
- **RTL-aware text toolbar (Feature 3 Slice 2, `ebae519`)**: `TextElement.direction?: 'auto'|'rtl'|'ltr'`
  (default `'auto'`, OPTIONAL, **no `SCHEMA_VERSION` bump** — `toJSON` omits when auto, `elementFactory`
  reads `?? 'auto'`). `resolveDirection(direction, text)` (in `textElement.ts`) = `'auto'` → `baseDirection(text)`
  (first-strong UAX#9, exported from `utils/bidi`). The editor `<input>.dir` is set from the resolved
  direction in `_applyInputFormatting` (fixes Arabic typing/caret). Toolbar `⇋ rtlBtn` (in the align group) →
  `app.toggleDirection` → `FormattingService.toggleDirection` (overrides the resolved direction to the
  opposite explicit value) / `setDirection` — each a `MoveResizeCmd` whose `before` carries BOTH
  `{direction, align}`, and which defaults a still-`'left'` align to `'right'` when the result resolves RTL
  (so undo restores both). `uiController.updateFormattingToolbar` reflects `rtlBtn` active via
  `resolveDirection(te.direction, te.text) === 'rtl'`. **Export is UNCHANGED** — `pdfElementRenderer.renderText`
  already auto-RTLs `isArabicText` lines via `drawArabicLine`; `direction` is editor + alignment only in v1
  (forcing the Arabic font path on non-Arabic text mis-renders — declined). **Gotcha:** any test that builds
  the uiController refs from a partial DOM must seed `'rtlBtn'` (else `getElementById` → null →
  `r.rtlBtn.disabled` throws). i18n `formatting.rtlTitle` (ar reviewed 2026-07-30).
- **Multi-language DOCX (#2 `9cfc38a`)**: Cyrillic + CJK source text is preserved verbatim through
  PDF→DOCX/MD/TXT — they're LTR like Latin, so they take the same reconstructPage + writer path and the only
  script branch (`isArabicText` RTL reorder) must not fire. CONTENT is intact (verified, no prod change).
  CJK font-FACE (a `w:eastAsia` font) is a documented ceiling: no universal CJK font name (forcing one risks
  Han-unification mis-render), and Word's fallback renders the codepoints. Guards:
  `tests/utils/flowDocCjkCyrillic.test.ts` (jsdom writer/reconstruct), `tests/browser/cyrillic-docx.browser.test.ts`
  (real pdf.js extract embedded-font Cyrillic → DOCX).
- **Test-infra**: jsdom `testTimeout` 5s→30s (`a214076`) — node-forge RSA-2048 keygen tests flaked under
  full-suite CPU contention; mirrors the browser config (`87180d1`). **`hookTimeout: 60_000` was added
  beside it 2026-08-22** — that bump was applied to tests only, leaving hooks doing the identical keygen
  on vitest's 10s default; see § "A raised `testTimeout` does not raise `hookTimeout`".

### OCR (Sprint 4, 2026-06-15; CSP/engine fix 2026-06-15)

`src/ocr/*` wraps **tesseract.js@7**
(lazily loaded). `src/handlers/ocrHandler.ts` renders the current source page to a canvas at scale 2,
recognizes words, and inserts them as real `TextElement`s via ONE `MacroCmd` (undoable, selectable,
DOCX/MD-exportable) — not a bespoke overlay. `ocrWordToTextElement` is the pure bbox→element map
(top-left origin both sides → no Y-flip). Wired: `ocrBtn` + `ocrModal`.
**CSP/engine fix (found by /qa-sweep)** — OCR was non-functional in production for THREE reasons, all
now fixed (guards: `tests/browser/ocr-csp.browser.test.ts` real-engine e2e, `tests/ocr/ocrCore.test.ts`):
(1) **Assets must be 'self'-served** — the app CSP (`connect-src 'self' blob:`) blocks tesseract's CDN.
`scripts/prepare-ocr-assets.mjs` (npm `ocr:assets`, run via predev/prebuild + a CI step before tests)
vendors the worker + LSTM core wasm (from node_modules) + **best** traineddata (downloaded) for ALL 8
advertised languages (eng/fra/ara/deu/spa/ita/por/nld — O1 fix 2026-06-15; `LANGS` MUST stay in sync
with `OCR_LANGUAGES`, enforced by `tests/blockers/ocr.blockers.test.ts`)
into `public/tesseract/` (gitignored). `ocrAssetPaths(import.meta.env.BASE_URL)` builds the local
`corePath`/`workerPath`/`langPath`; NEVER reintroduce a CDN path (the `ocrAssetPaths` test guards this).
**PWA caching (#48, 2026-06-16):** the SW precache `globIgnores:['**/tesseract/**']` keeps the OCR worker +
`*.wasm.js` cores (which match the `**/*.js` glob) + traineddata OUT of the install payload (precache 16.5→5.0 MB);
they're served via the `ocr-assets` CacheFirst runtime route on first OCR use. Tradeoff: OCR needs one online
use before working offline. Guard: `tests/infra/pwaOcrCaching.test.ts`. NEVER drop `globIgnores` back (re-bloats install).
(2) **Literal dynamic import** — `import('tesseract.js')` (NOT the old `@vite-ignore` indirect form,
which left a bare specifier the browser couldn't resolve → "Failed to resolve module specifier").
(3) **Word geometry needs `blocks: true`** — the engine uses `createWorker` + `worker.recognize(img, {},
{ text: true, blocks: true })` (the `recognize` convenience hardcodes `{text:true}` → empty words). v7
returns words ONLY nested under `data.blocks[].paragraphs[].lines[].words[]`; `flattenBlockWords`
(tesseractMapper) flattens them. Without this OCR completed but added 0 elements (silent "no text").
OCR targets SCANNED/image pages — clear large text recognizes well; tiny/thin vector text may yield 0.
**Searchable-OCR layer (SHIPPED 2026-06-16)** — `src/ocr/searchableTextLayer.ts`:
`wordToTextPlacement` (OCR-px top-left → PDF-pt bottom-left: `x0/scale`, `pageHeight−y1/scale`
baseline, `(y1−y0)/scale` size) + `buildInvisibleTextLayerOps` (`BT·Tr(3)·Tf·Tm·Tj·ET` per word,
`arabicOverlay` `pushOperators` pattern + `setTextRenderingMode(Invisible)`) +
`partitionWordsByFont` (Arabic→Noto Naskh / WinAnsi-Latin→Helvetica / else skipped) +
`applySearchableLayerToPdf` (loads pdf-lib doc, embeds fonts, pushes ops, returns rewritten bytes;
throws `SearchableLayerError('ROTATED_PAGE')` on rotated pages — bbox space ≠ unrotated PDF coords).
Wired: `ocrHandler.run(lang, mode, onProgress)` with `mode:'visible'|'searchable'` (default
`'visible'`); `'searchable'` swaps source bytes via the existing `_applySourcePdfEdit`
(`ReplaceSourcePdfBytesCmd`, undoable + persisted). UI: `ocrModeSelect` in `ocrModal` (default
"Searchable layer"); toasts `ocrSearchableDone`/`ocrRotatedUnsupported` (3 locales).
**OCR usability (2026-06-20)**: the `ocrModeSelect` "Output" now offers FOUR destinations — the
default **searchable layer** (recommended), **`docx`** (export to editable Word), **`text`** (copy +
download `.txt`), and **`visible`** (editable boxes, relabeled "for clean pages, not scans" — it was
the un-masked overlay that made a scan look unreadable; it's no longer the trap-default since
searchable is first). `OcrOutputMode` stays `'visible'|'searchable'` — the two READ-ONLY exports are
NOT handled by `run()`; `pdfTurboApp.runOcr` branches on the raw select value and routes `text`/`docx`
to `OcrHandler.recognizeCurrentPage(lang,onProgress)` (extracted shared private `_recognize`; `run()`
byte-identical, same guards + single-flight) → `ExportService.exportOcrText` (best-effort
`navigator.clipboard` + `.txt` download; clipboard rejection in insecure contexts falls back to
download-only) / `exportOcrDocx` (pure `ocrTextToFlowDoc(text)` in flowDoc.ts → `flowDocToDocxBlob`).
Empty recognized text → `ocrNoText`/`exportNoText` warn, never an empty file. **Non-obvious:**
`main.ts` flag-off path now explicitly sets `ocrModeSelect.value='visible'` after removing the
searchable option (else the new `docx`/`text` options would become the default when `searchableOcr` is
off). OCR→DOCX is a LINEAR reading-order transcription — the scan's column/table layout is NOT
reconstructed (ceiling). Guards: `tests/utils/ocrTextToFlowDoc.test.ts`, `tests/export/ocrExport.test.ts`
(clipboard fallbacks + docx-unzip), `tests/browser/ocr-export.browser.test.ts` (real engine → real .docx).
**Latin-7 (eng/fra/deu/spa/ita/por/nld) is exact-searchable.** **Arabic is a documented PARTIAL:**
recovers as real Arabic Unicode (selectable + screen-reader-accessible) but full-word exact search
is imperfect — fontkit GSUB shaping yields contextual glyphs with incomplete pdf-lib ToUnicode (same
ceiling as the visible Arabic overlay). A clean-ToUnicode PoC (per-codepoint isolated encoding) was
tried + REJECTED: it traded the artifact for RTL order reversal in pdf.js `getTextContent`. Rotated
pages: NOT yet supported (warn + skip). Guards: `tests/ocr/searchableTextLayer.test.ts` (14 jsdom:
transform/partition/apply/rotation) + `tests/browser/searchable-ocr.browser.test.ts` (Latin exact +
Arabic honest contract + invisible-ink).

### E-signing (Sprint 4, 2026-06-15)

`src/signing/*` produces a single visible PKCS#12/CMS signature
via **node-forge@1.3.1** (dynamically imported; pure-JS, runs in jsdom AND browser). `PdfSigner.sign`
reserves a fixed `/Contents` hex slot + `/ByteRange`, serialises without object streams, then splices the
detached CMS. **"Sign WITH edits"**: `signingHandler.ts` signs `app.assemblePdfBytes()` (the shared
downloadPDF assembly — edits/annotations/redactions/form-fills baked in — exposed on `exportService`),
NOT the raw source. Encryption is intentionally NOT applied to the assembled bytes (the signer needs a
plain stream for its ByteRange; encrypt-then-sign is out of v1 scope). Output is **download-only**
(`<base>-signed.pdf`) — NO auto-resign (rejected as a security/trust anti-pattern: re-editing a signed
PDF must visibly invalidate the signature, never silently re-sign). **Re-signing an already-signed PDF
is refused (S3, 2026-06-15)**: the exported `isPdfSigned(bytes)` detects a `/ByteRange` + sig SubFilter and
`PdfSigner.preflight` throws a typed `ALREADY_SIGNED` SignError (pdf-lib's full re-save would otherwise
corrupt the existing ByteRange with an opaque crash). `.p12` bytes are zeroed after signing;
the password field is cleared on close. `buildSignOptions` is the pure 1-based-UI→0-based-signer map.
**S-FLOW cert-free pre-flight (2026-06-15)**: `PdfSigner.preflight(bytes, page, rect)` runs the
cert-INDEPENDENT checks (already-signed + page-index + rect-bounds) and is called by `pdfTurboApp.signPdf`
**BEFORE** any certificate is generated/loaded — so an off-page rect or already-signed PDF shows the error
and bails WITHOUT downloading an orphan generated `.p12`/`.pem` (the prior bug). `sign()` reuses `preflight`
internally (DRY; standalone API stays safe). The generate-mode password is **no longer wiped in the
`finally`** (only on `closeSignModal`) — wiping it made a naive retry silently bail at the `if (!genPw)`
guard while a stale error stayed on screen. `signingHandler.sign(form, preassembled?)` accepts the
already-assembled bytes so the app preflights and signs the SAME bytes (one assembly). Guard:
`tests/signing/preflight.test.ts`.
Wired: `signBtn` + `signModal`; `SignErrorCode`→`sign.error.<CODE>` i18n.
**Generate-a-cert-on-the-spot (2026-06-15)**: the sign modal has a source toggle —
"Use my .p12" vs "Generate one now". `src/signing/certGen.ts` `generateSelfSignedP12`
(node-forge, lazy) makes an RSA-2048 key + self-signed X.509 (full subject: CN/O/email/C)
packaged as PKCS#12, feeds the SAME `PdfSigner` (no signer change — it only wants
`{p12,passphrase}`), and the app downloads the `.p12` + `.pem` for reuse/sharing. Self-signed
⇒ readers show "validity unknown" until trusted (surfaced via `modal.sign.genTrustNote`).
Guards: `tests/signing/certGen.test.ts` (round-trip: generated p12 actually signs) +
`tests/browser/cert-gen.browser.test.ts` (real-Chrome keygen+sign).
**NOT yet supported**: TSA timestamp, LTV/DSS, multi-signature rounds, CA-issued/trusted certs (v1 scope).
**PAdES (ETSI.CAdES.detached) is a ceiling** with node-forge: its pkcs7 `_attributeToAsn1` can't add the
ESS signing-certificate-v2 signed attribute PAdES-BES requires, so we keep the valid ISO 32000-1
`adbe.pkcs7.detached` rather than emit a malformed PAdES. A real PAdES needs hand-rolled CAdES ASN.1.

### Approval caption + guided Signers panel (F-D D1/D2)

A drawn `SignatureElement` carries an OPTIONAL
caption (`signer`/`mention` default "Lu et approuvé"/`signedDate`); `buildSignatureCaptionLines` (pure) is
shared by the DOM render and the export bake (`pdfElementRenderer`) — caption ABSENT ⇒ byte-identical, and
`toJSON` omits the keys unset (NO schema bump). D2 = `src/ui/signersPanel.ts` (👥 `signersBtn`, gated
`VITE_FEATURE_SIGNERS`; mirrors batesPanel — own focus-trap/Esc/backdrop, no preview) is a **guided wizard**:
fill name+mention(+date) → `buildSignerCaption` → arms `pendingSignatureCaption` → `setMode('addSignature')`
opens the pad → `commitPlacement` (placementManager.ts:196) reads/applies `{...caption}` then CLEARS it.
Repeat per signer — the PAGE is the roster (no separate list). **Non-obvious leak guard:** the plain ✍ click
(toolBinder) + `S` shortcut (keyboardBinder) + pad-cancel (`SignatureManager.closeModal`) ALL clear
`pendingCaption` first, so a plain signature can NEVER inherit a panel caption (provable invariant; guards in
`tests/ui/signersPanel.test.ts`, `placementSignatureCaption.test.ts`, `keyboardBinder.test.ts`,
`signatureManager.test.ts`). **Remote round-robin**: each signer draws → exports (D1 bakes the sig into page
content) → sends to the next, who opens it and adds theirs; the 🔏 crypto seal applies ONCE, LAST (re-export
after sealing invalidates it — `ALREADY_SIGNED`). Visible sigs = approval-stamp grade, NOT tamper-evident.
**D3 spike (2026-06-18) — true N-party CRYPTO co-signing is REACHABLE, NOT a structural ceiling.**
`src/signing/incrementalSigner.ts` (EXPERIMENTAL, **unwired**, `ALREADY_SIGNED` guard untouched) proves a 2nd
independent CMS signature can be appended via a hand-built **append-only incremental update**: read structure
with pdf-lib (never re-save) → append new sig dict + field + new-revision page/AcroForm + classic incremental
`xref`/`trailer << … /Prev >>` → reuse `byteRange.ts` primitives + `buildDetachedCms`. The prior "ceiling" was
mis-attributed: pdf-lib's `save()` renumbers objects (kills sig-1), but that's the *tool's serialiser*, not the
PDF format. Sig-1 survives because its `/ByteRange` ends at the original EOF (untouched by the append). Guarded
by `tests/signing/incrementalSigner.test.ts` (append-only prefix byte-identical, BOTH `/ByteRange` digests
validate, pdf-lib re-parses). **Caveat:** proves ByteRange-digest correctness + append-only preservation;
Adobe/DSS acceptance is UNVERIFIED in-repo (no Acrobat) → keep `ALREADY_SIGNED` until manual verification.
**In-repo hardening H1–H4 DONE (2026-06-18, still unwired, `ALREADY_SIGNED` untouched):** **H1** NEW
`src/signing/cmsVerify.ts` `verifyAllSignatures(bytes)` cryptographically re-checks EVERY embedded sig via
node-forge `rawCapture` (no brittle `p7.verify()`) — messageDigest authAttr === SHA-256(ByteRange span) AND
the authAttrs RSA-verify against the **CMS-embedded** signer cert (`p7.certificates[0]`); the auth-attrs are
re-DER'd wrapped in a **UNIVERSAL SET (0x31)**, NOT the `[0]` IMPLICIT tag (the classic forge-verify trap) —
a tamper test (flip a covered byte → `digestMatches:false`) proves it's real, not rubber-stamp. Kept OUT of
the `index.ts` barrel (mirrors `incrementalSigner`). **H2** `addIncrementalSignature` now preflights via the
shipped `validatePageIndex`/`validateRect` (typed `INVALID_PAGE`/`INVALID_RECT`) but deliberately does NOT
call `isPdfSigned` (it MUST accept an already-signed PDF — that's the point). **H3** exported
`assertClassicXref(bytes, startxrefOffset)` refuses xref-STREAM / hybrid inputs (peek at the offset, require
the literal `xref` keyword) with NEW typed `SignError('UNSUPPORTED_XREF')` (added to the union + 3 locales,
ar reviewed 2026-07-30; `signingHandler` maps `sign.error.${code}` dynamically so it's additive). **H4** coverage:
two DISTINCT certs (each sig verifies against its own embedded cert), triple-sign N>2 (3 ByteRanges valid,
append-only prefix preserved), multi-page. `beforeAll` gets 60s (two RSA-2048 keygens; hookTimeout ≠ the 30s
testTimeout). Classic-xref + ASCII-object only remains the documented input contract. **Approval model B (D1/D2) stays the default**
for the no-backend tool; D3 is now an opt-in productionisation candidate. Editable free-text caption date = v1b.
**Arabic `modal.signers.mentionDefault`/labels: status UNRECONCILED** — see § i18n. The key exists with
an Arabic value (`locales/ar.json:440`) and predates the 2026-07-30 sign-off, so this marker is probably
just stale; the repo cannot prove it. Note the prose said `mentionDefault` for two years — the actual key
is `modal.signers.mentionDefault`, which is why a grep for the short name finds only `signersPanel.ts`.

### Per-page crop (#G23)

`DocumentPage.crop?` is a rect in **unrotated content space** (y-down, top-left,
relative to the source `getPageCropBox()` box) — rotation-invariant, so `rotatePage` is untouched and it
persists via `toJSON`'s `pages` with **no SCHEMA_VERSION bump** (`documentLoader` assigns `pages` wholesale).
The drawn rect arrives in editor DISPLAY space; `PageService.cropPage` maps it via `redactionRectToContent`
(the SAME tested helper redactions use) + `clampContentRect`. Export: `buildPageOverlays` draws every overlay
in source-box space FIRST, then `page.setCropBox(effBox)` **last** (via `contentCropToPdfCropBox`) — so
element/ink coords are unaffected and the thumbnail + export-preview inherit the crop (they re-read
`getPageCropBox`). **The redaction rasterizer does NOT use setCropBox** (#QA-2026-06-23 leak fix): it passes
`buildPageOverlays({ skipCropBox: true })`, renders the FULL page, draws the burn at full-page coords (the
already-correct path), then **clips the rendered CANVAS** to the crop window LAST (effBox corners → canvas px
via `viewport.convertToViewportPoint`, rotation-correct). Burn and content thus share ONE coordinate space, so
a non-zero crop offset can no longer drift the burn off the secret (the old `setCropBox`-before-render path
rendered a cropped canvas but drew the burn at full-page coords → **misplaced burn = redaction LEAK** on a
cropped page). Guard: `tests/browser/redaction-crop.browser.test.ts`. Bates/watermark switch to the crop's
**effective box** (else they'd anchor in the now-clipped original corner); `effBox === cropBox` when no crop →
**byte-identical export** (the rasterizer's no-crop path embeds the full canvas unchanged).
Undoable via `SetPageCropCmd` (clone of `RotatePageCmd`); apply-to-all = a `MacroCmd` whose canvas re-render
rides the CURRENT page's command (fires on execute AND undo). Live editor preview is a **dimmed-margin SVG
frame** (`pageRenderPipeline._renderCropFrame`, mapped via `contentRectToDisplay`), NOT a pdf.js sub-region
render (Design β). Tool mode `'crop'` rides `DrawingHandler` (pointerdown gate + `_updatePreview` + pointer-up
branches). Gated `VITE_FEATURE_CROP` (#28; `main.ts` removes the button + `#cropControls` when off).
**Ceiling:** aspect-ratio-aware apply-to-all. Numeric margins SHIPPED 2026-08-04 (§ Numeric crop
margins) and resizable HANDLES 2026-08-05 (§ Resizable crop handles).

### Crop HIDES, redaction REMOVES — and the obvious check gives a false negative (2026-08-04)

`buildPageOverlays` ends with `page.setCropBox(...)`: a **view directive**. The content stream and
MediaBox are untouched, so cropped-away content is still in the exported bytes and a recipient restores
it by deleting one key. Proven by a reviewer: export a crop over a `CONFIDENTIAL …` header, delete
`/CropBox`, the header is back.

**Two things make this worse than a plain limitation, and both are why it is now disclosed to USERS**
(`README.md`, `FEATURES.md`, and its own § in `SECURITY.md` — not only here):
1. **The user's own verification confirms the illusion.** `getTextContent()` respects the CropBox, so
   select-all/copy in a viewer shows the header gone while `getOperatorList()` on the same untouched
   file still returns it. Someone who checks the way a careful person would checks is reassured wrongly.
2. **Removal semantics differ PER PAGE.** A page carrying a redaction takes
   `rasterizePageWithRedactions`, which embeds only the clipped canvas — there the crop IS destructive.
   Same UI action, same toast, opposite guarantees. Do not generalise from a redacted page.

The docs already qualify removal-grade features ("Redaction — … text unextractable"), so crop sitting
unqualified four lines away read as an equal promise. Numeric margins raised the stakes rather than
creating them: a margin is exactly the affordance for a header banner, and typing `80` feels like a
measurement.

### The hide-vs-remove audit — every surface graded, and two more traps found (2026-08-05)

Crop's disclosure gap begged the obvious question: **what else claims, or merely implies, removal?** So
every surface a user could believe deletes content was graded — building a file, performing the operation,
and trying to recover the content with pdf.js. `tests/browser/hide-vs-remove.browser.test.ts` (6 tests)
pins six of them; **two of those drive the real export bake** (shape, redaction) and the rest exercise the
underlying operation directly, so they pin the MECHANISM, not that every export path invokes it. The
remaining rows come from code reading. The grades are a user-facing table in `SECURITY.md` § *"Hiding is
not removing"* (which absorbed and kept the crop § rather than replacing it). **Say which is which** —
the first draft of that table claimed every row was test-pinned, and a reviewer refuted it.

**Verdict: six surfaces genuinely REMOVE** — redaction (rasterises), page delete (never copied),
extract-page-range (same mechanism), compress→**flatten-to-images** (rasterises; the *lossless* setting
does not), export-page-as-image (rasterises), and **true-edit delete**, which is the only one that removes
surgically: it blanks the show op, so the string leaves the content stream while *the rest of the page
stays real text*. Worth knowing precisely because someone who has internalised "removal means
rasterisation" will expect the neighbouring text to die with it, and it does not.

**Two NEW traps, both undisclosed until now, neither a code defect:**
1. **A filled shape over text hides nothing at all.** Not "recoverable with effort" like crop — the text
   is plainly extractable, untouched. This is the single most famous PDF mistake in the world and the
   product ships a black-rectangle tool in the same toolbar row as redaction, rendering an identical
   result on screen. Nothing claimed otherwise, and that was exactly the crop failure mode: the *absence*
   of a qualifier next to qualified neighbours reads as an equal promise.
2. **Form flatten makes a value MORE exposed, not less.** "Flatten" sounds concealing; it converts an
   editable field into permanent selectable page text. Correct behaviour, opposite connotation.

**Method note worth reusing: pin the traps as tests, not just as prose.** Two of the six assertions
encode behaviour that is *correct* — `expect(text).toContain(SECRET)` after drawing a black box over it.
An assertion that a defect-shaped thing is intended is the only artifact that stops a future reader
"fixing" it, or quietly describing shapes as hiding content. Each carries a comment saying so.

Also confirmed by measurement rather than assumption: sanitize touches metadata only (page content
survives, and it does not claim otherwise), and redaction takes the WHOLE page's text with it — the
documented cost of "text unextractable", and the reason it is not the default.

**The audit's own first draft was the best illustration of its thesis — a reviewer refuted THREE of its
pins, and the redaction one was serious.** All are fixed; the lessons are the point:

1. **A pin made only of NEGATIVE assertions cannot detect the leak it exists to catch.** The redaction
   test asserted `not.toContain(SECRET)` and `not.toContain(PUBLIC)` — but rasterisation alone satisfies
   both, so it could not distinguish *"the burn destroyed the secret"* from *"the page became an image"*.
   Demonstrated, not argued: with the burn moved off-target (the `#QA-2026-06-23` misplaced-burn shape a
   crop offset really produced here) **the assertions still passed** while the secret's glyphs stayed
   inked — i.e. plainly readable. Now gated on `patchDarkness(...) > 200`, sampling a 6×6 patch at the
   cover's centre; that reads **9.3** (near-white) on the off-target simulation and passes on a correct
   burn. **Any redaction guard needs positive evidence the burn landed.** To re-measure, move the
   `RedactionElement`'s `y` off the secret and re-run — the simulation is deliberately not committed, so
   the figure above is the only record; treat it as a one-off measurement, not a ceiling to cite.
2. **"Each row is pinned by a test" was false for 3 of 9 rows** (compress→flatten, crop, highlight). An
   overstated *provenance* claim in a security document is the same defect the audit exists to fix, so
   rows now carry an explicit `[pinned]` marker and the rest say they were established by code reading.
3. **The `/Names` assertion was both vacuous AND wrong.** The fixture never carried `/Names`, so
   `expect(...).toBeUndefined()` held before `sanitizePdf` ran. Adding it to the fixture revealed the
   assertion was also semantically wrong: the sanitizer **keeps** the `/Names` dict on purpose (so
   `/Dests` survives) and deletes only its `/JavaScript` and `/EmbeddedFiles` sub-trees.

Two factual corrections to the prose fell out of the same review: **crop is destructive in at least
three paths, not one** (a redaction-bearing page, compress→flatten-to-images, and export-page-as-image —
pdf.js's viewport *is* the CropBox, so any rasterising export discards the cropped region), and
**export-page-as-image** was missing from a table that claimed to list every surface.

**THREE locale strings contradicted the new table; all are fixed in all three locales — and the one I
missed first was the one that matters most.** `toolbar.cropTitle` still said *"drag to keep only that
area"*, the original finding's exact wording, fixed in the docs but not in the UI. I then wrote that this
tooltip was "the highest-traffic surface of all" and a reviewer refuted it: **`toast.modeHint.crop` is
*pushed* at the user** by `toolModeService`'s `MODE_HINT_KEYS` the instant crop mode is entered, and it
still said *"drag to mark the area to keep"* — a toast you cannot avoid reading beats a tooltip you must
hover for. **When auditing a user-facing claim, grep the locale files for the CLAIM, not for the one key
you already know about.** Third: `toast.redactionPlaced` said content is *"hidden"* on export, which
under the new taxonomy means *recoverable* — the wrong word for the tool that genuinely removes.

The three Arabic edits are single-verb substitutions (`للإبقاء على` → `لإظهار`, `الإبقاء عليها` →
`إظهارها`, `يُخفى` → `يُزال`). **They are the FIRST changes to Arabic values since the 2026-07-30 native
sign-off**, so § i18n's "no Arabic value was changed" no longer holds unqualified, and the pending count
is **11**: these 3 plus `toolbar.exportXlsxTitle`, the 6 `toolbar.cropMargin*` keys and
`toast.cropMarginsTooLarge`. A reviewer found this tracking gap because the two other sections that
enumerate the pending set were not updated — **when the pending list lives in prose in three places, a
change to one is a change to all three.**

**A "defect" I fixed and then had to UNFIX — worth the space, because the reasoning generalises.** The
delete branch reads `if (!ok) return;` with no toast and no fallback, while the replace path 50 lines
below falls back to an overlay and says so. That asymmetry looks exactly like a silent failure on a
removal operation, so I added a warning toast, a test, a doc caveat saying the delete "refuses on Type3 /
invisible / vertical fonts and tells you so" — and a reviewer refuted all three at once. **The branch is
unreachable and the caveat was invented:**

- `deleteTextAt` carries **none** of `replaceTextAt`'s font gates (`isType3Font` / renderMode 3,7 /
  `isVerticalWritingFont` are at `contentStreamEditor.ts:1961-1963`, inside `replaceTextAt` only). It
  needs none: blanking a show op **draws nothing**, so it is font-agnostic. Replace needs the gates
  precisely because Path 3 must RENDER new glyphs. So delete is *unconditionally* removal-grade.
- Its only `false` is `findTarget` missing — and `findTextOpAt` **is** `findTarget(...)?.target`
  (`:1248`), which had to succeed on the same `libDoc`/`pageIndex`/`origin`/tolerance for the editor to
  open. Nothing mutates `libDoc` in between (the delete branch is the first mutating branch in
  `commit`), so a deterministic function cannot now miss.

Reverted; the branch keeps a comment stating the proof. **The lesson: an asymmetry between two sibling
code paths is not evidence of a bug** — the sibling may need the guard for a reason that does not apply.
Under the anti-bandaid gate, adding a fallback for a failure mode with no observed instance is itself the
defect, and the test I wrote for it could only be reached by mocking the impossible return.

**THE AUDIT'S REAL PAYLOAD: three redaction leaks in SHIPPED code, found only once the reviewer panel
attacked the claim rather than the tests (2026-08-05).** Redaction rasterises the page, which is what
makes it removal-grade — but **three export paths do not go through that path**, and every one of them
handed the redacted text straight back. Each fix is pinned by a test proven to fail without it:

1. **Table → CSV / XLSX.** `_extractPageTableData` read the raw `getTextContent()`. Meanwhile
   `_extractFlowDoc`, 500 lines away, filtered redactions and carried a comment saying
   `CORE-P0-1 — without this, redacted text leaked on rotated pages`. **This repo had already graded
   this exact class P0 for the sibling path and fixed only that one.** Reverting the new filter puts
   `Wolgast` back in the CSV. The fix reuses `isItemRedacted` + `redactionRectToContent` with the same
   viewport and `totalRot`, so rotated pages cannot diverge between the two extractors.
2. **OCR → "Copy text" / "Export to Word".** `_recognize` rasterises the RAW source page, so tesseract
   read the text under the box. Fixed by painting the redactions onto the OCR canvas **before**
   recognition — the engine then cannot see the glyphs at all, which beats filtering recognised words
   because there is no partial-overlap word left to reason about.
3. **A redaction on a BLANK page was never rasterised at all** — `sourcePdfId === 'blank'` is checked
   *before* `hasRedaction`, so the box was baked as an opaque vector rect over live overlay text.
   Reverting the fix extracts the secret verbatim. There is no source document to rasterise here, so
   removal is achieved the only other way available: `dropElementsUnderRedactions` omits the covered
   elements. Deliberately blunt — a partially covered element is dropped whole, because leaving it
   would leak the covered part.

**Round 3 then refuted my own fix, and this is the most instructive part.** Fix 1 above was written by
mirroring `_extractFlowDoc`'s call shape — including `page.getViewport({ scale: 1 })`. But
`redactionRectToContent`'s docstring says its `W`/`H` are the **UNROTATED** dims, and `getViewport`
defaults `rotation` to `page.rotate`, so on `/Rotate 90|270` the dims arrive **swapped** and the filter
**silently no-ops**. Measured across all `(pageRot, userRot)` pairs: 6 of 16 leaked, and two of those
*also dropped the wrong region* — innocent cells deleted while the secret survived. The repo's canonical
accessor had it right all along (`PageService._pageGeom` uses `{ scale: 1, rotation: 0 }`).

**And the path I copied had the same bug**, so `CORE-P0-1`'s comment — *"without this, redacted text
leaked on rotated pages"* — was only ever true at 0/180, where the error cancels. DOCX/MD/TXT leaked at
90/270 for as long as that comment has existed. **Mirroring a sibling call site is not verification of
it; check the contract.** Both call sites now pass `{ scale: 1, rotation: 0 }`, pinned across six
rotation combinations — and the fixture's `getViewport` deliberately *mimics pdf.js's swap*, because a
stub returning fixed `W×H` would make those tests pass while the bug stayed.

Two more leaks fell out of the same question: **overlay text under a redaction** had no filter at all in
the DOCX/MD/TXT and XFDF exports (the PDF export removed it; "Export to Word" handed it back, promoted to
a heading if styled as one), and the **OCR burn** was mapped with a plain `el.x * scale` even though that
canvas is rendered at the page's intrinsic `/Rotate` with **no** user rotation — so with a user rotation
applied the fill landed off-target and, for some combinations, *entirely off-canvas*. Now composed from
two proven mappings (`redactionRectToContent`, then the viewport's own `convertToViewportPoint`).

**The lesson is about where to point a safety audit.** The first two rounds hardened the *tests* and the
*wording* and found nothing in the product. What found real leaks was asking "does this claim hold for
every path a user can reach, at every rotation?" — and the answer was no for five of them, each invisible
to a green suite because no test existed on those paths at all. **A sibling path that shares a promise but
not the filter is this repo's recurring leak shape**, and rotation is where it hides: every test written
for the first fix was at rotation 0, which is exactly why a rotation bug shipped inside a rotation fix.

**A fourth leak, verified and DISCLOSED rather than fixed: deleting an image in the DOCX editor leaves
its bytes in the saved file.** `reconcileImageAnchors` does `el.remove()` on the anchor `w:p` and nothing
else; `grep -rn "delete opc.files" src/docx/` returns **nothing**, and `packOpc` re-zips every part
verbatim — so `word/media/imageN.png` survives as an unreferenced part, recoverable by renaming to
`.zip`. The picture disappears in the editor AND in Word, which is what makes it convincing.
`CLAUDE.md` already noted "no part GC in v1" for the **cut/paste** slice only; the ✕-delete ceiling list
did not mention it and no user-facing doc did. Now in `SECURITY.md` § *"Deleting an image in the DOCX
editor does not remove it from the file"*. **Not fixed on purpose:** removing a package part safely means
proving nothing else references it (headers, footers, unmodelled parts), and getting that wrong destroys
images — a worse outcome than a disclosed orphan. The `SECURITY.md` table is otherwise PDF-scoped, which
is exactly how a whole feature went ungraded under a heading that says "every surface".

**Known bounds, deliberately not "fixed" (they are disclosed in `SECURITY.md` instead):** the drop is
blunt — a partially-covered element goes entirely, and so does one the user deliberately stacked *above*
a redaction (the raster path draws that one above the burn, so the two paths differ by design); the
intersection test uses the stored AABB, so a **rotated** element's true footprint is not what is tested;
and **ink is composited above the burn**, so handwriting under a redaction stays visible on every path.

**A FOURTH leak, and the way I nearly buried it is the most useful lesson in this whole entry.**
`_assemblePdfDoc` pre-copied every needed page, **including redaction-bearing ones** whose copy is never
`addPage`d. pdf-lib does not garbage-collect, so `save()` still serialised the intact page: the
un-redacted content stream shipped inside the exported file as an orphan — absent from `/Pages`, so
`getTextContent()` reported the secret gone, while the text sat there in the raw bytes. Reverting the
`pageHasRedaction` filter makes `tests/browser/redaction-orphan-leak.browser.test.ts` fail with the source
text present.

**I first recorded this as "could not reproduce end-to-end" — and that was wrong, because MY OWN TEST
could not fail.** `pdfjsLib.getDocument({ data })` **TRANSFERS the buffer** to the worker, so the same
`Uint8Array` is left with `byteLength === 0`. The scan ran over zero bytes and answered "clean" every
time, on every variant I tried, which is exactly why the wrong conclusion felt so well-measured. Fixed
with `.slice(0)` at every `getDocument` and a hard throw in `leaks()` on an empty buffer.

**Three rules fall out of it, and they are the transferable part:**
1. **A safety scan that cannot fail is worse than no scan** — it launders a live leak into a documented
   non-finding, and the next reader inherits the false conclusion plus a comment saying the fix is
   removable. The call site now says *do NOT remove this filter*, with the measurement.
2. **Always verify a NEGATIVE result the same way you verify a positive one.** I proved every *fix* in
   this entry non-vacuous by reverting it; I did not apply that discipline to a *non-finding*. A "no
   leak here" needs a control proving the probe can detect the leak at all — which the file now has.
3. **pdf.js detaching its input is a silent, general trap.** Anything that reads bytes after handing them
   to `getDocument` reads nothing. Pass `.slice(0)` whenever the buffer is still needed.

**Two API traps found while writing it:** `PDFDict.lookup(key, PDFDict)` **throws**
`Expected instance of PDFDict, but got instance of undefined` when the key is absent — so asserting a key
was stripped must use `.get(key)`. And a fixture built with `page.drawText` needs a save→load round-trip
before `findTarget` can see it: `drawText` buffers operators and only flushes them at save.

### Resizable crop handles (#G23 v1c, 2026-08-05)

Eight grips (4 corners + 4 edge midpoints) on `#cropFrameOverlay`. Pure geometry in
`src/utils/cropResize.ts` (`resizeDisplayRect` / `handlePositions` / `handleCursor`); the wiring lives in
`pageRenderPipeline._renderCropFrame` and commits via a new `IPageRenderContext.commitCropRect` seam →
`PageService.cropPage`. **The drag works in DISPLAY space**, which is exactly what `cropPage` takes, so a
resize reuses the drawn path's rotation mapping and its undoable `SetPageCropCmd` — no second coordinate
convention, which is the mistake the margins path made on its first attempt.

**The load-bearing detail is `pointer-events`.** The overlay must stay `none` or it would swallow every
drawing gesture; each grip re-enables `all` for itself. A naive `all` on the SVG breaks the crop, redact
and freehand tools at once, so the browser guard asserts BOTH halves and that each grip is the topmost
node at its own centre.

**Clamping is applied to the moving EDGE, not to the resulting width/height.** Dragging past the
opposite side stops at `MIN_CROP` instead of inverting the rect — an inverted rect is still valid
arithmetic and would silently crop a different region than the one under the pointer.

**Two things that cost me time and will cost the next person the same:**
1. **A grip can be BELOW THE FOLD.** The page canvas is taller than the viewport, so on a full-height
   page the `se`/`s`/`sw` grips sit outside it and `elementFromPoint` at their centre returns null. My
   first live drag targeted `se` and silently did nothing. Same family as the 375px reachability finding:
   *rendered* is not *reachable*. Drag `nw` (or scroll the region first) when driving this by hand.
2. **`#cropFrameOverlay`'s last `<rect>` is a GRIP, not the frame.** The outline now carries
   `data-crop-outline` so tests and the QA driver can address it; a `rect:last-of-type` selector measures
   a 9×9 grip and reads as "the drag did nothing".

Verified live: dragging `nw` inward 80px takes the frame 882×650 → 802×570 with the dimmed bands
following, and undo restores 882×650 exactly. Guards: `tests/utils/cropResize.test.ts` (7 pure — every
handle, both clamps, the no-invert cases, identity at zero delta) +
`tests/browser/crop-handles.browser.test.ts` (7 real-browser — hit-testability of all 8 grips through the
pass-through overlay, SE/NW drags, a press with no movement committing nothing, cursor, clamp, and
listener teardown so an in-flight drag cannot leak across the re-render that destroys the overlay).

### Numeric crop margins (#G23 v1b, 2026-08-04)

`✓ cropMarginApplyBtn` + four `#cropMargin{Top,Right,Bottom,Left}` number inputs in `#cropControls`
→ `PDFTurboApp.cropPageByMargins` → `PageService.cropPageByMargins`. Margins are typed in **points, in
unrotated content space**, converted by the pure `marginsToContentCrop` (`utils/geometry.ts`).

**Margins are converted PER PAGE, which is a real improvement over the drag path's apply-to-all.**
"20pt off each edge" means the same thing on a mixed-size document; one drawn rect clamped to each page
does not. A page whose margins leave nothing to show is SKIPPED, not cropped to nothing, and an
all-pages-swallowed run warns `toast.cropMarginsTooLarge` instead of silently doing nothing.

**Both crop entry points now share `PageService._commitCrops`** — extracted in the same change so undo
grouping (`MacroCmd` vs a single `SetPageCropCmd`), thumbnail invalidation and which toast fires cannot
drift between the drag and margin paths. No new command, no `SCHEMA_VERSION` bump: it writes the same
`page.crop`.

**The margins are typed in DISPLAY space and mapped through the drag path's own
`redactionRectToContent`** — deriving a content rect from margins directly ignored `srcRot`/`p.rotation`
and cropped the WRONG VISUAL EDGE on any rotated page (measured: at 90° a typed top margin removed the
right-hand strip; a `/Rotate 90` scan hits this without the user rotating anything). Sharing the mapping
is what makes "top" mean the same thing in both entry points — pinned by a test that fails if rotation is
ignored. **A green Playwright click is NOT evidence of reachability:** the 5 controls overflowed the
375px viewport and `elementFromPoint` at the ✓ button's own centre returned null, yet the sweep scored it
PASS because Playwright scrolls programmatically where a finger cannot, and
`documentElement.scrollWidth` stays 375 because `.container` clips. Fixed by letting `.toolbar-group`
wrap at the mobile breakpoint (`.toolbar` already did — the QA-D F3 invariant did not reach inside a
group), guarded statically by `tests/ui/toolbarWrapInvariant.test.ts` because the live gate is blind to
this class twice over.

**Two more things that will mislead you when testing this by hand:**
1. **The canvas does NOT resize.** Per § Per-page crop the live preview is a dimmed-margin SVG frame
   (`#cropFrameOverlay`, Design β), not a pdf.js sub-region render — so `#pdfCanvas.width` is unchanged
   and the overlay's presence is the real observable. Measured live: no overlay before, 5 rects after.
2. **Ctrl+Z does not undo the crop while a margin input still has focus** — the number input's own text
   undo consumes it. That is ordinary browser behaviour, not a defect; the undo BUTTON works (verified
   live: overlay present → absent). Worth knowing because it reads exactly like a broken undo.

i18n: 6 new `toolbar.cropMargin*` keys + `toast.cropMarginsTooLarge` (**ar [Unverified]** — needs a
native pass, alongside `toolbar.exportXlsxTitle`, `badge.signRect` and the 3 re-worded crop/redaction strings — 12 pending
in total, enumerated in § The hide-vs-remove audit). The inputs use `role="group"` +
`aria-labelledby` so a short field name is announced with its group label, the same pattern as
`signX/Y/W/H` (§ A CRITICAL a11y rule). Guards: `tests/utils/marginsToContentCrop.test.ts` (7 pure —
zero margins, negatives, NaN from an empty input, refusal when nothing is left) +
`tests/core/pageService.test.ts` (5: inset, undo, per-page apply-to-all in one MacroCmd, the warn, the
all-pages toast). **Still ceiling (v1c):** resizable drag handles on an existing crop frame, and
aspect-ratio-aware apply-to-all.

### PDF compress (#60)

HYBRID modal (`src/ui/compressPanel.ts`, ⇩ export-flyout `compressBtn`, gated
`VITE_FEATURE_COMPRESS`). Two strategies over the **assembled** export bytes (`assemblePdfBytes()` — edits
baked in), wired as `ExportService.compressAndDownload(opts)`: (1) **lossless** "quick optimize" — re-load
`{updateMetadata:false}` (MUST — else pdf-lib re-stamps `/Info` Producer+ModDate at load, undoing the strip,
see [[reference_pdflib_updatemetadata_restamp]]) → `stripDocMetadata` (drops `/Info` + XMP `/Metadata` +
trailer `/ID`) → `save({useObjectStreams:true})`; keeps text/vectors/forms. (2) **lossy** "flatten to images"
— pdfjs renders each page to a JPEG at `dpiToScale(dpi)` (viewport honours page rotation → correctly
oriented), rebuilds an image-only PDF whose pages keep their **point** dimensions (`getViewport({scale:1})`),
drops selectable text. Pure helpers (`dpiToScale`/`clampDpi`/`clampQuality`/`stripDocMetadata`/
`compressLossless`) live in `src/export/compress.ts` (jsdom-testable); the canvas raster loop is in
ExportService (real-Chrome). **Non-obvious:** the export password (when set) is applied to the **same**
`save({useObjectStreams:true})` as the optimization — a re-load-to-encrypt would default `useObjectStreams`
back to false and undo the size win. Defaults **lossless** / **200 DPI / 0.8 quality** (conservative). Toast
reports before→after size + % saved (`formatBytes`). **Ceiling #60b:** true in-place image-XObject
downsampling (shrink only embedded rasters, keep text) — pdf-lib has no XObject-replace API.

### DOCX read+edit (#1, Track B)

A SEPARATE editor from the PDF pipeline (it edits a Word doc, not a
PDF) — `src/docx/*`, gated `VITE_FEATURE_DOCX_EDIT` (#28 seam). Entry: file-menu `fileMenuEditDocx` →
`createDocxEditorController` (lazy-imported on first click; `main.ts` removes the menu item when the flag
is off). The controller is **self-contained** — it creates its OWN hidden file input + modal overlay
(`.docx-editor-*` in `modals.css`), never touching `documentModel`/`uiController`, so opening a Word doc
can't disturb PDF editing. **Modal a11y (#QA-2026-06-23 P1):** the controller ships its OWN Esc-to-close,
backdrop-click-close (target===modal), and `trapFocus(panel, prevFocus)` (initial focus + Tab trap + focus
restoration) — it is NOT in the central `keyboardBinder` Esc chain (self-contained by design). **Silent
table-discard guard (#QA-2026-06-23 P1):** keyboard table/row deletion is possible (prosemirror-tables nodes
are editable, no transaction-filter) but the in-place reconcile keeps the ORIGINAL tables on a count
divergence — so the controller counts tables (`countTables`, recursive) at load vs save and warns
`docxEditor.tableStructureUnsupported` instead of the misleading "saved" toast (the save still succeeds with
the original tables; genuine block-on-delete is deferred). **Cardinal rule (2026-06-20 spike
verdict — recovery command in `src/docx/opcEdit.ts`):** edit `word/document.xml` IN PLACE in the
unzipped OPC and re-zip — NEVER rebuild via the `docx` writer (it drops every unmodeled part:
tables/styles/numbering/headers). `opcEdit.ts` = fflate(MIT) unzip + platform DOMParser edit + re-zip;
`docModel.ts` models TOP-LEVEL `w:body` paragraphs with per-run **bold/italic/underline/fontFamily/fontSize**
(`w:sz` is half-points → pt×2) and per-paragraph **heading (1–3, `w:pStyle`) + list (`w:numPr`, ordered=decimal
vs bullet)** (everything else — tables/styles/numbering/headers — passes through verbatim); `docxProseMirror.ts`
maps the FLAT model ↔ a NESTED ProseMirror(MIT) doc (headings + bullet/ordered lists via
**prosemirror-schema-list**, MIT) + `mountDocxEditor`.
**Save preserves per-run formatting** via `applyParagraphRuns(xml, paras, ids?)`: it clones the original
first run's `w:rPr` (so unmodeled color/spacing survive), strips the model-managed toggles (`MANAGED_RPR` =
b/i/u/rFonts/sz/szCs), re-adds b/i/u/font/size, and `sortRPrChildren` re-orders them into canonical CT_RPr
order (rFonts,b,i,u,sz,szCs — underline is AFTER sz per ECMA-376) — NOT the older text-level
`applyParagraphTexts` (which flattened a paragraph to one run). Paragraph props (heading `w:pStyle` + list
`w:numPr`, `w:pPr` inserted as first child) are written ONLY when the `ids` arg is passed → without it the
output is byte-identical to the #1c runs-only path.
**Rich-text toolbar (Phase 2 Slice A)**: `docxToolbar.ts` `buildDocxToolbar(view)` — B/I/U (toggleMark) +
heading select (setBlockType) + font/size selects (a custom `setMarkAttr` Command) + bullet/ordered buttons
(`inList ? liftListItem : wrapInList`); active-state reflects after every transaction via a hooked
`dispatchTransaction`. It rides on `DocxEditorHandle.toolbarDom` (built inside the lazy chunk, so the
controller mounts it above the editor with NO extra dynamic import). `docxSchema.ts` extends schema-basic
with the u/fontFamily/fontSize marks + `addListNodes(...)`. **opcParts.ts (inject-if-missing)**:
`ensureHeadingStyles`/`ensureListNumbering` REUSE existing Heading1–3 / bullet+decimal numbering defs when
present, else INJECT minimal spec-valid `<w:style>`/abstractNum+num (abstractNum BEFORE num; ids floored at
100) and `registerPart` adds the Override to `[Content_Types].xml` + a Relationship to `document.xml.rels`
(creating styles.xml / numbering.xml if absent); `buildNumberingMap` resolves numId→bullet|decimal on read.
`save()` resolves these ids ONLY when the edited model actually uses a heading/list. **Ceiling (Slice A):**
run formatting beyond b/i/u/font/size (color/highlight/strike), nested-list depth beyond `w:ilvl` round-trip,
a styles-gallery UI, and table-cell editing — all deferred to later slices. **Lazy split (verified in `vite build`):** the
controller chunk (~2.5 KB) loads on first menu click, the ProseMirror+model editor (~213 KB) on first
document open — neither is in the initial bundle. Deps all permissive: prosemirror-* + prosemirror-schema-list
(MIT), fflate (MIT), docx (MIT). **#1d DOCX→PDF export DONE:** `src/docx/docxToPdf.ts`
is a PURE flow→PDF renderer (the sibling of `flowDocWriters.ts`) — `docModelToPdfBytes(model, opts?)` lays
out the editable model with @cantoo/pdf-lib Helvetica StandardFonts (run-level tokenization → preserves
inter-run spaces AND mid-word font changes; greedy word-wrap; hard-break of over-wide tokens; pagination;
per-run bold/italic via the 4 Helvetica faces). `DocxEditorHandle.getModel()` returns the live model; the
editor modal's "Export PDF" button (`docModelToPdfBytes` **dynamically imported** to keep pdf-lib lazy)
downloads `<base>.pdf`. **WinAnsi-only:** StandardFonts encode CP1252, so `sanitizeWinAnsi` maps non-WinAnsi
codepoints (CJK/Arabic/emoji) → `?` and the controller warns (`docxEditor.pdfUnsupportedChars`); French/
German/Spanish accents are in CP1252 → intact. The `notify` seam was widened to `'warn'` (+ `main.ts` lambda).
**DOCX→PDF fidelity (Workstream A, 2026-06-21):** the renderer now also draws **heading sizes**
(`headingFontSize(level, base)` — H1/H2/H3 × 1.7/1.4/1.18, bold), **list markers** (`listMarkerText(ordered,
ordinal, level)` — bullet `•` vs decimal/lower-alpha/lower-roman cycling per 3 levels, `makeListState()` ordinal
counter, indent `INDENT_PER_LEVEL` per `list.level`), per-run **underline** (`page.drawLine` at baseline) and
per-run **color**. Color is a full vertical slice: `DocRun.color?` (`#rrggbb`) ↔ OPC `w:color@w:val`
(`docModel.ts` parse/`buildRun`, added to `MANAGED_RPR`) ↔ ProseMirror `color` mark (`docxSchema.ts`
`cssColorToHex` + `docxProseMirror.ts` map) ↔ a color picker in `docxToolbar.ts` ↔ `_hexColor` in the PDF render.
**DOCX→PDF fidelity (Feature 5, 2026-06-24) — fonts + merged cells + images NOW rendered:**
(a) **Real font faces** — `resolveStandardFontFamily(family)` maps `DocRun.fontFamily` → Times (serif) /
Courier (mono) / Helvetica (sans/unknown); all 12 non-symbol StandardFonts embedded up-front, `fontFor(family,
bold,italic)` picks the 4-way variant (was: everything Helvetica). (b) **Merged-cell tables** — pure
`buildCellGrid(t)` resolves the existing `DocCell.colspan`/`rowspan` (the 3c/3d shape, continuation cells
ABSENT) onto a grid (walks rows skipping rowspan-occupied columns); `tableLayout` computes equal column widths
+ per-row heights (rowspan cells top up their LAST spanned row), and the renderer draws colspan cells `N*colW`
wide and rowspan cells spanning the summed row heights (was: equal `max(cells)` columns → merged tables
misrendered). (c) **Images** — `src/docx/docxImages.ts` `extractDocImages(opc.files)` reads `word/media` via
`w:drawing`→`a:blip/@r:embed`→rels, sniffs PNG/JPEG, base64s + reads `wp:extent` EMU→pt; **kept DECOUPLED from
the editable model** (the in-place `buildRun` save rewrites runs as text `w:r` — routing image bytes through
the model would corrupt the `w:drawing`), exposed read-only via `DocxEditorHandle.getImages()` and passed to
`docModelToPdfBytes(model, { images })`, which embeds (`embedPng`/`embedJpg`) + interleaves each image after its
top-level `blockIndex`. **The save path + PM round-trip are UNTOUCHED → zero cardinal-rule regression.** Default
`images:[]` → byte-identical for image-less docs. **Ceiling:** per-column `w:tblGrid` widths (equal columns
only), a rowspan cell straddling a page break, images nested in table cells / inline-with-text / non-PNG-JPEG,
per-run formatting beyond b/i/u/size/color/font-family, image positional drift after heavy editing (index-based),
non-WinAnsi scripts → `?` (true face embedding is the future path); Approach B (docx-preview raster) remains the
documented high-fidelity future alternative.
Guards: `tests/docx/docxImages.test.ts` + the `resolveStandardFontFamily`/`buildCellGrid` cases in
`docxToPdf.test.ts` + the image/colspan/serif cases in `tests/browser/docx-to-pdf.browser.test.ts`. Guards:
`tests/docx/{docxEditor,docxEditorController,docModelRichText,opcParts,docxSchema,docxMapping,docxToolbar,docxToPdf}.test.ts`
(jsdom), `tests/browser/docx-editor.browser.test.ts` + `tests/browser/docx-to-pdf.browser.test.ts`
+ `tests/browser/docx-toolbar.browser.test.ts` (real Chrome: toolbar drives bold+H1+bullet via genuine
commands → save → reopen → formatting survives AND an untouched table passes through; the cardinal in-place
rule), confirming selectable text, reading order, French fidelity.
**Paste-from-Word (Slice C #1)**: `src/docx/wordPaste.ts` `cleanWordHtml(html)` is a PURE MSO sanitiser
(platform `DOMParser`; strips `mso-*` style decls, `<o:p>`/`<xml>`/`<style>`/`<meta>`/office-namespaced tags,
BOTH conditional-comment forms — downlevel-hidden `<!--[if]…<![endif]-->` removed, downlevel-revealed
`<![if]…<![endif]>` UNWRAPPED so list bullets survive — empty `MsoNormal` spacers, `file://`/src-less images;
keeps `data:`/`http(s):` images) wired as the EditorView `transformPastedHTML` hook (`docxProseMirror.ts`); the
default DOMParser then parses through the EXISTING schema parseDOM (b/i/u/font/size/H1–6/lists/links) — NO new
schema, NO new dep, NO new flag (rides `VITE_FEATURE_DOCX_EDIT`). Ctrl+Shift+V arms a one-shot `_plainPasteArmed`
flag (keydown on `view.dom`) → `handlePaste` does `tr.insertText` (NOT `view.pasteText` — pasteText builds a
`ClipboardEvent` internally, which jsdom lacks; insertText is jsdom-safe and correctly "match destination style":
drops SOURCE formatting, inherits the cursor context). **Ceiling:** pasted tables fall back to ProseMirror default
(grid dropped, cell text → paragraphs — feature #3 upgrades this); colour/highlight/strikethrough dropped (no
schema mark); link URL survives in the editor but NOT the OPC save (`DocRun` carries no `linkUrl`). Guards:
`tests/docx/wordPaste.test.ts` (7 jsdom: MSO strip + format survival + totality), `tests/docx/docxPaste.test.ts`
(wiring + plain-text via fake event), `tests/browser/docx-paste.browser.test.ts` (real Chrome: `view.pasteHTML`
real pipeline → bold/underline/list through save→reopen; plain-text drops formatting).
**Find/replace (Slice C #2)**: a Word-style find & replace bar in the DOCX editor — plain + case +
whole-word + **regex** (with `$1` capture-group replacement). Three units + wiring, NO new dep, NO new flag
(rides `VITE_FEATURE_DOCX_EDIT`): (1) `src/docx/findReplace.ts` PURE core — `findMatches(doc,query,opts)`
searches **per textblock** over the flattened `textContent` (so a match spans runs/marks), mapping string
offsets → PM positions (`pos+1+offset`); regex compiles in try/catch → typed `{ok:false,error:'invalid-regex'}`
(never throws), zero-length matches guarded; `expandReplacement` does `$n` substitution. (2)
`src/docx/findReplacePlugin.ts` PM plugin — state `{active,query,replacement,opts,matches,activeIndex,error}`
recomputed on query/opts change OR `tr.docChanged` (activeIndex clamped); a `DecorationSet` paints `.fr-match`
+ active `.fr-match-active`; commands `open/close/setFindQuery/setReplacement/findNext/findPrev/replaceCurrent/
replaceAll`. **Replace inherits the marks at the MATCH START** (first char) — `replaceCurrent` deletes+inserts
with `doc.resolve(from+1).marks()`; **`replaceAll` applies matches RIGHT-TO-LEFT in ONE transaction** (one undo
step; earlier positions stay valid mid-apply, marks read from the original doc). (3) `src/docx/findReplaceBar.ts`
the UI (find/replace inputs, case/whole-word/regex toggles, ▲▼, "n of m" counter, Replace/Replace-all, ✕);
`Enter`/`Shift+Enter` = next/prev, `Esc` closes; invalid regex → red `.fr-error` field. (4) Wiring in
`docxProseMirror.ts`: `findReplacePlugin()` + a `Mod-f`/`Mod-h` keymap that opens the bar via a forward-declared
`barRef` (the keymap is built at state-create, before the view/bar exist); `DocxEditorHandle.findReplaceBar?`
mounted by `docxEditorController.ts` below the toolbar; a CENTRALISED `dispatchTransaction` supersedes the
toolbar's own hook to refresh BOTH toolbar + bar (setProps merges, so paste props survive). **Non-obvious:**
the bar's `run()` calls `update()` after each command so the counter refreshes even in unit tests with no
view-level hook; the central hook covers external doc edits. **Ceilings (v1):** matches do NOT cross paragraph
boundaries (regex `^`/`$` anchor per block); replace formatting = match-start marks only (mixed-format matches
collapse); table-cell text is not searched (tables aren't in the PM model until feature #3); PDF find/replace
is the separate follow-up ("DOCX first, PDF after"). i18n `findReplace.*` in en/fr/ar (ar reviewed 2026-07-30). Guards:
`tests/docx/findReplace.test.ts` (15 pure), `tests/docx/findReplacePlugin.test.ts` (11), `tests/docx/findReplaceBar.test.ts`
(7), `tests/browser/docx-find-replace.browser.test.ts` (real Chrome: Mod-f opens, decorations paint+cycle,
replace-all keeps bold through save→reopen, table passes through).
**C#2 hardening (2026-06-20):** (a) **match cap** — `findReplace.ts` exports `MAX_MATCHES=1000`; `findMatches`
stops the descend + bounds each `matchBlock(…, limit)` at the cap and returns `truncated?:true`, threaded through
the plugin state (`FindReplaceState.truncated`) so the bar counter shows `"n of 1000+"`. A broad query (`.`, `\s`,
a lone letter) over a large doc would otherwise build tens of thousands of decorations + a giant replace-all tx =
frozen tab; `replaceAll` now acts on the first batch (re-run for the rest). **Residual ceiling:** catastrophic
backtracking *inside one `re.exec()`* is uninterruptable in synchronous JS without a Worker/RE2 (both excluded by
the no-new-dep rule) — NOT defended, documented. (b) **`Mod-f` override is intentional and already focus-scoped** —
a `prosemirror-keymap` handler fires only on editor-focused keydown, so native browser Find works everywhere except
inside the open editor (the in-app-editor norm: Docs/VS Code/Notion). No new locale key (counter reuses
`findReplace.counter` with a string `total`). Guards: the 3 truncation cases above (core+plugin+bar).
**Table editing (Slice C #3a)**: `src/docx/*` extends the DOCX model to recursive `blocks: (DocParagraph | DocTable)[]` (replacing the flat `paragraphs` array, which is now a derived view for back-compat). `DocTable = { rows: DocRow[] }`, `DocRow = { cells: DocCell[] }`, `DocCell = { blocks: ... }` — nested tables are supported. The in-place save uses a table-anchored recursive reconciler `applyBlocks` in `docxMapping.ts` (partitions a container's `w:p`/`w:tbl` children into table-delimited paragraph segments; tables zip 1:1 by order and recurse into cells; cell paragraphs are rewritten in place via `applyParagraphRuns`; `w:tblPr`/`w:tblGrid`/`w:tcPr` structural/grid/styling elements are preserved verbatim — zero reconstruction). The **cardinal rule is maintained**: no docx-writer rebuild, only position-addressed in-place text edits. Schema integration via `prosemirror-tables@1.8.5` (MIT) — `tableEditing()` plugin + node specs merged into `docxSchema` (`docxSchema.ts`) supply cell selection/nav only (add row/col/merge/split NOT bound — structure read-only in 3a; 3b/3c/3d deferred). `docModelToDoc`/`docToDocModel` emit/read table nodes recursively; PDF export (`docxToPdf.ts`) reads the top-level `paragraphs` view only (table structure not rendered in v1). Find/replace now reaches cell text (the C#2 scope was lifted — `findMatches` descendants() recurses into cells; zero code change post-3a). Deps: prosemirror-tables (0 vulns; shipping MIT + attr). Gated by existing `VITE_FEATURE_DOCX_EDIT` (no new flag). Guards: `tests/docx/docModelTables.test.ts` (recursive model + populated paragraphs), `tests/docx/docxTablesMapping.test.ts` (in-place reconcile + nested round-trip), `tests/browser/docx-tables.browser.test.ts` (real Chrome: cell edit+format → save → reopen, nested table survives, structure byte-identical).
**Table editing — Slice 3b (add/del row & column, 2026-06-23)**: the 3a "structure read-only" limitation is LIFTED for SIMPLE (un-merged) tables. `docxToolbar.ts` wires four prosemirror-tables commands — `addRowAfter`/`deleteRow`/`addColumnAfter`/`deleteColumn` (data-act = the command name; `update()` toggles `button.disabled` from `isInTable(view.state)` so they're greyed outside a table). The real work is `writeTable` in `docModel.ts`: it now reconciles row & cell COUNTS in place (NOT just the 1:1-min overlap) — extra rows cloned from the last `w:tr` (inherits cell `tcPr`/column structure), extra cells per row cloned from the row's last `w:tc`, trailing rows/cells removed, and `w:tblGrid` kept in sync (`syncTableGrid`: clone last `w:gridCol` to widen, trim to shrink — **no-op when the count already matches**, so a non-structural cell-text edit stays byte-identical and the 3a verbatim-structure tests still pass). **Cardinal rule preserved** — still in-place OPC surgery, never a docx-writer rebuild. **REFUSE gate (the 3b ceiling):** `tableHasMerges(tbl)` (a direct cell carries `w:gridSpan` or `w:vMerge`) → fall back to the 3a text-only min-reconcile (structure verbatim) — restructuring a spanned grid is deferred to **3c/3d (merge/split)**, which still need `DocCell` colspan/rowspan + the gridSpan/vMerge round-trip. The controller's `tableStructureUnsupported` warning is unchanged and still correct: row/col edits keep the table COUNT equal → the `saved` toast fires AND the change now genuinely round-trips (the prior silent-discard for same-count structural edits is fixed). i18n `docxToolbar.{addRow,deleteRow,addColumn,deleteColumn}` (ar reviewed 2026-07-30). Mid-column-insert may shift a cell's `tcPr` (text content + column count stay correct) — documented ceiling. Guards: `docModelTables.test.ts` (add/del row+col, grid sync, merged-table refusal, byte-identical non-structural), `docxToolbar.test.ts` (the 4 acts dispatch), `docx-tables.browser.test.ts` (real Chrome: add-row via the toolbar button → save → reopen → 3 rows; buttons disabled outside a table). Verified live (synthetic table .docx, `qa-shots/f2-table-3b/`).
**Table editing — Slice 3c/3d (cell merge & split, 2026-06-23)**: `DocCell` gains OPTIONAL `colspan?`/`rowspan?`
(the **PM shape** — covered grid positions are ABSENT, matching prosemirror-tables AND `docToDocModel`; `toJSON`
not involved — docx model isn't persisted to IndexedDB). `parseTable` (docModel.ts) reads `w:gridSpan`→colspan and
resolves a `w:vMerge restart`+`continue` run→rowspan on the restart cell, **dropping the continuation placeholder
cells** (`colCursor` sums gridSpans so a `continue` matches the restart open at the same start column). The PM bridge
(`docxProseMirror.ts` `cellToNode`/`cellOf`) passes colspan/rowspan through the `table_cell` attrs. Toolbar adds
**Merge cells**/**Split cell** (`mergeCells`/`splitCell`; data-act = command name; `disabled` mirrors the command's
own applicability — probed via `cmd(view.state)` with no dispatch). `writeTable` now has THREE paths: simple table →
the 3b path (byte-identical for non-structural); **merged table, layout UNCHANGED** → `reconcileMergedContent`
(content-only, merge structure verbatim — cells line up 1:1 because parse drops continuations identically); **merged
table, layout CHANGED** (a merge/split, detected by `gridSignature` divergence) → `rebuildMergedTable`. The rebuild
walks the grid row-by-row: a model cell emits a `w:tc` with `w:gridSpan` (colspan) / `w:vMerge restart` (rowspan),
columns covered by a rowspan-from-above emit a fabricated `<w:vMerge/>` continuation placeholder (`makeMergeCell`);
grid width = `sumColspans(rows[0])`; `w:tblGrid` resized. **Cardinal rule preserved** — scoped in-DOM `w:tr`/`w:tc`
surgery (cell CONTENT carried over via `reconcileContainer`), NEVER a docx-writer rebuild. **Supersedes the 3b
merged-table REFUSE** at the SAVE layer (the rebuild handles merged-table row/col too, latent defense-in-depth) — but
the toolbar still DISABLES row/col on a merged table (`currentTableHasMerges`), so v1's merged-table UI op is
merge/split only. **Ceiling:** per-cell box `tcPr` (shading/width) is regenerated minimal on the rebuild path (a
merge/split resets cell-box styling — content preserved); a pure text edit on a merged table keeps everything verbatim
(the UNCHANGED path). i18n `docxToolbar.{mergeCells,splitCell}` (ar reviewed 2026-07-30). Guards: `docModelTables.test.ts`
(parse gridSpan/vMerge→colspan/rowspan; emit colspan→gridSpan, rowspan→vMerge restart+continuation, split re-expand,
unchanged-merged verbatim, add-row-on-merged rebuild), `docxTablesMapping.test.ts` (colspan/rowspan PM round-trip),
`docxToolbar.test.ts` (merge via CellSelection, split, enabled-probes), `docx-tables.browser.test.ts` (real Chrome:
merge via toolbar → save → reopen → gridSpan/colspan survive). Verified live (`qa-shots/f2-merge-3cd/`: 2 header
cells → 1 colspan-2 cell; 0 console errs).
**Image & hyperlink preservation + display (Sub-project C Phase 1, 2026-06-26):** the DOCX editor's `save()`
was **data-lossy** — verified by probe: an image-bearing top-level `w:p` parsed to `{runs:[]}` and `setRunsOn`
wiped its `w:drawing` (image DESTROYED); a `w:hyperlink` survived but `parseParagraph`'s DEEP
`getElementsByTagName('w:r')` counted its nested run, so save APPENDED a duplicate plain run (link text TWICE).
Fix = a third OPAQUE `DocBlock` variant `DocImageBlock {kind:'image', image?, linkText?}` (sibling of `DocTable`).
**The preservation guarantee is DOM-structural, NOT model-based:** `isAnchorParagraphEl(p)` (deeply contains
`w:drawing` OR `w:hyperlink`) is checked at reconcile time, and `reconcileContainer` treats anchor `w:p` as
immutable BOUNDARIES (like tables) — segmenting around them and NEVER passing them to `setRunsOn`, in BOTH the
main path AND the count-mismatch fallback (`reconcileParagraphsOnly` now filters `&& !isAnchorParagraphEl(c)`).
So an anchor `w:p` is preserved byte-exact even if the PM doc diverges (e.g. user "deletes" the read-only atom →
it persists on save; true delete is Phase-2 C2). `parseContainerBlocks` emits `DocImageBlock` for anchors
(linkText read from XML; image bytes MERGED later in `mountDocxEditor` by block index from the existing
read-only `extractDocImages` channel — indices align: both walk `body` children filtering `w:p`/`w:tbl` in order).
`docxSchema` gains read-only atom nodes `docx_image` (renders the real PNG/JPEG via a `data:` URI) + `docx_link`
(shows link text); the PM bridge maps `DocImageBlock`↔atom (`imageBlockToNode`/`emitBlockTo`). `docxToPdf` SKIPS
image blocks in its text-flow loops (the image is drawn via its own `imagesByBlock` channel — never as a
paragraph). **Byte-identical when no drawing/hyperlink present** (the boundary set is then just tables, as before
— guarded by a no-regression control test). `parseDocModel`'s `paragraphs` view excludes image blocks too
(`!isDocTable && !isDocImageBlock`). **Ceiling (Phase 1):** a paragraph mixing flowing text + an inline
image/link is read-only (whole anchor is opaque); anchors are non-deletable/non-reorderable; an image INSIDE a
table cell is still PRESERVED byte-exact (cell anchor `w:p` skipped during cell recursion) but renders as an empty
atom, not the picture (image bytes are merged only for TOP-LEVEL blocks — `extractDocImages` skips nested-in-table,
the same ceiling as the PDF export); image EDITING (move/resize/delete) + EDITABLE links (`w:hyperlink`↔link-mark+rels
round-trip) are Phase 2 (C2/C3).
Guards: `tests/docx/{docModelImagePreserve,docxImageBridge}.test.ts` (jsdom: parse→block, drawing survives,
hyperlink single-occurrence, byte-identical control, atom round-trip) + `tests/browser/docx-image-preserve.browser.test.ts`
(real Chrome: img renders inline, link shown once, save round-trips drawing+blip+single hyperlink, plain para intact).
**Editable external hyperlinks (Sub-project C Phase 2a, 2026-06-26):** EXTERNAL `w:hyperlink` (`r:id`→http/https/
mailto) are now EDITABLE — they SUPERSEDE the Phase-1 hyperlink-opaque rule. `DocRun.linkUrl?` ↔ the
prosemirror-schema-basic `link` mark (`href`). `isAnchorParagraphEl` now returns opaque ONLY for `w:drawing` OR a
`w:hyperlink` that `isInternalOnlyHyperlink` (has `w:anchor`, NO `r:id`) — so an external-link paragraph parses as
an editable `DocParagraph`. `parseParagraph` walks DIRECT children IN ORDER (not the old deep `getElementsByTagName`
that double-counted), reading a `w:hyperlink`'s runs ONCE with `linkUrl` resolved from a rId→Target `linkMap`
(`opcParts.buildHyperlinkMap`). On save, `setRunsOn` removes existing `w:r` AND `w:hyperlink` and re-emits, grouping
maximal consecutive same-`linkUrl` runs into ONE `w:hyperlink` whose `r:id` comes from `DocApplyIds.links` (url→rId,
resolved reuse-or-create by `opcParts.ensureHyperlinkRel`, `sanitizeLinkUrl`-gated in `mountDocxEditor.save()` — an
invalid scheme drops to plain text, no rel). **De-dup is now STRUCTURAL** (read once / emit once), not opaque-skip.
**Byte-identical when no run has a linkUrl** (`ids.links` empty → grouping no-ops). Toolbar 🔗 button (`docxToolbar`)
+ inline URL input: caret-in-link removes; else reveal input, Enter sanitizes + applies the `link` mark.
INTERNAL-anchor (`w:anchor`) links stay opaque/preserved (Phase-1 `docx_link` atom) — editing them is the ceiling
(also: mixed external+internal paragraph stays opaque; Word `Hyperlink` char-style not re-applied; field-code
`HYPERLINK` instructions unhandled).
Guards: `tests/docx/{docModelLinks,opcPartsHyperlink,docxToolbar}.test.ts` + `tests/browser/docx-links.browser.test.ts`
(real Chrome: external link editable `<a href>`, internal read-only, save round-trips `w:hyperlink`+rels, toolbar
add-link creates a relationship). NB Phase-1 hyperlink fixtures were switched to internal-anchor (the now-opaque case).
**Image DELETE + RESIZE + editor undo (Sub-project C Phase 2b, 2026-06-26):** a TOP-LEVEL image anchor is now
resizable + deletable; untouched images (and hyperlink anchors, tables, cell-nested images) stay byte-exact.
**Identity:** `DocImageBlock.anchorId?` (OPTIONAL, **no `SCHEMA_VERSION` bump** — the docx model isn't persisted)
= 0-based index among TOP-LEVEL drawing anchors, stamped at parse (`parseContainerBlocks(..., stampAnchorIds)` —
body level only, so cell images get none and stay opaque), carried on BOTH the `docx_image` AND `docx_link` node
(`anchorId` attr, default -1). **The link also carries it** because an unsupported-format / unextracted image
(`extractDocImages` skips EMF/WMF/missing-media) falls back to a `docx_link` node — keeping its `anchorId` means the
save pre-pass PRESERVES it instead of treating it as deleted (would have been a data-loss regression). **Save
pre-pass** `reconcileImageAnchors(body, blocks)` in `applyBlocks`, GATED behind `opts.editImages` (only the editor
save passes it; `applyParagraphRuns` and every other caller omit it → byte-identical, images verbatim — else the
paragraphs-only path would see `S=∅` and DELETE every image). It deletes the `w:p` for an absent anchorId and
rewrites `wp:extent` (+ inner `a:ext`) cx/cy ONLY when dims differ (byte-exact when unchanged; EMU=pt×12700).
**SAFETY GUARD:** if surviving anchorIds aren't a duplicate-free subset of `{0..m-1}` → skip the pre-pass entirely
(Phase-1 verbatim, never corrupt). `S` is identity-only (any block with a numeric anchorId); RESIZE additionally
requires `image` (dims). **UI:** `src/docx/docxImageView.ts` NodeView — corner SE drag handle (px→pt ×0.75; base
on the node's stored widthPt NOT getBoundingClientRect, which `max-width:100%` clamps; aspect-locked, Shift = free
tracks dy independently) dispatching `setNodeMarkup`, + a ✕ button (`docxEditor.deleteImage`, ar reviewed 2026-07-30) and
Delete/Backspace on the selected atom. **Undo:** `prosemirror-history` (NEW dep, MIT) + `Mod-z`/`Mod-y` — the
editor had NO undo before; resize/delete (and now typing) are undoable, composing with findReplacePlugin's
single-tx replace-all. **Ceilings (v1):** image MOVE/reorder + new-image INSERT → v2; cell-nested images opaque;
a MIXED image+text paragraph deletes WHOLE (the Phase-1 atom = the whole `w:p`, hidden text too — undo recovers;
stripping just the drawing leaves a model-less text para the reconciler removes anyway). Guards:
`tests/docx/{docModelImageEdit,docxImageBridge,docxUndo}.test.ts` +
`tests/browser/docx-image-edit.browser.test.ts` (real Chrome: handles render, drag resizes pixels, Shift=free,
✕/Delete removes, save round-trips wp:extent/w:drawing, undo reverts).
**Export-PDF staleness FIXED (follow-up C, 2026-06-26):** `docxToPdf.docModelToPdfBytes` now renders each
`DocImageBlock` from its OWN live `image` data (`dataB64`/`mime`/`widthPt`/`heightPt`, round-tripped through the PM
node) in the `model.blocks` loop — so an in-session **resize** (live dims) and **delete** (block absent) show in
the exported PDF immediately, NOT only after save+reopen. The stale `getImages()`/`opts.images` second channel +
the positional `imagesByBlock` map are GONE (`DocxToPdfOptions.images` removed; controller calls
`docModelToPdfBytes(model)` with no images arg); `getImages()` stays on the handle, unused by export, for phase-B
insert/move. At mount, `extractDocImages` bytes are still merged into the model's image blocks, so an UNEDITED
export is byte-equivalent (every supported image still embedded, same place/size). A block with `image: undefined`
(unsupported format / link-fallback / cell-nested) draws nothing — unchanged ceiling. Guards:
`tests/browser/docx-to-pdf.browser.test.ts` (render-from-block / delete→no paintImageXObject / resize→wider
painted image, all real pdf.js) + the jsdom no-throw case in `tests/docx/docxToPdf.test.ts`. Live
eyes-on (2026-06-26): an in-session image resize was confirmed baked into the exported PDF — the
artifact itself is not retained (`qa-shots/` is gitignored and the container is reclaimed).
**New-image INSERT (Sub-project B, sub-slice 1 of 4, 2026-06-26):** the DOCX editor can now INSERT a
PNG/JPEG (📷 toolbar button → hidden file input → sniff magic bytes → `createImageBitmap` for natural
px → `widthPt = min(px×0.75, 468pt)` proportional → a `docx_image` PM node with `anchorId: -1`). It
renders inline immediately (the C2 NodeView) and survives `save()` as a brand-new `w:drawing` + `word/media`
part + Content-Types Default + image rel. **Engine:** `opcParts.ensureImagePart(opc, bytes, mime) → {rId,
target}` mints a fresh `word/media/imageN.png|jpg` (N = 1 + max existing), adds the Content-Types `Default`
for the extension **once** (images are typed by Default, not Override), and a `…/relationships/image` rel.
`docModel.materializeNewImageAnchors(mintImage, body, blocks)` is a save pre-pass that inserts a DOM `w:p`
anchor (`buildDrawingParagraph` → minimal spec-valid inline pic) for every NEW image block (`kind:'image'`,
`image` defined, **no** `anchorId`), placed by a per-block parallel walk of `blocks` vs the body's block
children so boundary order lines up and `reconcileContainer`'s segment-zip stays aligned. **Minting is a
CALLBACK** (`opts.mintImage?: (bytes, mime) => string`), NOT `opcParts` directly — `docModel` must not
import `opcParts` (cycle); the editor save passes `mintImage: (b, m) => ensureImagePart(opc, b, m).rId`.
**Ordering is load-bearing (deviates from the original spec):** `reconcileImageAnchors` runs FIRST (it keys
on parse-time anchor POSITIONS — inserting a new anchor before an existing one would shift those positions
and make it delete/resize the wrong anchor = data loss), THEN `materializeNewImageAnchors`, THEN
`reconcileContainer`. **Byte-identical when no image is inserted** (materialize no-ops without a new image;
legacy `applyBlocks` callers omit `mintImage`). A new image carries no `anchorId`, so `reconcileImageAnchors`
(identity-only on numeric `anchorId`) never touches it during the same save; on the NEXT open it parses as
an existing anchor with a fresh parse-time `anchorId`. **Ceiling (later sub-slices):** image MOVE/reorder
(slice 2 ▲▼+Alt), cut&paste (3), drag (4) — all sharing one save-side reorder built in slice 2; inline-
with-text insert, cell-nested insert, non-PNG/JPEG, dedup-by-content all out of scope. The toolbar exposes
`insertImage(bytes, mime, widthPt, heightPt)` for tests; an undecodable image (`createImageBitmap` throws,
caught) still inserts at 0 dims. i18n `docxToolbar.insertImage` (en/fr/ar, ar reviewed 2026-07-30). No new feature
flag (rides `VITE_FEATURE_DOCX_EDIT`); no `SCHEMA_VERSION` bump. Guards: `tests/docx/opcImagePart.test.ts`,
`tests/docx/docImageInsert.test.ts` (incl. the insert-BEFORE-existing data-loss case that proves the
ordering), the insertImage cases in `tests/docx/docxToolbar.test.ts`, and
`tests/browser/docx-image-insert.browser.test.ts` (real Chrome: file-pick → render → save mints
`w:drawing` + media part + Default + rel into a doc that had none). Live eyes-on: `qa-shots/b-insert/`.
**Image MOVE/reorder (Sub-project B, sub-slice 2 of 4, 2026-06-26):** the DOCX editor can move an
existing image up/down — **any distance, including crossing tables / other images** — persisted through
the in-place `save()` with **full fidelity** (no other content rebuilt). UI = ▲/▼ buttons on the selected
image's NodeView (beside C2's ✕/resize) + **Alt+↑/↓** when an image is selected; each press moves it past
one adjacent top-level block. **PM side:** `src/docx/docxImageMove.ts` — `moveImageAt(state, pos, dir) →
Transaction | null` (delete the node, re-insert before the prev / after the next top-level block, keep it
NodeSelected; null at a bound → no-op) + `moveImage(dir): Command` (gated on a `docx_image` NodeSelection),
one undoable transaction via the wired `prosemirror-history`. **Save side (the engine):** `applyBlocks`'
`editImages` branch builds an `anchorEl: Map<anchorId, Element>` **once, pre-mutation** (the DOM is parse
order, so `D[i]` has `anchorId i`) and shares it across two passes: `reconcileImageAnchors` (C2 delete/resize,
**refactored from positional to map-keyed** — behavior-identical, removes the old "ordering is load-bearing"
footgun) → `placeImageAnchors` (move existing by `anchorId` + insert new — **absorbs the former
`materializeNewImageAnchors`**). `placeImageAnchors` walks the model blocks with a cursor over the body's
**non-image-anchor** block children (text + tables + hyperlink anchors = fixed reference points, never
touched); an existing image is **moved** (`body.insertBefore` re-parents the element in place), a new image
is **inserted** (mint via the `opts.mintImage` callback — `docModel` still must not import `opcParts`, the
cycle). Then `reconcileContainer` runs **unchanged**. **Why full fidelity:** only image `w:p` elements
relocate, so after placement the boundary order matches the model and the segment-zip is all in-place
`setRunsOn` — a displaced paragraph's unmodeled `pPr` is **not** rebuilt (a strict improvement over a
reorder-then-reconcile-shuffle approach). **`applyBlocks` always re-parses the pristine `originalXml`**, so
multiple session moves compose and there's no mid-session `anchorId` churn (on the next open the doc
re-parses and anchorIds are reassigned by the new order). **Byte-identical when nothing
moved/inserted/deleted** (all passes no-op; legacy `applyParagraphRuns` omits `editImages`). C2 SAFETY GUARD
(model image anchorIds ⊆ map keys, dup-free) still bails to verbatim. **Ceiling:** moving tables/paragraphs
themselves, move-to-top/bottom, multi-select move; cell-nested images stay opaque/non-movable; cut&paste
(slice 3) + drag (slice 4) reuse `placeImageAnchors`. No new dep, no `SCHEMA_VERSION` bump, rides
`VITE_FEATURE_DOCX_EDIT`. i18n `docxEditor.moveImageUp`/`moveImageDown` (ar reviewed 2026-07-30). Guards:
`tests/docx/docImageMove.test.ts` (engine: move past text with `pPr` survival, cross-table, swap, move+insert,
byte-identical, map-keyed delete/resize regression), `tests/docx/docxImageMove.test.ts` (command bounds +
selection gate + undoable + NodeView ▲/▼ present), `tests/browser/docx-image-move.browser.test.ts` (real
Chrome: move past a table round-trips through save). Live eyes-on: `qa-shots/b-move/move-controls.png`.
**Image cut & paste (Sub-project B, sub-slice 3 of 4, 2026-06-26):** the DOCX editor supports
Ctrl/Cmd+**X/C/V** on a selected image and **paste of an external image blob** (OS "copy image" /
screenshot), persisted through the in-place `save()`. **Adds NO new save logic** — three small
ProseMirror-layer hooks (new `src/docx/docxImagePaste.ts`) route a pasted image into the *existing*
slice-1/2 `anchorId:-1 ⇒ mint-fresh` insert path. **The bug it fixes:** `docx_image` has a `toDOM`
but had no `parseDOM`, and PM's native copy preserves attrs → an intra-editor COPY duplicates
`anchorId` (two nodes both `anchorId:0`) → at save, `placeImageAnchors`' dup-free guard trips → the
save **bails to verbatim** → the pasted copy is silently dropped. **Fix = every PASTED image arrives
with `anchorId:-1`** so the save mints fresh OPC media instead. Three units: (1) `resetPastedImageAnchors(slice)`
wired as the `transformPasted` PM prop — walks the pasted fragment and rebuilds every `docx_image` with
`anchorId:-1`; PM runs `transformPasted` on the FINAL slice for BOTH the intra-editor slice path AND the
HTML-parse path, so one hook covers copy/paste AND cut/paste; (2) a scoped `parseDOM` on the `docx_image`
schema node — `img[data-docx-image]` with a `data:image/png|jpeg` src only (`priority:60` to win over
prosemirror-schema-basic's inline `image` rule `img[src]`; `getAttrs` returns `false` for any non-data
src so an arbitrary web `<img>` NEVER matches) → `{mime,dataB64,anchorId:-1}`; (3) a `handlePaste`
image-blob branch (AFTER the existing Ctrl+Shift+V plain-text check) — `firstImageFile(clipboardData)`
(files then items, png/jpeg) → `insertImageBlob` (slice-1 dims: `createImageBitmap`, `PT_PER_PX=0.75`,
`CONTENT_WIDTH_PT=468`, catch→0 dims) → insert `docx_image` `anchorId:-1`. **Cut needs no new wiring** —
it is PM-native copy+delete: the original's `w:drawing` is removed by `reconcileImageAnchors` (its anchorId
vanishes from the model), the pasted copy re-mints → move-via-clipboard (old media part orphaned, same as a
C2 delete). The shared image primitives (`sniffImageMime`/`imgBytesToB64`/`imageDimsPt` + the PT consts)
were LIFTED from `docxToolbar.ts` into `docxImagePaste.ts` (toolbar now imports them — behavior-identical,
the 📷 Insert button unchanged). No new dep, no `SCHEMA_VERSION` bump, rides `VITE_FEATURE_DOCX_EDIT`.
**Ceiling:** `http(s)` `<img src>` from web HTML (CORS — can't read the bytes client-side, never matched);
GIF/SVG/WebP (only PNG/JPEG minted, matches the slice-1 sniff); orphaned-media GC after a cut (no part GC
in v1); mixed text+image HTML fragments (an embedded image embeds only if it is a `data:`-uri
`<img data-docx-image>`). Guards: `tests/docx/docxImagePaste.test.ts` (jsdom: `resetPastedImageAnchors`
reset + non-image untouched, `parseDOM` data-uri parse + http/no-attr rejection, `firstImageFile`,
`transformPasted` wired) + `tests/browser/docx-image-cutpaste.browser.test.ts` (real Chrome: copy→paste →
**two** `w:drawing` after save = no verbatim-bail; cut→paste → one relocated; eyes-on before/after shot).
Live eyes-on: `qa-shots/b-cutpaste/{before-one-image,after-two-images}.png`.
**Image drag-to-reorder (Sub-project B, sub-slice 4 of 4 — COMPLETES follow-up B, 2026-06-26):** drag an
image with the pointer to reorder it among the document's **top-level** blocks, with a live drop-indicator
line, persisted through the in-place `save()`. **Custom pointer drag** (NOT native HTML5 drag) on the
`<img>` body — the `.se` resize handle / ✕ / ▲▼ children keep their own events, so image-body=move vs
SE-handle=resize is a clean element-level hit-test. **No new save logic** — reuses the slice-2 path:
`placeImageAnchors` already relocates a top-level `w:drawing` by `anchorId`. Two new PURE helpers in
`docxImageMove.ts`: `moveImageToGap(state, pos, gap)` (generalizes `moveImageAt`'s ±1 to an arbitrary
top-level block gap ∈ [0, childCount]; null on the image's own gap `g===ci||g===ci+1` or a non-top-level
target; `moveImageAt` was **refactored to delegate** — `dir -1 → gap ci-1`, `dir +1 → gap ci+2` — so slice-2
▲▼/Alt stay byte-green) + `dropTargetIndex(view, clientY)` (nearest top-level gap, counting block midpoints
above the pointer via `coordsAtPos` — top-level only, so a drop can never target a cell/inline position the
save can't represent). `docxImageView.ts`: pointerdown on the `<img>` records start X/Y but does NOT
preventDefault (a plain click must still select via PM); past a **5px threshold** it enters drag mode
(`.docx-image-dragging` dims the image) and renders a single reused `.docx-image-drop-line` (2px accent line,
`pointer-events:none`) at the gap; pointerup → `moveImageToGap(…, dropTargetIndex(…))` (no-op if it's the
image's own gap) or, below threshold, nothing (a click). The drop-line is appended to `view.dom.parentElement`,
which is set `position:relative` for the duration of the drag (restored on clear) so the absolute `top`
anchors correctly. One `prosemirror-history` undo step (same as ▲▼/resize). No new dep, no `SCHEMA_VERSION`
bump, rides `VITE_FEATURE_DOCX_EDIT`. **Ceiling:** drag into/out of a table cell (top-level only), drop at an
arbitrary inline position, touch-drag auto-scroll on very long docs (drop still computes; no auto-scroll),
multi-image drag-select. Guards: `tests/docx/docxImageMove.test.ts` (jsdom: `moveImageToGap` front/end/middle/
own-gap/clamp, `moveImageAt` slice-2 regression, `dropTargetIndex` above/below/between with stubbed coords,
NodeView sub-threshold-click no-move) + `tests/browser/docx-image-drag.browser.test.ts` (real Chrome: drag
below a table → `w:drawing` relocated after save; sub-threshold click → unmoved; eyes-on dim + drop-line shot).
Live eyes-on: `qa-shots/b-drag/{dragging,drop-indicator}.png`.

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
  precache unchanged at the 22 entries it had then (24 since the XLSX export added its lazy chunk and
  split fflate out — recount rather than assuming the old figure). Lesson: a pinned version is a snapshot of the advisory database, not a
  permanent fix, and because `npm audit` is the FIRST CI step a new advisory turns every deploy red
  before a single test runs — including deploys of changes that have nothing to do with it.

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
disagree; the recipe itself is pinned in `/stack`'s `docs/plans/decontainerization.plan.md`. The
2026-08-06 bundle-alignment story in § "The Claude bundle is a CROSS-REPO artefact" (Gotchas) is the
historical record of the container era.
