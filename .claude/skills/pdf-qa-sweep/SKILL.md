---
name: pdf-qa-sweep
description: Exhaustive systematic QA on the real PDFturbo app in a real browser — boot, load a PDF, exercise every reachable control, collect console/network errors, run axe-core WCAG checks, screenshot everything. Use before a release, after any change to the editor/export/UI surface, or when a defect is reported that the test suites do not reproduce. Not a substitute for the vitest suites; it answers "does the product work?" rather than "does this unit work?".
user-invocable: true
args: "[--allow-destructive] [--only <substr>] [--depth N] [--max-clicks N] [--no-a11y] [--fixture <pdf>] [--url <url>]"
---

## --help

> If `$ARGUMENTS` contains `--help`: print the block below verbatim, then STOP.
>
> ```
> /pdf-qa-sweep — drive the real app in a real browser and report what breaks.
>
> Usage: /pdf-qa-sweep [--allow-destructive] [--only <substr>] [--depth N]
>                  [--max-clicks N] [--no-a11y] [--fixture <pdf>] [--url <url>]
>
>   --allow-destructive  include delete/remove/reset/redact/flatten/compress controls
>   --only <substr>      exercise only button ids containing <substr>
>   --depth N            max UI disclosure depth (default 3)
>   --max-clicks N       safety cap (default 250; converges ~145 today)
>   --no-a11y            skip the axe-core WCAG 2.1 AA pass
>   --fixture <pdf>      document to load (default tests/fixtures/qa-imagetext.pdf)
>   --url <url>          default http://localhost:5173/pdfturbo/
> ```

---

# /pdf-qa-sweep

## Why this exists

Every one of this repo's worst defects was invisible to the test suites: OCR dead in production
behind a CSP, a watermark that rendered nowhere, an Android keyboard loop that made typing
impossible, a destroyed `w:drawing` on DOCX save. `npm run test` is jsdom (no canvas, no
rasterization, no pointer gestures) and `npm run test:browser` mounts *components*. Neither boots the
product. This does.

## How it was adapted (read before "fixing" anything)

Ported 2026-07-29 from the machine bundle's `qa-sweep`. What the original assumed, and what replaced it:

| Original | Here |
|---|---|
| `@playwright/mcp` browser tools | **`scripts/qa-sweep.mjs`** driving the repo's own `playwright` — the script needs no MCP server |
| Link crawl (`--depth`, `--max-urls`, domain guard, visited URL set) | **UI-state crawl.** This app is ONE page; there are no links. `--depth` now means *disclosure* depth (menu → flyout → modal) |
| `--target=cli` | **Dropped.** There is no CLI binary to QA here |
| Step 0 auth detection via `ask-human` | **Dropped.** No backend, no login. Replaced by a dev-server + Chromium preflight |
| `advisor()` convergence loop | The **certification ladder** (`CLAUDE.md` § Certification ladder) |
| GIF via `claude-in-chrome` MCP | **Dropped.** Screenshots only |
| Report → `~/.claude/projects/<slug>/qa-sweep/` | **`var/claude/qa-sweep/<stamp>/`** — reports live in the repo, never in `~/.claude` |

Two things the original could not have known, both encoded in the driver:

1. **axe-core must be injected with `page.evaluate`, never `addScriptTag`.** The app ships
   `script-src 'self'`, so an injected inline `<script>` is blocked. `page.evaluate` runs through
   CDP and is not subject to page CSP. Do **not** relax the CSP to make a11y testing work.
2. **The preinstalled `chromium-1194` is unusable** — it lacks `Map.prototype.getOrInsertComputed`,
   which `pdfjs-dist` v6 calls on every render, so *every* page render throws and it reads as a
   product bug. The driver skips that build rather than emit fake failures, and falls back to the
   system Chrome (which is what CI uses).

## Run it

```bash
# Against the dev server:
npx playwright install chromium     # once per machine/CI run (~115 MB; a stale preinstalled 1194 is skipped)
npm run dev &
npm run qa:sweep                    # add --allow-destructive for the full surface

# What CI does — against the BUILT artifact, which is what actually deploys:
npm run build && npm run preview -- --port 4173 &
npm run qa:sweep -- --url http://localhost:4173/pdfturbo/
```

Exit codes: `0` no failures · `1` at least one FAIL · `2` harness could not run.

**`deploy.yml` runs the SCRIPT on every push** (since 2026-07-29), after `npm run build` and against
`vite preview` on :4173, so a console error / failed request / critical-or-serious axe violation blocks
the deploy and the screenshots upload as a CI artifact. CI cannot run this SKILL — there is no model in
the runner — so what CI gets is the mechanical half. **Your** half is the interpretation below, which is
why running `/pdf-qa-sweep` by hand is still worth doing: CI will not resolve a WARN, root-cause a FAIL, or
notice that 44 controls were skipped.

## Then interpret it — the part that is your job, not the script's

The driver reports facts. You decide what they mean.

1. **Every `FAIL` is a defect until proven otherwise.** A console error on a button click is the exact
   signature of the OCR-CSP breakage. Trace it to a root cause per Rule 14 — do not paper it over.
2. **`WARN: not clickable` is ambiguous — resolve it, do not report it.** It means Playwright could not
   click: the control may be genuinely covered by an overlay (a real defect), or merely off-screen
   behind a scroll container (a driver limit). Open the `-after.png` and say which. **There are
   currently ZERO known WARNs** — treat any as new. The historical ones are both fixed and worth
   knowing so they are not re-diagnosed: `nextPage`/`prevPage`/`lastPage` were controls that had
   legitimately become `disabled` (Playwright reports that as a bare timeout), now classified as
   SKIPs; `undoBtn`/`exportPreviewConfirm` were the crawl reaching THROUGH an open modal, because
   enumeration used visibility instead of hit-testable reachability.
3. **`SKIP` is coverage you did not get — and the real number is worse than the skip count.** The
   report now ends with `Exercised N distinct control(s) of M in the DOM` and **names** every control
   that was not. Read that line first; a green `0 fail` over 66 of 141 controls is not a clean bill of
   health. **CI passes `--allow-destructive`** (36 skips instead of 44 — it reaches redaction, erase
   and crop-remove), so a local default run is WEAKER than the gate; match the flag before comparing.
   Do NOT claim the sweep covers a specific feature without checking that list — measured 2026-07-31,
   `flattenBtn`, `sanitizeBtn`, `watermarkBtn`, `batesBtn`, `compressBtn`, `exportXlsxBtn` and the
   DOCX/MD/XFDF export buttons are **never clicked**, because `modalBinder.ts` registers the export flyout with
   `closeWhen: 'any-click'`, so the app shuts it the moment the first item is used. Four ways of
   re-opening it per child were built and measured; every one lost coverage overall, and the numbers
   are in `exercise()` so nobody repeats them blindly. Reaching those controls is open work.
4. **A `PASS` is not evidence of REACHABILITY.** Playwright scrolls programmatically to click, so it
   reports PASS on a control a finger cannot reach — measured 2026-08-04, the crop-margin ✓ button sat
   outside a 375px viewport with `elementFromPoint` at its own centre returning null, and the sweep
   still scored it PASS. The mobile check cannot catch that either: it asks
   `documentElement.scrollWidth > innerWidth`, which stays 375 because `.container` clips the overflow,
   and it runs in SELECT mode where mode-specific toolbars are `display:none`. For a new control, look
   at it at 375px in its own mode, or pin the CSS invariant statically
   (`tests/ui/toolbarWrapInvariant.test.ts`).
5. **`A11Y` findings are product bugs with WCAG rule ids.** Do not fold them into "polish".
6. **A converged run is not a complete one.** The driver clicks each control once, in the state it
   happened to be in. It does not fill forms with boundary values, does not test tool *interactions*
   (draw → undo → export), and cannot drive the native Save dialog. Say so.

## Visual evidence — CAPTURED IS NOT DELIVERED

`var/claude/` is gitignored. A screenshot left on disk is evidence
**nobody will ever see**. For anything with a rendered surface, attach the before/after with
**`SendUserFile` in the same turn** — see `CLAUDE.md` Rule 6 / the pdfturbo amendment. A report that
says "screenshots saved to var/claude/…" has produced no Coverage evidence at all.

## Certify before reporting

`advisor()` does not exist here. Run the ladder in `CLAUDE.md` § Certification ladder against your
findings — the three reviewer agents in `.claude/agents/`, or, if subagents are unavailable, three
distinct-lens self-passes **with explicit disclosure that certification was self-graded**. The lenses
that matter for a sweep:

- **Coverage** — which controls never got clicked, and why? Which feature flags were off, hiding
  surface entirely? (`VITE_FEATURE_*` — a flag-off run silently has less to test.)
- **Interpretation** — is every `FAIL` root-caused rather than described? Is every `WARN` resolved to
  defect-or-driver-limit?
- **Honesty** — does the report distinguish "passed" from "not tested"? Are the skips listed?

## Report format

```
QA-SWEEP REPORT
Target: <url> | Fixture: <pdf> | <iso timestamp>
──────────────────────────────────────────────────────────────────────────────
PASS  <control>   — no console/network errors            [shot.png]
FAIL  <control>   — console: Uncaught TypeError …        [shot.png]
WARN  <control>   — not clickable: …                     [shot.png]
SKIP  <control>   — destructive by name
A11Y  a11y (WCAG 2.1 AA) — color-contrast:serious(2), …
──────────────────────────────────────────────────────────────────────────────
Summary: N checks | P pass | F fail | W warn | S skipped | A a11y
```

Written to `var/claude/qa-sweep/<stamp>/report.md` beside its screenshots.

**Baseline, `--allow-destructive` (what CI runs), measured 2026-07-31:**
**151 checks · 114 pass · 0 fail · 0 warn · 37 skip · 0 a11y · 0 accepted-by-decision**, over
**66 distinct controls of 141** in the DOM, in ~2 min including the 5 workflow scenarios. A DEFAULT run
(no flag) measures **149 · 103 · 0 · 0 · 46**, so always compare like with like.

Read the numbers in this order, because two of them mislead on their own:

- **Distinct controls, not the check total.** The DFS revisits some controls at different depths, so
  the entry count exceeds distinct coverage. The report's `Exercised N distinct control(s) of M` line
  is the honest figure; a `0 fail` over 66 of 141 is not a clean bill of health.
- **`0 accepted-by-decision` is load-bearing.** `A11Y_ACCEPTED` was emptied on 2026-07-31 when the last
  exception (`scrollable-region-focusable`) was properly fixed. A run reporting an `ACCEPT` line means
  someone re-opened a hole in the gate — find out why before shipping.
- A run reporting materially fewer checks than this has probably failed to reach the surface at all.
  Investigate before trusting a green summary.
