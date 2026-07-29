---
name: qa-sweep
description: Exhaustive systematic QA on the real PDFturbo app in a real browser — boot, load a PDF, exercise every reachable control, collect console/network errors, run axe-core WCAG checks, screenshot everything. Use before a release, after any change to the editor/export/UI surface, or when a defect is reported that the test suites do not reproduce. Not a substitute for the vitest suites; it answers "does the product work?" rather than "does this unit work?".
user-invocable: true
disallowed-tools: AskUserQuestion
args: "[--allow-destructive] [--only <substr>] [--depth N] [--max-clicks N] [--no-a11y] [--fixture <pdf>] [--url <url>]"
---

## --help

> If `$ARGUMENTS` contains `--help`: print the block below verbatim, then STOP.
>
> ```
> /qa-sweep — drive the real app in a real browser and report what breaks.
>
> Usage: /qa-sweep [--allow-destructive] [--only <substr>] [--depth N]
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

# /qa-sweep

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
| `@playwright/mcp` browser tools | **`scripts/qa-sweep.mjs`** driving the repo's own `playwright` — no MCP server exists in this container |
| Link crawl (`--depth`, `--max-urls`, domain guard, visited URL set) | **UI-state crawl.** This app is ONE page; there are no links. `--depth` now means *disclosure* depth (menu → flyout → modal) |
| `--target=cli` | **Dropped.** There is no CLI binary to QA here |
| Step 0 auth detection via `ask-human` | **Dropped.** No backend, no login. Replaced by a dev-server + Chromium preflight |
| `advisor()` convergence loop | The **certification ladder** (`CLAUDE.md` § Certification ladder) |
| GIF via `claude-in-chrome` MCP | **Dropped.** Screenshots only |
| Report → `~/.claude/projects/<slug>/qa-sweep/` | **`var/claude/qa-sweep/<stamp>/`** — `~/.claude` is ephemeral here |

Two things the original could not have known, both encoded in the driver:

1. **axe-core must be injected with `page.evaluate`, never `addScriptTag`.** The app ships
   `script-src 'self'`, so an injected inline `<script>` is blocked. `page.evaluate` runs through
   CDP and is not subject to page CSP. Do **not** relax the CSP to make a11y testing work.
2. **The preinstalled `chromium-1194` is unusable** — it lacks `Map.prototype.getOrInsertComputed`,
   which `pdfjs-dist` v6 calls on every render, so *every* page render throws and it reads as a
   product bug. The driver refuses to run on it rather than emit fake failures.

## Run it

```bash
npm run dev &                       # the driver needs the app served
npx playwright install chromium     # once per container (~115 MB, not persisted)
node scripts/qa-sweep.mjs           # add --allow-destructive for the full surface
```

Exit codes: `0` no failures · `1` at least one FAIL · `2` harness could not run. Safe to use as a gate.

## Then interpret it — the part that is your job, not the script's

The driver reports facts. You decide what they mean.

1. **Every `FAIL` is a defect until proven otherwise.** A console error on a button click is the exact
   signature of the OCR-CSP breakage. Trace it to a root cause per Rule 14 — do not paper it over.
2. **`WARN: not clickable` is ambiguous — resolve it, do not report it.** It means Playwright could not
   click: the control may be genuinely covered by an overlay (a real defect), or merely off-screen
   behind a scroll container (a driver limit). Open the `-after.png` and say which. Today's known set
   is `nextPage`/`prevPage`/`lastPage`/`exportPreviewConfirm`.
3. **`SKIP` is coverage you did not get.** 46 controls skip by default (destructive names, or hidden
   by the time their turn came). Re-run with `--allow-destructive` before claiming a full sweep, and
   say plainly in your report which controls were never exercised.
4. **`A11Y` findings are product bugs with WCAG rule ids.** Do not fold them into "polish".
5. **A converged run is not a complete one.** The driver clicks each control once, in the state it
   happened to be in. It does not fill forms with boundary values, does not test tool *interactions*
   (draw → undo → export), and cannot drive the native Save dialog. Say so.

## Visual evidence — CAPTURED IS NOT DELIVERED

`var/claude/` is gitignored and this container is reclaimed. A screenshot left on disk is evidence
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

Written to `var/claude/qa-sweep/<stamp>/report.md` beside its screenshots. Baseline for comparison
(2026-07-29, flags default, no `--allow-destructive`): **147 checks · 94 pass · 0 fail · 6 warn ·
46 skip · 3 a11y violation types**, converging in ~1m20s. A run that reports materially fewer checks
than this has probably failed to reach the surface — investigate before trusting a green summary.
