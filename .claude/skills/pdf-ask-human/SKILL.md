---
name: pdf-ask-human
description: >
  pdfturbo's additions to the global /ask-human question protocol — its mandatory cases (export
  fidelity, documented ceilings, SCHEMA_VERSION) and a worked example. The protocol itself (five
  parts, rules) is global ask-human § Question quality.
user-invocable: true
---

<!-- THINNED 2026-09-28 (review-remediation 7.6): the shared question-quality protocol (five parts,
  shape, non-negotiable rules, when mandatory / not) moved to the global `ask-human` skill,
  § "Question quality"; this file keeps only what is specific to pdfturbo. History: AskUserQuestion was
  banned in the cloud-container era (it failed silently there) and re-inverted 2026-08-18
  (de-containerization ruling); renamed ask-human → pdf-ask-human the same day (a repo skill may not share
  a global skill's name). The full pre-thinning text is in git history. -->

## --help

> If ARGUMENTS contains `--help`: output the text below verbatim, then STOP — do not execute any other steps.
>
> ```
> /pdf-ask-human — pdfturbo's additions to the global /ask-human question protocol:
>     its mandatory-question cases and a worked example.
>
> No flags — invoked automatically by Claude whenever a decision belongs to the developer.
> ```

---

# Question protocol — pdfturbo additions

The protocol — the five required parts, the non-negotiable rules, when a question is mandatory and
when it is not — is the global `/ask-human` skill, § "Question quality". Whether a question stops
the turn or is shown and answered with the recommended option is CLAUDE.md § Mode. This file adds
only what is specific to this repo.

## Repo notes

- **Part 2 (the minimal example) here:** A **minimal concrete example** of the problem — for a language question, a runnable current-syntax program and its actual current output/error. Not a description of the program: the program.

## When a question is mandatory here

- Any **user-visible product or UX decision** — what a tool does, what a control looks like, what an
  export contains. Those are the developer's, made interactively, never ruled alone.
- Any **irreversible or outward-facing action** — a force-push, an `npm publish`, a deploy, rewriting
  published git history. Note that ordinary `git add` / `git commit` / `git push` are **autonomously
  authorised** here (CLAUDE.md § "Git autonomy") and must NOT be asked about.
- Any **change to a documented invariant or a declared ceiling** — the "byte-identical when unset"
  claims, a `REFUSE` gate in the true-edit engine, the DOCX in-place cardinal rule, a
  `SCHEMA_VERSION` bump. Weakening one of these is a product decision, not an implementation detail.
- A **certification loop that hits its cap** (CLAUDE.md § "Certification ladder": 5 rounds with findings still open → ask, never
  silently proceed).

The global cases (two readings leading to materially different work, …) apply as well.

## Worked example

```
## Question — should a rotated text element keep its underline on export?

`renderText` gates decorations behind `if (!elemRot && …)`, so a rotated text box exports with
its underline and background silently DROPPED. That is a documented ceiling, but a user who
rotates an underlined box sees the underline vanish with no warning — it reads as a bug.
This blocks nothing; it is a fidelity call.

Today:

    const te = new TextElement({ text: 'Total', underline: true, rotation: 15 });
    // editor: underline visible
    // exported PDF: no underline, no background rect — silently gone

**Option 1 — rotate the decoration with the text (recommended).** `drawLine` takes arbitrary
   endpoints, so the underline can be rotated with the same matrix the glyphs use; the
   background rect already has a rotation-safe anchor (`rectAnchor` + swapped dims).
   After: rotated underline exports correctly; the `!elemRot` gate is removed and the
   ceiling entry in CLAUDE.md is deleted rather than reworded.

**Option 2 — keep the gate, warn in the editor.** Cheapest: a badge on a rotated element whose
   decorations will not export.
   After: export unchanged (still no underline), but the loss is no longer silent.

**Option 3 — none of these / challenge the premise.** If you would rather block rotation on
   decorated elements outright, or accept the silent drop as-is, say so.

I'll wait for your answer before doing anything else.
```
