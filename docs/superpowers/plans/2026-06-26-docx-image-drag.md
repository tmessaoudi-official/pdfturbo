# DOCX editor — image Drag-to-reorder (B sub-slice 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drag an image with the pointer to reorder it among top-level blocks, with a live drop-indicator line, persisted through the in-place `save()`.

**Architecture:** A custom pointer drag on the image `<img>` body (the resize/✕/▲▼ children keep their own events). On drop, snap to the nearest top-level block gap and dispatch a generalized move (`moveImageToGap`) — the slice-2 `placeImageAnchors` save path relocates the `w:drawing` by `anchorId`, unchanged. New pure helpers: `moveImageToGap` (generalizes `moveImageAt`'s ±1) + `dropTargetIndex`.

**Tech Stack:** TypeScript, ProseMirror (model/state/view), vitest (jsdom + @vitest/browser real Chrome).

## Global Constraints

- Cardinal DOCX rule: edit `word/document.xml` in place, never rebuild via the docx writer.
- No new dependency; no `SCHEMA_VERSION` bump; rides `VITE_FEATURE_DOCX_EDIT` (no new flag).
- `docModel.ts` must NOT import `opcParts.ts`.
- oxlint: no non-null `!`, no `==` (use `=== undefined`/`=== null`); avoid `as any` (localize casts).
- Per-item commit pre-authorized; **push is MANUAL**. No `Co-Authored-By` trailer.
- Drag threshold = 5px; px→pt = ×0.75; drop-indicator is a single reused 2px line, `pointer-events:none`.
- Top-level blocks only (cell images opaque); one move = one `prosemirror-history` undo step.

---

### Task 1: `moveImageToGap` + refactor `moveImageAt`

**Files:**
- Modify: `src/docx/docxImageMove.ts`
- Test: `tests/docx/docxImageMove.test.ts` (extend)

**Interfaces:**
- Consumes: `EditorState`/`Transaction`/`NodeSelection` (prosemirror-state).
- Produces: `moveImageToGap(state, pos, gap): Transaction | null` — moves the docx_image at `pos` so it sits before the original top-level child at index `gap` (`gap === childCount` → document end); null if `gap` is the image's own gap or the node isn't a top-level docx_image. `moveImageAt` is refactored to delegate.

- [ ] **Step 1: Write the failing tests (append to tests/docx/docxImageMove.test.ts)**

```ts
import { moveImageToGap } from '../../src/docx/docxImageMove';

describe('moveImageToGap', () => {
  it('moves the image to the FRONT (gap 0)', () => {
    const state = stateWith([para('A'), para('B'), imgNode()]); // [A, B, img], ci=2
    const tr = moveImageToGap(state, imgPos(state), 0);
    expect(imgIndex((tr as NonNullable<typeof tr>).doc)).toBe(0); // [img, A, B]
  });
  it('moves the image to the END (gap === childCount)', () => {
    const state = stateWith([imgNode(), para('A'), para('B')]); // [img, A, B], ci=0
    const tr = moveImageToGap(state, imgPos(state), 3);
    expect(imgIndex((tr as NonNullable<typeof tr>).doc)).toBe(2); // [A, B, img]
  });
  it('moves the image to a MIDDLE gap', () => {
    const state = stateWith([imgNode(), para('A'), para('B')]); // [img, A, B], ci=0
    const tr = moveImageToGap(state, imgPos(state), 2); // before original child 2 (B)
    expect(imgIndex((tr as NonNullable<typeof tr>).doc)).toBe(1); // [A, img, B]
  });
  it('returns null for the image OWN gap (g === ci and g === ci+1)', () => {
    const state = stateWith([para('A'), imgNode(), para('B')]); // ci=1
    expect(moveImageToGap(state, imgPos(state), 1)).toBeNull(); // g === ci
    expect(moveImageToGap(state, imgPos(state), 2)).toBeNull(); // g === ci+1
  });
  it('clamps an out-of-range gap', () => {
    const state = stateWith([imgNode(), para('A')]); // ci=0, childCount=2
    expect(moveImageToGap(state, imgPos(state), 99)).not.toBeNull(); // clamps to end
    expect(moveImageToGap(state, imgPos(state), -5)).toBeNull();     // clamps to 0 === ci → no-op
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- docxImageMove > /tmp/d1.log 2>&1; tail -25 /tmp/d1.log`
Expected: FAIL — `moveImageToGap` not exported.

- [ ] **Step 3: Implement `moveImageToGap` + refactor `moveImageAt`**

Replace the body of `src/docx/docxImageMove.ts` with:

```ts
/**
 * Move an existing top-level docx_image among the top-level blocks (B slices 2 + 4).
 * `moveImageToGap` is the general mover (to an arbitrary block gap); `moveImageAt` is the ±1 wrapper
 * (▲/▼ + Alt+↑/↓); `moveImage(dir)` is the Command. All build ONE undoable transaction and keep the
 * node NodeSelected. The save path (`placeImageAnchors`) relocates the w:drawing by anchorId.
 */
import { type Command, type EditorState, type Transaction, NodeSelection } from 'prosemirror-state';

/** Document position of the start of top-level child `index` (Σ nodeSize of children before it). */
function topLevelChildStart(state: EditorState, index: number): number {
  let p = 0;
  for (let j = 0; j < index; j++) p += state.doc.child(j).nodeSize;
  return p;
}

// gap g ∈ [0, childCount]: insert the image BEFORE the original top-level child at index g
// (g === childCount → document end). No-op (null) when g is the image's own gap (g === ci || g === ci+1).
export function moveImageToGap(state: EditorState, pos: number, gap: number): Transaction | null {
  const node = state.doc.nodeAt(pos);
  if (!node || node.type !== state.schema.nodes.docx_image) return null;
  const $pos = state.doc.resolve(pos);
  if ($pos.depth !== 0) return null;                       // must be a TOP-LEVEL block
  const ci = $pos.index(0);
  const childCount = state.doc.childCount;
  const g = Math.max(0, Math.min(gap, childCount));
  if (g === ci || g === ci + 1) return null;               // dropping in its own gap → no-op
  const gapPos = g >= childCount ? state.doc.content.size : topLevelChildStart(state, g);
  const tr = state.tr.delete(pos, pos + node.nodeSize);
  const insertPos = tr.mapping.map(gapPos);
  tr.insert(insertPos, node);
  tr.setSelection(NodeSelection.create(tr.doc, insertPos));
  return tr.scrollIntoView();
}

export function moveImageAt(state: EditorState, pos: number, dir: -1 | 1): Transaction | null {
  const $pos = state.doc.resolve(pos);
  if ($pos.depth !== 0) return null;
  const ci = $pos.index(0);
  // dir -1 → gap ci-1 (before previous sibling); dir +1 → gap ci+2 (after next sibling).
  return moveImageToGap(state, pos, ci + (dir < 0 ? -1 : 2));
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

- [ ] **Step 4: Run tests to verify they pass (new + slice-2 regression)**

Run: `npm run test -- docxImageMove > /tmp/d1.log 2>&1; tail -10 /tmp/d1.log`
Expected: PASS — `moveImageToGap` (5 new) + the existing slice-2 `moveImage` / NodeView cases.

- [ ] **Step 5: Commit**

```bash
git add src/docx/docxImageMove.ts tests/docx/docxImageMove.test.ts
git commit -q -m "feat(docx): moveImageToGap general mover + moveImageAt refactor (B drag T1)"
```

---

### Task 2: `dropTargetIndex`

**Files:**
- Modify: `src/docx/docxImageMove.ts`
- Test: `tests/docx/docxImageMove.test.ts` (extend)

**Interfaces:**
- Consumes: `EditorView` (prosemirror-view), `EditorState`.
- Produces: `dropTargetIndex(view, clientY): number` — the top-level gap (∈ [0, childCount]) nearest a viewport Y, by counting block midpoints above `clientY`.

- [ ] **Step 1: Write the failing test (append)**

```ts
import { dropTargetIndex } from '../../src/docx/docxImageMove';

describe('dropTargetIndex', () => {
  // Stub a view with 3 top-level blocks laid out at y = [0..20], [20..40], [40..60].
  function fakeView(nodes: PMNode[], bands: Array<[number, number]>) {
    const state = stateWith(nodes);
    let call = 0;
    return {
      state,
      // coordsAtPos is hit twice per child (top of band, bottom of band) in document order.
      coordsAtPos(_pos: number): { top: number; bottom: number; left: number; right: number } {
        const band = bands[Math.floor(call / 2)];
        const isTop = call % 2 === 0;
        call++;
        return { top: band[0], bottom: band[1], left: 0, right: 0 };
      },
    } as unknown as Parameters<typeof dropTargetIndex>[0];
  }
  const bands: Array<[number, number]> = [[0, 20], [20, 40], [40, 60]];
  it('returns gap 0 when the pointer is above all blocks', () => {
    expect(dropTargetIndex(fakeView([para('A'), para('B'), para('C')], bands), -5)).toBe(0);
  });
  it('returns childCount when the pointer is below all blocks', () => {
    expect(dropTargetIndex(fakeView([para('A'), para('B'), para('C')], bands), 100)).toBe(3);
  });
  it('returns the gap after the blocks whose midpoint is above the pointer', () => {
    // midpoints = 10, 30, 50; clientY 35 → blocks 0 and 1 are above → gap 2
    expect(dropTargetIndex(fakeView([para('A'), para('B'), para('C')], bands), 35)).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- docxImageMove > /tmp/d2.log 2>&1; tail -20 /tmp/d2.log`
Expected: FAIL — `dropTargetIndex` not exported.

- [ ] **Step 3: Implement `dropTargetIndex` (append to docxImageMove.ts, add the EditorView type import)**

Add `import type { EditorView } from 'prosemirror-view';` to the top, then:

```ts
/** Nearest top-level gap (∈ [0, childCount]) to a viewport Y: counts block midpoints above clientY. */
export function dropTargetIndex(view: EditorView, clientY: number): number {
  const doc = view.state.doc;
  let p = 0;
  let g = 0;
  for (let i = 0; i < doc.childCount; i++) {
    const child = doc.child(i);
    const top = view.coordsAtPos(p + 1).top;
    const bottom = view.coordsAtPos(p + child.nodeSize - 1).bottom;
    if (clientY > (top + bottom) / 2) g = i + 1;
    p += child.nodeSize;
  }
  return g;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- docxImageMove > /tmp/d2.log 2>&1; tail -10 /tmp/d2.log`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/docx/docxImageMove.ts tests/docx/docxImageMove.test.ts
git commit -q -m "feat(docx): dropTargetIndex — nearest top-level gap to a viewport Y (B drag T2)"
```

---

### Task 3: NodeView image-body drag + drop-indicator + CSS

**Files:**
- Modify: `src/docx/docxImageView.ts`
- Modify: `src/styles/modals.css`
- Test: `tests/docx/docxImageMove.test.ts` (a NodeView-level jsdom assertion) or `tests/docx/docxImageView.test.ts` if present — see Step 1.

**Interfaces:**
- Consumes: `moveImageToGap`, `dropTargetIndex` from `./docxImageMove`.
- Produces: a click below 5px does NOT move the image; a drag past 5px moves it on pointerup; a `.docx-image-drop-line` element is created during drag.

- [ ] **Step 1: Write the failing test**

Append to `tests/docx/docxImageMove.test.ts` (this file already builds an EditorView with the NodeView in the "move buttons" describe). Add:

```ts
import { createDocxImageView } from '../../src/docx/docxImageView';

describe('docx_image NodeView — body drag', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    Element.prototype.getClientRects = (): DOMRectList => [fakeRect()] as unknown as DOMRectList;
    Element.prototype.getBoundingClientRect = (): DOMRect => fakeRect();
    Range.prototype.getClientRects = (): DOMRectList => [fakeRect()] as unknown as DOMRectList;
    Range.prototype.getBoundingClientRect = (): DOMRect => fakeRect();
  });
  function mount(nodes: PMNode[]) {
    const place = document.createElement('div');
    document.body.appendChild(place);
    const view = new EditorView(place, {
      state: stateWith(nodes),
      nodeViews: { docx_image: (node, v, getPos) => createDocxImageView(node, v, getPos) },
    });
    return { view, place };
  }
  function pointer(type: string, x: number, y: number): PointerEvent {
    return new (window as unknown as { MouseEvent: typeof MouseEvent }).MouseEvent(type, { clientX: x, clientY: y, bubbles: true }) as unknown as PointerEvent;
  }
  it('a sub-threshold click on the image body does NOT move it', () => {
    const { view, place } = mount([imgNode(), para('A')]);
    const img = place.querySelector('img.docx-image, img[data-docx-image]') as HTMLImageElement;
    const before = imgIndex(view.state.doc);
    img.dispatchEvent(pointer('pointerdown', 10, 10));
    document.dispatchEvent(pointer('pointermove', 12, 12)); // < 5px
    document.dispatchEvent(pointer('pointerup', 12, 12));
    expect(imgIndex(view.state.doc)).toBe(before);          // unchanged
    view.destroy(); place.remove();
  });
});
```

(If a separate `tests/docx/docxImageView.test.ts` exists, add the describe there instead — keep the existing fakeRect/mount helpers DRY.)

- [ ] **Step 2: Run test to verify it fails or is inconclusive**

Run: `npm run test -- docxImageMove > /tmp/d3.log 2>&1; tail -20 /tmp/d3.log`
Expected: with no drag code yet the click-no-move test may already pass (no handler). That is acceptable — it guards the threshold once the handler exists. Proceed to add the handler; the test must STILL pass after.

- [ ] **Step 3: Add the body-drag handler + drop-indicator to `docxImageView.ts`**

Add the import at the top:

```ts
import { moveImageAt, moveImageToGap, dropTargetIndex } from './docxImageMove';
```

Inside `createDocxImageView`, after the resize handlers (before the `return`), add:

```ts
  // Image-body drag-to-reorder (B slice 4). The .se/✕/▲▼ children capture their own events; a plain
  // click (< DRAG_THRESHOLD px) selects (PM default), a drag moves the image to the nearest top-level gap.
  const DRAG_THRESHOLD = 5;
  let dragStartX = 0, dragStartY = 0, dragging = false;
  let dropLine: HTMLDivElement | null = null;
  const editorRoot = (): HTMLElement => (view.dom.parentElement ?? view.dom) as HTMLElement;
  const showDropLine = (clientY: number): void => {
    const g = dropTargetIndex(view, clientY);
    const root = editorRoot();
    if (dropLine === null) {
      dropLine = document.createElement('div');
      dropLine.className = 'docx-image-drop-line';
      root.appendChild(dropLine);
    }
    // Position the line at the top of the gap-th top-level block (or below the last when g === childCount).
    const rootRect = root.getBoundingClientRect();
    const doc = view.state.doc;
    let p = 0;
    for (let i = 0; i < g; i++) p += doc.child(i).nodeSize;
    const y = g >= doc.childCount
      ? view.coordsAtPos(view.state.doc.content.size).bottom
      : view.coordsAtPos(p + 1).top;
    dropLine.style.top = `${y - rootRect.top + root.scrollTop}px`;
  };
  const clearDropLine = (): void => { if (dropLine !== null) { dropLine.remove(); dropLine = null; } };
  const onImgMove = (e: PointerEvent): void => {
    if (!dragging && Math.abs(e.clientX - dragStartX) + Math.abs(e.clientY - dragStartY) > DRAG_THRESHOLD) {
      dragging = true;
      dom.classList.add('docx-image-dragging');
    }
    if (dragging) showDropLine(e.clientY);
  };
  const onImgUp = (e: PointerEvent): void => {
    document.removeEventListener('pointermove', onImgMove);
    document.removeEventListener('pointerup', onImgUp);
    dom.classList.remove('docx-image-dragging');
    clearDropLine();
    if (!dragging) return;                       // a plain click — selection already handled by PM
    dragging = false;
    const pos = getPos();
    if (pos === undefined) return;
    const tr = moveImageToGap(view.state, pos, dropTargetIndex(view, e.clientY));
    if (tr) { view.dispatch(tr); view.focus(); }
  };
  img.addEventListener('pointerdown', e => {
    // Do NOT preventDefault — a plain click must still select the node (PM handles it).
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    dragging = false;
    document.addEventListener('pointermove', onImgMove);
    document.addEventListener('pointerup', onImgUp);
  });
```

Extend the NodeView `destroy()` to also remove these listeners + the line:

```ts
    destroy(): void {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointermove', onImgMove);
      document.removeEventListener('pointerup', onImgUp);
      clearDropLine();
    },
```

(`moveImageAt` stays imported for the ▲/▼ buttons; `moveImageToGap`/`dropTargetIndex` are new.)

- [ ] **Step 4: Add CSS to `src/styles/modals.css` (next to `.docx-image-handle`)**

```css
.docx-image-wrap.docx-image-dragging img { opacity: 0.5; cursor: grabbing; }
.docx-image-drop-line {
  position: absolute;
  left: 0;
  right: 0;
  height: 2px;
  background: #2b6cb0;
  pointer-events: none;
  z-index: 5;
}
```

- [ ] **Step 5: Run the test + type-check + lint**

Run: `npm run test -- docxImageMove > /tmp/d3.log 2>&1; tail -8 /tmp/d3.log`
Expected: PASS (the click-no-move test green).
Run: `npm run type-check > /tmp/d3tc.log 2>&1; echo tc=$?; npx oxlint src/docx/docxImageView.ts src/docx/docxImageMove.ts > /tmp/d3lint.log 2>&1; echo lint=$?`
Expected: tc=0, lint=0.

- [ ] **Step 6: Commit**

```bash
git add src/docx/docxImageView.ts src/styles/modals.css tests/docx/docxImageMove.test.ts
git commit -q -m "feat(docx): image-body drag-to-reorder + drop-indicator (B drag T3)"
```

---

### Task 4: browser e2e + full deploy gate + live shot + docs

**Files:**
- Create: `tests/browser/docx-image-drag.browser.test.ts`
- Modify: `CLAUDE.md` (DOCX section — drag note)
- Modify: memory `project_maxfidelity_program_2026_06_25.md` + `MEMORY.md` pointer

- [ ] **Step 1: Write the browser test**

```ts
// tests/browser/docx-image-drag.browser.test.ts
/**
 * B sub-slice 4 — real-Chrome guard for image drag-to-reorder.
 * A drag of the image body past a table relocates the w:drawing after save; a sub-threshold click
 * does not move it; the drop-indicator line appears during a drag (eyes-on shot).
 */
import { describe, it, expect } from 'vitest';
import { page } from '@vitest/browser/context';
import { zipSync, strToU8 } from 'fflate';
import { mountDocxEditor } from '../../src/docx/docxProseMirror';
import { openOpc, getDocumentXml } from '../../src/docx/opcEdit';

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
function pointer(type: string, x: number, y: number): PointerEvent {
  return new MouseEvent(type, { clientX: x, clientY: y, bubbles: true }) as unknown as PointerEvent;
}
function countDrawings(xml: string): number { return xml.split('<w:drawing').length - 1; }

describe('DOCX editor — image drag-to-reorder (real browser)', () => {
  it('dragging the image below the table relocates the w:drawing on save', async () => {
    const host = document.createElement('div'); document.body.appendChild(host);
    const handle = mountDocxEditor(host, makeDocx());
    const img = host.querySelector('img[data-docx-image]') as HTMLImageElement;
    const r = img.getBoundingClientRect();
    img.dispatchEvent(pointer('pointerdown', r.left + 5, r.top + 5));
    document.dispatchEvent(pointer('pointermove', r.left + 5, r.top + 400)); // far below all blocks
    await page.screenshot({ path: '../../qa-shots/b-drag/dragging.png', element: host }).catch(() => {});
    document.dispatchEvent(pointer('pointerup', r.left + 5, r.top + 400));
    const xml = getDocumentXml(openOpc(handle.save()));
    expect(countDrawings(xml)).toBe(1);
    expect(xml.indexOf('<w:drawing')).toBeGreaterThan(xml.indexOf('after')); // relocated last
    handle.destroy(); host.remove();
  });

  it('a sub-threshold click does NOT move the image', () => {
    const host = document.createElement('div'); document.body.appendChild(host);
    const handle = mountDocxEditor(host, makeDocx());
    const xmlBefore = getDocumentXml(openOpc(handle.save()));
    const img = host.querySelector('img[data-docx-image]') as HTMLImageElement;
    const r = img.getBoundingClientRect();
    img.dispatchEvent(pointer('pointerdown', r.left + 5, r.top + 5));
    document.dispatchEvent(pointer('pointermove', r.left + 7, r.top + 6)); // < 5px
    document.dispatchEvent(pointer('pointerup', r.left + 7, r.top + 6));
    const xmlAfter = getDocumentXml(openOpc(handle.save()));
    expect(xmlAfter.indexOf('<w:drawing')).toBe(xmlBefore.indexOf('<w:drawing')); // unmoved
    handle.destroy(); host.remove();
  });
});
```

- [ ] **Step 2: Run the browser test**

Run: `npm run test:browser -- docx-image-drag > /tmp/d4.log 2>&1; tail -20 /tmp/d4.log`
Expected: PASS (2). If `coordsAtPos` for the drop math throws at extreme Y in the headless layout, clamp the test's drag Y to within the editor's rendered height (`host.getBoundingClientRect().bottom + 50`).

- [ ] **Step 3: Full deploy gate**

```bash
npm audit --audit-level=high && npm run ocr:assets && npm run type-check && npm run lint && npm run test > /tmp/gate-jsdom.log 2>&1; tail -5 /tmp/gate-jsdom.log
npm run test:browser > /tmp/gate-browser.log 2>&1; tail -10 /tmp/gate-browser.log
npm run test:coverage:export > /tmp/gate-cov.log 2>&1; tail -8 /tmp/gate-cov.log
npm run build > /tmp/gate-build.log 2>&1; tail -5 /tmp/gate-build.log
```
Expected: audit 0; jsdom green (+2 expected-fail); browser green (re-run any non-deterministic canvas/pixel flake — e.g. `issue2-true-edit` — in isolation to confirm it is the known contention flake, NOT a regression; this slice touches only `src/docx/*` + `modals.css`); coverage ≥25% branch; build OK.

- [ ] **Step 4: Eyes-on verification**

View `qa-shots/b-drag/dragging.png` (drop-indicator line visible during the drag). Confirm the relocation visually.

- [ ] **Step 5: Docs — CLAUDE.md + memory**

Add a "Image drag-to-reorder (Sub-project B, sub-slice 4)" paragraph to the DOCX section of `CLAUDE.md`
(mechanism: image-body custom pointer drag, 5px threshold, `dropTargetIndex` → `moveImageToGap` →
`placeImageAnchors`, drop-indicator line; ceiling: top-level only / no auto-scroll). Update the memory
file + `MEMORY.md` pointer: B sub-slice 4 DONE → **all 4 B sub-slices complete**, NEXT = follow-up D
(whole-app `/qa-sweep`).

- [ ] **Step 6: Commit**

```bash
git add tests/browser/docx-image-drag.browser.test.ts CLAUDE.md docs/plans/maxfidelity-program-2026-06-25.plan.md
git commit -q -m "test(docx): drag-to-reorder browser e2e + docs (B drag T4)"
# memory files are outside the repo — written via the Write tool, not committed here
```

---

## Self-review

- **Spec coverage:** engine (`moveImageToGap` + refactor) → T1; drop math (`dropTargetIndex`) → T2;
  NodeView body drag + threshold + drop-indicator + CSS → T3; browser e2e + click-no-move + shot + docs → T4.
- **Placeholder scan:** all code concrete; the live shot (T4 S4) is an eyes-on step.
- **Type consistency:** `moveImageToGap(state,pos,gap):Transaction|null`, `dropTargetIndex(view,clientY):number`,
  `moveImageAt` delegates to `moveImageToGap` (signatures unchanged for slice-2 callers `moveImage`/NodeView ▲▼).
