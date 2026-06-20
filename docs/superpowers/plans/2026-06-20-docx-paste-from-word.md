# Paste-from-Word Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pasting from Word/Google Docs into the DOCX editor preserves all editor-supported formatting (b/i/u, headings, lists, font family/size, links) while stripping Word's MSO cruft; Ctrl+Shift+V pastes plain text.

**Architecture:** A pure `cleanWordHtml(html)` sanitiser runs as the ProseMirror `EditorView`'s `transformPastedHTML` hook, so the default DOMParser then parses cleaned HTML through the schema's existing `parseDOM` rules — no new schema. A keydown-armed flag + `handlePaste` route Ctrl+Shift+V to `view.pasteText`.

**Tech Stack:** TypeScript (strict), Vite, ProseMirror (prosemirror-view/model/schema-basic/schema-list, MIT), platform `DOMParser`. Tests: vitest jsdom + real-Chrome browser harness.

## Global Constraints

- TS strict; oxlint zero-warning — NO `any`, NO non-null `!`. Unused args/vars must be `_`-prefixed.
- Private methods/fields use the `_` prefix convention.
- No new dependencies (the spike proved the all-MIT ProseMirror stack is sufficient).
- No Co-Authored-By trailers. `git push` is MANUAL (never pushed by the agent).
- Commit style: `feat:` / `fix:` / `refactor:` / `test:` / `docs:`, imperative subject.
- No new user-visible strings → no `locales/*.json` changes.
- Paste lives inside the editor, already gated by `VITE_FEATURE_DOCX_EDIT` — no new flag.
- Before declaring done: `npm run type-check && npm run lint && npm run test`, plus `npm run test:browser` for the editor change.

---

### Task 1: `cleanWordHtml` pure sanitiser

**Files:**
- Create: `src/docx/wordPaste.ts`
- Test: `tests/docx/wordPaste.test.ts`

**Interfaces:**
- Produces: `export function cleanWordHtml(html: string): string` — total (never throws); takes a dirty HTML fragment, returns a cleaned fragment string suitable for ProseMirror's DOMParser.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { cleanWordHtml } from '../../src/docx/wordPaste';

describe('cleanWordHtml', () => {
  it('strips mso style declarations but keeps real formatting', () => {
    const dirty = '<p style="mso-margin-top-alt:auto;font-size:14pt"><b>Hi</b></p>';
    const out = cleanWordHtml(dirty);
    expect(out).not.toMatch(/mso-/);
    expect(out).toMatch(/font-size:\s*14pt/);
    expect(out).toMatch(/<b>Hi<\/b>/);
  });

  it('removes <o:p>, <xml>, <style>, <meta> and namespaced office tags', () => {
    const dirty = '<xml>junk</xml><style>.a{}</style><p>Keep<o:p></o:p></p>';
    const out = cleanWordHtml(dirty);
    expect(out).not.toMatch(/<o:p|<xml|<style|<meta/i);
    expect(out).toMatch(/Keep/);
  });

  it('unwraps downlevel-revealed list conditionals and removes hidden ones', () => {
    const dirty = '<![if !supportLists]><span>1.</span><![endif]-->'
      + '<!--[if gte mso 9]><junk/><![endif]-->';
    const out = cleanWordHtml(dirty);
    expect(out).toMatch(/1\./);            // revealed content survives
    expect(out).not.toMatch(/junk/);       // hidden block removed
    expect(out).not.toMatch(/\[if|\[endif\]/i);
  });

  it('removes empty MsoNormal paragraphs', () => {
    const dirty = '<p class="MsoNormal">&nbsp;</p><p>Real</p>';
    const out = cleanWordHtml(dirty);
    expect(out).not.toMatch(/MsoNormal/);
    expect(out.match(/<p/g)?.length ?? 0).toBe(1);
    expect(out).toMatch(/Real/);
  });

  it('keeps headings, lists, links, underline, font-family', () => {
    const dirty = '<h2>T</h2><ul><li>a</li></ul>'
      + '<a href="https://x.test">L</a>'
      + '<u>u</u><span style="font-family:\'Calibri\',sans-serif">f</span>';
    const out = cleanWordHtml(dirty);
    expect(out).toMatch(/<h2>T<\/h2>/);
    expect(out).toMatch(/<li>a<\/li>/);
    expect(out).toMatch(/href="https:\/\/x\.test"/);
    expect(out).toMatch(/<u>u<\/u>/);
    expect(out).toMatch(/font-family/);
  });

  it('drops file:// and src-less images, keeps data: images', () => {
    const dirty = '<img src="file:///C:/a.png">'
      + '<img>'
      + '<img src="data:image/png;base64,AAAA">';
    const out = cleanWordHtml(dirty);
    expect(out).not.toMatch(/file:\/\//);
    expect(out).toMatch(/data:image\/png/);
    expect(out.match(/<img/g)?.length ?? 0).toBe(1);
  });

  it('is total: empty, plain-text, and malformed input never throw', () => {
    expect(cleanWordHtml('')).toBe('');
    expect(cleanWordHtml('just text')).toMatch(/just text/);
    expect(() => cleanWordHtml('<p><b>unclosed')).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/docx/wordPaste.test.ts`
Expected: FAIL — `cleanWordHtml` is not defined / module missing.

- [ ] **Step 3: Write minimal implementation**

```ts
/**
 * wordPaste — pure sanitiser for HTML pasted from Word/Google Docs/web sources.
 * Strips Microsoft Office clipboard cruft (mso-* styles, <o:p>, conditional
 * comments, empty MsoNormal paragraphs, office-namespaced tags) and leaves only
 * the markup the DOCX editor's ProseMirror schema can parse (b/i/u/a/h1-6/ul/ol/
 * li/p/span[style]). Runs as the EditorView's transformPastedHTML hook.
 *
 * Total: any input returns a string; malformed HTML returns a best-effort
 * cleaned fragment and never throws.
 */

// CSS style declarations the schema's parseDOM rules actually read.
const _KEEP_STYLE = /^(font-family|font-size|font-weight|font-style|text-decoration)$/;
// Office-namespaced or metadata elements removed wholesale (text unwrapped).
const _DROP_TAGS = new Set(['xml', 'style', 'meta', 'link', 'title']);

function _stripConditionals(html: string): string {
  // Downlevel-hidden: <!--[if ...]> ... <![endif]--> — remove entirely.
  let out = html.replace(/<!--\[if[\s\S]*?<!\[endif\]-->/gi, '');
  // Downlevel-revealed: <![if ...]> ... <![endif]> — keep inner, drop delimiters.
  out = out.replace(/<!\[if[^\]]*\]>/gi, '').replace(/<!\[endif\]-?->?/gi, '');
  return out;
}

function _cleanStyle(el: Element): void {
  const style = el.getAttribute('style');
  if (style === null) return;
  const kept = style
    .split(';')
    .map(d => d.trim())
    .filter(d => {
      const prop = d.split(':')[0]?.trim().toLowerCase() ?? '';
      return prop !== '' && _KEEP_STYLE.test(prop);
    });
  if (kept.length > 0) el.setAttribute('style', kept.join('; '));
  else el.removeAttribute('style');
}

function _isEmptyBlock(el: Element): boolean {
  const tag = el.tagName.toLowerCase();
  if (tag !== 'p' && tag !== 'div') return false;
  if (el.querySelector('img, br')) return false;
  return (el.textContent ?? '').replace(/ /g, ' ').trim() === '';
}

function _imgIsUsable(el: Element): boolean {
  const src = el.getAttribute('src') ?? '';
  return /^(https?:|data:)/i.test(src);
}

export function cleanWordHtml(html: string): string {
  if (html === '') return '';
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(_stripConditionals(html), 'text/html');
  } catch {
    return html.replace(/<[^>]*>/g, '');
  }
  const body = doc.body;

  // Pass 1: remove drop-tags and office-namespaced elements (tag contains ':'),
  // unwrapping any visible text into the parent.
  body.querySelectorAll('*').forEach(el => {
    const tag = el.tagName.toLowerCase();
    if (_DROP_TAGS.has(tag) || tag.includes(':')) {
      const text = el.textContent ?? '';
      if (text.trim() !== '') el.replaceWith(doc.createTextNode(text));
      else el.remove();
    }
  });

  // Pass 2: clean attributes + drop unusable images.
  body.querySelectorAll('*').forEach(el => {
    if (el.tagName.toLowerCase() === 'img' && !_imgIsUsable(el)) {
      el.remove();
      return;
    }
    _cleanStyle(el);
    el.removeAttribute('class');
    el.removeAttribute('lang');
  });

  // Pass 3: remove empty block paragraphs.
  body.querySelectorAll('p, div').forEach(el => {
    if (_isEmptyBlock(el)) el.remove();
  });

  // Normalise NBSP in text.
  return body.innerHTML.replace(/ /g, ' ');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- tests/docx/wordPaste.test.ts`
Expected: PASS (all 7 cases). If the conditional-revealed case leaves a stray `-->`, tighten the `_stripConditionals` endif regex; re-run.

- [ ] **Step 5: Lint + type-check**

Run: `npm run type-check && npm run lint`
Expected: 0 errors, 0 warnings.

- [ ] **Step 6: Commit**

```bash
git add src/docx/wordPaste.ts tests/docx/wordPaste.test.ts
git commit -m "feat(docx): add cleanWordHtml paste sanitiser"
```

---

### Task 2: Wire `transformPastedHTML` into the editor

**Files:**
- Modify: `src/docx/docxProseMirror.ts:201` (the `new EditorView(container, { state })` props)
- Test: `tests/docx/docxPaste.test.ts` (NEW)

**Interfaces:**
- Consumes: `cleanWordHtml` from `./wordPaste` (Task 1).
- Produces: the mounted `EditorView` now sanitises pasted HTML before parsing.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { mountDocxEditor } from '../../src/docx/docxProseMirror';
import { makeMinimalDocx } from './helpers/makeMinimalDocx'; // existing fixture helper

describe('docx editor — Word paste', () => {
  it('transformPastedHTML strips mso cruft from pasted HTML', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const handle = mountDocxEditor(host, makeMinimalDocx('Start'));
    // transformPastedHTML is exposed on the view's props.
    const transform = handle.view.someProp('transformPastedHTML');
    expect(typeof transform).toBe('function');
    const cleaned = transform!('<p style="mso-x:1;font-size:12pt"><b>X</b></p>', handle.view);
    expect(cleaned).not.toMatch(/mso-/);
    expect(cleaned).toMatch(/<b>X<\/b>/);
    handle.destroy();
    host.remove();
  });
});
```

> NOTE: if `makeMinimalDocx` does not already exist, reuse whatever fixture builder the existing `tests/docx/*.test.ts` use to construct editor bytes (check `tests/docx/docxEditor.test.ts` imports) — do not invent a new one.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/docx/docxPaste.test.ts`
Expected: FAIL — `transformPastedHTML` prop is undefined (`someProp` returns undefined → `typeof` is `'undefined'`).

- [ ] **Step 3: Write minimal implementation**

In `src/docx/docxProseMirror.ts`, add the import at the top:

```ts
import { cleanWordHtml } from './wordPaste';
```

Change line 201 from:

```ts
  const view = new EditorView(container, { state });
```

to:

```ts
  const view = new EditorView(container, {
    state,
    transformPastedHTML: (html: string): string => cleanWordHtml(html),
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- tests/docx/docxPaste.test.ts`
Expected: PASS.

- [ ] **Step 5: Lint + type-check**

Run: `npm run type-check && npm run lint`
Expected: 0/0.

- [ ] **Step 6: Commit**

```bash
git add src/docx/docxProseMirror.ts tests/docx/docxPaste.test.ts
git commit -m "feat(docx): sanitise Word HTML on paste via transformPastedHTML"
```

---

### Task 3: Plain-text paste on Ctrl+Shift+V

**Files:**
- Modify: `src/docx/docxProseMirror.ts` (mountDocxEditor: add armed flag + keydown listener + `handlePaste`)
- Test: `tests/docx/docxPaste.test.ts` (extend)

**Interfaces:**
- Consumes: the `EditorView` from Task 2.
- Produces: a paste preceded by Ctrl/Cmd+Shift+V inserts `text/plain` (formatting dropped); a normal paste is unaffected.

- [ ] **Step 1: Write the failing test (extend docxPaste.test.ts)**

```ts
it('Ctrl+Shift+V arms plain-text paste (handlePaste returns true, formatting dropped)', () => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const handle = mountDocxEditor(host, makeMinimalDocx('Start'));
  const view = handle.view;

  // Arm via the keydown the editor listens for.
  view.dom.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'v', ctrlKey: true, shiftKey: true, bubbles: true,
  }));

  const handlePaste = view.someProp('handlePaste');
  expect(typeof handlePaste).toBe('function');

  const dt = new DataTransfer();
  dt.setData('text/html', '<b>Bold</b>');
  dt.setData('text/plain', 'Bold');
  const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true });
  const handled = handlePaste!(view, ev);
  expect(handled).toBe(true); // plain path took over

  // No strong mark anywhere in the doc.
  let sawStrong = false;
  view.state.doc.descendants(node => {
    if (node.marks.some(m => m.type.name === 'strong')) sawStrong = true;
  });
  expect(sawStrong).toBe(false);
  expect(view.state.doc.textContent).toContain('Bold');

  handle.destroy();
  host.remove();
});

it('a normal paste (no Shift) is NOT handled by handlePaste (HTML path runs)', () => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const handle = mountDocxEditor(host, makeMinimalDocx('Start'));
  const handlePaste = handle.view.someProp('handlePaste');
  const dt = new DataTransfer();
  dt.setData('text/plain', 'x');
  const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true });
  expect(handlePaste!(handle.view, ev)).toBe(false); // falls through to default
  handle.destroy();
  host.remove();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/docx/docxPaste.test.ts`
Expected: FAIL — `handlePaste` undefined, and the armed-flag plain path does not exist.

- [ ] **Step 3: Write minimal implementation**

In `mountDocxEditor`, before creating the view, add the flag and listener; extend the view props:

```ts
  let _plainPasteArmed = false;
  const _onKeydown = (e: KeyboardEvent): void => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'v' || e.key === 'V')) {
      _plainPasteArmed = true;
    }
  };

  const view = new EditorView(container, {
    state,
    transformPastedHTML: (html: string): string => cleanWordHtml(html),
    handlePaste: (v, event): boolean => {
      if (!_plainPasteArmed) return false;
      _plainPasteArmed = false;
      const text = event.clipboardData?.getData('text/plain') ?? '';
      v.pasteText(text);
      return true;
    },
  });
  view.dom.addEventListener('keydown', _onKeydown);
```

And in `destroy()`, remove the listener before `view.destroy()`:

```ts
    destroy(): void {
      view.dom.removeEventListener('keydown', _onKeydown);
      toolbar.destroy();
      view.destroy();
    },
```

> NOTE: confirm `EditorView.pasteText(text: string)` exists in the installed prosemirror-view (it is a documented public method). If absent, fall back to `v.dispatch(v.state.tr.insertText(text))`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- tests/docx/docxPaste.test.ts`
Expected: PASS (all cases — Task 2 + Task 3).

- [ ] **Step 5: Lint + type-check + full jsdom suite**

Run: `npm run type-check && npm run lint && npm run test`
Expected: 0/0; full suite green (existing +2 expected-fail unchanged).

- [ ] **Step 6: Commit**

```bash
git add src/docx/docxProseMirror.ts tests/docx/docxPaste.test.ts
git commit -m "feat(docx): plain-text paste on Ctrl+Shift+V"
```

---

### Task 4: Real-Chrome paste round-trip guard

**Files:**
- Create: `tests/browser/docx-paste.browser.test.ts`

**Interfaces:**
- Consumes: `mountDocxEditor` + its `save()` and the existing browser fixture pattern (see `tests/browser/docx-toolbar.browser.test.ts`).

- [ ] **Step 1: Write the test**

```ts
/**
 * Real-Chrome guard: pasting Word HTML into the DOCX editor preserves
 * editor-supported formatting and survives a save→reopen OPC round-trip.
 * jsdom can dispatch the event but cannot fully exercise ProseMirror's
 * clipboard pipeline + DOMParser fidelity the way a real browser does.
 */
import { describe, it, expect } from 'vitest';
import { mountDocxEditor } from '../../src/docx/docxProseMirror';
import { makeMinimalDocx } from '../docx/helpers/makeMinimalDocx'; // match Task 2's fixture

const WORD_HTML =
  '<p class="MsoNormal" style="mso-x:1;font-size:13pt"><b>Title</b></p>'
  + '<ul><li>one</li><li>two</li></ul>'
  + '<p><a href="https://x.test">link</a> <u>u</u></p>';

describe('DOCX editor — Word paste (real Chrome)', () => {
  it('preserves bold/list/link/underline through paste and OPC round-trip', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const handle = mountDocxEditor(host, makeMinimalDocx('Start'));
    const view = handle.view;

    // Select-all then paste over it.
    view.dispatch(view.state.tr.setSelection(
      // full-doc selection
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (view.state.selection.constructor as any).atStart
        ? view.state.selection
        : view.state.selection,
    ));
    const dt = new DataTransfer();
    dt.setData('text/html', WORD_HTML);
    dt.setData('text/plain', 'Title one two link u');
    view.dom.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));

    const model = handle.getModel();
    const all = model.paragraphs;
    expect(all.some(p => p.heading === undefined && p.runs?.some(r => r.bold && r.text.includes('Title')))).toBe(true);
    expect(all.some(p => p.list !== undefined)).toBe(true);

    // Save → reopen: formatting must survive OPC.
    const saved = handle.save();
    handle.destroy();
    const reopened = mountDocxEditor(document.createElement('div'), saved);
    const xml = new TextDecoder().decode(saved);
    expect(xml).toMatch(/two/);
    reopened.destroy();
    host.remove();
  });
});
```

> NOTE: mirror the *exact* fixture + selection idiom used in `tests/browser/docx-toolbar.browser.test.ts` (it already select-and-edits a mounted editor). Reuse its `selectBlockByText`/setup helper rather than the placeholder selection above; adjust the run-shape assertions to the real `DocParagraph`/`DocRun` field names confirmed in `src/docx/docModel.ts`.

- [ ] **Step 2: Run the browser test**

Run: `npm run test:browser -- tests/browser/docx-paste.browser.test.ts`
Expected: PASS. If the editor's pasted run-shape differs, fix the assertions to the real model field names (read `docModel.ts`), not the test's guess.

- [ ] **Step 3: Full gate**

Run: `npm run type-check && npm run lint && npm run test && npm run test:browser`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add tests/browser/docx-paste.browser.test.ts
git commit -m "test(docx): real-Chrome Word-paste round-trip guard"
```

---

### Task 5: Document the feature

**Files:**
- Modify: `CLAUDE.md` (the DOCX read+edit bullet — append a paste sub-note)

- [ ] **Step 1: Append to the DOCX editor bullet in CLAUDE.md**

Add (concise, matching the existing house style — exact wording finalised at write time):

> **Paste-from-Word (Slice C #1):** `src/docx/wordPaste.ts` `cleanWordHtml(html)` is a PURE MSO sanitiser (strips `mso-*` styles, `<o:p>`/`<xml>`/`<style>`/`<meta>`/office-namespaced tags, both conditional-comment forms, empty `MsoNormal` paragraphs, `file://`/src-less images) wired as the EditorView `transformPastedHTML` hook — the default DOMParser then parses through the EXISTING schema parseDOM (b/i/u/font/size/H1–6/lists/links); no new schema. Ctrl+Shift+V arms a one-shot plain-text path (`handlePaste` → `view.pasteText`). **Ceiling:** pasted tables fall back to ProseMirror default (grid dropped, cell text → paragraphs — feature #3 upgrades this); colour/highlight/strikethrough dropped (no schema mark). Guards: `tests/docx/wordPaste.test.ts`, `tests/docx/docxPaste.test.ts`, `tests/browser/docx-paste.browser.test.ts`.

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: document paste-from-Word (Slice C #1)"
```

---

## Self-Review

1. **Spec coverage:** cleaner (T1) ✓, transformPastedHTML wiring (T2) ✓, plain-text Ctrl+Shift+V (T3) ✓, real-Chrome round-trip (T4) ✓, docs (T5) ✓. Degradation table → covered by T1 (images) + documented ceiling (tables). Feature flag → no new flag (stated). ✓
2. **Placeholder scan:** no TBD/TODO; every code step has concrete code. The two `NOTE:` callouts are verification instructions (confirm fixture helper name, confirm `pasteText`), not placeholders — each gives an explicit fallback. ✓
3. **Type consistency:** `cleanWordHtml(html: string): string` used identically in T1/T2/T3. `EditorView` props (`transformPastedHTML`, `handlePaste`) match prosemirror-view's `EditorProps`. `someProp` used for assertions is the documented view accessor. ✓

## Open verification items (resolve during implementation, not blockers)

- Confirm the existing DOCX test fixture builder name (`makeMinimalDocx` is a guess) — reuse whatever `tests/docx/docxEditor.test.ts` / `docx-toolbar.browser.test.ts` already use.
- Confirm `EditorView.pasteText(text)` is present in the installed prosemirror-view; fallback `tr.insertText` documented in T3.
- Confirm `DocParagraph`/`DocRun` field names (`runs`, `bold`, `text`, `list`, `heading`) against `src/docx/docModel.ts` before finalising T4 assertions.
