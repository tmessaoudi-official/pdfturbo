# DOCX editor — image Cut & Paste (B sub-slice 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut / copy / paste an image inside the DOCX editor (Ctrl/Cmd+X/C/V) and paste an external image blob, persisted through the in-place `save()`.

**Architecture:** Three ProseMirror-layer hooks route a pasted image into the *existing* slice-1/2 `anchorId:-1 ⇒ mint-fresh` insert path. No new save logic. New module `src/docx/docxImagePaste.ts` owns the pure helpers; `docxSchema` gains a scoped `parseDOM`; `docxProseMirror` wires `transformPasted` + a `handlePaste` image-blob branch.

**Tech Stack:** TypeScript, ProseMirror (prosemirror-model/state/view), fflate (test fixtures), vitest (jsdom + @vitest/browser real Chrome).

## Global Constraints

- Cardinal DOCX rule: edit `word/document.xml` **in place**, never rebuild via the docx writer.
- No new dependency; no `SCHEMA_VERSION` bump (docx model is export-transient).
- Rides the existing `VITE_FEATURE_DOCX_EDIT` flag — no new flag.
- `docModel.ts` must NOT import `opcParts.ts` (cycle) — minting stays the `opts.mintImage` callback (untouched here).
- oxlint: no non-null `!`, no `==` (use `=== undefined` / `=== null`); avoid `as any` (localize casts).
- Per-item commit pre-authorized; **push is MANUAL**. No `Co-Authored-By` trailer.
- Pasted image attrs: `anchorId: -1`, `widthPt = min(naturalPx*0.75, 468)`, `heightPt = widthPt*(h/w)` (0 on decode failure). `PT_PER_PX = 0.75`, `CONTENT_WIDTH_PT = 468`.

---

### Task 1: `docxImagePaste.ts` — `resetPastedImageAnchors` (Unit 1 pure core)

**Files:**
- Create: `src/docx/docxImagePaste.ts`
- Test: `tests/docx/docxImagePaste.test.ts`

**Interfaces:**
- Consumes: `docxSchema` (`src/docx/docxSchema.ts`), `Slice`/`Fragment`/`Node` from `prosemirror-model`.
- Produces: `resetPastedImageAnchors(slice: Slice): Slice` — returns a new Slice with every `docx_image` node rebuilt with `anchorId: -1` (all other attrs and all non-image nodes preserved).

- [ ] **Step 1: Write the failing test**

```ts
// tests/docx/docxImagePaste.test.ts
import { describe, it, expect } from 'vitest';
import { Slice, Fragment } from 'prosemirror-model';
import { docxSchema } from '../../src/docx/docxSchema';
import { resetPastedImageAnchors } from '../../src/docx/docxImagePaste';

const n = docxSchema.nodes;
function img(anchorId: number) {
  return n.docx_image.create({ dataB64: 'AAA', mime: 'image/png', widthPt: 100, heightPt: 50, anchorId });
}
function sliceOf(...nodes: Parameters<typeof Fragment.fromArray>[0]) {
  return new Slice(Fragment.fromArray(nodes), 0, 0);
}

describe('resetPastedImageAnchors', () => {
  it('rebuilds a docx_image with anchorId -1, preserving other attrs', () => {
    const out = resetPastedImageAnchors(sliceOf([img(3)]));
    const node = out.content.firstChild!;
    expect(node.type.name).toBe('docx_image');
    expect(node.attrs.anchorId).toBe(-1);
    expect(node.attrs.dataB64).toBe('AAA');
    expect(node.attrs.mime).toBe('image/png');
    expect(node.attrs.widthPt).toBe(100);
    expect(node.attrs.heightPt).toBe(50);
  });

  it('leaves a paragraph (and its text) untouched', () => {
    const para = n.paragraph.create(null, docxSchema.text('hello'));
    const out = resetPastedImageAnchors(sliceOf([para]));
    expect(out.content.firstChild!.textContent).toBe('hello');
  });

  it('resets an image nested inside container content', () => {
    const cell = n.paragraph.create(null); // simple container stand-in
    const frag = Fragment.fromArray([img(0), cell]);
    const out = resetPastedImageAnchors(new Slice(frag, 0, 0));
    expect(out.content.firstChild!.attrs.anchorId).toBe(-1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- docxImagePaste > /tmp/t1.log 2>&1; tail -30 /tmp/t1.log`
Expected: FAIL — `resetPastedImageAnchors` is not exported / module missing.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/docx/docxImagePaste.ts
/**
 * docxImagePaste — ProseMirror-layer helpers for cut/copy/paste of a docx_image (B sub-slice 3).
 * The whole feature reuses the slice-1/2 `anchorId:-1 ⇒ mint-fresh` insert path: every PASTED image
 * must arrive with anchorId -1 so the save mints a new OPC media part instead of tripping the
 * dup-free anchor guard (which would silently bail the save to verbatim).
 */
import { Slice, Fragment, type Node as PMNode } from 'prosemirror-model';
import { docxSchema } from './docxSchema';

function mapFragment(frag: Fragment): Fragment {
  const out: PMNode[] = [];
  frag.forEach((child) => {
    if (child.type === docxSchema.nodes.docx_image) {
      out.push(child.type.create({ ...child.attrs, anchorId: -1 }, child.content, child.marks));
    } else if (child.content.size > 0) {
      out.push(child.copy(mapFragment(child.content)));
    } else {
      out.push(child);
    }
  });
  return Fragment.fromArray(out);
}

/** Return a copy of the pasted slice with every docx_image's anchorId reset to -1 (new identity). */
export function resetPastedImageAnchors(slice: Slice): Slice {
  return new Slice(mapFragment(slice.content), slice.openStart, slice.openEnd);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- docxImagePaste > /tmp/t1.log 2>&1; tail -30 /tmp/t1.log`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/docx/docxImagePaste.ts tests/docx/docxImagePaste.test.ts
git commit -q -m "feat(docx): resetPastedImageAnchors — reset pasted image anchorId (B cut&paste T1)"
```

---

### Task 2: `parseDOM` on `docx_image` (Unit 2)

**Files:**
- Modify: `src/docx/docxSchema.ts:27-50` (the `docx_image` node spec)
- Test: `tests/docx/docxImagePaste.test.ts` (extend)

**Interfaces:**
- Consumes: nothing new.
- Produces: `docxSchema` now parses `<img data-docx-image src="data:image/png|jpeg;base64,…">` → a `docx_image` node `{mime, dataB64, anchorId:-1, widthPt:0, heightPt:0}`; any other `<img>` does not match.

- [ ] **Step 1: Write the failing test (append to tests/docx/docxImagePaste.test.ts)**

```ts
import { DOMParser as PMDOMParser } from 'prosemirror-model';

describe('docx_image parseDOM', () => {
  function parseHtml(html: string) {
    const div = document.createElement('div');
    div.innerHTML = html;
    return PMDOMParser.fromSchema(docxSchema).parse(div);
  }
  it('parses our own data-uri image into a docx_image with anchorId -1', () => {
    const doc = parseHtml('<img data-docx-image src="data:image/png;base64,QUJD">');
    let found: { attrs: Record<string, unknown> } | null = null;
    doc.descendants((node) => { if (node.type.name === 'docx_image') found = node; });
    expect(found).not.toBeNull();
    expect(found!.attrs.mime).toBe('image/png');
    expect(found!.attrs.dataB64).toBe('QUJD');
    expect(found!.attrs.anchorId).toBe(-1);
  });
  it('does NOT parse an external http image into a docx_image', () => {
    const doc = parseHtml('<img src="https://example.com/x.png">');
    let count = 0;
    doc.descendants((node) => { if (node.type.name === 'docx_image') count++; });
    expect(count).toBe(0);
  });
  it('does NOT parse a data-uri <img> lacking the data-docx-image attr', () => {
    const doc = parseHtml('<img src="data:image/png;base64,QUJD">');
    let count = 0;
    doc.descendants((node) => { if (node.type.name === 'docx_image') count++; });
    expect(count).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- docxImagePaste > /tmp/t2.log 2>&1; tail -30 /tmp/t2.log`
Expected: FAIL on the first new test (no `docx_image` produced — node has no parseDOM).

- [ ] **Step 3: Add parseDOM to the docx_image node spec**

In `src/docx/docxSchema.ts`, inside the `docx_image: { … }` object, add a `parseDOM` immediately before `toDOM`:

```ts
    parseDOM: [{
      tag: 'img[data-docx-image]',
      getAttrs(dom: HTMLElement): false | { mime: string; dataB64: string; anchorId: number; widthPt: number; heightPt: number } {
        const src = dom.getAttribute('src') ?? '';
        const m = /^data:(image\/(?:png|jpeg));base64,(.+)$/.exec(src);
        if (m === null) return false; // non-data: src (web image) → never match
        return { mime: m[1], dataB64: m[2], anchorId: -1, widthPt: 0, heightPt: 0 };
      },
    }],
    toDOM(node: PMNode): DOMOutputSpec {
```

(Keep the existing `toDOM` body unchanged — the snippet above only shows the inserted block and the existing `toDOM(` line for placement.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- docxImagePaste > /tmp/t2.log 2>&1; tail -30 /tmp/t2.log`
Expected: PASS (6 tests total in the file).

- [ ] **Step 5: Commit**

```bash
git add src/docx/docxSchema.ts tests/docx/docxImagePaste.test.ts
git commit -q -m "feat(docx): scoped parseDOM on docx_image for data-uri paste (B cut&paste T2)"
```

---

### Task 3: blob helpers — lift shared image primitives + `firstImageFile` + `insertImageBlob` (Unit 3)

**Files:**
- Modify: `src/docx/docxImagePaste.ts` (add helpers)
- Modify: `src/docx/docxToolbar.ts:22-45,248-276` (import the lifted primitives; behavior-identical)
- Test: `tests/docx/docxImagePaste.test.ts` (extend); `tests/docx/docxToolbar.test.ts` stays green

**Interfaces:**
- Consumes: `docxSchema`; `EditorView` from `prosemirror-view`.
- Produces:
  - `sniffImageMime(bytes: Uint8Array): 'image/png' | 'image/jpeg' | null`
  - `imgBytesToB64(bytes: Uint8Array): string`
  - `PT_PER_PX` (0.75), `CONTENT_WIDTH_PT` (468)
  - `imageDimsPt(bytes, mime): Promise<{ widthPt: number; heightPt: number }>`
  - `firstImageFile(dt: DataTransfer | null): File | null`
  - `insertImageBlob(view: EditorView, file: File): Promise<void>`

- [ ] **Step 1: Write the failing test (append)**

```ts
import { firstImageFile } from '../../src/docx/docxImagePaste';

describe('firstImageFile', () => {
  function dtWith(files: File[]): DataTransfer {
    const dt = new DataTransfer();
    for (const f of files) dt.items.add(f);
    return dt;
  }
  it('returns the first png/jpeg file', () => {
    const png = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'a.png', { type: 'image/png' });
    expect(firstImageFile(dtWith([png]))!.type).toBe('image/png');
  });
  it('returns null for a text-only DataTransfer', () => {
    const txt = new File(['hi'], 'a.txt', { type: 'text/plain' });
    expect(firstImageFile(dtWith([txt]))).toBeNull();
  });
  it('returns null for a null DataTransfer', () => {
    expect(firstImageFile(null)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- docxImagePaste > /tmp/t3.log 2>&1; tail -30 /tmp/t3.log`
Expected: FAIL — `firstImageFile` not exported.

- [ ] **Step 3a: Add the lifted primitives + blob helpers to `docxImagePaste.ts`**

Add to `src/docx/docxImagePaste.ts` (imports: add `import type { EditorView } from 'prosemirror-view';`):

```ts
export const PT_PER_PX = 0.75;        // 96 DPI → 72 pt/in
export const CONTENT_WIDTH_PT = 468;  // usable width on a letter page (8.5in − 2×1in margins)

export function sniffImageMime(bytes: Uint8Array): 'image/png' | 'image/jpeg' | null {
  if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  return null;
}

export function imgBytesToB64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

/** Natural image size scaled to pt (width clamped to the content width); {0,0} on decode failure. */
export async function imageDimsPt(bytes: Uint8Array, mime: 'image/png' | 'image/jpeg'): Promise<{ widthPt: number; heightPt: number }> {
  try {
    const bmp = await createImageBitmap(new Blob([bytes], { type: mime }));
    const widthPt = Math.min(bmp.width * PT_PER_PX, CONTENT_WIDTH_PT);
    const heightPt = bmp.width > 0 ? widthPt * (bmp.height / bmp.width) : 0;
    bmp.close();
    return { widthPt, heightPt };
  } catch {
    return { widthPt: 0, heightPt: 0 };
  }
}

/** First png/jpeg blob on the clipboard (files first, then items), or null. */
export function firstImageFile(dt: DataTransfer | null): File | null {
  if (dt === null) return null;
  for (let i = 0; i < dt.files.length; i++) {
    const f = dt.files[i];
    if (f.type === 'image/png' || f.type === 'image/jpeg') return f;
  }
  const items = dt.items;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it.kind === 'file' && (it.type === 'image/png' || it.type === 'image/jpeg')) {
      const f = it.getAsFile();
      if (f !== null) return f;
    }
  }
  return null;
}

/** Decode an image blob and insert it as a docx_image (anchorId -1) at the selection. */
export async function insertImageBlob(view: EditorView, file: File): Promise<void> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mime = sniffImageMime(bytes);
  if (mime === null) return;
  const { widthPt, heightPt } = await imageDimsPt(bytes, mime);
  const node = docxSchema.nodes.docx_image.create({ dataB64: imgBytesToB64(bytes), mime, widthPt, heightPt, anchorId: -1 });
  view.dispatch(view.state.tr.replaceSelectionWith(node));
  view.focus();
}
```

- [ ] **Step 3b: Refactor `docxToolbar.ts` to import the lifted primitives (behavior-identical)**

In `src/docx/docxToolbar.ts`: delete the local `PT_PER_PX`/`CONTENT_WIDTH_PT` consts (lines ~22-23) and the local `sniffImageMime`/`imgBytesToB64` functions (lines ~35-45), and import them instead. Add to the existing import block:

```ts
import { sniffImageMime, imgBytesToB64, imageDimsPt } from './docxImagePaste';
```

Then simplify the toolbar's `handlePick` (lines ~260-276) to reuse `imageDimsPt`:

```ts
  const handlePick = async (): Promise<void> => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (file === undefined) return;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const mime = sniffImageMime(bytes);
    if (mime === null) return; // accept filter restricts to png/jpeg; silently skip others
    const { widthPt, heightPt } = await imageDimsPt(bytes, mime);
    insertImage(bytes, mime, widthPt, heightPt);
  };
```

(`insertImage` still uses `imgBytesToB64` — now imported. No change to the 📷 button, file input, or `insertImage` signature.)

- [ ] **Step 4: Run tests to verify they pass (paste helpers + toolbar still green)**

Run: `npm run test -- docxImagePaste docxToolbar > /tmp/t3.log 2>&1; tail -40 /tmp/t3.log`
Expected: PASS — docxImagePaste (9) + docxToolbar (all existing, incl. the slice-1 insertImage cases) green.

- [ ] **Step 5: Type-check + lint (the refactor touches two files)**

Run: `npm run type-check > /tmp/t3tc.log 2>&1; tail -5 /tmp/t3tc.log && npm run lint -- src/docx/docxImagePaste.ts src/docx/docxToolbar.ts > /tmp/t3lint.log 2>&1; tail -10 /tmp/t3lint.log`
Expected: type-check exit 0; lint clean (no non-null `!`, no `==`).

- [ ] **Step 6: Commit**

```bash
git add src/docx/docxImagePaste.ts src/docx/docxToolbar.ts tests/docx/docxImagePaste.test.ts
git commit -q -m "feat(docx): image-blob paste helpers + DRY toolbar image primitives (B cut&paste T3)"
```

---

### Task 4: wire `transformPasted` + `handlePaste` image-blob branch into the editor

**Files:**
- Modify: `src/docx/docxProseMirror.ts:366-379` (the `new EditorView({…})` props)
- Test: `tests/docx/docxImagePaste.test.ts` (a wiring assertion, jsdom)

**Interfaces:**
- Consumes: `resetPastedImageAnchors`, `firstImageFile`, `insertImageBlob` from `./docxImagePaste`.
- Produces: the editor resets pasted-image anchorIds and inserts pasted image blobs.

- [ ] **Step 1: Write the failing test (append) — transformPasted is wired and resets anchorId**

```ts
import { mountDocxEditor } from '../../src/docx/docxProseMirror';
import { zipSync, strToU8 } from 'fflate';

const MIN_DOC = `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>hi</w:t></w:r></w:p></w:body></w:document>`;
function tinyDocx(): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
    '_rels/.rels': strToU8('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
    'word/document.xml': strToU8(MIN_DOC),
    'word/_rels/document.xml.rels': strToU8('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>'),
  });
}

describe('editor paste wiring (jsdom)', () => {
  it('transformPasted resets a pasted docx_image anchorId to -1', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const handle = mountDocxEditor(host, tinyDocx());
    const n = docxSchema.nodes;
    const slice = new Slice(Fragment.fromArray([n.docx_image.create({ dataB64: 'AAA', mime: 'image/png', widthPt: 10, heightPt: 5, anchorId: 7 })]), 0, 0);
    const out = handle.view.someProp('transformPasted', f => f(slice, handle.view))!;
    expect(out.content.firstChild!.attrs.anchorId).toBe(-1);
    handle.destroy();
    host.remove();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- docxImagePaste > /tmp/t4.log 2>&1; tail -30 /tmp/t4.log`
Expected: FAIL — `someProp('transformPasted', …)` returns undefined (prop not wired) → `!` on undefined throws / assertion fails.

- [ ] **Step 3: Wire the props in `docxProseMirror.ts`**

Add to the imports near the top:

```ts
import { resetPastedImageAnchors, firstImageFile, insertImageBlob } from './docxImagePaste';
```

In the `new EditorView(container, { … })` props object (currently has `transformPastedHTML` + `handlePaste`), add `transformPasted` and extend `handlePaste`:

```ts
    transformPastedHTML: (html: string): string => cleanWordHtml(html),
    transformPasted: (slice) => resetPastedImageAnchors(slice),
    handlePaste: (v, event): boolean => {
      if (_plainPasteArmed) {
        _plainPasteArmed = false;
        const text = event.clipboardData?.getData('text/plain') ?? '';
        // Drop SOURCE formatting; inserted text inherits the destination context.
        v.dispatch(v.state.tr.insertText(text));
        return true;
      }
      const file = firstImageFile(event.clipboardData);
      if (file === null) return false; // let PM default handle text/html/slice paste
      void insertImageBlob(v, file);
      return true;
    },
```

(This replaces the existing `handlePaste` body, which previously early-returned `false` unless `_plainPasteArmed`. The plain-paste branch is preserved verbatim; the image-blob branch is added after it.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- docxImagePaste > /tmp/t4.log 2>&1; tail -30 /tmp/t4.log`
Expected: PASS (10 tests in the file).

- [ ] **Step 5: Commit**

```bash
git add src/docx/docxProseMirror.ts tests/docx/docxImagePaste.test.ts
git commit -q -m "feat(docx): wire transformPasted + handlePaste image-blob (B cut&paste T4)"
```

---

### Task 5: browser e2e + full deploy gate + live shot + docs

**Files:**
- Create: `tests/browser/docx-image-cutpaste.browser.test.ts`
- Modify: `CLAUDE.md` (DOCX section — add the cut&paste note)
- Modify: memory `project_maxfidelity_program_2026_06_25.md` + `MEMORY.md` pointer

**Interfaces:**
- Consumes: `mountDocxEditor`, `openOpc`/`getDocumentXml`, `docxSchema`, `moveImage` not needed; uses NodeSelection + PM paste APIs.

- [ ] **Step 1: Write the browser test**

```ts
// tests/browser/docx-image-cutpaste.browser.test.ts
/**
 * B sub-slice 3 — real-Chrome guard for image cut & paste.
 * Copy→paste must yield TWO w:drawing after save (proves the save did NOT bail to verbatim on a
 * duplicate anchorId — the whole bug this slice fixes). Cut→paste must yield exactly ONE, relocated.
 */
import { describe, it, expect } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { NodeSelection } from 'prosemirror-state';
import { Slice, Fragment } from 'prosemirror-model';
import { mountDocxEditor } from '../../src/docx/docxProseMirror';
import { openOpc, getDocumentXml } from '../../src/docx/opcEdit';
import { docxSchema } from '../../src/docx/docxSchema';

const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
function b64(b: string): Uint8Array { const s = atob(b); const o = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) o[i] = s.charCodeAt(i); return o; }
const CT = `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`;
const ROOT = `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdDoc" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;
const DREL = `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/></Relationships>`;
const DOC = `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>`
  + `<w:p><w:r><w:drawing><wp:inline><wp:extent cx="952500" cy="952500"/><a:graphic><a:graphicData><pic:pic><pic:spPr><a:xfrm><a:ext cx="952500" cy="952500"/></a:xfrm></pic:spPr><pic:blipFill><a:blip r:embed="rId1"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`
  + `<w:p><w:r><w:t>after</w:t></w:r></w:p></w:body></w:document>`;
function makeDocx(): Uint8Array {
  return zipSync({ '[Content_Types].xml': strToU8(CT), '_rels/.rels': strToU8(ROOT), 'word/document.xml': strToU8(DOC), 'word/_rels/document.xml.rels': strToU8(DREL), 'word/media/image1.png': b64(PNG_B64) });
}
function imgPos(view: { state: { doc: { descendants: (f: (n: { type: { name: string } }, p: number) => void) => void } } }): number {
  let pos = -1; view.state.doc.descendants((n, p) => { if (n.type.name === 'docx_image') pos = p; }); return pos;
}
function countDrawings(xml: string): number { return xml.split('<w:drawing').length - 1; }

describe('DOCX editor — image cut & paste (real browser)', () => {
  it('copy→paste yields TWO drawings after save (no verbatim bail on dup anchorId)', () => {
    const host = document.createElement('div'); document.body.appendChild(host);
    const handle = mountDocxEditor(host, makeDocx());
    const view = handle.view;
    // Select the image, simulate a paste of a COPY of it (PM would carry the same anchorId).
    const node = view.state.doc.nodeAt(imgPos(view))!;
    view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, imgPos(view))));
    const slice = view.someProp('transformPasted', f => f(new Slice(Fragment.fromArray([node]), 0, 0), view))!;
    // paste at end of document
    view.dispatch(view.state.tr.insert(view.state.doc.content.size, slice.content));
    const xml = getDocumentXml(openOpc(handle.save()));
    expect(countDrawings(xml)).toBe(2);
    handle.destroy(); host.remove();
  });

  it('cut→paste keeps exactly ONE drawing, relocated after the text', () => {
    const host = document.createElement('div'); document.body.appendChild(host);
    const handle = mountDocxEditor(host, makeDocx());
    const view = handle.view;
    const pos = imgPos(view);
    const node = view.state.doc.nodeAt(pos)!;
    // cut = delete the original; paste a transformed copy at the end (move via clipboard)
    const slice = view.someProp('transformPasted', f => f(new Slice(Fragment.fromArray([node]), 0, 0), view))!;
    let tr = view.state.tr.delete(pos, pos + node.nodeSize);
    tr = tr.insert(tr.doc.content.size, slice.content);
    view.dispatch(tr);
    const xml = getDocumentXml(openOpc(handle.save()));
    expect(countDrawings(xml)).toBe(1);
    expect(xml.indexOf('<w:drawing')).toBeGreaterThan(xml.indexOf('after')); // relocated after the text
    handle.destroy(); host.remove();
  });
});
```

- [ ] **Step 2: Run the browser test**

Run: `npm run test:browser -- docx-image-cutpaste > /tmp/t5.log 2>&1; tail -40 /tmp/t5.log`
Expected: PASS (2). If it fails on `view.someProp('transformPasted', …)` typing, cast the callback param to `Slice` locally — do not loosen the prop.

- [ ] **Step 3: Live eyes-on shot**

Start the dev server, open the DOCX editor, insert/copy/paste an image, screenshot to `qa-shots/b-cutpaste/`. (Manual browser via the dev server at `http://localhost:5173/pdfturbo/`; capture before/after of a copy-paste duplicating the image inline.)

- [ ] **Step 4: Full deploy gate**

Run each, append to one log, confirm all green:
```bash
npm audit --audit-level=high && npm run ocr:assets && npm run type-check && npm run lint && npm run test > /tmp/gate-jsdom.log 2>&1; tail -5 /tmp/gate-jsdom.log
npm run test:browser > /tmp/gate-browser.log 2>&1; tail -10 /tmp/gate-browser.log
npm run test:coverage:export > /tmp/gate-cov.log 2>&1; tail -8 /tmp/gate-cov.log
npm run build > /tmp/gate-build.log 2>&1; tail -5 /tmp/gate-build.log
```
Expected: audit 0 high/critical; jsdom suite green (+expected-fail blockers); browser suite green (re-run any non-deterministic canvas/pixel flake in isolation to confirm it is the known contention flake, NOT a regression — slice-3 touches only `src/docx/*`); coverage ≥25% branch on pdfElementRenderer.ts; build OK.

- [ ] **Step 5: Docs — CLAUDE.md + memory**

Add a "Image cut & paste (Sub-project B, sub-slice 3)" paragraph to the DOCX section of `CLAUDE.md` (mechanism: transformPasted anchorId-reset + scoped parseDOM + handlePaste image-blob → slice-1/2 mint path; cut = native copy+delete re-mint; ceiling: http(s) src/GIF/SVG/WebP/orphaned-media GC). Update the memory file + `MEMORY.md` pointer (slice 3 DONE, commit shas, gate result).

- [ ] **Step 6: Commit**

```bash
git add tests/browser/docx-image-cutpaste.browser.test.ts CLAUDE.md
git commit -q -m "test(docx): cut&paste browser e2e + docs (B cut&paste T5)"
# memory files are outside the repo — written via the Write tool, not committed here
```

---

## Self-review

- **Spec coverage:** Unit 1 → T1+T4; Unit 2 → T2; Unit 3 → T3+T4; cut (no code) → T5 browser test; ceiling → T5 docs. All covered.
- **Placeholder scan:** all code blocks are concrete; the live shot (T5 S3) is a manual eyes-on step (documented, not code).
- **Type consistency:** `resetPastedImageAnchors(Slice):Slice`, `firstImageFile(DataTransfer|null):File|null`, `insertImageBlob(EditorView,File):Promise<void>`, `imageDimsPt(bytes,mime):Promise<{widthPt,heightPt}>` — used identically across tasks and the toolbar refactor.
