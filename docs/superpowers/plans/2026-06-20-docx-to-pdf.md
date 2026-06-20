# DOCX→PDF (#1d) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Export the DOCX editor's content as a selectable-text PDF (paragraphs + per-run bold/italic), completing the read→edit→export loop.

**Architecture:** A new pure renderer `src/docx/docxToPdf.ts` lays out the `DocModel` (paragraphs→runs) with `@cantoo/pdf-lib` Helvetica `StandardFonts` (word-wrap, pagination, per-run bold/italic). The editor handle gains `getModel()`; the controller adds an "Export PDF" button that downloads `<base>.pdf`. WinAnsi-only fonts → non-CP1252 chars sanitized to `?` with a warn toast.

**Tech Stack:** TypeScript, Vite, `@cantoo/pdf-lib` (already a dep), Vitest (jsdom + real-Chrome browser harness), ProseMirror (existing editor), i18next.

## Global Constraints

- Client-side only; no backend; no network at runtime.
- **Zero new npm dependencies** — use `@cantoo/pdf-lib` only.
- License: MIT/BSD/permissive only (no copyleft). pdf-lib is MIT-class. ✓
- Private-method/var convention: `_underscore` prefix; oxlint `no-underscore-dangle` is OFF.
- All user-visible strings via `t()`; the three locale files (`en`/`fr`/`ar`) MUST stay key-identical (a hook checks on write). Arabic values are `[Unverified]`.
- Rides feature flag `VITE_FEATURE_DOCX_EDIT` (no new flag).
- Before-commit gate (== CI): `npm run type-check && npm run lint && npm run test`. Browser changes also run `npm run test:browser`.
- Commit style: `feat:`/`fix:`/`refactor:`/`docs:`, imperative subject. NO `Co-Authored-By` trailer. `git push` is MANUAL.
- SDKMAN floods bash stdout — redirect command output to a `/tmp` file and read it back.

---

### Task 1: WinAnsi sanitizer

**Files:**
- Create: `src/docx/docxToPdf.ts` (sanitizer only this task)
- Test: `tests/docx/docxToPdf.test.ts`

**Interfaces:**
- Produces: `sanitizeWinAnsi(s: string): { text: string; replaced: boolean }` — replaces every codepoint NOT encodable by pdf-lib's WinAnsi `StandardFonts` with `?`; `replaced` is true iff any char was replaced.

- [ ] **Step 1: Write the failing test**

```ts
// tests/docx/docxToPdf.test.ts
import { describe, it, expect } from 'vitest';
import { sanitizeWinAnsi } from '../../src/docx/docxToPdf';

describe('sanitizeWinAnsi', () => {
  it('passes ASCII and Latin-1/CP1252 through unchanged', () => {
    expect(sanitizeWinAnsi('Hello, café — €5 “quote”')).toEqual({
      text: 'Hello, café — €5 “quote”',
      replaced: false,
    });
  });
  it('replaces non-WinAnsi (CJK / emoji) with ? and flags it', () => {
    const r = sanitizeWinAnsi('hi 世界 🚀');
    expect(r.text).toBe('hi ?? ??'); // 2 CJK + emoji(surrogate pair → 2 units) → all ?
    expect(r.replaced).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- docxToPdf 2>&1 | tail -20`
Expected: FAIL — `sanitizeWinAnsi` is not exported.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/docx/docxToPdf.ts
/** CP1252 high chars (0x80–0x9F slots) mapped to their Unicode codepoints. */
const WINANSI_EXTRA = new Set<number>([
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160,
  0x2039, 0x0152, 0x017d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014,
  0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x017e, 0x0178,
]);

/** True when pdf-lib's WinAnsi StandardFonts can encode this codepoint. */
function _isWinAnsi(cp: number): boolean {
  return (cp >= 0x20 && cp <= 0x7e) || (cp >= 0xa0 && cp <= 0xff) || WINANSI_EXTRA.has(cp);
}

/** Replace every non-WinAnsi codepoint with '?'. Newline/tab are left to the caller. */
export function sanitizeWinAnsi(s: string): { text: string; replaced: boolean } {
  let out = '';
  let replaced = false;
  for (const ch of s) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp === 0x09 || cp === 0x0a || cp === 0x0d || _isWinAnsi(cp)) {
      out += ch;
    } else {
      out += '?';
      replaced = true;
    }
  }
  return { text: out, replaced };
}
```

> Note: `for…of` iterates by code point, so an emoji (surrogate pair) is ONE iteration → one `?`. The test expects emoji → `??` only if counting UTF-16 units. **Correct the test to match code-point iteration:** emoji 🚀 → one `?`, so `'hi 世界 🚀'` → `'hi ?? ?'`. Fix the test's expected string to `'hi ?? ?'` before running.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- docxToPdf 2>&1 | tail -20`
Expected: PASS (2 tests). If the emoji assertion fails, set expected to `'hi ?? ?'`.

- [ ] **Step 5: Commit**

```bash
git add src/docx/docxToPdf.ts tests/docx/docxToPdf.test.ts
git commit -m "feat: WinAnsi sanitizer for DOCX→PDF (#1d)"
```

---

### Task 2: `docModelToPdfBytes` renderer (layout + pagination)

**Files:**
- Modify: `src/docx/docxToPdf.ts`
- Test: `tests/docx/docxToPdf.test.ts`

**Interfaces:**
- Consumes: `sanitizeWinAnsi` (Task 1); `DocModel`/`DocParagraph`/`DocRun` from `./docModel`.
- Produces:
  - `interface DocxToPdfOptions { pageWidth?; pageHeight?; margin?; fontSize?; lineHeight?; paragraphGap?; }` (all `number`, optional)
  - `interface DocxToPdfResult { bytes: Uint8Array; hadUnsupportedChars: boolean }`
  - `async function docModelToPdfBytes(model: DocModel, opts?: DocxToPdfOptions): Promise<DocxToPdfResult>`

- [ ] **Step 1: Write the failing tests**

```ts
// append to tests/docx/docxToPdf.test.ts
import { docModelToPdfBytes } from '../../src/docx/docxToPdf';
import { PDFDocument } from '@cantoo/pdf-lib';
import type { DocModel } from '../../src/docx/docModel';

const para = (text: string, bold = false, italic = false): DocModel['paragraphs'][number] => ({
  runs: [{ text, bold, italic }],
});

describe('docModelToPdfBytes', () => {
  it('produces a loadable 1-page PDF for a short document', async () => {
    const { bytes, hadUnsupportedChars } = await docModelToPdfBytes({
      paragraphs: [para('Hello world'), para('Second paragraph')],
    });
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
    expect(hadUnsupportedChars).toBe(false);
  });

  it('paginates a long document onto multiple pages', async () => {
    const paragraphs = Array.from({ length: 200 }, (_, i) => para(`Paragraph number ${i}`));
    const { bytes } = await docModelToPdfBytes({ paragraphs });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThan(1);
  });

  it('flags unsupported characters from the document text', async () => {
    const { hadUnsupportedChars } = await docModelToPdfBytes({ paragraphs: [para('東京')] });
    expect(hadUnsupportedChars).toBe(true);
  });

  it('hard-breaks a single token wider than the content width without throwing', async () => {
    const long = 'x'.repeat(2000);
    const { bytes } = await docModelToPdfBytes({ paragraphs: [para(long)] });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
  });

  it('embeds a bold font when a run is bold', async () => {
    const { bytes } = await docModelToPdfBytes({ paragraphs: [para('Bold', true)] });
    // Helvetica-Bold appears in the serialized fonts.
    expect(new TextDecoder('latin1').decode(bytes)).toContain('Helvetica-Bold');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test -- docxToPdf 2>&1 | tail -25`
Expected: FAIL — `docModelToPdfBytes` not exported.

- [ ] **Step 3: Implement the renderer**

Append to `src/docx/docxToPdf.ts`:

```ts
import { PDFDocument, StandardFonts, type PDFFont } from '@cantoo/pdf-lib';
import type { DocModel, DocParagraph } from './docModel';

export interface DocxToPdfOptions {
  pageWidth?: number;
  pageHeight?: number;
  margin?: number;
  fontSize?: number;
  lineHeight?: number;   // multiple of fontSize
  paragraphGap?: number; // points after each paragraph
}
export interface DocxToPdfResult {
  bytes: Uint8Array;
  hadUnsupportedChars: boolean;
}

const A4_W = 595.28;
const A4_H = 841.89;

interface Token { text: string; font: PDFFont; width: number; spaceBefore: boolean; spaceW: number; }

export async function docModelToPdfBytes(
  model: DocModel,
  opts: DocxToPdfOptions = {},
): Promise<DocxToPdfResult> {
  const pageWidth = opts.pageWidth ?? A4_W;
  const pageHeight = opts.pageHeight ?? A4_H;
  const margin = opts.margin ?? 72;
  const size = opts.fontSize ?? 11;
  const lineH = (opts.lineHeight ?? 1.15) * size;
  const paraGap = opts.paragraphGap ?? 6;
  const contentW = pageWidth - 2 * margin;

  const doc = await PDFDocument.create();
  const fonts = {
    reg: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    ital: await doc.embedFont(StandardFonts.HelveticaOblique),
    boldItal: await doc.embedFont(StandardFonts.HelveticaBoldOblique),
  };
  const fontFor = (b?: boolean, i?: boolean): PDFFont =>
    b && i ? fonts.boldItal : b ? fonts.bold : i ? fonts.ital : fonts.reg;

  let hadUnsupportedChars = false;
  let page = doc.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;

  const newPage = (): void => { page = doc.addPage([pageWidth, pageHeight]); y = pageHeight - margin; };

  const drawLine = (line: Token[]): void => {
    if (y - lineH < margin) newPage();
    let x = margin;
    line.forEach((tok, idx) => {
      if (idx > 0 && tok.spaceBefore) x += tok.spaceW;
      page.drawText(tok.text, { x, y: y - size, size, font: tok.font });
      x += tok.width;
    });
    y -= lineH;
  };

  // Build tokens for one paragraph (run-level tokenization).
  const tokenize = (p: DocParagraph): Token[] => {
    const toks: Token[] = [];
    for (const run of p.runs) {
      const { text, replaced } = sanitizeWinAnsi(run.text);
      if (replaced) hadUnsupportedChars = true;
      const font = fontFor(run.bold, run.italic);
      const spaceW = font.widthOfTextAtSize(' ', size);
      // Split keeping track of whether each word was preceded by whitespace.
      const re = /(\s+)?(\S+)/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        const word = m[2];
        const spaceBefore = m[1] !== undefined || toks.length > 0;
        // hard-break a word wider than the content width
        let chunk = '';
        for (const ch of word) {
          const trial = chunk + ch;
          if (font.widthOfTextAtSize(trial, size) > contentW && chunk) {
            toks.push({ text: chunk, font, width: font.widthOfTextAtSize(chunk, size), spaceBefore: spaceBefore && toks.length === 0 ? false : toks.length > 0, spaceW });
            chunk = ch;
          } else {
            chunk = trial;
          }
        }
        toks.push({ text: chunk, font, width: font.widthOfTextAtSize(chunk, size), spaceBefore, spaceW });
      }
    }
    return toks;
  };

  for (const p of model.paragraphs) {
    const toks = tokenize(p);
    if (toks.length === 0) { y -= lineH; continue; } // blank paragraph
    let line: Token[] = [];
    let lineW = 0;
    for (const tok of toks) {
      const add = (line.length > 0 && tok.spaceBefore ? tok.spaceW : 0) + tok.width;
      if (lineW + add > contentW && line.length > 0) {
        drawLine(line);
        line = [{ ...tok, spaceBefore: false }];
        lineW = tok.width;
      } else {
        line.push(tok);
        lineW += add;
      }
    }
    if (line.length > 0) drawLine(line);
    y -= paraGap;
  }

  const bytes = await doc.save();
  return { bytes, hadUnsupportedChars };
}
```

> Implementation note: the hard-break inner-loop `spaceBefore` bookkeeping is intentionally
> conservative — only the FIRST token of the paragraph suppresses a leading space; later
> broken chunks are mid-word and never add a space (their `spaceBefore` only matters when
> they become a line-start, where `drawLine` skips the leading space for `idx===0`). If the
> ternary reads awkwardly to the implementer, simplify to: broken chunks after the first get
> `spaceBefore: false`; only the natural word token keeps the real `spaceBefore`.

- [ ] **Step 4: Run to verify pass**

Run: `npm run test -- docxToPdf 2>&1 | tail -25`
Expected: PASS (all sanitizer + renderer tests). Then `npm run type-check 2>&1 | tail -5` → exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/docx/docxToPdf.ts tests/docx/docxToPdf.test.ts
git commit -m "feat: DocModel→PDF renderer with word-wrap + pagination (#1d)"
```

---

### Task 3: `getModel()` on the editor handle

**Files:**
- Modify: `src/docx/docxProseMirror.ts` (`DocxEditorHandle` + `mountDocxEditor` return)
- Test: `tests/docx/docxEditor.test.ts`

**Interfaces:**
- Consumes: `docToDocModel` (already in the file).
- Produces: `DocxEditorHandle.getModel(): DocModel`.

- [ ] **Step 1: Write the failing test**

```ts
// add to tests/docx/docxEditor.test.ts (reuse the file's makeStyledDocx / mount helpers)
it('handle.getModel() returns the current paragraphs+runs model', () => {
  const container = document.createElement('div');
  const handle = mountDocxEditor(container, makeStyledDocx());
  const model = handle.getModel();
  expect(model.paragraphs.length).toBeGreaterThan(0);
  expect(model.paragraphs.some(p => p.runs.some(r => r.text.length > 0))).toBe(true);
  handle.destroy();
});
```

> Check the existing test file's imports/helpers; reuse `mountDocxEditor` + the existing
> `makeStyledDocx()` fixture rather than redefining them.

- [ ] **Step 2: Run to verify failure**

Run: `npm run test -- docxEditor 2>&1 | tail -20`
Expected: FAIL — `getModel` is not a function.

- [ ] **Step 3: Implement**

In `src/docx/docxProseMirror.ts`, add to the `DocxEditorHandle` interface:

```ts
  /** The current editable model (paragraphs + per-run bold/italic) — used by PDF export. */
  getModel(): DocModel;
```

and in the `mountDocxEditor` return object (next to `save`):

```ts
    getModel(): DocModel {
      return docToDocModel(view.state.doc);
    },
```

- [ ] **Step 4: Run to verify pass**

Run: `npm run test -- docxEditor 2>&1 | tail -20`
Expected: PASS. Then `npm run type-check 2>&1 | tail -5` → exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/docx/docxProseMirror.ts tests/docx/docxEditor.test.ts
git commit -m "feat: expose getModel() on DocxEditorHandle for PDF export (#1d)"
```

---

### Task 4: Controller "Export PDF" wiring + i18n

**Files:**
- Modify: `src/docx/docxEditorController.ts`
- Modify: `locales/en.json`, `locales/fr.json`, `locales/ar.json`
- Test: `tests/docx/docxEditorController.test.ts`

**Interfaces:**
- Consumes: `docModelToPdfBytes` (Task 2, dynamically imported); `handle.getModel()` (Task 3); the existing `download`/`notify` seams.
- Produces: an `exportPdf` action on the controller (button-driven; also callable in tests via the rendered button click).

- [ ] **Step 1: Add locale keys (all three, key-identical)**

In each of `locales/en.json`, `fr.json`, `ar.json`, under the existing `docxEditor` object add:

```jsonc
// en.json
"exportPdf": "Export PDF",
"pdfExported": "PDF exported",
"pdfUnsupportedChars": "Some characters aren’t supported by the PDF fonts and were replaced with “?”",
"pdfFailed": "Couldn’t export the PDF"
```
```jsonc
// fr.json
"exportPdf": "Exporter en PDF",
"pdfExported": "PDF exporté",
"pdfUnsupportedChars": "Certains caractères ne sont pas pris en charge par les polices PDF et ont été remplacés par « ? »",
"pdfFailed": "Échec de l’export PDF"
```
```jsonc
// ar.json  ([Unverified] — machine-translated, needs native review)
"exportPdf": "تصدير PDF",
"pdfExported": "تم تصدير PDF",
"pdfUnsupportedChars": "بعض الأحرف غير مدعومة في خطوط PDF وتم استبدالها بـ «؟»",
"pdfFailed": "تعذّر تصدير PDF"
```

> The locale-sync hook checks 3-way key parity on write; keep the keys identical across files.

- [ ] **Step 2: Write the failing controller test**

```ts
// add to tests/docx/docxEditorController.test.ts (reuse the file's makeDocx + seam pattern)
it('Export PDF downloads a .pdf via the download seam', async () => {
  const downloads: { bytes: Uint8Array; filename: string }[] = [];
  const ctrl = createDocxEditorController({
    loadEditor: async (mount, bytes) => mountDocxEditor(mount, bytes),
    download: (bytes, filename) => downloads.push({ bytes, filename }),
    notify: () => {},
  });
  await ctrl.loadBytes(makeDocx(), 'report.docx');
  const btn = document.querySelector('.docx-editor-export-pdf') as HTMLButtonElement;
  expect(btn).toBeTruthy();
  btn.click();
  await new Promise<void>(r => { setTimeout(r, 0); }); // exportPdf is async (dynamic import)
  expect(downloads.some(d => d.filename === 'report.pdf')).toBe(true);
  ctrl.destroy();
});
```

> Match the existing test file's helper names (`makeDocx`, the seam-injection shape). If the
> existing tests construct the controller differently, mirror that exactly.

- [ ] **Step 3: Run to verify failure**

Run: `npm run test -- docxEditorController 2>&1 | tail -20`
Expected: FAIL — no `.docx-editor-export-pdf` button.

- [ ] **Step 4: Implement the wiring**

In `src/docx/docxEditorController.ts`:

**First, widen the `notify` seam to accept `'warn'`** (verified: it is currently `'info' | 'error'` at line 25):
```ts
  notify?: (key: string, kind: 'info' | 'warn' | 'error') => void;
```
and update the `main.ts` lambda (verified at `src/main.ts:106`) so `'warn'` routes to `app.reportError.warn`:
```ts
          notify: (key, kind) =>
            kind === 'error' ? app.reportError.error(key)
            : kind === 'warn' ? app.reportError.warn(key)
            : app.reportError.info(key),
```
(`app.reportError.warn(msgKey, params?)` exists — see `src/core/errorReporter.ts`.)

Add a `pdfName` helper near `editedName`:
```ts
function pdfName(filename: string): string {
  return `${filename.replace(/\.docx$/i, '')}.pdf`;
}
```

Create the button next to `saveBtn`:
```ts
  const exportPdfBtn = document.createElement('button');
  exportPdfBtn.type = 'button';
  exportPdfBtn.className = 'docx-editor-export-pdf btn';
  exportPdfBtn.textContent = t('docxEditor.exportPdf');
```
and include it in the header append (before `saveBtn` or after — keep `closeBtn` last):
```ts
  header.append(title, exportPdfBtn, saveBtn, closeBtn);
```

Add the handler:
```ts
  const onExportPdf = (): void => {
    if (!handle) return;
    const model = handle.getModel();
    import('./docxToPdf')
      .then(({ docModelToPdfBytes }) => docModelToPdfBytes(model))
      .then(({ bytes, hadUnsupportedChars }) => {
        download(bytes, pdfName(currentName));
        notify('docxEditor.pdfExported', 'info');
        if (hadUnsupportedChars) notify('docxEditor.pdfUnsupportedChars', 'warn');
      })
      .catch(() => notify('docxEditor.pdfFailed', 'error'));
  };
```

(The `notify` seam was widened to `'warn'` at the top of this step.)

Wire + unwire the listener (mirror `saveBtn`):
```ts
  exportPdfBtn.addEventListener('click', onExportPdf);   // near saveBtn.addEventListener
  // in destroy(): exportPdfBtn.removeEventListener('click', onExportPdf);
```

- [ ] **Step 5: Run to verify pass**

Run: `npm run test -- docxEditorController 2>&1 | tail -20`
Expected: PASS. Then full gate: `npm run type-check 2>&1 | tail -3 && npm run lint 2>&1 | tail -3`.

- [ ] **Step 6: Commit**

```bash
git add src/docx/docxEditorController.ts locales/en.json locales/fr.json locales/ar.json tests/docx/docxEditorController.test.ts
git commit -m "feat: Export PDF button in the DOCX editor (#1d)"
```

---

### Task 5: Real-Chrome end-to-end guard

**Files:**
- Create: `tests/browser/docx-to-pdf.browser.test.ts`

**Interfaces:**
- Consumes: `docModelToPdfBytes` (Task 2); pdf.js for text extraction.

- [ ] **Step 1: Write the browser test**

```ts
// tests/browser/docx-to-pdf.browser.test.ts
import { describe, it, expect } from 'vitest';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorkerShimUrl from '../../src/utils/pdf-worker-shim?worker&url';
import { docModelToPdfBytes } from '../../src/docx/docxToPdf';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerShimUrl as string;

async function textOf(bytes: Uint8Array): Promise<string> {
  const doc = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
  try {
    let out = '';
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const c = await page.getTextContent();
      out += (c.items as Array<{ str?: string }>).map(it => it.str ?? '').join(' ');
    }
    return out;
  } finally {
    await doc.loadingTask?.destroy?.();
  }
}

describe('docModelToPdfBytes (real Chrome, #1d)', () => {
  it('renders run text in reading order, selectable via pdf.js', async () => {
    const { bytes } = await docModelToPdfBytes({
      paragraphs: [
        { runs: [{ text: 'Alpha ' }, { text: 'Bravo', bold: true }] },
        { runs: [{ text: 'Charlie Delta' }] },
      ],
    });
    const text = await textOf(bytes);
    expect(text).toContain('Alpha');
    expect(text).toContain('Bravo');
    expect(text).toContain('Charlie');
    expect(text.indexOf('Alpha')).toBeLessThan(text.indexOf('Charlie'));
  });

  it('keeps accented French intact', async () => {
    const { bytes, hadUnsupportedChars } = await docModelToPdfBytes({
      paragraphs: [{ runs: [{ text: 'éàçùê — déjà vu' }] }],
    });
    expect(hadUnsupportedChars).toBe(false);
    expect(await textOf(bytes)).toContain('déjà');
  });
});
```

- [ ] **Step 2: Run the browser test**

Run: `npm run test:browser -- docx-to-pdf 2>&1 | tail -20`
Expected: PASS (2 tests). (Uses system Chrome via Playwright.)

- [ ] **Step 3: Commit**

```bash
git add tests/browser/docx-to-pdf.browser.test.ts
git commit -m "test: real-Chrome DOCX→PDF text-extraction guard (#1d)"
```

---

### Task 6: Docs, memory, full-suite verification

**Files:**
- Modify: `CLAUDE.md` (the "DOCX read+edit (#1, Track B)" gotcha bullet — add the #1d export)
- Modify: `docs/plans/docx-to-pdf.plan.md` (mark Formal Plan done / link the plan)
- Memory: update `project_docx_editor_and_trueedit_backlog.md`

- [ ] **Step 1: Update CLAUDE.md**

Append to the Track B bullet that `#1d` is DONE: `src/docx/docxToPdf.ts` pure renderer
(Helvetica StandardFonts, run-level word-wrap, pagination, per-run bold/italic), `getModel()`
on the handle, the "Export PDF" button (`docModelToPdfBytes` dynamically imported), WinAnsi
sanitize-to-`?` + warn toast. Ceiling: tables/images/styles/colors/font-faces/headers/lists/
alignment NOT rendered (not in the editable model); non-WinAnsi scripts → `?` (font-embedding
is the future path); Approach B (docx-preview raster) is the future high-fidelity option.

- [ ] **Step 2: Full chained verification (== CI)**

Run:
```bash
npm run type-check 2>&1 | tail -3
npm run lint 2>&1 | tail -3
npm run test 2>&1 | grep -E "Test Files|Tests "
npm run test:browser -- docx 2>&1 | grep -E "Test Files|Tests "
```
Expected: type-check exit 0; lint 0 errors/0 warnings; jsdom all pass (+2 xfail); browser docx tests pass.

- [ ] **Step 3: Update the memory file**

Edit `~/.claude/projects/-stack-projects-prsnl-pdfturbo/memory/project_docx_editor_and_trueedit_backlog.md`:
mark `#1d` DONE with the commit SHAs; note the renderer module + ceiling; set NEXT = Phase 2 editing.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md docs/plans/docx-to-pdf.plan.md
git commit -m "docs: record DOCX→PDF (#1d) done + ceilings"
```

---

## Self-Review

- **Spec coverage:** sanitizer (T1) ✓; renderer/layout/pagination/fonts/WinAnsi flag (T2) ✓;
  `getModel()` (T3) ✓; button + i18n + dynamic import + toasts (T4) ✓; browser e2e (T5) ✓;
  docs/ceilings/verify (T6) ✓. All spec sections mapped.
- **Placeholder scan:** none — every code step has full code.
- **Type consistency:** `docModelToPdfBytes(model, opts?) → { bytes, hadUnsupportedChars }`
  used identically in T2/T4/T5; `getModel(): DocModel` defined T3, consumed T4; `sanitizeWinAnsi`
  signature stable T1→T2. `DocxToPdfResult`/`DocxToPdfOptions` names consistent.
- **Resolved during planning:** the `notify` seam was confirmed `'info'|'error'` (controller
  line 25; `main.ts:106`); T4 now widens it to `'warn'` with the exact diff + the `main.ts`
  lambda update. `app.reportError.warn` exists.
