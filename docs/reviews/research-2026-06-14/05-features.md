# PDFturbo — Competitive Feature Research & Roadmap

**Date:** 2026-06-14
**Scope:** High-value features PDFturbo *lacks* that are feasible **100% client-side** with the current
stack (pdfjs-dist v6, @cantoo/pdf-lib + @pdf-lib/fontkit, docx, bwip-js, qr-code-styling, i18next,
IndexedDB) or a small, well-maintained **MIT/Apache** library.

> **Method:** every feasibility verdict below was checked via web research before being proposed.
> Each verdict carries an evidence grade: **[Verified]** = confirmed by a cited source / current docs;
> **[Inferred]** = consistent with the stack's known capabilities but not directly demonstrated in a source.

> **License rule:** only MIT / Apache-2.0 libraries are recommended. AGPL / commercial deps are
> flagged explicitly and never recommended without a warning.

---

## What already exists (do not re-propose)

Edit/annotate (text, shapes, ink, highlight, comment, image), image-based signature, AcroForm **text**
field fill + flatten, redaction (true rasterization), watermark (tiled), barcode/QR, true text editing
(content-stream surgery), PDF→DOCX/MD/TXT, page thumbnails / reorder / rotate / delete / add-from-PDF,
single-page + PNG export, undo/redo, search, zoom, session persistence, EN/FR/AR + RTL, PWA/offline.

---

## Confirmation of prompt sub-questions

| Question | Answer (graded) |
|---|---|
| **Cryptographic e-signature (PAdES/PKCS#7) client-side?** | **Yes.** [Verified] `zgapdfsigner` (MIT) signs a PDF with a P12/PFX certificate **entirely in the browser** (uses `node-forge`, pure-JS PKCS#7; can emit PAdES via `ETSI.CAdES.detached` SubFilter). `@signpdf` is Node-oriented but its crypto core (`node-forge`) is browser-capable. |
| **OCR for scanned PDFs?** | **Yes.** [Verified] `tesseract.js` (Apache-2.0, WASM) does in-browser OCR; pdf.js rasterizes pages → OCR → embed invisible text layer = searchable PDF. Single-threaded, slow on 10+ pages, weak on handwriting/tables. |
| **PDF compression/optimize?** | **Partial.** [Verified] Canvas-based image downsample/re-encode via pdf-lib = MIT, no new heavy dep. Ghostscript-WASM gives far better ratios but is **AGPL + ~18 MB** — flagged, not recommended. |
| **Form flattening?** | Already done for filled fields on export. [Verified in FEATURES.md] Gap = flatten *all* widgets incl. the unsupported checkbox/radio/combo types (depends on form-field expansion). |
| **Merge / split / extract / rotate / delete pages?** | **Yes, mostly there.** [Verified] Rotate/delete/reorder/add-from-PDF exist. **Missing: split-to-ZIP, extract page range to new PDF, merge UI surfaced as a first-class tool.** Trivial with pdf-lib `copyPages` + `fflate`. |
| **True redaction (content removed, not black box)?** | **Confirmed already true.** [Verified in FEATURES.md §23] Redacted pages are fully rasterized to PNG at 2× before embedding — text layer is destroyed, content is unrecoverable. This is genuine redaction, not an overlay box. Gap = redaction loses vector quality on the whole page (known trade-off); a *text-run-level* content-stream removal would be the premium upgrade. |
| **PDF/A conversion?** | **Hard client-side.** [Verified] Only Ghostscript-WASM (AGPL, 18 MB) realistically converts+validates. veraPDF has no browser build. → Tier 3 moonshot, flagged. |
| **Accessibility tagging?** | **Hard client-side.** [Verified] Manipulating the PDF structure/tag tree needs low-level access JS PDF libs don't expose; pdf-lib cannot author a StructTreeRoot today. → Tier 3 moonshot. |
| **Compare two PDFs?** | **Yes.** [Verified] pdf.js render→canvas + pixel diff (pixelmatch, MIT) for visual diff; pdf.js text extraction + a JS diff (`diff`, BSD/MIT) for text diff. Open-source precedents exist (pdf-diff-viewer, pdf-visual-diff). |
| **Flatten annotations?** | **Yes.** [Inferred] Our own overlay annotations are already burned in on export; "flatten" = same path applied to *incoming* AcroForm/annotation layers via pdf-lib `flatten()`. |
| **Extract images / tables?** | **Images: yes** (already wired for DOCX via `getOperatorList` + `commonObjs`); surface a standalone "extract all images → ZIP". **Tables: hard** (lattice/vector grid detection — already parked). [Verified in CLAUDE.md] |
| **Password remove (with auth)?** | **Yes.** [Verified] pdf.js decrypts with the user-supplied password and exposes decrypted bytes; re-save via @cantoo/pdf-lib **without** an encryption dict = unlocked PDF. **Important: pdf-lib `ignoreEncryption:true` does NOT decrypt** — it is detection-only; the decrypt must come from pdf.js. |
| **Password ADD / encrypt?** | **Yes.** [Verified] `@cantoo/pdf-lib` (our existing write lib) supports `.encrypt({userPassword, ownerPassword, permissions})` — this is why the project chose the cantoo fork. Near-zero new code. |

---

## Prioritized Roadmap

### TIER 1 — Quick, high-value (small new code, no/low new deps)

| Feature | What it is + value | Feasibility | Library + license | Effort | Risk / limitation |
|---|---|---|---|---|---|
| **Merge / Split / Extract pages** | Combine multiple PDFs; split a doc into ranges; extract a page-range to a new PDF; "split all → ZIP". The single most-requested PDF utility category (Stirling/iLovePDF/Sejda all lead with it). | [Verified] pdf-lib `copyPages` already used for add-from-PDF; only a range/ZIP UI is new. | `@cantoo/pdf-lib` (MIT, have it) + `fflate` (MIT) for ZIP | **S** | None material; large multi-file merges are memory-bound in tab. |
| **Set / remove open password (encrypt + decrypt)** | Add user/owner password + permissions on export; remove a password the user can supply. Privacy-first users specifically want this offline. | [Verified] cantoo fork exposes `.encrypt()`; pdf.js decrypts with supplied password → re-save unencrypted. | `@cantoo/pdf-lib` `.encrypt()` (have it) + pdf.js decrypt path (have it) | **S–M** | RC4/AES support per cantoo fork; `ignoreEncryption` is NOT a decrypt — must route through pdf.js. |
| **Page numbering + Bates numbering** | "Page N of M" / legal Bates stamps with prefix, start#, position, exclude-cover. Table-stakes in Sejda/PDF24; we have the watermark text-drawing pipeline to reuse. | [Verified] same `drawText` tiling/positioning code as watermark. | `@cantoo/pdf-lib` (have it) | **S** | Must apply across all 3 export paths (downloadPDF/Page/Image) — known triplication gotcha. |
| **Crop / resize page (visible box)** | Drag a crop rectangle; set CropBox/MediaBox. Common in Sejda/Acrobat; complements existing rotate/redact UI. | [Inferred] pdf-lib `page.setCropBox()` exists; reuse redaction's drag-rect UI. | `@cantoo/pdf-lib` (have it) | **S–M** | CropBox vs MediaBox semantics; interaction with rotation math (BUG-01 area). |
| **Extract all images → ZIP** | One-click pull every embedded raster out of a PDF. We already extract images for DOCX. | [Verified] `getOperatorList` + `commonObjs` extraction already implemented; add ZIP packaging. | pdf.js (have it) + `fflate` (MIT) | **S** | Vector/SVG content not extractable as image; already solved for the DOCX path. |
| **Flatten incoming annotations / form fields fully** | Burn existing AcroForm + annotation layers into static content (read-only output). We flatten *filled* fields; extend to all. | [Inferred] pdf-lib `form.flatten()`; depends partly on widget-type expansion. | `@cantoo/pdf-lib` (have it) | **S–M** | Combo/checkbox flatten needs the form-field expansion (VISION.md) first. |

### TIER 2 — Higher-value, moderate effort (one new well-maintained dep)

| Feature | What it is + value | Feasibility | Library + license | Effort | Risk / limitation |
|---|---|---|---|---|---|
| **OCR scanned PDFs → searchable text layer** | Run OCR on image-only pages, embed an invisible text layer so text becomes selectable/searchable and DOCX-exportable. Unlocks our whole edit/search/export suite for scanned docs. Flagship privacy feature (nothing uploaded). | [Verified] tesseract.js + pdf.js raster + invisible-text embed is a proven client-side pattern. | **tesseract.js (Apache-2.0)** | **M–L** | WASM + language traineddata ~ a few MB (lazy-load like docx chunk); single-threaded, slow on many pages (use a Web Worker + progress UI); weak on handwriting/skew/tables. |
| **Cryptographic digital signature (PAdES / PKCS#7)** | A REAL certificate-based signature (P12/PFX upload), not an image stamp — tamper-evident, verifiable in Acrobat. Genuine differentiator; most free web tools only do image signatures. | [Verified] zgapdfsigner signs with a P12 fully in-browser; PAdES via `ETSI.CAdES.detached`. | **zgapdfsigner (MIT)** (or `node-forge` MIT directly) | **L** | UX of trusting a self-signed/uploaded cert; signature must be applied as the *final* write (incremental update) — careful ordering vs our edit pipeline; long-term-validation (LTV)/timestamping needs a TSA (network) — out of pure-offline scope, document it. |
| **Compare two PDFs (visual + text diff)** | Side-by-side or overlay diff highlighting changed pixels/words across versions. Strong "pro" feature (Stirling, Acrobat, Draftable). | [Verified] pdf.js render + pixelmatch (visual); pdf.js text + diff (text). Open-source precedents. | **pixelmatch (MIT)** + **diff (BSD-3)** + pdf.js | **M** | Page-alignment when page counts differ; reflowed text → many false diffs (mitigate with text-level diff). |
| **Image-based compression / optimize** | Downsample + re-encode embedded images to a target DPI/quality to shrink file size; strip unused objects. Ubiquitous tool (Smallpdf/PDF24/iLovePDF lead with it). | [Verified] canvas resample + JPEG re-encode, swap image XObjects via pdf-lib. | `@cantoo/pdf-lib` (have it) + Canvas (run in Web Worker) | **M** | pdf-lib does not compress images natively — manual XObject surgery; gains limited vs Ghostscript; do heavy work off the main thread. |
| **Form field expansion: checkbox / radio / combo / list** | Detect + render + fill the AcroForm widget types we currently ignore (only `Tx` today). Directly listed as a gap in VISION.md. | [Verified] pdf.js `getAnnotations` exposes Btn/Ch types; pdf-lib reads/writes them. | pdf.js + `@cantoo/pdf-lib` (have it) | **M** | Radio-group semantics, export value mapping, appearance-stream regen on flatten. |

### TIER 3 — Moonshots (large effort, dep weight, or licensing caveats)

| Feature | What it is + value | Feasibility | Library + license | Effort | Risk / limitation |
|---|---|---|---|---|---|
| **PDF/A conversion** | Convert to archival PDF/A-1b/2b/3b with validation. Demanded by legal/gov users. | [Verified] **Only** Ghostscript-WASM realistically does it client-side. | ⚠️ **Ghostscript-WASM (AGPL-3.0, ~18 MB)** — license-incompatible with a permissive app; flag/avoid. veraPDF has no browser build. | **XL** | AGPL contamination risk; 18 MB download; slow. Recommend NOT shipping unless project relicenses or accepts a separate AGPL module. |
| **Accessibility (PDF/UA) tagging** | Author a structure/tag tree (headings, alt-text, reading order) for screen readers + EAA 2025 compliance. | [Verified] structure-tree authoring is not exposed by pdf-lib/pdf.js; needs low-level object surgery. | None mature MIT/Apache in-browser | **XL** | Effectively new low-level tooling; our flowDoc heading detection could *seed* structure, but writing a valid StructTreeRoot is research-grade. |
| **Table extraction (lattice/stream)** | Reconstruct tables from vector grid lines / aligned text into DOCX/CSV. Already parked in CLAUDE.md. | [Inferred] vector-path grid detection via `getOperatorList`; complex heuristics. | pdf.js (have it) + custom | **L–XL** | High false-positive rate; borderless ("stream") tables far harder; low ROI vs effort. |
| **Per-element & true text-run redaction** | Redact specific text runs via content-stream removal (keep vector quality on the rest of the page) instead of rasterizing the whole page. Premium over current full-page raster. | [Inferred] extends existing `contentStreamEditor.ts` text-op surgery to deletion + sanitize metadata/links. | own `contentStreamEditor.ts` (have it) | **L** | Must also scrub OCG/annotations/metadata to be truly safe; rasterization is the safer default — keep it as fallback. |

---

## Recommended next 3 (best value/effort)

1. **Merge / Split / Extract pages** (Tier 1, S) — biggest table-stakes gap, almost free with current deps.
2. **Encrypt / decrypt (password add + remove)** (Tier 1, S–M) — the cantoo fork was literally chosen for
   `.encrypt()`; pairs perfectly with the privacy-first positioning.
3. **OCR → searchable layer** (Tier 2, M–L) — the flagship differentiator; one Apache-2.0 dep, lazy-loaded,
   unlocks the entire existing toolset for scanned documents.

*Cross-cutting note:* all page/stamp features (numbering, Bates, crop, watermark) must be applied to **all
three** export paths (`downloadPDF`/`downloadPage`/`downloadPageAsImage`) — the known triplication gotcha;
the long-term fix is extracting the shared export pipeline.

---

## Sources

- Browser PAdES/PKCS#7 signing: <https://github.com/zboris12/zgapdfsigner>,
  <https://www.npmjs.com/package/@signpdf/signpdf>, <https://www.npmjs.com/package/@signpdf/signer-p12>,
  <https://en.wikipedia.org/wiki/PKCS_7>, <https://l1z2g9.github.io/2019/01/23/PDF_Signing_By_p12_With_JS/>
- OCR (tesseract.js): <https://dev.to/helloashish99/ocr-in-the-browser-how-tesseractjs-makes-pdf-text-extraction-free-5ab2>,
  <https://towardsdatascience.com/build-an-image-pdf-text-extraction-tool-with-tesseract-ocr-using-client-side-javascript-6126031001/>,
  <https://transloadit.com/devtips/integrating-ocr-in-the-browser-with-tesseract-js/>, <https://github.com/gkovacs/pdfocr>
- Compression (canvas / Ghostscript-WASM AGPL): <https://dev.to/mursalnasaj02/building-a-client-side-pdf-compressor-using-javascript-and-web-workers-4dmm>,
  <https://github.com/laurentmmeyer/ghostscript-pdf-compress.wasm>, <https://docs.apryse.com/web/guides/features/optimization>
- PDF/A & veraPDF: <https://apryse.com/capabilities/conversion/pdfa>, <https://meyer-laurent.com/playing-around-webassembly-and-ghostscript>
- Compare two PDFs: <https://github.com/a-subhaneel/pdf-diff-viewer>, <https://github.com/moshensky/pdf-visual-diff>,
  <https://www.npmjs.com/package/pdf-visual-diff>, <https://montemagno.com/introducing-pdf-diff-compare-pdfs-privately-in-your-browser/>
- Encrypt/decrypt with pdf-lib & pdf.js: <https://www.npmjs.com/package/@cantoo/pdf-lib>,
  <https://github.com/cantoo-scribe/pdf-lib>, <https://github.com/Hopding/pdf-lib/issues/1601>,
  <https://www.dynamsoft.com/codepool/pdf-encrypt-decrypt-javascript.html>, <https://medium.com/joyfill/handling-password-protected-pdfs-in-javascript-f966aa3080dc>
- Accessibility tagging limits: <https://community.adobe.com/questions-12/how-to-create-persistent-programmatically-controlled-content-tags-in-pdf-in-adobe-reader-pro-1506868>,
  <https://www.convertapi.com/solutions/pdf-accessibility-automation>
- Competitor feature sets: <https://docs.stirlingpdf.com/functionality/>, <https://docs.stirlingpdf.com/Functionality/Compress/>,
  <https://www.sejda.com/bates-numbering-pdf>, <https://www.sejda.com/page-numbers-pdf>
