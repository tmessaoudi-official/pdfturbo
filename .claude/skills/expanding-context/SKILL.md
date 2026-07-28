---
name: expanding-context
description: Use at the start of Phase 1 Brainstorm for any task. Widens context before committing to an approach — ensures no blind spots. Silent by default; surfaces only surprises, material risks, or wrong-problem signals.
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

## --help

> If ARGUMENTS contains `--help`: output the text below verbatim, then STOP — do not execute any other steps.
>
> ```
> /expanding-context — Use at the start of Phase 1 Brainstorm for any task. Widens context before committing to an approach — ensures no blind spots. Silent by default; surfaces only surprises, material risks, or wrong-problem signals.
>
> No flags — invoked automatically by Claude during the reasoning workflow.
> ```

---

# Expanding Context

You are about to commit to an approach. This skill ensures you see the full territory
before you do.

**What this skill does**: runs the 23-dimension expansion framework internally (self-contained — the standalone `/expand` skill was not imported; the six groups below ARE the framework). You do NOT
output the full expansion to the user — you use the findings to inform your Phase 1 and
Phase 2 thinking. Produce only a brief internal summary (3-5 bullets) then proceed.

**When to surface the full expansion to the user**: only if they explicitly asked for it
(e.g. "what am I missing?", "give me the full picture", "expand this"). Otherwise keep it
internal and continue with the enriched context.

---

## Internal expansion (run silently)

Quickly sweep these 6 groups — 1-2 observations each, focus on surprises and non-obvious
items only. Skip dimensions where nothing is notable.

**I — Identity**: Is the scope what it appears to be? Is the mental model obvious?

**II — Structure**: What depends on this? What does this depend on? Any hidden contracts?

**III — Behavior**: What are the non-obvious failure modes? What edge cases exist?

**IV — Quality**: Any known issues, dark observability, or test gaps that matter here?

**V — Context**: What constraints or assumptions are load-bearing for this decision?

**VI — Discovery**: Any gaps, risks, or contradictions worth surfacing before proceeding?

**Questions**: Generate 2-3 internal questions — especially Strategic ones. If any question
would materially change the approach, surface it to the user before continuing.

---

## Decision gate

After the internal sweep:

- **No surprises found**: proceed to Phase 2 with enriched context. No output needed.
- **1-2 notable findings**: mention them briefly inline ("One thing worth noting before we
  proceed: ...") then continue.
- **Material risk or wrong-problem signal**: STOP and surface it explicitly. Ask the user
  before continuing. This is more valuable than any implementation.

---

## Skip conditions

Do NOT invoke this skill when:
- Input is already broad ("review the whole codebase", "plan the next sprint")
- Task is a simple lookup or rename with no design decisions
- You already ran this skill in the current session for the same topic
- The user explicitly said "just do it" (Small task signal — respect it)
