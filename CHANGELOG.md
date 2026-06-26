# Changelog

All notable changes to PDFturbo are documented here. This project follows
[Semantic Versioning](https://semver.org/).

## [1.0.0] — 2026-06-26

First complete release. A client-side PDF editor that runs 100% in the browser — no backend,
nothing uploaded. See [`FEATURES.md`](FEATURES.md) for the full capability list and
[`KNOWN_ISSUES.md`](KNOWN_ISSUES.md) for the honest structural limits.

### Editing & annotation
- Rich overlay **text** (font, weight, underline/strike, colour, alignment/justify, line height,
  opacity, background, spacing, scale, super/subscript, outline, lists, links, RTL, format painter)
- **True in-place PDF text editing** via content-stream surgery, with editable-overlay fallback
- Shapes (arrow/rect/ellipse/line/freehand), highlight, eraser, ink fill-bucket
- Image overlay, comments / sticky notes, barcode / QR generator
- Undo / redo (50-command history)

### Documents, forms & pages
- Merge / delete / reorder / rotate pages; extract page ranges; **per-page crop**
- **Watermark** (live + export) and **Bates / page numbering**
- AcroForm fill (undoable) and **form flattening** on export

### Privacy & security
- **True redaction** (rasterised burn — text unextractable)
- **Sanitize** (strip metadata / document JavaScript / embedded files)
- **AES-256** password encryption on export

### OCR & signing
- OCR (tesseract.js, 8 languages, self-hosted assets) → searchable layer / text boxes / text / DOCX
- Visible **PKCS#12 / CMS digital signature**; in-browser self-signed certificate generation
- Approval signatures with caption + guided multi-signer panel

### Conversion & export
- **PDF → DOCX / Markdown / TXT** (structure-tag aware; headings, lists, tables, images, links, RTL)
- **DOCX editor** — rich text, tables (rows/cols + merge/split), images (insert/move/resize/cut-paste/drag),
  hyperlinks, find & replace, paste-from-Word; export to `.docx` or PDF
- **Table → CSV**, **PDF compress** (lossless / flatten-to-images), **XFDF** import/export
- Native OS "Save As" on Chromium; PNG/JPEG page export; export preview

### Platform
- Installable **PWA**; offline app shell; IndexedDB session persistence
- Full **EN / FR / AR** localisation with RTL and a shared UAX#9 bidi engine
- Keyboard shortcuts; ARIA roles/labels; skip-nav; mobile pointer & pinch-zoom support

### Engineering
- TypeScript + Vite 8 build; oxlint; Vitest (jsdom + real-Chrome browser harness)
- CI gate: `npm audit` → type-check → lint → tests (jsdom + browser) → export-coverage → build,
  auto-deployed to GitHub Pages
- All dependencies permissive-licensed (MIT / Apache-2.0 / BSD-3-Clause / OFL) — see
  [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md)
