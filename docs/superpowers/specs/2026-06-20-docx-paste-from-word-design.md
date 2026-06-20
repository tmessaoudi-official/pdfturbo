# Paste-from-Word — Design (Slice C, feature 1)

**Date:** 2026-06-20
**Surface:** DOCX rich-text editor (Track B, ProseMirror) — `src/docx/*`
**Status:** Approved — ready for implementation plan

## Goal

When a user pastes content copied from Microsoft Word (or Google Docs, or any
rich web source) into the DOCX editor, preserve all formatting the editor
already models — **bold, italic, underline, headings (H1–H6), bullet & numbered
lists, font family, font size, hyperlinks** — while silently discarding Word's
notorious clipboard cruft (`mso-*` styles, `<o:p>`, conditional comments, empty
`MsoNormal` paragraphs). Unsupported structures degrade gracefully without
crashing or losing the text.

## Why this is needed

The editor's `EditorView` (`docxProseMirror.ts:201`) uses ProseMirror's **default**
clipboard pipeline — no `transformPastedHTML`/`handlePaste`. Word's clipboard HTML
is extremely dirty: it carries conditional comments, `<o:p>` tags, `mso-*` inline
style declarations, `class="MsoNormal"` empties, and full font-fallback lists like
`"Calibri",sans-serif`. Pasted raw, these leak garbage marks (e.g. a `fontFamily`
mark holding an mso token), spurious empty paragraphs, and inconsistent structure.
The standard fix is a pre-parse HTML sanitizer.

## Approach (chosen: A)

A **pure** `cleanWordHtml(html: string): string` sanitizer runs as the
EditorView's `transformPastedHTML` hook. After cleaning, ProseMirror's default
DOMParser parses the HTML through the schema's **existing** `parseDOM` rules — no
new schema marks or nodes are added. A separate plain-text paste path handles
Ctrl+Shift+V.

Rejected alternatives:
- **B — custom ProseMirror `clipboardParser`/ParseRule set:** MSO-style ignores and
  empty-paragraph removal are awkward as parse rules and the cleaner can't be
  unit-tested without a full editor. More complex, less testable.
- **C — Word-clipboard → docModel directly:** reinvents ProseMirror's clipboard
  pipeline. Overkill / YAGNI.

## Components

### `src/docx/wordPaste.ts` (NEW — pure)

`cleanWordHtml(html: string): string`

Uses the platform `DOMParser` (available in jsdom and the browser) to parse the
incoming HTML fragment, then mutates the DOM tree and re-serialises. Cleaning steps:

1. **Conditional comments** — handled on the RAW string before parsing, because Word
   uses two forms: *downlevel-hidden* `<!--[if …]> … <![endif]-->` (a real HTML
   comment — kept as a Comment node by `DOMParser`, harmless but stripped for
   cleanliness) and *downlevel-revealed* `<![if !supportLists]> … <![endif]>` (NOT a
   valid comment — its inner content, e.g. a list bullet, is live and must be
   *unwrapped*, not dropped). The function regex-removes the `<![if…]>`/`<![endif]>`
   delimiters (keeping inner content) and removes the fully-commented `<!--[if…]…-->`
   blocks, then parses.
2. **Office namespace / metadata elements** — remove `<o:p>`, `<xml>`, `<style>`,
   `<meta>`, `<link>`, `<title>`, and any element in the `o:`/`v:`/`w:`/`m:`
   namespaces (tag name contains `:`), unwrapping their text children where the
   element carried visible content (e.g. `<o:p>` → its text).
3. **`mso-*` style declarations** — for every element with a `style` attribute,
   drop declarations whose property starts with `mso-`; keep the rest
   (`font-family`, `font-size`, `font-weight`, `font-style`, `text-decoration`).
   Remove the `style` attribute entirely if nothing survives.
4. **MSO classes & noise attributes** — remove `class`, `lang`, `align` when
   `class` matches `/^Mso/`; strip `class` attributes wholesale (they carry no
   formatting the schema reads).
5. **Empty paragraphs** — remove `<p>`/`<div>` whose textContent is empty or only
   `&nbsp;`/whitespace (Word emits many `MsoNormal` spacers). Keep at least the
   document's structural integrity (never produce zero nodes from non-empty input).
6. **Normalise** — collapse `&nbsp;` to spaces in text runs; leave `<b>/<i>/<u>/<a>/
   <h1-6>/<ul>/<ol>/<li>/<p>/<span style>` intact for ProseMirror.

The function is total: any input returns a string; malformed HTML returns a
best-effort cleaned fragment (never throws).

**Image handling:** an `<img>` is kept only if its `src` is `http:`, `https:`, or
`data:`; `file://`, VML `<v:shape>`, and `src`-less images are removed (Word's
local-path images never resolve in-browser). NOTE: the basic schema's `image` node
is inline; pasted images that survive cleaning parse as inline images. This is a
*bonus* of the existing schema, not a paste-specific feature.

### `src/docx/docxProseMirror.ts` (MODIFY ~line 201)

Add two `EditorView` props:

- `transformPastedHTML(html, view) { return cleanWordHtml(html); }` — runs before
  ProseMirror parses pasted HTML.
- `handlePaste(view, event)` — when the paste carries the plain-text intent
  (Ctrl+Shift+V), insert `event.clipboardData.getData('text/plain')` as plain
  paragraphs and return `true` to bypass the HTML path; otherwise return `false`
  to let the normal (cleaned) HTML path run.

  Plain-text detection: ProseMirror does not expose the Shift modifier on the
  `paste` event directly. Implementation: register a `keydown` capture on the
  editor DOM (in `mountDocxEditor`) that sets a one-shot `plainPasteArmed` flag
  when `Ctrl/Cmd+Shift+V` is seen; `handlePaste` reads and clears it. If the flag
  is set, do the plain-text insertion. This keeps the logic inside the editor
  module and testable.

## Data flow

```
Ctrl+V:           browser paste → dirty Word HTML
                  → transformPastedHTML(cleanWordHtml)
                  → ProseMirror default DOMParser (schema parseDOM)
                  → doc nodes: b/i/u/fontFamily/fontSize/heading/list/link
                  → unsupported (color/table/image-without-usable-src) dropped

Ctrl+Shift+V:     keydown sets plainPasteArmed
                  → handlePaste reads flag → inserts text/plain as paragraphs
                  → returns true (HTML path skipped)
```

## Degradation (explicit)

| Pasted structure | v1 behaviour |
|---|---|
| Tables | ProseMirror default: grid dropped, cell text survives as paragraphs. Real editable tables come in Slice C feature #3. |
| Text/highlight colour | Dropped (no schema mark). |
| Images | Kept iff `src` is `http(s):`/`data:`; else dropped. |
| Strikethrough | Dropped (no schema mark — could be a future mark). |
| Nested list depth | Preserved as far as `prosemirror-schema-list` allows. |

## Error handling

- `cleanWordHtml` never throws; malformed input → best-effort cleaned fragment.
- `handlePaste` returns `false` on any unexpected state so the default path always
  has a chance to run (fail-open to formatted paste, never a dead paste).

## Feature flag

None new. Paste behaviour lives inside the editor, already gated by
`VITE_FEATURE_DOCX_EDIT` (#28 seam). When the flag is off the editor never mounts,
so the paste hooks never wire.

## Testing

- `tests/docx/wordPaste.test.ts` (jsdom): real Word-clipboard HTML fixtures →
  assert `mso-*`/`<o:p>`/conditional-comments/empty-MsoNormal stripped, and that
  `<b>/<i>/<u>`, `font-family`, `font-size`, `<h1-3>`, `<ul>/<ol>/<li>`, `<a href>`
  survive. Edge cases: empty input, plain-text-only input, malformed HTML (no
  throw), `file://` image removed / `data:` image kept.
- `tests/browser/docx-paste.browser.test.ts` (real Chrome): mount the editor,
  dispatch a synthetic `paste` `ClipboardEvent` carrying Word HTML, assert the
  resulting doc has the expected marks/nodes; then `save()` → reopen → assert the
  formatting round-trips through OPC. A second case arms the plain-text flag and
  asserts formatting is dropped.

## Out of scope (v1)

- Editable tables on paste (feature #3).
- Colour / highlight / strikethrough marks.
- Pasting images from the local filesystem (`file://`).
- Paste of non-HTML rich formats (RTF).
