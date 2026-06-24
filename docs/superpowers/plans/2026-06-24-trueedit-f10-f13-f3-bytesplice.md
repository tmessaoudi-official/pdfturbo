# True-edit F10 + F13 + F3 hybrid byte-splice — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the three remaining actionable true-edit edge cases — refuse decoration-resize for tilted text (F10) and on q/Q stack underflow (F13), and replace the full-stream re-serialize write-back with a hybrid byte-splice that preserves non-edited bytes verbatim (F3).

**Architecture:** All changes live in the shared true-edit engine `src/utils/contentStreamEditor.ts` and the type file `src/types/contentStream.ts`. F10/F13 are one-line defensive gates in `prepareDecorationResize`. F3 records token/op byte offsets, snapshots per-op serialized strings at `findTarget`, and a new `buildStreamContent` diffs mutated-vs-original ops: exactly one changed op → splice its byte range into the original source; zero changed + appended tail → keep source verbatim + append; anything else → today's `serializeOps` (zero regression).

**Tech Stack:** TypeScript, Vite, Vitest (jsdom + real-Chrome browser harness via `@vitest/browser`/Playwright), `@cantoo/pdf-lib`.

**Spec:** `docs/superpowers/specs/2026-06-24-trueedit-f10-f13-f3-bytesplice-design.md`

## Global Constraints

- **Gate for EVERY task** (the CI-red lesson — this is a shared-surface engine): `npm run type-check && npm run lint && npm run test` **AND** `npm run test:browser` (full, real Chrome) **AND** `npm run build`. Tests MUST be executed; paste runner output.
- **TDD**: write the failing test first, run it red, implement, run it green.
- **One commit per task.** Commit prefixes `feat:`/`fix:`/`refactor:`/`docs:`, imperative subject. **No `Co-Authored-By` trailer.**
- `git push` is **MANUAL** — never push; stop after committing.
- `set`-style private convention: underscore-prefixed unused args only; oxlint `no-non-null-assertion` is ON (no `!`); prefer `textContent`-style safety. New exported symbols need a doc comment.
- **Zero behavioral regression is the contract for F3**: any edit not matching a fast path must produce byte-identical output to today's `serializeOps`.
- Test helpers already in `tests/utils/contentStreamEditor.test.ts`: `ops(stream)` / `mkOps` (= `groupOps(tokenizeContentStream(stream))`) and `makeUnderlinedTextPdf(rectWidth?)` (a standard-font "Hello" + thin filled underline rect at `50 297 W 1.2 re f`, baseline Tm `1 0 0 1 50 300`). Reuse them.

## File Structure

- `src/types/contentStream.ts` — add optional `byteStart`/`byteEnd` to `CsToken` and `CsOp`. (No behavior; pure data carriers.)
- `src/utils/contentStreamEditor.ts` — all logic: F10/F13 gates, `ctmStackUnderflows`, byte-offset stamping in the tokenizer + `groupOps`, `serializeOp` extraction, `EditTarget` snapshot fields, `buildStreamContent`, and the `writeBack`/Path-3/`addDecorationAt` rewrites.
- `tests/utils/contentStreamEditor.test.ts` — all jsdom unit tests (append to the existing file; reuse its helpers).
- `tests/browser/trueedit-bytesplice.browser.test.ts` — NEW real-Chrome guard: a one-word edit on a page containing an inline image leaves all non-edited bytes (incl. the binary image) byte-identical.

---

### Task 1: F10 — refuse decoration-resize for tilted text

**Files:**
- Modify: `src/utils/contentStreamEditor.ts` (`prepareDecorationResize`, ~`:2043`)
- Test: `tests/utils/contentStreamEditor.test.ts`

**Interfaces:**
- Consumes: existing `TextOpInfo.tilted` (set by `locateTextOps:516–519`), existing public `replaceTextAt(doc, pageIndex, point, newText, tol, style?, fallbackColor?, opts?)`.
- Produces: no new symbols. Behavior: a tilted target leaves any matched decoration rule's width operand unchanged.

- [ ] **Step 1: Write the failing test.** Append to `tests/utils/contentStreamEditor.test.ts`. A sheared-Tm "Hello" with the same underline rect; after a `replaceTextAt` with `adjustDecorations:true`, the `re` width operand must be UNCHANGED (gate fired → no resize). Mirror `makeUnderlinedTextPdf` but shear the Tm and re-derive the baseline point.

```ts
describe('F10 — tilted text refuses decoration-resize', () => {
  /** "Hello" drawn with a sheared text matrix + an underline rect (same as makeUnderlinedTextPdf). */
  async function makeTiltedUnderlinedPdf(): Promise<Uint8Array> {
    const doc = await PDFDocument.create();
    const page = doc.addPage([400, 400]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    page.drawText('seed', { x: 0, y: 0, size: 1, font });
    const ctx = doc.context;
    const pageRes = ctx.lookup(page.node.get(PDFName.of('Resources'))) as PDFDict;
    const fontDict = ctx.lookup(pageRes.get(PDFName.of('Font'))) as PDFDict;
    const helvVal = fontDict.get([...fontDict.entries()][0][0]);
    if (!helvVal) throw new Error('font missing');
    fontDict.set(PDFName.of('F1'), helvVal);
    // Sheared Tm (b = 0.3): textMatrix×CTM off-diagonal ≠ 0 → tilted.
    const content =
      `BT /F1 12 Tf 1 0.3 0 1 50 300 Tm (Hello) Tj ET\n` +
      `0 0 0 rg 50 297 28 1.2 re f`;
    const cb = new Uint8Array(content.length);
    for (let i = 0; i < content.length; i++) cb[i] = content.charCodeAt(i) & 0xff;
    page.node.set(PDFName.of('Contents'), ctx.register(ctx.stream(cb)));
    return doc.save();
  }

  it('leaves the underline rect width unchanged when the text matrix is tilted', async () => {
    const doc = await PDFDocument.load(await makeTiltedUnderlinedPdf());
    // confirm the run is flagged tilted (the gate's trigger)
    const before = locateTextOps(ops('BT /F1 12 Tf 1 0.3 0 1 50 300 Tm (Hello) Tj ET'));
    expect(before.find(t => t.operator === 'Tj')?.tilted).toBe(true);
    // edit "Hello" → "Hi" with decoration adjust ON; origin is at (50,300) in user space.
    const r = await replaceTextAt(doc, 0, { x: 50, y: 300 }, 'Hi', 6, undefined, undefined, { adjustDecorations: true });
    expect(r).not.toBe(false); // the text edit still proceeds
    const after = groupOps(tokenizeContentStream(getPageContentForTest(doc, 0)));
    const re = after.find(o => o.operator === 're');
    expect(re?.operands[2]?.raw).toBe('28'); // width operand NOT resized — gate fired
  });
});
```

> Note: `getPageContentForTest` — if the test file lacks a content-read helper, add a tiny local one using `decodePDFRawStream` on the page `/Contents` (the file already imports `decodePDFRawStream`, `PDFRawStream`). If a helper already exists, reuse it.

- [ ] **Step 2: Run the test, verify it FAILS.** Run: `node_modules/.bin/vitest run tests/utils/contentStreamEditor.test.ts -t "F10" --reporter=dot > /tmp/claude-1000/-stack-projects-pdfturbo/20f03b4b-dd13-4cad-b96b-f777ba1ae954/scratchpad/t1.log 2>&1; tail -30 /tmp/.../t1.log`. Expected: FAIL — the width was resized (e.g. `re` width became ~`12.x`), because no tilted gate exists yet.

- [ ] **Step 3: Implement the gate.** In `prepareDecorationResize`, immediately after the F6 text-rise gate:

```ts
  if (target.textRise) return null;
  // F10: a sheared/rotated/non-uniformly-scaled text matrix makes the reported
  // baseline + derived font size unreliable, so an axis-aligned decoration rule
  // would be mis-matched/mis-sized. Refuse to touch geometry (the text edit still
  // proceeds). Mirrors the F5 mirror + F6 text-rise gates; reuses the already-set
  // `tilted` flag (locateTextOps) that addDecorationAt already gates on.
  if (target.tilted) return null;
```

- [ ] **Step 4: Run the test, verify it PASSES.** Same command. Expected: PASS (`re` width stays `28`).

- [ ] **Step 5: Full gate + commit.** Run `npm run type-check && npm run lint && npm run test` then `npm run test:browser` then `npm run build` (paste output). Then:

```bash
git add src/utils/contentStreamEditor.ts tests/utils/contentStreamEditor.test.ts
git commit -m "fix(trueedit): refuse decoration-resize for tilted text (F10)"
```

---

### Task 2: F13 — refuse decoration-resize on q/Q stack underflow

**Files:**
- Modify: `src/utils/contentStreamEditor.ts` (new `ctmStackUnderflows`; gate in `prepareDecorationResize`)
- Test: `tests/utils/contentStreamEditor.test.ts`

**Interfaces:**
- Produces: `export function ctmStackUnderflows(ops: CsOp[]): boolean`.
- Behavior: a stream where a `Q` pops an empty stack leaves any matched decoration rule unchanged.

- [ ] **Step 1: Write the failing tests.** Add both the pure-helper test and a behavioral gate test.

```ts
describe('ctmStackUnderflows', () => {
  it('false for balanced q/Q', () => {
    expect(ctmStackUnderflows(ops('q 1 0 0 1 0 0 cm Q'))).toBe(false);
  });
  it('false for nested balanced q/Q', () => {
    expect(ctmStackUnderflows(ops('q q Q Q'))).toBe(false);
  });
  it('true when a Q pops an empty stack', () => {
    expect(ctmStackUnderflows(ops('q Q Q'))).toBe(true);
  });
  it('true for a leading unmatched Q', () => {
    expect(ctmStackUnderflows(ops('Q 50 297 28 1 re f'))).toBe(true);
  });
});

describe('F13 — q/Q underflow refuses decoration-resize', () => {
  async function makeUnbalancedUnderlinedPdf(): Promise<Uint8Array> {
    const doc = await PDFDocument.create();
    const page = doc.addPage([400, 400]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    page.drawText('seed', { x: 0, y: 0, size: 1, font });
    const ctx = doc.context;
    const pageRes = ctx.lookup(page.node.get(PDFName.of('Resources'))) as PDFDict;
    const fontDict = ctx.lookup(pageRes.get(PDFName.of('Font'))) as PDFDict;
    const helvVal = fontDict.get([...fontDict.entries()][0][0]);
    if (!helvVal) throw new Error('font missing');
    fontDict.set(PDFName.of('F1'), helvVal);
    // A stray leading Q underflows the graphics-state stack.
    const content =
      `Q BT /F1 12 Tf 1 0 0 1 50 300 Tm (Hello) Tj ET\n` +
      `0 0 0 rg 50 297 28 1.2 re f`;
    const cb = new Uint8Array(content.length);
    for (let i = 0; i < content.length; i++) cb[i] = content.charCodeAt(i) & 0xff;
    page.node.set(PDFName.of('Contents'), ctx.register(ctx.stream(cb)));
    return doc.save();
  }

  it('leaves the underline rect width unchanged on q/Q underflow', async () => {
    const doc = await PDFDocument.load(await makeUnbalancedUnderlinedPdf());
    const r = await replaceTextAt(doc, 0, { x: 50, y: 300 }, 'Hi', 6, undefined, undefined, { adjustDecorations: true });
    expect(r).not.toBe(false);
    const after = groupOps(tokenizeContentStream(getPageContentForTest(doc, 0)));
    expect(after.find(o => o.operator === 're')?.operands[2]?.raw).toBe('28');
  });
});
```

Add `ctmStackUnderflows` to the import block at the top of the test file.

- [ ] **Step 2: Run, verify FAIL.** Run the `-t "ctmStackUnderflows|F13"` subset → FAIL (`ctmStackUnderflows` not exported; width resized).

- [ ] **Step 3: Implement.** Add the helper (place it near `locateDecorationRects`):

```ts
/**
 * True if any `Q` operator pops an empty graphics-state stack (unbalanced q/Q).
 * When true, the CTM is stale from that point on, so CTM-dependent decoration
 * geometry on the stream is unreliable and a resize is refused (F13). Pure.
 */
export function ctmStackUnderflows(ops: CsOp[]): boolean {
  let depth = 0;
  for (const op of ops) {
    if (op.operator === 'q') depth++;
    else if (op.operator === 'Q') {
      if (depth === 0) return true;
      depth--;
    }
  }
  return false;
}
```

Gate in `prepareDecorationResize`, right after the no-rules early return:

```ts
  if (locateDecorationRects(ops).length === 0) return null;
  if (ctmStackUnderflows(ops)) return null; // F13: stale CTM → decoration geometry unreliable
  if (target.textRise) return null;
  if (target.tilted) return null; // F10
```

- [ ] **Step 4: Run, verify PASS.**

- [ ] **Step 5: Full gate + commit.**

```bash
git add src/utils/contentStreamEditor.ts tests/utils/contentStreamEditor.test.ts
git commit -m "fix(trueedit): refuse decoration-resize on q/Q stack underflow (F13)"
```

---

### Task 3: Byte offsets on tokens + ops, and `serializeOp` extraction

**Files:**
- Modify: `src/types/contentStream.ts` (`CsToken`, `CsOp`)
- Modify: `src/utils/contentStreamEditor.ts` (`tokenizeContentStream` + inner `tokenizeOne`; `groupOps`; extract `serializeOp`)
- Test: `tests/utils/contentStreamEditor.test.ts`

**Interfaces:**
- Produces: `CsToken.byteStart?/byteEnd?`, `CsOp.byteStart?/byteEnd?`, `export function serializeOp(op: CsOp): string`. Additive only — no behavior change to existing callers.

- [ ] **Step 1: Write the failing tests.**

```ts
describe('byte offsets + serializeOp', () => {
  it('tokens carry byteStart/byteEnd that slice back to their raw', () => {
    const src = '10 5 100 2 re f BT /F1 12 Tf (Hi) Tj ET';
    for (const t of tokenizeContentStream(src)) {
      expect(typeof t.byteStart).toBe('number');
      expect(src.slice(t.byteStart, t.byteEnd)).toBe(t.raw);
    }
  });
  it('ops carry a byte span covering operands + operator', () => {
    const src = '50 297 28 1.2 re f';
    const grouped = groupOps(tokenizeContentStream(src));
    const re = grouped.find(o => o.operator === 're');
    expect(re).toBeDefined();
    // span starts at the first operand and ends at the `re` operator
    expect(re!.byteStart).toBe(0);
    expect(src.slice(re!.byteStart, re!.byteEnd)).toBe('50 297 28 1.2 re');
  });
  it('serializeOp equals the per-op piece of serializeOps', () => {
    const grouped = groupOps(tokenizeContentStream('(Hi) Tj 1 0 0 1 5 5 cm'));
    expect(serializeOp(grouped[0])).toBe('(Hi) Tj');
    expect(serializeOp(grouped[1])).toBe('1 0 0 1 5 5 cm');
  });
  it('serializeOp round-trips an inline image verbatim', () => {
    const grouped = groupOps(tokenizeContentStream('BI /W 2 /H 2 ID \x00\x01\x02\x03 EI'));
    const img = grouped.find(o => o.operator === 'INLINE_IMAGE');
    expect(serializeOp(img!)).toBe(img!.operands[0].raw);
  });
});
```

(Replace `\x00…` with the actual escape in code; oxlint-clean.) Add `serializeOp` to the test import block.

- [ ] **Step 2: Run, verify FAIL** (`serializeOp` not exported; `byteStart` undefined).

- [ ] **Step 3a: Types.** In `src/types/contentStream.ts`:

```ts
export interface CsToken {
  …existing fields…
  /** Offset into the decoded source where this token begins (F3 byte-splice). */
  byteStart?: number;
  /** Offset just past this token's last byte in the decoded source (F3). */
  byteEnd?: number;
}

export interface CsOp {
  operator: string;
  operands: CsToken[];
  /** Byte span of the whole op (first operand → operator) in the original source (F3). */
  byteStart?: number;
  byteEnd?: number;
}
```

- [ ] **Step 3b: Stamp offsets in the tokenizer.** In `tokenizeContentStream`, every `tokens.push({...})` and inner `tokenizeOne` `return {...}` must include `byteStart` (the local `start`, or `i` before the consume for tokens that track it) and `byteEnd` (`i` after consuming). The cleanest mechanical change: wrap each push/return so the token object gets `byteStart`/`byteEnd`. Concretely:
  - comment (`:178`): `byteStart: start, byteEnd: i`.
  - string (`:183`): capture `const s = i; const raw = readLiteralString(); tokens.push({ type:'string', raw, byteStart: s, byteEnd: i });`.
  - dict (`:189`): `const s = i;` before `readUntilBalanced`, then `byteStart: s, byteEnd: i`.
  - hexstring (`:194`, and `:260`): `byteStart: start, byteEnd: i`.
  - array (`:212`): `const s` captured at the `[` (set `const arrStart = i;` before `i++`), `byteStart: arrStart, byteEnd: i`.
  - name (`:224`, `:266`): `byteStart: start, byteEnd: i`.
  - number (`:233`, `:273`): `byteStart: start, byteEnd: i`.
  - inline-image (`:245`): `byteStart: start, byteEnd: end`.
  - operator (`:248`): `byteStart: start, byteEnd: i`.
  - inner array string/operator returns in `tokenizeOne`: same pattern with a captured start.

- [ ] **Step 3c: Op span in `groupOps`.** Track the first operand's `byteStart`:

```ts
export function groupOps(tokens: CsToken[]): CsOp[] {
  const opsArr: CsOp[] = [];
  let operands: CsToken[] = [];
  let spanStart: number | undefined;
  for (const tok of tokens) {
    if (tok.type === 'operator') {
      opsArr.push({
        operator: tok.raw, operands,
        byteStart: operands.length ? spanStart : tok.byteStart,
        byteEnd: tok.byteEnd,
      });
      operands = []; spanStart = undefined;
    } else if (tok.type === 'inline-image') {
      opsArr.push({ operator: 'INLINE_IMAGE', operands: [tok], byteStart: tok.byteStart, byteEnd: tok.byteEnd });
      operands = []; spanStart = undefined;
    } else if (tok.type !== 'comment') {
      if (operands.length === 0) spanStart = tok.byteStart;
      operands.push(tok);
    }
  }
  return opsArr;
}
```

- [ ] **Step 3d: Extract `serializeOp`.**

```ts
/** Serialize a single grouped op back to a content-stream fragment. */
export function serializeOp(op: CsOp): string {
  return op.operator === 'INLINE_IMAGE'
    ? op.operands[0].raw
    : [...op.operands.map(t => t.raw), op.operator].join(' ');
}

/** Serialize a grouped ops list back to a content stream string. */
export function serializeOps(ops: CsOp[]): string {
  return ops.map(serializeOp).join('\n');
}
```

- [ ] **Step 4: Run, verify PASS.** Also run the FULL existing jsdom suite (`npm run test`) — `serializeOps` behavior is unchanged, so all existing tokenizer/round-trip tests must stay green.

- [ ] **Step 5: Full gate + commit.**

```bash
git add src/types/contentStream.ts src/utils/contentStreamEditor.ts tests/utils/contentStreamEditor.test.ts
git commit -m "refactor(trueedit): record token/op byte offsets + extract serializeOp"
```

---

### Task 4: `buildStreamContent` byte-splice + write-back rewrite

**Files:**
- Modify: `src/utils/contentStreamEditor.ts` (`EditTarget`, `findTarget`, `writeBack`, Path 3 in `replaceTextAt`, `addDecorationAt`; new `buildStreamContent`)
- Test: `tests/utils/contentStreamEditor.test.ts`

**Interfaces:**
- Consumes: `serializeOp`, `serializeOps`, `CsOp.byteStart/byteEnd` (Task 3).
- Produces: `export function buildStreamContent(found: EditTarget, appendedTail?: string): string`; `EditTarget` gains `source: string` and `origSerialized: string[]`.

- [ ] **Step 1: Write the failing tests** (pure builder, the heart of F3):

```ts
describe('buildStreamContent — hybrid byte-splice', () => {
  // Build a minimal EditTarget around a source string.
  function targetFor(src: string) {
    const opsArr = groupOps(tokenizeContentStream(src));
    return { ops: opsArr, target: {} as any, textOps: [], source: src, origSerialized: opsArr.map(serializeOp) };
  }

  it('splices a single changed op, leaving all other bytes verbatim (incl. an inline image)', () => {
    const src = 'BI /W 2 /H 2 ID  ÿþ EI\n(Hello) Tj';
    const t = targetFor(src);
    // mutate the Tj op only
    const tj = t.ops.find(o => o.operator === 'Tj')!;
    tj.operands[tj.operands.length - 1].raw = '(Hi)';
    const out = buildStreamContent(t, '');
    expect(out).toContain('BI /W 2 /H 2 ID  ÿþ EI'); // inline image byte-identical
    expect(out).toContain('(Hi) Tj');
    expect(out).not.toContain('(Hello)');
  });

  it('appends the Path-3 tail after the spliced op', () => {
    const src = '(Hello) Tj';
    const t = targetFor(src);
    const tj = t.ops[0];
    tj.operands[tj.operands.length - 1].raw = '()'; // blanked (Path 3)
    const out = buildStreamContent(t, '\nq BT /F1 12 Tf 1 0 0 1 5 5 Tm (Hi) Tj ET Q');
    expect(out.startsWith('() Tj')).toBe(true);
    expect(out).toContain('(Hi) Tj ET Q');
  });

  it('zero ops changed + a tail keeps the WHOLE source verbatim + appends', () => {
    const src = 'BI /W 1 /H 1 ID   EI\n(Hi) Tj';
    const t = targetFor(src);
    const out = buildStreamContent(t, '\n50 297 28 1.2 re f');
    expect(out).toBe(src + '\n50 297 28 1.2 re f');
  });

  it('falls back to serializeOps when TWO ops changed', () => {
    const src = '(Hello) Tj 50 297 28 1.2 re f';
    const t = targetFor(src);
    t.ops.find(o => o.operator === 'Tj')!.operands.at(-1)!.raw = '(Hi)';
    const re = t.ops.find(o => o.operator === 're')!;
    re.operands[2].raw = '12'; // decoration resize → 2nd changed op
    const out = buildStreamContent(t, '');
    expect(out).toBe(serializeOps(t.ops)); // fallback path
  });

  it('falls back when the changed op has no byte span', () => {
    const src = '(Hello) Tj';
    const t = targetFor(src);
    const tj = t.ops[0];
    tj.byteStart = undefined; tj.byteEnd = undefined;
    tj.operands.at(-1)!.raw = '(Hi)';
    expect(buildStreamContent(t, '')).toBe(serializeOps(t.ops));
  });
});
```

> `.at(-1)!` uses `!` — replace with a non-null-safe access to satisfy oxlint, e.g. `tj.operands[tj.operands.length - 1]`.

- [ ] **Step 2: Run, verify FAIL** (`buildStreamContent` not exported).

- [ ] **Step 3a: `EditTarget` + `findTarget` snapshot.** Extend the interface (`:1055`) with `source: string; origSerialized: string[];`. In `findTarget`, when returning the page-stream target, set `source: pageContent, origSerialized: pageOps.map(serializeOp)`; for the XObject branch set `source: xContent` (the matched XObject's content) and `origSerialized: <that ops>.map(serializeOp)`. The snapshot is captured pre-mutation (findTarget returns before any edit).

- [ ] **Step 3b: `buildStreamContent`.**

```ts
/**
 * Compute the new content stream for a write-back. Hybrid byte-splice (F3):
 *  - exactly ONE op changed (vs the pre-mutation snapshot) with a valid byte span →
 *    splice that op's bytes in the ORIGINAL source, keep every other byte verbatim;
 *  - ZERO ops changed but an appended tail (addDecorationAt) → keep source verbatim;
 *  - otherwise → today's full re-serialize (`serializeOps`), zero regression.
 * `appendedTail` (the Path-3 redraw / decoration block) is always concatenated last.
 */
export function buildStreamContent(found: EditTarget, appendedTail = ''): string {
  const { ops: opsArr, source, origSerialized } = found;
  const changed: number[] = [];
  for (let k = 0; k < opsArr.length; k++) {
    if (serializeOp(opsArr[k]) !== origSerialized[k]) changed.push(k);
  }
  if (changed.length === 1) {
    const op = opsArr[changed[0]];
    if (
      typeof op.byteStart === 'number' && typeof op.byteEnd === 'number' &&
      op.byteStart >= 0 && op.byteEnd <= source.length && op.byteStart <= op.byteEnd
    ) {
      return source.slice(0, op.byteStart) + serializeOp(op) + source.slice(op.byteEnd) + appendedTail;
    }
  }
  if (changed.length === 0 && appendedTail) return source + appendedTail;
  return serializeOps(opsArr) + appendedTail;
}
```

- [ ] **Step 3c: Rewrite `writeBack`** to use the builder:

```ts
function writeBack(doc: PDFDocument, pageIndex: number, found: EditTarget): void {
  const content = buildStreamContent(found, '');
  if (found.xObjectName) setFormXObjectContent(doc, pageIndex, found.xObjectName, content);
  else setPageContent(doc, pageIndex, content);
}
```

- [ ] **Step 3d: Route Path 3** (`replaceTextAt:1970`). Replace `setPageContent(doc, pageIndex, serializeOps(ops) + redraw);` with:

```ts
  setPageContent(doc, pageIndex, buildStreamContent(found, '\n' + redraw));
```

(Path 3 is page-stream only — the XObject branch already refused at `:1907`. Keep the leading `\n` so the appended redraw starts on its own line, matching today's `serializeOps` join.)

- [ ] **Step 3e: Route `addDecorationAt`** (`:1796`). Replace the `const content = serializeOps(ops) + block;` block with:

```ts
  const content = buildStreamContent(found, '\n' + block);
  if (found.xObjectName) setFormXObjectContent(doc, pageIndex, found.xObjectName, content);
  else setPageContent(doc, pageIndex, content);
```

(`addDecorationAt` mutates no op → fast path B keeps the source verbatim + appends the decoration.)

- [ ] **Step 4: Run, verify PASS.** Then run the **full** `npm run test` — every existing `replaceTextAt`/`deleteTextAt`/decoration/restyle/sequential-edit jsdom test must stay green (the fallback guarantees byte-identical output for multi-op edits; single-op edits now splice but yield equivalent visible content).

- [ ] **Step 5: Full gate + commit.**

```bash
git add src/utils/contentStreamEditor.ts tests/utils/contentStreamEditor.test.ts
git commit -m "feat(trueedit): hybrid byte-splice write-back preserves non-edited bytes (F3)"
```

---

### Task 5: Real-Chrome inline-image byte-preservation guard

**Files:**
- Create: `tests/browser/trueedit-bytesplice.browser.test.ts`

**Interfaces:**
- Consumes: public `replaceTextAt`; real pdf.js render + a real `@cantoo/pdf-lib` doc containing an inline image.

- [ ] **Step 1: Write the test.** A page whose content stream contains a **BI…ID…EI inline image** plus a standard-font word; edit the word and assert (a) the edit succeeded, (b) the inline-image bytes appear **byte-identical** in the rewritten stream, and (c) the page still renders without console errors. Mirror the construction in existing `tests/browser/trueedit-*.browser.test.ts` files (real Chrome via `vitest.browser.config.ts`).

```ts
import { describe, it, expect } from 'vitest';
import { PDFDocument, PDFName, PDFDict, PDFRawStream, decodePDFRawStream, StandardFonts } from '@cantoo/pdf-lib';
import { replaceTextAt } from '../../src/utils/contentStreamEditor';

function readPageContent(doc: PDFDocument): string {
  const page = doc.getPage(0);
  const stream = doc.context.lookup(page.node.get(PDFName.of('Contents'))) as PDFRawStream;
  const bytes = decodePDFRawStream(stream).decode();
  let s = ''; for (const b of bytes) s += String.fromCharCode(b); return s;
}

describe('F3 byte-splice — inline image survives a true edit byte-identical', () => {
  it('edits a word while leaving the BI…EI inline image untouched', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([200, 200]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    page.drawText('seed', { x: 0, y: 0, size: 1, font });
    const ctx = doc.context;
    const res = ctx.lookup(page.node.get(PDFName.of('Resources'))) as PDFDict;
    const fontDict = ctx.lookup(res.get(PDFName.of('Font'))) as PDFDict;
    fontDict.set(PDFName.of('F1'), fontDict.get([...fontDict.entries()][0][0])!);
    // A real inline image (4 bytes of binary incl. the literal pair 'E','I') + a word.
    const IMG = 'BI /W 2 /H 2 /CS /G /BPC 8 ID EI EI';
    const content = `q 1 0 0 1 10 180 cm ${IMG} Q\nBT /F1 12 Tf 1 0 0 1 20 100 Tm (Hello) Tj ET`;
    const cb = new Uint8Array(content.length);
    for (let i = 0; i < content.length; i++) cb[i] = content.charCodeAt(i) & 0xff;
    page.node.set(PDFName.of('Contents'), ctx.register(ctx.stream(cb)));
    const bytes = await doc.save();

    const live = await PDFDocument.load(bytes);
    const r = await replaceTextAt(live, 0, { x: 20, y: 100 }, 'Hi', 6);
    expect(r).not.toBe(false);
    const after = readPageContent(live);
    expect(after).toContain(IMG);       // inline image byte-identical (fast-path splice)
    expect(after).toContain('(Hi) Tj');
    expect(after).not.toContain('(Hello)');
  });
});
```

> `!` on `fontDict.get(...)!` — refactor to a guarded const to satisfy oxlint, as in `makeUnderlinedTextPdf`.

- [ ] **Step 2: Run the browser test, verify it PASSES** (the splice keeps the inline image verbatim; without Task 4 it would re-serialize and could alter the binary). Run: `node_modules/.bin/vitest run --config vitest.browser.config.ts tests/browser/trueedit-bytesplice.browser.test.ts --reporter=dot > /tmp/.../t5.log 2>&1; tail -40 /tmp/.../t5.log`.

- [ ] **Step 3: Full gate + commit.** Run the complete gate (`npm run type-check && npm run lint && npm run test && npm run test:browser && npm run build`) and paste output.

```bash
git add tests/browser/trueedit-bytesplice.browser.test.ts
git commit -m "test(trueedit): real-Chrome guard — inline image survives byte-splice edit"
```

---

## Post-implementation

- Update `CLAUDE.md` "True text editing engine" gotcha with one line: F10/F13 refuse decoration-resize for tilted text / q/Q underflow; F3 write-back now byte-splices the single changed op (inline images/binary preserved verbatim) and falls back to `serializeOps` otherwise.
- Update memory: the F3/F4 "tokenizer imperfection corrupts the page" bound is now closed for the common single-op edit; F12 multi-stream remains a documented bound.
- Final Completion-Gate evidence table (Coverage / Docs / Config / Blast radius) before Phase 8.
- **Do not push** — report commits and stop (push is manual).

## Self-Review (writing-plans)

- **Spec coverage:** F10 (Task 1), F13 (Tasks 2), F3 byte-splice incl. addDecorationAt fast-path B (Tasks 3–4), inline-image guard (Task 5), full-gate every task (global constraint). ✓
- **Placeholders:** none — every step has concrete test + impl code; the only deferrals are oxlint `!`-refactor notes (explicit) and the `getPageContentForTest` helper (reuse-or-add note). ✓
- **Type consistency:** `serializeOp`, `buildStreamContent`, `ctmStackUnderflows`, `EditTarget.source/origSerialized`, `CsToken/CsOp.byteStart/byteEnd` are defined in Task 3/4 before use; F10 uses the existing `tilted`; F13 helper defined in Task 2 before its gate. ✓
