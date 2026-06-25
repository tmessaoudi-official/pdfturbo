# Sub-project B — PDF→DOCX export fidelity (design)

Date: 2026-06-25. Parent: `2026-06-25-trueedit-docx-maxfidelity-program-design.md`.
Scope confirmed with user: **all five genuinely-open items** (B2 lattice tables + B4 heading bold/caps were
audited as ALREADY SHIPPED and removed). Struct-tree integration = **exact-replace-when-present** (recommended).

## Goal
Raise PDF→DOCX fidelity on the open frontier, **without regressions**: every item is gated/additive →
**byte-identical DOCX when the feature does not apply** (no tag tree, no outline, no repeated band, single
column, no ligature). Source-PDF text + raster path only (overlay annotations stay out of this path, per the
existing product decision).

## Pipeline anchors (verified)
- `_extractFlowDoc` (`exportService.ts:1003`) — per page: `Promise.all([getTextContent, getOperatorList, getAnnotations])` (`:1048`) → `walkPageOps` → `reconstructPage` (`:1117`); `assignHeadings(flowDoc)` after the page loop.
- `reconstructPage` (`flowDoc.ts:1011`) — words → `_detectLatticeRegions` (G9) → `detectColumnSplit` (ONE cut, `:1075`) → `reconstructColumn`.
- `assignHeadings` (`flowDoc.ts:1149`) — size-cluster + G11 style promotion.
- pdf.js exposes `getStructTree()` and `getOutline()` [Verified: `pdfjs-dist/types/.../api.d.ts:1481,969`].

---

## B7 — Latin ligature normalization (smallest; build first)
**State:** NFKC runs only on the Arabic path (`reverseRtlText :486`); LTR words push `it.str` raw (`:1060`).
**Approach:** a pure `foldLatinLigatures(s)` that maps ONLY the Latin presentation-form ligatures
U+FB00–U+FB06 (ﬀ ﬁ ﬂ ﬃ ﬄ ﬅ ﬆ) → their ASCII expansions. Applied to `it.str` in the LTR branch of
`reconstructPage`'s word build. **NOT blanket NFKC** (which would also fold CJK width forms, superscript
digits, etc. — out of scope and regression-risky). **Gate:** a string with no FB0x codepoint is returned
unchanged → byte-identical. **Files:** `flowDoc.ts`. **Risk:** very low. **Test:** unit `foldLatinLigatures('ﬁle')==='file'`, identity on plain ASCII; browser: a ligature-bearing PDF → DOCX text has `fi`.

## B3 — PDF outline → Word TOC / heading reinforcement
**State:** `getOutline()` never called. **Approach:** in `_extractFlowDoc`, call `doc.getOutline()` ONCE
(document-level, outside the page loop). When non-empty, attach `FlowDoc.outline?: FlowOutlineItem[]`
(title + dest-page + level). Writer: emit a Word `TableOfContents` (the `docx` package supports it) as a
leading section, OR (simpler v1) a styled bookmarked heading list. **Reading-order safe:** outline is
additive front-matter; body unchanged. **Gate:** no outline → field absent → byte-identical. **Files:**
`exportService.ts` (fetch), `flowDoc.ts` (model), `flowDocWriters.ts` (emit). **Risk:** low. **Open Q:** TOC
field (needs Word to "update field") vs. a plain bookmarked list — spec'd as a plain list v1 (renders without
a manual field-update), TOC field a v1b. **Test:** jsdom stub `getOutline` → assert model; browser → unpack
DOCX, assert the titles present as a heading list.

## B6 — Recursive 3-column XY-cut
**State:** `detectColumnSplit` called once (`:1075`) → max 2 columns. **Approach:** extract the split block
(`:1075-1085`) into a pure recursive `splitColumnsRecursive(words, pageWidth, depth)` — apply
`detectColumnSplit` to each resulting column, max depth 2 (→ up to 3–4 columns), with a **conservative gate**:
recurse only when the sub-column is wide enough AND a clean gutter is found (reuse `detectColumnSplit`'s own
threshold — it already returns null on no clean split). **Gate:** a single-column page yields one `null` split
at depth 0 → identical to today. **Files:** `flowDoc.ts`. **Risk:** medium (magazine layouts can over-split) —
the conservative gutter threshold + depth cap contain it; guard with a 1-col control test asserting
byte-identical output. **Test:** unit: a synthetic 3-column word set → 3 columns in reading order; a 1-col set
→ unchanged.

## B5 — Headers / footers routing
**State:** none — repeated top/bottom text lands inline. **Approach:** after all pages are reconstructed
(in `_extractFlowDoc`, post-loop), detect a **repeated band**: a top-region (or bottom-region) paragraph whose
normalized text recurs on ≥60% of pages at a consistent y-band. Lift it into `FlowDoc`-level
`header?`/`footer?` paragraph(s); the writer emits `Header`/`Footer` with `default` on each section
(`docx` supports `headers`/`footers` per section). **Gate:** no repeated band → no header/footer → the
paragraphs stay inline = byte-identical. **Conservatism:** require ≥3 pages AND ≥60% recurrence AND a
top/bottom y-band — a 2-page doc or a unique band is left inline (avoids false hoisting). **Files:**
`exportService.ts` (cross-page detect), `flowDoc.ts` (model + a pure `detectRepeatedBands(pages)`),
`flowDocWriters.ts` (emit). **Risk:** medium (noisy) — the recurrence threshold is the guard; page-number
footers vary per page so normalize digits before comparison. **Test:** unit `detectRepeatedBands` with 4
pages sharing a top line → header detected; 2 pages or unique lines → none. Browser: a multi-page PDF with a
running header → DOCX `word/header1.xml` present.

## B1 — Tagged-PDF `getStructTree` fast path (highest value, hardest; build last)
**State:** comment-only ceiling (`:1175`). **Approach (exact-replace-when-present):**
1. Fetch per page: `page.getStructTree()` + `page.getTextContent({ includeMarkedContent: true })` (the marked-
   content variant emits `beginMarkedContent`/`id` markers that tie text items to struct-tree leaves).
2. Build a pure `structTreeToFlow(tree, markedItems, pageWidth, pageHeight)` that walks the role tree
   (`H1..H6`/`P`/`L`/`LI`/`Table`/`TR`/`TD`/`Figure`) and emits `FlowParagraph[]` (+ `FlowTable[]`) in **exact
   document reading order**, with headings/lists/tables taken from the tags — no heuristic guessing.
3. **Integration gate:** `reconstructPage` takes an optional `structFlow?` — when a usable struct tree is
   present, USE it for paragraphs/headings/lists/tables and SKIP the heuristic `detectColumnSplit`/
   `assignHeadings` path for that page; when absent or unusable, fall through to today's heuristics →
   **byte-identical for untagged PDFs** (~85% of files).
4. `assignHeadings` is skipped for struct-tree pages (tags already carry levels).

**Honest hard part (flagged):** correlating struct-tree leaves to text items via marked-content IDs is the
risky 20%. **Mitigation:** a sub-spike (≤1h) on a real tagged PDF to confirm `includeMarkedContent` items
carry the IDs the tree references, BEFORE building `structTreeToFlow`. If correlation proves unreliable,
fall back to a **HINTS** integration (tags reinforce heuristics — headings/list roles only) rather than
exact-replace. Either way the untagged path is byte-identical.
**Files:** `exportService.ts` (fetch + gate), `flowDoc.ts` (`structTreeToFlow`, model), tests. **Risk:**
medium — fully contained by the presence gate. **Test:** unit `structTreeToFlow` on a hand-built tree →
ordered headed/listed paragraphs; browser: a real tagged PDF → DOCX headings/lists match the tags; an
untagged PDF → byte-identical to the pre-B1 export (regression guard).

---

## Build order within B (easy/safe → hard)
**B7 → B3 → B6 → B5 → B1** (B1 gated behind its correlation sub-spike). Each item = its own commit + full
gate; each lands with a jsdom unit + (where it has a rendered/extractable surface) a real-Chrome browser
guard, AND a byte-identical-when-inactive control assertion.

## Cross-cutting invariants
- **Byte-identical when inactive** is a REQUIRED test per item (the regression guard).
- New `FlowDoc`/`FlowPage` fields are OPTIONAL; `toJSON`/writers omit when unset (no format/schema break).
- No new runtime dep (docx `TableOfContents`/`Header`/`Footer` are already in the installed package; verify import).
- GRDF/client-side: no network, no upload.

## Tests (added)
`tests/utils/flowDocLigature.test.ts` (B7) · `flowDocOutline.test.ts` (B3) · `flowDocColumns.test.ts` (B6
recursion) · `flowDocHeaderFooter.test.ts` (B5) · `flowDocStructTree.test.ts` (B1) · browser:
`docx-outline.browser.test.ts`, `docx-headerfooter.browser.test.ts`, `docx-structtree.browser.test.ts`.

## Out of scope (walls, unchanged)
Borderless tables, vector→OOXML, exact subset-face, footnotes, RTL logical reorder (the existing partials hold).
