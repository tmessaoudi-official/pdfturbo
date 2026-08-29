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

Where each structural ceiling is actually pinned.

**Two corrections from the 2026-07-31 pass, both worth reading before trusting any row here.**

1. **C10's ceiling was written down wrong, in two places.** `KNOWN_ISSUES.md` said "Reconstructor is
   2-column" and the first version of this table said only 1- and 2-column were exercised. Both were
   already false: B6 shipped the recursive XY-cut (`splitColumns`, `COLUMN_MAX_DEPTH = 2`) and
   `tests/utils/flowDocColumns.test.ts` has asserted 3 columns ever since. The real boundary was found
   by measuring, not reading: **4 evenly-spaced columns yield 3 groups**, because the gutter search is
   restricted to the inner 20–80% of each region with a 5% minimum gap, so a level can decline to split
   even below the depth cap. A ceiling table is only as good as its last measurement — re-measure before
   citing a row.
2. **C11 is deliberately NOT pinned.** Its DOCX half is an inline predicate inside the private
   `ExportService._extractFlowDoc` (`a.subtype === 'Link' && typeof a.url === 'string'`). Pinning it
   would mean either booting the whole service or copying the predicate into a test — and a copy pins
   nothing, since it cannot fail when the original changes. That is exactly the vacuous-assertion trap
   this file warns about below. It becomes pinnable the day that predicate is extracted as a named pure
   function; until then, "no test" is the honest state and is recorded as such.

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
| C10 4+ column layout | yes — 3 columns work, 4 measured as 3 groups | `blockers/layout-flatten.blockers.test.ts` |
| C12 markup-annotation flatten | yes — a `/Text` note survives `getForm().flatten()` | `blockers/layout-flatten.blockers.test.ts` |
| C22 CropBox-origin flow LAYOUT | partial — the page-height and paragraph-y mismatch are asserted; the image-anchor and margin cases are NOT | `browser/blockers-cropbox-layout.browser.test.ts` |
| C19 Arabic tashkeel / GPOS | yes — marks reach the glyph stream; placement not asserted | `browser/ceilings.browser.test.ts` |
| C21 raster ink, no per-stroke edit | yes — the bake returns a PNG data URL | `browser/ceilings.browser.test.ts` |
| **C11** internal GoTo / sheared image / ICC spot | **NO**, and deliberately so — see below | — |
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
