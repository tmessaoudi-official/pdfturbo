# DOCX editor — new-image INSERT (phase B, sub-slice 1) — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline, item-by-item).
> Per-item commit, **no push** (manual). Steps use checkbox (`- [ ]`) syntax.

**Goal:** insert a PNG/JPEG into the DOCX editor; it renders, survives the in-place `save()` as a
real `w:drawing` (new media part + rels + Content-Types), and shows in Export PDF (via follow-up C).

**Architecture:** a save pre-pass `materializeNewImageAnchors` (minting OPC parts via a callback to
avoid an import cycle) adds new image `w:p` anchors into the DOM before `reconcileImageAnchors` +
`reconcileContainer`, placed by a parallel model/DOM walk. UI = a toolbar Insert button + file pick
inserting a `docx_image` node (anchorId −1).

**Tech Stack:** TypeScript, fflate (OPC), ProseMirror, @cantoo/pdf-lib (export, unaffected), vitest.

## Global Constraints

- No new dependencies. No `Co-Authored-By`. `git push` manual. oxlint: no `!`, no `==`.
- `docModel.ts` must NOT import `opcParts.ts` (cycle) → minting is a callback.
- Byte-identical save when no image is inserted; legacy `applyBlocks` callers unaffected.
- Spec: `docs/superpowers/specs/2026-06-26-docx-image-insert-design.md`.

---

### Task 1: `ensureImagePart` (OPC media minting)

**Files:** Modify `src/docx/opcParts.ts`; Test `tests/docx/opcParts.test.ts` (or new `opcImagePart.test.ts`).

**Interfaces:** Produces `ensureImagePart(opc: OpcPackage, bytes: Uint8Array, mime: 'image/png'|'image/jpeg'): { rId: string; target: string }`.

- [ ] **Step 1: Failing test** — write `tests/docx/opcImagePart.test.ts`: an OPC with empty
  `[Content_Types].xml` (xml+rels defaults) + `word/_rels/document.xml.rels`; call
  `ensureImagePart(opc, png, 'image/png')` → expect `opc.files['word/media/image1.png']` set, a
  `Default Extension="png"` in Content-Types, an image `Relationship` whose `Target="media/image1.png"`,
  and the returned `rId` matches. A 2nd call with JPEG → `image2.jpg`, a `jpeg` Default (png Default
  untouched), fresh rId.
- [ ] **Step 2: Run → fail** — `npm run test -- tests/docx/opcImagePart.test.ts > /tmp/b1.log 2>&1; tail -20 /tmp/b1.log` (ensureImagePart undefined).
- [ ] **Step 3: Implement** `ensureImagePart` in `opcParts.ts`:

```ts
const IMAGE_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image';
const EXT_CT: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg' };

export function ensureImagePart(opc: OpcPackage, bytes: Uint8Array, mime: 'image/png' | 'image/jpeg'): { rId: string; target: string } {
  const ext = mime === 'image/png' ? 'png' : 'jpg';
  // fresh media name
  let maxImg = 0;
  for (const p of Object.keys(opc.files)) { const m = /^word\/media\/image(\d+)\./.exec(p); if (m) maxImg = Math.max(maxImg, Number(m[1])); }
  const name = `image${maxImg + 1}.${ext}`;
  opc.files[`word/media/${name}`] = bytes;
  // Content-Types Default for the extension (add once)
  const ctXml = getPart(opc, CT_PATH);
  if (ctXml) {
    const dom = parse(ctXml);
    const defaults = dom.getElementsByTagName('Default');
    let has = false;
    for (let i = 0; i < defaults.length; i++) if ((defaults[i].getAttribute('Extension') ?? '').toLowerCase() === ext) has = true;
    if (!has) {
      const d = dom.createElementNS(CT_NS, 'Default');
      d.setAttribute('Extension', ext);
      d.setAttribute('ContentType', EXT_CT[ext]);
      dom.documentElement.appendChild(d);
      setPart(opc, CT_PATH, serialize(dom));
    }
  }
  // image Relationship (internal)
  const relsXml = getPart(opc, DOC_RELS) ?? `${XML_DECL}<Relationships xmlns="${REL_NS}"></Relationships>`;
  const dom = parse(relsXml);
  const rels = dom.getElementsByTagName('Relationship');
  let maxId = 0;
  for (let i = 0; i < rels.length; i++) { const m = /^rId(\d+)$/.exec(rels[i].getAttribute('Id') ?? ''); if (m) maxId = Math.max(maxId, Number(m[1])); }
  const rId = `rId${maxId + 1}`;
  const rel = dom.createElementNS(REL_NS, 'Relationship');
  rel.setAttribute('Id', rId);
  rel.setAttribute('Type', IMAGE_REL);
  rel.setAttribute('Target', `media/${name}`);
  dom.documentElement.appendChild(rel);
  setPart(opc, DOC_RELS, serialize(dom));
  return { rId, target: `media/${name}` };
}
```

- [ ] **Step 4: Run → pass**; **Step 5: type-check + lint**; **Step 6: Commit**
  `feat(docx): ensureImagePart — mint a word/media part + rels + Content-Types (B insert)`

---

### Task 2: `buildDrawingParagraph` + `materializeNewImageAnchors` + `applyBlocks` wiring

**Files:** Modify `src/docx/docModel.ts`; Test `tests/docx/docImageInsert.test.ts`.

**Interfaces:**
- `buildDrawingParagraph(dom: Document, rId: string, cx: number, cy: number, docPrId: number): Element`
- `materializeNewImageAnchors(mintImage: (bytes: Uint8Array, mime: 'image/png'|'image/jpeg') => string, body: Element, blocks: DocBlock[]): void`
- `applyBlocks(documentXml, blocks, ids?, opts?: { editImages?: boolean; mintImage?: (bytes, mime) => string }): string`

- [ ] **Step 1: Failing test** `tests/docx/docImageInsert.test.ts`:
  - `buildDrawingParagraph(dom, 'rId9', 952500, 952500, 1)` → the `w:p` has a `w:drawing` with
    `wp:extent@cx=952500`, an `a:blip@r:embed=rId9`.
  - `applyBlocks(docXmlWith[P, existingImg], [P, newImg, existingImg], undefined, { editImages: true, mintImage })`
    where `newImg = { kind:'image', image:{ dataB64: <1px png b64>, mime:'image/png', widthPt:75, heightPt:75 } }`
    (no anchorId) and `existingImg` carries `anchorId: 0`. Expect the output has **2** `w:drawing`,
    the new one placed BEFORE the existing image's `w:p` and AFTER P, and `mintImage` called once.
  - byte-identical: `applyBlocks(sameXml, sameBlocksNoNewImage)` (no `editImages`) unchanged.
- [ ] **Step 2: Run → fail.**
- [ ] **Step 3: Implement** `buildDrawingParagraph` (W_NS/`a:`/`pic:`/`wp:`/`r:` namespaces; minimal
  spec-valid inline pic) + `materializeNewImageAnchors` (parallel walk per the spec: cursor over
  `containerBlockEls(body)`; advance past existing boundary/text DOM children; for a new image block
  — `isDocImageBlock(b) && b.image && b.anchorId === undefined` — decode `image.dataB64`→bytes, call
  `mintImage`→rId, `buildDrawingParagraph`, `body.insertBefore(newP, cursorEl ?? null)`, splice into
  the local array). Add `mintImage` to `applyBlocks` opts; call
  `materializeNewImageAnchors(opts.mintImage, body, blocks)` before `reconcileImageAnchors` when
  `opts.editImages && opts.mintImage`.
- [ ] **Step 4: Run → pass**; **Step 5: type-check + lint**; **Step 6: Commit**
  `feat(docx): materialize new image anchors on save (B insert engine)`

---

### Task 3: editor save wiring + toolbar Insert button (+ browser test, live shot)

**Files:** Modify `src/docx/docxProseMirror.ts` (save passes `mintImage`), `src/docx/docxToolbar.ts`
(Insert button + file input + insert command), `locales/{en,fr,ar}.json` (`docxToolbar.insertImage`);
Test `tests/browser/docx-image-insert.browser.test.ts`, extend `tests/docx/docxToolbar.test.ts`.

- [ ] **Step 1: Failing browser test** — mount the editor; invoke the toolbar's insert path with a
  known PNG (set the hidden input's `files` + dispatch `change`, or call an exposed
  `insertImage(bytes, mime, w, h)`); expect `[data-docx-image]` appears; `handle.save()` →
  reopen → `w:drawing` + a `word/media/imageN.png` part present.
- [ ] **Step 2: Run → fail.**
- [ ] **Step 3: Implement** — `docxProseMirror.ts` save: pass
  `applyBlocks(xml, blocks, ids, { editImages: true, mintImage: (bytes, mime) => ensureImagePart(opc, bytes, mime).rId })`.
  `docxToolbar.ts`: add the Insert button + hidden file input; on change read bytes, sniff mime,
  `createImageBitmap` for dims, compute widthPt/heightPt, dispatch a tr inserting a `docx_image`
  node (anchorId −1) at the selection. i18n key in all three locales (ar [Unverified]).
- [ ] **Step 4: Run → pass** (browser + jsdom toolbar test); **Step 5: type-check + lint**;
  **Step 6: Commit** `feat(docx): toolbar Insert image — pick + place a new image (B insert UI)`

---

### Task 4: Gate + live shot + docs

- [ ] **Step 1: FULL deploy gate** (audit → ocr → type-check → lint → test → test:browser →
  coverage:export → build), all green.
- [ ] **Step 2: Live shot** — dev server + Playwright: open the editor on a blank/loaded doc,
  Insert an image, screenshot it rendered + (optionally) Export PDF showing it. Save to `qa-shots/b-insert/`.
- [ ] **Step 3: Docs** — CLAUDE.md DOCX section: new "image INSERT" note (ensureImagePart +
  materializeNewImageAnchors parallel-walk + the callback-not-opc cycle reason); Decisions-Log line;
  memory + MEMORY.md refresh.
- [ ] **Step 4: Commit** `docs(docx): image-insert (B sub-slice 1) — engine + UI notes`

## Self-review

- **Spec coverage:** ensureImagePart (T1), buildDrawingParagraph + materialize + applyBlocks (T2),
  save wiring + UI (T3), gate+docs (T4). ✓
- **Cycle:** minting via callback, docModel never imports opcParts. ✓
- **Byte-identical:** materialize gated by `editImages && mintImage`; legacy callers pass neither. ✓
- **Type consistency:** `mintImage(bytes, mime) => string` identical across materialize / applyBlocks
  opts / the save wiring. ✓
