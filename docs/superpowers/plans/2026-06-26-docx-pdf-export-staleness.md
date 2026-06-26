# DOCX→PDF export-staleness fix — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline, item-by-item).
> Per-item commit, **no push** (manual). Steps use checkbox (`- [ ]`) syntax.

**Goal:** the DOCX editor's Export PDF reflects in-session image resize/delete by rendering
images directly from the live model's `DocImageBlock.image`, dropping the stale
`getImages()`/`opts.images` channel.

**Architecture:** single source of truth = the live `DocModel`. `docModelToPdfBytes` draws each
`DocImageBlock` from its own `image` data at the block's position; the controller stops passing
`getImages()`. Net code deletion.

**Tech Stack:** TypeScript, @cantoo/pdf-lib, vitest (jsdom + real-Chrome via Playwright).

## Global Constraints

- No new dependencies. No `Co-Authored-By` trailers. `git push` is manual.
- oxlint: no non-null `!`, no `==` (use `=== undefined`), `_`-prefix unused vars.
- Byte-behaviour for a doc with NO edited images must be unchanged (unedited export still embeds
  every supported image, same position/size).
- Spec: `docs/superpowers/specs/2026-06-26-docx-pdf-export-staleness-design.md`.

---

### Task 1: Render image blocks from the live model; drop the stale channel

**Files:**
- Modify: `src/docx/docxToPdf.ts` (render loop ~510-516; `drawImage` ~483-499; `imagesByBlock`
  ~502-507; `DocxToPdfOptions.images` ~128-129; `DocImage` import line 23)
- Modify: `src/docx/docxEditorController.ts` (`onExportPdf` ~200-203)
- Test: `tests/browser/docx-to-pdf.browser.test.ts` (rewrite the inline-image test + add
  delete/resize cases)
- Test: `tests/docx/docxToPdf.test.ts` (no-throw with an image block; existing cases keep passing)

**Interfaces:**
- Consumes: `DocImageBlock` (`{ image?: { dataB64; mime; widthPt; heightPt }, anchorId? }`),
  `isDocImageBlock` (from `docModel.ts`).
- Produces: `docModelToPdfBytes(model: DocModel, opts?: DocxToPdfOptions)` — `DocxToPdfOptions`
  no longer has `images`. Behaviour: each `DocImageBlock` with a defined `image` is embedded and
  drawn at its block position.

- [ ] **Step 1: Write the failing browser tests**

In `tests/browser/docx-to-pdf.browser.test.ts`, replace the existing
"embeds an inline image passed via `{ images }`" test with a model-block version and add two
cases. Use a 1×1 (or small) PNG base64 as `dataB64`.

```ts
import { isDocImageBlock } from '../../src/docx/docModel'; // if needed for clarity
// helper already present: a small PNG dataB64 constant

function imageModel(widthPt: number) {
  const img = { kind: 'image' as const, image: { dataB64: PNG_B64, mime: 'image/png' as const, widthPt, heightPt: widthPt } , anchorId: 0 };
  const para = { runs: [{ text: 'Caption' }] };
  return { blocks: [para, img], paragraphs: [para] };
}

async function countPaintImage(bytes: Uint8Array): Promise<number> {
  const pdfjs = await import('pdfjs-dist');
  const doc = await pdfjs.getDocument({ data: bytes }).promise;
  let n = 0;
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const ops = await page.getOperatorList();
    n += ops.fnArray.filter((f: number) => f === pdfjs.OPS.paintImageXObject || f === pdfjs.OPS.paintInlineImageXObject).length;
  }
  return n;
}

it('renders an image from a DocImageBlock (no { images } channel)', async () => {
  const { bytes } = await docModelToPdfBytes(imageModel(80));
  expect(await countPaintImage(bytes)).toBeGreaterThan(0);
});

it('omits a deleted image (block absent → no paintImageXObject)', async () => {
  const para = { runs: [{ text: 'Caption' }] };
  const { bytes } = await docModelToPdfBytes({ blocks: [para], paragraphs: [para] });
  expect(await countPaintImage(bytes)).toBe(0);
});

it('reflects a resized image block (larger widthPt → wider painted image)', async () => {
  const small = await docModelToPdfBytes(imageModel(60));
  const large = await docModelToPdfBytes(imageModel(200));
  // pdf.js transform[0] (a) of the paintImageXObject scale carries the on-page width.
  const widthOf = async (bytes: Uint8Array) => {
    const pdfjs = await import('pdfjs-dist');
    const doc = await pdfjs.getDocument({ data: bytes }).promise;
    const page = await doc.getPage(1);
    const ops = await page.getOperatorList();
    let w = 0;
    for (let i = 0; i < ops.fnArray.length; i++) {
      if (ops.fnArray[i] === pdfjs.OPS.transform) w = Math.max(w, Math.abs(ops.argsArray[i][0]));
    }
    return w;
  };
  expect(await widthOf(large.bytes)).toBeGreaterThan(await widthOf(small.bytes));
});
```

- [ ] **Step 2: Run the browser tests to confirm they fail**

Run: `npm run test:browser -- --config vitest.browser.config.ts tests/browser/docx-to-pdf.browser.test.ts > /tmp/c-t1.log 2>&1; tail -40 /tmp/c-t1.log`
Expected: the three new cases FAIL (type error on `images` removal not yet done, or the model-block
images aren't drawn because the loop still relies on `opts.images`). Confirm they fail for the
right reason.

- [ ] **Step 3: Implement the render-from-block change in `docxToPdf.ts`**

In the top-level loop, draw the image block from its own data:

```ts
const topList = makeListState();
for (let bi = 0; bi < model.blocks.length; bi++) {
  const block = model.blocks[bi];
  if (isDocTable(block)) drawTableFlow(block);
  else if (isDocImageBlock(block)) { if (block.image) await drawImage(block.image); }
  else drawParagraphFlow(block, topList.markerFor(block));
}
```

Change `drawImage` to take the image fields (same shape, now from the block):

```ts
const drawImage = async (img: { dataB64: string; mime: 'image/png' | 'image/jpeg'; widthPt: number; heightPt: number }): Promise<void> => {
  let embedded;
  try {
    const data = _b64ToBytes(img.dataB64);
    embedded = img.mime === 'image/png' ? await doc.embedPng(data) : await doc.embedJpg(data);
  } catch { return; }
  let w = img.widthPt > 0 ? img.widthPt : embedded.width;
  let h = img.heightPt > 0 ? img.heightPt : embedded.height;
  if (w > contentW) { h *= contentW / w; w = contentW; }
  const maxH = pageHeight - 2 * margin;
  if (h > maxH) { w *= maxH / h; h = maxH; }
  if (y - h < margin) newPage();
  page.drawImage(embedded, { x: margin, y: y - h, width: w, height: h });
  y -= h + paraGap;
};
```

Delete the `imagesByBlock` map + its populate loop (~502-507) and the trailing
`for (const im of imagesByBlock.get(bi) ?? []) await drawImage(im);` (line 515).
Remove `images?: DocImage[];` from `DocxToPdfOptions`. Remove the now-unused
`import type { DocImage } from './docxImages';` if nothing else references it.

- [ ] **Step 4: Update the controller call site**

`src/docx/docxEditorController.ts` `onExportPdf`: remove `const images = handle.getImages();`
and pass no images:

```ts
const model = handle.getModel();
import('./docxToPdf')
  .then(({ docModelToPdfBytes }) => docModelToPdfBytes(model))
  // …rest unchanged
```

(Leave `getImages()` defined on the handle — retained for phase B.)

- [ ] **Step 5: Run browser + jsdom tests to confirm pass**

Run: `npm run test:browser -- --config vitest.browser.config.ts tests/browser/docx-to-pdf.browser.test.ts > /tmp/c-t1.log 2>&1; tail -40 /tmp/c-t1.log`
Run: `npm run test -- tests/docx/docxToPdf.test.ts > /tmp/c-t1j.log 2>&1; tail -30 /tmp/c-t1j.log`
Expected: all PASS. Add a jsdom no-throw test in `tests/docx/docxToPdf.test.ts`:

```ts
it('renders a model containing an image block without throwing (no { images } channel)', async () => {
  const para = { runs: [{ text: 'x' }] };
  const img = { kind: 'image' as const, image: { dataB64: '', mime: 'image/png' as const, widthPt: 50, heightPt: 50 }, anchorId: 0 };
  const { bytes } = await docModelToPdfBytes({ blocks: [para, img], paragraphs: [para] });
  expect(bytes.length).toBeGreaterThan(0); // empty dataB64 → drawImage try/catch skips it; text still renders
});
```

- [ ] **Step 6: Type-check + lint**

Run: `npm run type-check && npm run lint`
Expected: clean (no `DocImage` unused-import error, no `images` references left).

- [ ] **Step 7: Commit**

```bash
git add src/docx/docxToPdf.ts src/docx/docxEditorController.ts tests/browser/docx-to-pdf.browser.test.ts tests/docx/docxToPdf.test.ts
git commit -m "fix(docx): Export PDF renders images from the live model (resize/delete reflected)"
```

---

### Task 2: Docs + live verification

**Files:**
- Modify: `CLAUDE.md` (DOCX→PDF / Feature-5 image bullet — note export now reads the live model,
  drop the "stale until save+reopen" ceiling line)
- Modify: `docs/plans/maxfidelity-program-2026-06-25.plan.md` (Decisions Log: C done)
- Modify: memory (`project_maxfidelity_program_2026_06_25.md` + `MEMORY.md`)

- [ ] **Step 1: Full deploy gate**

Run the FULL gate and capture output:
`npm audit --audit-level=high && npm run ocr:assets && npm run type-check && npm run lint && npm run test > /tmp/c-jsdom.log 2>&1; tail -5 /tmp/c-jsdom.log`
then `npm run test:browser > /tmp/c-browser.log 2>&1; tail -8 /tmp/c-browser.log`
then `npm run test:coverage:export > /tmp/c-cov.log 2>&1; tail -8 /tmp/c-cov.log`
then `npm run build > /tmp/c-build.log 2>&1; tail -5 /tmp/c-build.log`
Expected: all green.

- [ ] **Step 2: Live before/after Export-PDF screenshot**

Dev server + Playwright: open the DOCX editor with the real-image fixture
(`qa-shots/c-phase2b-live/qa-image.docx`), resize the image, click **Export PDF**, intercept the
download (delete `window.showSaveFilePicker` if needed), render page 1 of the resulting PDF, and
screenshot. Confirm the exported image is the RESIZED size (before this fix it would be the
original). Save to `qa-shots/c-export/`.

- [ ] **Step 3: Update CLAUDE.md + plan + memory**

Edit the Feature-5 image bullet: the DOCX→PDF export now reads the live model, so an in-session
resize/delete shows in the PDF immediately (remove the "in PDF only after save+reopen" ceiling
sentence). Append a Decisions-Log "C DONE" line. Refresh the memory file + MEMORY.md pointer.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md docs/plans/maxfidelity-program-2026-06-25.plan.md
git commit -m "docs(docx): export-staleness fix — Export PDF reads the live model (follow-up C)"
```

## Self-review

- **Spec coverage:** render-from-block (Task 1 S3), drop stale channel (S3), controller (S4),
  delete (browser test S1), resize (browser test S1), unedited unchanged (existing browser image
  test rewritten to a block still embeds), jsdom no-throw (S5). ✓
- **Placeholders:** none — every step has concrete code/commands.
- **Type consistency:** `drawImage` param shape matches `DocImageBlock.image`; `DocxToPdfOptions`
  loses `images`; `isDocImageBlock` already imported in `docxToPdf.ts`. ✓
- **Contingency:** if `embedPng` unexpectedly works/needed in jsdom differently, the image
  assertions are browser-only by design — jsdom only checks no-throw, so no jsdom embed risk.
