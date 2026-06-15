# Arabic / RTL — Blocker Enumeration vs 100% Support

Date: 2026-06-15. READ-ONLY research. Extends `research-2026-06-15-arabic/{01,02,03}-*.md`
(those predate the Sprint-Arabic fixes and described the gaps as *unfixed*; most are now
implemented). This file enumerates the **remaining** blockers against "100% Arabic support",
classifies REACHABLE vs CEILING, gives file:line + a confirming-test design.

## Baseline — what is now DONE (do NOT re-report as a gap)

- DOCX logical-order restoration: `reverseRtlText` (flowDoc.ts:442) + `orderLineWords`
  (flowDoc.ts:453) + per-line RTL gap-direction (flowDoc.ts:570-574). Verified by
  `tests/utils/flowDocArabic.test.ts`.
- DOCX complex-script attrs: `cs:'Arial'`, `boldComplexScript`/`italicsComplexScript`/
  `sizeComplexScript`, `rightToLeft`, `bidirectional` (flowDocWriters.ts:230-235,280).
- True-edit Arabic refusal → overlay: `isArabicText(newText)` returns false WITHOUT blanking
  (contentStreamEditor.ts:1271-1273). Path-2 subset reuse still runs first.
- Overlay rendering: `drawArabicLine` shapes (fontkit GSUB) + `reverseCidHex` + raw Tj against
  embedded Noto Naskh (arabicOverlay.ts), wired at pdfElementRenderer.ts:113-120, right-aligned.

## Blocker table

| ID | One-line | CLASS | file:line | Root cause | Test env | Confirming-test design |
|----|----------|-------|-----------|------------|----------|------------------------|
| AR-1 | Overlay: mixed LTR+RTL on one line is whole-line CID-reversed → Latin/digit substrings come out mirrored | CEILING (documented) | arabicOverlay.ts:67-71 (`reverseCidHex` reverses ALL pairs), :97-98 (no per-segment bidi); branch pdfElementRenderer.ts:113 treats the whole `line` as one RTL run | `reverseCidHex` reverses every 2-byte CID group unconditionally; no UAX#9 segmentation. `bidi-js` is installed (03-shaping-deps.md) but NOT imported here | jsdom (pure helper) | `reverseCidHex('00410042'+'00050006')` (Latin "AB" CIDs + 2 Arabic CIDs) returns fully-reversed `0006000500420041` — assert this == today's output; expected-correct would keep the Latin pair internally forward. Marker that whole-line reversal is wrong for mixed content. `it.fails()` only if a corrected impl exists; today document as evidence-only since visual correctness is browser-only. |
| AR-2 | Overlay: no line-wrapping — text wider than the box overflows / clips, only `\n` splits | REACHABLE | pdfElementRenderer.ts:106 (`te.text.split('\n')`), arabicOverlay.ts:101-103 (right-align only, no maxWidth) | Per-line draw with no measure-and-break loop; 03-shaping-deps.md §5 flags this as the "main footgun" (drawText maxWidth would break a reordered run) | browser (font fetch + width measure) for true raster; pure-helper if a `wrapArabicLogical(text,width,font)` is extracted | Evidence-only / browser: render a single long Arabic string with no `\n` into a narrow box; assert overflow beyond `right`. Reachable fix = logical-order line-break BEFORE reorder; a future pure `wrapArabicLogical` would be jsdom-testable. |
| AR-3 | Overlay: rotated Arabic text elements are drawn upright (rotation dropped) | REACHABLE | pdfElementRenderer.ts:117-120 passes no rotation; arabicOverlay.ts:111 `setTextMatrix(1,0,0,1,…)` hardcodes identity; the Latin branch DOES apply `pdfRotVal` (pdfElementRenderer.ts:122) | `drawArabicLine` has no rotation param; doc-comment admits "rotated Arabic elements are drawn upright" (arabicOverlay.ts:20) | browser (raster) | Evidence-only/browser: place a `dir`-Arabic TextElement with rotation=90; export; assert glyph baseline is horizontal not vertical. Reachable: thread `pdfRotVal` into `setTextMatrix` cos/sin. |
| AR-4 | Overlay: tashkeel / harakat diacritic GPOS mark positioning is fontkit-weak (mis-stacked marks) | CEILING | arabicOverlay.ts (fontkit `encodeText`/`layout` path); root in `@pdf-lib/fontkit@1.1.1` GPOS, 03-shaping-deps.md §1a/§5 | fontkit's mark positioning < harfbuzz; only harfbuzzjs fixes it (1MB wasm, rejected for v1) | browser (raster, visual) | Evidence-only: render `بَيْت` (with fatha/sukun); compare mark vertical offset vs reference — visual-only, not assertable in jsdom. Confirm ceiling holds: no GPOS-tuning code exists. |
| AR-5 | Overlay: glyph-coverage gap — chars absent from Noto Naskh subset (e.g. Persian/Urdu پ چ ژ گ ک, Quranic marks) silently drop or tofu | REACHABLE (detect/warn) | arabicOverlay.ts:97 `font.encodeText` (no missing-glyph check); :56 `embedFont(...,{subset:true})` | No notdef/coverage check; Noto Naskh Arabic lacks extended Persian/Urdu letters | browser (font loaded) | Evidence-only/browser: `getArabicFont` then `encodeText('پچ')`; assert it maps to .notdef CID (0000) rather than real glyphs. Reachable: detect notdef and warn / fall back. |
| AR-6 | DOCX: Arabic-Indic vs Western digit handling absent — digits passed through as-is, no `w:bidi` numeral context | REACHABLE | flowDoc.ts (no numeral normalization); flowDocWriters.ts:230-235 (no numeral-form attr) | No mapping ٠١٢ ↔ 012 and no Word numeral-context hint; digits in an RTL run keep source codepoints, direction left to Word default | jsdom (pure helper on reconstructPage output) | jsdom: feed an rtlItem mixing Arabic digits `"٢٠٢٤"` and a Latin run; assert today the run text preserves source digits with no normalization metadata (documents the no-op). Reachable = optional normalize + numeral-form note; many users WANT pass-through, so this is low-ROI. |
| AR-7 | DOCX: kashida / justification stretching not emitted (justify falls back to space distribution) | CEILING | flowDoc.ts:629-632 (`isJustified` detected) → flowDocWriters.ts (emits `AlignmentType.JUSTIFIED`, no kashida) | Word kashida justification needs `w:kinsoku`/manual tatweel; not modelled. 03-shaping §5 lists kashida as ❌ | jsdom (XML) | jsdom: build a justified RTL paragraph, `flowDocToDocxBase64`, unzip, assert `<w:jc w:val="both"/>` present but NO kashida/tatweel artifact — documents the ceiling. |
| AR-8 | DOCX: list markers are LTR-only — bullet/ordinal prefix prepended on the left of an RTL paragraph | REACHABLE | flowDocWriters.ts list-marker emission (numbering applies in document order); flowDoc.ts `detectListPrefix` strips Latin/decimal markers but no RTL-side numbering | numbering definition not flagged RTL; marker sits left even for `bidirectional` paras | jsdom (XML) | jsdom: RTL paragraph with `type:'ordered'`; export+unzip; assert the `w:numPr`/numbering def lacks an RTL/`w:bidi` flag on the list level (marker renders left). Reachable: set RTL on the numbering level. |
| AR-9 | DOCX: presentation-form (U+FE70–FEFF / U+FB50–FDFF) source text not de-shaped to base letters | CEILING (mapping) / REACHABLE (table) | flowDoc.ts:429 `_ARABIC_RE` MATCHES presentation forms (so isArabicText=true) but no normalization maps them back; verbatim into runs | When a PDF embeds presentation forms, Word can't re-shape them → wrong joining; needs a PF→base mapping table | jsdom (pure helper) | jsdom: `reverseRtlText`/reconstruct on an rtlItem of presentation-form codepoints (e.g. `'ﻻﺎ'`); assert output still contains U+FExx (no decomposition) — documents the gap. Reachable-bounded: add a deterministic PF→base+deshape map (01-gaps GAP3, Moderate). |
| AR-10 | DOCX: garbage/missing ToUnicode in subset CID Arabic fonts → PUA / junk extraction, no detect-and-warn | CEILING (recover) / REACHABLE (detect) | flowDoc.ts:768+ (`reconstructPage` trusts `it.str`); extraction exportService.ts:~349 | If ToUnicode absent, pdf.js yields PUA (U+E000–F8FF); no confidence check exists | jsdom (pure helper) | jsdom: rtlItem with PUA codepoints `''`; assert reconstructPage emits them verbatim (no warning flag on the page/run). Reachable: detect high-PUA fraction → mark page unreliable. Recovery is impossible client-side (ceiling). |
| AR-11 | True-edit: `isArabicText` refusal is correct for new-text, BUT it also blocks ASCII-only edits of an Arabic line ONLY if newText has Arabic — confirm no false-ACCEPT of Arabic via Path-1/Path-2 | REACHABLE (verify; likely already safe) | contentStreamEditor.ts:1271 (Path-3 refusal); Path-1 gated by `isAsciiSafe` (fails on Arabic), Path-2 by `encodeWithSubset` returning null for missing glyphs | Path-1 cannot accept Arabic (codepoints>126). Path-2 CAN accept Arabic IF every new glyph is already in the subset (faithful in-subset edit) — that is intentional, not a false-accept | jsdom (pure helper) | jsdom: assert `isArabicText('abc')===false` and `isArabicText('اب')===true` (already covered). Add: confirm Path-1 `isAsciiSafe('اب')===false`. The genuine risk to test: a same-form Arabic char swap that Path-2 ACCEPTS but produces wrong joining when neighbour context changes — design a contentStreamEditor test feeding a subset reverseMap that contains the new glyph; assert Path-2 returns a write (accept) even though joining context shifted → documents the in-subset ceiling (Gap-4 of 02). |
| AR-12 | True-edit: mixed LTR+RTL new-text (e.g. `"PDF ملف"`) is refused wholesale by `isArabicText` → entire edit goes to overlay even though the Latin part could edit in place | REACHABLE (acceptable) | contentStreamEditor.ts:1271 (`isArabicText` true if ANY Arabic char) | Coarse all-or-nothing gate; conservative but correct (avoids `?`-substitution). Splitting is not worth it | jsdom | jsdom: `isArabicText('PDF ملف')===true` (already asserted flowDocArabic.test.ts:71) → documents the wholesale-refuse behavior is by design. Evidence-only. |
| AR-13 | Overlay: vertical alignment / multi-line baseline uses Latin `lineHeight = fontSize*1.2` for Arabic too — Arabic ascenders/marks may clip at top of box | REACHABLE | pdfElementRenderer.ts:105,110 (`lineHeight`, `baseY`) shared with Arabic branch | No Arabic-specific line metrics (Naskh needs more leading for marks) | browser (raster) | Evidence-only/browser: two-line Arabic with tashkeel in a tight box; assert top-line marks clip. Reachable: Arabic-aware leading factor. |

## Confirmed ceilings (the brief's four) — do they hold at file:line?

1. **Mixed LTR+RTL single-line reorder** — HOLDS. `reverseCidHex` (arabicOverlay.ts:67-71) reverses
   every CID pair unconditionally; no `bidi-js` import in arabicOverlay.ts. DOCX side: `orderLineWords`
   (flowDoc.ts:453-463) decides ONE direction by majority and reverses only rtl words — a stray Latin
   token in an rtl line keeps LTR text but is placed by x, not bidi-resolved. Both are single-run
   approximations → AR-1. (CEILING for full UAX#9; bidi-js makes the DOCX side REACHABLE-ish.)
2. **Tashkeel/diacritic GPOS** — HOLDS. fontkit@1.1.1 path only; no GPOS tuning; doc-comment admits it
   (arabicOverlay.ts:20). → AR-4. Genuine ceiling without harfbuzz.
3. **True-edit in-place Arabic on subset CID fonts** — HOLDS. Path-2 `encodeWithSubset` returns null
   when any new glyph/joining-form is missing; Path-3 refuses Arabic (contentStreamEditor.ts:1271). The
   only in-place success is a strictly in-subset same-form edit (AR-11) — structural ceiling.
4. **Presentation-form → base mapping** — HOLDS (no mapping exists). `_ARABIC_RE` matches PF ranges but
   nothing decomposes them (flowDoc.ts:429). → AR-9. The mapping table itself is REACHABLE-bounded.

## Highest-ROI reachable

1. **AR-1 / mixed-line bidi via the already-installed `bidi-js`** (DOCX side first, jsdom-testable):
   route `orderLineWords` and a new per-line overlay reorder through `bidi.getEmbeddingLevels` +
   `getReorderSegments` instead of the majority-vote/whole-reverse heuristic. Biggest correctness win,
   zero new dependency, partially unit-testable in jsdom (the DOCX reorder helper). Overlay raster stays
   browser-verified.
2. **AR-2 / overlay logical-order line-wrapping** (`wrapArabicLogical(text,maxWidth,font)` extracted as a
   pure-ish helper): removes silent overflow/clip — the single most visible "broken" symptom for any
   Arabic text longer than its box. Break in logical order, then reorder per line (03-shaping §5).
3. **AR-3 / thread rotation into `drawArabicLine`**: small, localized (mirror the Latin branch's
   `pdfRotVal` into `setTextMatrix`), removes an obvious asymmetry where Latin overlays rotate and Arabic
   don't.
4. **AR-5 + AR-10 / detect-and-warn** (notdef coverage + PUA-fraction): cheap guards that convert silent
   garbage into an honest "can't render/extract this" — turns two ceilings into graceful degradation.
