# Changelog

All notable changes to PDFturbo are documented here. This project follows
[Semantic Versioning](https://semver.org/).

## [Unreleased] — since 1.0.0 (2026-06-27 → 2026-09-01)

Shipped continuously to GitHub Pages; no version bump. This is a consolidated summary, not a
per-commit log — `git log` is the record. The theme of the period was **safety over surface**:
most of the work went into proving that what the product claims to remove is actually removed.

### Added
- **Crop, completed** — numeric per-edge margins in points (#G23 v1b) and eight resizable
  drag handles on the crop frame (#G23 v1c). Margins convert per page, so a mixed-size document
  crops consistently; a page left with nothing to show is skipped rather than emptied.
- **XLSX table export** (#56b) — real numeric cells (a currency column stays summable), written
  as OPC with no new dependency, in its own lazy chunk.
- **Borderless table detection** (EH-E, closing ceiling C13) — tables with no ruled lines are
  inferred from text geometry and exported to CSV. Deliberately NOT wired into the DOCX path,
  where a false positive would silently mangle prose.
- **Whole-app QA sweep** as a deploy-blocking CI gate — boots the built artifact in real
  Chromium, exercises every reachable control, and fails on a console error, a failed request,
  or a critical/serious axe violation.

### Fixed — redaction and export safety
- **Redacted content reached every export path that does not rasterise the page.** Each was
  reproduced against shipping code before being fixed: table → CSV/XLSX; OCR "copy text" and
  "export to Word"; a redaction on a blank page; overlay text under a redaction in the
  DOCX/MD/TXT exports; the same in the XFDF export; and the OCR burn's own placement.
- **The redaction filter silently no-opped on rotated pages** (90°/270°), and on any page whose
  CropBox origin is not (0,0) — two coordinate-frame defects, each measured across all rotations.
- **A source annotation under a redaction was painted on top of the burn** and baked into the
  exported pixels — visibly. Annotations meeting a redaction are now stripped before rasterisation,
  on every path, at every rotation, with or without a crop.
- **An orphaned un-redacted page survived inside exported bytes** — absent from the page tree, so
  every viewer reported it gone, while the text sat in the file.
- Images inside a Form XObject escaped the redaction filter; the drag-placed signature rect used a
  crop-relative frame where PDF requires absolute user space.

### Fixed — accessibility, correctness, supply chain
- Three serious and one critical WCAG 2.1 AA rules cleared; 24 controls given explicit
  programmatic names. The live gate now carries **zero accepted exceptions**.
- **Desktop click-to-select was dead for two months** — destroying a node on `pointerup`
  suppresses the mouse `click`; pdf.js's text layer and the grey margin around the page each
  swallowed the deselect click.
- A failed autosave reported success (`saveState` read the wrong error property), and a leaked
  IndexedDB connection made the storage suite hang rather than fail.
- Custom-font subsetting broke on a `@cantoo/pdf-lib` minor bump — adapted at the fontkit seam
  rather than pinning back or embedding whole fonts.
- Transitive `npm audit` advisories pinned via `overrides` (`brace-expansion`, `fast-uri`).

### Documented
- **`SECURITY.md` § "Hiding is not removing"** — every surface graded: six genuinely remove
  content, the rest hide it. Crop, a filled shape over text, and form flattening are each called
  out, because each reads as removal and is not.
- `KNOWN_ISSUES.md` grew ceiling **C22** (flow layout on a non-zero CropBox origin), pinned by a
  confirming blocker test so it cannot rot unnoticed.

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
