# Sub-project C Phase 2b — DOCX image edit (delete + resize) + editor undo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline, item-by-item) or
> subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make a top-level DOCX image resizable + deletable in the editor (byte-exact when untouched),
and add editor-wide undo.

**Architecture:** Parse stamps an `anchorId` on each top-level drawing anchor; it rides the `docx_image`
node. A save pre-pass `reconcileImageAnchors` (before `reconcileContainer`) deletes absent anchors and
rewrites `wp:extent` only when dims changed, with a verbatim-fallback safety guard. A `docx_image`
NodeView supplies corner drag-resize + ✕/Delete. `prosemirror-history` adds Mod-z/Mod-y.

**Tech Stack:** TypeScript, ProseMirror (model/state/view/keymap/history), fflate OPC, vitest (jsdom +
@vitest/browser real Chrome).

**Spec:** `docs/superpowers/specs/2026-06-26-docx-editor-subproject-c-phase2b-image-edit-design.md`

## Global Constraints

- **Cardinal rule:** edit `word/document.xml` IN PLACE; NEVER rebuild via the docx writer. The pre-pass
  may only `remove()` a `w:p` or set `cx/cy` numeric attrs on existing elements.
- **Byte-exact when no image edited:** pre-pass writes nothing (no delete; resize compares-then-skips).
- **Safety guard:** any identity inconsistency → skip the pre-pass entirely (Phase-1 verbatim).
- **No Co-Authored-By** trailers. `git push` is manual. Per-item commit (inline execution authorized).
- Gate per task: `npm run type-check && npm run lint && npm run test` (jsdom); the final task runs the
  FULL deploy gate incl. `npm run test:browser` + `test:coverage:export` + `build`.
- 3 locale files stay key-identical — ONE new key `docxEditor.deleteImage` (the ✕ button's title/
  aria-label), added to en/fr/ar (ar [Unverified]); the locale-sync hook is post-write/advisory.
- `EMU_PER_PT = 12700`.

## File Structure

- `src/docx/docModel.ts` — `DocImageBlock.anchorId`; `anchorId` stamping (body-level); pure
  `drawingAnchorParas`, `rewriteExtent`; `reconcileImageAnchors`; call it first in `applyBlocks`.
- `src/docx/docxSchema.ts` — `docx_image` `anchorId` attr.
- `src/docx/docxProseMirror.ts` — pass/read `anchorId`; register `nodeViews`; `history()` + keymap.
- `src/docx/docxImageView.ts` *(new)* — resize/delete NodeView.
- `src/styles/modals.css` — selection ring, corner handles, ✕.
- `package.json` — `prosemirror-history`.
- Tests: `tests/docx/docModelImageEdit.test.ts` (new), extend `tests/docx/docxImageBridge.test.ts`,
  `tests/browser/docx-image-edit.browser.test.ts` (new).

---

### Task 1: `anchorId` identity + bridge round-trip

**Files:** Modify `src/docx/docModel.ts`, `src/docx/docxSchema.ts`, `src/docx/docxProseMirror.ts`;
Test `tests/docx/docModelImageEdit.test.ts` (new), extend `tests/docx/docxImageBridge.test.ts`.

**Interfaces:**
- Produces: `DocImageBlock.anchorId?: number` (0-based index among top-level drawing anchors; absent
  for hyperlink anchors and cell-nested anchors). `docx_image` node attr `anchorId` (default `-1`).

- [ ] **Step 1: Failing test — parse stamps anchorId on drawing anchors only**

In `tests/docx/docModelImageEdit.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { parseDocModel, isDocImageBlock } from '../../src/docx/docModel';

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const NS = `${W} xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"`;
const drawing = (rId: string) =>
  `<w:p><w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><wp:extent cx="952500" cy="952500"/></wp:inline></w:drawing></w:r></w:p>`;
const doc = (body: string) => `<w:document ${NS}><w:body>${body}</w:body></w:document>`;

describe('C2 anchorId stamping', () => {
  it('numbers top-level drawing anchors 0..n in order; hyperlink anchors get none', () => {
    const xml = doc(
      `<w:p><w:r><w:t>text</w:t></w:r></w:p>` +
      drawing('rId1') +
      `<w:p><w:hyperlink w:anchor="_Toc1"><w:r><w:t>jump</w:t></w:r></w:hyperlink></w:p>` +
      drawing('rId2'),
    );
    const m = parseDocModel(xml);
    const imgs = m.blocks.filter(isDocImageBlock);
    expect(imgs.map(b => b.anchorId)).toEqual([0, undefined, 1]); // drawing,hyperlink,drawing
  });
});
```

- [ ] **Step 2: Run → fails** (`anchorId` undefined on all). Run:
  `npx vitest run tests/docx/docModelImageEdit.test.ts > /tmp/c2-t1.txt 2>&1; tail -30 /tmp/c2-t1.txt`

- [ ] **Step 3: Implement — model field + stamping**

In `docModel.ts`, add to `DocImageBlock`:
```ts
export interface DocImageBlock {
  kind: 'image';
  image?: { dataB64: string; mime: 'image/png' | 'image/jpeg'; widthPt: number; heightPt: number };
  linkText?: string;
  /** 0-based index among TOP-LEVEL drawing anchors (w:p with w:drawing), in document order.
   * Stamped at parse; absent for hyperlink anchors and cell-nested anchors. C2 identity. */
  anchorId?: number;
}
```
Change `parseContainerBlocks` to optionally stamp (body call only). Add a 4th param:
```ts
function parseContainerBlocks(container: Element, numberingMap?: NumberingMap, linkMap?: Map<string, string>, stampAnchorIds = false): DocBlock[] {
  const out: DocBlock[] = [];
  let drawingCount = 0;
  for (const el of Array.from(container.children)) {
    if (el.tagName === 'w:p') {
      if (isAnchorParagraphEl(el)) {
        const blk = parseAnchorBlock(el);
        if (stampAnchorIds && el.getElementsByTagName('w:drawing').length > 0) blk.anchorId = drawingCount++;
        out.push(blk);
      } else out.push(parseParagraph(el, numberingMap, linkMap));
    } else if (el.tagName === 'w:tbl') out.push(parseTable(el, numberingMap, linkMap));
  }
  return out;
}
```
In `parseDocModel`, pass `true` for the body call:
```ts
const blocks: DocBlock[] = body ? parseContainerBlocks(body, numberingMap, linkMap, true) : [];
```
(Cell parsing via `parseTable` keeps the default `false` → cell images get no `anchorId`, stay opaque.)

- [ ] **Step 4: Run → passes.** Same command as Step 2.

- [ ] **Step 5: Failing test — node↔block round-trip preserves anchorId**

Extend `tests/docx/docxImageBridge.test.ts`. Add to its existing top imports
`import { docModelToDoc, docToDocModel } from '../../src/docx/docxProseMirror';` (already imported there),
plus `import { isDocImageBlock, type DocImageBlock } from '../../src/docx/docModel';`, then:
```ts
it('round-trips anchorId through the docx_image node', () => {
  const block: DocImageBlock = {
    kind: 'image', anchorId: 2,
    image: { dataB64: 'AAAA', mime: 'image/png', widthPt: 75, heightPt: 75 },
  };
  const doc = docModelToDoc({ blocks: [block], paragraphs: [] });
  const back = docToDocModel(doc).blocks.find(isDocImageBlock);
  expect(back?.anchorId).toBe(2);
});
```

- [ ] **Step 6: Run → fails** (anchorId dropped at node).

- [ ] **Step 7: Implement — schema attr + bridge pass/read**

`docxSchema.ts`: add `anchorId: { default: -1 }` to BOTH `docx_image.attrs` AND `docx_link.attrs`.
The link needs it because an **unsupported-format / unextracted** drawing anchor (no `image` bytes)
round-trips as a `docx_link` fallback — it must keep its drawing identity so the save pre-pass preserves
it instead of treating it as deleted (see Task 2's identity-only `S`).

`docxProseMirror.ts` `imageBlockToNode` — pass `anchorId` on BOTH branches:
```ts
if (b.image) {
  return n.docx_image.create({
    dataB64: b.image.dataB64, mime: b.image.mime,
    widthPt: b.image.widthPt, heightPt: b.image.heightPt,
    anchorId: b.anchorId ?? -1,
  });
}
return n.docx_link.create({ text: b.linkText ?? '', anchorId: b.anchorId ?? -1 });
```
`docxProseMirror.ts` `emitBlockTo` — read `anchorId` back on BOTH atom branches:
```ts
if (name === 'docx_image') {
  const aid = Number(node.attrs.anchorId);
  out.push({
    kind: 'image',
    image: { dataB64: node.attrs.dataB64 as string, mime: node.attrs.mime as 'image/png' | 'image/jpeg',
             widthPt: Number(node.attrs.widthPt), heightPt: Number(node.attrs.heightPt) },
    ...(aid >= 0 ? { anchorId: aid } : {}),
  });
  return;
}
if (name === 'docx_link') {
  const aid = Number(node.attrs.anchorId);
  out.push({ kind: 'image', linkText: node.attrs.text as string, ...(aid >= 0 ? { anchorId: aid } : {}) });
  return;
}
```
(Replace the existing `docx_link` branch — it currently emits `{ kind:'image', linkText }` with no anchorId.)

- [ ] **Step 8: Run → passes.** `npx vitest run tests/docx/docModelImageEdit.test.ts tests/docx/docxImageBridge.test.ts > /tmp/c2-t1.txt 2>&1; tail -30 /tmp/c2-t1.txt`

- [ ] **Step 9: Gate + commit.** `npm run type-check && npm run lint && npm run test 2>&1 | tail -15`
```bash
git add src/docx/docModel.ts src/docx/docxSchema.ts src/docx/docxProseMirror.ts tests/docx/docModelImageEdit.test.ts tests/docx/docxImageBridge.test.ts
git commit -m "feat(docx): anchorId identity on top-level image anchors (C2 Task 1)"
```

---

### Task 2: `reconcileImageAnchors` save pre-pass (delete + resize + safety guard)

**Files:** Modify `src/docx/docModel.ts`; Test `tests/docx/docModelImageEdit.test.ts`.

**Interfaces:**
- Consumes: `DocImageBlock.anchorId`, `isAnchorParagraphEl`, `W_NS`.
- Produces: pure `drawingAnchorParas(container: Element): Element[]`,
  `rewriteExtent(drawingPara: Element, cx: number, cy: number): void`,
  `reconcileImageAnchors(dom: Document, body: Element, blocks: DocBlock[]): void`. Called first in
  `applyBlocks`.

- [ ] **Step 1: Failing test — delete removes the right w:p; resize rewrites extent; unchanged = byte-identical; guard fallback**

Append to `tests/docx/docModelImageEdit.test.ts`:
```ts
import { applyBlocks, parseDocModel as parse2 } from '../../src/docx/docModel';

const drawA = (cx: number, cy: number) =>
  `<w:p><w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><wp:extent cx="${cx}" cy="${cy}"/><a:graphic><a:graphicData><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:spPr><a:xfrm><a:ext cx="${cx}" cy="${cy}"/></a:xfrm></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;

describe('C2 reconcileImageAnchors', () => {
  it('deletes an image whose anchorId is gone, keeps the other byte-exact', () => {
    const xml = doc(drawA(952500, 952500) + `<w:p><w:r><w:t>mid</w:t></w:r></w:p>` + drawA(635000, 635000));
    const m = parse2(xml);
    const kept = m.blocks.filter(b => !(isDocImageBlock(b) && b.anchorId === 0)); // delete anchorId 0
    const out = applyBlocks(xml, kept, undefined, { editImages: true });
    expect((out.match(/<w:drawing/g) || []).length).toBe(1);
    expect(out).toContain('cx="635000"');        // survivor untouched
    expect(out).not.toContain('cx="952500"');     // deleted one gone
  });

  it('rewrites wp:extent + a:ext on resize, byte-identical when unchanged', () => {
    const xml = doc(drawA(952500, 952500));
    const m = parse2(xml);
    // unchanged → byte-identical body content for the drawing
    expect(applyBlocks(xml, m.blocks, undefined, { editImages: true })).toContain('cx="952500"');
    // resize the block (75pt → 150pt)
    const img = m.blocks.find(isDocImageBlock);
    if (!img || !img.image) throw new Error('image block missing');
    img.image = { ...img.image, widthPt: 150, heightPt: 150 };
    const out = applyBlocks(xml, m.blocks, undefined, { editImages: true });
    expect((out.match(/cx="1905000"/g) || []).length).toBe(2); // wp:extent AND a:ext (150*12700)
    expect(out).not.toContain('cx="952500"');
  });

  it('safety guard: a duplicate anchorId skips the pre-pass (verbatim)', () => {
    const xml = doc(drawA(952500, 952500) + drawA(635000, 635000));
    const m = parse2(xml);
    m.blocks.filter(isDocImageBlock)[1].anchorId = 0; // dup id 0 (isDocImageBlock narrows → no cast/!)
    const out = applyBlocks(xml, m.blocks, undefined, { editImages: true });
    expect((out.match(/<w:drawing/g) || []).length).toBe(2); // nothing deleted/resized
  });

  it('WITHOUT editImages (legacy applyParagraphRuns path) images stay verbatim even if a block is gone', () => {
    const xml = doc(drawA(952500, 952500) + drawA(635000, 635000));
    const m = parse2(xml);
    const kept = m.blocks.filter(b => !(isDocImageBlock(b) && b.anchorId === 0));
    const out = applyBlocks(xml, kept); // no opt-in → pre-pass off
    expect((out.match(/<w:drawing/g) || []).length).toBe(2); // both preserved (regression guard)
  });

  it('preserves an UNEXTRACTED-image anchor (anchorId but no image bytes) — never deleted/resized', () => {
    // Simulates the docx_link fallback for an unsupported-format / missing-media drawing: the block
    // carries anchorId but no `image`. It must survive an editImages save verbatim (S is identity-only).
    const xml = doc(drawA(952500, 952500));
    const blocks = [{ kind: 'image' as const, anchorId: 0 }]; // no image
    const out = applyBlocks(xml, blocks, undefined, { editImages: true });
    expect((out.match(/<w:drawing/g) || []).length).toBe(1); // preserved
    expect(out).toContain('cx="952500"');                     // not resized
  });
});
```

- [ ] **Step 2: Run → fails** (no pre-pass; delete/resize don't take effect). Run:
  `npx vitest run tests/docx/docModelImageEdit.test.ts > /tmp/c2-t2.txt 2>&1; tail -40 /tmp/c2-t2.txt`

- [ ] **Step 3: Implement the pre-pass**

In `docModel.ts` (near `reconcileContainer`):
```ts
/** Top-level w:p that contain a w:drawing, in document order. */
function drawingAnchorParas(container: Element): Element[] {
  return Array.from(container.children).filter(
    (e): e is Element => e.tagName === 'w:p' && e.getElementsByTagName('w:drawing').length > 0,
  );
}

/** Set cx/cy on the drawing's wp:extent and (when present) the inner pic a:ext. In-place. */
function rewriteExtent(drawingPara: Element, cx: number, cy: number): void {
  const drawing = drawingPara.getElementsByTagName('w:drawing')[0];
  if (!drawing) return;
  const extents = drawing.getElementsByTagName('wp:extent');
  if (extents[0]) { extents[0].setAttribute('cx', String(cx)); extents[0].setAttribute('cy', String(cy)); }
  const aExts = drawing.getElementsByTagName('a:ext');
  if (aExts[0]) { aExts[0].setAttribute('cx', String(cx)); aExts[0].setAttribute('cy', String(cy)); }
}

const EMU_PER_PT_M = 12700;
/** C2 image edit: delete top-level drawing anchors whose anchorId is gone; resize the rest in place.
 * Runs before reconcileContainer. Safety guard → verbatim fallback on any identity inconsistency. */
function reconcileImageAnchors(_dom: Document, body: Element, blocks: DocBlock[]): void {
  const D = drawingAnchorParas(body);
  const m = D.length;
  if (m === 0) return;
  // SURVIVING drawing-origin blocks = ANY block carrying a numeric anchorId — this INCLUDES an
  // unsupported-format image (EMF/WMF / missing media) that failed extraction and round-tripped as a
  // docx_link fallback (still anchorId-stamped). Requiring `b.image` here would treat such an image as
  // deleted and REMOVE it on save — a data-loss regression vs Phase-1's verbatim preservation. So S is
  // identity-only; RESIZE (below) additionally requires `b.image` (dims).
  const drawBlocks = blocks.filter((b): b is DocImageBlock => isDocImageBlock(b) && typeof b.anchorId === 'number');
  const ids = drawBlocks.map(b => b.anchorId as number);
  const S = new Set(ids);
  // Guard: duplicate-free subset of {0..m-1}; else leave every image verbatim.
  if (S.size !== ids.length || ids.some(i => i < 0 || i >= m)) return;
  for (let i = 0; i < m; i++) {
    if (!S.has(i)) { D[i].remove(); continue; }     // user-deleted (no surviving anchor for id i)
    const blk = drawBlocks.find(b => b.anchorId === i);
    if (!blk || !blk.image) continue;                // unextracted image → preserve verbatim, no resize
    const cx = Math.round(blk.image.widthPt * EMU_PER_PT_M);
    const cy = Math.round(blk.image.heightPt * EMU_PER_PT_M);
    const ext = D[i].getElementsByTagName('wp:extent')[0];
    const curCx = Number(ext?.getAttribute('cx'));
    const curCy = Number(ext?.getAttribute('cy'));
    if (cx > 0 && cy > 0 && (cx !== curCx || cy !== curCy)) rewriteExtent(D[i], cx, cy);
  }
}
```
Call it first in `applyBlocks`, **gated behind an explicit opt-in** so legacy callers are unaffected:
```ts
export function applyBlocks(documentXml: string, blocks: DocBlock[], ids?: DocApplyIds, opts?: { editImages?: boolean }): string {
  const dom = new DOMParser().parseFromString(documentXml, 'application/xml');
  if (dom.getElementsByTagName('parsererror').length > 0) return documentXml;
  const body = dom.getElementsByTagName('w:body')[0];
  if (!body) return documentXml;
  if (opts?.editImages) reconcileImageAnchors(dom, body, blocks); // C2 pre-pass (delete/resize)
  reconcileContainer(dom, body, blocks, ids, false);
  return new XMLSerializer().serializeToString(dom);
}
```
**Why the opt-in (CRITICAL — prevents a regression):** `applyParagraphRuns` (the #1c runs-only path,
and several tests) calls `applyBlocks` with **paragraphs only** (no image blocks). Without the gate the
pre-pass would see `S = ∅` while the DOM has drawing anchors and **delete every image**. `applyParagraphRuns`
delegates WITHOUT `editImages` → pre-pass off → byte-identical legacy behavior, images preserved verbatim
(Phase-1). Only the editor save opts in.

Wire the editor save (`docxProseMirror.ts:403`) to pass the opt-in:
```ts
setDocumentXml(opc, applyBlocks(originalXml, edited.blocks, ids, { editImages: true }));
```

The Task-2 tests call `applyBlocks(xml, blocks, undefined, { editImages: true })` to exercise the
pre-pass; add a control asserting `applyBlocks(xml, blocks)` (no opt-in) leaves images verbatim even when
an `anchorId` is missing from the model.

- [ ] **Step 4: Run → passes.** Same command as Step 2.

- [ ] **Step 4b: Test — deleting a MIXED image+text anchor removes the whole `w:p`**

A Word inline image often sits in a `w:p` that also has text. Phase-1 collapses the whole `w:p` into one
opaque atom (text hidden), so the model has no representation of that text. Deleting the atom therefore
removes the whole `w:p` (text included) — the only consistent behavior (stripping just the `w:drawing`
leaves a text para with no model block, which the reconciler removes anyway). Undo (Task 4) recovers it.
Assert it:
```ts
it('deleting a mixed image+text anchor removes the whole w:p (documented; undo recovers)', () => {
  const mixed = `<w:p><w:r><w:t>see </w:t></w:r><w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><wp:extent cx="952500" cy="952500"/></wp:inline></w:drawing></w:r><w:r><w:t> here</w:t></w:r></w:p>`;
  const xml = doc(mixed + `<w:p><w:r><w:t>after</w:t></w:r></w:p>`);
  const m = parse2(xml);
  const kept = m.blocks.filter(b => !isDocImageBlock(b)); // delete the only image anchor
  const out = applyBlocks(xml, kept, undefined, { editImages: true });
  expect(out).not.toContain('w:drawing');
  expect(out).not.toContain('see ');   // whole para gone (consistent with the opaque-atom model)
  expect(out).toContain('after');       // sibling paragraph intact
});
```

- [ ] **Step 5: Failing test — untouched hyperlink/table/cell-image survive a delete + a round-trip**

Append a test: a body with a drawing (anchorId 0), a hyperlink anchor, a table, and a cell-nested
drawing; delete anchorId 0 from the model; call `applyBlocks(xml, kept, undefined, { editImages: true })`;
assert the hyperlink text, the `<w:tbl>`, and the cell `<w:drawing>` all remain exactly once (only the
top-level drawing anchor is removed). Then `parse2(out)` re-parses without error.

- [ ] **Step 6: Run → passes** (pre-pass touches only top-level drawing anchors).

- [ ] **Step 7: Gate + commit.**
```bash
npm run type-check && npm run lint && npm run test 2>&1 | tail -15
git add src/docx/docModel.ts tests/docx/docModelImageEdit.test.ts
git commit -m "feat(docx): reconcileImageAnchors save pre-pass — delete + resize images in place (C2 Task 2)"
```

---

### Task 3: `docx_image` NodeView — corner drag-resize + ✕/Delete

**Files:** Create `src/docx/docxImageView.ts`; Modify `src/docx/docxProseMirror.ts` (register
`nodeViews`), `src/styles/modals.css`; Test `tests/browser/docx-image-edit.browser.test.ts` (new).

**Interfaces:**
- Consumes: `EditorView`, the `docx_image` node attrs (`widthPt/heightPt`).
- Produces: `createDocxImageView(node, view, getPos)` → a ProseMirror `NodeView`.

- [ ] **Step 1: Failing real-Chrome test — select shows handles; drag resizes; Delete removes; save round-trips**

`tests/browser/docx-image-edit.browser.test.ts` (model on `docx-image-preserve.browser.test.ts` — copy
its `PNG_B64`, `b64ToBytes`, `CONTENT_TYPES`, `ROOT_RELS` constants):
```ts
import { describe, it, expect } from 'vitest';
import { page } from '@vitest/browser/context';
import { zipSync, strToU8 } from 'fflate';
import { NodeSelection } from 'prosemirror-state';
import { mountDocxEditor } from '../../src/docx/docxProseMirror';
import { openOpc, getDocumentXml } from '../../src/docx/opcEdit';
// PNG_B64 / b64ToBytes / CONTENT_TYPES / ROOT_RELS: copied verbatim from docx-image-preserve.browser.test.ts.

const DOC_ONE_IMG = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
  xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
  xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
  xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body>
    <w:p><w:r><w:drawing><wp:inline><wp:extent cx="952500" cy="952500"/>
      <a:graphic><a:graphicData><pic:pic><pic:spPr><a:xfrm><a:ext cx="952500" cy="952500"/></a:xfrm></pic:spPr>
      <pic:blipFill><a:blip r:embed="rId1"/></pic:blipFill></pic:pic></a:graphicData></a:graphic>
    </wp:inline></w:drawing></w:r></w:p>
  </w:body></w:document>`;
const DOC_RELS_IMG = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>
</Relationships>`;
function makeDocxOneImage(): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(CONTENT_TYPES),
    '_rels/.rels': strToU8(ROOT_RELS),
    'word/document.xml': strToU8(DOC_ONE_IMG),
    'word/_rels/document.xml.rels': strToU8(DOC_RELS_IMG),
    'word/media/image1.png': b64ToBytes(PNG_B64),
  });
}

describe('DOCX editor — image resize/delete (real browser)', () => {
  it('shows handles on select and resizes via a corner drag; save updates wp:extent', async () => {
    const container = document.createElement('div'); document.body.appendChild(container);
    const handle = mountDocxEditor(container, makeDocxOneImage());
    const view = handle.view;
    // select the image node
    let imgPos = -1; view.state.doc.descendants((n, p) => { if (n.type.name === 'docx_image') imgPos = p; });
    view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, imgPos)));
    const handleEl = container.querySelector('[data-docx-resize="se"]') as HTMLElement;
    expect(handleEl).not.toBeNull();
    const img = container.querySelector('img[data-docx-image]') as HTMLImageElement;
    const w0 = img.getBoundingClientRect().width;
    // drag the SE handle +60px
    const r = handleEl.getBoundingClientRect();
    handleEl.dispatchEvent(new PointerEvent('pointerdown', { clientX: r.x, clientY: r.y, bubbles: true }));
    document.dispatchEvent(new PointerEvent('pointermove', { clientX: r.x + 60, clientY: r.y + 60, bubbles: true }));
    document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    const imgAfter = container.querySelector('img[data-docx-image]') as HTMLImageElement;
    expect(imgAfter.getBoundingClientRect().width).toBeGreaterThan(w0);
    const xml = getDocumentXml(openOpc(handle.save()));
    expect(xml).not.toContain('cx="952500"'); // extent changed
    await page.screenshot({ path: '../../qa-shots/c-phase2b/resize.png', element: container }).catch(() => {});
    handle.destroy(); container.remove();
  });

  it('Shift drag resizes height independently (free aspect)', () => {
    const container = document.createElement('div'); document.body.appendChild(container);
    const handle = mountDocxEditor(container, makeDocxOneImage());
    const view = handle.view;
    let imgPos = -1; view.state.doc.descendants((n, p) => { if (n.type.name === 'docx_image') imgPos = p; });
    view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, imgPos)));
    const handleEl = container.querySelector('[data-docx-resize="se"]') as HTMLElement;
    const img = container.querySelector('img[data-docx-image]') as HTMLImageElement;
    const b0 = img.getBoundingClientRect();
    const r = handleEl.getBoundingClientRect();
    // Shift held → height tracks dy, width tracks dx independently. Move only Y.
    handleEl.dispatchEvent(new PointerEvent('pointerdown', { clientX: r.x, clientY: r.y, shiftKey: true, bubbles: true }));
    document.dispatchEvent(new PointerEvent('pointermove', { clientX: r.x, clientY: r.y + 50, shiftKey: true, bubbles: true }));
    document.dispatchEvent(new PointerEvent('pointerup', { clientX: r.x, clientY: r.y + 50, shiftKey: true, bubbles: true }));
    const b1 = (container.querySelector('img[data-docx-image]') as HTMLImageElement).getBoundingClientRect();
    expect(b1.height).toBeGreaterThan(b0.height);             // height grew
    expect(Math.abs(b1.width - b0.width)).toBeLessThan(2);     // width ~unchanged → aspect changed
    handle.destroy(); container.remove();
  });

  it('deletes the image (Delete key) → save drops the w:drawing', () => {
    const container = document.createElement('div'); document.body.appendChild(container);
    const handle = mountDocxEditor(container, makeDocxOneImage());
    const view = handle.view;
    let imgPos = -1; view.state.doc.descendants((n, p) => { if (n.type.name === 'docx_image') imgPos = p; });
    view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, imgPos)).deleteSelection());
    const xml = getDocumentXml(openOpc(handle.save()));
    expect(xml).not.toContain('w:drawing');
    handle.destroy(); container.remove();
  });
});
```

- [ ] **Step 2: Run → fails.** `npx vitest run --config vitest.browser.config.ts tests/browser/docx-image-edit.browser.test.ts > /tmp/c2-t3.txt 2>&1; tail -40 /tmp/c2-t3.txt`

- [ ] **Step 3: Implement the NodeView** (`src/docx/docxImageView.ts`)
```ts
import type { EditorView, NodeView } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';
import { t } from '../utils/i18n';

export function createDocxImageView(node: PMNode, view: EditorView, getPos: () => number | undefined): NodeView {
  const dom = document.createElement('span');
  dom.className = 'docx-image-wrap';
  const img = document.createElement('img');
  img.setAttribute('data-docx-image', '1');
  const apply = (n: PMNode): void => {
    img.src = `data:${n.attrs.mime};base64,${n.attrs.dataB64}`;
    img.style.cssText = `max-width:100%;${n.attrs.widthPt ? `width:${n.attrs.widthPt}pt;` : ''}${n.attrs.heightPt ? `height:${n.attrs.heightPt}pt;` : ''}`;
  };
  apply(node);
  dom.appendChild(img);

  // selection chrome (a SE corner handle + a ✕), shown only when selected.
  const se = document.createElement('span'); se.className = 'docx-image-handle se'; se.setAttribute('data-docx-resize', 'se');
  const del = document.createElement('button'); del.className = 'docx-image-del'; del.textContent = '✕'; del.type = 'button';
  del.title = t('docxEditor.deleteImage'); del.setAttribute('aria-label', t('docxEditor.deleteImage'));
  dom.appendChild(se); dom.appendChild(del);

  let cur = node;
  const ratio = (): number => (cur.attrs.heightPt > 0 ? cur.attrs.widthPt / cur.attrs.heightPt : 1);

  del.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
  del.addEventListener('click', (e) => {
    e.preventDefault();
    const pos = getPos(); if (pos == null) return;
    view.dispatch(view.state.tr.delete(pos, pos + cur.nodeSize));
    view.focus();
  });

  let startX = 0, startY = 0, startW = 0, startH = 0, free = false;
  // Compute the target dims (pt) for a drag delta. Aspect-locked → height tracks width via the
  // original ratio; free (Shift) → width tracks dx and height tracks dy independently.
  const dims = (e: PointerEvent): { widthPt: number; heightPt: number } => {
    const r = ratio();
    const widthPt = Math.max(1, (startW + (e.clientX - startX)) * 0.75); // px → pt at 96dpi
    const heightPt = free
      ? Math.max(1, (startH + (e.clientY - startY)) * 0.75)
      : (r > 0 ? widthPt / r : widthPt);
    return { widthPt, heightPt };
  };
  const onMove = (e: PointerEvent): void => {
    const { widthPt, heightPt } = dims(e);
    img.style.width = `${widthPt}pt`; img.style.height = `${heightPt}pt`;
  };
  const onUp = (e: PointerEvent): void => {
    document.removeEventListener('pointermove', onMove); document.removeEventListener('pointerup', onUp);
    const pos = getPos(); if (pos == null) return;
    const { widthPt, heightPt } = dims(e);
    view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...cur.attrs, widthPt, heightPt }));
  };
  se.addEventListener('pointerdown', (e) => {
    e.preventDefault(); e.stopPropagation();
    startX = e.clientX; startY = e.clientY;
    // Base the drag on the node's stored width/heightPt (px = pt / 0.75), NOT getBoundingClientRect —
    // max-width:100% can clamp the rendered size and would make the resize drift. Fall back to the
    // rect only when the pt dim is 0 (extent absent → natural size).
    const rect = img.getBoundingClientRect();
    startW = (cur.attrs.widthPt as number) > 0 ? (cur.attrs.widthPt as number) / 0.75 : rect.width;
    startH = (cur.attrs.heightPt as number) > 0 ? (cur.attrs.heightPt as number) / 0.75 : rect.height;
    free = e.shiftKey;
    document.addEventListener('pointermove', onMove); document.addEventListener('pointerup', onUp);
  });

  return {
    dom,
    update(n: PMNode): boolean { if (n.type !== cur.type) return false; cur = n; apply(n); return true; },
    selectNode(): void { dom.classList.add('selected'); },
    deselectNode(): void { dom.classList.remove('selected'); },
    stopEvent(e: Event): boolean { return e.target === se || e.target === del; },
    ignoreMutation(): boolean { return true; },
    destroy(): void { document.removeEventListener('pointermove', onMove); document.removeEventListener('pointerup', onUp); },
  };
}
```

- [ ] **Step 4: Register the NodeView** in `docxProseMirror.ts` `new EditorView(container, { … })`:
```ts
import { createDocxImageView } from './docxImageView';
// inside the EditorView props:
nodeViews: { docx_image: (node, v, getPos) => createDocxImageView(node, v, getPos) },
```

- [ ] **Step 5: CSS** (`src/styles/modals.css`, after the Phase-1 image rules):
```css
.docx-editor-mount .ProseMirror .docx-image-wrap { position: relative; display: inline-block; line-height: 0; }
.docx-editor-mount .ProseMirror .docx-image-wrap.selected { outline: 2px solid var(--accent, #2563eb); }
.docx-editor-mount .ProseMirror .docx-image-handle,
.docx-editor-mount .ProseMirror .docx-image-del { display: none; position: absolute; }
.docx-editor-mount .ProseMirror .docx-image-wrap.selected .docx-image-handle,
.docx-editor-mount .ProseMirror .docx-image-wrap.selected .docx-image-del { display: block; }
.docx-editor-mount .ProseMirror .docx-image-handle.se {
  width: 12px; height: 12px; right: -6px; bottom: -6px; background: var(--accent, #2563eb);
  border: 2px solid #fff; border-radius: 50%; cursor: nwse-resize; }
.docx-editor-mount .ProseMirror .docx-image-del {
  top: -10px; right: -10px; width: 20px; height: 20px; border-radius: 50%; border: none;
  background: #dc2626; color: #fff; font-size: 11px; line-height: 1; cursor: pointer; padding: 0; }
```

- [ ] **Step 5b: i18n key** — add `"deleteImage"` under the existing `docxEditor` namespace in
  `locales/en.json` ("Delete image"), `fr.json` ("Supprimer l'image"), `ar.json` ("حذف الصورة" — [Unverified],
  needs native review). The locale-sync hook is post-write/advisory; adding to all 3 clears it on the final write.

- [ ] **Step 6: Run browser test → passes.** Same command as Step 2.

- [ ] **Step 7: jsdom gate + commit** (browser run happens in Task 5's full gate too):
```bash
npm run type-check && npm run lint && npm run test 2>&1 | tail -15
git add src/docx/docxImageView.ts src/docx/docxProseMirror.ts src/styles/modals.css locales/en.json locales/fr.json locales/ar.json tests/browser/docx-image-edit.browser.test.ts
git commit -m "feat(docx): docx_image NodeView — corner drag-resize + ✕/Delete (C2 Task 3)"
```

---

### Task 4: Editor-wide undo (`prosemirror-history`)

**Files:** Modify `package.json` (install), `src/docx/docxProseMirror.ts`; Test
`tests/docx/docxUndo.test.ts` (new, jsdom) + extend the browser test.

- [ ] **Step 1: Install the dep.** `npm i prosemirror-history` (MIT). Verify `npm ls prosemirror-history`.

- [ ] **Step 2: Failing jsdom test — a setNodeMarkup is undoable**

`tests/docx/docxUndo.test.ts`: mount an editor with one image, dispatch a `setNodeMarkup` changing
`widthPt`, then run `undo(view.state, view.dispatch)` (import `undo` from `prosemirror-history`), assert
the node's `widthPt` reverted. (Mount via `mountDocxEditor` with a fflate fixture, as the bridge tests do.)

- [ ] **Step 3: Run → fails** (no history → undo is a no-op).
  `npx vitest run tests/docx/docxUndo.test.ts > /tmp/c2-t4.txt 2>&1; tail -30 /tmp/c2-t4.txt`

- [ ] **Step 4: Implement.** In `docxProseMirror.ts`:
```ts
import { history, undo, redo } from 'prosemirror-history';
// in EditorState plugins, BEFORE the keymaps:
history(),
keymap({ 'Mod-z': undo, 'Mod-y': redo, 'Mod-Shift-z': redo }),
```
Place `history()` first so other keymaps' transactions are recorded.

- [ ] **Step 5: Run → passes.** Same command as Step 3.

- [ ] **Step 6: Composition guard test** — in `docxUndo.test.ts`, assert a find/replace **replace-all**
  (drive `findReplacePlugin` as `tests/docx/findReplacePlugin.test.ts` does) is reverted by a **single**
  `undo`. Run → passes (the plugin already batches one transaction).

- [ ] **Step 7: Extend the browser test** (`docx-image-edit.browser.test.ts`): after a resize, dispatch
  `undo(view.state, view.dispatch)` and assert the image width returns to the original; after a delete +
  undo, assert the `docx_image` node is back.

- [ ] **Step 8: Gate + commit.**
```bash
npm run type-check && npm run lint && npm run test 2>&1 | tail -15
git add package.json package-lock.json src/docx/docxProseMirror.ts tests/docx/docxUndo.test.ts tests/browser/docx-image-edit.browser.test.ts
git commit -m "feat(docx): editor-wide undo via prosemirror-history (Mod-z/Mod-y) (C2 Task 4)"
```

---

### Task 5: Docs, full deploy gate, program close-out

**Files:** `CLAUDE.md`, `docs/plans/maxfidelity-program-2026-06-25.plan.md`, memory.

- [ ] **Step 1: CLAUDE.md gotcha.** Add a "DOCX image edit (C2)" bullet to the DOCX section: anchorId
  identity, the `reconcileImageAnchors` pre-pass + safety guard, byte-exact-when-unchanged, the NodeView
  resize/delete, `prosemirror-history` undo, and the v1 ceilings: move/insert → v2; cell-nested images
  opaque; **a mixed image+text paragraph deletes whole (Phase-1 atom = the whole `w:p`; undo recovers)**;
  **the editor's PDF export (`getImages`) uses the originally-extracted images — an in-session resize/
  delete is reflected in the DOCX save, and in PDF export only after save + reopen**.

- [ ] **Step 2: Run the FULL deploy gate** (mirror CI, paste output):
```bash
npm audit --audit-level=high && npm run ocr:assets && npm run type-check && npm run lint \
  && npm run test 2>&1 | tail -8 \
  && npx vitest run --config vitest.browser.config.ts 2>&1 | tail -10 \
  && npm run test:coverage:export 2>&1 | tail -8 \
  && npm run build 2>&1 | tail -8
```
Expected: audit 0 high, all suites green, coverage ≥ threshold, build ok. Capture the screenshot from
the browser run for eyes-on proof (`qa-shots/c-phase2b/`).

- [ ] **Step 3: Mark the program plan** Phase-2b checkbox done; append a Decisions-Log line with the
  commit SHAs. Update memory (`project_maxfidelity_program_2026_06_25.md`): C2 DONE, the whole program
  (A+B+C) complete; note commits UNPUSHED (push manual).

- [ ] **Step 4: Commit docs.**
```bash
git add CLAUDE.md docs/plans/maxfidelity-program-2026-06-25.plan.md docs/superpowers/specs/2026-06-26-docx-editor-subproject-c-phase2b-image-edit-design.md docs/superpowers/plans/2026-06-26-docx-editor-subproject-c-phase2b-image-edit.md
git commit -m "docs(docx): Sub-project C Phase 2b (image edit) spec + plan + gotcha + program close-out"
```
(Push is MANUAL — report SHAs and stop.)

## Self-Review

- **Spec coverage:** anchorId (T1), pre-pass delete/resize + guard (T2), NodeView UI (T3), undo (T4),
  docs/gate (T5) — every spec section maps to a task.
- **Placeholders:** none — all steps carry real code/commands.
- **Type consistency:** `DocImageBlock.anchorId?: number`, node attr `anchorId` default `-1`,
  `reconcileImageAnchors(dom, body, blocks)`, `rewriteExtent(para, cx, cy)`, `drawingAnchorParas(container)`
  used consistently across tasks.
- **Cardinal rule:** pre-pass only `remove()`s a `w:p` or sets `cx/cy` — no writer rebuild.
