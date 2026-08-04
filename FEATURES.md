# PDFturbo — Features

A client-side PDF editor that runs **100% in the browser** — no backend, nothing uploaded.
TypeScript + Vite + PWA. Localised in English, French, and Arabic (with full RTL).

_Last updated: 2026-06-26 · Version 1.0.0_

---

## Viewing & navigation
- Open any PDF; render with pdf.js
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
- **Shapes** — arrow, rectangle, ellipse, line, freehand draw
- **Highlight** brush over existing text; **eraser** for ink strokes; **fill bucket** for ink regions
- **Image overlay** (PNG/JPEG/WebP); **comment / sticky notes**
- **Barcode / QR** generator (1D/2D, formats, error-correction, styling)
- Undo / redo — 50-command history (Ctrl+Z / Ctrl+Y)

## Documents & pages
- Merge (add pages from another PDF), delete, reorder, rotate pages
- Extract a page range (e.g. `1-3, 5, 8-10`) to a new PDF
- **Per-page crop** (keep only a drawn region; rotation-safe)
- **Watermark** — tiled, configurable text/opacity/angle/density; renders live in the editor and on export
- **Bates / page numbering** — prefix + zero-padded counter or "N / total", six anchor positions

## Forms
- Auto-detect and fill AcroForm text fields (undoable)
- **Flatten forms** on export (bake field values into page content)

## Redaction & privacy
- **True redaction** — permanent black-box burn via page rasterization (text becomes unextractable)
- **Sanitize** — strip metadata (`/Info`, XMP), document JavaScript (`/OpenAction`, `/AA`), embedded files
- **Lock PDF** — AES-256 password encryption on export

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
