# Arabic-RTL deepening — Slice 1: char-level bidi engine (design)

**Date:** 2026-06-23
**Feature:** 3 of Option-3 backlog (Arabic-RTL deepening). This is **slice 1 of 3**:
(1) char-level bidi engine ← *this spec*; (2) RTL-aware toolbar controls; (3) ligature/tashkeel
(evaluate-then-likely-defer). Each slice is its own spec→plan→implement cycle.

## Problem

Four surfaces independently documented the **same** ceiling — mixed LTR+RTL on one line is mishandled
(an embedded Latin word/number inside an Arabic line gets token-reversed; neutral brackets `()` mirror the
wrong way). Each grew its own partial heuristic:

| Surface | File | Today | Direction needed |
|---|---|---|---|
| Overlay **export** | `src/export/arabicOverlay.ts` `drawBidiLine` | split Arabic/Latin runs, reverse run order if base-RTL | logical→visual |
| **Copy** | `src/utils/rtlClipboard.ts` `reconstructLogicalText` | order spans by position (RTL→reverse) + NFKC | visual→logical |
| **Search** | `src/handlers/textSearchHandler.ts` `buildLogicalLines` | same position rule | visual→logical |
| DOCX **export** | `src/utils/flowDoc.ts` `reverseRtlText`/`orderLineWords` | word-level L2 run reversal + NFKC | visual→logical |

The fix is one shared engine. `bidi-js@1.0.3` (MIT, 0 sub-deps, pure-JS, full UAX#9) is **already vendored**
(transitive via jsdom) — adopt it rather than hand-roll UAX#9.

## Core realization

`bidi-js` is a **logical→visual** algorithm (`getEmbeddingLevels(text, dir)` → `getReorderedString` +
`getMirroredCharactersMap`). Only the **overlay export** feeds it logical text (the user-typed
`TextElement.text`). The other three start from pdf.js output, which is *already visual order*, and need the
**inverse** (visual→logical). bidi-js does not invert directly, so the engine is **two routines**.

Perfect visual→logical inversion is impossible from visual order alone (the original logical string is gone).
The inverse routine is a **strong, bounded approximation** that fixes the common cases; this is stated as an
explicit ceiling, not hidden.

## Architecture — `src/utils/bidi.ts` (pure, jsdom-testable)

Module-singleton `bidiFactory()` instance (lazy). Two exports:

### 1. `logicalToVisual(text: string, base?: 'rtl' | 'ltr' | 'auto'): string`
- `const lv = bidi.getEmbeddingLevels(text, base === 'auto' ? null : base)`
- `let out = bidi.getReorderedString(text, lv)` (returns visual order)
- apply `bidi.getMirroredCharactersMap(text, lv)` so paired brackets render mirrored.
  (Order note: `getReorderedString` already applies mirroring in bidi-js ≥1.0.3 — verify at
  implementation time; if it does, the explicit mirror step is dropped. A test pins the bracket output
  either way.)
- **Consumer:** overlay export.

### 2. `visualToLogical(text: string, base?: 'rtl' | 'ltr' | 'auto'): string`
Bounded inverse-L2, using bidi-js as the Unicode **bidi character database**:
1. If base resolves LTR (first strong char is L) → return `text` unchanged (identity).
2. Reverse the whole string (correct for a pure-RTL line).
3. Re-reverse each maximal **LTR-type run** — contiguous chars whose `bidi.getBidiCharTypeName(ch)` ∈
   {L, EN, ES, ET, CS, ON-between-numbers} — recovering embedded Latin words and numbers that step 2
   over-reversed.
4. Un-mirror paired brackets (a `)` that began as `(` etc.) via `openingToClosingBracket` /
   `closingToOpeningBracket`.
- **Consumers:** copy, search, DOCX export. NFKC presentation-form folding stays as a post-step in each
  caller (unchanged).

Base direction defaults to first-strong (UAX#9 P2/P3), matching the existing `baseIsRtl`.

## Integration (four wirings)

- **Overlay** (`arabicOverlay.ts` `drawBidiLine`): get visual order from `logicalToVisual`, THEN partition
  the visual string into per-script font runs (Noto vs Helvetica — Noto has no Latin glyphs) and draw L→R.
  Delete the local `baseIsRtl`-driven reversal; bidi-js owns ordering. File keeps only font partition + draw.
  `segmentBidiRuns` is retained as the font-partition helper (it splits Arabic vs non-Arabic), now applied to
  the already-visual string.
- **Copy** (`rtlClipboard.ts` `reconstructLogicalText`): build the per-row visual string from span geometry
  (existing space-inference by x-gap), then `visualToLogical(rowVisual)` + NFKC, replacing the
  reverse-by-position rule.
- **Search** (`textSearchHandler.ts` `buildLogicalLines`): run `visualToLogical` on the per-line visual
  string before NFKC + matching. LTR lines stay byte-identical (identity guard).
- **DOCX export** (`flowDoc.ts` `reverseRtlText`): re-express as `visualToLogical(text)` + the existing NFKC
  fold. `orderLineWords` keeps word granularity but defers char ordering within a word to the new routine.

## Error handling / safety

- Wrap the bidi-js factory call in try/catch; on any throw fall back to the **current heuristic** for that
  surface. Justification (anti-bandaid gate): third-party lib — keep the proven path as the floor so a
  bidi-js bug can never regress below today's behavior. Not masking an unknown failure; the current code IS
  the documented-correct fallback.
- **LTR-only identity** is a hard invariant: both routines return Latin-only input unchanged → zero risk to
  the ~99% non-Arabic path. Asserted by test, not assumed.
- **Pure-Arabic / pure-Latin no-op**: bidi-js on a single-direction line is a trivial reorder → output
  byte-identical to today; asserted rather than branched.

## Dependency change

Promote `bidi-js@1.0.3` transitive→direct prod dependency: `npm install bidi-js@1.0.3 --save`. MIT, 0
sub-deps → clean `npm audit --audit-level=high` (the deploy gate). Lockfile already pins 1.0.3.

## Testing

- **jsdom pure** `tests/utils/bidi.test.ts`: golden cases —
  - `"مرحبا World"` → embedded "World" stays forward, line RTL.
  - `"السعر 100 ريال"` → embedded EN number "100" forward.
  - `"(مرحبا)"` → brackets mirror correctly.
  - pure-Arabic no-op; **LTR-only identity**; `visualToLogical(logicalToVisual(x))` round-trip on
    representative lines.
- **jsdom updated guards**: `rtlClipboard.test.ts`, `textSearchHandler.test.ts`, `flowDocArabic.test.ts` —
  the embedded-LTR-run case now passes correctly (was the documented partial).
- **real Chrome** `tests/browser/arabic-bidi.browser.test.ts`: overlay export pixels for a mixed line +
  a copy/selection round-trip on a real mixed-direction PDF (surfaces jsdom can't lay out).
- Run order: `npm run type-check && npm run lint && npm run test`, then the browser suite. Tests EXECUTED,
  runner output pasted (project rule). RTK proxy mangles `npm test` → use
  `node_modules/.bin/vitest run --reporter=dot`.

## Out of scope (this slice)

- RTL-aware toolbar controls → slice 2.
- Shaped-ligature reorder (`الله`), tashkeel GPOS positioning → slice 3 (evaluate-then-likely-defer).
- Sub-character RTL highlight precision (item-level) — unchanged ceiling.

## Acceptance

1. `bidi.ts` two pure routines, LTR-identity invariant, all golden jsdom cases green.
2. All four surfaces call the shared engine; embedded-LTR-run + bracket cases corrected.
3. LTR-only and pure-Arabic outputs byte-identical to today (no regression on the common paths).
4. `npm audit` clean with bidi-js promoted; full jsdom + targeted browser suites green.
5. One commit (slice 1). NO Co-Authored-By. Push manual.
