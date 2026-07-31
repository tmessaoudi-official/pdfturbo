# Blockers-to-100% confirming tests

Empirical proof for the blockers enumerated in the 2026-06-15 blockers research.

## What this directory is — and is NOT

It is a **historical snapshot**: the blockers that one research pass on 2026-06-15 found, each pinned
by a test. It is **not** a coverage suite for the product's structural ceilings. Audited 2026-07-29,
cross-checked against every ceiling 2026-07-31:

| | |
|---|---|
| blocker IDs here | AR-1, CORE-P0-2, MD-1/2/3, TX-1, O1, S2, S3, S6, B-1, B-3 — 12 IDs, 12 `describe` blocks, 18 tests |
| of those, mapping to a `KNOWN_ISSUES.md` ceiling | **4**: C17 (S6 + S2), C16 (CORE-P0-2), C8 (AR-1, partial), C1 (B-3, partial) |
| the other 8 | MD-1/2/3, TX-1, B-1, S3 — *fixed defects*, kept as regression guards; O1 — an *infra invariant* (advertised OCR languages ⊆ vendored assets). None is a ceiling |

So a green run here says *"the 2026-06-15 findings are still correctly handled"* — it does **not** say
the ceilings are covered, and 8 of its 12 blockers are not ceilings at all. Do not read an absence
here as an absence of a limit; read [`KNOWN_ISSUES.md`](../../KNOWN_ISSUES.md) for that.

## Ceiling → guard cross-reference (C1–C21)

Where each structural ceiling is actually pinned. The point of the table is the last group: five
ceilings are asserted **nowhere**, which is a real gap and is stated as one rather than left to be
inferred from a count. Adding them is a deliberate new effort, not a gap-fill.

| Ceiling | Pinned by | Where |
|---|---|---|
| C1 subset/CID new glyph | partial — B-3 refuses non-WinAnsi | `blockers/trueedit.blockers.test.ts`, `browser/trueedit-literal-subset.browser.test.ts` |
| C8 DOCX char-level bidi | partial — AR-1 pins *word*-level order | `blockers/arabic.blockers.test.ts`, `utils/bidi.test.ts` |
| C16 encryption R6 | yes — CORE-P0-2 pins AES-256 V5/AESV3 | `blockers/core-security.blockers.test.ts` |
| C17 PAdES / TSA / LTV | yes — S2 + S6 as `it.fails` | `blockers/signing.blockers.test.ts` |
| C2 Arabic in-place true-edit | yes — refuses → overlay | `handlers/textEditHandler.test.ts`, `utils/flowDocArabic.test.ts` |
| C3 Type3 / Form-XObject | yes — `isType3Font` / `isPath3OnlyTarget` refuse | `utils/contentStreamEditor.test.ts` |
| C4 `cm` rotation/shear in Path 3 | yes — F10 tilted-refuse | `utils/contentStreamEditor.test.ts` |
| C6 DOCX subset font face | partial — allow-list mapping + generic fallback; the ~75% accuracy figure is not asserted | `utils/flowDocFidelity.test.ts` |
| C7 DOCX CJK face | partial — content preserved verbatim; face absence not asserted | `utils/flowDocCjkCyrillic.test.ts`, `browser/cyrillic-docx.browser.test.ts` |
| C9 borderless tables | yes — *"returns [] when there are no vertical rules"* | `utils/flowDocTable.test.ts` |
| C13 borderless → CSV | yes — same lattice-only detection | `utils/flowDocTable.test.ts`, `browser/table-extract.browser.test.ts` |
| C14 Arabic searchable-OCR search | yes — the "Arabic honest contract" case | `browser/searchable-ocr.browser.test.ts` |
| C18 RTL layer select/copy/search | yes — item-level highlight pinned | `browser/arabic-search.browser.test.ts`, `browser/arabic-selection.browser.test.ts` |
| **C10** 3+ column layout | **NO** — only 1- and 2-column are exercised; nothing asserts how a 3-column page degrades | — |
| **C11** internal GoTo / sheared image / ICC spot | **NO** — external `/URI` links are covered, the ceiling itself is not | — |
| **C12** markup-annotation flatten | **NO** — a source comment in `export/exportService.ts` only | — |
| **C19** Arabic tashkeel / GPOS | **NO** — source comments in `export/arabicOverlay.ts` only | — |
| **C21** raster ink, no per-stroke edit | **NO** — `core/inkLayer.test.ts` covers the *vector* stroke model, not the raster limit | — |
| C5 PDF→DOCX pixel identity | **unencodable** — definitional (fixed-layout → reflowable); no assertion expresses it | — |
| C15 OCR accuracy | **unencodable** — bounded by a non-deterministic LSTM model; evidence-only by design | — |
| C20 XFDF Acrobat byte-exactness | **unencodable in-repo** — no Acrobat to compare against; the internal round-trip is the guarantee | `export/xfdfExport.test.ts`, `export/xfdfImport.test.ts` |

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
