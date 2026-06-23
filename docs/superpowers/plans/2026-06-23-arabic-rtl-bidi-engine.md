# Arabic-RTL Bidi Engine (Slice 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one shared char-level bidi engine (`src/utils/bidi.ts`, over `bidi-js`/UAX#9) and wire it into the four surfaces that each hand-rolled a partial Arabic bidi reorder — overlay export, copy, search, DOCX export — so mixed LTR+RTL lines (embedded Latin words/numbers, mirrored brackets) are handled correctly.

**Architecture:** `bidi-js` is a *logical→visual* algorithm. The overlay feeds it logical (user-typed) text; the other three start from pdf.js *visual-order* output and need the inverse. So the engine exposes three pure functions: `logicalToVisual` (overlay run ordering via `visualRuns`), `visualToLogical` (copy + DOCX, char-level bounded inverse), and the overlay uses `visualRuns`. Search keeps **item-granularity** ordering (it carries a token→item offset map a char reorder would break). Every bidi call is wrapped so a throw falls back to the raw/old behavior — never a regression below today.

**Tech Stack:** TypeScript, Vite, vitest (jsdom + real-Chrome via Playwright), `bidi-js@1.0.3` (MIT), `@cantoo/pdf-lib` + fontkit (overlay), pdf.js (extraction).

## Global Constraints

- TDD: write the failing test first, RUN it (paste runner output), then implement. RTK proxy mangles `npm test` → run `node_modules/.bin/vitest run --reporter=dot > /tmp/claude-1000/-stack-projects-pdfturbo/20f03b4b-dd13-4cad-b96b-f777ba1ae954/scratchpad/vt.log 2>&1` and grep the file.
- Pre-commit gate (CI parity): `npm run type-check && npm run lint && npm run test`. Browser suite: `node_modules/.bin/vitest run --config vitest.browser.config.ts <file> --reporter=dot`.
- **One commit for slice 1** (all tasks), `feat:` prefix. **NO Co-Authored-By trailer.** `git push` is MANUAL — never push.
- `bidi-js@1.0.3` promoted transitive→direct prod dep; must keep `npm audit --audit-level=high` clean.
- LTR-only and pure-Arabic outputs must stay **byte-identical** to today (identity/no-op invariants, asserted by test).
- Private helpers use the `_underscore` convention; oxlint `no-non-null-assertion` is ON (use `?.` / guards, never `x!`).
- i18n: no new user-facing strings in this slice (engine + wiring only).

---

### Task 1: Dependency + `logicalToVisual`

**Files:**
- Modify: `package.json` (add `bidi-js` to `dependencies`)
- Create: `src/utils/bidi.ts`
- Test: `tests/utils/bidi.test.ts`

**Interfaces:**
- Produces: `logicalToVisual(text: string, base?: 'ltr'|'rtl'|'auto'): string` — logical text → visual display order, brackets mirrored. `export type BidiBase = 'ltr'|'rtl'|'auto'`.

- [ ] **Step 1: Promote bidi-js to a direct dependency**

Run: `npm install bidi-js@1.0.3 --save-exact`
Expected: `package.json` gains `"bidi-js": "1.0.3"` under `dependencies`; `package-lock.json` unchanged version (1.0.3 already resolved). Then `npm audit --audit-level=high` → 0 high/critical.

- [ ] **Step 2: Write the failing test**

```ts
// tests/utils/bidi.test.ts
import { describe, it, expect } from 'vitest';
import { logicalToVisual } from '../../src/utils/bidi';

describe('logicalToVisual', () => {
  it('LTR-only text is returned unchanged', () => {
    expect(logicalToVisual('Hello World')).toBe('Hello World');
  });
  it('reverses a pure-Arabic line to visual order', () => {
    const L = 'مرحبا'; // logical
    const V = logicalToVisual(L, 'rtl');
    expect(V).not.toBe(L);            // reordered
    expect([...V].reverse().join('')).toBe(L); // single run → simple reverse
  });
  it('mirrors paired brackets in an RTL context', () => {
    const V = logicalToVisual('(مرحبا)', 'rtl');
    // '(' opened logically becomes ')' visually (and vice-versa) for odd-level chars
    expect(V.includes('(') || V.includes(')')).toBe(true);
    expect(V).not.toBe('(مرحبا)');
  });
  it('keeps an embedded LTR word forward inside an RTL line', () => {
    const V = logicalToVisual('مرحبا World', 'rtl');
    expect(V).toContain('World'); // the Latin run is NOT internally reversed
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node_modules/.bin/vitest run tests/utils/bidi.test.ts --reporter=dot > /tmp/claude-1000/-stack-projects-pdfturbo/20f03b4b-dd13-4cad-b96b-f777ba1ae954/scratchpad/vt.log 2>&1; tail -20 /tmp/claude-1000/-stack-projects-pdfturbo/20f03b4b-dd13-4cad-b96b-f777ba1ae954/scratchpad/vt.log`
Expected: FAIL — `Failed to resolve import "../../src/utils/bidi"`.

- [ ] **Step 4: Implement `bidi.ts` (factory + `logicalToVisual`)**

```ts
// src/utils/bidi.ts
/**
 * Shared char-level bidi engine (UAX#9) over bidi-js.
 *   logicalToVisual — user-typed logical text → display (visual) order, brackets mirrored.
 *                     Consumed by the Arabic overlay (via visualRuns).
 *   visualToLogical — pdf.js visual-order text → logical order (bounded inverse).
 *                     Consumed by copy + DOCX export.
 *   visualRuns      — logical text → runs in visual L→R order, each run's text LOGICAL
 *                     (so the overlay shapes Arabic via fontkit and draws Latin LTR).
 *
 * bidi-js is logical→visual; visualToLogical is a strong APPROXIMATION (perfect inversion
 * from visual order alone is impossible). Every call falls back to the raw string on a
 * bidi-js throw — never a regression below prior behavior.
 */
import bidiFactory from 'bidi-js';

interface EmbeddingLevels { levels: Uint8Array; paragraphs: unknown[]; }
interface BidiApi {
  getEmbeddingLevels(text: string, dir?: 'ltr' | 'rtl' | null): EmbeddingLevels;
  getReorderedString(text: string, levels: EmbeddingLevels): string;
  getReorderedIndices(text: string, levels: EmbeddingLevels): number[];
  getBidiCharTypeName(ch: string): string;
  getMirroredCharacter(ch: string): string | null;
}

export type BidiBase = 'ltr' | 'rtl' | 'auto';

let _bidi: BidiApi | null = null;
function _api(): BidiApi {
  if (!_bidi) _bidi = bidiFactory() as unknown as BidiApi;
  return _bidi;
}
function _explicit(base: BidiBase): 'ltr' | 'rtl' | null {
  return base === 'auto' ? null : base;
}

/** Logical (typed) text → visual display order, brackets mirrored. */
export function logicalToVisual(text: string, base: BidiBase = 'auto'): string {
  if (!text) return text;
  try {
    const b = _api();
    const levels = b.getEmbeddingLevels(text, _explicit(base));
    return b.getReorderedString(text, levels);
  } catch {
    return text;
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node_modules/.bin/vitest run tests/utils/bidi.test.ts --reporter=dot > /tmp/.../scratchpad/vt.log 2>&1; tail -20 /tmp/.../scratchpad/vt.log`
Expected: PASS (4 tests). (Use the full scratchpad path from Global Constraints.)

---

### Task 2: `visualToLogical`

**Files:**
- Modify: `src/utils/bidi.ts`
- Test: `tests/utils/bidi.test.ts`

**Interfaces:**
- Consumes: `_api`, `_explicit`, `BidiBase` (Task 1).
- Produces: `visualToLogical(text: string, base?: BidiBase): string` — visual-order text → logical order (bounded inverse: reverse line, re-reverse maximal LTR-type runs, un-mirror RTL-context brackets). LTR-base input returned unchanged.

- [ ] **Step 1: Write the failing test**

```ts
// append to tests/utils/bidi.test.ts
import { logicalToVisual, visualToLogical } from '../../src/utils/bidi';

describe('visualToLogical', () => {
  it('LTR-base text is identity', () => {
    expect(visualToLogical('Hello World')).toBe('Hello World');
  });
  it('round-trips logicalToVisual for representative lines', () => {
    for (const L of ['مرحبا', 'مرحبا World', 'السعر 100 ريال', '(مرحبا)']) {
      expect(visualToLogical(logicalToVisual(L, 'rtl'), 'rtl')).toBe(L);
    }
  });
  it('recovers an embedded multi-char LTR run order', () => {
    // visual form of "مرحبا Main" (RTL line): reverse → Arabic logical, "Main" re-reversed forward
    const L = 'مرحبا Main';
    expect(visualToLogical(logicalToVisual(L, 'rtl'), 'rtl')).toBe(L);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node_modules/.bin/vitest run tests/utils/bidi.test.ts --reporter=dot > /tmp/.../scratchpad/vt.log 2>&1; tail -20 /tmp/.../scratchpad/vt.log`
Expected: FAIL — `visualToLogical is not a function` / not exported.

- [ ] **Step 3: Implement `visualToLogical`**

```ts
// add to src/utils/bidi.ts
// Char types that lay out left-to-right inside an RTL line (UAX#9): strong-L plus
// European numbers and their adjacent separators/terminators. AN (Arabic-Indic digits)
// stay RTL.
const _STRONG_LTR = new Set(['L', 'EN']);
const _NEUTRAL = new Set(['WS', 'ON', 'ES', 'ET', 'CS']);

/** First strong character → base direction (UAX#9 P2/P3); defaults RTL. */
function _baseRtl(text: string, base: BidiBase, b: BidiApi): boolean {
  if (base !== 'auto') return base === 'rtl';
  for (const ch of text) {
    const t = b.getBidiCharTypeName(ch);
    if (t === 'L') return false;
    if (t === 'R' || t === 'AL') return true;
  }
  return true;
}

/**
 * Visual-order text → logical order (bounded inverse). LTR-base lines return unchanged.
 * Reverse the whole line, then for each maximal run of LTR-type/neutral chars: if the run
 * contains a strong-LTR char, re-reverse it (recovers embedded Latin words & numbers);
 * otherwise (a pure-neutral run in RTL context) un-mirror its brackets.
 */
export function visualToLogical(text: string, base: BidiBase = 'auto'): string {
  if (!text) return text;
  try {
    const b = _api();
    if (!_baseRtl(text, base, b)) return text; // identity for LTR
    const cps = [...text]; // code points (Arabic/Latin are BMP; non-BMP is a documented edge)
    cps.reverse();
    const typ = cps.map((c) => b.getBidiCharTypeName(c));
    const cand = (i: number): boolean => _STRONG_LTR.has(typ[i]) || _NEUTRAL.has(typ[i]);
    let i = 0;
    while (i < cps.length) {
      if (!cand(i)) { i++; continue; }
      let j = i;
      let hasStrong = false;
      while (j < cps.length && cand(j)) { if (_STRONG_LTR.has(typ[j])) hasStrong = true; j++; }
      if (hasStrong) {
        for (let lo = i, hi = j - 1; lo < hi; lo++, hi--) {
          const tmp = cps[lo]; cps[lo] = cps[hi]; cps[hi] = tmp;
        }
      } else {
        for (let k = i; k < j; k++) {
          const mirror = b.getMirroredCharacter(cps[k]);
          if (mirror) cps[k] = mirror;
        }
      }
      i = j;
    }
    return cps.join('');
  } catch {
    return text;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node_modules/.bin/vitest run tests/utils/bidi.test.ts --reporter=dot > /tmp/.../scratchpad/vt.log 2>&1; tail -20 /tmp/.../scratchpad/vt.log`
Expected: PASS (all `logicalToVisual` + `visualToLogical` tests).

---

### Task 3: `visualRuns` (overlay run ordering)

**Files:**
- Modify: `src/utils/bidi.ts`
- Test: `tests/utils/bidi.test.ts`

**Interfaces:**
- Consumes: `_api`, `_explicit`, `BidiBase`.
- Produces: `interface BidiVisualRun { text: string; rtl: boolean }` and `visualRuns(text: string, base?: BidiBase): BidiVisualRun[]` — runs in visual L→R order; each `run.text` is the LOGICAL substring of that run (so an RTL run can be shaped by fontkit `encodeText`, an LTR run drawn directly).

- [ ] **Step 1: Write the failing test**

```ts
// append to tests/utils/bidi.test.ts
import { visualRuns } from '../../src/utils/bidi';

describe('visualRuns', () => {
  it('LTR-only → single forward run', () => {
    expect(visualRuns('Hello')).toEqual([{ text: 'Hello', rtl: false }]);
  });
  it('pure Arabic → single rtl run with LOGICAL text', () => {
    const runs = visualRuns('مرحبا', 'rtl');
    expect(runs).toHaveLength(1);
    expect(runs[0].rtl).toBe(true);
    expect(runs[0].text).toBe('مرحبا'); // logical, NOT reversed (fontkit will shape it)
  });
  it('mixed line → runs in visual L→R order, Latin run rightmost forward', () => {
    // "مرحبا World" base-RTL: visually "World" sits left, Arabic right.
    const runs = visualRuns('مرحبا World', 'rtl');
    // first visual run is the LTR "World" (left), last is the Arabic (right)
    const latin = runs.find((r) => !r.rtl);
    const arabic = runs.find((r) => r.rtl);
    expect(latin?.text.trim()).toBe('World');
    expect(arabic?.text).toBe('مرحبا'); // logical
    expect(runs.indexOf(latin!)).toBeLessThan(runs.indexOf(arabic!));
  });
});
```
(Note: the `latin!`/`arabic!` non-null assertions are test-only; production code uses guards.)

- [ ] **Step 2: Run test to verify it fails**

Run: `node_modules/.bin/vitest run tests/utils/bidi.test.ts --reporter=dot > /tmp/.../scratchpad/vt.log 2>&1; tail -20 /tmp/.../scratchpad/vt.log`
Expected: FAIL — `visualRuns is not a function`.

- [ ] **Step 3: Implement `visualRuns`**

```ts
// add to src/utils/bidi.ts
export interface BidiVisualRun {
  /** The run's LOGICAL substring (RTL runs are NOT pre-reversed — fontkit shapes them). */
  text: string;
  rtl: boolean;
}

/**
 * Logical text → runs in visual left-to-right order. Uses bidi-js reordered indices to
 * place runs; each run's `text` is rebuilt in LOGICAL order so the overlay can shape an
 * Arabic run with fontkit (which itself emits visual glyphs) and draw an LTR run directly.
 * Bracket display-mirroring inside the overlay is a documented residual (fontkit draws the
 * logical glyph); the copy/search/DOCX surfaces handle bracket mirroring.
 */
export function visualRuns(text: string, base: BidiBase = 'auto'): BidiVisualRun[] {
  if (!text) return [];
  try {
    const b = _api();
    const levels = b.getEmbeddingLevels(text, _explicit(base));
    const order = b.getReorderedIndices(text, levels); // visual order of UTF-16 indices
    const out: BidiVisualRun[] = [];
    let cur: { idx: number[]; rtl: boolean } | null = null;
    for (const k of order) {
      const rtl = (levels.levels[k] & 1) === 1;
      if (!cur || cur.rtl !== rtl) { cur = { idx: [], rtl }; out.push({ text: '', rtl }); }
      cur.idx.push(k);
      // Rebuild this run's LOGICAL text: an RTL run's visual indices descend in logical
      // order, so sort ascending to recover logical; an LTR run's visual order IS logical.
      const sorted = rtl ? [...cur.idx].sort((a, c) => a - c) : cur.idx;
      out[out.length - 1].text = sorted.map((n) => text[n]).join('');
    }
    return out;
  } catch {
    return [{ text, rtl: false }];
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node_modules/.bin/vitest run tests/utils/bidi.test.ts --reporter=dot > /tmp/.../scratchpad/vt.log 2>&1; tail -20 /tmp/.../scratchpad/vt.log`
Expected: PASS (all bidi.ts tests).

---

### Task 4: Wire Copy (`reconstructLogicalText`)

**Files:**
- Modify: `src/utils/rtlClipboard.ts:62-84` (the per-row text-building loop)
- Test: `tests/utils/rtlClipboard.test.ts`

**Interfaces:**
- Consumes: `visualToLogical` (Task 2).

- [ ] **Step 1: Write the failing test** (embedded multi-char LTR run currently scrambles)

```ts
// add to tests/utils/rtlClipboard.test.ts — spans are per-glyph, VISUAL L→R order.
// Visual layout of logical "مرحبا Main" (base-RTL): Latin "Main" on the LEFT, Arabic on the RIGHT.
it('recovers an embedded multi-char LTR run in copy', () => {
  // Build visual-order single-char spans left→right: M a i n <space> ا ب ح ر م
  const mk = (text: string, left: number) => ({ text, left, right: left + 8, top: 0, height: 10 });
  const spans = [
    mk('M', 0), mk('a', 8), mk('i', 16), mk('n', 24),
    mk('ا', 40), mk('ب', 48), mk('ح', 56), mk('ر', 64), mk('م', 72),
  ];
  // Arabic-dominant row → RTL. Expected logical reading: "مرحبا Main".
  expect(reconstructLogicalText(spans)).toBe('مرحبا Main');
});
```
(Adjust the Arabic span order to whatever visual order pdf.js emits; the assertion is the logical output. Confirm the exact expectation by running once and reading the actual — the point is "Main" stays forward, not "niaM".)

- [ ] **Step 2: Run test to verify it fails**

Run: `node_modules/.bin/vitest run tests/utils/rtlClipboard.test.ts --reporter=dot > /tmp/.../scratchpad/vt.log 2>&1; tail -25 /tmp/.../scratchpad/vt.log`
Expected: FAIL — current code emits "niaM" (LTR run reversed) instead of "Main".

- [ ] **Step 3: Implement — build the row's VISUAL string, then `visualToLogical`**

Replace the per-row body (currently builds `out` from `order = rtl ? reverse(byX) : byX` with NFKC per cell) with: build the **visual** string in `byX` order (with the existing x-gap space inference), then apply `visualToLogical` and NFKC.

```ts
// src/utils/rtlClipboard.ts — inside `lines = rows.map((row) => { ... })`
import { visualToLogical } from './bidi'; // add at top with the existing import

const lines = rows.map((row) => {
  const byX = [...row].sort((a, b) => a.left - b.left); // visual L→R
  const rtlVotes = byX.reduce((n, s) => n + (isArabicText(s.text) ? 1 : 0), 0);
  const rtl = rtlVotes * 2 > byX.length;
  // Build the VISUAL-order string with x-gap space inference (unchanged geometry rule).
  let visual = '';
  for (let i = 0; i < byX.length; i++) {
    if (i > 0 && byX[i].left - byX[i - 1].right > medianW * 0.4) visual += ' ';
    visual += byX[i].text;
  }
  // Visual → logical (RTL-aware char-level inverse); NFKC folds presentation forms.
  return (rtl ? visualToLogical(visual, 'rtl') : visual).normalize('NFKC');
});
```
Remove the now-unused per-cell `order`/`out` logic. Keep the existing `reconstructLogicalText` signature and row clustering above untouched.

- [ ] **Step 4: Run the rtlClipboard suite**

Run: `node_modules/.bin/vitest run tests/utils/rtlClipboard.test.ts --reporter=dot > /tmp/.../scratchpad/vt.log 2>&1; tail -25 /tmp/.../scratchpad/vt.log`
Expected: PASS — new embedded-LTR case green AND the existing multi-char-span / no-internal-reverse cases still green.

---

### Task 5: Wire DOCX export (`reverseRtlText`)

**Files:**
- Modify: `src/utils/flowDoc.ts:480-482` (`reverseRtlText`)
- Test: `tests/utils/flowDocArabic.test.ts`

**Interfaces:**
- Consumes: `visualToLogical` (Task 2).

- [ ] **Step 1: Write the failing test**

```ts
// add to tests/utils/flowDocArabic.test.ts
import { reverseRtlText } from '../../src/utils/flowDoc';
it('reverseRtlText keeps an embedded Latin token forward', () => {
  // pdf.js visual of logical "ABC مرحبا" within one rtl word/string — Latin stays "ABC".
  const visual = reverseRtlText('مرحبا ABC'); // current: blanket reverse → "CBA ..."
  expect(visual).toContain('ABC');
});
```
(Verify the precise expected string by running once; the invariant is "ABC" not "CBA".)

- [ ] **Step 2: Run test to verify it fails**

Run: `node_modules/.bin/vitest run tests/utils/flowDocArabic.test.ts --reporter=dot > /tmp/.../scratchpad/vt.log 2>&1; tail -25 /tmp/.../scratchpad/vt.log`
Expected: FAIL — current blanket `[...s].reverse()` yields "CBA".

- [ ] **Step 3: Implement — delegate to `visualToLogical` + NFKC**

```ts
// src/utils/flowDoc.ts
import { visualToLogical } from './bidi'; // add near the top imports

export function reverseRtlText(s: string): string {
  return visualToLogical(s, 'rtl').normalize('NFKC');
}
```
`orderLineWords` (the word-level cross-word ordering) is unchanged — it calls `reverseRtlText` per RTL word and now gets char-level-correct word text.

- [ ] **Step 4: Run the flowDocArabic suite**

Run: `node_modules/.bin/vitest run tests/utils/flowDocArabic.test.ts --reporter=dot > /tmp/.../scratchpad/vt.log 2>&1; tail -25 /tmp/.../scratchpad/vt.log`
Expected: PASS — new case green AND existing presentation-form/NFKC + AR-1 word-order cases still green. If an existing case asserted the OLD blanket-reverse output for a mixed string, update it to the corrected logical order (note the change in the commit body).

---

### Task 6: Wire Search (`buildLogicalLines`) — item-level run fix

**Files:**
- Modify: `src/handlers/textSearchHandler.ts:75-95` (the RTL row-ordering in `buildLogicalLines`)
- Test: `tests/handlers/textSearchHandler.test.ts`

**Interfaces:**
- Consumes: `isArabicText` (already imported from `flowDoc`).
- Rationale: `buildLogicalLines` returns a `tokens[]` map of `{itemIndex,start,end}` into `text`. A char-level reorder breaks those offsets, so search re-reverses LTR **item** runs (atomic items → offsets stay valid), mirroring what `orderLineWords` already does for DOCX. This is the spec's "visual→logical for search" at item granularity (noted refinement).

- [ ] **Step 1: Write the failing test**

```ts
// add to tests/handlers/textSearchHandler.test.ts
import { buildLogicalLines } from '../../src/handlers/textSearchHandler';
it('orders an embedded multi-item LTR run forward in an RTL line', () => {
  // One row, visual L→R per-glyph items: M a i n  then Arabic ا ب ح ر م (rtl-dominant).
  const it = (str: string, x: number) => ({ str, transform: [1,0,0,1,x,100], width: 8, height: 10 });
  const items = [
    it('M',0), it('a',8), it('i',16), it('n',24),
    it('ا',40), it('ب',48), it('ح',56), it('ر',64), it('م',72),
  ];
  const [line] = buildLogicalLines(items);
  expect(line.rtl).toBe(true);
  expect(line.text).toContain('Main'); // forward, NOT "niaM"
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node_modules/.bin/vitest run tests/handlers/textSearchHandler.test.ts --reporter=dot > /tmp/.../scratchpad/vt.log 2>&1; tail -25 /tmp/.../scratchpad/vt.log`
Expected: FAIL — current `order = rtl ? reverse(byX) : byX` yields "niaM".

- [ ] **Step 3: Implement — item-level inverse-L2 for the RTL branch**

Replace `const order = rtl ? [...byX].reverse() : byX;` (line 79) with a run-aware logical order that re-reverses LTR item runs (so embedded Latin/number items stay forward), preserving item atomicity:

```ts
// src/handlers/textSearchHandler.ts — inside rows.map, replacing the `order` line
let order: typeof byX;
if (!rtl) {
  order = byX;
} else {
  // byX is visual L→R. Split into maximal same-direction ITEM runs, emit runs right→left;
  // RTL runs reversed (logical), embedded LTR runs kept forward (UAX#9 L2 at item level).
  const runs: (typeof byX)[] = [];
  for (const cell of byX) {
    const isAr = isArabicText(cell.it.str);
    const last = runs[runs.length - 1];
    if (last && isArabicText(last[0].it.str) === isAr) last.push(cell);
    else runs.push([cell]);
  }
  order = [];
  for (let s = runs.length - 1; s >= 0; s--) {
    const run = runs[s];
    if (isArabicText(run[0].it.str)) for (let i = run.length - 1; i >= 0; i--) order.push(run[i]);
    else order.push(...run); // embedded LTR run forward
  }
}
```
The downstream space-inference + `tokens.push({ itemIndex: order[k].i, ... })` loop is unchanged (items stay atomic, offsets valid). `buildLogicalLines` must be `export`ed (it already is per `:56`).

- [ ] **Step 4: Run the textSearchHandler suite**

Run: `node_modules/.bin/vitest run tests/handlers/textSearchHandler.test.ts --reporter=dot > /tmp/.../scratchpad/vt.log 2>&1; tail -25 /tmp/.../scratchpad/vt.log`
Expected: PASS — new case green AND the existing per-glyph-spanning Arabic search + Latin-per-item cases still green.

---

### Task 7: Wire Overlay (`drawBidiLine`) — `visualRuns`

**Files:**
- Modify: `src/export/arabicOverlay.ts:226-265` (`drawBidiLine`)
- Test: `tests/export/arabicOverlay.test.ts`

**Interfaces:**
- Consumes: `visualRuns`, `BidiVisualRun` (Task 3).

- [ ] **Step 1: Write the failing test** (run ordering now comes from bidi-js)

```ts
// add to tests/export/arabicOverlay.test.ts — assert segmentation/order at the helper level.
import { visualRuns } from '../../src/utils/bidi';
it('visualRuns places the Latin run left of the Arabic run for a base-RTL line', () => {
  const runs = visualRuns('مرحبا World', 'rtl');
  const latinIdx = runs.findIndex((r) => !r.rtl && r.text.includes('World'));
  const arabicIdx = runs.findIndex((r) => r.rtl);
  expect(latinIdx).toBeGreaterThanOrEqual(0);
  expect(latinIdx).toBeLessThan(arabicIdx); // Latin drawn first (leftmost)
});
```
(The pixel correctness is covered by the browser test in Task 8; this jsdom test pins the ordering contract `drawBidiLine` now relies on.)

- [ ] **Step 2: Run test to verify it fails / passes**

Run: `node_modules/.bin/vitest run tests/export/arabicOverlay.test.ts --reporter=dot > /tmp/.../scratchpad/vt.log 2>&1; tail -25 /tmp/.../scratchpad/vt.log`
Expected: PASS if Task 3 done (this is a contract guard); FAIL only if `visualRuns` is missing.

- [ ] **Step 3: Rewrite `drawBidiLine` to draw `visualRuns` L→R**

Replace the body of `drawBidiLine` (the `segmentBidiRuns(opts.text)` + `baseIsRtl`-reverse logic) with: get `visualRuns(opts.text)` (already in visual L→R order), measure each run in its font, right-align the total within the box, draw L→R — Arabic runs via `encodeText` + `pushOperators` (existing op sequence), Latin runs via `page.drawText`. A Latin run that Helvetica can't encode falls back to the Arabic font (keep the existing try/catch).

```ts
// src/export/arabicOverlay.ts
import { visualRuns } from '../utils/bidi'; // add at top

async function drawBidiLine(pdfDoc: PDFDocument, page: PDFPage, opts: ArabicLineOpts): Promise<void> {
  const arFont = await getArabicFont(pdfDoc);
  const latFont = await getLatinFont(pdfDoc);
  const measured = visualRuns(opts.text).map((r) => {
    if (!r.rtl) {
      try {
        return { text: r.text, useLatin: true, width: latFont.widthOfTextAtSize(r.text, opts.size) };
      } catch {
        return { text: r.text, useLatin: false, width: arFont.widthOfTextAtSize(r.text, opts.size) };
      }
    }
    return { text: r.text, useLatin: false, width: arFont.widthOfTextAtSize(r.text, opts.size) };
  });
  const total = measured.reduce((s, r) => s + r.width, 0);
  let cx = Math.max(opts.x, opts.right - total);
  const arKey = page.node.newFontDictionary(arFont.name, arFont.ref);
  for (const r of measured) { // ALREADY in visual L→R order — no reverse
    if (r.useLatin) {
      page.drawText(r.text, { x: cx, y: opts.y, size: opts.size, font: latFont,
        color: rgb(opts.color.r, opts.color.g, opts.color.b) });
    } else {
      const hex = arFont.encodeText(r.text).toString().replace(/^<|>$/g, '');
      if (hex) {
        page.pushOperators(
          pushGraphicsState(), beginText(),
          setFillingRgbColor(opts.color.r, opts.color.g, opts.color.b),
          setFontAndSize(arKey, opts.size),
          setTextMatrix(1, 0, 0, 1, cx, opts.y),
          showText(PDFHexString.of(hex)), endText(), popGraphicsState(),
        );
      }
    }
    cx += r.width;
  }
}
```
`segmentBidiRuns` / `baseIsRtl` become unused by `drawBidiLine`; keep them exported only if other callers/tests use them (grep first — if only `drawBidiLine` used them, delete to satisfy oxlint `no-unused-vars`; their tests move/delete accordingly). The pure-Arabic fast path in `drawArabicLine` (no `[A-Za-z0-9]`) is unchanged.

- [ ] **Step 4: Run the arabicOverlay suite + type-check**

Run: `node_modules/.bin/vitest run tests/export/arabicOverlay.test.ts --reporter=dot > /tmp/.../scratchpad/vt.log 2>&1; tail -25 /tmp/.../scratchpad/vt.log` then `npm run type-check`
Expected: PASS; type-check clean (no unused-import errors — delete dead helpers if oxlint flags them in the final gate).

---

### Task 8: Real-Chrome browser guard + final gate + commit

**Files:**
- Create: `tests/browser/arabic-bidi.browser.test.ts`
- Test: full jsdom suite + the new browser test

**Interfaces:**
- Consumes: all of the above (engine + four wirings).

- [ ] **Step 1: Write the browser test** (pixels jsdom can't produce)

```ts
// tests/browser/arabic-bidi.browser.test.ts
import { describe, it, expect } from 'vitest';
import { PDFDocument } from '@cantoo/pdf-lib';
import { drawArabicLine } from '../../src/export/arabicOverlay';

describe('Arabic bidi overlay — real Chrome', () => {
  it('renders a mixed Arabic+Latin line with the Latin run intact (ink width)', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([300, 100]);
    await drawArabicLine(doc, page, {
      text: 'مرحبا World', x: 10, y: 50, right: 290, size: 24, color: { r: 0, g: 0, b: 0 },
    });
    const bytes = await doc.save();
    // Re-render via pdf.js and assert non-trivial ink across BOTH script regions.
    // (Mirror the rasterize+pixel-scan helper used in arabic-overlay.browser.test.ts.)
    expect(bytes.byteLength).toBeGreaterThan(1000);
  });
});
```
Model the rasterize + pixel-band assertion on the existing `tests/browser/arabic-overlay.browser.test.ts` (it already loads pdf.js and scans ink width). Assert ink exists in the left (Latin) band AND the right (Arabic) band — proving the run order rendered, not tofu.

- [ ] **Step 2: Run the browser test**

Run: `node_modules/.bin/vitest run --config vitest.browser.config.ts tests/browser/arabic-bidi.browser.test.ts --reporter=dot > /tmp/.../scratchpad/vt.log 2>&1; tail -30 /tmp/.../scratchpad/vt.log`
Expected: PASS (real Chrome via Playwright).

- [ ] **Step 3: Full gate (CI parity)**

Run:
```
npm run type-check \
 && npm run lint \
 && node_modules/.bin/vitest run --reporter=dot > /tmp/.../scratchpad/jsdom.log 2>&1; tail -5 /tmp/.../scratchpad/jsdom.log \
 && npm audit --audit-level=high
```
Expected: type-check clean; oxlint clean; jsdom suite green (prior baseline 2017 pass + 2 expected-fail / 173 files, now +the new bidi/wiring tests); `npm audit` 0 high/critical.

- [ ] **Step 4: Visual confirmation (user preference — eyes-on)**

`npm run dev` → open a PDF, add an Arabic text overlay containing an embedded Latin word/number ("مرحبا World 2026"), export, and screenshot before/after. Also verify copy (select a mixed line, Ctrl+C, paste — embedded Latin forward) and search. Save shots under `qa-shots/f3-bidi/`.

- [ ] **Step 5: Commit (one commit, slice 1)**

```bash
git add package.json package-lock.json src/utils/bidi.ts \
        src/utils/rtlClipboard.ts src/utils/flowDoc.ts \
        src/handlers/textSearchHandler.ts src/export/arabicOverlay.ts \
        tests/utils/bidi.test.ts tests/utils/rtlClipboard.test.ts \
        tests/utils/flowDocArabic.test.ts tests/handlers/textSearchHandler.test.ts \
        tests/export/arabicOverlay.test.ts tests/browser/arabic-bidi.browser.test.ts
git commit -m "feat(arabic): shared char-level bidi engine (UAX#9) across overlay/copy/search/docx"
```
Do NOT push (manual). Update `docs/plans/option3-features-2026-06-23.plan.md` Decisions Log + the qa-sweep memory with the slice-1 commit sha and the documented residuals in a follow-up doc commit.

---

## Self-Review

**Spec coverage:**
- Two-routine engine → Tasks 1, 2 (+ `visualRuns` Task 3 for the overlay's logical→visual run ordering). ✓
- Overlay wiring → Task 7; copy → Task 4; search → Task 6; DOCX → Task 5. ✓ (All four surfaces.)
- bidi-js promoted to prod dep → Task 1 Step 1. ✓
- Fallback-to-current-behavior floor → try/catch in every engine fn (Tasks 1-3). ✓
- LTR-identity / pure-Arabic no-op invariants → tested in Tasks 1, 2. ✓
- jsdom golden cases + updated surface guards + real-Chrome → Tasks 1-8. ✓
- **Spec deviation noted:** search uses ITEM-level ordering (not char-level `visualToLogical`) to preserve its token→item offset map — documented in Task 6 rationale. This is a faithful refinement, not a scope cut (the embedded-LTR-run *order* is still corrected).

**Placeholder scan:** the `/tmp/.../scratchpad/` ellipsis in run commands is shorthand for the full scratchpad path in Global Constraints — expand it when running. The two "verify the precise expected string by running once" notes (Tasks 4, 5) are because the exact Arabic visual-order fixture output depends on pdf.js/bidi-js glyph emission; the *invariant* (Latin run forward) is explicit. No TBD/TODO/"handle edge cases" placeholders.

**Type consistency:** `logicalToVisual`/`visualToLogical(text, base?: BidiBase)`, `visualRuns(text, base?)→BidiVisualRun[]`, `BidiBase='ltr'|'rtl'|'auto'`, `BidiVisualRun={text,rtl}` — names consistent across Tasks 1-3 and consumers 4-7. `reconstructLogicalText`, `buildLogicalLines`, `reverseRtlText`, `drawBidiLine` signatures unchanged (internal-only edits). ✓
