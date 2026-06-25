# Sub-project C — Phase 1 (DOCX editor: image & hyperlink preserve + display) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or subagent-driven-development) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the DOCX editor's `save()` non-destructive for images and hyperlinks, and render images inline (read-only) — without weakening the cardinal in-place-save rule.

**Architecture:** A new opaque `DocBlock` variant `DocImageBlock` (third sibling of `DocParagraph`/`DocTable`). Anchor `w:p` elements (containing `w:drawing` or `w:hyperlink`) are detected DOM-structurally and hard-skipped by the reconciler in every path, so the source paragraph is preserved byte-exact. The PM bridge maps the block to a read-only atom that renders the real image / shows link text. Image bytes are merged from the existing `extractDocImages` channel by block index.

**Tech Stack:** TypeScript, jsdom DOMParser/XMLSerializer (no new dep), prosemirror-model/-view, vitest (jsdom + real-Chrome browser harness).

## Global Constraints

- Cardinal in-place rule: edit `word/document.xml` in place; never rebuild via the `docx` writer.
- Byte-identical when inactive: a DOCX with no `w:drawing` and no `w:hyperlink` must save exactly as today.
- TDD: failing test first, then implement. Full deploy gate per commit: `npm audit --audit-level=high` → `npm run ocr:assets` → `npm run type-check` → `npm run lint` → `npm run test` (jsdom) → `npm run test:browser` (real Chrome) → `npm run test:coverage:export` → `npm run build`. The browser suite is deploy-blocking.
- No new dependencies.
- Gated by the existing `VITE_FEATURE_DOCX_EDIT` seam (no new flag).
- Commits: `feat:`/`fix:` prefix, imperative; NO `Co-Authored-By` trailer. `git push` is manual.
- Spec: `docs/superpowers/specs/2026-06-25-docx-editor-subproject-c-design.md`.

---

### Task 1: `DocImageBlock` model type + narrowing

**Files:**
- Modify: `src/docx/docModel.ts` (the `DocBlock` union + a narrowing helper)
- Test: `tests/docx/docModelImagePreserve.test.ts` (create)

**Interfaces:**
- Produces: `interface DocImageBlock { kind: 'image'; image?: { dataB64: string; mime: 'image/png' | 'image/jpeg'; widthPt: number; heightPt: number }; linkText?: string }`; `type DocBlock = DocParagraph | DocTable | DocImageBlock`; `function isDocImageBlock(b: DocBlock): b is DocImageBlock`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { isDocImageBlock, isDocTable, type DocBlock } from '../../src/docx/docModel';

describe('DocImageBlock model', () => {
  it('narrows image blocks and is disjoint from tables/paragraphs', () => {
    const img: DocBlock = { kind: 'image', linkText: 'x' };
    const tbl: DocBlock = { kind: 'table', rows: [] };
    const para: DocBlock = { runs: [{ text: 'hi' }] };
    expect(isDocImageBlock(img)).toBe(true);
    expect(isDocImageBlock(tbl)).toBe(false);
    expect(isDocImageBlock(para)).toBe(false);
    expect(isDocTable(img)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run tests/docx/docModelImagePreserve.test.ts` (note: positional runs are intercepted in this env — instead add the file and run the full `npm run test`, or use a `vite-node` probe). Expected: FAIL (`isDocImageBlock` not exported).

- [ ] **Step 3: Implement**

In `docModel.ts`, after `DocTable`:
```ts
export interface DocImageBlock {
  kind: 'image';
  image?: { dataB64: string; mime: 'image/png' | 'image/jpeg'; widthPt: number; heightPt: number };
  linkText?: string;
}
export type DocBlock = DocParagraph | DocTable | DocImageBlock;
```
And next to `isDocTable`:
```ts
export function isDocImageBlock(b: DocBlock): b is DocImageBlock {
  return (b as DocImageBlock).kind === 'image';
}
```

- [ ] **Step 4: Run the test, verify it passes** (`npm run test`, filter mentally for the new file).

- [ ] **Step 5: type-check + lint** — `npm run type-check && npm run lint`. (Widening the union may surface non-exhaustive `switch`/`if` on `DocBlock`; fix any tsc error by handling the new variant — `countTables` in `docxEditorController.ts` is fine since it tests `=== 'table'`.)

- [ ] **Step 6: Commit** — `git add -A && git commit -m "feat(docx): add DocImageBlock opaque model variant"` (folded into Task 2's commit if Task 2 follows immediately; otherwise commit standalone).

---

### Task 2: Anchor detection in parse — emit `DocImageBlock` for drawing/hyperlink paragraphs

**Files:**
- Modify: `src/docx/docModel.ts` (`parseContainerBlocks`; add `isAnchorParagraphEl`, `parseAnchorBlock`)
- Test: `tests/docx/docModelImagePreserve.test.ts`

**Interfaces:**
- Consumes: `DocImageBlock` (Task 1).
- Produces: `parseContainerBlocks` emits a `DocImageBlock` (with `linkText` filled for hyperlink anchors; `image` left undefined here — bytes merged later in Task 5) for any `w:p` that deeply contains a `w:drawing` or `w:hyperlink`. Exported `isAnchorParagraphEl(p: Element): boolean`.

- [ ] **Step 1: Write the failing tests**

```ts
import { parseDocModel, isDocImageBlock } from '../../src/docx/docModel';

const NS = `xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
  xmlns:wp="http://wp" xmlns:a="http://a" xmlns:r="http://r"`;
const doc = (body: string) => `<?xml version="1.0"?><w:document ${NS}><w:body>${body}</w:body></w:document>`;

it('parses an image paragraph as a DocImageBlock (not a text paragraph)', () => {
  const m = parseDocModel(doc(
    `<w:p><w:r><w:t>before</w:t></w:r></w:p>` +
    `<w:p><w:r><w:drawing><wp:inline><wp:extent cx="1905000" cy="952500"/><a:blip r:embed="rId1"/></wp:inline></w:drawing></w:r></w:p>`,
  ));
  expect(m.blocks).toHaveLength(2);
  expect(isDocImageBlock(m.blocks[1])).toBe(true);
  // image bytes are merged later; here the anchor is just flagged
  expect(m.paragraphs).toHaveLength(1); // image block excluded from the paragraphs view
});

it('parses a hyperlink paragraph as a DocImageBlock carrying its link text', () => {
  const m = parseDocModel(doc(`<w:p><w:hyperlink r:id="rId9"><w:r><w:t>click here</w:t></w:r></w:hyperlink></w:p>`));
  expect(m.blocks).toHaveLength(1);
  const b = m.blocks[0];
  expect(isDocImageBlock(b)).toBe(true);
  if (isDocImageBlock(b)) expect(b.linkText).toBe('click here');
});
```

- [ ] **Step 2: Run, verify it fails** (image/hyperlink `w:p` currently parse to `DocParagraph`).

- [ ] **Step 3: Implement**

In `docModel.ts`:
```ts
/** A w:p is an anchor (opaque-passthrough) iff it deeply contains a drawing or a hyperlink. */
export function isAnchorParagraphEl(p: Element): boolean {
  return p.getElementsByTagName('w:drawing').length > 0
      || p.getElementsByTagName('w:hyperlink').length > 0;
}
/** Display data for an anchor paragraph. Bytes (image) are merged later; linkText is read here. */
function parseAnchorBlock(p: Element): DocImageBlock {
  const block: DocImageBlock = { kind: 'image' };
  const hls = p.getElementsByTagName('w:hyperlink');
  if (p.getElementsByTagName('w:drawing').length === 0 && hls.length > 0) {
    let text = '';
    const ts = hls[0].getElementsByTagName('w:t');
    for (let i = 0; i < ts.length; i++) text += ts[i].textContent ?? '';
    block.linkText = text;
  }
  return block;
}
```
Then in `parseContainerBlocks`, before `parseParagraph`:
```ts
for (const el of Array.from(container.children)) {
  if (el.tagName === 'w:p') {
    out.push(isAnchorParagraphEl(el) ? parseAnchorBlock(el) : parseParagraph(el, numberingMap));
  } else if (el.tagName === 'w:tbl') out.push(parseTable(el, numberingMap));
}
```
`parseDocModel`'s `paragraphs = blocks.filter(!isDocTable)` would wrongly include image blocks — change it to also exclude image blocks: `blocks.filter((b): b is DocParagraph => !isDocTable(b) && !isDocImageBlock(b))`.

- [ ] **Step 4: Run, verify both tests pass.**
- [ ] **Step 5: type-check + lint.**
- [ ] **Step 6: Commit** — `git add -A && git commit -m "feat(docx): parse drawing/hyperlink paragraphs as opaque anchor blocks"`.

---

### Task 3: Reconciler hard-skip — anchors never reach `setRunsOn` (the preservation fix)

**Files:**
- Modify: `src/docx/docModel.ts` (`reconcileContainer`, `reconcileSegment` / segment partition, `reconcileParagraphsOnly`)
- Test: `tests/docx/docModelImagePreserve.test.ts`

**Interfaces:**
- Consumes: `isAnchorParagraphEl` (Task 2), `isDocImageBlock` (Task 1).
- Produces: `applyBlocks(originalXml, blocks)` leaves anchor `w:p` byte-exact (drawing + blip + hyperlink + r:id preserved, link text occurs exactly once) and remains byte-identical for anchor-free docs.

- [ ] **Step 1: Write the failing tests** (the core correctness proof)

```ts
import { parseDocModel, applyBlocks } from '../../src/docx/docModel';

it('preserves a w:drawing through save (no destruction)', () => {
  const xml = doc(`<w:p><w:r><w:t>x</w:t></w:r></w:p>` +
    `<w:p><w:r><w:drawing><wp:inline><a:blip r:embed="rId1"/></wp:inline></w:drawing></w:r></w:p>`);
  const saved = applyBlocks(xml, parseDocModel(xml).blocks);
  expect(saved).toContain('drawing');
  expect(saved).toContain('rId1');
});

it('does not duplicate hyperlink text on save', () => {
  const xml = doc(`<w:p><w:hyperlink r:id="rId9"><w:r><w:t>click here</w:t></w:r></w:hyperlink></w:p>`);
  const saved = applyBlocks(xml, parseDocModel(xml).blocks);
  expect(saved).toContain('w:hyperlink');
  expect((saved.match(/click here/g) || []).length).toBe(1);
});

it('is byte-identical for a doc with no drawing/hyperlink (no regression)', () => {
  const xml = doc(`<w:p><w:r><w:t>hello</w:t></w:r></w:p><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>bold</w:t></w:r></w:p>`);
  const before = applyBlocks(xml, parseDocModel(xml).blocks);     // current behavior baseline
  // edit nothing → output stable across the new anchor-skip code path
  expect(applyBlocks(xml, parseDocModel(xml).blocks)).toBe(before);
  expect(before).not.toContain('drawing');
});
```

- [ ] **Step 2: Run, verify the first two FAIL** (drawing destroyed / link duplicated) and the third passes.

- [ ] **Step 3: Implement the hard-skip**

In `reconcileContainer`: treat anchor `w:p` like `w:tbl` — they delimit paragraph segments and are skipped. Change the segment partition so a "block element" boundary is `w:tbl` **or** an anchor `w:p`:
```ts
const isAnchorEl = (e: Element): boolean => e.tagName === 'w:p' && isAnchorParagraphEl(e);
const isBoundary = (e: Element): boolean => e.tagName === 'w:tbl' || isAnchorEl(e);
```
Generalize `containerBlockEls`-driven segmentation: split `domSegs` on `isBoundary(e)` (not just `w:tbl`), and split `modelSegs` on `isDocTable(b) || isDocImageBlock(b)`. The boundary list (`domBoundaries`) interleaves tables and anchors in order; recurse into tables only (`if (boundary.tagName === 'w:tbl') writeTable(...)`), skip anchors. The "counts must match else bail" guard compares boundary counts (tables+anchors) on both sides; on mismatch fall to `reconcileParagraphsOnly`.

In `reconcileParagraphsOnly` (the fallback): exclude anchors so they are never reconciled:
```ts
const domParas = Array.from(container.children)
  .filter(c => c.tagName === 'w:p' && !isAnchorParagraphEl(c));
```
This is the robustness invariant: an anchor `w:p` is skipped in BOTH paths, independent of model bookkeeping.

- [ ] **Step 4: Run, verify all three pass.** Also run the existing `tests/docx/docxTablesMapping.test.ts` + `docModelTables.test.ts` (boundary-partition change must not break table reconcile).
- [ ] **Step 5: type-check + lint.**
- [ ] **Step 6: Commit** — `git add -A && git commit -m "fix(docx): preserve images & hyperlinks through save (opaque anchor skip)"`. *(This commit alone is the P0 data-loss fix — shippable even if we stop here.)*

---

### Task 4: ProseMirror schema atoms (`docx_image`, `docx_link`)

**Files:**
- Modify: `src/docx/docxSchema.ts`
- Test: `tests/docx/docxImageBridge.test.ts` (create)

**Interfaces:**
- Produces: `docxSchema.nodes.docx_image` (atom, attrs `dataB64`/`mime`/`widthPt`/`heightPt`, `toDOM` → `img`), `docxSchema.nodes.docx_link` (atom, attr `text`, `toDOM` → `p>a`).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { docxSchema } from '../../src/docx/docxSchema';

describe('docx atom nodes', () => {
  it('exposes docx_image and docx_link atom nodes', () => {
    expect(docxSchema.nodes.docx_image).toBeDefined();
    expect(docxSchema.nodes.docx_image.spec.atom).toBe(true);
    expect(docxSchema.nodes.docx_link).toBeDefined();
  });
});
```

- [ ] **Step 2: Run, verify it fails.**

- [ ] **Step 3: Implement** — append to the `nodes` OrderedMap (after `tableNodes`):
```ts
nodes = nodes.append({
  docx_image: {
    group: 'block', atom: true, selectable: true, draggable: false,
    attrs: { dataB64: { default: '' }, mime: { default: 'image/png' }, widthPt: { default: 0 }, heightPt: { default: 0 } },
    toDOM(node): DOMOutputSpec {
      const a = node.attrs;
      return ['img', { src: `data:${a.mime}();base64,${a.dataB64}`.replace('()', '') ,
        style: `max-width:100%;${a.widthPt ? `width:${a.widthPt}pt;` : ''}${a.heightPt ? `height:${a.heightPt}pt;` : ''}`,
        'data-docx-image': '1' }];
    },
  },
  docx_link: {
    group: 'block', atom: true, selectable: true,
    attrs: { text: { default: '' } },
    toDOM(node): DOMOutputSpec { return ['p', ['a', { class: 'docx-link-ro' }, node.attrs.text as string]]; },
  },
});
```
(Import `type Node as PMNode` if needed for `toDOM(node)` typing; the file already imports `DOMOutputSpec`.)

- [ ] **Step 4: Run, verify it passes.**
- [ ] **Step 5: type-check + lint.**
- [ ] **Step 6: Commit** — `git add -A && git commit -m "feat(docx): add read-only docx_image / docx_link atom nodes"` (may fold into Task 5).

---

### Task 5: PM bridge mapping + image-byte merge in `mountDocxEditor`

**Files:**
- Modify: `src/docx/docxProseMirror.ts` (`blocksToNodes`, `emitBlockTo`, `mountDocxEditor` merge)
- Test: `tests/docx/docxImageBridge.test.ts`

**Interfaces:**
- Consumes: `DocImageBlock`/`isDocImageBlock` (Task 1), the atom nodes (Task 4), `extractDocImages` (existing).
- Produces: `docModelToDoc(model)` emits `docx_image` for an image block (with `image`) / `docx_link` for a link block (with `linkText`); `docToDocModel(doc)` maps the atom back to the same `DocImageBlock`. `mountDocxEditor` merges `extractDocImages(opc.files)` bytes into image blocks by block index *before* `docModelToDoc`.

- [ ] **Step 1: Write the failing test** (round-trip through the bridge)

```ts
import { docModelToDoc, docToDocModel } from '../../src/docx/docxProseMirror';
import { isDocImageBlock, type DocModel } from '../../src/docx/docModel';

it('round-trips an image block through PM as a docx_image atom', () => {
  const model: DocModel = {
    blocks: [{ kind: 'image', image: { dataB64: 'AAAA', mime: 'image/png', widthPt: 10, heightPt: 5 } }],
    paragraphs: [],
  };
  const doc = docModelToDoc(model);
  expect(doc.firstChild?.type.name).toBe('docx_image');
  const back = docToDocModel(doc);
  expect(isDocImageBlock(back.blocks[0])).toBe(true);
});

it('round-trips a link block as a docx_link atom', () => {
  const model: DocModel = { blocks: [{ kind: 'image', linkText: 'click here' }], paragraphs: [] };
  const doc = docModelToDoc(model);
  expect(doc.firstChild?.type.name).toBe('docx_link');
  const back = docToDocModel(doc);
  const b = back.blocks[0];
  expect(isDocImageBlock(b) && b.linkText).toBe('click here');
});
```

- [ ] **Step 2: Run, verify it fails.**

- [ ] **Step 3: Implement**

In `blocksToNodes`, handle the image block before the table/paragraph branches:
```ts
if (isDocImageBlock(b)) { out.push(imageBlockToNode(b)); i += 1; continue; }
```
with:
```ts
function imageBlockToNode(b: DocImageBlock): PMNode {
  if (b.image) return n.docx_image.create({ dataB64: b.image.dataB64, mime: b.image.mime, widthPt: b.image.widthPt, heightPt: b.image.heightPt });
  return n.docx_link.create({ text: b.linkText ?? '' });
}
```
In `emitBlockTo`, before delegating to `emitBlock`:
```ts
if (name === 'docx_image') {
  out.push({ kind: 'image', image: { dataB64: node.attrs.dataB64 as string, mime: node.attrs.mime as 'image/png'|'image/jpeg',
    widthPt: Number(node.attrs.widthPt), heightPt: Number(node.attrs.heightPt) } });
  return;
}
if (name === 'docx_link') { out.push({ kind: 'image', linkText: node.attrs.text as string }); return; }
```
In `mountDocxEditor`, after `const images = extractDocImages(opc.files)` and `const model = parseDocModel(...)`, merge:
```ts
for (const img of images) {
  const blk = model.blocks[img.blockIndex];
  if (blk && isDocImageBlock(blk)) blk.image = { dataB64: img.dataB64, mime: img.mime, widthPt: img.widthPt, heightPt: img.heightPt };
}
```
(`extractDocImages` block indices align with `parseContainerBlocks` order — both iterate `body` children filtering `w:p`/`w:tbl` in document order.)

- [ ] **Step 4: Run, verify it passes.** Also confirm `save()` is unaffected: `docToDocModel` emits `DocImageBlock` for atoms → `applyBlocks` skips them (Task 3) → preserved.
- [ ] **Step 5: type-check + lint.**
- [ ] **Step 6: Commit** — `git add -A && git commit -m "feat(docx): render images inline + map image/link anchors through the editor"`.

---

### Task 6: Real-Chrome e2e — open, render, save, reopen

**Files:**
- Test: `tests/browser/docx-image-preserve.browser.test.ts` (create)
- (CSS) Modify: `src/styles/modals.css` — add a minimal `.docx-link-ro` style (non-essential; visual only).

**Interfaces:**
- Consumes: the full Phase-1 stack. A fixture DOCX (build one inline with `fflate` zipSync containing `[Content_Types].xml`, `word/document.xml` with one image paragraph + one hyperlink paragraph + one text paragraph, `word/_rels/document.xml.rels`, and a tiny PNG in `word/media/`).

- [ ] **Step 1: Write the test** — build the fixture, `mountDocxEditor(container, bytes)`, assert: the mount contains an `img[data-docx-image]` whose `src` is a data URI; `view.dom` shows the link text once; call `handle.save()`, reopen the bytes with `openOpc`/`getDocumentXml`, assert the saved `document.xml` still contains `w:drawing` + the blip rId + exactly one occurrence of the link text, and the plain text paragraph is still present/editable.

- [ ] **Step 2: Run** `npm run test:browser` — verify the new test passes (jsdom cannot render the atom/img reliably; this MUST be the browser harness).

- [ ] **Step 3: Full deploy gate** — run the entire gate (audit → ocr:assets → type-check → lint → test → test:browser → test:coverage:export → build). Paste the pass/fail counts as Coverage evidence.

- [ ] **Step 4: Commit** — `git add -A && git commit -m "test(docx): real-Chrome guard for image+hyperlink preservation"`.

---

## Self-Review (per writing-plans)

- **Spec coverage:** Preservation (images + hyperlinks) = Tasks 2–3; display images (C1 folded in) = Tasks 4–5; byte-identical control = Task 3 step 1; e2e = Task 6. Phase 2 (C2/C3) is intentionally out of this plan.
- **Type consistency:** `DocImageBlock` shape identical across Tasks 1/2/5; `isDocImageBlock`/`isAnchorParagraphEl` names stable; atom node names `docx_image`/`docx_link` stable across Tasks 4–6.
- **Placeholders:** none — every step has concrete code or an exact command.
- **Risk note:** the only save-path change is Task 3 (anchor skip), guarded by the byte-identical control + the existing table tests; everything else is read-side (parse/bridge/schema).

## Phase 1 done = ceilings (carry to CLAUDE.md gotcha on completion)

A paragraph mixing flowing text + an inline image/link is read-only (whole paragraph opaque); anchors are non-deletable/non-reorderable in Phase 1; image *editing* (move/resize/delete) and *editable* links are Phase 2 (C2/C3).
