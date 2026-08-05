# PDFturbo

Edit, annotate, sign and fill PDFs entirely in your browser — nothing uploaded, nothing tracked.

## How to run

```bash
npm run dev
# opens at http://localhost:5173/pdfturbo/
```

To preview the production build locally:
```bash
npm run build
npm run preview
```

> **Do not open `index.html` by double-clicking** — the app is a Vite/TypeScript
> project and requires a dev server or built output to run. `npm run dev` handles this automatically.

## Deploy to GitHub Pages (free, HTTPS, always-on)

A GitHub Actions workflow (`.github/workflows/deploy.yml`) handles deployment automatically:

1. **Fork or push** to a repo named `pdfturbo` on your GitHub account.
2. **Enable Pages:** repo Settings → Pages → Source: `GitHub Actions`.
3. Push to the `master` branch — the workflow runs `npm audit → type-check → lint → test → test:browser → build` and deploys the `dist/` folder to Pages.
4. Your app is live at `https://YOUR_USERNAME.github.io/pdfturbo/`

> **Install on Android:** visit the URL in Chrome → three-dot menu → "Add to Home screen"
> **Install on iOS:** visit in Safari → Share → "Add to Home Screen"

## Features

- Upload any PDF, fill form fields, annotate, sign, and export
- **Text tool** — place editable text boxes with font/size/bold/italic/color controls
- **Edit PDF text** — click any word in the PDF to overlay and edit it in place
- **Shapes** — arrow, rectangle, ellipse, freehand draw. A filled shape drawn over text **does not hide
  it** — the text underneath stays fully selectable and copyable. To remove content, use **Redaction**
- **Highlight** — semi-transparent highlight over existing text
- **Eraser** — erase freehand ink strokes (does not affect annotation elements)
- **Fill bucket** — flood-fill enclosed regions of freehand ink drawings with a chosen colour
- **Signature pad** — draw a signature on a canvas, then place it anywhere
- **Image overlay** — insert PNG/JPEG/WebP images
- **Comment / sticky note** — place resizable sticky notes
- **Redaction** — permanent black-box redaction via full page rasterization (text unextractable)
- **OCR** — recognise text in scanned/image PDFs (tesseract.js, 8 languages incl. Arabic); insert as editable text, or add an invisible searchable text layer
- **Digital signature (e-Sign)** — visible PKCS#12/CMS signature (node-forge); upload a `.p12` or generate a self-signed certificate in-browser
- **Lock PDF** — AES-256 password encryption on export
- **Sanitize** — download a copy with metadata (`/Info`, XMP), document-level JavaScript (`/OpenAction`, `/AA`), and embedded files stripped
- **Native save dialog** — on Chromium, Download opens the OS "Save As" picker and writes the file directly (File System Access API); other browsers download as usual
- **Export to DOCX / Markdown / TXT** — reconstruct a flow document (headings, lists, tables, columns, images, hyperlinks, RTL) from the PDF text; uses the PDF's structure tags when present
- **DOCX editor** — open a `.docx` and edit it: rich text, headings, fonts/colour, **tables** (add/remove rows & columns, merge/split cells), **images** (insert/move/resize/cut-paste/drag), **hyperlinks**, find & replace, paste-from-Word cleanup; export back to `.docx` or to PDF
- **Per-page crop** — show only a chosen region: drag it, drag the frame's handles to adjust, or type per-edge margins
  (rotation-safe). **Crop HIDES, it does not remove:** it sets the PDF CropBox, so the cropped-away
  area stays in the file and a recipient can restore it. To take content out permanently, use
  **Redaction**
- **Bates / page numbering** — prefix + zero-padded counter or "N / total", six anchor positions
- **PDF compress** — lossless optimize, or flatten-to-images at a chosen DPI/quality
- **Form flatten** — bake AcroForm field values into the page on export
- **XFDF** — import / export annotations
- **Table → CSV / Excel** — extract a table from a page to a CSV file or a real `.xlsx` workbook
  (numbers stay numbers, so a price column can be summed). Ruled tables and, since EH-E, borderless
  ones inferred from column whitespace
- **Watermark** — tiled repeating watermark on export with configurable text, opacity, angle, density
- **Barcode / QR code** — generate and place 1D/2D barcodes or QR codes with custom content, format, and error-correction level
- **Text search** — find text in the PDF with highlighted matches and Add Highlight action
- **Form field fill** — auto-detect and fill AcroForm text fields (Tx type)
- **Page management** — add pages from another PDF (merge), delete, reorder, rotate pages, and **extract a page range** (e.g. `1-3, 5, 8-10`) to a new PDF
- **Undo / Redo** — 50-command history (Ctrl+Z / Ctrl+Y)
- **Session persistence** — auto-saves to IndexedDB, restores on reload
- **Export options** — full PDF, single page PDF, page as PNG image
- **Export preview** — see annotation positions before downloading
- Pinch-to-zoom on mobile; Ctrl+Wheel on desktop
- Keyboard shortcuts for all major tools
- PWA: installable, works offline for the app shell
- Full EN / FR / AR (RTL) localisation

## License

PDFturbo is **proprietary** — © 2026 Takieddine Messaoudi, all rights reserved (see
[`LICENSE`](LICENSE)). It is not open-source; the source is published for transparency, not for
reuse or redistribution.

The application bundles third-party open-source libraries, all under permissive licenses
(MIT / Apache-2.0 / BSD-3-Clause) plus the Noto Naskh Arabic font (SIL OFL 1.1) — full
attributions in [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md).
