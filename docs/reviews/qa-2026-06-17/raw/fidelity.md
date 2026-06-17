# Fidelity DONE-claim Verification — 2026-06-17

Read-only re-verification of every "DONE" fidelity claim in the two scorecards
(`scorecard-docx.md`, `scorecard-trueedit.md`), the gap docs (`01-docx-gaps.md`,
`02-trueedit-matrix.md`), and the DOCX/Arabic/true-edit/positioning sections of `CLAUDE.md`.
Each row located in current source and judged genuinely-DONE / PARTIAL / OVERCLAIMED. No source
edited, no tests run, no private-fixture data transcribed. All line numbers verified by direct read
this session [Verified].

> Headline: every DONE claim that was checked has real implementing code behind it. Two scorecard
> rows are now BETTER than their stale 🟡 label (heading bold/caps promotion + non-WinAnsi refusal
> are shipped). One scorecard 🟡 (DOCX spot/scn color) is correctly still-open. The genuine PARTIAL
> /CEILING items (Arabic char-level bidi, Path-3 face/cm, positioning keyed-identity) are honestly
> labelled in code comments.

## True-edit engine

| Feature | Claim | Code evidence (file:line) | Verdict | Next lever |
|---|---|---|---|---|
| Path-1 byte-swap (std-14 ASCII) | ✅ perfect | `contentStreamEditor.ts:1399` gated by `byteSwapUnsafe`; `:577` replaceShowOpInPlace | DONE | — (ceiling reached for std fonts) |
| Path-2 subset/CID glyph reuse via ToUnicode | ✅ perfect, keeps real font | `contentStreamEditor.ts:1406-1418` encodeWithSubset + replaceShowOpHex | DONE | — |
| Gap 1 — TJ kerning preservation (distribute) | ✅ DONE Sprint3-b2 | `contentStreamEditor.ts:585-602` (Path-1 per-segment split via `decodeLiteralString`), `:1116-1121` (Path-2 hex split) | DONE | — |
| Gap 2 — Path-3 fill color (scn/Separation) | ✅ DONE `d7879fb` | `resolveRedrawColor` `contentStreamEditor.ts:475-483`; used `:1458`; handler passes sampled glyph color `textEditHandler.ts:645-646` | DONE | stroke-color (`Tr 1/2`) still untracked — narrow open item |
| Gap 3 — number tokenizer exponent `1e-3` | ✅ DONE | `consumeNumberBody` `contentStreamEditor.ts:87-98` (well-formed `e`/`E[+-]?d+` kept as one token; lone `e` left to operator scanner) | DONE | — |
| A-5 refuse: Type3 / invisible-Tr(3/7) / vertical | ✅ correct fallback | `contentStreamEditor.ts:1381-1387` OR-guard → return false → overlay | DONE | — |
| A-1 XObject refuse (no silent no-op) | ✅ | `contentStreamEditor.ts:1427-1434` refuse-without-blank; handler `_emitOverlay` `textEditHandler.ts:421,652` | DONE | — |
| Non-WinAnsi ligature `ﬁ` / CJK / Cyrillic Path-3 | scorecard SC-T = 🟡 "wrong glyph, NO refusal" | **now refuses**: `isArabicText` `:1442`, `hasNonWinAnsi` `:1449` → return false → overlay; `_emitOverlay` surfaces `toast.trueEditOverlay` | **OVERCLAIMED (stale, in user's favor)** — code is BETTER than scorecard: the 🟡 "no-refusal" gap is closed (B-3 + Arabic refusal). Scorecard/SC-T row 32 + baseline §1 "SC-T ligature" should be retired | — (refusal is the correct outcome; no further lever) |
| Path-3 std-font accented/€ redraw | 🟡 glyph OK, face degraded | `:1453-1480` blank + redraw via `matchStandardFont` + `font.encodeText` | PARTIAL (honestly labelled) | exact subset face = structural ceiling (no embedded file) |
| A6 cm scale/rotation in Path-3 redraw | ⛔ ceiling — identity Tm | `:1476` `1 0 0 1 x y Tm` hardcoded | CEILING (accurate) | REACHABLE-low-ROI: decompose CTM → emit matching Tm scale/rot (DOCX side already has `decomposeImageCtm`) |
| In-place Arabic / RTL Path-3 | ⛔ refuse→overlay | `:1442` isArabicText → false | CEILING (structural) | overlay IS the answer; subset CID lacks new glyphs |

## DOCX export

| Feature | Claim | Code evidence (file:line) | Verdict | Next lever |
|---|---|---|---|---|
| Font family allow-list (28 entries) + generic fallback | ✅ (B-1) | `flowDocWriters.ts:26` WORD_FONT_ALLOWLIST, `:72-81` resolveWordFont, applied `:350` | DONE | exact subset face = ceiling |
| Page margins Q1/Q3 | ✅ (B-2) | `flowDoc.ts:1111` computeMargins, used `:1082` | DONE | — |
| Para/line spacing | ✅ (B-3) | `flowDocWriters.ts:121` buildSpacing, used `:395` | DONE | — |
| Alignment L/C/R + justify | ✅ (B-5) | `flowDoc.ts:703-712` isJustified→alignment | DONE | — |
| Lists: bullet/decimal/lettered/roman + nesting + continuation merge | ✅ Sprint3/4 | `flowDoc.ts:431` detectListPrefix, per-format refs in `flowDocWriters.ts` | DONE | — |
| Headings H1–H6 size cluster | ✅ | `flowDoc.ts:1142-1165` assignHeadings, `slice(0,6)` `:1156` | DONE | — |
| Heading bold/ALL-CAPS promotion | scorecard r16 = 🟡 "still reachable/open" | **shipped** as G11 conservative pass `flowDoc.ts:1167-1201` (bold-OR-allcaps, ≤8 words, ≥3 letters, not list/underline, promoted below size headings) | **OVERCLAIMED (stale, in user's favor)** — scorecard r16 + baseline §1 "SC-D r16" mark it open; it is DONE in code | — (Tagged-PDF StructTree is the exact-fix ceiling) |
| Color spot / Separation / scn | scorecard r18 = 🟡 open | op-walk handles ONLY `setFillRGBColor`/`setFillGray`/`setFillCMYKColor` `opStreamWalker.ts:124-131`; **no `setFillColorN`/scn case** | **PARTIAL — correctly still-open** (genuine). Mitigated: pdf.js v6 pre-resolves most colorspaces to setFillRGBColor (`opStreamWalker.ts:48` comment) so the black-collapse only bites pure-scn spot color | handle `setFillColorN`/`setFillColorSpace` in the op-walk + nearest-origin colorMap tolerance (Gap 6) |
| Images: embed + floating position + JPEG re-encode + rotated sizing | ✅ Sprint3-b2/Sprint4 | `flowDoc.ts:185` decomposeImageCtm, `:205` pickImageMime; writer floating `wp:anchor` | DONE (jsdom + browser guards) | skew = ceiling |
| Hyperlinks | ✅ Sprint3-b2 | `flowDoc.ts:100` FlowLinkRect, `flowDocWriters.ts:379-389` ExternalHyperlink wrap | DONE | — |
| Underline / strikethrough | ✅ Sprint4 | `flowDoc.ts:77` classifyRuleAsUnderline, used `:1036`; rules from op-walk `opStreamWalker.ts:118` | DONE | — |
| Super/subscript | ✅ Sprint4 | writer superScript/subScript (per CLAUDE.md flowDoc.ts:549-554 region) | DONE | — |
| Redaction-aware extraction (incl. rotated) | ✅ | redaction filter + `redactionRectToContent` `geometry.ts:43` (shared rotated-page helper) | DONE | — |
| Per-page sections | ✅ | `flowDocWriters.ts` doc.pages → one section each | DONE | — |
| Multi-language (Cyrillic/CJK) verbatim | DONE (#2) | LTR path = reconstructPage; `isArabicText` RTL branch must not fire | DONE-content | CJK `w:eastAsia` font-FACE = ceiling (no universal name) |

## Arabic (three surfaces)

| Feature | Claim | Code evidence (file:line) | Verdict | Next lever |
|---|---|---|---|---|
| DOCX export — logical restore + word-level reorder + cs attrs | DONE-partial | `reverseRtlText` (reverse + NFKC) `flowDoc.ts:480-482`; `orderLineWords` UAX#9 L2 word-level with LTR-run-forward `:499-519`; complex-script attrs `flowDocWriters.ts:361-366` (cs/bCs/iCs/szCs/rtl) | **PARTIAL (honest)**. Current fidelity: word-level bidi correct, presentation-forms NFKC-folded, complex-script attrs emitted. **Char-level mixed-script single-line reorder = NOT done** (documented partial, comment `:496-497`) | char-level UAX#9 via `bidi-js` (installed, unused) + harfbuzz GPOS for tashkeel — REACHABLE-low-ROI |
| Overlay render (PDF) | DONE | `arabicOverlay.ts:51` vendored Noto Naskh **TTF** (171.7 KB, confirmed on disk, not woff), `getArabicFont` `:83`; `encodeText`→visual CIDs emitted straight (NO reverse) `:191-202` | **DONE**. Honest fidelity: single RTL run shapes + renders correctly (GSUB), right-aligned | mixed LTR+RTL single line reorder = documented ceiling |
| Searchable-OCR Arabic layer | PARTIAL (documented) | `searchableTextLayer.ts` per CLAUDE.md; Arabic recovers as real Unicode (selectable/SR) but exact word-search imperfect (fontkit GSUB → contextual glyphs + incomplete ToUnicode) | PARTIAL (honest — do NOT treat as fully working) | clean per-codepoint ToUnicode PoC was tried + rejected (traded for RTL reversal) — genuine ceiling |
| In-place Arabic true-edit | CEILING | refused `contentStreamEditor.ts:1442` | CEILING (structural) | overlay path (above) is the shipped answer |
| Text-layer selection/copy/search (RTL) | DONE-partial (#6/#6b/#6c) | per CLAUDE.md: `rtlClipboard.ts` reconstructLogicalText, NFKC search fallback, `alignSpanOrderToVisual` | DONE-partial (honest) | sub-char highlight item-level; mixed-line bidi = ceiling |

## Element positioning / overlay rendering

| Feature | Claim | Code evidence (file:line) | Verdict | Next lever |
|---|---|---|---|---|
| Per-element-type render dispatch (compile-time complete) | DONE #23 | `pdfElementRenderer.ts:298` `RENDERERS: Record<ElementType, ElementRenderer>` (8 types `:299-306`) — exhaustiveness enforced by the typed Record | DONE | — |
| Shared content-space rect mapping (Y-flip, rotation-aware) | DONE | `geometry.ts:43` redactionRectToContent, `:66/72` contentRectToDisplay, `:100` contentCropToPdfCropBox; export draws overlays in source-box space then `setCropBox` last `exportPipeline.ts:186,221` | DONE — positioning math is single-sourced + tested; redaction/crop/thumbnail/export all inherit it | — |
| Per-page crop (#G23) — effBox==cropBox byte-identical | DONE | `exportPipeline.ts:186` (`docPage.crop ? contentCropToPdfCropBox(...) : cropBox`), `:221` setCropBox | DONE | resizable handles / numeric margins = v1b |
| `renderElements()` keyed identity (#50) | NOT done (ceiling-by-design today) | `elementLayerRenderer.ts:45` `querySelectorAll('.pdf-element').forEach(el => el.remove())` then rebuild-all `:53-84` | NOT-DONE (accurately reported) — destroy/recreate-all every call | keyed element-layer diff (stable node id); MUST preserve focus-restoration hacks that DEPEND on destroy/recreate (CLAUDE.md gotcha) |

## Honest fidelity statement per the three focus areas

- **Arabic export** — current honest fidelity: WORD-LEVEL bidi (UAX#9 L2) + NFKC presentation-form
  folding + complex-script DOCX attrs are real and tested; the overlay renders a single shaped RTL
  run correctly via a vendored TTF. The remaining gap is genuinely CHAR-LEVEL: a single line mixing
  LTR+RTL tokens, or digits nested in RTL, is not reordered at character granularity. **Next reachable
  lever:** wire the already-installed `bidi-js` at character granularity (it is currently unused) +
  harfbuzzjs for tashkeel GPOS marks — REACHABLE but large/fragile, low ROI.
- **True-edit** — current honest fidelity: Path-1/2 (the common Latin + subset/CID case) are perfect
  incl. TJ kerning and spot-color; everything structurally un-editable refuses → overlay (never silent
  garbage), and the SC-T "no-refusal ligature" gap is in fact closed. The honest remaining degradation
  is Path-3 face substitution and the A6 cm-rotation identity-Tm. **Next reachable lever:** A6 CTM
  decomposition into a matching Tm scale/rotation (the DOCX path already does `decomposeImageCtm`) —
  rare, low-ROI; overlay already covers it.
- **Element positioning** — current honest fidelity: positioning math is single-sourced (one tested
  rotation/Y-flip/crop helper set in `geometry.ts`, inherited by redaction, crop, thumbnail, export)
  and the renderer dispatch is compile-time exhaustive — positioning is genuinely solid. The one open
  structural item is performance, not correctness: `rebuildElementLayer` destroys+recreates every DOM
  node each call. **Next reachable lever:** a keyed element-layer diff (#50) for stable node identity,
  but it must preserve the focus-restoration behavior that currently depends on the destroy/recreate
  cycle.

## Scorecard staleness flags (for the sweep synthesis)
- `scorecard-docx.md` row 16 (heading bold/caps) and `scorecard-trueedit.md` row 32 / `02-trueedit-matrix.md`
  "WRONG/degraded #1" (non-WinAnsi ligature no-refusal) are **stale** — both are shipped/closed in current
  code. Baseline §1 open-backlog rows "SC-D r16" and "SC-T ligature" should be retired.
- `scorecard-docx.md` row 18 (spot/scn DOCX color) is **correctly still-open** — verified no scn handler
  in `opStreamWalker.ts`.
