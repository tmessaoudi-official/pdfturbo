# PDF → DOCX Fidelity Audit (2026-06-14)

Scope: `src/utils/flowDoc.ts`, `src/utils/flowDocWriters.ts`, `src/export/exportService.ts`,
`src/export/exportPipeline.ts`. Goal: enumerate every gap between the source PDF and the DOCX
output toward "near 100% visual fidelity". Read-only audit — no code changed.

Pipeline today: `getTextContent()` items + `getOperatorList()` →
`reconstructPage()` (lines→paras→runs) → `assignHeadings()` → `flowDocToDocxBlob()` (docx npm).
Source-PDF text + raster images only. Overlay annotations are NOT in this path
(`_extractFlowDoc` reads `documentModel.sourcePdfs`, never `elements`).

Severity legend: **P0** = blocks "looks like the PDF" for common docs; **P1** = frequent
visible degradation; **P2** = noticeable on some docs; **P3** = edge / cosmetic.

---

## 1. TABLES — DROPPED entirely (P1, fundamentally hard)

**Reconstructed:** nothing. There is no table model in `FlowDoc` at all — no `FlowTable`,
no cell grid. A ruled table's cell text is flattened into ordinary paragraphs by
`reconstructColumn` (flowDoc.ts:209). Cell borders (vector rulings) are never read.

**Evidence:** `_extractFlowDoc` (exportService.ts:337-438) handles only `paintImageXObject`,
fill-color, and text-show ops. `OPS.constructPath` / `OPS.stroke` / `OPS.fill` (the vector
rulings that make a lattice grid) are never inspected. Roadmap (verdict doc:78) lists lattice
tables as Phase 2 "deferred".

**Fix direction:**
- *Lattice/ruled:* iterate `opList` for `constructPath`+`stroke`, collect horizontal/vertical
  segments, snap to a grid, derive row/col boundaries (pdfplumber/pdf2docx method), bucket
  text words into cells by bbox, emit docx `Table`/`TableRow`/`TableCell`. docx npm fully
  supports tables + per-cell borders.
- *Borderless/stream tables:* column-gap clustering only (no rulings to anchor on) — chronic
  false positives; verdict doc:80 correctly flags this as out-of-scope.

**Effort:** lattice 1–2 weeks (geometry-heavy: CTM tracking for path coords, segment snapping,
text-to-cell assignment). **Library feasibility:** YES — docx supports tables; pdfjs exposes
the path ops. **Honesty:** the *detection* is hard, not the *emission*. Borderless tables are
fundamentally unreliable for everyone.

## 2. FONTS (P0 for color/size accuracy; P1 for the rest)

| Attribute | Status | Evidence |
|---|---|---|
| Family (real face) | **DROPPED → collapsed to 3 generics** | `familyOf` (flowDoc.ts:119-124) maps to serif/sans/mono only; writer maps those to Times New Roman / Arial / Courier New (flowDocWriters.ts:11-15). "Arial-BoldMT", "Calibri", "Garamond" all become one of 3 faces. |
| Size | Reconstructed (rounded to 0.5pt) | flowDoc.ts:258, writer ×2 → half-points (flowDocWriters.ts:106). Good. |
| Bold | Reconstructed (name-sniff) | `isBoldName` regex on PS name (flowDoc.ts:113). Misses bold encoded only via synthetic stroke / OS/2 weight with no name token. |
| Italic | Reconstructed (name-sniff) | `isItalicName` (flowDoc.ts:116). Misses faux-italic via text-matrix shear (`c≠0`) with a roman font name. |
| **Underline** | **DROPPED** | No grep hit in flow path; no `underline` on TextRun. PDF underline = a drawn line, not a glyph attr — needs path-op detection. |
| **Strikethrough** | **DROPPED** | Same — no `strike` emitted. |
| Color | Reconstructed (fragile) | `colorMap` keyed by **rounded integer `textMatrix[4],[5]`** (exportService.ts:427-433); `reconstructPage` looks up `Math.round(x),Math.round(y)` (flowDoc.ts:355). Brittle: keyed by exact rounded origin — any sub-pixel mismatch between op-list textMatrix and text-item transform misses; ignores stroke color, patterns, ICC/Lab/Separation colorspaces (only RGB/Gray/CMYK ops handled). Color is per-show-op origin, not per-glyph-run, so a colored word merged into a black run may be mis-attributed. |
| **Super/subscript** | **DROPPED** | No detection. Scripts are baseline-shifted small runs; `reconstructColumn` either merges them into the line (LINE_Y_TOL 0.5×size, flowDoc.ts:219) or splits a spurious line. No `superScript`/`subScript` on TextRun (docx supports both). |

**Fix direction:** (a) carry the real PS family and map a broader allow-list (Calibri,
Garamond, Verdana, Georgia, Tahoma…) before the 3-generic fallback — quick win. (b) Optional
font **embedding** via `@pdf-lib/fontkit` is *not* viable for the docx writer (docx npm embeds
its own way and subset fonts can't be re-embedded for new text — verdict doc:71). (c)
Underline/strike: detect thin horizontal `constructPath` segments overlapping a text run's
bbox → set TextRun flags. (d) Super/subscript: compare run baseline vs line baseline + size
ratio → `superScript`/`subScript`. **Effort:** family allow-list ~0.5 day; color robustness
~1 day; underline/strike ~2–3 days (shares table path-detection work); scripts ~1 day.
**Honesty:** exact face matching is fundamentally hard (subset names, no font file); the
3-generic collapse is the single biggest "doesn't look like the PDF" contributor for body text.

## 3. LAYOUT

| Dimension | Status | Evidence |
|---|---|---|
| Multi-column | Partial — **2-col only, no nesting/3-col** | `detectColumnSplit` (flowDoc.ts:146-187) finds ONE vertical gap → 2 columns; `reconstructPage` splits once (flowDoc.ts:359-371). 3+ columns, nested columns, and per-region column changes are dropped. Also: columns are emitted as **sequential paragraphs**, not docx section columns — reading order is preserved but the side-by-side *visual* layout is lost. |
| Alignment L/C/R | Reconstructed | `isCentered`/`isRight` heuristics (flowDoc.ts:296-304); writer maps (flowDocWriters.ts:71-75). |
| **Justify** | **DROPPED** | `FlowParagraph.alignment` type is only `'left'|'center'|'right'` (flowDoc.ts:52). No justified detection/emit — justified text becomes left. |
| **Indentation** | **DROPPED** | First-line/hanging/left indent never measured or emitted. `x0` is computed (flowDoc.ts:227) but only used for alignment, not indent. |
| **Line spacing** | **DROPPED** | Leading inferred only to *split paragraphs* (PARA_GAP, flowDoc.ts:109); never emitted as docx `spacing.line`. Output uses Word default leading. |
| **Paragraph spacing** | **DROPPED** | No `spacing.before/after` emitted (flowDocWriters.ts:110-119). Inter-paragraph whitespace is lost; everything gets default spacing. |
| Page size | Reconstructed | `properties.page.size` from page w/h ×20 twips (flowDocWriters.ts:140-145). |
| **Margins** | **DROPPED** | No `page.margin` set — Word applies default 1" margins regardless of the PDF's true text frame. Content origin shifts. |
| **Headers/footers** | **DROPPED** | Not detected or routed to docx header/footer; running heads + page numbers land inline as body paragraphs (often misfiring heading detection). |
| Page breaks | Reconstructed (per-page section) | each PDF page → its own docx section (flowDocWriters.ts:94,140). |

**Fix direction:** justify = add `'justify'` to the union + detect both edges flush (quick,
~0.5 day). Indentation = measure `x0 - columnLeft`, emit `indent.left/firstLine` (~1 day).
Para/line spacing = derive from baseline gaps already computed, emit `spacing` (~1–2 days,
high visual payoff). Margins = compute min/max text bbox per page → `page.margin` (~0.5 day,
**high payoff** — fixes global content drift). Headers/footers = detect repeated top/bottom
band text across pages → docx header/footer (~2–3 days). **Library:** docx supports all of
these (columns, justify, indent, spacing, margins, headers/footers). **Honesty:** all are
mechanically feasible; margins + spacing are the cheapest wins for "looks right".

## 4. LISTS (P2)

**Reconstructed:** bullet + ordered detection via leading-marker regex (flowDoc.ts:190-206,
317-327); writer emits docx `bullet` and native `numbering`/`w:numPr` with instance-based
restart (flowDocWriters.ts:77-92, 115-117, 151-163). Solid for flat lists.

**Gaps:**
- **Nesting:** `listDepth` is hard-coded `0` everywhere (flowDoc.ts:325) — never derived from
  indent. All nested lists flatten to one level even though the writer honors `level`
  (flowDocWriters.ts:114,116).
- **Mixed / continuation:** a wrapped list-item second line (no marker) becomes a separate
  non-list paragraph (breaks the item and, for ordered, restarts numbering via the instance
  logic, flowDocWriters.ts:83-92).
- **Marker coverage:** ordered regex is `\d+[.)]` only (flowDoc.ts:191) — misses `a)`, `i.`,
  `(1)`, lettered/roman lists. Bullet set is a fixed glyph list (flowDoc.ts:190) — misses
  custom dingbat/Wingdings bullets (common; rendered as glyphs from a symbol font).

**Fix direction:** derive `listDepth` from `x0` buckets (~1 day, unlocks existing writer
support); merge marker-less continuation lines into the prior item (~0.5 day); widen ordered
regex + map roman/alpha to docx `LevelFormat` (~0.5 day). **Effort:** ~2 days total. **Honesty:** quick win — writer is already capable.

## 5. HEADINGS (P2)

**Reconstructed:** document-wide size clustering — modal length-weighted size = body, larger
distinct sizes → H1–H3 (flowDoc.ts:381-405). Writer emits docx `HeadingLevel` (suppressed for
list paras, flowDocWriters.ts:111).

**Gaps / accuracy:** (a) size-only — a **bold same-size** heading is missed (no weight/caps
signal). (b) Only 3 levels (`slice(0,3)`, flowDoc.ts:395); 4+ distinct large sizes collapse.
(c) A whole large-font document (title pages, slides) mis-tags body as headings. (d) Headings
inherit the body-size assumption per *document*, so multi-document merges skew the modal size.
(e) docx Heading styles override the run's real size/color/family with Word's theme — so a
detected heading **loses its PDF size/color** unless the writer also passes explicit run
formatting (it does pass run size/color, but the paragraph `heading` style may still restyle).

**Fix direction:** add bold + ALL-CAPS + short-line signals to the heading score; support
H1–H6; cap "everything is a heading" by requiring body-size to cover ≥X% of text. **Effort:**
~1–2 days. **Honesty:** heuristic ceiling — tagged-PDF `getStructTree()` fast path (verdict
doc:79) is the real fix for the ~15% tagged PDFs and is exact when present.

## 6. IMAGES (P1)

**Reconstructed:** raster XObjects via `paintImageXObject`, resolving `g_`-prefixed names from
`commonObjs` and page-local from `page.objs` (exportService.ts:374-409); off-screen render pass
forces bitmap commit (exportService.ts:350-358); size from CTM `|a|,|d|`; emitted as PNG
`ImageRun` (flowDocWriters.ts:122-138).

**Gaps:**
- **Positioning:** images are NOT placed at their PDF coordinates. `FlowImage` carries x/y
  (exportService.ts:402-403) but the writer **ignores them** — every image is dumped in a
  **center-aligned paragraph appended after ALL text on the page** (flowDocWriters.ts:122-147,
  `[...textChildren, ...imageChildren]`). Inline figures, side-by-side images, and background
  images all collapse to a trailing stack. This is the biggest image-fidelity gap.
- **Z-order:** lost — text always before images regardless of paint order; a full-page
  background image renders on top of text in the DOCX (wrong) and text-over-image is inverted.
- **Sizing:** only axis-aligned (`|a|,|d|`); **rotated/skewed** images (non-zero b/c shear) get
  wrong dimensions (exportService.ts:399-400 falls back to `|c|`/`|b|` but ignores rotation) —
  no rotation applied to the ImageRun.
- **Re-encode:** every image re-encoded to PNG via canvas `toDataURL` (exportService.ts:395) —
  JPEG photos balloon in size and lose nothing visually but bloat the file; `mimeType` is
  hard-coded `'image/png'` (exportService.ts:405) despite the `image/jpeg` type existing.
- **Inline image masks / SMask / transparency:** drawn onto an opaque canvas — alpha may be
  flattened depending on bitmap source.
- **Clipping:** clip paths around images ignored — full bitmap emitted even if PDF clipped it.

**VECTOR GRAPHICS (paths/SVG/charts/logos) — DROPPED entirely (P1, hard).** Any
`constructPath`/`fill`/`stroke` content (logos, charts, diagrams, dividers, shapes, the
*background* of many "designed" PDFs) is invisible to extraction. There is no vector→DOCX
path. Evidence: only `paintImageXObject` is handled (exportService.ts:374); no path ops.

**Fix direction:** (a) anchored/floating images via docx `floating` + `HorizontalPositionAlign`
or absolute EMU offsets from `FlowImage.x/y` (~1–2 days — **high payoff**). (b) Vector graphics:
the pragmatic client-side answer is **rasterize each page region containing vector art** (render
the path bbox to canvas → PNG → ImageRun) rather than translate paths to DrawingML; full
vector→OOXML is very hard and low ROI. (~3–5 days for region rasterization). (c) Emit JPEG for
photographic XObjects to cut size (~0.5 day). **Honesty:** true vector→editable-shape is
fundamentally hard; rasterizing vector regions is the realistic "looks identical" path.

## 7. HYPERLINKS, ANNOTATIONS/OVERLAYS, RTL

- **Hyperlinks — DROPPED (P2).** `getAnnotations()` IS called elsewhere (textLayer.ts:62,
  formFieldOverlay.ts:31) but **not** in `_extractFlowDoc`. Link URIs and GoTo destinations
  never reach `FlowDoc`; link text appears as plain text. docx supports `ExternalHyperlink`.
  **Fix:** read link annotations, bbox-match to runs, wrap in `ExternalHyperlink` (~1–2 days).
- **Overlay annotations made in PDFturbo — CONFIRMED NOT EXPORTED (by design, P3 for fidelity
  but a product gap).** `_extractFlowDoc` iterates `documentModel.sourcePdfs` only
  (exportService.ts:303-309); it never touches `this._ctx.elements`. Text boxes, shapes,
  signatures, highlights, redactions, comments, ink, QR/codes added in the editor are absent
  from DOCX/MD (they DO appear in PDF/image export via `buildPageOverlays`). CLAUDE.md states
  this explicitly. **Fix:** fold overlay elements into FlowDoc as runs/images (~2–4 days,
  varies by element type). **Redaction caveat:** failing to apply redactions to DOCX export is
  a **data-leak risk** — redacted source text is still in the text layer and WILL export.
  Treat redaction-aware DOCX as **P0 security** if redaction + DOCX are ever combined.
- **RTL/bidi (P2).** Per-run + per-paragraph RTL flags set from `it.dir === 'rtl'`
  (flowDoc.ts:356, 306-314) and emitted as `rightToLeft`/`bidirectional`
  (flowDocWriters.ts:107,113). BUT: (a) no **logical reordering** — pdf.js may deliver visual
  order; (b) no Arabic **presentation-form → base normalization** (verdict doc:79 lists this as
  Phase 3); (c) mixed LTR/RTL runs in one line may be mis-spaced (SPACE_GAP uses x-gaps which
  are reversed for RTL). Arabic output is "flagged RTL" but not guaranteed correctly ordered.

## 8. READING ORDER (P1 for complex layouts)

**Reconstructed:** within a column, top-to-bottom by baseline then left-to-right
(flowDoc.ts:216, 252). 2-column docs read left column fully then right (flowDoc.ts:365-368) —
correct for simple 2-col.

**Gaps:** (a) only ONE split → 3-col, mixed 1/2-col pages, and pull-quotes/sidebars interleave
wrongly. (b) No recursive XY-cut (verdict doc:78 says "recursive" but code does a single cut).
(c) Floating callouts, footnotes, marginalia, rotated text all fold into the main flow at their
y-position, scrambling order. (d) Tables (being flattened) destroy reading order locally. (e)
No use of tagged-PDF `getStructTree()` which gives exact reading order when present (~15% of
PDFs). **Fix:** implement true recursive XY-cut (alternate H/V cuts) + tagged-PDF fast path.
**Effort:** XY-cut ~3–4 days; struct-tree path ~2–3 days. **Honesty:** general reading-order
recovery is fundamentally hard on untagged complex layouts — this is where all converters
degrade.

---

## Prioritized gap list (toward near-100% fidelity)

### P0 — blocks "looks like the PDF" for common documents
1. **Font family collapse to 3 generics** (§2) — body text wrong on every non-Arial/Times PDF.
   *Quick-ish:* broaden the family allow-list. (~0.5 day)
2. **Page margins dropped** (§3) — global content drift on every page. (~0.5 day, high payoff)
3. **Paragraph & line spacing dropped** (§3) — vertical rhythm wrong everywhere. (~1–2 days)
4. **Color robustness** (§2) — origin-keyed lookup is fragile; colored text frequently black.
   (~1 day)
5. *(Conditional)* **Redaction NOT applied to DOCX** (§7) — **security/data-leak** if DOCX+redaction combine.

### P1 — frequent visible degradation
6. **Image positioning** — all images dumped centered at page end, not at PDF coords (§6). (~1–2 days, high payoff)
7. **Vector graphics dropped** — logos/charts/shapes/backgrounds invisible (§6). *Realistic fix:* rasterize vector regions. (~3–5 days, hard)
8. **Tables flattened** — lattice detection via path rulings (§1). (~1–2 days, hard)
9. **Reading order on 3-col / mixed / complex** — true recursive XY-cut + tagged fast path (§8). (~3–6 days, hard)
10. **Underline / strikethrough dropped** (§2). (~2–3 days, shares path-detection)

### P2 — noticeable on some documents
11. **Justify alignment dropped** (§3). (~0.5 day, quick win)
12. **Indentation dropped** (§3). (~1 day)
13. **List nesting flattened + narrow marker coverage** (§4). (~2 days, writer already capable — quick win)
14. **Hyperlinks dropped** (§7). (~1–2 days)
15. **Heading heuristic: size-only, 3-level cap** (§5). (~1–2 days)
16. **Super/subscript dropped** (§2). (~1 day)
17. **RTL logical reorder + Arabic normalization** (§7). (~3–5 days, hard for correctness)

### P3 — edge / cosmetic / product (not pure fidelity)
18. **Headers/footers inline instead of routed** (§3). (~2–3 days)
19. **Editor overlay annotations not in DOCX** (§7) — by design; product decision. (~2–4 days)
20. **Image re-encode bloat (JPEG→PNG)** (§6). (~0.5 day)
21. **Rotated/skewed image sizing** (§6). (~1 day)

## Fundamentally hard vs quick wins
- **Quick wins (high ROI, ≤1 day each):** family allow-list, page margins, justify, list
  nesting/markers, para+line spacing. These alone move "looks like the PDF" the most for
  born-digital business docs.
- **Hard (fundamental, no client-side magic):** exact font face matching (subset fonts have no
  recoverable file), borderless/stream table detection (chronic false positives for everyone),
  general reading order on untagged complex layouts, true vector→editable DrawingML, pixel-
  perfect RTL logical reordering. For these, the honest ceiling is the same one Adobe hits —
  reconstruction by inference, plus a tagged-PDF (`getStructTree`) fast path that is *exact*
  but applies to only ~15% of PDFs. Vector art's realistic answer is region rasterization,
  not translation.

**Bottom line:** "near 100% visual" is reachable for born-digital, single/2-column,
text-and-raster-image business PDFs once the P0 quick wins (fonts, margins, spacing, color) +
image positioning land. It is NOT reachable — by anyone, client-side or not — for
vector-heavy, table-heavy, magazine-layout, or scanned PDFs without OCR and heavy heuristics.
