# Max-Fidelity Program — True-edit + PDF→DOCX (+ DOCX editor) (program design)

Date: 2026-06-25. Status: **decomposition + sequencing locked; per-sub-project specs to follow.**

## Goal

Push three subsystems toward their **maximum reachable fidelity/coverage without regressions**:
1. **True in-place PDF text editing** (`src/utils/contentStreamEditor.ts`, `src/handlers/textEditHandler.ts`)
2. **PDF→DOCX export** (`src/utils/flowDoc.ts`, `src/utils/flowDocWriters.ts`, `src/export/exportService.ts`)
3. **DOCX editor** (`src/docx/*`) — pulled in by the "do we support images in docx edit?" question

This is a **program**, not one feature: ~15 improvements grouped into 3 sub-projects, each shipped via its
own spec → plan → build → full-gate cycle so every change lands tested and independently reversible.

## Non-negotiable constraints (apply to EVERY item)

- **No regressions.** Default to *gated-additive*: a new capability must produce **byte-identical output
  when it does not apply** (feature flag OFF, attribute absent, or the structural precondition unmet). Where
  byte-identity is impossible, the change must be guarded by a real-Chrome pixel/XML test proving the old
  path is untouched.
- **100% client-side, nothing uploaded.** No network calls (rules out TSA timestamps, CA validation, remote
  AI). GRDF data policy holds — only C1/C2 data; this is code/feature work, which is permitted.
- **TDD + full deploy gate.** Each sub-project: failing test first, then implement. Before push run the full
  gate (`npm audit` → `ocr:assets` → type-check → lint → test jsdom → **test:browser real Chrome** →
  `test:coverage:export` → build). Visual/canvas/content-stream changes REQUIRE a `tests/browser/*` guard —
  jsdom cannot exercise them.
- **Honest ceilings.** Items below the line stay documented as walls; we never ship a path that paints
  garbage. The existing refuse→overlay (true-edit) / generic-fallback (DOCX) degradation is the contract.

## Hard walls — explicitly OUT of scope (do not promise)

| Wall | Why structural |
|---|---|
| In-place Arabic/RTL true-edit | subset CID fonts physically lack the new glyphs; the **overlay already IS the right answer** (re-embedding Noto Naskh in-stream = same pixels as overlay + more risk) |
| Type3 font true-edit | glyphs are CharProc streams, not byte→glyph; refuse→overlay is correct |
| Vector graphics → OOXML | no client-side path→DrawingML; only region-raster (multi-day, low ROI) |
| Exact subset-font face recovery | `ABCDEF+` subset tag carries no recoverable family — allow-list + generic is the honest ceiling |
| Borderless / stream tables | column-gap clustering with no rulings → chronic FP for every converter |
| Multi-line true-edit reflow | length-changing edit that needs rewrap across lines |
| Text-clip render modes 4–6 side-effect | appended Path-3 redraw is past all page content; clip can't apply |
| TSA timestamp / LTV / CA trust | requires network — breaks the client-side guarantee |

---

## Sub-project A — True-edit engine (`contentStreamEditor.ts`)

| ID | Item | Approach (gated-additive) | Risk | Evidence |
|---|---|---|---|---|
| **A1** | TE-1 Path-3 transform capture (cm/Tm scale + rotation) | Path-3 redraw currently emits identity `1 0 0 1 x y Tm`. Capture the matched op's effective text→user matrix (already tracked for location) and emit the real scale/rotation in the redraw Tm. **Gate:** only when a non-identity transform is detected → byte-identical otherwise. Scale-only first (common), rotation second. | Med | [Verified: matrix A6 — redraw hardcodes identity Tm] |
| **A2** | TE-2 Path-3 alpha (`ca`/`CA`) | `locateTextOps` does not capture ExtGState alpha → semi-transparent (watermark/faded) text redraws opaque. Capture alpha, re-emit a `gs` in the Path-3 `q…Q` block. **Gate:** only when alpha<1. | Low | [Verified: CLAUDE.md Path-3 ceiling #3] |
| **A3** | TE-6 **XObject true-edit** (coverage expansion) | Today Form-XObject text refuses→overlay (`:1173-1180`). The **F3 byte-splice + F12 multi-stream write** (2026-06-24) now let the builder write a single XObject stream. Locate the op inside the XObject (findTarget recurses one level) and splice that stream instead of refusing. **SPIKE-GATED** (see below). | Med-High | [Inferred: follows from F12 single-stream splice capability — needs spike] |
| **A4** | TE-7 Path-3 bold/italic-aware substitute face | Path-3 redraws everything in regular base-14. Read the font descriptor `/Flags` (or name sniff) for bold/italic and pick Helvetica-Bold/Oblique/Times-Bold etc. **Gate:** changes only the substitute face on the already-substituting Path-3 — Path-1/2 untouched. | Low-Med | [Verified: matrix "degraded (std face)", no weight match] |
| **A5** | TE-4 non-WinAnsi ligature → refuse→overlay | The one remaining 🟡: `ﬁ`/non-WinAnsi on Path-3 silently substitutes a wrong glyph. Make it refuse→overlay (consistency with A-5 refusals). Pure safety. | Very low | [Verified: matrix "WRONG glyph", no refusal] |
| **A6** | Polish: TE-3 rotated-page inline-input placement · TE-5 stroke dash/cap/join on Path-3 · TE-8 Path-3 size-change width | TE-3 = UX (edit already correct, box misplaced). TE-5/TE-8 = narrow Path-3 fidelity. | Low | [Verified: matrix rotated-input + ceilings #4] |

## Sub-project B — PDF→DOCX export (`flowDoc.ts` / `flowDocWriters.ts`)

| ID | Item | Approach (gated-additive) | Risk | Evidence |
|---|---|---|---|---|
| **B1** | DX-1 **Tagged-PDF `getStructTree` fast path** | When the PDF carries a structure tree (~15% — accessible PDFs), use it for exact reading order / headings / lists / tables. **Gate on presence** → falls back to today's heuristics when absent = byte-identical for untagged PDFs. | Very low | [Inferred: pdf.js `getStructTree`; additive gated path] |
| **B2** | DX-2 **Lattice tables → `w:tbl`** | Reuse the tested `src/utils/tableExtract.ts` (`clusterPositions`/`buildTableGrid`) that already detects h/v rules for the CSV feature → emit a real Word table. **Gate:** clearly-ruled tables only (both axes) → no FP on prose. | Med | [Verified: tableExtract exists + tested; ceiling-challenge #8 BREAKABLE-CUSTOM] |
| **B3** | DX-6 Outline → TOC / heading reinforcement | `getOutline()` tree → reinforce `assignHeadings` and/or emit a Word `TableOfContents`. **Gate on outline presence.** | Low | [Inferred: pdf.js `getOutline`, docx TOC support] |
| **B4** | DX-3 Bold/all-caps heading promotion | Last scorecard 🟡 (row 16): promote a bold+caps short line to a heading even without a size jump. Conservative (require BOTH signals + body-size-coverage sanity cap). | Med | [Verified: `01-docx-gaps.md` Gap 5] |
| **B5** | DX-5 Headers/footers routing | Repeated top/bottom band across pages → `w:headerReference`/`w:footerReference`. Noisy; conservative repeated-text detection. | Med | [Inferred: gap-doc ceiling note] |
| **B6** | DX-4 Recursive 3-column XY-cut | Extend `detectColumnSplit` to recurse one more H/V cut. Niche. | Med | [Verified: gap-doc — one cut today] |
| **B7** | DX-8 Latin ligature NFKC normalization | NFKC-fold `ﬁ`→`fi` etc. in extracted Latin text (already done for Arabic) → cleaner DOCX + searchability. Small. | Low | [Inferred: extraction normalization, additive] |

## Sub-project C — DOCX editor (`src/docx/*`)

Verified state [Verified: `docModel.ts` no image field; `docxProseMirror.ts:258-260,350`]: images are
**preserved** through the in-place save and **rendered** in DOCX→PDF export, but are **not visible or
editable** in the ProseMirror view (extracted read-only, kept out of the editable model because the in-place
text-run save would corrupt `w:drawing`).

| ID | Item | Approach | Risk | Evidence |
|---|---|---|---|---|
| **C1** | DXE-1 Display images read-only in the editor view | Render `getImages()` as non-editable view nodes/decorations at their block positions — **without** routing them through the save (save path untouched → no `w:drawing` corruption). Removes "editing blind around invisible images." | Low-Med | [Verified: images currently view-absent] |
| **C2** | DXE-2 Image insert / move / resize / delete | Full editing — needs the model + in-place save to represent and rewrite `w:drawing`. The cardinal-rule risk the team deliberately avoided. **Highest care; own spec; may stay partial.** | High | [Verified: comment `docxProseMirror.ts:258`] |
| **C3** | DXE-3 Link URL survives the DOCX-editor save | Today a link survives the editor but not the OPC save (`DocRun` has no `linkUrl`). Add `linkUrl` to the model + `buildRun` hyperlink emission. | Low-Med | [Inferred: CLAUDE.md Slice-C #1 ceiling note] |

---

## Feasibility spikes (run BEFORE committing the two riskiest items)

Cheap, time-boxed, throwaway — validate the hardest assumptions before any sub-project spec depends on them.

- **Spike-1 (TE-6 / A3) — XObject true-edit.** Build a PDF with editable text inside a Form XObject; confirm
  `findTarget` locates the op in the XObject and the byte-splice builder can rewrite **that stream only**,
  leaving the page stream + every other object byte-identical, and pdf.js re-renders + re-extracts the new
  text. **Exit:** spliced XObject round-trips correct AND no other bytes change → proceed; else keep
  refuse→overlay and drop A3. Time-box ~1–2h.
- **Spike-2 (TE-1 / A1) — Path-3 transform capture.** On a scaled and a rotated text op, capture the
  effective text matrix and emit it in a Path-3 redraw; confirm the redrawn glyph lands at the right
  size/angle and a plain (identity) op stays byte-identical. **Exit:** scale correct (rotation a stretch
  goal) AND identity path unchanged → proceed. Time-box ~1–2h.

Spike findings feed each sub-project's own spec; they do not themselves ship.

### Spike results (2026-06-25, by authoritative code read)

- **Spike-1 (TE-6) — POSITIVE, lower risk.** The XObject write-back infra already exists and ships:
  `writeBack` routes to `setFormXObjectContent` when `xObjectName` is set (`:1132-1135`); `deleteTextAt`/
  `changeSizeAt`/`changeColorAt`/`addDecorationAt` already use it on XObjects; `replaceTextAt` **Path-1 & Path-2
  already call the XObject-aware writeBack** (`:1955`, `:1970`). The only gate is conservative: the *handler*
  (`textEditHandler.ts:263`) treats `inXObject` as a miss → overlay, and `getEditableTextAt` (`:1331`) returns
  null (no prefill). Path-3-in-XObject explicitly refuses (`:1982-1988`). **→ TE-6 SPLITS:** **TE-6a** (Path-1/2
  XObject, LOW risk — relax the handler gate + add XObject prefill; engine complete) and **TE-6b** (Path-3
  XObject — defer to ride A1's transform machinery).
- **Spike-2 (TE-1) — POSITIVE, medium.** `locateTextOps` already computes `trm = textMatrix × ctm` (`:531`),
  `tilted`, `vScale`, `hScale`, and bakes `vScale` into `fontSize` (`:544`); `buildPath3Redraw` discards it,
  emitting identity `1 0 0 1 … Tm` (`:2103`). **Subtlety:** `fontSize` already includes `vScale`, so emitting a
  scaling Tm double-applies — must decompose `trm` into rotation+scale and use the BASE size. Gate non-identity
  → identity byte-identical.

**Reorder from findings:** A1 (transform) sequences **before** TE-6b; **TE-6a** moves early (low-risk coverage
win). Revised A order: A5 → A2 → A4 → **TE-6a** → A1 → **TE-6b** → A6.

## Recommended build order (safety × ROI; spikes de-risk first)

1. **Spike-1 + Spike-2** (validate A3, A1).
2. **Sub-project B** — B1 + B3 are gated zero-regression and high visible value; B2 reuses tested code.
   (Order within B: B1 → B2 → B3 → B4 → B7 → B5 → B6.)
3. **Sub-project A** — A5 (safety) → A2 → A4 → A1 (per spike) → A3 (per spike) → A6 polish.
4. **Sub-project C** — C1 (low risk) → C3 → C2 (most care; may be a later session).

*Order is engineering judgment [Speculative]; spike outcomes may reorder A1/A3.*

## How this program is executed

- Each sub-project gets its **own** `docs/superpowers/specs/2026-06-25-<subproject>-design.md` (detailed
  design) → `docs/plans/<subproject>.plan.md` (writing-plans) → TDD build → full gate → commit. User approves
  each sub-project spec before its build.
- This umbrella doc is the durable decomposition + order-of-record. The companion plan file
  `docs/plans/maxfidelity-program-2026-06-25.plan.md` carries the live Decisions Log.

## Success criteria

- Every shipped item is **byte-identical when inactive** (or guarded by a real-Chrome test proving the old
  path untouched).
- Each lands with jsdom + real-Chrome guards and passes the full deploy gate.
- The documented walls stay walls — no garbage-painting path is ever shipped.
