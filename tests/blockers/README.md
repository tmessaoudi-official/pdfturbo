# Blockers-to-100% confirming tests

Empirical proof for the blockers enumerated in the 2026-06-15 blockers research.

## What this directory is — and is NOT

It is a **historical snapshot**: the blockers that one research pass on 2026-06-15 found, each pinned
by a test. It is **not** a coverage suite for the product's structural ceilings. Audited 2026-07-29:

| | |
|---|---|
| blocker IDs pinned here | AR-1, CORE-P0-2, MD-1/2/3, TX-1, O1, S2, S3, S6, B-1, B-3 (8 `describe` blocks, 20 tests) |
| `KNOWN_ISSUES.md` ceilings touched | **C17** (S6 + S2), **C16** (CORE-P0-2, adjacent), **C8** (AR-1, partial) |
| ceilings with NO test here | the other 18 of C1–C21 |

So a green run here says *"the 2026-06-15 findings are still correctly handled"* — it does **not** say
the ceilings are covered. Do not read an absence here as an absence of a limit; read
[`KNOWN_ISSUES.md`](../../KNOWN_ISSUES.md) for that. Adding the missing 18 would be a deliberate new
effort, not a gap-fill — several ceilings (C15 OCR accuracy) are non-deterministic and deliberately
unencodable, and others are already guarded by ordinary tests elsewhere in `tests/`.

## Where the research went

`ac4ef68` ("clean repo for release") removed `docs/reviews/` wholesale. Recoverable from git history:

```bash
git show ac4ef68^:docs/reviews/research-2026-06-15-blockers/CONSOLIDATED.md
git show ac4ef68^ --stat -- docs/reviews/research-2026-06-15-blockers/   # list the raw/ files
```

The **living** register is `KNOWN_ISSUES.md` — ceilings `C1`–`C21` with escape hatches `EH-A`–`EH-E`.
Read that first; reach for git history only for the original measurement behind a specific blocker.

## Convention

A **REACHABLE** blocker is asserted with vitest **`it.fails(...)`** — the test states the
*desired/correct* behaviour and is GREEN precisely because that behaviour fails today. The moment
someone fixes it, `it.fails` flips RED and forces conversion to a normal passing assertion. This keeps
CI green while proving every blocker is real and giving the fix a built-in finish line.

A **CEILING** blocker (no client-side fix) is asserted with a normal passing `it` that **pins** the
current degraded behaviour, so a future change that alters it is noticed.

A **FIXED** blocker keeps its test as an ordinary regression guard and is tagged `(FIXED)` in the
`describe` title. **The title and the comments must describe what the code does NOW.** A stale
present-tense defect claim on a passing test is worse than no test: the suite is green while the prose
tells a reader the feature is broken. That happened — `docx-md.blockers.test.ts` carried three
"Markdown silently drops…" titles, three `REACHABLE` tags and three `TODAY:` claims that its own
passing assertions disproved (fixed 2026-07-29). When you fix a blocker, rewrite the narrative in the
same commit.

**Assertions pin measured output, not the absence of the old bug.** `expect(x).not.toMatch(/^1\./)`
is satisfied by a writer that emits nothing at all; `expect(x).toBe('b) beta')` is not.

**Known convention wrinkle:** S6 and S2 are `it.fails` but map to **C17**, a genuine ceiling rather
than a reachable blocker, so by the rule above they "should" be pinning assertions. They are left as
`it.fails` deliberately — C17 is the one ceiling with a plausible route out (hand-rolled CAdES ASN.1),
so the flips-red-on-fix behaviour is worth more here than convention purity.

Non-deterministic blockers (OCR recognition quality, timing, network) are NOT encoded here — they were
evidence-only in the consolidated report.
