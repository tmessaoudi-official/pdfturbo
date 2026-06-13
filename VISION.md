# PDFturbo — Vision & Future Features

Captured 2026-06-04. Ideas that surfaced during development — not yet planned or committed.

---

## Bugs to Investigate (reported 2026-06-04)

| # | Report | Status |
|---|--------|--------|
| B1 | Add PDF — file chooser opens but PDF not appended to document | Works — `_handleAddPdfUpload` implemented in pdfTurboApp.ts |
| B2 | Watermark appears only in centre of page, not tiled/repeated | Fixed — density-based tiling added (commit fb87e8b) |
| B3 | Can delete a highlight but not a single comment | Fixed — `createControls()` in base PDFElement provides delete button on all element types |
| B4 | Delete Page button in toolbar does not work | Works — `_deletePage(pageId)` implemented in pdfTurboApp.ts |

---

## Enhancements to Existing Features

### ~~Watermark — Tiled / Repeated Pattern~~ **Done**
~~Currently watermark renders as a single centred overlay. Desired: tile it across the full page (e.g. diagonal repeating grid, configurable opacity and spacing).~~ Fixed — density-based tiling with configurable angle and spacing (commit fb87e8b).

### Form Field Detection — Expand Widget Types
Currently detects text input fields. Missing:
- **Checkboxes** — tick/untick
- **Radio buttons** — single-select groups
- **Dropdown / Combo boxes** — select from list
- **List boxes** — multi-select
- **Push buttons** — trigger actions

### ~~Comment / Sticky Note — Per-Note Delete~~ **Done**
~~Currently unclear if individual comment removal is possible. Add a × delete control on each comment note (same as other annotation types).~~ Fixed — `createControls()` in base `PDFElement` provides a delete button on all element types including comments.

### Page Export UX
Export single page as PDF is available via the 📄 toolbar button (exports current page) and the ⬇ button on each thumbnail. Future idea: "Split all pages" batch action to download a ZIP of per-page PDFs.

---

## New Feature Ideas

| Idea | Notes |
|------|-------|
| **Stamps** | Pre-defined image overlays (Approved, Draft, Confidential, Custom) |
| **Date field** | Auto-fill today's date as a text element |
| **Page numbering overlay** | Add "Page N of M" footer to all pages |
| **Header / Footer** | Repeating text or image banner on all pages |
| **Hyperlink annotation** | Attach URL to a region; clickable in exported PDF |
| **OCR text layer** | For scanned PDFs — extract selectable text via Tesseract.js |
| ~~**QR code insertion**~~ **Done** | ~~Generate + embed a QR code for a URL~~ — ships as Barcode/QR tool (bwip-js + qr-code-styling; supports 1D/2D formats, error-correction, styles) |
| **Batch export** | Export all pages as separate PDFs or a ZIP of PNGs |
| **PDF compression** | Re-compress output PDF to reduce file size |
| **Page background** | Set a solid colour background (useful for blank PDFs) |
| **Tables** | Draw a table overlay with configurable rows/columns |
| **Digital signature** | Embed a cryptographic signature field |

---

## PDF Element Types Reference (pdfjs-dist)

Types that pdfjs-dist can expose for annotation/detection:

| Widget type | pdfjs fieldType | Current support |
|-------------|-----------------|-----------------|
| Text input  | Tx              | ✅ Detected + fillable |
| Checkbox    | Btn (checkBox)  | ❌ Not detected |
| Radio       | Btn (radioButton) | ❌ Not detected |
| Combo box   | Ch (comboBox)   | ❌ Not detected |
| List box    | Ch (listBox)    | ❌ Not detected |
| Push button | Btn (pushButton) | ❌ Not detected |
| Signature   | Sig             | ❌ Not detected (draw tool exists separately) |

Other annotation types beyond AcroForm widgets: links, free text, stamps, file attachments, ink (freehand), popup, highlight/underline/strikeout.

---

## Parked

- ~~**Dependency upgrades** (TypeScript 5→6, Vite 5→8, pdfjs-dist 3→6, ESLint 9→10)~~ **Done** — all three upgrades are complete (package.json: `typescript ^6.0.0`, `vite ^8.0.0`, `pdfjs-dist ^6.0.0`).
- **`noUncheckedIndexedAccess`** — enabling this tsconfig flag would catch a class of index-out-of-bounds bugs at compile time, but currently produces ~339 errors across the codebase. Worth fixing incrementally; requires adding `?? undefined` guards or narrowing at every array/object access site.
