---
name: sweep
spotlight: true
description: Use when running a Phase 6 second sweep on uncommitted changes before committing, or reviewing code written outside the standard agent workflow.
user-invocable: true
disallowed-tools: AskUserQuestion
---

<!-- ═══════════════════════════════════════════════════════════════════════════════════
  pdfturbo CONTAINER ADAPTATION (2026-07-27). Imported from the developer's machine bundle
  `claude-setup-global-20260722` via the already-container-adapted phorj port. These deltas
  OVERRIDE the body below wherever they conflict:

  1. QUESTIONS ARE PLAIN TEXT. `AskUserQuestion` TIMES OUT in this cloud container, so a gate that
     "asks" cannot fire. Every "invoke ask-human" below means: print the question, a minimal
     concrete example, numbered options, and the recommended option FIRST with its reason, as
     ordinary prose — then STOP and wait. Protocol: `.claude/skills/ask-human/SKILL.md`.
  2. NO `advisor()` HERE — the tool does not exist in this environment. Independent certification =
     fresh-context read-only reviewer subagents (`.claude/agents/`), per CLAUDE.md
     § "Certification ladder". Self-grading is the last resort and MUST be disclosed as self-graded.
  3. REPORTS GO TO `var/claude/…` in the repo — gitignored (`/var`), survives compaction inside the
     session, never committed. NOT `~/.claude/projects/…`: that is wiped when the container is
     reclaimed, so a report written there is lost.
  4. `--scope=global|both` IS REMOVED wherever it appears: `~/.claude/` in this container is
     GENERATED from repo files by `scripts/claude-bootstrap/install.sh`, so auditing it audits a copy.
  5. ≤5 concurrent subagents (10 caused ~50% rate-limit failures upstream). Every pipeline agent
     writes its raw output to `var/claude/<stage>/raw/` BEFORE returning — autocompact fires at 80%
     here and in-conversation results do not survive it.
  6. PROJECT RULES WIN on any conflict: `/home/user/pdfturbo/CLAUDE.md` — the deploy gate, the
     certification ladder, the git-autonomy override, and the in-repo plan homes.
═══════════════════════════════════════════════════════════════════════════════════════════════ -->

## pdfturbo dimensions — MANDATORY additions to this skill's review set

Run these **in addition to** the dimensions below, on every sweep of this repo:

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
  before/after screenshot **delivered via `SendUserFile`** — `/qa-shots/` is gitignored and the
  container is reclaimed, so a screenshot left on disk is evidence nobody will ever see.
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

## --help

> If ARGUMENTS contains `--help`: output the text below verbatim, then STOP — do not execute any other steps.
>
> ```
> /sweep — Run a Phase 6 second sweep on uncommitted changes before committing, or review code written outside the standard agent workflow.
>
> No flags — invoked without arguments.
> ```

---

Run a Phase 6 Second Sweep on current uncommitted changes. **Never auto-applies anything — this command only reads and reports.** Use before committing or to review code written outside the standard agent workflow.

## Steps

1. **Assess the diff**:
   - `git diff --stat` — change footprint (files changed, lines added/removed)
   - `git diff` — full diff
   - `git diff --cached --stat` + `git diff --cached` — staged changes too

2. **Review each changed file** using the Phase 6 checklist:

   **All files**:
   - **Bug hunt**: logic errors, off-by-one, null/nil/undefined deref, unchecked error returns, unhandled edge cases
   - **Security**: credentials/secrets in code, injection risks (SQL, shell, template), missing input validation at system boundaries
   - **Contracts**: changed function signatures, changed CLI flags, changed API response shapes, changed config keys — flag every one as a potential breaking change
   - **Tests**: new behavior without a test? Modified behavior without updated tests?
   - **Docs**: changed public interface without updated documentation?

   **Shell scripts** (`.sh`):
   - Missing `set -euo pipefail` or equivalent
   - Unquoted variable expansions (`$VAR` instead of `"$VAR"`)
   - Missing error handling after commands that can fail silently
   - `rm -rf` on an unvalidated or unquoted path

   **Config / infra files** (`.yaml`, `.yml`, `Dockerfile`, `.env`):
   - Secrets or credentials committed directly
   - `ARG` without matching `ENV` if runtime access needed
   - Trailing `;` in list vars that would be silently swallowed

3. **Classify each finding** by severity:
   - **CRITICAL**: security hole, data loss risk, broken API contract, shell injection, unhandled error that will crash in production
   - **WARNING**: missing test, logic edge case, performance regression, missing error handling, unquoted variable
   - **NOTE**: style, naming, non-blocking improvement

4. **Output a structured findings table**:

```
## Sweep Results

| # | Severity | File:Line | Finding | Fix |
|---|----------|-----------|---------|-----|
| 1 | CRITICAL  | bin/deploy.sh:42      | Unquoted $DIR in rm -rf     | Quote: rm -rf "$DIR" |
| 2 | WARNING   | src/parser.sh:118     | Missing exit-code check     | Check return value of curl |
| 3 | NOTE      | src/checker/calls/ufcs.rs:41 | Unused binding        | Remove or document |

**Verdict**: PASS (safe to commit) or BLOCKED (N critical findings must be fixed first)
```

5. **Save the report**: Write findings to a timestamped file so they survive the session:

```bash
PROJECT_SLUG=$(echo "${CLAUDE_PROJECT_DIR:-$PWD}" | sed 's|^/|-|; s|/|-|g')
REPO_ROOT="${CLAUDE_PROJECT_DIR:-$PWD}"
SWEEP_DIR="$REPO_ROOT/var/claude/sweeps"
mkdir -p "$SWEEP_DIR"
SWEEP_PATH="$SWEEP_DIR/$(date +%Y-%m-%d-%H%M%S).md"
```

Write the full findings table (including verdict) to `$SWEEP_PATH`. Announce: "Sweep report saved to `$SWEEP_PATH`"

## Notes

- A single CRITICAL finding means verdict is BLOCKED
- Multiple WARNINGs with no CRITICAL = PASS with notes (your discretion)
- Apply **Kernighan's Law**: if the diff is hard to understand, that itself is a WARNING (complexity)
- Apply **Chesterton's Fence**: before flagging a removal as wrong, understand why the code existed (`git blame`, commit message)
- Apply **Hyrum's Law**: any changed public interface (CLI flag, function signature, config key, command output format) is a potential contract break — flag it
