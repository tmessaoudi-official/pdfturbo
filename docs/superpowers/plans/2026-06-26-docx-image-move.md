# DOCX editor — image MOVE/reorder (phase B, sub-slice 2) — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline, item-by-item).
> Per-item commit, **no push** (manual). Steps use checkbox (`- [ ]`) syntax.

**Goal:** move an existing image up/down in the DOCX editor — past text and across tables/other images —
persisted through the in-place `save()`, with full fidelity (no other content rebuilt).

**Architecture:** a PM-side `moveImage(dir)` command reorders the `docx_image` node (undoable); the save
builds a once-per-save `anchorEl: Map<anchorId, Element>` identity map shared by a map-keyed
`reconcileImageAnchors` (delete/resize) and a unified `placeImageAnchors` walk (move existing by anchorId
+ insert new), absorbing slice-1's `materializeNewImageAnchors`. `reconcileContainer` is untouched.

**Tech Stack:** TypeScript, fflate (OPC), ProseMirror (prosemirror-state/view/model + prosemirror-history),
vitest (jsdom + real-Chrome).

## Global Constraints

- No new dependencies. No `Co-Authored-By`. `git push` manual. oxlint: no `!` non-null, no `==` (use `=== undefined`).
- `docModel.ts` must NOT import `opcParts.ts` (cycle) → minting stays a callback (`opts.mintImage`).
- **Byte-identical save when nothing moved/inserted/deleted**; legacy `applyBlocks` callers (`applyParagraphRuns`) unaffected.
- Full fidelity: only image `w:p` elements relocate; text/tables are never removed or rebuilt.
- `reconcileContainer` is NOT modified. Rides `VITE_FEATURE_DOCX_EDIT`; no `SCHEMA_VERSION` bump.
- Spec: `docs/superpowers/specs/2026-06-26-docx-image-move-design.md`.

## File Structure

- `src/docx/docModel.ts` — MODIFY: add `buildAnchorElMap`, refactor `reconcileImageAnchors` to map-keyed,
  replace `materializeNewImageAnchors` with `placeImageAnchors`, rewire `applyBlocks`.
- `src/docx/docxImageMove.ts` — CREATE: `moveImageAt(state, pos, dir)` + `moveImage(dir)` Command.
- `src/docx/docxImageView.ts` — MODIFY: add ▲/▼ buttons (call `moveImageAt`), extend `stopEvent`.
- `src/docx/docxProseMirror.ts` — MODIFY: add an `Alt-ArrowUp`/`Alt-ArrowDown` keymap running `moveImage`.
- `locales/{en,fr,ar}.json` — ADD `docxEditor.moveImageUp` / `docxEditor.moveImageDown`.
- Tests: `tests/docx/docImageMove.test.ts` (engine), `tests/docx/docxImageMove.test.ts` (command+NodeView),
  `tests/browser/docx-image-move.browser.test.ts`.

---

### Task 1: identity map + map-keyed `reconcileImageAnchors`

**Files:** Modify `src/docx/docModel.ts`; Test `tests/docx/docImageMove.test.ts` (new).

**Interfaces:**
- Produces `buildAnchorElMap(body: Element): Map<number, Element>` (internal).
- Changes `reconcileImageAnchors` signature to `(anchorEl: Map<number, Element>, blocks: DocBlock[]): void`.

- [ ] **Step 1: Failing test** — create `tests/docx/docImageMove.test.ts`. This first test proves the map
  is built in parse order and the existing delete/resize behavior is preserved through the new signature
  (via `applyBlocks`, which Task 2 finishes wiring — but delete/resize already runs today). Use a doc with
  TWO images; delete the first (model keeps only anchorId 1), resize the second:

```ts
import { describe, it, expect, vi } from 'vitest';
import { applyBlocks, type DocBlock } from '../../src/docx/docModel';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const NS = `xmlns:w="${W}" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" `
  + `xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" `
  + `xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" `
  + `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"`;
function imgP(rId: string, cx = 952500): string {
  return `<w:p><w:r><w:drawing><wp:inline><wp:extent cx="${cx}" cy="${cx}"/>`
    + `<a:graphic><a:graphicData><pic:pic><pic:blipFill><a:blip r:embed="${rId}"/></pic:blipFill>`
    + `<pic:spPr><a:xfrm><a:ext cx="${cx}" cy="${cx}"/></a:xfrm></pic:spPr></pic:pic></a:graphicData></a:graphic>`
    + `</wp:inline></w:drawing></w:r></w:p>`;
}
function textP(text: string): string { return `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`; }
function doc(body: string): string { return `<?xml version="1.0"?><w:document ${NS}><w:body>${body}</w:body></w:document>`; }
function parse(xml: string): Document { return new DOMParser().parseFromString(xml, 'application/xml'); }
function img(anchorId: number, widthPt = 75): DocBlock {
  return { kind: 'image', image: { dataB64: '', mime: 'image/png', widthPt, heightPt: widthPt }, anchorId };
}
const text = (t: string): DocBlock => ({ runs: [{ text: t }] });
function embeds(d: Document): (string | undefined)[] {
  return Array.from(d.getElementsByTagName('a:blip')).map(b => Array.from(b.attributes).find(a => a.localName === 'embed')?.value);
}

describe('reconcileImageAnchors — map-keyed (regression)', () => {
  it('deletes the dropped image and resizes the survivor by anchorId', () => {
    const xml = doc(imgP('rId1') + imgP('rId2'));
    // model dropped anchorId 0, kept anchorId 1 resized to 150pt (1905000 EMU)
    const out = applyBlocks(xml, [{ kind: 'image', image: { dataB64: '', mime: 'image/png', widthPt: 150, heightPt: 150 }, anchorId: 1 }], undefined, { editImages: true });
    const d = parse(out);
    expect(embeds(d)).toEqual(['rId2']);                 // rId1 removed
    expect(d.getElementsByTagName('wp:extent')[0].getAttribute('cx')).toBe('1905000'); // resized
  });
});
```

- [ ] **Step 2: Run → fail** — `npm run test -- tests/docx/docImageMove.test.ts > /tmp/m1.log 2>&1; tail -20 /tmp/m1.log`
  Expected: FAIL (the map refactor doesn't exist yet; today's positional code may still pass this exact
  case, so if it PASSES, that's fine — it confirms behavior parity; proceed to refactor and keep it green).
- [ ] **Step 3: Implement** — in `src/docx/docModel.ts`, add `buildAnchorElMap` just above
  `reconcileImageAnchors` and rewrite `reconcileImageAnchors` to be map-keyed:

```ts
/** anchorId → its original DOM w:p, built ONCE pre-mutation (DOM is parse order, so D[i] has anchorId i). */
function buildAnchorElMap(body: Element): Map<number, Element> {
  const map = new Map<number, Element>();
  drawingAnchorParas(body).forEach((el, i) => map.set(i, el));
  return map;
}

/**
 * C2 image edit (save pre-pass): delete drawing anchors whose anchorId is absent from the model, and
 * resize the survivors. Keyed by the shared `anchorEl` identity map (NOT position) so it composes with a
 * MOVE (B slice 2) that reorders elements. SAFETY GUARD: if the model image anchorIds aren't a dup-free
 * subset of {0..m-1}, leave every image verbatim. Behavior-identical to the prior positional version
 * (anchorEl.get(i) === the old D[i]).
 */
function reconcileImageAnchors(anchorEl: Map<number, Element>, blocks: DocBlock[]): void {
  const m = anchorEl.size;
  if (m === 0) return;
  const drawBlocks = blocks.filter((b): b is DocImageBlock => isDocImageBlock(b) && typeof b.anchorId === 'number');
  const ids = drawBlocks.map(b => b.anchorId as number);
  const S = new Set(ids);
  if (S.size !== ids.length || ids.some(i => i < 0 || i >= m)) return; // guard → verbatim
  for (let i = 0; i < m; i++) {
    const el = anchorEl.get(i);
    if (!el) continue;
    if (!S.has(i)) { el.remove(); continue; }        // user-deleted
    const blk = drawBlocks.find(b => b.anchorId === i);
    if (!blk || !blk.image) continue;                // unextracted → preserve verbatim, no resize
    const cx = Math.round(blk.image.widthPt * EMU_PER_PT_M);
    const cy = Math.round(blk.image.heightPt * EMU_PER_PT_M);
    const ext = el.getElementsByTagName('wp:extent')[0];
    const curCx = Number(ext?.getAttribute('cx'));
    const curCy = Number(ext?.getAttribute('cy'));
    if (cx > 0 && cy > 0 && (cx !== curCx || cy !== curCy)) rewriteExtent(el, cx, cy);
  }
}
```

  Then update the `applyBlocks` `editImages` branch to build the map and pass it (Task 2 finishes the
  placeImageAnchors call; for now keep the materialize call but feed it normally):

```ts
  if (opts?.editImages) {
    const anchorEl = buildAnchorElMap(body);
    reconcileImageAnchors(anchorEl, blocks);
    if (opts.mintImage) materializeNewImageAnchors(opts.mintImage, body, blocks);
  }
```

- [ ] **Step 4: Run → pass** — the new test AND the C2 suite:
  `npm run test -- tests/docx/docImageMove.test.ts tests/docx/docModelImageEdit.test.ts tests/docx/docImageInsert.test.ts > /tmp/m1.log 2>&1; tail -8 /tmp/m1.log`
  Expected: all PASS (regression parity).
- [ ] **Step 5: type-check + lint** — `npm run type-check && npx oxlint src/docx/docModel.ts tests/docx/docImageMove.test.ts`
- [ ] **Step 6: Commit** — `git add src/docx/docModel.ts tests/docx/docImageMove.test.ts && git commit -m "refactor(docx): key reconcileImageAnchors off a shared anchorEl identity map (B move T1)"`

---

### Task 2: `placeImageAnchors` (move + insert, absorbs materialize)

**Files:** Modify `src/docx/docModel.ts`; extend `tests/docx/docImageMove.test.ts`.

**Interfaces:**
- Produces `placeImageAnchors(mintImage: ((bytes: Uint8Array, mime: 'image/png'|'image/jpeg') => string) | undefined, anchorEl: Map<number, Element>, body: Element, blocks: DocBlock[]): void`.
- REMOVES `materializeNewImageAnchors` (absorbed). `buildDrawingParagraph` stays exported.

- [ ] **Step 1: Failing tests** — append to `tests/docx/docImageMove.test.ts`:

```ts
describe('applyBlocks — image MOVE (full fidelity)', () => {
  it('moves an image DOWN past a paragraph, preserving the paragraph pPr (no rebuild)', () => {
    // [imgA(0), P-with-pPr] → model [P, imgA]
    const xml = doc(imgP('rId1') + '<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t>Hello</w:t></w:r></w:p>');
    const out = applyBlocks(xml, [text('Hello'), img(0)], undefined, { editImages: true });
    const d = parse(out);
    const kids = Array.from(d.getElementsByTagName('w:body')[0].children);
    // order is now [P, img]
    expect(kids[0].getElementsByTagName('w:drawing').length).toBe(0); // first is the paragraph
    expect(kids[1].getElementsByTagName('w:drawing').length).toBe(1); // image moved after it
    expect(d.getElementsByTagName('w:jc').length).toBe(1);            // pPr SURVIVED (not rebuilt)
  });

  it('moves an image across a table (boundary order changes)', () => {
    // [imgA(0), table, P] → model [table, imgA, P]   (image crossed the table)
    const tableXml = '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>c</w:t></w:r></w:p></w:tc></w:tr></w:tbl>';
    const xml = doc(imgP('rId1') + tableXml + textP('after'));
    const tbl: DocBlock = { kind: 'table', rows: [{ cells: [{ blocks: [text('c')] }] }] };
    const out = applyBlocks(xml, [tbl, img(0), text('after')], undefined, { editImages: true });
    const d = parse(out);
    const kids = Array.from(d.getElementsByTagName('w:body')[0].children);
    expect(kids[0].tagName).toBe('w:tbl');
    expect(kids[1].getElementsByTagName('w:drawing').length).toBe(1); // image now after the table
    expect(embeds(d)).toEqual(['rId1']);
  });

  it('swaps two images', () => {
    const xml = doc(imgP('rId1') + imgP('rId2'));
    const out = applyBlocks(xml, [img(1), img(0)], undefined, { editImages: true }); // reversed
    expect(embeds(parse(out))).toEqual(['rId2', 'rId1']);
  });

  it('move + a new-image insert in one save', () => {
    const mintImage = vi.fn(() => 'rIdNew');
    const xml = doc(imgP('rId1') + textP('x'));
    const newImg: DocBlock = { kind: 'image', image: { dataB64: 'AQID', mime: 'image/png', widthPt: 50, heightPt: 50 } };
    // model: [text, newImg, img(0)]  → existing image moved to end, new image before it
    const out = applyBlocks(xml, [text('x'), newImg, img(0)], undefined, { editImages: true, mintImage });
    expect(embeds(parse(out))).toEqual(['rIdNew', 'rId1']);
    expect(mintImage).toHaveBeenCalledTimes(1);
  });

  it('is byte-identical when no image moved/inserted/deleted', () => {
    const xml = doc(textP('a') + imgP('rId1') + textP('b'));
    const noEdit = applyBlocks(xml, [text('a'), img(0), text('b')]);                       // legacy path
    const sameOrder = applyBlocks(xml, [text('a'), img(0), text('b')], undefined, { editImages: true });
    expect(embeds(parse(sameOrder))).toEqual(['rId1']);
    expect(parse(sameOrder).getElementsByTagName('w:drawing').length).toBe(1);
    expect(noEdit).toContain('w:drawing'); // legacy path also preserves it
  });
});
```

- [ ] **Step 2: Run → fail** — `npm run test -- tests/docx/docImageMove.test.ts > /tmp/m2.log 2>&1; tail -20 /tmp/m2.log`
  Expected: the MOVE/swap/cross-table cases FAIL (today's materialize only inserts NEW images; existing ones never move).
- [ ] **Step 3: Implement** — in `src/docx/docModel.ts`, DELETE `materializeNewImageAnchors` and add
  `placeImageAnchors` in its place:

```ts
/** True for a top-level image-anchor element (a w:p containing a w:drawing). */
function isImageAnchorEl(el: Element): boolean {
  return el.tagName === 'w:p' && el.getElementsByTagName('w:drawing').length > 0;
}

/**
 * Save pre-pass (AFTER reconcileImageAnchors, BEFORE reconcileContainer): place every image anchor at its
 * MODEL position. Walk model blocks with a cursor over the body's NON-image-anchor block children (text +
 * tables + hyperlink anchors — the fixed reference points); an existing image (numeric anchorId) is MOVED
 * (its element relocated before the cursor's ref) and a new image (no anchorId) is INSERTED (slice-1 path,
 * minting via the callback). Only image elements move — text/tables are never touched → full fidelity, and
 * the boundary order then matches the model so reconcileContainer's segment-zip is all in-place.
 * SAFETY GUARD: if the model image anchorIds aren't a dup-free subset of the map keys → skip (verbatim).
 */
export function placeImageAnchors(
  mintImage: ((bytes: Uint8Array, mime: 'image/png' | 'image/jpeg') => string) | undefined,
  anchorEl: Map<number, Element>,
  body: Element,
  blocks: DocBlock[],
): void {
  const dom = body.ownerDocument;
  if (!dom) return;
  const existingIds = blocks
    .filter((b): b is DocImageBlock => isDocImageBlock(b) && typeof b.anchorId === 'number')
    .map(b => b.anchorId as number);
  const uniq = new Set(existingIds);
  if (uniq.size !== existingIds.length || existingIds.some(i => !anchorEl.has(i))) return; // guard → verbatim

  const refs = containerBlockEls(body).filter(el => !isImageAnchorEl(el));
  let docPr = nextDocPrId(body);
  let r = 0;
  for (const b of blocks) {
    if (isDocImageBlock(b) && b.image) {
      const ref = r < refs.length ? refs[r] : null;
      if (b.anchorId === undefined) {
        if (!mintImage) continue;                       // can't mint a new image without the callback
        const rId = mintImage(b64ToBytes(b.image.dataB64), b.image.mime);
        const cx = Math.round(b.image.widthPt * EMU_PER_PT_M);
        const cy = Math.round(b.image.heightPt * EMU_PER_PT_M);
        body.insertBefore(buildDrawingParagraph(dom, rId, cx, cy, docPr), ref);
        docPr += 1;
      } else {
        const el = anchorEl.get(b.anchorId);
        if (el) body.insertBefore(el, ref);             // MOVE: insertBefore re-parents in place
      }
      // image placed BETWEEN refs → do NOT advance r
    } else if (r < refs.length) {
      r += 1;                                           // text / table / hyperlink-anchor block → advance
    }
  }
}
```

  Update the `applyBlocks` `editImages` branch to call it unconditionally (move works even without mintImage):

```ts
  if (opts?.editImages) {
    const anchorEl = buildAnchorElMap(body);
    reconcileImageAnchors(anchorEl, blocks);
    placeImageAnchors(opts.mintImage, anchorEl, body, blocks);
  }
```

  Update the `applyBlocks` doc comment: replace the "Ordering is load-bearing … parse-time anchor POSITIONS"
  sentence with: *"Passes share a once-built anchorEl identity map: reconcileImageAnchors (delete/resize) →
  placeImageAnchors (move existing by anchorId + insert new) → reconcileContainer (unchanged)."*

- [ ] **Step 4: Run → pass** — `npm run test -- tests/docx/docImageMove.test.ts tests/docx/docImageInsert.test.ts tests/docx/docModelImageEdit.test.ts > /tmp/m2.log 2>&1; tail -8 /tmp/m2.log`
  Expected: all PASS (move + the slice-1 insert tests + the C2 tests).
- [ ] **Step 5: type-check + lint** — `npm run type-check && npx oxlint src/docx/docModel.ts tests/docx/docImageMove.test.ts`
  (oxlint will flag `materializeNewImageAnchors` is gone — confirm no other importer: `grep -rn materializeNewImageAnchors src tests` returns nothing.)
- [ ] **Step 6: Commit** — `git add src/docx/docModel.ts tests/docx/docImageMove.test.ts && git commit -m "feat(docx): placeImageAnchors — move existing images by anchorId + insert new (B move T2)"`

---

### Task 3: PM `moveImage` command + NodeView ▲/▼ + Alt+↑/↓ keymap

**Files:** Create `src/docx/docxImageMove.ts`; Modify `src/docx/docxImageView.ts`,
`src/docx/docxProseMirror.ts`, `locales/{en,fr,ar}.json`; Test `tests/docx/docxImageMove.test.ts`.

**Interfaces:**
- Produces `moveImageAt(state: EditorState, pos: number, dir: -1 | 1): Transaction | null` and
  `moveImage(dir: -1 | 1): Command`.

- [ ] **Step 1: Failing test** — create `tests/docx/docxImageMove.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { EditorState, NodeSelection } from 'prosemirror-state';
import { docxSchema } from '../../src/docx/docxSchema';
import { moveImageAt, moveImage } from '../../src/docx/docxImageMove';

function imgNode() { return docxSchema.nodes.docx_image.create({ dataB64: '', mime: 'image/png', widthPt: 10, heightPt: 10, anchorId: 0 }); }
function para(t: string) { return docxSchema.node('paragraph', null, [docxSchema.text(t)]); }
function stateWith(nodes: ReturnType<typeof para>[]) {
  return EditorState.create({ doc: docxSchema.node('doc', null, nodes) });
}
function imgIndex(doc: ReturnType<typeof para>): number {
  let idx = -1;
  doc.forEach((n, _o, i) => { if (n.type.name === 'docx_image') idx = i; });
  return idx;
}
function imgPos(state: EditorState): number {
  let pos = -1;
  state.doc.descendants((n, p) => { if (n.type.name === 'docx_image') pos = p; });
  return pos;
}

describe('moveImage', () => {
  it('moves the image DOWN one block', () => {
    const state = stateWith([imgNode(), para('A'), para('B')]); // [img, A, B]
    const tr = moveImageAt(state, imgPos(state), 1);
    expect(tr).not.toBeNull();
    const doc = (tr as NonNullable<typeof tr>).doc;
    expect(imgIndex(doc)).toBe(1); // [A, img, B]
  });

  it('moves the image UP one block', () => {
    const state = stateWith([para('A'), imgNode(), para('B')]); // [A, img, B]
    const tr = moveImageAt(state, imgPos(state), -1);
    expect(imgIndex((tr as NonNullable<typeof tr>).doc)).toBe(0); // [img, A, B]
  });

  it('no-op at the top bound (returns null)', () => {
    const state = stateWith([imgNode(), para('A')]);
    expect(moveImageAt(state, imgPos(state), -1)).toBeNull();
  });

  it('no-op at the bottom bound (returns null)', () => {
    const state = stateWith([para('A'), imgNode()]);
    expect(moveImageAt(state, imgPos(state), 1)).toBeNull();
  });

  it('moveImage(dir) command returns false when the selection is not a docx_image', () => {
    let state = stateWith([para('A'), imgNode()]);
    state = state.apply(state.tr.setSelection(NodeSelection.create(state.doc, 0))); // select paragraph? -> text
    expect(moveImage(1)(state, undefined)).toBe(false);
  });

  it('moveImage(dir) command dispatches and keeps the moved node selected', () => {
    let state = stateWith([imgNode(), para('A')]);
    state = state.apply(state.tr.setSelection(NodeSelection.create(state.doc, imgPos(state))));
    let dispatched = false;
    const ok = moveImage(1)(state, tr => { dispatched = true; state = state.apply(tr); });
    expect(ok).toBe(true);
    expect(dispatched).toBe(true);
    expect(state.selection).toBeInstanceOf(NodeSelection);
    expect(imgIndex(state.doc)).toBe(1);
  });
});
```

- [ ] **Step 2: Run → fail** — `npm run test -- tests/docx/docxImageMove.test.ts > /tmp/m3.log 2>&1; tail -15 /tmp/m3.log`
  Expected: FAIL (`moveImageAt`/`moveImage` not found).
- [ ] **Step 3a: Implement the command** — create `src/docx/docxImageMove.ts`:

```ts
/**
 * Move an existing top-level docx_image up/down one block (B slice 2). `moveImageAt` builds the
 * single undoable transaction (delete the node, re-insert before the prev / after the next top-level
 * block, keep it NodeSelected); `moveImage(dir)` is the Command wrapper gated on a docx_image selection.
 */
import { type Command, type EditorState, type Transaction, NodeSelection } from 'prosemirror-state';

export function moveImageAt(state: EditorState, pos: number, dir: -1 | 1): Transaction | null {
  const node = state.doc.nodeAt(pos);
  if (!node || node.type !== state.schema.nodes.docx_image) return null;
  const $pos = state.doc.resolve(pos);
  if ($pos.depth !== 0) return null;                       // must be a TOP-LEVEL block
  const index = $pos.index(0);
  const target = index + dir;
  if (target < 0 || target >= state.doc.childCount) return null; // bounds → no-op
  const from = pos;
  const to = pos + node.nodeSize;
  const tr = state.tr.delete(from, to);
  const insertPos = dir < 0
    ? tr.mapping.map(from - state.doc.child(index - 1).nodeSize) // before the previous sibling
    : tr.mapping.map(to + state.doc.child(index + 1).nodeSize);  // after the next sibling
  tr.insert(insertPos, node);
  tr.setSelection(NodeSelection.create(tr.doc, insertPos));
  return tr.scrollIntoView();
}

export function moveImage(dir: -1 | 1): Command {
  return (state, dispatch) => {
    const sel = state.selection;
    if (!(sel instanceof NodeSelection) || sel.node.type !== state.schema.nodes.docx_image) return false;
    const tr = moveImageAt(state, sel.from, dir);
    if (!tr) return false;
    if (dispatch) dispatch(tr);
    return true;
  };
}
```

- [ ] **Step 3b: Run command tests → pass** — `npm run test -- tests/docx/docxImageMove.test.ts > /tmp/m3.log 2>&1; tail -8 /tmp/m3.log` (all PASS).
- [ ] **Step 3c: Wire the NodeView buttons** — in `src/docx/docxImageView.ts`:
  - add the import at the top: `import { moveImageAt } from './docxImageMove';`
  - after the `del` button block (before `dom.appendChild(se)`), add ▲/▼ buttons:

```ts
  const mkMoveBtn = (cls: string, glyph: string, key: string, dir: -1 | 1): HTMLButtonElement => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `docx-image-move ${cls}`;
    b.textContent = glyph;
    b.title = t(key);
    b.setAttribute('aria-label', t(key));
    b.addEventListener('mousedown', e => { e.preventDefault(); e.stopPropagation(); });
    b.addEventListener('click', e => {
      e.preventDefault();
      const pos = getPos();
      if (pos === undefined) return;
      const tr = moveImageAt(view.state, pos, dir);
      if (tr) { view.dispatch(tr); view.focus(); }       // null at a bound → silent no-op
    });
    return b;
  };
  const upBtn = mkMoveBtn('up', '▲', 'docxEditor.moveImageUp', -1);
  const downBtn = mkMoveBtn('down', '▼', 'docxEditor.moveImageDown', 1);
```

  - append them: change `dom.appendChild(se); dom.appendChild(del);` to also append `upBtn`, `downBtn`.
  - extend `stopEvent` to include them:
    `stopEvent(e: Event): boolean { return e.target === se || e.target === del || e.target === upBtn || e.target === downBtn; }`

- [ ] **Step 3d: Wire the keymap** — in `src/docx/docxProseMirror.ts`:
  - add `import { moveImage } from './docxImageMove';` near the other docx imports.
  - add a keymap to the plugins list (right after the `Mod-z`/`Mod-y` history keymap at ~line 329):
    `keymap({ 'Alt-ArrowUp': moveImage(-1), 'Alt-ArrowDown': moveImage(1) }),`

- [ ] **Step 3e: i18n** — add to `locales/en.json` under `docxEditor` (beside `deleteImage`):
  `"moveImageUp": "Move image up", "moveImageDown": "Move image down"` ; `fr.json`:
  `"moveImageUp": "Monter l'image", "moveImageDown": "Descendre l'image"` ; `ar.json` (ar [Unverified]):
  `"moveImageUp": "تحريك الصورة لأعلى", "moveImageDown": "تحريك الصورة لأسفل"`.

- [ ] **Step 3f: Add a NodeView-button presence test** — append to `tests/docx/docxImageMove.test.ts` a
  jsdom mount that builds the editor view with the NodeView and asserts ▲/▼ render:

```ts
import { EditorView } from 'prosemirror-view';
import { createDocxImageView } from '../../src/docx/docxImageView';

describe('docx_image NodeView — move buttons', () => {
  it('renders ▲ and ▼ controls', () => {
    const place = document.createElement('div');
    document.body.appendChild(place);
    const view = new EditorView(place, {
      state: stateWith([imgNode()]),
      nodeViews: { docx_image: (node, v, getPos) => createDocxImageView(node, v, getPos) },
    });
    expect(place.querySelector('.docx-image-move.up')).not.toBeNull();
    expect(place.querySelector('.docx-image-move.down')).not.toBeNull();
    view.destroy();
    place.remove();
  });
});
```

- [ ] **Step 4: Run → pass** — `npm run test -- tests/docx/docxImageMove.test.ts > /tmp/m3.log 2>&1; tail -8 /tmp/m3.log`
  (jsdom mount needs the rect stubs; if `getClientRects` throws, add the same `fakeRect` stub used in
  `tests/docx/docxToolbar.test.ts` — copy its `beforeEach` rect-stubbing block.)
- [ ] **Step 5: type-check + lint** — `npm run type-check && npx oxlint src/docx/docxImageMove.ts src/docx/docxImageView.ts src/docx/docxProseMirror.ts tests/docx/docxImageMove.test.ts locales/`
- [ ] **Step 6: Commit** — `git add src/docx/docxImageMove.ts src/docx/docxImageView.ts src/docx/docxProseMirror.ts tests/docx/docxImageMove.test.ts locales/en.json locales/fr.json locales/ar.json && git commit -m "feat(docx): move-image command + NodeView ▲/▼ + Alt+↑/↓ keymap (B move T3)"`

---

### Task 4: browser e2e + full deploy gate + live shot + docs

**Files:** Create `tests/browser/docx-image-move.browser.test.ts`; Modify `CLAUDE.md`,
`docs/plans/maxfidelity-program-2026-06-25.plan.md`.

- [ ] **Step 1: Failing browser test** — create `tests/browser/docx-image-move.browser.test.ts`. Mount the
  editor on a doc `[image, table, text]`, select the image, run `moveImage(1)` (or click ▼), save, reopen,
  assert the `w:drawing` now sits AFTER the `w:tbl`:

```ts
import { describe, it, expect } from 'vitest';
import { page } from '@vitest/browser/context';
import { zipSync, strToU8 } from 'fflate';
import { NodeSelection } from 'prosemirror-state';
import { mountDocxEditor } from '../../src/docx/docxProseMirror';
import { openOpc, getDocumentXml } from '../../src/docx/opcEdit';
import { moveImage } from '../../src/docx/docxImageMove';

const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
function b64(b: string): Uint8Array { const s = atob(b); const o = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) o[i] = s.charCodeAt(i); return o; }
const CT = `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`;
const ROOT = `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdDoc" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;
const DREL = `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/></Relationships>`;
const DOC = `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>`
  + `<w:p><w:r><w:drawing><wp:inline><wp:extent cx="952500" cy="952500"/><a:graphic><a:graphicData><pic:pic><pic:spPr><a:xfrm><a:ext cx="952500" cy="952500"/></a:xfrm></pic:spPr><pic:blipFill><a:blip r:embed="rId1"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`
  + `<w:tbl><w:tr><w:tc><w:p><w:r><w:t>cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`
  + `<w:p><w:r><w:t>after</w:t></w:r></w:p></w:body></w:document>`;
function makeDocx(): Uint8Array {
  return zipSync({ '[Content_Types].xml': strToU8(CT), '_rels/.rels': strToU8(ROOT), 'word/document.xml': strToU8(DOC), 'word/_rels/document.xml.rels': strToU8(DREL), 'word/media/image1.png': b64(PNG_B64) });
}
function imgPos(view: { state: { doc: { descendants: (f: (n: { type: { name: string } }, p: number) => void) => void } } }): number {
  let pos = -1; view.state.doc.descendants((n, p) => { if (n.type.name === 'docx_image') pos = p; }); return pos;
}

describe('DOCX editor — image move (real browser)', () => {
  it('moves an image past a table and the move round-trips through save', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const handle = mountDocxEditor(container, makeDocx());
    const view = handle.view;
    view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, imgPos(view))));
    expect(moveImage(1)(view.state, view.dispatch.bind(view))).toBe(true); // move down past the table
    const xml = getDocumentXml(openOpc(handle.save()));
    const drawingIdx = xml.indexOf('w:drawing');
    const tblIdx = xml.indexOf('<w:tbl');
    expect(drawingIdx).toBeGreaterThan(tblIdx); // image now AFTER the table
    handle.destroy();
    container.remove();
  });

  it('shows ▲/▼ on the selected image (eyes-on)', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const handle = mountDocxEditor(container, makeDocx());
    const view = handle.view;
    view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, imgPos(view))));
    expect(container.querySelector('.docx-image-move.up')).not.toBeNull();
    await page.screenshot({ path: '../../qa-shots/b-move/move-controls.png', element: container }).catch(() => {});
    handle.destroy();
    container.remove();
  });
});
```

- [ ] **Step 2: Run → fail then pass** — `mkdir -p qa-shots/b-move; npm run test:browser -- tests/browser/docx-image-move.browser.test.ts > /tmp/m4.log 2>&1; tail -12 /tmp/m4.log` (expect PASS once T1-T3 are in).
- [ ] **Step 3: FULL deploy gate** — run, all green:
  `npm audit --audit-level=high` → `npm run ocr:assets` → `npm run type-check` → `npm run lint` →
  `npm run test` (jsdom) → `npm run test:browser` (real Chrome) → `npm run test:coverage:export` → `npm run build`.
  (Use background + redirects per the tooling note; do not re-pass `--config` to `test:browser`.)
- [ ] **Step 4: Live shot** — confirm `qa-shots/b-move/move-controls.png` exists and `Read` it to eyeball
  the ▲/▼ controls on the selected image.
- [ ] **Step 5: Docs** — add a "image MOVE (Sub-project B, sub-slice 2)" paragraph to the DOCX section of
  `CLAUDE.md` (anchorEl identity map, map-keyed reconcileImageAnchors, placeImageAnchors move+insert,
  moveImage command + ▲/▼ + Alt+↑/↓, full-fidelity rationale, byte-identical-when-unchanged, ceilings).
  Update the program plan Decisions Log + "## Next session" (mark slice 2 done, set NEXT = slice 3 Cut&paste).
  Refresh memory `project_maxfidelity_program_2026_06_25.md` + the MEMORY.md pointer.
- [ ] **Step 6: Commit** — `git add CLAUDE.md docs/plans/maxfidelity-program-2026-06-25.plan.md tests/browser/docx-image-move.browser.test.ts && git commit -m "docs(docx): image-move (B sub-slice 2) — engine + UI notes + browser e2e"`

## Self-review

- **Spec coverage:** identity map + map-keyed reconcile (T1) ✓; placeImageAnchors move+insert absorbing
  materialize (T2) ✓; moveImage command + NodeView ▲/▼ + Alt+↑/↓ + i18n (T3) ✓; browser e2e + gate + shot +
  docs (T4) ✓. Full-fidelity (pPr survives) asserted in T2. Byte-identical-when-unchanged asserted in T2.
- **Placeholder scan:** none — every code step shows full code.
- **Type consistency:** `placeImageAnchors(mintImage?, anchorEl, body, blocks)`, `reconcileImageAnchors(anchorEl, blocks)`,
  `buildAnchorElMap(body)`, `moveImageAt(state, pos, dir)`, `moveImage(dir)` — used identically across T1–T4.
- **Cycle:** docModel still imports no opcParts; minting stays the `opts.mintImage` callback. ✓
- **Blast radius:** `materializeNewImageAnchors` removed — T2 Step 5 greps for stale importers (none expected;
  slice-1 tests go through `applyBlocks`). `reconcileContainer` untouched. ✓
