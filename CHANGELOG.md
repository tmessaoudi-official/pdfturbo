# Changelog

All notable changes to PDFturbo are documented here. This project follows
[Semantic Versioning](https://semver.org/).

## [Unreleased] — since 1.0.0 (2026-06-27 → 2026-09-04)

Shipped continuously to GitHub Pages; no version bump. This is a consolidated summary, not a
per-commit log — `git log` is the record. The theme of the period was **safety over surface**:
most of the work went into proving that what the product claims to remove is actually removed.

### Added
- **Open from the native file picker, with a Recent-files list** (#54b) — the open side now mirrors
  the Save-dialog support that shipped in #54. Chromium offers the OS picker; Firefox and Safari keep
  the ordinary file input, unchanged. Recently-opened files are remembered so you can reopen one in a
  click. What is stored is the browser's own handle, never a filesystem path, and the browser asks
  you to re-grant access on the first open of a session — nothing about the file leaves the device.
- **Crop, completed** — numeric per-edge margins in points (#G23 v1b), eight resizable
  drag handles on the crop frame (#G23 v1c), and apply-to-all now scaling the crop to each page's
  own size rather than reusing one absolute rectangle (#G23 v1d), so "the top third of every page"
  means that on a mixed-size document. Margins convert per page; a page left with nothing to show is
  skipped rather than emptied.
- **XLSX table export** (#56b) — real numeric cells (a currency column stays summable), written
  as OPC with no new dependency, in its own lazy chunk.
- **Borderless table detection** (EH-E, closing ceiling C13) — tables with no ruled lines are
  inferred from text geometry and exported to CSV. Deliberately NOT wired into the DOCX path,
  where a false positive would silently mangle prose.
- **Whole-app QA sweep** as a deploy-blocking CI gate — boots the built artifact in real
  Chromium, exercises every reachable control, and fails on a console error, a failed request,
  or a critical/serious axe violation.

### Fixed — redaction and export safety
- **Sanitize did not remove every script it promised to.** A JavaScript action survived when it was
  written as an indirect reference, when it was chained behind a legitimate link (`/Next`), when it
  was listed in an array, when it sat on a bookmark, and when it rode a `/Rendition` action — and in
  each case the confirmation said the document was clean. Hyperlinks chained alongside a removed
  script keep working, at every position of the chain.
- **Sanitize could freeze the tab.** The first fix for the chained-script case looped forever on a
  document whose action chain pointed back at itself, with no error and no way out but closing the
  tab. Fixed the same day; a chain that cycles now terminates and is cleaned like any other.
- **Sanitize could fail on a book-sized bookmark list** (around ten thousand entries) after that
  same fix, because bookmarks were walked recursively. They are walked iteratively now.
- **Sanitize now removes actions that reach outside the document without JavaScript** — form
  submission to a URL, launching an external program or file, opening another document, and
  importing form data — and **removes paperclip attachments together with their file**, not only
  files in the document's name tree, and associated files (`/AF`) hung on any annotation. Ordinary
  hyperlinks and in-document media actions are kept.
- **Deleting an image in the DOCX editor now removes it from the file.** It used to drop the
  picture from the document while leaving its bytes in the package, recoverable by renaming the
  `.docx` to `.zip` — disclosed since 2026-08-05 and closed on 2026-09-04. The collector errs
  towards keeping: it walks every part's relationships, treats anything a `[Content_Types]`
  override names as live, and only ever removes files under `word/media/`.
- **Content hidden by a Form XObject's own boundary is no longer read as page geometry**, which
  could widen an inferred table region across ordinary prose and drop a whole paragraph from the
  Word/Markdown/text exports.
- **Redacted content reached every export path that does not rasterise the page.** Each was
  reproduced against shipping code before being fixed: table → CSV/XLSX; OCR "copy text" and
  "export to Word"; a redaction on a blank page; overlay text under a redaction in the
  DOCX/MD/TXT exports; the same in the XFDF export; and the OCR burn's own placement.
- **The redaction filter silently no-opped on rotated pages** (90°/270°), and on any page whose
  CropBox origin is not (0,0) — two coordinate-frame defects, each measured across all rotations.
- **A rotated redaction burned a rotated box while every filter tested the upright one**, so
  content under the parts that stick out was painted over yet stayed fully extractable in the
  Word/Markdown/text and CSV/Excel exports. Element rotation is now part of the test, on both
  sides of it.
- **Freehand ink was stamped over the burn**, so handwriting under a redaction stayed visible in
  the export. Ink is now clipped to the redactions on its own canvas — the covered pixels go and
  the rest of the same stroke is untouched.
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

### Fixed — cropped-page export
- **Word/Markdown/text export on a cropped page** (closing ceiling **C22**) — on a PDF whose
  CropBox has a non-zero origin, every position in the reconstructed document was offset by that
  origin: wrong page margins, misplaced images, and typed notes interleaved at the wrong point in
  the reading order. The export now normalises text, rules, images, links and colours into one
  frame before reconstructing, so a cropped source exports like any other. Pages with an ordinary
  CropBox are byte-identical.

### Documented
- **`SECURITY.md` § "Hiding is not removing"** — every surface graded: six genuinely remove
  content, the rest hide it. Crop, a filled shape over text, and form flattening are each called
  out, because each reads as removal and is not.
- `KNOWN_ISSUES.md` grew ceiling **C22** (flow layout on a non-zero CropBox origin), pinned by a
  confirming blocker test so it cannot rot unnoticed — and **C22 is now CLOSED** (see Fixed).

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
