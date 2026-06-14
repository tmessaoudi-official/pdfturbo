# PDF→DOCX Export Fidelity — Reachable Gap Analysis (2026-06-15)

Static-analysis pass, post-Sprint-2. Scope: `src/utils/flowDoc.ts`, `src/utils/flowDocWriters.ts`,
`src/export/exportService.ts`, `src/export/exportPipeline.ts`. Read-only. Builds on
`docs/reviews/research-2026-06-14/02-docx-fidelity.md` — that audit predates Sprint 2; this one
verifies what Sprint 2 actually landed (cite line) and re-scopes the 8 reachable gaps that remain.

Pipeline (verified): `_extractFlowDoc` (exportService.ts:303-454) →
`getTextContent()` + `getOperatorList()` → per-op CTM/color/image walk →
`reconstructPage` (flowDoc.ts:472) → `assignHeadings` (flowDoc.ts:564) →
`flowDocToDocxBase64` (flowDocWriters.ts:155). Source-PDF text + raster images only; overlay
`elements` are NOT in this path except redaction filtering (exportService.ts:315-317).

---

## Confirmed DONE

All items the brief lists as Sprint-2-complete were verified present in code.

| Attribute | file:line | Note |
|---|---|---|
| Font family allow-list (B-1) | flowDocWriters.ts:21-55 `WORD_FONT_ALLOWLIST`; :67-77 `resolveWordFont` | 28 entries + base-14 aliases; strips `^[A-Z]{6}\+` subset tag, `[-,].*$` style suffix, `(MT|PS|PSMT)$` foundry. Unknown → `FAMILY_TO_WORD` generic. Applied at writer TextRun :202 (`font: resolveWordFont(r)`). |
| Font size | flowDoc.ts:329 (`Math.round(w.size*2)/2`); writer :203 (`size: Math.round(r.fontSize*2)`) | Rounded to 0.5pt; emitted as half-points. |
| Bold (name-sniff) | flowDoc.ts:173-175 `isBoldName`; applied :327 | regex `bold|black|heavy|semibold|demibold`. |
| Italic (name-sniff) | flowDoc.ts:176-178 `isItalicName`; applied :328 | regex `italic|oblique`. |
| Page margins (B-2) | flowDoc.ts:533-557 `computeMargins`; writer :274-282 | Q1/Q3 quartile edges, clamped ≤40% page dim; emitted as `page.margin` twips. |
| Para/line spacing (B-3) | flowDoc.ts:419-439 (lineHeight/spaceBefore/spaceAfter); writer :94-108 `buildSpacing` | before/after clamped ≤200pt; line uses `LineRuleType.EXACT`. |
| Alignment L/C/R | flowDoc.ts:367-380, 396-397; writer ALIGN map :167-172 | center requires narrow-block width cap (:373-376). |
| Justify (B-5) | flowDoc.ts:385-391 `isJustified`; ALIGN.justify :171 (`AlignmentType.JUSTIFIED`) | both edges flush vs colLeft/colRight, last line exempt. |
| Indent (B-5) | flowDoc.ts:409-417 (indentLeft/indentFirstLine); writer :215-223 | measured vs colLeft / blockLeft. |
| Bullet + ordered lists (flat) | flowDoc.ts:249-266 regex, 442-452 detect; writer bullet :231, numbering :232-234, config :296-308 | instance-based restart (:177-189). |
| Heading detection (size cluster) | flowDoc.ts:564-588 `assignHeadings`; writer HEADINGS :166, :226 | length-weighted modal size = body; larger sizes → H1-H3. |
| Floating image position/size (B-4) | exportService.ts:410-414 (x/y/w/h); writer :242-272 `wp:anchor` | `floating` with PAGE-relative EMU offsets, Y-flipped (:247). |
| Redaction-aware extraction | exportService.ts:315-317; flowDoc.ts:124-140 `isItemRedacted`, 483 | items intersecting a redaction rect dropped before flow build. |
| Per-page sections | flowDocWriters.ts:191-294 (`doc.pages.map` → one section each) | each PDF page → its own docx section w/ size+margin. |
| RTL flags | flowDoc.ts:403 (para.rtl), 488 (run.rtl from `it.dir`); writer :204 `rightToLeft`, :228 `bidirectional` | flags only — no logical reorder (see Ceiling). |
| Color (RGB/Gray/CMYK) | exportService.ts:418-442 colorMap; flowDoc.ts:487 lookup; writer :205 | partial — see Gap 6 for the scn/Separation hole. |

---

## Reachable Gaps

### Gap 1 — Underline / strikethrough
**Current state:** Not detected, not emitted. `TextRun` in flowDocWriters.ts:196-207 sets
bold/italics/font/size/rtl/color only — no `underline`/`strikethrough`. `FlowRun` (flowDoc.ts:35-46)
has no field for either. The op-walk in exportService.ts:367-444 inspects only image, fill-color,
text-matrix and show-text ops — `OPS.constructPath`/`OPS.stroke`/`OPS.fill` are never read.

**Why pdf.js gives no direct attr:** PDF underline/strike are *drawn lines* (thin filled/stroked
rects under or through glyphs), not a glyph attribute. Font-name sniffing does NOT work (no
`-Underline` convention exists). So detection must be geometric.

**Fix sketch (geometric):**
1. In the op-walk, also handle `OPS.constructPath` + `OPS.stroke`/`OPS.fill`/`OPS.rectangle`. Apply
   the existing `ctm` (exportService.ts:353) to path coords to get device-space segments.
2. Keep only thin horizontal segments (height < ~2pt, width ≈ a run's width).
3. After text runs are built, for each run compute its bbox (baseline at `textMatrix[5]`, size
   from transform). A segment whose y sits ~0 to −2pt below baseline and overlaps the run x-range →
   `underline: { type: UnderlineType.SINGLE }`. A segment at ~0.3-0.4× size *above* baseline
   (mid-glyph) → `strikethrough: true`. docx `TextRun` supports both
   (`underline`, `strikethrough`).
4. Match by bbox overlap the same way the colorMap matches by origin.

**Effort:** M (2-3 days; shares the path-op infrastructure that lattice tables and vector regions
would also need — build it once). **Feasibility:** real but lower precision than bold/italic;
false positives from table rulings / hr dividers near text. Gate on "segment width ≈ run width and
no vertical companion segments" to avoid flagging table borders. **Test approach:** browser test
(real Chrome — path ops only populate via getOperatorList in browser) with a fixture PDF containing
one underlined word + one struck word; assert `<w:u>` / `<w:strike>` present in unpacked DOCX XML
and absent on a plain control paragraph.

### Gap 2 — Hyperlinks
**Current state:** Not extracted. `_extractFlowDoc` (exportService.ts:303-454) never calls
`page.getAnnotations()`; link URIs are absent from `FlowDoc`, link text exports as plain text.
**Reusable pattern already in-repo:** `textLayer.ts:62,76-78` reads `page.getAnnotations()`,
filters `ann.subtype === 'Link'`, uses `ann.url` + `ann.rect` (also `formFieldOverlay.ts:31`). The
exact extraction logic exists — it just isn't wired into the export path.

**Fix sketch:**
1. In `_extractFlowDoc`, add `page.getAnnotations()` to the existing `Promise.all` (currently
   getTextContent + getOperatorList, exportService.ts:319-322).
2. Filter `subtype==='Link' && url`. Convert each `ann.rect` (PDF y-up) into the same word
   coordinate space (`x`, `y` from transform) used in flowDoc.ts:484-488.
3. Add an optional `linkUrl?: string` to `FlowRun`. During `reconstructColumn`, tag any word whose
   bbox falls inside a link rect; carry `linkUrl` into the merge key (flowDoc.ts:344-358) so linked
   text doesn't merge with adjacent plain text.
4. In the writer, wrap consecutive same-url runs in `new ExternalHyperlink({ children: [run], link })`
   instead of pushing the bare TextRun (flowDocWriters.ts:195-207). `ExternalHyperlink` is already
   exported by the docx package.

**Effort:** M (1-2 days). **Feasibility:** high — clean annotation API, docx native support,
bbox-match identical to colorMap approach. Internal GoTo destinations (page jumps) have no DOCX
equivalent → emit as plain text or a bookmark; out of scope for v1. **Test approach:** jsdom test
can stub `getAnnotations` (no canvas needed) → assert FlowRun.linkUrl set; browser test → unpack
DOCX, assert `<w:hyperlink>` with the URL in `word/_rels/document.xml.rels`.

### Gap 3 — Super/subscript
**Current state:** Not detected. A baseline-shifted small run is either merged into its line
(LINE_Y_TOL = 0.5×size, flowDoc.ts:164,279) or split into a spurious one-word line. No
`superScript`/`subScript` on TextRun (flowDocWriters.ts:196-207); both are supported by docx.

**Fix sketch:**
1. In `reconstructColumn`, while words are grouped into a line (flowDoc.ts:277-284), record each
   word's own baseline `y` and `size` (currently the line takes a single dominant `size`,
   flowDoc.ts:289).
2. Per word, compare to the line's dominant baseline + dominant size: baseline offset > ~0.2×
   dominant size AND word size < ~0.85× dominant size → superscript (offset up) or subscript
   (offset down).
3. Add `script?: 'super' | 'sub'` to `FlowRun`; include in the merge key (flowDoc.ts:344-358).
4. Writer: `superScript: r.script==='super' || undefined`, `subScript: r.script==='sub' || undefined`.

**Effort:** S-M (1 day). **Feasibility:** good for footnote refs (¹), ordinals, chemical formulae.
Risk: distinguishing a genuine superscript from a slightly-misaligned glyph — require BOTH the size
drop AND the baseline shift (single signal too noisy). **Test approach:** unit test on
`reconstructColumn` with a hand-built RawTextItem[] where one item has a raised baseline + smaller
transform → assert `script==='super'`; browser test asserts `<w:vertAlign w:val="superscript"/>`.

### Gap 4 — List nesting + wider marker regex
**Current state:** `listDepth` is hard-coded `0` (flowDoc.ts:450) — never derived from indent, so
all nested lists flatten even though the writer already honors `level`
(flowDocWriters.ts:231,233). Ordered regex is `^\d+[.)]\s+` only (flowDoc.ts:252); bullet set is a
fixed glyph list (flowDoc.ts:250). Misses `a)`, `i.`, `(1)`, `A.`, roman, lettered markers, and
custom dingbat bullets.

**Fix sketch:**
1. **Nesting:** the column's `colLeft` is already computed (flowDoc.ts:313). Bucket list-item `x0`
   into indent levels (e.g. round `(group[0].x0 - colLeft) / (domSize)` into 0,1,2…) and set
   `para.listDepth` to that bucket instead of `0` (flowDoc.ts:450). Writer already maps it.
2. **Marker regex:** widen `_ORDERED_RE` to also match `^\(?[a-z]\)[.)]?\s+`, `^\(?(?:[ivxlcdm]+)\)[.)]?\s+`
   (roman), `^\([0-9]+\)\s+`, `^[A-Z][.)]\s+`. Guard the single-letter/roman cases against author
   initials ("A. Smith") by requiring a following list-like context (the existing comment at
   flowDoc.ts:251 flags this exact false-positive risk — keep the guard).
3. **Marker → format:** map roman/alpha to docx `LevelFormat.LOWER_ROMAN` / `LOWER_LETTER` /
   `UPPER_LETTER` in the numbering config (flowDocWriters.ts:298-307, currently `DECIMAL` only).
4. (Optional, +0.5d) merge marker-less continuation lines into the prior list item so wrapped items
   don't restart numbering.

**Effort:** M (~2 days for nesting + regex + format mapping). **Feasibility:** high — writer is
already capable, this is the highest-ROI item per effort. **Test approach:** unit tests on
`detectListPrefix` for each new marker shape + a `reconstructColumn` test asserting `listDepth`
varies with x0; browser test asserts multi-level `<w:ilvl>` and `LOWER_ROMAN` in numbering.xml.

### Gap 5 — Heading bold/caps signal + explicit H1-H6
**Current state:** size-cluster only (flowDoc.ts:564-588). `headingSizes.slice(0,3)` caps at 3
levels (:578); `heading` typed `0|1|2|3` (flowDoc.ts:51). A bold same-size heading is missed (no
weight/caps signal). A whole-large-font doc (slides, title pages) mis-tags body as headings.

**Fix sketch:**
1. Widen the type to `0|1|2|3|4|5|6`, bump `slice(0,3)` → `slice(0,6)`, extend the writer's
   `HEADINGS` array (flowDocWriters.ts:166) to HEADING_4..6.
2. Add secondary signals to the per-paragraph rank decision (flowDoc.ts:580-587): if a paragraph is
   body-size BUT all runs bold AND it's a short single line (< ~60 chars) AND followed by body
   text → promote to a heading level below the smallest size-cluster heading.
3. ALL-CAPS short line → same promotion path.
4. Sanity cap: if the modal body size covers < ~30% of total weighted chars (flowDoc.ts:574),
   suppress heading promotion entirely (the "everything is big" slide case).

**Effort:** M (1-2 days). **Feasibility:** heuristic — improves recall but adds false-positive
surface; the bold-same-size promotion must be conservative. Tagged-PDF `getStructTree` is the exact
fix but applies to ~15% of PDFs (Ceiling). **Test approach:** unit test `assignHeadings` with a
fixture where a bold body-size line should become a heading and a 6-distinct-size doc maps to H1-H6.

### Gap 6 — Color robustness (scn / Separation collapse to black)
**Current state — where fill color is read:** exportService.ts:418-426 handles ONLY
`OPS.setFillRGBColor`, `OPS.setFillGray`, `OPS.setFillCMYKColor`. The colorMap is keyed by rounded
text-matrix origin (`${px},${py}`, :435-441) and looked up in flowDoc.ts:487 by
`${Math.round(x)},${Math.round(y)}`.

**The B7 bug:** PDFs using a `Separation`/`ICCBased`/`Pattern` colorspace set fill via
`OPS.setFillColorN` (the `scn` operator) or `OPS.setFillColor` (`sc`), NOT the three ops handled.
Those ops are silently ignored → `fillR/G/B` stay at their last value (default 0,0,0) → colored
text exports **black**. (Note `contentStreamEditor.ts:371` already has a `case 'scn'` — the
operator name is known in-repo, just unhandled in the export color walk.) Secondary fragility:
sub-pixel mismatch between op-list `textMatrix[4],[5]` and text-item `transform[4],[5]` can miss the
lookup; color is per-show-op origin, not per-glyph-run.

**Fix sketch:**
1. Handle `OPS.setFillColorN` / `OPS.setFillColor`: for a Separation/DeviceN with a tint, the args
   are tint components — without the colorspace's tint-transform function (not in the op-list) an
   exact color is unrecoverable, BUT a single-component tint of `1` ≈ full ink. Pragmatic: if scn
   args resolve to a non-default value and no RGB follows, fall back to the *last RGB/CMYK seen* OR,
   better, snapshot `currentFillColor` by also tracking the colorspace name from `OPS.setFillColorSpace`.
2. Robustness for the key-miss: instead of exact rounded origin, bucket colorMap keys to a small
   tolerance (e.g. round to nearest 2pt) or match by nearest origin within ±2pt at lookup time
   (flowDoc.ts:487) so a 1px op-vs-item drift still hits.
3. Defensive: never let an unhandled colorspace op leave a *stale* color — reset `fillR/G/B` to a
   sentinel on `setFillColorSpace` so a missed color reads as "default/black, unknown" rather than
   inheriting the previous run's color.

**Effort:** M (~1-1.5 days). **Feasibility:** partial — exact Separation/Lab/ICC color is hard
without the tint-transform (Ceiling-adjacent), but the *black-collapse* and the *origin key-miss*
are both fixable now and cover the common case (spot-color brand text). **Test approach:** unit
test the colorMap nearest-match tolerance; browser test with a Separation-color PDF asserting the
run color is non-`000000`.

### Gap 7 — JPEG photo re-encode (PNG bloat)
**Current state:** every extracted image is re-encoded PNG. exportService.ts:403
`imgCanvas.toDataURL('image/png')`, and `mimeType: 'image/png'` is hard-coded at :413 — despite
`FlowImage.mimeType` already supporting `'image/jpeg'` (flowDoc.ts:77) and the writer already
branching on it (`type: img.mimeType==='image/jpeg' ? 'jpg' : 'png'`, flowDocWriters.ts:257). So
the whole JPEG path is plumbed but never triggered. A full-page scanned photo becomes a multi-MB
lossless PNG.

**Fix sketch:**
1. Detect photographic content: heuristic on the decoded bitmap — sample N pixels, if the unique-
   color count is high (> ~5000) or the image is large (> ~200×200) treat as photo.
2. For photo content, `imgCanvas.toDataURL('image/jpeg', 0.85)` and set `mimeType: 'image/jpeg'`
   (exportService.ts:403,413). Keep PNG for small/flat/line-art images (preserves crisp edges and
   any transparency — JPEG has no alpha).
3. Even simpler v1: if the pdf.js image object exposes its original filter (`DCTDecode` =
   originally JPEG), prefer JPEG re-encode for those. Check the `imgData` shape from
   `store.get(imageName)` (exportService.ts:395) for a kind/filter hint.

**Effort:** S (~0.5 day). **Feasibility:** high — both paths already exist in the writer; this is a
one-branch change in extraction. Caveat: must NOT JPEG images with transparency (SMask) — JPEG
flattens alpha; gate on "no alpha channel". **Test approach:** unit/browser test exporting a
photo-bearing PDF and asserting `word/media/*.jpeg` (or `.jpg`) entry exists and total DOCX size is
materially smaller than the PNG baseline.

### Gap 8 — Rotated / skewed image sizing
**Current state:** size is computed axis-aligned only. exportService.ts:407-408:
`w = Math.abs(ctm[0]) || Math.abs(ctm[2])`, `h = Math.abs(ctm[3]) || Math.abs(ctm[1])`. For a
rotated CTM (non-zero b/c shear) this is wrong: a 90°-rotated image has `a=d=0` so width falls back
to `|c|` and height to `|b|` — which swaps/mis-derives the dimensions — and NO rotation is applied
to the `ImageRun` (flowDocWriters.ts:250-271 has no `rotation` in `transformation`). The image
lands axis-aligned at wrong size, never rotated.

**Fix sketch:**
1. Decompose the 2×2 CTM `[a,b,c,d]` properly: `scaleX = hypot(a,b)`, `scaleY = hypot(c,d)`,
   `rotation = atan2(b,a)` (radians → degrees). Use scaleX/scaleY as width/height in image *user*
   units (exportService.ts:407-408), not the raw component fallback.
2. Carry `rotation` on `FlowImage` (new optional field) and pass it to the docx
   `ImageRun.transformation.rotation` (degrees) at flowDocWriters.ts:252-256. docx supports image
   rotation.
3. Skew (shear, where the CTM isn't a pure rotation+scale) has no clean DOCX equivalent — detect it
   (off-diagonal mismatch after removing rotation) and fall back to the bounding-box size with a
   note; true skew is Ceiling-adjacent.

**Effort:** S-M (~1 day for rotation; skew is rare and can stay approximate). **Feasibility:** good
for pure rotation (common in scanned/landscape inserts); skew is genuinely rare and hard.
**Test approach:** unit test the CTM decomposition (`[0,s,-s,0,...]` → 90°, correct w/h); browser
test exporting a rotated-image PDF and asserting `<a:off>`/`rot` in the drawing XML.

---

## Ceiling (confirmed genuinely hard — do not attempt now)

- **Lattice tables (vector ruling detection):** requires path-op grid reconstruction + text-to-cell
  bucketing; detection (not emission) is the hard part; chronic edge cases. Confirmed deferred.
- **Borderless / stream tables:** column-gap clustering with no rulings to anchor → chronic false
  positives for every converter. Out of scope.
- **Vector graphics → DrawingML:** logos/charts/dividers via `constructPath`/`fill`/`stroke` have no
  client-side path→OOXML translation; realistic answer is region rasterization (multi-day), not true
  vector. Confirmed hard.
- **Recursive 3-col XY-cut:** `detectColumnSplit` (flowDoc.ts:206) does ONE cut → 2 columns only; a
  true recursive alternating H/V cut is multi-day and still degrades on magazine layouts.
- **Tagged-PDF `getStructTree` fast path:** exact reading-order/heading recovery when present, but
  only ~15% of PDFs are tagged; building the parallel tagged path is a separate multi-day effort.
- **Headers / footers routing:** detecting repeated top/bottom band text across pages → docx
  header/footer is feasible but multi-day and noisy; currently they land inline.
- **RTL logical reorder + Arabic presentation-form normalization:** flags are set (flowDoc.ts:403,488)
  but pdf.js may deliver visual order; correct bidi reorder + presentation→base form mapping is
  fundamentally hard. Confirmed.
- **Exact subset-font face matching:** subset fonts ('ABCDEF+...') have no recoverable file/full
  family; the allow-list + generic fallback is the honest ceiling. Confirmed.
