# PDFturbo — Features

A client-side PDF editor that runs **100% in the browser** — no backend, nothing uploaded.
TypeScript + Vite + PWA. Localised in English, French, and Arabic (with full RTL).

_Last updated: 2026-09-04 · Version 1.0.0_

---

## Viewing & navigation
- Open any PDF; render with pdf.js — via the OS file picker on Chromium, with a **Recent files**
  list in the File menu (the browser's own handle is remembered, never a filesystem path, and access
  is re-granted by you on the first open of a session); the ordinary file input elsewhere
- Page thumbnails strip: navigate, reorder (drag), rotate, duplicate, delete; per-page export
- Zoom in/out, fit-to-width (auto re-fit on resize), pinch-to-zoom (mobile), Ctrl+Wheel (desktop)
- Text search with highlighted matches (RTL/Arabic-aware), and "add highlight" on a match
- Session persistence (IndexedDB) with restore-or-start-fresh on reload
- Installable PWA; app shell works offline

## Annotation & markup
- **Text boxes** — font family/size, bold/italic, underline/strikethrough, colour, alignment,
  justify, line height, opacity, background, character spacing, horizontal scale, super/subscript,
  outline, bullet/numbered lists, hyperlinks, RTL direction control, and a format painter
- **Edit existing PDF text in place** — true content-stream editing (delete/replace/restyle a word),
  with an editable overlay fallback when in-place editing isn't possible
- **Shapes** — arrow, rectangle, ellipse, line, freehand draw.
  **A filled shape over text conceals nothing** — the covered text remains fully extractable, even though
  it looks identical to a redaction on screen. Use **Redaction** to remove content
- **Highlight** brush over existing text; **eraser** for ink strokes; **fill bucket** for ink regions
- **Image overlay** (PNG/JPEG/WebP); **comment / sticky notes**
- **Barcode / QR** generator (1D/2D, formats, error-correction, styling)
- Undo / redo — 50-command history (Ctrl+Z / Ctrl+Y)

## Documents & pages
- Merge (add pages from another PDF), delete, reorder, rotate pages
- Extract a page range (e.g. `1-3, 5, 8-10`) to a new PDF
- **Per-page crop** (show only a chosen region — drag it, adjust with the frame's 8 handles, or type
  per-edge margins; rotation-safe).
  **Crop HIDES rather than removes**: it sets the PDF CropBox, so in a normal export the cropped-away
  area remains in the file and can be restored by a recipient. It *is* destroyed by any export that
  rasterises the page (a redaction-bearing page, compress→flatten-to-images, export-page-as-image), so
  the grade depends on the export you choose — see
  [`SECURITY.md`](SECURITY.md#hiding-is-not-removing--which-tool-actually-deletes-content).
  Use **Redaction** to remove content permanently
- **Watermark** — tiled, configurable text/opacity/angle/density; renders live in the editor and on export
- **Bates / page numbering** — prefix + zero-padded counter or "N / total", six anchor positions

## Forms
- Auto-detect and fill AcroForm text fields (undoable)
- **Flatten forms** on export (bake field values into page content). Note this *exposes* the value rather
  than concealing it: it stops being an editable field and becomes selectable page text

## Redaction & privacy
- **True redaction** — permanent black-box burn. Removal is real on both page kinds, by two different
  means: a source-PDF page is rasterized (its text becomes unextractable), while a **blank** page has
  nothing to rasterize, so the covered annotations are omitted from the export instead. The bounds of
  each — notably that the blank-page omission is whole-element — are graded in `SECURITY.md`
- **Sanitize** — strip metadata (`/Info`, XMP on every object, private application data), document JavaScript
  (`/OpenAction`, `/AA` wherever it appears — including on a page-tree or field parent a reader inherits it from —
  scripts on annotations, form fields and bookmarks, including one chained behind a real link, and 3D artwork
  scripts), four kinds of non-JavaScript action (form submission, launch, open-another-document, import-data;
  ordinary hyperlinks and in-document media are kept), and embedded files — via the name tree, as paperclip
  annotations (on a page or hidden in a form field), and as associated files on any object. The file's bytes
  leave the copy even when something else still pointed at them.
  It does **not** alter page content
- **Lock PDF** — AES-256 password encryption on export
- Which tools actually *delete* content versus only hide it is graded surface-by-surface in
  [`SECURITY.md`](SECURITY.md#hiding-is-not-removing--which-tool-actually-deletes-content)

## OCR (scanned documents)
- Recognise text via tesseract.js — 8 languages (eng/fra/ara/deu/spa/ita/por/nld); assets self-hosted
- Output modes: invisible **searchable text layer**, editable text boxes, plain-text export, or DOCX

## Signing
- **Visible digital signature** — PKCS#12 / CMS (node-forge); upload a `.p12` or **generate a
  self-signed certificate in-browser**
- **Approval signatures** — drawn signature with caption ("read & approved"), guided multi-signer panel

## Conversion & export
- **PDF → DOCX / Markdown / TXT** — reconstructs a flow document (headings, lists, columns, tables,
  images, hyperlinks, underline/strike, RTL); uses the PDF's structure tags when present
- **DOCX editor** — open a `.docx`, edit text with a rich toolbar (bold/italic/underline, headings,
  fonts, colour, lists, **tables** incl. add/remove rows & columns and merge/split cells, **images**
  incl. insert/move/resize/cut-paste/drag, **hyperlinks**), find & replace, paste-from-Word cleanup;
  export back to `.docx` or to PDF
- **Table → CSV / Excel (.xlsx)** — extract a table from a page; ruled tables and, since EH-E,
  borderless ones inferred from column whitespace. The xlsx export writes numeric cells as real
  numbers rather than text
- **PDF compress** — lossless optimize, or flatten-to-images at a chosen DPI/quality
- **XFDF** import/export of annotations
- **Export targets** — full PDF, page range, single page, page as PNG/JPEG image; native OS "Save As"
  dialog on Chromium (File System Access API), anchor-download elsewhere
- **Export preview** — see annotation positions before downloading

## Internationalisation & accessibility
- Full EN / FR / AR localisation; Arabic RTL chrome mirroring and a shared char-level bidi engine
  (UAX#9) across overlay rendering, copy, search, and DOCX export
- Keyboard shortcuts for all major tools; ARIA roles/labels; skip-nav; focus management

---

For the honest structural limits of running entirely client-side, see
[`KNOWN_ISSUES.md`](KNOWN_ISSUES.md). For release history, see [`CHANGELOG.md`](CHANGELOG.md).
