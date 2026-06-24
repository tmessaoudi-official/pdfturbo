# True-edit F10 + F13 + F3 hybrid byte-splice — Design

**Date:** 2026-06-24
**Status:** Approved design (recorded `8296bb2` in `docs/plans/option3-features-2026-06-23.plan.md`); this is the formal spec.
**Audit basis:** `docs/reviews/2026-06-20-trueedit-edgecase-audit.md`
**Feature flag:** none — all three are defensive correctness changes inside the existing true-edit engine (no new UI, no new seam).

## Goal

Close the three remaining actionable true-edit edge cases from the F5–F16 audit:

- **F10** — a sheared/rotated/non-uniformly-scaled text matrix (`Tm`) inflates the
  derived font size and mis-places an axis-aligned decoration rule → **refuse the
  decoration-resize** for such runs (the text edit itself still proceeds).
- **F13** — a `q`/`Q` graphics-state stack underflow (a `Q` with no matching `q`)
  silently leaves the CTM stale, so any CTM-dependent decoration geometry on that
  page is unreliable → **refuse the decoration-resize** for the page.
- **F3** — the write-back currently **re-serializes the entire content stream**
  (`serializeOps`), so any tokenizer imperfection (binary in an inline image,
  unusual whitespace) round-trips through a normalizer and can corrupt bytes far
  from the edit. Replace it with a **hybrid byte-splice**: for the common
  single-op edit, splice only the changed op's byte range into the original
  decoded source and leave every other byte verbatim; fall back to today's
  `serializeOps` for anything more complex (zero regression).

All three are **defensive**: the worst case is "leave the PDF unchanged / fall
back to current behavior," never "produce a wrong edit."

## Non-goals (documented bounds, unchanged by this work)

- **F12 multi-stream preservation** stays a documented bound — an edit that
  touches a Form XObject still writes that one stream via the fallback path. The
  byte-splice preserves *non-edited* bytes of the *edited* stream.
- **F11 / F14 / F15 / F16** are already resolved (WON'T-FIX / DONE / fail-safe
  ACCEPTED per the audit) — out of scope.
- The cm-rotation Path-3 redraw ceiling (axis-aligned flatten) is unchanged; F10
  only governs the *decoration-resize refusal*, which already had sibling gates
  (F5 mirror, F6 text-rise).

---

## Architecture

### Current write-back (the F3 problem)

`writeBack(doc, pageIndex, found)` (`contentStreamEditor.ts:1064`) does:

```ts
const content = serializeOps(found.ops);   // FULL re-serialize of every op
setPageContent(doc, pageIndex, content);    // (or setFormXObjectContent)
```

`serializeOps` (`:309`) joins each op as `operands.join(' ') + ' ' + operator`,
ops joined by `\n`. INLINE_IMAGE ops emit `operands[0].raw` verbatim — but the
**surrounding** whitespace, comments, and any byte the tokenizer mis-modeled are
normalized away. The audit calls this "any tokenizer imperfection corrupts the
whole page," currently latent because the round-trip happens to be lossless for
bytes 0–255.

Path 1 (`:1871`) and Path 2 (`:1886`) mutate **one** show op in place then call
`writeBack`. Path 3 (`:1970`) blanks the target op in place and calls
`setPageContent(serializeOps(ops) + redraw)` directly (the redraw is an **appended
string**, not an added op — the ops array length is unchanged). `deleteTextAt`,
`changeSizeAt`, `changeColorAt` likewise mutate ops in place. **In every path the
ops array keeps the same length** — edits are in-place token mutations plus an
optional appended redraw string.

### F3 hybrid byte-splice

**Token byte offsets.** The tokenizer already computes `start` and `i` for every
`src.slice(start, i)`. Record them:

```ts
// types/contentStream.ts
export interface CsToken {
  …existing…
  byteStart?: number;  // offset into the decoded source where this token begins
  byteEnd?: number;    // offset just past the token's last byte
}
```

Set `byteStart`/`byteEnd` on every `tokens.push(...)` / `return {...}` in
`tokenizeContentStream` (and its inner `tokenizeOne`). Offsets are into the
**decoded** content string passed to the tokenizer.

**Op byte span.** `groupOps` records each op's span in the original source:

```ts
// types/contentStream.ts — CsOp
  byteStart?: number;  // first member token's byteStart (operator's if no operands)
  byteEnd?: number;    // operator token's byteEnd (inline-image token's for INLINE_IMAGE)
```

`groupOps` (`:291`) tracks the first operand's `byteStart` as operands accumulate
and stamps `byteStart`/`byteEnd` when it pushes the op.

**Single-op serializer.** Extract `serializeOp(op): string` (the per-op body of
`serializeOps`) and have `serializeOps` map it. Both the snapshot and the diff use
`serializeOp`, so an unchanged op compares equal.

**Snapshot + diff write-back.** `findTarget` already holds the original decoded
`pageContent` (and per-XObject `xContent`). Thread it onto `EditTarget`:

```ts
interface EditTarget {
  ops: CsOp[];
  target: TextOpInfo;
  textOps: TextOpInfo[];
  xObjectName?: string;
  source: string;                 // the ORIGINAL decoded stream the ops came from
  origSerialized: string[];       // serializeOp(op) for each op, captured pre-mutation
}
```

`findTarget` sets `source` = `pageContent` (or `xContent` for the XObject branch)
and `origSerialized` = `ops.map(serializeOp)` **before returning** (ops are
unmutated at that point).

New `writeBackSpliced(doc, pageIndex, found, appendedTail = '')`:

```ts
function buildStreamContent(found: EditTarget, appendedTail: string): string {
  const { ops, source, origSerialized } = found;
  // Diff: which op indices changed?
  const changed: number[] = [];
  for (let k = 0; k < ops.length; k++) {
    if (serializeOp(ops[k]) !== origSerialized[k]) changed.push(k);
  }
  // Fast path A: exactly ONE op changed AND it carries a valid byte span → splice
  // that op's bytes in the original source, keep every other byte verbatim, append.
  if (changed.length === 1) {
    const op = ops[changed[0]];
    if (
      typeof op.byteStart === 'number' && typeof op.byteEnd === 'number' &&
      op.byteStart >= 0 && op.byteEnd <= source.length && op.byteStart <= op.byteEnd
    ) {
      return source.slice(0, op.byteStart) + serializeOp(op) + source.slice(op.byteEnd) + appendedTail;
    }
  }
  // Fast path B: NO op changed but there IS an appended tail (addDecorationAt appends a
  // standalone decoration without mutating any op) → keep the WHOLE source verbatim +
  // append. Trivially byte-safe (nothing in the source is touched).
  if (changed.length === 0 && appendedTail) {
    return source + appendedTail;
  }
  // Fallback: today's full re-serialize (zero behavioral regression).
  return serializeOps(ops) + appendedTail;
}
```

`writeBack` becomes a thin wrapper that computes the content via
`buildStreamContent(found, '')` then `setPageContent`/`setFormXObjectContent`
(covers `deleteTextAt`, `changeSizeAt`, `changeColorAt`, Path 1, Path 2). Path 3
(`:1970`) routes through the same builder with `appendedTail = redraw` instead of
`setPageContent(serializeOps(ops) + redraw)`. `addDecorationAt` (`:1797`) routes
through it with `appendedTail = block` (its zero-op-change append takes fast path B).

**Why this is safe.** The fallback is byte-for-byte today's behavior. The
fast-path only triggers when **exactly one op changed** — i.e. a clean Path-1/Path-2
edit (or a blanked Path-3 op, or a single `changeColor`/`changeSize` operand
rewrite) with **no** shadow-duplicate blanking and **no** decoration-resize (both
of which mutate a *second* op → `changed.length > 1` → fallback). In the
fast-path, every byte outside the one op — including inline images and binary —
is preserved verbatim.

**Append-at-end invariant.** Path 3's redraw is always appended at the very end of
the stream (it is today). `appendedTail` preserves that; the spliced op is the
in-place blanked original. No mid-stream insertion is ever produced by the
fast-path, so byte order outside the single op is untouched.

### F10 — refuse decoration-resize for tilted text

`TextOpInfo.tilted` (`types/contentStream.ts:78`) is **already set** by
`locateTextOps` (`:516–519`) precisely when the combined `textMatrix × CTM` is
rotated, sheared, or non-uniformly scaled beyond the `Tz` horizontal scale —
exactly F10's condition (it captures both `Tm` shear/rotation **and** CTM
rotation). `addDecorationAt` already refuses on it (`:1752`).

F10 adds the sibling gate to **`prepareDecorationResize`** (`:2030`), next to the
F6 text-rise gate (`:2043`):

```ts
  if (target.textRise) return null;
  if (target.tilted) return null;   // F10: tilted Tm/CTM → baseline+size unreliable
```

No new flag (`tmTilted` is **not** added — reusing the existing, already-tested
`tilted` is strictly simpler and the condition is identical). This is a
refinement explicitly permitted by the approved design ("evaluate reusing the
existing `TextOpInfo.tilted` flag vs adding `tmTilted`").

### F13 — refuse decoration-resize on q/Q underflow

Both CTM walks (`locateTextOps:391`, `locateDecorationRects:588`) do
`const saved = ctmStack.pop(); if (saved) ctm = saved;` — a `Q` with an empty
stack is silently ignored, leaving the CTM stale and every later decoration's
user-space geometry unreliable.

New pure helper:

```ts
/** True if any `Q` operator pops an empty graphics-state stack (unbalanced q/Q).
 *  When true, CTM-dependent decoration geometry on the stream is unreliable. */
export function ctmStackUnderflows(ops: CsOp[]): boolean {
  let depth = 0;
  for (const op of ops) {
    if (op.operator === 'q') depth++;
    else if (op.operator === 'Q') { if (depth === 0) return true; depth--; }
  }
  return false;
}
```

`prepareDecorationResize` gates on it (the decoration-resize is the only
CTM-dependent geometry; the text edit itself does not depend on the CTM stack
balance):

```ts
  if (locateDecorationRects(ops).length === 0) return null;
  if (ctmStackUnderflows(ops)) return null;   // F13: stale CTM → geometry unreliable
  if (target.textRise) return null;
  if (target.tilted) return null;             // F10
```

---

## Data flow

```
edit-text tool → replaceTextAt / deleteTextAt / changeSizeAt / changeColorAt
   findTarget  → EditTarget { ops, target, source, origSerialized, … }   (snapshot here)
   prepareDecorationResize → null if (no rules | underflow | textRise | tilted)   [F13, F10]
   Path 1/2: mutate one op → writeBack → buildStreamContent('')      [F3 splice or fallback]
   Path 3:   blank op + build redraw → buildStreamContent(redraw)    [F3 splice or fallback]
   delete:   blank op (+ neutralize painter) → writeBack            [F3 fallback when 2 ops]
```

## Error handling

- Missing/invalid byte span on the changed op → automatic fallback to
  `serializeOps` (the span fields are optional; absence is safe).
- `changed.length === 0` (no op changed, no tail) → builder returns the
  fallback `serializeOps(ops)` which equals `source` round-tripped — a no-op
  write; callers already guard the genuinely-empty case.
- All existing refusal paths in `replaceTextAt` (Type3, invisible, vertical,
  XObject, Arabic, non-WinAnsi, F9 embed-throw) are untouched.

## Testing strategy

TDD, tests **executed** (runner output pasted), one commit per task. The gate for
**every** task runs the FULL suite — `npm run type-check && npm run lint &&
npm run test` **plus** `npm run test:browser` **plus** `npm run build` (the CI-red
lesson: a shared-surface change must pass the real-Chrome suite and the build).

- **F3 unit (jsdom, `tests/utils/contentStreamEditor.test.ts`)**:
  - tokenizer stamps `byteStart`/`byteEnd`; `source.slice(byteStart,byteEnd)`
    re-yields each token's `raw`.
  - `groupOps` stamps op spans; `source.slice(op.byteStart,op.byteEnd)` covers
    the op's operands+operator.
  - `serializeOp` ≡ the per-op slice of `serializeOps`.
  - `buildStreamContent`: a one-op edit splices (asserts bytes outside the op are
    identical to source, incl. a synthetic **inline-image / binary** byte run that
    survives byte-identical through a one-word edit); a two-op change (decoration
    resize or shadow blank) falls back to `serializeOps`.
  - `ctmStackUnderflows`: balanced → false; an extra `Q` → true; nested → false.
- **F10/F13 unit**: `prepareDecorationResize` returns `null` (no-op mutator) for a
  tilted target and for a stream with q/Q underflow; a plain upright target with a
  matching rule still returns a working mutator (no regression).
- **Browser (`tests/browser/`, real Chrome)**: a real PDF whose page contains an
  inline image survives a one-word true-edit byte-identical outside the edited run
  (pixel + structural check); the existing true-edit decoration/restyle browser
  guards still pass.

## File touch points (from the audit + code read)

- `src/types/contentStream.ts` — `byteStart`/`byteEnd` on `CsToken` and `CsOp`.
- `src/utils/contentStreamEditor.ts` — tokenizer offset stamping; `groupOps`
  span; extract `serializeOp`; `ctmStackUnderflows`; `EditTarget` snapshot in
  `findTarget`; `buildStreamContent` + `writeBack` rewrite; Path-3 (`:1970`) and
  `addDecorationAt` (`:1797`) routed through the builder; F10 + F13 gates in
  `prepareDecorationResize`.
- Tests: `tests/utils/contentStreamEditor.test.ts` (+ a browser inline-image
  round-trip guard).

## Risk / blast radius

`contentStreamEditor.ts` is the shared true-edit engine used by the edit-text
tool, decoration add/resize, size/color change, and delete. The byte-splice
changes the write-back for **all** of them — but the fallback guarantees that any
edit not matching the single-op fast-path produces byte-identical output to today.
The full `test:browser` suite (true-edit, decoration, restyle, sequential-edit,
spot-color, underline-resize) is the regression net; the build step catches type
drift in the shared types.
