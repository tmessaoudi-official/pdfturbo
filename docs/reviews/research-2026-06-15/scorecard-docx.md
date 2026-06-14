# DOCX Export Fidelity Scorecard — 2026-06-15 (Sprint 3)

Honest per-attribute measurement of PDF→DOCX export. Not a marketing "100%": each row is
**✅ done** / **🟡 reachable (queued, file:line + fix in `01-docx-gaps.md`)** / **⛔ ceiling
(fundamentally hard client-side)**. Built from static analysis (`01-docx-gaps.md`) + the prior
audit (`research-2026-06-14/02-docx-fidelity.md`). Source-PDF text + raster images only; overlay
annotations are deliberately out of this path (product decision) except redaction filtering.

## Scope reminder
Pipeline: `_extractFlowDoc` → pdf.js `getTextContent`+`getOperatorList` → `reconstructPage` →
`assignHeadings` → `flowDocToDocxBase64` (docx npm). Tested by `tests/utils/flowDoc*.test.ts` (jsdom)
+ `tests/browser/issue2/3*.browser.test.ts` (real Chrome, image/canvas paths).

## Scorecard

| # | Attribute | Status | Evidence / note |
|---|-----------|--------|-----------------|
| 1 | Body text extraction & reading order (1-col) | ✅ | `reconstructPage`; line/para clustering |
| 2 | 2-column reading order (XY-cut) | ✅ | `detectColumnSplit` (one V-cut) |
| 3 | Font size | ✅ | 0.5pt rounding → half-points |
| 4 | Bold / italic (name-sniff) | ✅ | `isBoldName`/`isItalicName` |
| 5 | Font family (real face) | 🟡→✅* | 28-entry `WORD_FONT_ALLOWLIST` + generic fallback (B-1). *Exact subset face = ⛔ (no embedded file) |
| 6 | Page margins | ✅ | `computeMargins` Q1/Q3 → `w:pgMar` (B-2) |
| 7 | Paragraph / line spacing | ✅ | `buildSpacing` → `w:spacing` (B-3) |
| 8 | Alignment L/C/R + justify | ✅ | ALIGN map incl. `JUSTIFIED` (B-5) |
| 9 | Indentation (left + first-line) | ✅ | measured vs colLeft (B-5) |
| 10 | Bullet lists (flat) | ✅ | `_BULLET_RE` |
| 11 | Ordered lists — decimal `1.`/`1)`/`(1)` | ✅ | **Sprint 3** widened markers + per-format refs |
| 12 | Ordered lists — lettered `a)`/`(a)`/`A)` | ✅ | **Sprint 3** `lowerLetter`/`upperLetter` LevelFormat |
| 13 | Ordered lists — roman `(i)` | 🟡 | maps to lowerLetter today (ambiguous per-paragraph); true roman queued |
| 14 | List nesting (multi-level `w:ilvl`) | 🟡 | writer honors `level`; `listDepth` still hardcoded 0 — bucket by x0 (Gap 4 part) |
| 15 | Headings (size-cluster H1–H3) | ✅ | `assignHeadings` |
| 16 | Headings H4–H6 + bold/caps signal | 🟡 | size-only, capped at 3 (Gap 5) |
| 17 | Color RGB / Gray / CMYK | ✅ | op-walk colorMap |
| 18 | Color spot / Separation / scn | 🟡 | `setFillColorN` unhandled → black collapse (Gap 6, B7); canvas-sample fallback queued |
| 19 | Images embedded + positioned | ✅ | floating `wp:anchor`, page-relative EMU (B-4, ISSUE-3/4) |
| 20 | Image JPEG re-encode (no PNG bloat) | 🟡 | extraction hardcodes `image/png`; writer already branches jpeg (Gap 7, **S effort**) |
| 21 | Rotated / skewed image sizing | 🟡 | axis-aligned only; CTM decompose queued (Gap 8) |
| 22 | Hyperlinks | 🟡 | `getAnnotations` not wired into export; `ExternalHyperlink` ready (Gap 2, high value) |
| 23 | Underline / strikethrough | 🟡 | geometric path-seg detection (Gap 1, needs path-op infra) |
| 24 | Super / subscript | 🟡 | baseline+size-ratio detection (Gap 3) |
| 25 | Redaction-aware (no leak) | ✅ | items under redaction dropped pre-flow (Sprint 1 P0) |
| 26 | RTL flags | 🟡 | flags only; logical reorder = ⛔ |
| 27 | Per-page sections (size+margin) | ✅ | one docx section per page |
| 28 | Lattice / borderless tables | ⛔ | vector-ruling / column-gap detection — chronic FP, multi-day |
| 29 | Vector graphics (logos/charts) | ⛔ | region rasterization only; no path→OOXML |
| 30 | 3+ column / recursive XY-cut | ⛔ | one cut today; recursive degrades on magazine layouts |
| 31 | Tagged-PDF `getStructTree` fast path | ⛔ | exact but only ~15% of PDFs; separate multi-day path |
| 32 | Headers/footers routing | ⛔ | repeated-band detection, noisy, multi-day |
| 33 | RTL logical reorder + Arabic forms | ⛔ | bidi reorder + presentation→base mapping fundamentally hard |
| 34 | Exact subset-font face match | ⛔ | no recoverable family from `ABCDEF+` subset — honest ceiling |

## Tally
- **✅ done: 16** (incl. 2 new this session: rows 11–12)
- **🟡 reachable, queued: 11** (rows 13,14,16,18,20,21,22,23,24,26 + roman) — all have file:line + fix sketch in `01-docx-gaps.md`
- **⛔ ceiling: 7** (rows 28–34) — confirmed fundamentally hard; documented, not promised

## Honest fidelity statement
For **mainstream business/technical PDFs** (single/two-column text, standard fonts, lists, colored
text, embedded raster images): fidelity is **high and improving** — the common attributes are done.
The remaining 🟡 set is real polish (links, sub/superscript, underline, spot-color, JPEG size,
nesting, more heading levels) and is precisely queued. The ⛔ set (tables, vector, complex
multi-column, RTL reorder, exact subset faces) is the genuine ceiling of *client-side, no-backend*
conversion — a number like "100%" is not achievable there without a server-side engine, and we say so.

**Highest-ROI next (per effort):** Gap 7 JPEG (S) · Gap 2 hyperlinks (M, high value) · Gap 14 list
nesting (M) · Gap 18 spot-color black-collapse (S–M).
