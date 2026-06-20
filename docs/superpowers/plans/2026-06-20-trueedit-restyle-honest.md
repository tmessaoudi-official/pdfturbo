# True-PDF Restyle — Honest Font-Substitution Labeling — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a true-PDF text restyle can only be realized by substituting the embedded font with a base-14 standard font, tell the user with a toast — and lock the restyle commit branches with tests.

**Architecture:** `replaceTextAt` (`src/utils/contentStreamEditor.ts`) gains a richer return so the caller can tell "font kept" from "font substituted"; the inline-edit commit (`src/handlers/textEditHandler.ts`) fires a new toast only on substitution. No new module, no new dependency, no new feature flag.

**Tech Stack:** TypeScript, @cantoo/pdf-lib, vitest (jsdom + real-Chrome via Playwright), i18next.

## Global Constraints
- No new dependency; no new feature flag (rides existing `trueEdit`, #28 seam).
- `locales/{en,fr,ar}.json` MUST stay key-identical; AR value is `[Unverified]` (machine translation).
- Tests executed (jsdom + ≥1 real Chrome); commit per task; `git push` is MANUAL (never push).
- Lint is zero-warning (oxlint); no `!` non-null assertions, no `any`.
- The base-14 substitution ceiling is unchanged — this slice LABELS it, it does not remove it.
- **Return-contract refinement (vs spec):** `replaceTextAt` returns `Promise<false | true | 'substituted'>`
  (NOT the spec's `'inplace'|'substituted'`) — Path 1/2 keep returning `true` so the ~12 existing
  `expect(ok).toBe(true)` assertions stay green; only Path 3 returns `'substituted'`. Behaviour
  (toast only on substitution) is identical.

---

### Task 1: Engine — `replaceTextAt` reports font substitution (Path 3)

**Files:**
- Modify: `src/utils/contentStreamEditor.ts` (return type at line ~1684; the Path-3 terminal `return true` at line ~1836)
- Test: `tests/utils/contentStreamEditor.test.ts`

**Interfaces:**
- Produces: `replaceTextAt(...): Promise<false | true | 'substituted'>`. `false` = refused (caller → overlay). `true` = succeeded, original font kept (Path 1 literal byte-swap OR Path 2 subset glyph reuse). `'substituted'` = succeeded by Path-3 standard-font redraw (embedded font replaced by a base-14 substitute).

- [ ] **Step 1: Write the failing tests**

Add to `tests/utils/contentStreamEditor.test.ts`, inside the existing `describe('replaceTextAt', …)` block (reuse the existing `makeThreeStringPdf` standard-Helvetica fixture and `makeXObjectTextPdf`):

```ts
it('returns true (font kept) for an in-place literal edit (Path 1)', async () => {
  const doc = await PDFDocument.load(await makeThreeStringPdf());
  const result = await replaceTextAt(doc, 0, { x: 50, y: 300 }, 'Bonjour');
  expect(result).toBe(true);
});

it("returns 'substituted' when a restyle forces the standard-font redraw (Path 3)", async () => {
  const doc = await PDFDocument.load(await makeThreeStringPdf());
  // A style (bold) skips Path 1/2 (wantsRestyle) → forces Path 3 on this WinAnsi text.
  const result = await replaceTextAt(doc, 0, { x: 50, y: 300 }, 'Bonjour', 3, { bold: true });
  expect(result).toBe('substituted');
});

it('returns false (refused) for a Form-XObject target — no substitution claim', async () => {
  const doc = await PDFDocument.load(await makeXObjectTextPdf());
  const result = await replaceTextAt(doc, 0, { x: 50, y: 300 }, 'Changed', 3, { bold: true });
  expect(result).toBe(false);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/utils/contentStreamEditor.test.ts -t "Path 1|Path 3|XObject target — no substitution"`
Expected: the Path-3 test FAILS (`expected true to be 'substituted'`); the other two may already pass (true / false).

- [ ] **Step 3: Implement the minimal change**

In `src/utils/contentStreamEditor.ts`, change the signature return type:

```ts
): Promise<false | true | 'substituted'> {
```

and the Path-3 terminal return (currently `return true;` immediately after `setPageContent(doc, pageIndex, serializeOps(ops) + redraw);`) to:

```ts
  setPageContent(doc, pageIndex, serializeOps(ops) + redraw);

  return 'substituted';
}
```

Leave Path 1 (`return true;` after `writeBack` in the byte-swap branch) and Path 2 (`return true;` after the hex branch) unchanged, and every refuse `return false;` unchanged.

- [ ] **Step 4: Run the new tests + the whole engine suite**

Run: `npx vitest run tests/utils/contentStreamEditor.test.ts`
Expected: the 3 new tests PASS. If any pre-existing `expect(ok).toBe(true)` now fails, it is a Path-3 case (subset-no-ToUnicode redraw or an already-restyle test) — change that single assertion to `expect(ok).toBe('substituted')`. Re-run until green. Do NOT touch `deleteTextAt`/`changeSizeAt` assertions (those still return boolean).

- [ ] **Step 5: Lint + commit**

```bash
npm run lint
git add src/utils/contentStreamEditor.ts tests/utils/contentStreamEditor.test.ts
git commit -m "feat(trueedit): replaceTextAt reports font substitution (Path 3)"
```

---

### Task 2: i18n — `toast.trueEditFontSubstituted`

**Files:**
- Modify: `locales/en.json`, `locales/fr.json`, `locales/ar.json` (the `toast` object, right after `trueTextDeleted`)

**Interfaces:**
- Produces: i18n key `toast.trueEditFontSubstituted`.

- [ ] **Step 1: Add the key to all three locales**

In `locales/en.json`, after the `"trueTextDeleted": …` line inside `toast`:

```json
    "trueEditFontSubstituted": "Font substituted — the original font couldn't be kept in place; the text was redrawn in a standard font. Ctrl+Z to undo.",
```

In `locales/fr.json`, same position:

```json
    "trueEditFontSubstituted": "Police remplacée — la police d'origine n'a pas pu être conservée ; le texte a été redessiné dans une police standard. Ctrl+Z pour annuler.",
```

In `locales/ar.json`, same position (machine translation, `[Unverified]` — flag for native review):

```json
    "trueEditFontSubstituted": "تم استبدال الخط — تعذّر الإبقاء على الخط الأصلي في مكانه؛ أُعيد رسم النص بخط قياسي. اضغط Ctrl+Z للتراجع.",
```

- [ ] **Step 2: Verify locale parity + suite**

Run: `npm run test`
Expected: green (the locale-sync hook is satisfied because all three files carry the key; any locale-parity test passes).

- [ ] **Step 3: Commit**

```bash
git add locales/en.json locales/fr.json locales/ar.json
git commit -m "feat(i18n): add toast.trueEditFontSubstituted (en/fr/ar; ar unverified)"
```

---

### Task 3: Handler — fire the substitution toast on commit

**Files:**
- Modify: `src/handlers/textEditHandler.ts` (the full-replacement branch in `commit()`, line ~648–663)
- Test: `tests/handlers/textEditHandler.test.ts`

**Interfaces:**
- Consumes: `replaceTextAt(...): Promise<false | true | 'substituted'>` (Task 1).

- [ ] **Step 1: Write the failing tests**

Add to `tests/handlers/textEditHandler.test.ts`, inside the first `describe('TextEditHandler — multi-candidate true-edit fallback', …)` block. These drive the inline editor open → text edit → Enter commit, with a `libDoc` that can `save()` and an `_applySourcePdfEdit` that resolves truthy so the success toast branch runs:

```ts
it('fires the font-substituted toast when replaceTextAt substitutes the font (Path 3)', async () => {
  const { PDFDocument } = await import('@cantoo/pdf-lib');
  (PDFDocument.load as ReturnType<typeof vi.fn>).mockResolvedValue({
    save: vi.fn().mockResolvedValue(new Uint8Array([1])),
  });
  const item = makeItem('Heading', 100, 600);
  mockFindTextOpAt.mockImplementation((_d: unknown, _i: unknown, o: { x: number; y: number }) =>
    Math.abs(o.x - 100) < 1 && Math.abs(o.y - 600) < 1 ? { fontKey: 'F1', fontSize: 12, fillColor: undefined } : null);
  mockReplaceTextAt.mockResolvedValue('substituted');

  const canvas = makeCanvas();
  const app = makeApp(canvas, makeFakePage([item], 841));
  (app._applySourcePdfEdit as ReturnType<typeof vi.fn>).mockResolvedValue(true);
  await handler.handleCanvasClick(click(115, 241), app as unknown as Parameters<typeof handler.handleCanvasClick>[1]);

  const input = document.body.querySelector('.true-edit-input') as HTMLInputElement;
  input.value = 'Changed';
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await new Promise<void>(r => { setTimeout(r, 0); });

  const infos = (app.reportError.info as ReturnType<typeof vi.fn>).mock.calls.flat();
  expect(infos).toContain('toast.trueEditFontSubstituted');
  expect(infos).not.toContain('toast.trueTextEdited');
});

it('fires the plain edited toast (not substituted) when the font is kept', async () => {
  const { PDFDocument } = await import('@cantoo/pdf-lib');
  (PDFDocument.load as ReturnType<typeof vi.fn>).mockResolvedValue({
    save: vi.fn().mockResolvedValue(new Uint8Array([1])),
  });
  const item = makeItem('Heading', 100, 600);
  mockFindTextOpAt.mockImplementation((_d: unknown, _i: unknown, o: { x: number; y: number }) =>
    Math.abs(o.x - 100) < 1 && Math.abs(o.y - 600) < 1 ? { fontKey: 'F1', fontSize: 12, fillColor: undefined } : null);
  mockReplaceTextAt.mockResolvedValue(true);

  const canvas = makeCanvas();
  const app = makeApp(canvas, makeFakePage([item], 841));
  (app._applySourcePdfEdit as ReturnType<typeof vi.fn>).mockResolvedValue(true);
  await handler.handleCanvasClick(click(115, 241), app as unknown as Parameters<typeof handler.handleCanvasClick>[1]);

  const input = document.body.querySelector('.true-edit-input') as HTMLInputElement;
  input.value = 'Changed';
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await new Promise<void>(r => { setTimeout(r, 0); });

  const infos = (app.reportError.info as ReturnType<typeof vi.fn>).mock.calls.flat();
  expect(infos).toContain('toast.trueTextEdited');
  expect(infos).not.toContain('toast.trueEditFontSubstituted');
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/handlers/textEditHandler.test.ts -t "font-substituted toast|plain edited toast"`
Expected: the first test FAILS (handler currently always emits `toast.trueTextEdited`); the second may pass.

- [ ] **Step 3: Implement the wiring**

In `src/handlers/textEditHandler.ts`, the full-replacement branch currently reads:

```ts
      const ok = await replaceTextAt(opts.libDoc, opts.pageIndex, opts.origin, newText, TRUE_EDIT_TOLERANCE, style, sampledFallback, {
        adjustDecorations: isEnabled('textDecor'),
      });
      if (!ok) {
        this._emitOverlay(app, { ...overlayContext, text: newText });
        return;
      }

      const newBytes = await opts.libDoc.save();
      if (await app._applySourcePdfEdit(opts.src, newBytes, opts.pageId)) {
        app.reportError.info('toast.trueTextEdited');
      }
```

Change `ok` → `result` and select the toast by the return value:

```ts
      const result = await replaceTextAt(opts.libDoc, opts.pageIndex, opts.origin, newText, TRUE_EDIT_TOLERANCE, style, sampledFallback, {
        adjustDecorations: isEnabled('textDecor'),
      });
      if (!result) {
        this._emitOverlay(app, { ...overlayContext, text: newText });
        return;
      }

      const newBytes = await opts.libDoc.save();
      if (await app._applySourcePdfEdit(opts.src, newBytes, opts.pageId)) {
        app.reportError.info(result === 'substituted' ? 'toast.trueEditFontSubstituted' : 'toast.trueTextEdited');
      }
```

- [ ] **Step 4: Run the handler suite**

Run: `npx vitest run tests/handlers/textEditHandler.test.ts`
Expected: all tests PASS (the two new ones + every pre-existing one — `if (!result)` is truthy-equivalent to the old `if (!ok)`).

- [ ] **Step 5: Lint + commit**

```bash
npm run lint
git add src/handlers/textEditHandler.ts tests/handlers/textEditHandler.test.ts
git commit -m "feat(trueedit): warn on font substitution after an in-place restyle"
```

---

### Task 4: Real-Chrome guard — restyle a real embedded font

**Files:**
- Create: `tests/browser/trueedit-restyle.browser.test.ts`

**Interfaces:**
- Consumes: `replaceTextAt` (Task 1) against a real pdf-lib document + pdf.js verification.

- [ ] **Step 1: Write the browser test**

Mirror the existing `tests/browser/issue2-true-edit.browser.test.ts` harness (build a PDF with @cantoo/pdf-lib, edit via `replaceTextAt`, re-render with pdf.js). Assert the contract directly at the engine level (the handler's DOM wiring is covered in jsdom):

```ts
import { describe, it, expect } from 'vitest';
import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import { replaceTextAt } from '../../src/utils/contentStreamEditor';

async function makeTextPdf(text: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([300, 200]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText(text, { x: 50, y: 150, size: 18, font });
  return doc.save();
}

describe('true-edit restyle — real Chrome', () => {
  it("reports 'substituted' and keeps the text extractable when bold is applied", async () => {
    const doc = await PDFDocument.load(await makeTextPdf('Hello'));
    const result = await replaceTextAt(doc, 0, { x: 50, y: 150 }, 'Hello', 3, { bold: true });
    expect(result).toBe('substituted');

    // The redrawn text is still real, extractable PDF text.
    const bytes = await doc.save();
    const pdfjs = await import('pdfjs-dist');
    const task = pdfjs.getDocument({ data: bytes.slice(0) });
    const pdf = await task.promise;
    const content = await (await pdf.getPage(1)).getTextContent();
    const joined = (content.items as { str: string }[]).map(i => i.str).join('');
    expect(joined).toContain('Hello');
    await task.destroy();
  });

  it('returns true (no substitution) for a plain text edit that keeps the font', async () => {
    const doc = await PDFDocument.load(await makeTextPdf('Hello'));
    const result = await replaceTextAt(doc, 0, { x: 50, y: 150 }, 'World');
    expect(result).toBe(true);
  });
});
```

- [ ] **Step 2: Run it in real Chrome**

Run: `npx vitest run --config vitest.browser.config.ts tests/browser/trueedit-restyle.browser.test.ts`
Expected: 2 PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/browser/trueedit-restyle.browser.test.ts
git commit -m "test(trueedit): real-Chrome guard for restyle font substitution"
```

---

### Task 5: Audit pass + docs + full gate

**Files:**
- Modify: `CLAUDE.md` (true-edit restyle note), `docs/plans/trueedit-restyle-honest.plan.md` (mark done)

- [ ] **Step 1: Audit the `commit()` restyle branches**

Re-read `_openTrueEditInput.commit()` in `src/handlers/textEditHandler.ts` and enumerate the branches:
(1) delete (cleared text) → `deleteTextAt` → `trueTextDeleted`;
(2) size/color-only, font kept → `changeSizeAt`/`changeColorAt` → `trueTextEdited`;
(3) full replacement → `replaceTextAt` → `trueTextEdited` | `trueEditFontSubstituted` | overlay.
Confirm no branch fires the substitution toast when the font is kept, and the delete/size/color paths are untouched. If a defect is found, write a failing test for it and fix it (its own commit) before continuing — otherwise note "audit clean, no defect" in the commit body.

- [ ] **Step 2: Update CLAUDE.md**

Add to the true-edit engine bullet (near the `TextStyle`/Path-3 description) a sentence:

> **Honest restyle (Slice B):** `replaceTextAt` returns `false | true | 'substituted'` — `'substituted'` means a restyle forced the Path-3 base-14 redraw (embedded font replaced). `textEditHandler.commit()` surfaces `toast.trueEditFontSubstituted` only on that result; Path 1/2 (`true`, font kept) and the size/color-only in-stream path keep `toast.trueTextEdited`. The substitution ceiling is unchanged — this labels it. Guards: `tests/browser/trueedit-restyle.browser.test.ts` + the engine/handler jsdom tests.

- [ ] **Step 3: Full gate**

Run: `npm run type-check && npm run lint && npm run test && npm run test:browser`
Expected: type-check 0, lint 0, jsdom green (the two pre-existing `it.fails` blocker tests remain the only expected failures), browser green.

- [ ] **Step 4: Mark the plan done + commit docs**

Append a "Status — DONE" line to `docs/plans/trueedit-restyle-honest.plan.md`, then:

```bash
git add CLAUDE.md docs/plans/trueedit-restyle-honest.plan.md
git commit -m "docs: document honest true-PDF restyle font-substitution (Slice B)"
```

---

## Notes for the implementer
- Do NOT run `git push` — the user pushes manually.
- The SDKMAN shell banner floods Bash stdout; redirect test output to a file and grep (`… > /tmp/x.log 2>&1; grep -E "Test Files|Tests " /tmp/x.log`).
- `replaceTextAt`'s 6th arg is `style?: TextStyle`; the call in the tests uses `tolerance=3` as the 5th arg.
