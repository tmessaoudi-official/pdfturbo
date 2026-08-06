---
name: cross-check
description: Deep standalone validation of a spec or doc — hunts contradictions, undefined terms, unstated assumptions, missing sections and ambiguities, then certifies the analysis with fresh-context reviewer subagents. Use it on a doc before building from it, or to detect doc-vs-reality drift.
user-invocable: true
args: "<spec-file> [--drift] [--dry-run]"
disallowed-tools: AskUserQuestion
---

<!-- ═══════════════════════════════════════════════════════════════════════════════════
  pdfturbo CONTAINER ADAPTATION (2026-08-06). Ported from pdfturbo, which had it from the
  container-adapted `stack` port (where `--drift` was invented), which had it from the developer's
  machine bundle. These deltas OVERRIDE the body below wherever they conflict:

  1. QUESTIONS ARE PLAIN TEXT. `AskUserQuestion` TIMES OUT in this container, so a gate that "asks"
     cannot fire. Every "invoke ask-human" below means: print the question, a minimal concrete example,
     numbered options and the recommendation as ordinary prose, then STOP and wait. Protocol:
     `.claude/skills/ask-human/SKILL.md`. Every reply ends with a `❓ QUESTION` / `⏹ NO QUESTION`
     marker as its literal last line.
  2. NO `advisor()` HERE. Independent certification = fresh-context read-only reviewer subagents —
     the three pdfturbo lenses in `.claude/agents/` (`export-fidelity-reviewer`,
     `safety-promises-reviewer`, `completeness-reviewer`). Spawn them by name rather than re-describing
     their charter inline. Self-grading is the last resort and MUST be DISCLOSED as self-graded.
  3. REPORTS GO TO `var/claude/…` in the repo — gitignored, survives compaction inside the session,
     never committed. NOT `~/.claude/projects/…`, which is wiped when the container is reclaimed.
  4. THE JIRA MODE IS DELETED (inherited from the `stack` port). There is no Jira here, and a
     documented mode that cannot execute is worse than an absent one.
  5. THE PRIMARY TARGET IS `CLAUDE.md` ITSELF, and `--drift` is why this skill was ported. pdfturbo has
     no spec; its § Gotchas section IS the decision register (project CLAUDE.md § "Plans live in the
     repo" says so), it runs to thousands of lines of claims about code, and it has repeatedly drifted
     from that code. Measured in the 2026-08-05 session alone: `KNOWN_ISSUES.md` C10 was false in two
     places at once, a § entry described a `globalAlpha` mechanism that appears nowhere in `src/`,
     `SECURITY.md` claimed every table row was test-pinned when 3 of 9 were not, a § entry asserted a
     Type3 font gate that does not exist, and a "four surfaces" count contradicted its own five-row
     table. Every one of those is what `--drift` looks for. Secondary targets: `KNOWN_ISSUES.md`
     (ceilings — re-measure before citing), `SECURITY.md`, `README.md`, `FEATURES.md`.
  6. A CEILING OR AN INVARIANT IS A RULING, NOT A DRAFT. Disagreeing with a documented ceiling is not a
     finding (see `/forge`'s Chesterton gate). Legitimate findings: the doc contradicting ITSELF, a doc
     claim the code refutes, a term used before it is defined, or a stated guarantee the code does not
     deliver. "This would be better as X" is not a finding.
  7. PROJECT RULES WIN on any conflict: `/home/user/pdfturbo/CLAUDE.md`.
═══════════════════════════════════════════════════════════════════════════════════ -->

## --help

> If ARGUMENTS contains `--help`: output the text below verbatim, then immediately STOP — do not execute any other steps. (`--help` takes precedence over all other flags.)
>
> ```
> /cross-check — Deep standalone validation of a spec or doc: contradictions, undefined terms,
>                unstated assumptions, missing sections, ambiguities. Certified by fresh-context
>                reviewer subagents.
>
> Usage: /cross-check <spec-file> [--drift] [--dry-run]
> ```
>
> Then output the complete flag table from the **"Flags"** section below. Then STOP.

---

# /cross-check — Doc validation

Parse `$ARGUMENTS`:

## Flags

| Flag | Behavior |
|------|----------|
| `<spec-file>` | Path to the doc to validate (required) |
| `--drift` | Also verify every checkable claim against the actual repo state (see Mode B) |
| `--dry-run` | Print findings to conversation only; no output file written |

If `<spec-file>` is not provided: report the error and stop.

Natural targets in this repo: `CLAUDE.md`, `templates/tips/env-update.md`, `templates/tips/env-scan.md`,
`templates/tips/file-layout.md`, `README.md`, `TODO.md`, `docs/**`, any `docs/plans/*.plan.md`, and
`scripts/claude-bootstrap/README.md`.

---

## Mode A — internal consistency (default)

### Step 1 — Read the doc fully

Read `<spec-file>` completely before forming any judgement. Do not skim; a contradiction between
section 2 and section 19 is invisible to a partial read, and that is the class of finding this skill
exists for.

### Step 2 — Independent check

Investigate the three angles yourself, then certify with **fresh-context read-only reviewer subagents**
that read the doc themselves (`advisor()` does not exist here). Loop: investigate → certify → repeat
until a round raises nothing new; cap at 5 rounds, then ask in plain text — never silently proceed.

- **Angle 1** (expanding-context): Are there implicit requirements not explicitly stated? Assumed
  context a reader might not share?
- **Angle 2** (adversarial): What internal contradictions exist? What claim in one section is
  contradicted in another?
- **Angle 3** (blast-radius): What is missing? What should be specified but isn't? Which edge cases
  are unaddressed?

Give the reviewers the doc and the analysis so far. If any raises something new, resolve it and re-run
the round.

### Step 3 — Categorise findings

- **CONTRADICTION** — a claim in section A directly contradicts a claim in section B
- **UNKNOWN** — a term or concept used without definition or reference
- **ASSUMPTION** — an implicit prerequisite not stated
- **MISSING** — a section that should exist but doesn't (error handling, rollback, security…)
- **AMBIGUOUS** — a statement that can be read more than one way
- **STALE** — a claim that was true once and is contradicted by the current tree (only with `--drift`)

---

## Mode B — `--drift`: doc vs reality

This project's docs make many **mechanically checkable** claims, and a stale one is worse than a
missing one because it is trusted. For every such claim in the doc, verify it and record the command
you ran as the evidence. Examples of what is checkable here:

| Claim shape | How to verify |
|---|---|
| A file/path layout claim | `ls` / `find` the path. A documented path that does not exist is STALE. |
| "§ X says the code does Y" | `grep` for the mechanism in `src/`. **This is the highest-yield check in the repo**: a § entry once described a `globalAlpha` scoping that appears NOWHERE in `src/`, and another asserted a Type3/invisible/vertical font gate on `deleteTextAt` that lives only in `replaceTextAt`. A claim about a named identifier is checkable in one grep — do it. |
| A CEILING in `KNOWN_ISSUES.md` | re-measure it; never cite the prose. C10 claimed "Reconstructor is 2-column" long after `splitColumns` became recursive, and a same-day cross-check table repeated the error because it was written FROM the ceiling text instead of from the tests. |
| "guarded by `tests/…`" | open the test and read the assertion. A pin made only of NEGATIVE assertions may not detect the thing it names — the redaction pin passed with the burn moved off-target until a positive pixel check was added. |
| "N tests pass" / a count | run the suite. Counts in prose go stale within a commit; `npm run test` and `npm run test:browser` (real Chrome — needs the container config, see CLAUDE.md) are the only sources. |
| A locale-key claim | `python3 -c "import json;…"` over all three of `locales/{en,fr,ar}.json`. They must stay key-identical, and a claim about ONE key is a claim about three files. Grep the locales for the CLAIM, not just the key you know about. |
| "the export is byte-identical when X is unset" | find the guard in `src/export/`, then confirm a test asserts it. This repo's core export invariant; an unguarded claim here is the highest-severity doc drift it can have. |
| A feature-flag default (`VITE_FEATURE_*`) | `grep` the flag in `src/` and in `main.ts`'s removal path — a flag documented ON that `main.ts` strips is STALE. |
| An npm script or gate step | `grep '"scripts"' -A30 package.json` and cross-read `.github/workflows/deploy.yml`. The deploy gate runs MORE than the three pre-commit checks; a doc listing fewer is STALE. |
| "N skills / N agents / N hooks exist" | `ls .claude/skills/`, `ls .claude/agents/`, `ls .claude/hooks/` — and check the inventory table in `CLAUDE.md` § "Claude config in this repo" against the result |
| A tool is available | `command -v <tool>`. In this container `ruff`, `python3`, `jq` and `git` ARE present; `pytest`, `yq`, `shellcheck`, `yamllint`, `shfmt` and `hadolint` may not be. Any doc claiming a command runs, without a manifest that wires it, is conditionally stale. |
| The prototype's behaviour | `python3 prototype/scout.py --help`. The prototype is the one runnable thing; a claim about it is cheap to verify and several in `CLAUDE.md` § Gotchas were written from reading it. |

Report each as **STALE** with: the claim, the command, its actual output, and the corrected value.
Do **not** silently fix the doc — report first. Docs are the project's memory; a correction the
developer has not seen is indistinguishable from a new error.

Counts drift fastest and are the highest-yield thing to check.

---

## Step 4 — Write output

- `--dry-run`: print to conversation only, then stop.
- Otherwise: write to `var/claude/reports/crosscheck-<basename>-<date>.md` (gitignored). Do **not**
  write `<spec-file>.validation.md` next to the source — that path is tracked here and the report is
  session state, not a deliverable.

State in the output whether certification was by reviewer subagents or **self-graded** (and if
self-graded, say why no reviewer was available). Also state which claims you could **not** check and
why — a doc validated with unverifiable claims silently marked OK is the failure mode this skill is
supposed to catch.
