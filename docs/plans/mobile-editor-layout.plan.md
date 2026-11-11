# Mobile editor layout

## Decisions Log
- [2026-11-11 22:47] AGREED: Opened from phone-signature-pad F3: the editor's mobile layout is a separate milestone after 1.1.0.

## Formal Plan

**Status: not started — scheduled AFTER the 1.1.0 release (ruling 2026-11-11, `phone-signature-pad.plan.md` F3).**

Finding (phone-signature-pad step 7 walkthrough, W15, 2026-11-11): on the developer's Android phone (Chrome, dpr 2.8125,
about 384 CSS px wide — W4), the editor itself is "mostly unusable": only about a quarter of the content is visible, and
it becomes usable only with Chrome's "desktop site" mode. The phone signature pad page is NOT affected (it rendered and
worked throughout the walkthrough). No screenshot of the failure exists yet: the first step is to get one from the
developer's phone and reproduce it in an emulated viewport of the same size, then measure (which container overflows,
what the 375px QA-sweep overflow check does and does not see — it passes today).

## Status
| # | Step | Size | State | Evidence | Files |
|---|------|------|-------|----------|-------|
| 1 | Reproduce: a phone screenshot from the developer + an emulated viewport of the same CSS size; name the overflowing element | S | todo | - | - |
