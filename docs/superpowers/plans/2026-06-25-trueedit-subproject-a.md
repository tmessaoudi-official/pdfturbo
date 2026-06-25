# Sub-project A — True-edit fidelity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Raise the true in-place PDF text-edit engine toward maximum reachable fidelity (transparent text, transformed text, XObject text, outline stroke style) without regressing any existing edit.

**Architecture:** All work is gated/additive in `src/utils/contentStreamEditor.ts` (+ two handler-gate relaxations in `src/handlers/textEditHandler.ts`). New `TextOpInfo`/`buildPath3Redraw` fields are OPTIONAL → absent ⇒ today's exact bytes. The engine's refuse→overlay contract is preserved everywhere.

**Tech Stack:** TypeScript, `@cantoo/pdf-lib` (content-stream surgery, font/ExtGState embedding), pdf.js (real-Chrome verification), vitest (jsdom + `@vitest/browser` real Chrome).

Spec: `docs/superpowers/specs/2026-06-25-trueedit-subproject-a-design.md`.

## Global Constraints

- **Byte-identical-when-inactive is REQUIRED per task** — the first test of every task is a control proving an edit that does NOT hit the new branch produces identical output to before.
- **No new runtime dependency.** Client-side only (GRDF: no network, no upload).
- **Never paint a wrong glyph or over a scan** — every new path keeps the existing refuse→overlay gates (Type3 / `Tr` 3·7 / vertical / Arabic / non-WinAnsi).
- New `TextOpInfo` / `EditTarget` / `buildPath3Redraw` fields are OPTIONAL; emit new operators ONLY when the captured value is non-default.
- **oxlint:** no non-null assertions (`!`) — use `if (!x) throw` / `?? fallback`; unused args/vars must be `_`-prefixed.
- **Pre-commit (every task):** `npm run type-check && npm run lint && npm run test` (jsdom). **Tasks with a `*.browser.test.ts`:** also `npm run test:browser`. **Before any push (not per task):** the full deploy gate `npm audit --audit-level=high && npm run ocr:assets && npm run type-check && npm run lint && npm run test && npm run test:browser && npm run test:coverage:export && npm run build`.
- **Commits:** `feat(trueedit): …` / `fix(trueedit): …`, imperative subject, NO `Co-Authored-By` trailer. Commit per task. **Do not push** (manual).
- Build order is fixed: **A2 → A3a → A1 → A3b → A6a → A6b → A6c**.

Verified anchors (current line numbers): `locateTextOps` `:389-562` (`trm`=`:531`, `vScale`=`:526`, `fontSize=fontSize*vScale`=`:544`, push block `:539-557`); `buildPath3Redraw` `:2074-2106` (identity Tm `:2103`); `replaceTextAt` refuse gates `:1917`, Path 1 `:1952`, Path 2 `:1961`, Path 3 `:2008-2055` (font/size/encode `:2022-2033`); `getEditableTextAt` XObject null `:1331`; handler hit gate `textEditHandler.ts:263` (`!hit.inXObject`); `addPageFontResource` `:2431-2454`; `EditTarget` `:1091`; `writeBack`→`setFormXObjectContent` `:1132-1135`.

---

### Task A2: Path-3 alpha (`ca`/`CA`) preservation

Semi-transparent text (watermark/faded) currently redraws fully opaque because `locateTextOps` ignores ExtGState alpha. Capture the active fill/stroke alpha and, when `< 1`, embed an ExtGState resource and emit `/<GSx> gs` inside the Path-3 `q…Q` block.

**Files:**
- Modify: `src/utils/contentStreamEditor.ts` (`locateTextOps` capture; new `addPageExtGStateResource`; `buildPath3Redraw` `gsName`; Path-3 block wires it)
- Test: `tests/utils/contentStreamEditor.test.ts` (extend)
- Test: `tests/browser/trueedit-alpha.browser.test.ts` (create)

**Interfaces:**
- Produces: `TextOpInfo.fillAlpha?: number` / `strokeAlpha?: number` (set only when `< 1`); `addPageExtGStateResource(doc: PDFDocument, pageIndex: number, alpha: { ca?: number; CA?: number }): string` (returns the resource name, e.g. `GSAlpha0`); `buildPath3Redraw` gains `gsName?: string` (emits `/<gsName> gs` first in the state block).
- Consumes: existing `locateTextOps` graphics-state tracking; `addPageFontResource` pattern (`:2431`).

- [ ] **Step 1: Write the failing unit test — `buildPath3Redraw` emits `gs` only when `gsName` is set**

In `tests/utils/contentStreamEditor.test.ts` add:

```ts
import { buildPath3Redraw } from '../../src/utils/contentStreamEditor';

describe('buildPath3Redraw — alpha (A2)', () => {
  const base = { resName: 'F0', size: 12, color: { r: 0, g: 0, b: 0 }, originX: 10, originY: 20, showOperand: '(hi)' };
  it('omits a gs operator when no gsName is given (byte-identical)', () => {
    expect(buildPath3Redraw(base)).not.toContain(' gs');
  });
  it('emits /GSx gs as the first state line when gsName is set', () => {
    const out = buildPath3Redraw({ ...base, gsName: 'GSAlpha0' });
    expect(out).toContain('/GSAlpha0 gs');
    // gs precedes the Tf so alpha is active for the draw
    expect(out.indexOf('/GSAlpha0 gs')).toBeLessThan(out.indexOf(' Tj'));
  });
});
```

- [ ] **Step 2: Run it — verify the second test fails**

Run: `npx vitest run tests/utils/contentStreamEditor.test.ts -t "alpha (A2)"`
Expected: the `gsName` test FAILs (`buildPath3Redraw` has no `gsName` param yet).

- [ ] **Step 3: Extend `buildPath3Redraw` with `gsName`**

In the `buildPath3Redraw` param type (`:2074`) add `gsName?: string;`. In the `state` string (`:2091`) prepend as the FIRST line:

```ts
  const state =
    (p.gsName ? `/${p.gsName} gs\n` : '') +
    (p.charSpacing !== undefined ? `${fmtNum(p.charSpacing)} Tc\n` : '') +
    // …unchanged…
```

- [ ] **Step 4: Run the unit test — passes**

Run: `npx vitest run tests/utils/contentStreamEditor.test.ts -t "alpha (A2)"`
Expected: PASS (both).

- [ ] **Step 5: Write `addPageExtGStateResource` (mirror `addPageFontResource`)**

Add near `addPageFontResource` (`:2431`):

```ts
/** Add (or reuse) a page /ExtGState resource holding fill/stroke alpha; returns its name. */
function addPageExtGStateResource(doc: PDFDocument, pageIndex: number, alpha: { ca?: number; CA?: number }): string {
  const node = doc.getPage(pageIndex).node;
  const resources = node.get(PDFName.of('Resources'));
  let resDict: PDFDict;
  if (resources) {
    resDict = doc.context.lookup(resources) as PDFDict;
  } else {
    resDict = PDFDict.fromMapWithContext(new Map(), doc.context);
    node.set(PDFName.of('Resources'), resDict);
  }
  const egRaw = resDict.get(PDFName.of('ExtGState'));
  let egDict: PDFDict;
  if (egRaw) {
    egDict = doc.context.lookup(egRaw) as PDFDict;
  } else {
    egDict = PDFDict.fromMapWithContext(new Map(), doc.context);
    resDict.set(PDFName.of('ExtGState'), egDict);
  }
  let i = 0;
  let name = `GSAlpha${i}`;
  while (egDict.get(PDFName.of(name))) name = `GSAlpha${++i}`;
  const gs = PDFDict.fromMapWithContext(new Map(), doc.context);
  if (alpha.ca !== undefined) gs.set(PDFName.of('ca'), doc.context.obj(alpha.ca));
  if (alpha.CA !== undefined) gs.set(PDFName.of('CA'), doc.context.obj(alpha.CA));
  egDict.set(PDFName.of(name), gs);
  return name;
}
```

- [ ] **Step 6: Write the failing unit test — alpha capture in `locateTextOps`**

```ts
import { locateTextOps } from '../../src/utils/contentStreamEditor';
// build a minimal CsOp[] (reuse the file's existing tokenize/groupOps test helpers)
// stream: "/GS0 gs /F0 12 Tf (hi) Tj" where ExtGState GS0 has ca 0.4 — assert
// the returned text op carries fillAlpha 0.4. Use the same op-construction helper
// the existing locateTextOps tests use (search the test file for "locateTextOps(").
```

Find the existing `locateTextOps` test helper in `tests/utils/contentStreamEditor.test.ts` (search `locateTextOps(`) and follow its op-construction style; assert `op.fillAlpha === 0.4`. Note: alpha lives in the page ExtGState dict, so this test needs a `PDFDocument` with that resource — model it on the existing `getPageFontGlyphWidths`/`isByteSwapUnsafeFont` tests that build a doc.

- [ ] **Step 7: Run it — verify FAIL** (`fillAlpha` undefined). Run: `npx vitest run tests/utils/contentStreamEditor.test.ts -t "alpha"`

- [ ] **Step 8: Capture alpha in `locateTextOps`**

`locateTextOps` already iterates ops with a `doc`/`pageIndex` in scope for resource lookup (it resolves fonts). Track `fillAlpha`/`strokeAlpha` (default 1). On a `gs` operator, look up the named ExtGState in the page Resources and read `/ca`,`/CA`:

```ts
// near the other graphics-state locals at the top of the ops.forEach
let fillAlpha = 1, strokeAlpha = 1;
// …inside the forEach, add a branch:
if (op.operator === 'gs') {
  const egName = op.operands[0]?.raw?.replace(/^\//, '') ?? '';
  const a = lookupExtGStateAlpha(doc, pageIndex, egName); // small local helper using doc.context.lookup
  if (a.ca !== undefined) fillAlpha = a.ca;
  if (a.CA !== undefined) strokeAlpha = a.CA;
}
```

Add `lookupExtGStateAlpha(doc, pageIndex, name)` (try/catch → `{}`; mirror `getPageFontDescriptor`'s lookup chain Resources→ExtGState→name→`ca`/`CA` `.value()`). In the push block (`:549-556`) add: `...(fillAlpha < 1 ? { fillAlpha } : {}), ...(strokeAlpha < 1 ? { strokeAlpha } : {}),`. Add `fillAlpha?`/`strokeAlpha?` to the `TextOpInfo` type. **Note:** if `locateTextOps` does not currently receive `doc`/`pageIndex`, thread them through (its callers — `findTarget`/`replaceTextAt` — already have both); keep the signature change internal.

- [ ] **Step 9: Wire alpha into the Path-3 redraw**

In the Path-3 block (`:2034`), before building the redraw:

```ts
const gsName = (target.fillAlpha !== undefined || target.strokeAlpha !== undefined)
  ? addPageExtGStateResource(doc, pageIndex, { ca: target.fillAlpha, CA: target.strokeAlpha })
  : undefined;
redraw = buildPath3Redraw({ /* …existing… */, gsName });
```

- [ ] **Step 10: Run unit tests — pass.** Run: `npx vitest run tests/utils/contentStreamEditor.test.ts`. Expected: all PASS.

- [ ] **Step 11: Write the browser test** `tests/browser/trueedit-alpha.browser.test.ts`

Model on `tests/browser/truedit-spot-color.browser.test.ts`: build a PDF whose text is drawn under a `ca 0.3` ExtGState in a CID/subset font (forces Path 3 via a Helvetica-needing edit), true-edit a word, re-render with pdf.js to a canvas, and assert the redrawn glyph pixels are LIGHTER than a fully-opaque control edit (alpha preserved). Include an opaque control that stays dark.

- [ ] **Step 12: Run the browser test — pass.** Run: `npx vitest run --config vitest.browser.config.ts tests/browser/trueedit-alpha.browser.test.ts`

- [ ] **Step 13: Pre-commit gate + commit**

Run: `npm run type-check && npm run lint && npm run test && npx vitest run --config vitest.browser.config.ts tests/browser/trueedit-alpha.browser.test.ts`
Then:
```bash
git add src/utils/contentStreamEditor.ts tests/utils/contentStreamEditor.test.ts tests/browser/trueedit-alpha.browser.test.ts
git commit -m "feat(trueedit): preserve ca/CA alpha on Path-3 redraw (Sub-project A / A2)"
```

---

### Task A3a: XObject Path-1/2 in-place true-edit

Form-XObject text refuses → overlay even for Path-1/2-safe edits, only because of two handler gates; the engine write-back for XObjects already ships. Relax the gates for the Path-1/2 case; keep Path-3-in-XObject refused (A3b).

**Files:**
- Modify: `src/utils/contentStreamEditor.ts` (`getEditableTextAt` `:1331`)
- Modify: `src/handlers/textEditHandler.ts` (`:263` hit gate)
- Test: `tests/utils/contentStreamEditor.test.ts`, `tests/handlers/textEditHandler.test.ts`
- Test: `tests/browser/trueedit-xobject.browser.test.ts` (create)

**Interfaces:**
- Consumes: `findTarget` (already recurses into XObjects, flags `inXObject`/`xObjectName`), `replaceTextAt` Path 1/2 (already call `writeBack`→`setFormXObjectContent`).
- Produces: `getEditableTextAt` returns prefill text for a Path-1/2-safe XObject target (null only for Path-3-in-XObject); a helper `isPath3OnlyTarget(doc, pageIndex, target): boolean` (true when neither Path 1 (standard font, ASCII) nor Path 2 (ToUnicode subset reuse) can apply).

- [ ] **Step 1: Write the failing unit test — `getEditableTextAt` returns prefill for a Path-1/2 XObject target**

In `tests/utils/contentStreamEditor.test.ts`, build a `PDFDocument` with editable text in a Form XObject using a STANDARD font (Path-1 safe). Model the XObject construction on the existing XObject tests (search `inXObject`/`xObjectName` in the test file). Assert `getEditableTextAt(doc, 0, clickOrigin, tol)` returns the op's decoded text (not null). Add a second case: a CID/Path-3-only XObject target → still null.

- [ ] **Step 2: Run it — verify FAIL** (currently returns null for ALL XObject targets). Run: `npx vitest run tests/utils/contentStreamEditor.test.ts -t "getEditableTextAt"`

- [ ] **Step 3: Add `isPath3OnlyTarget` and relax `getEditableTextAt`**

Add a predicate (reuses existing helpers):

```ts
/** True when an edit at this target could only go through Path 3 (standard-font
 * redraw) — i.e. neither Path 1 (standard, byte==ASCII) nor Path 2 (ToUnicode
 * subset reuse) can apply. XObject Path-3 stays refused until A3b. */
function isPath3OnlyTarget(doc: PDFDocument, pageIndex: number, fontKey: string): boolean {
  const byteSwapUnsafe = isByteSwapUnsafeFont(doc, pageIndex, fontKey);
  const hasToUnicode = !!getPageFontToUnicode(doc, pageIndex, fontKey);
  return byteSwapUnsafe && !hasToUnicode; // not Path-1-safe AND no Path-2 reuse
}
```

In `getEditableTextAt` (`:1331`) replace the blanket XObject null with:

```ts
if (found.xObjectName || found.target.inXObject) {
  // A3a: a Path-1/2-safe XObject target IS editable in place; only Path-3-in-XObject refuses.
  if (isPath3OnlyTarget(doc, pageIndex, found.target.fontKey)) return null;
}
```

(Then fall through to the existing decode-and-return-prefill code.)

- [ ] **Step 4: Run unit test — pass.** Run: `npx vitest run tests/utils/contentStreamEditor.test.ts -t "getEditableTextAt"`

- [ ] **Step 5: Write the failing handler test — XObject hit accepted when Path-1/2-safe**

In `tests/handlers/textEditHandler.test.ts`, follow the existing hit-selection tests: assert that with an XObject hit whose font is Path-1/2-safe, `target` is set (true-edit attempted) rather than routed to `_emitOverlay`; and a Path-3-only XObject hit still overlays. (Mock `getEditableTextAt`/`findTextOpAt` per the file's existing mocking style.)

- [ ] **Step 6: Run it — verify FAIL.** Run: `npx vitest run tests/handlers/textEditHandler.test.ts -t "XObject"`

- [ ] **Step 7: Relax the handler hit gate** (`textEditHandler.ts:263`)

Replace `if (hit && !hit.inXObject) { target = hit; … }` with a gate that accepts an XObject hit when it is Path-1/2-editable. Since the handler already calls `getEditableTextAt` for prefill (`:275`), the cleanest gate: accept the hit, and let the subsequent `getEditableTextAt`→null (Path-3 XObject) drive the overlay fallback. Concretely:

```ts
if (hit) { target = hit; matchedOrigin = o; break; } // A3a: accept XObject hits; Path-3-XObject still overlays via getEditableTextAt null + replaceTextAt refuse
```

Verify the downstream path: when `replaceTextAt` is later called on a Path-3 XObject target it still refuses (the `:1982` XObject-Path-3 refuse) → `_emitOverlay`. Confirm that refuse is intact (read `:1975-1990`); if Path-3-in-XObject is NOT currently guarded independently of the handler gate, add an explicit refuse in `replaceTextAt` for `found.xObjectName && isPath3OnlyTarget(...)` BEFORE blanking (return false). This is the safety that lets the handler gate open.

- [ ] **Step 8: Run handler test — pass.** Run: `npx vitest run tests/handlers/textEditHandler.test.ts -t "XObject"`

- [ ] **Step 9: Write the browser test** `tests/browser/trueedit-xobject.browser.test.ts`

Build a PDF with a Form XObject containing a word in a STANDARD font (Helvetica). Drive `replaceTextAt` at the word's page-space origin with new ASCII text; reload with pdf.js and assert the XObject's rendered text changed (pixel diff or `getOperatorList` shows the new bytes). Add a control: a CID-font XObject word → `getEditableTextAt` returns null (overlay path), XObject stream unchanged.

- [ ] **Step 10: Run the browser test — pass.** Run: `npx vitest run --config vitest.browser.config.ts tests/browser/trueedit-xobject.browser.test.ts`

- [ ] **Step 11: Pre-commit gate + commit**

Run: `npm run type-check && npm run lint && npm run test && npx vitest run --config vitest.browser.config.ts tests/browser/trueedit-xobject.browser.test.ts`
```bash
git add src/utils/contentStreamEditor.ts src/handlers/textEditHandler.ts tests/utils/contentStreamEditor.test.ts tests/handlers/textEditHandler.test.ts tests/browser/trueedit-xobject.browser.test.ts
git commit -m "feat(trueedit): edit Path-1/2 text inside Form XObjects in place (Sub-project A / A3a)"
```

---

### Task A1: Path-3 full-affine transform redraw

`buildPath3Redraw` hard-codes `1 0 0 1 x y Tm`, so a rotated/scaled run redrawn via Path 3 lands upright. Emit the captured `trm` (full affine) as the `Tm`, using the BASE `Tf` size (not the vScale-baked `fontSize`) to avoid double-scaling.

**Files:**
- Modify: `src/utils/contentStreamEditor.ts` (`locateTextOps` capture base size + matrix; `buildPath3Redraw` `textMatrix`; Path-3 block wires it)
- Test: `tests/utils/contentStreamEditor.test.ts`
- Test: `tests/browser/trueedit-transform.browser.test.ts` (create)

**Interfaces:**
- Produces: `TextOpInfo.textMatrix?: [number, number, number, number]` (the `trm` linear part `[a,b,c,d]`, set only when non-identity) and `TextOpInfo.baseFontSize?: number` (the raw `Tf` operand, pre-vScale); `buildPath3Redraw` gains `textMatrix?: [number, number, number, number]` (present → emit `a b c d x y Tm`).
- Consumes: `locateTextOps`'s existing `trm` (`:531`), `vScale` (`:526`), and the raw `Tf` size (currently multiplied into `fontSize` at `:544`).

- [ ] **Step 1: Write the failing unit test — `buildPath3Redraw` emits the affine `Tm`**

```ts
describe('buildPath3Redraw — transform (A1)', () => {
  const base = { resName: 'F0', size: 10, color: { r: 0, g: 0, b: 0 }, originX: 5, originY: 7, showOperand: '(x)' };
  it('emits identity Tm when no textMatrix given (byte-identical)', () => {
    expect(buildPath3Redraw(base)).toContain('1 0 0 1 5 7 Tm');
  });
  it('emits the affine matrix as Tm when textMatrix is given', () => {
    // 90° rotation: [0 1 -1 0]
    const out = buildPath3Redraw({ ...base, textMatrix: [0, 1, -1, 0] });
    expect(out).toContain('0 1 -1 0 5 7 Tm');
    expect(out).not.toContain('1 0 0 1 5 7 Tm');
  });
});
```

- [ ] **Step 2: Run it — verify the second test FAILs.** Run: `npx vitest run tests/utils/contentStreamEditor.test.ts -t "transform (A1)"`

- [ ] **Step 3: Extend `buildPath3Redraw` with `textMatrix`**

Add `textMatrix?: [number, number, number, number];` to the param type. Replace the `Tm` line (`:2103`):

```ts
  const m = p.textMatrix;
  const tm = m
    ? `${fmtNum(m[0])} ${fmtNum(m[1])} ${fmtNum(m[2])} ${fmtNum(m[3])} ${fmtNum(p.originX)} ${fmtNum(p.originY)} Tm\n`
    : `1 0 0 1 ${fmtNum(p.originX)} ${fmtNum(p.originY)} Tm\n`;
  return (
    `\nq\n${fmtNum(p.color.r)} ${fmtNum(p.color.g)} ${fmtNum(p.color.b)} rg\nBT\n` +
    `/${p.resName} ${fmtNum(p.size)} Tf\n` + state + tm + `${p.showOperand} Tj\nET\nQ`
  );
```

- [ ] **Step 4: Run the unit test — pass.** Run: `npx vitest run tests/utils/contentStreamEditor.test.ts -t "transform (A1)"`

- [ ] **Step 5: Write the failing unit test — capture base size + matrix in `locateTextOps`**

Build ops with a rotated `Tm` (e.g. `0 1 -1 0 100 100 Tm` then `/F0 10 Tf (x) Tj`) and assert the returned target carries `textMatrix` ≈ `[0,1,-1,0]` (within the `tilted` tolerance, scaled by CTM) and `baseFontSize === 10`. Add an upright control (`1 0 0 1 …`) asserting `textMatrix` is UNDEFINED and `baseFontSize === fontSize`.

- [ ] **Step 6: Run it — verify FAIL.** Run: `npx vitest run tests/utils/contentStreamEditor.test.ts -t "transform"`

- [ ] **Step 7: Capture base size + non-identity matrix in `locateTextOps`**

In the push block (`:539-557`), the raw `Tf` size is `fontSize` (before `* vScale`). Capture it and the `trm` linear part when non-identity:

```ts
const trmLinear: [number, number, number, number] = [trm[0], trm[1], trm[2], trm[3]];
const isIdentityish =
  Math.abs(trm[1]) < 1e-3 && Math.abs(trm[2]) < 1e-3 &&
  Math.abs(trm[0] - 1) < 1e-3 && Math.abs(trm[3] - 1) < 1e-3;
// …in the pushed object:
baseFontSize: fontSize,            // raw Tf operand (pre-vScale)
...(isIdentityish ? {} : { textMatrix: trmLinear }),
```

Add `textMatrix?` and `baseFontSize?` to `TextOpInfo`. (Keep `fontSize: fontSize * vScale` unchanged — other code relies on the effective size.)

- [ ] **Step 8: Wire the matrix into the Path-3 redraw, using the base size**

In the Path-3 block (`:2030-2041`):

```ts
// A1: when the run is transformed, the Tm carries the full scale, so Tf must use
// the BASE size (raw Tf operand) or the scale double-applies. A style fontSize
// override still wins (it sets the new on-page size directly).
const size = style?.fontSize ?? (target.textMatrix ? (target.baseFontSize ?? target.fontSize) : target.fontSize) ?? 12;
redraw = buildPath3Redraw({ /* …existing… */, size, textMatrix: target.textMatrix });
```

- [ ] **Step 9: Run unit tests — pass.** Run: `npx vitest run tests/utils/contentStreamEditor.test.ts`. Expected: all PASS (incl. existing Path-3 tests unchanged — upright edits emit identity Tm + effective size).

- [ ] **Step 10: Write the browser test** `tests/browser/trueedit-transform.browser.test.ts`

Build a PDF drawing a word ROTATED 90° in a CID/subset font (forces Path 3 via a Helvetica-requiring edit). True-edit the word; re-render with pdf.js; assert the redrawn glyph ink occupies a VERTICAL band (rotation preserved), not a horizontal one. Control: an upright word edited stays horizontal. (Model raster sampling on `tests/browser/trueedit-underline-resize.browser.test.ts`.)

- [ ] **Step 11: Run the browser test — pass.** Run: `npx vitest run --config vitest.browser.config.ts tests/browser/trueedit-transform.browser.test.ts`

- [ ] **Step 12: Pre-commit gate + commit**

Run: `npm run type-check && npm run lint && npm run test && npx vitest run --config vitest.browser.config.ts tests/browser/trueedit-transform.browser.test.ts`
```bash
git add src/utils/contentStreamEditor.ts tests/utils/contentStreamEditor.test.ts tests/browser/trueedit-transform.browser.test.ts
git commit -m "feat(trueedit): reproduce the full affine Tm on Path-3 redraw (Sub-project A / A1)"
```

---

### Task A3b: XObject Path-3 redraw

With A1's transform machinery and A3a's XObject prefill in place, allow the Path-3 redraw to write the XObject stream (instead of refusing) via the existing `buildStreamContent`/`setFormXObjectContent` single-stream write.

**Files:**
- Modify: `src/utils/contentStreamEditor.ts` (lift the Path-3-in-XObject refuse; route the redraw write to the XObject stream)
- Test: `tests/utils/contentStreamEditor.test.ts`, `tests/browser/trueedit-xobject.browser.test.ts` (extend A3a's file)

**Interfaces:**
- Consumes: A3a's `isPath3OnlyTarget`; A1's `textMatrix`; `setFormXObjectContent` (`:986`), `buildStreamContent` (`:1112`).
- Produces: a Path-3 redraw that targets the XObject stream when `found.xObjectName` is set.

- [ ] **Step 1: Write the failing browser test (extend `trueedit-xobject.browser.test.ts`)**

Add a case: a CID/subset-font word inside a Form XObject, true-edited with new text → Path 3 substitutes a standard face INTO the XObject stream; pdf.js renders the new text inside the XObject region. (Today this overlays; the test asserts the XObject stream changed.)

- [ ] **Step 2: Run it — verify FAIL** (Path-3-in-XObject currently refuses). Run: `npx vitest run --config vitest.browser.config.ts tests/browser/trueedit-xobject.browser.test.ts -t "Path-3"`

- [ ] **Step 3: Lift the refuse and route the write to the XObject stream**

In `replaceTextAt`'s Path-3 block: where it currently refuses for XObjects (`:1982`-area), instead build the redraw and write via the XObject path. The `setPageContent(doc, pageIndex, buildStreamContent(found, redraw))` at `:2055` must become a font-resource-on-the-XObject + XObject-stream write when `found.xObjectName` is set:

```ts
const newContent = buildStreamContent(found, redraw);
if (found.xObjectName) setFormXObjectContent(doc, pageIndex, found.xObjectName, newContent);
else setPageContent(doc, pageIndex, newContent);
```

Add the standard font + (alpha/gs) resource to the XOBJECT's `/Resources` rather than the page when `found.xObjectName` is set — extend `addPageFontResource`/`addPageExtGStateResource` to accept an optional XObject name, or add `addXObjectFontResource`. The redraw `textMatrix` must map through the XObject's own CTM (the matched op's `trm` already includes it, since `locateTextOps` ran over the XObject stream with its CTM).

- [ ] **Step 4: Run the browser test — pass.** Run: `npx vitest run --config vitest.browser.config.ts tests/browser/trueedit-xobject.browser.test.ts`

- [ ] **Step 5: Fallback guard — if XObject-local coordinates prove unreliable**

If the rendered text lands in the wrong place (XObject Matrix/Resources edge cases), REVERT to the refuse→overlay for Path-3-in-XObject and document it as the ceiling in CLAUDE.md (A3a still delivers the common-case win). Do not ship a misplaced redraw.

- [ ] **Step 6: Pre-commit gate + commit**

Run: `npm run type-check && npm run lint && npm run test && npx vitest run --config vitest.browser.config.ts tests/browser/trueedit-xobject.browser.test.ts`
```bash
git add src/utils/contentStreamEditor.ts tests/utils/contentStreamEditor.test.ts tests/browser/trueedit-xobject.browser.test.ts
git commit -m "feat(trueedit): Path-3 redraw inside Form XObjects (Sub-project A / A3b)"
```

---

### Task A6a: Stroke dash / cap / join on Path-3 (TE-5)

`locateTextOps` captures stroke color + line width but not dash/cap/join, so a dashed/round outline redraws solid. Capture `d`/`J`/`j` and re-emit them in the Path-3 state block. Only meaningful on render-mode-2 (outline) text.

**Files:** Modify `src/utils/contentStreamEditor.ts`; Test `tests/utils/contentStreamEditor.test.ts`.

**Interfaces:** Produces `TextOpInfo.dashPattern?: string` (raw `d` operand string, e.g. `[3 2] 0`), `lineCap?: number`, `lineJoin?: number` (set only when non-default); `buildPath3Redraw` gains `dashPattern?`/`lineCap?`/`lineJoin?` (emitted in the state block when present).

- [ ] **Step 1: Failing unit test** — `buildPath3Redraw` with `dashPattern:'[3 2] 0'` contains `[3 2] 0 d`; without it, no ` d` line (byte-identical). Add cap/join cases (`2 J`, `1 j`).
- [ ] **Step 2: Run — verify FAIL.** `npx vitest run tests/utils/contentStreamEditor.test.ts -t "dash"`
- [ ] **Step 3: Extend `buildPath3Redraw`** — add the three optional params; append to the `state` block: `(p.dashPattern ? \`${p.dashPattern} d\n\` : '') + (p.lineCap !== undefined ? \`${p.lineCap} J\n\` : '') + (p.lineJoin !== undefined ? \`${p.lineJoin} j\n\` : '')`.
- [ ] **Step 4: Run — pass.**
- [ ] **Step 5: Failing unit test** — `locateTextOps` captures `d`/`J`/`j` from the stream onto the text op.
- [ ] **Step 6: Run — verify FAIL.**
- [ ] **Step 7: Capture in `locateTextOps`** — track `dashPattern`/`lineCap`/`lineJoin` on `d`/`J`/`j` operators (store the raw operand text for `d`); add to `TextOpInfo`; push only when non-default (cap/join ≠ 0, dash ≠ `[] 0`). Wire into the Path-3 `buildPath3Redraw` call (only relevant when `renderMode === 1 || renderMode === 2`).
- [ ] **Step 8: Run unit tests — pass.** `npx vitest run tests/utils/contentStreamEditor.test.ts`
- [ ] **Step 9: Pre-commit gate + commit**
```bash
npm run type-check && npm run lint && npm run test
git add src/utils/contentStreamEditor.ts tests/utils/contentStreamEditor.test.ts
git commit -m "feat(trueedit): re-emit stroke dash/cap/join on Path-3 outline text (Sub-project A / A6a)"
```

---

### Task A6b: Path-3 size-change decoration width (TE-8)

A Path-3 edit that ALSO changes `fontSize` measures the new text width at the OLD size (`target.fontSize`), so a resized underline is slightly off. Use the effective NEW size for the width measurement when a size change is requested.

**Files:** Modify `src/utils/contentStreamEditor.ts` (`prepareDecorationResize` / the width measurement); Test `tests/utils/contentStreamEditor.test.ts`.

**Interfaces:** Consumes the existing `prepareDecorationResize` (`:2108`) + `style?.fontSize`. Produces a width measured at `style?.fontSize ?? target.fontSize`.

- [ ] **Step 1: Failing unit test** — a Path-3 edit with `style.fontSize` larger than the original yields a proportionally LARGER resized decoration width than the same edit without a size change. (Build on the existing decoration-resize tests; search `prepareDecorationResize`/`adjustedRuleWidth` in the test file.)
- [ ] **Step 2: Run — verify FAIL.** `npx vitest run tests/utils/contentStreamEditor.test.ts -t "size"`
- [ ] **Step 3: Thread the effective size** — pass `style?.fontSize` into `prepareDecorationResize` (or the width measurement it performs) so `embeddedTextWidth`/proxy measurement uses the NEW size. Gate: no size change → uses `target.fontSize` → unchanged.
- [ ] **Step 4: Run — pass.** `npx vitest run tests/utils/contentStreamEditor.test.ts`
- [ ] **Step 5: Pre-commit gate + commit**
```bash
npm run type-check && npm run lint && npm run test
git add src/utils/contentStreamEditor.ts tests/utils/contentStreamEditor.test.ts
git commit -m "fix(trueedit): measure decoration width at the new size on a Path-3 resize (Sub-project A / A6b)"
```

---

### Task A6c: Rotated-page inline-input placement verify (TE-3)

`textEditHandler` is already rotation-aware (`getViewport({rotation:(page.rotate+userRot)%360})` + `convertToPdfPoint`, `:152-161`). Verify the floating `<input>` box position on 90/180/270° pages; only adjust if a real misplacement reproduces.

**Files:** Verify `src/handlers/textEditHandler.ts`; Test `tests/browser/` (new guard) or `tests/handlers/textEditHandler.test.ts`.

- [ ] **Step 1: Reproduce** — `npm run dev`, open a PDF, rotate a page 90°, click the edit-text tool on existing text. Observe whether the inline input box appears AT the clicked glyph or offset. Screenshot before.
- [ ] **Step 2a: If misplaced** — trace the input's CSS-position math (it uses displayed/viewport coords, which are already rotated, so the box should follow). Fix the offset; add a `tests/handlers/textEditHandler.test.ts` case asserting the computed box position for a 90° page. Screenshot after.
- [ ] **Step 2b: If already correct** — add a guard test asserting the input position is computed from the rotated viewport (lock the behavior), and record "TE-3 already correct" in the commit body. No behavior change.
- [ ] **Step 3: Run — pass.** `npx vitest run tests/handlers/textEditHandler.test.ts`
- [ ] **Step 4: Pre-commit gate + commit**
```bash
npm run type-check && npm run lint && npm run test
git add src/handlers/textEditHandler.ts tests/handlers/textEditHandler.test.ts
git commit -m "test(trueedit): guard rotated-page inline-input placement (Sub-project A / A6c)"
```

---

## After all tasks

- Run the FULL deploy gate before any push: `npm audit --audit-level=high && npm run ocr:assets && npm run type-check && npm run lint && npm run test && npm run test:browser && npm run test:coverage:export && npm run build`.
- Update `CLAUDE.md` (true-edit section) with the A2/A1/A3a/A3b/A6 entries + any A3b ceiling, and the program plan `docs/plans/maxfidelity-program-2026-06-25.plan.md` (mark Sub-project A done). Update memory.
- **Push is manual.**

## Self-Review (run after writing — done)

- **Spec coverage:** A2 ✓ (Task A2) · A3a ✓ · A1 ✓ · A3b ✓ · A6/TE-5 ✓ (A6a) · A6/TE-8 ✓ (A6b) · A6/TE-3 ✓ (A6c). A4/A5 correctly absent (shipped). Byte-identical-when-inactive control present in A2 (gs omitted), A1 (identity Tm), A6a (no d line). Add the same control assertion to A3a (non-XObject unaffected) and A6b (no-size-change unchanged) when writing those tests.
- **Placeholder scan:** the only deferred specifics are "follow the existing test helper" pointers for op construction — intentional (the test file's helpers are the source of truth; reproducing them verbatim risks drift). No TODO/TBD in implementation steps; all new code is shown.
- **Type consistency:** `textMatrix: [number,number,number,number]`, `baseFontSize`, `fillAlpha`/`strokeAlpha`, `dashPattern`/`lineCap`/`lineJoin` are added to `TextOpInfo` and consumed by name in `buildPath3Redraw`; `isPath3OnlyTarget`/`addPageExtGStateResource` signatures match their call sites. `buildPath3Redraw` param additions (`gsName`, `textMatrix`, `dashPattern`, `lineCap`, `lineJoin`) are all optional and consistently named across tasks.
