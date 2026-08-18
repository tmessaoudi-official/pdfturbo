---
name: pdf-lenses
description: >
  MANDATORY companion to every global review skill run in pdfturbo. Load this BEFORE running
  /sweep, /sleuth, /inspect, /gaps, /forge, /cross-check, /converge, /pre-commit or
  /aggregate-findings here — it carries the pdfturbo review dimensions, sleuth lens K, and the
  repo conventions those global skills do not know about. Extracted 2026-08-18 from the deleted
  repo-local copies of those skills (global-is-reference ruling: a repo may not duplicate a
  global skill; what was repo-specific in them lives here instead).
---

# /pdf-lenses — pdfturbo review dimensions & conventions

This skill adds no procedure of its own. It is the **domain payload** for the global review
skills: run the global skill for its machinery, with everything below folded into its scope.

## Repo conventions (apply to every review skill)

- **Reports live in the repo**: `var/claude/<skill>/` (gitignored). Never `~/.claude/projects/…`.
- **Non-blocking closes — no interrupts.** End with the findings and a plainly-stated offer
  (`N findings (P0:a P1:b P2:c) — say which to fix`), never a blocking question. The standing
  directive for this repo is no interrupts on routine work.
- **`/converge` runs autonomous by default here** at the tier CLAUDE.md § "Certification ladder"
  mandates. The three lenses are the repo agents: `export-fidelity-reviewer`,
  `safety-promises-reviewer`, `completeness-reviewer`.
- **Project scope only.** `~/.claude/` is the developer's own persistent install, out of this
  repo's audit scope — audit it from its own sessions, not from here.

## Review dimensions — MANDATORY additions to any sweep/review of this repo

Run these **in addition to** the global skill's own dimensions, on every review:

- **Export byte-identity at defaults (P0).** ~15 features in `CLAUDE.md` claim "byte-identical when
  the flag/attribute is unset" (`te.list`, `bates.enabled`, `flattenAllForms`, `hasAdvancedText`,
  `images: []`, `opts.editImages`, `ids`, `mintImage`, integer watermark densities…). Any change to
  `src/export/**` must either preserve that or amend the claim. A new branch in `renderText` or
  `buildPageOverlays` with no default-path test is a **P0** — the claim is load-bearing and untested
  claims silently rot.
- **Redaction burn ↔ crop coordinate space (P0 — information leak).** The rasterizer must pass
  `skipCropBox: true`, render the FULL page, draw the burn at full-page coords, and clip the canvas
  **LAST**. Any reordering, or a `setCropBox` before render, drifts the burn off the secret. This is a
  leak, not a cosmetic bug — treat any doubt as P0.
- **Undo/redo command integrity (P0).** Every mutation goes through a Command pushed to
  `historyManager`. A handler that mutates `documentModel` directly breaks undo. Check that new
  mutations are commands, and that coalescing paths (`handleTextInput`, `handleFormInput`) still
  **flush** in-flight edits on `undo()`/`redo()` rather than discarding them.
- **`updateMetadata: false` on every pdf-lib load.** The default `true` re-stamps `/Info` Producer +
  ModDate at *load* time, silently re-injecting what the sanitizer/compressor just stripped. Applies
  to verification re-loads too.
- **Persistence back-compat.** A new optional element/model field must: be optional, be omitted by
  `toJSON` when unset, and be read by `elementFactory.fromJSON` with `?? default` — so a legacy
  IndexedDB blob still restores. Adding a field WITHOUT a `SCHEMA_VERSION` bump is correct only if all
  three hold; otherwise it silently discards saved sessions.
- **Visual surface ⇒ pixel evidence.** jsdom exercises no canvas, no rasterization, no pointer
  gestures. A change to a rendered surface needs a `tests/browser/*.browser.test.ts` guard AND a
  before/after screenshot **delivered via `SendUserFile`** — `/qa-shots/` is gitignored, so a
  screenshot left on disk is evidence the developer never sees.
- **DOCX cardinal rule (P0).** `src/docx/**` edits `word/document.xml` IN PLACE and re-zips. Never
  rebuild via the `docx` writer (it drops every unmodeled part: tables, styles, numbering, headers).
  Anchor `w:p` (containing `w:drawing`, or an internal-only `w:hyperlink`) are immutable boundaries —
  never passed to `setRunsOn`.
- **3-locale key identity.** `locales/{en,fr,ar}.json` must stay key-identical (a PostToolUse hook
  checks this). New Arabic values are `[Unverified]` until natively reviewed — say so.
- **Anti-bandaid gate.** For every `||` fallback, `2>/dev/null`, `|| true`, error trap, retry loop,
  timeout bump or default-value assignment introduced: state the exact failure mode, the *physical*
  evidence that confirmed it (log, measurement, trace, test output), and whether the root cause is
  fixed. No evidence ⇒ **P0**, replace it with a root-cause fix.

## Sleuth lens K — MANDATORY additional agent for /sleuth

Beyond the global skill's agents A–J, always run **agent K** on this repo, and report its findings
as category **K** alongside A–J:

> **K — Output-path divergence.** pdfturbo has TWO export paths that must agree, plus a persistence
> path that must survive round-trips. Hunt for places they can disagree:
> **(1) Vector vs raster bake** — `buildPageOverlays` → `pdfElementRenderer` runs for normal export,
> but a redaction-bearing page goes through `rasterizePageWithRedactions` instead. `CLAUDE.md` admits
> the raster path is *"code-reviewed, NOT pixel-test-guarded"* for lineHeight/opacity/backgroundColor
> and the Slice-2 advanced text attrs. Find any attribute honoured by one path and dropped by the other.
> **(2) Byte-identity-at-default claims** — grep every "byte-identical when unset" claim in `CLAUDE.md`
> and check the code still satisfies it: does the guard actually short-circuit, or does a new branch
> run unconditionally?
> **(3) Redaction leak** — burn coordinates computed in one space and drawn in another (the
> `skipCropBox` / clip-canvas-last invariant). A misplaced burn is an information leak.
> **(4) Undo divergence** — a mutation that bypasses `historyManager`, or a coalesced edit that
> `undo()` discards instead of flushing.
> **(5) Persistence divergence** — an optional field written by `toJSON` but not read by
> `elementFactory.fromJSON` (or vice versa), which silently drops user data on session restore.
> **(6) DOCX in-place divergence** — a save path that rebuilds rather than edits in place, or that
> passes an anchor `w:p` to `setRunsOn` (destroys `w:drawing` / duplicates a hyperlink).
> For each: file + line, which two paths diverge, the smallest document that would show it, and
> whether a `tests/browser/*.browser.test.ts` case covers it (if not, that absence IS the finding).
> Research only, no writes.
