# Arabic Text-Layer Correctness Plan

**Goal:** Fix Arabic search (0 matches), correct mixed LTR-in-RTL copy, and improve
Arabic selection-highlight contiguity — all caused by pdf.js v6 emitting Arabic as
per-glyph, visual-order, presentation-form spans.

## Decisions Log
- [2026-06-21] FINDING: the locked "Arabic-RTL P1 overflow" task was ALREADY fixed (`eb7ac11`,
  clip-based skip-link) and guarded (`rtl-overflow.browser.test.ts` passes). Stale handoff.
- [2026-06-21] FINDING (Verified, live pdf.js v6 + generated fixture): Arabic text items are
  91% single-glyph, visual-order, presentation-form. Root cause shared by search/selection/copy.
- [2026-06-21] AGREED: fix ALL THREE — search + copy(mixed-bidi) + selection contiguity.
  Fully autonomous, TDD + screenshots. (User chose "All three".)
- [2026-06-21] DECISION: execute INLINE (not subagent-driven) — three slices are tightly
  coupled to the text-layer/flowDoc/search seam and depend on live-repro context I hold.
- [2026-06-21] KEY FINDING (Verified, real fixture): pdf.js v6 emits SINGLE glyphs in VISUAL
  position order but MULTI-char items in NATIVE (LOGICAL) char order (e.g. the trailing "لام"
  of "السلام" is one logical-order item). So the correct reconstruction orders items by reading
  position (RTL → x-descending) and folds each item NFKC-ONLY — NEVER reverses an item's
  internal chars (that scrambled "السلام"→"لسمال"). This OVERTURNS the original #6b assumption
  (visual-order single items); its synthetic test fixture was unrealistic and is corrected.
- [2026-06-21] DONE Slice A: Arabic search works (live: السلام 1/1, العربية 1/4, الحروف/عليكم/
  وبركاته/القائمة/الثالث 1/1, Latin unaffected, nonsense 0). Ceiling: "الله" ligature + mixed
  LTR-in-RTL runs (→ Slice B). Gate: tc0/lint0/jsdom 1886+2xfail/browser arabic-search 1/1.

## Root cause (Verified)
`page.getTextContent().items` for an Arabic PDF are mostly ONE glyph each, in VISUAL (L→R)
order, as Unicode PRESENTATION FORMS (U+FB50–FEFF), no spaces. Latin stays whole-word.
- **Search** (`textSearchHandler.search`) matches within ONE `item.str` → multi-glyph Arabic
  query never fits; the #6b normalized fallback is also per-item → useless across glyphs.
- **Selection** drags a DOM-order range that zig-zags in x → striped/over-selecting highlight.
- **Copy** (`reconstructLogicalText`) rebuilds logical text per line but reverses embedded LTR
  runs (`(RTL)` → `)LTR(`) — no UAX#9 char-level bidi.

## Formal Plan (TDD per slice; gate = type-check + lint + jsdom + browser)

### Slice A — Arabic SEARCH across per-glyph items  [START HERE]
- `src/handlers/textSearchHandler.ts`: add pure exported `buildLogicalLines(items)` →
  `[{ text, tokens:[{itemIndex,start,end}], rtl }]` (cluster by baseline y; per line sort by x;
  RTL vote; logical order = x-descending for RTL; per-item `reverseRtlText`; x-gap spaces;
  token offset map). In `search()`, when `isArabicText(normQuery)`: run a line pass that matches
  `normPattern` against each RTL line's `text`, maps match offsets → overlapping items → union
  bbox MatchResult. Gate the existing #6b per-item fallback to `!isArabicText(normQuery)` (no dup).
- Tests: `tests/handlers/textSearchHandler.test.ts` — per-glyph items forming "العربية" across
  7 items → ≥1 match (currently 0); substring "عربية" matches; unrelated "سلام" → 0; Latin
  unaffected. Browser: `tests/browser/arabic-search.browser.test.ts` against the real fixture.

### Slice B — COPY mixed LTR-in-RTL (UAX#9 via bidi-js)
- `src/utils/flowDoc.ts` (or new `src/utils/bidiOrder.ts`): replace the blanket RTL line reverse
  in `orderLineWords`/`reconstructLogicalText` path with a UAX#9 reorder using `bidi-js` so an
  embedded Latin/number run keeps forward order while the Arabic is logical.
- Tests: `(RTL)` round-trips as `(RTL)` not `)LTR(`; pure Arabic unchanged; LTR unchanged.

### Slice C — SELECTION highlight contiguity
- `src/utils/textLayer.ts` `alignSpanOrderToVisual`: investigate why a single-line drag yields
  57 rects / over-selection; improve DOM ordering so a drag highlights one contiguous run.
  Honest ceiling: per-glyph absolute spans cap perfection — target "no over-select across lines
  + far fewer rects", not pixel-perfect.
- Browser test: drag across one Arabic line → selection stays within that line, rect count ≈ line.

## Fixture
`tests/fixtures/corpus-public/arabic-allcases.pdf` (gen: `scripts/gen-arabic-fixture.mjs`) —
pure Arabic, mixed bidi, tashkeel, lists, RTL table, Latin control. 2 pages, per-glyph items.
