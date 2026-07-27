---
name: ask-human
description: >
  PLAIN-TEXT question protocol — never AskUserQuestion. Context, a minimal failing example,
  clear numbered options, a recommended option first with its reason, then STOP and wait.
user-invocable: true
disallowed-tools: AskUserQuestion
---

<!-- ═══════════════════════════════════════════════════════════════════════════════════
  REWRITTEN 2026-07-27 (developer ruling, recorded under the 2026-07-27 integration). This skill previously
  mandated `AskUserQuestion` and forbade prose questions. That is now INVERTED:

    `AskUserQuestion` is FORBIDDEN in this project. It silently fails here — it returned
    "the user did not answer" four separate times on 2026-07-26 while the developer was
    actively at the keyboard, so a question asked that way can be lost with no trace and
    the turn ends as if nothing was asked. A gate that cannot fire is worse than none.

  The developer's instruction, verbatim: *"never use askUserQuestion — you must put the
  context clearly with clear options and clear examples with a recommended option"*.
═══════════════════════════════════════════════════════════════════════════════════ -->

## --help

> If ARGUMENTS contains `--help`: output the text below verbatim, then STOP — do not execute any other steps.
>
> ```
> /ask-human — Plain-text question protocol: context + example + numbered options,
>              recommended first with its reason, then stop and wait.
>              AskUserQuestion is forbidden — it silently fails in this container.
>
> No flags — invoked automatically by Claude whenever a decision belongs to the developer.
> ```

---

# Plain-text question protocol

Every question to the developer is **ordinary text in the response**. No tool call, no dialog, no
hidden state. Then **STOP**: end the turn and wait. Never assume an answer, never proceed on a
default, never re-ask a different question because the first one went unanswered.

## The five required parts

| # | Part | Requirement |
|---|---|---|
| 1 | **Context** | What is being decided and *why it is being asked now* — one short paragraph. Enough that the developer needs no scrollback. |
| 2 | **Example** | A **minimal concrete example** of the problem — for a language question, a runnable current-syntax program and its actual current output/error. Not a description of the program: the program. |
| 3 | **Options** | Numbered, mutually exclusive, each with its own consequence. Ordinarily 2–4. |
| 4 | **Recommendation** | **Option 1 is the recommended one**, marked `(recommended)`, with the reason it wins stated in the same breath. |
| 5 | **Escape hatch** | A visible final option — *"none of these / challenge the premise"* — plus an explicit invitation to tweak any option. The developer must be able to answer *and* amend in one reply. |

## Shape

```
## Question — <one-line subject>

<Context: what is being decided, why now, what is blocked on it.>

Today:

    <minimal example — actual code, actual output/error>

**Option 1 — <name> (recommended).** <What it does.> <Why it wins.>
   After: <the after-state — the same example under this option>

**Option 2 — <name>.** <What it does.> <Cost or risk that makes it second.>
   After: <after-state>

**Option 3 — none of these / challenge the premise.** <What you would want to hear.>

I'll wait for your answer before doing anything else.
```

## Non-negotiable rules

- **Never `AskUserQuestion`.** Not as a fallback, not "just to try", not for a yes/no.
- **Never a bare `?` with no options.** If a real choice exists, enumerate it. An unstructured
  question makes the developer do the work of designing the options.
- **Always a recommendation.** "What do you prefer?" with no lean is an abdication. State the
  recommendation and why — the developer can then disagree cheaply.
- **The after-state goes in the option.** Prose written *outside* the option list is easy to miss
  while comparing options; put each option's consequence *inside* that option.
- **One STOP per question set.** Batch related questions (3–4 is fine when the developer asked to
  move faster), but end the turn after the batch — never answer your own question and continue.
- **Never re-open a ruled decision** without new evidence, and say what the new evidence is.
- **Challenge before accepting.** If the developer's proposal has a failure mode, say so in one or
  two sentences *and still deliver what was asked* under a stated assumption if they reaffirm it.

## When this protocol is mandatory

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
- Any point where two readings of the request lead to **materially different work**.

## When it is NOT needed

Routine judgement calls with an obvious default, and pure information questions. Asking about
everything is its own failure — it converts the developer into a decision queue. Decide what you can
defend, state the assumption, and keep moving.

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
