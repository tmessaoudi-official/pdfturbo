# PDFturbo — Feature Test Checklist

**Version**: 1.0.0  
**Build**: Vite 8 / TypeScript 6 / PWA  
**Base URL**: `/pdfturbo/`  
**Total features**: 40  
**Last updated**: 2026-06-11 (full QA audit — all 40 features exercised)

> **How to use this file**: Work through each numbered feature top to bottom.  
> For each one: test the steps listed, then report what works, what's broken, and what feels wrong.  
> We'll build a fix/improve plan from your feedback.

---

## AUDIT STATUS — 2026-06-07 (advisor-reviewed)

Full browser audit completed (CDP automation against built app). All tools exercised. Reviewed by advisor model — findings corrected and expanded.

### Fixed before/during 2026-06-07 session
| Fix | Files | Commit |
|---|---|---|
| PDF text not selectable — pdfjs v6 `--total-scale-factor` CSS var | `js/textLayer.ts` | prior |
| Storage banner not translated in FR/AR | `index.html`, `locales/*.json` | prior |
| Watermark density — density-factor multiplier replaced with count-based step | `js/pdfEditorApp.ts` | fb87e8b |
| `_transformPoint` 90°/270° cases swapped; 180° y-axis inverted | `js/pdfEditorApp.ts` | fb87e8b |
| Ink strokes not repositioned on page rotation | `js/pdfEditorApp.ts` | fb87e8b |
| Redaction security — page fully rasterized to PNG before export | `js/pdfEditorApp.ts` | prior |

### Fixed during full QA audit (2026-06-11)
| Fix | Files | Details |
|---|---|---|
| `aria-label` stuck in previous language after language switch | `src/utils/i18n.ts` | `applyTranslations()` was skipping aria-label update if attribute already existed; now always syncs on language change |
| Fill bucket mode badge key missing | `src/core/uiController.ts` | `badgeKeys` mapping lacked `fillBucket` entry — badge showed nothing in fill bucket mode |
| Fill bucket mode hint missing | `src/core/pdfTurboApp.ts` | `modeHintKeys` lacked `fillBucket` entry — no guidance toast shown when entering fill bucket mode |
| Fill bucket i18n keys missing from all locales | `locales/en.json`, `locales/fr.json`, `locales/ar.json` | Added `toolbar.fillBucketTitle`, `badge.fillBucket`, `toast.modeHint.fillBucket`, `modal.help.actions.B` to all three locale files |
| `B` shortcut row missing from help modal table | `index.html` | Added `<tr><td>B</td><td data-i18n="modal.help.actions.B">Fill bucket</td></tr>` |
| `fillBucketTitle` tooltip missing from toolbar button | `index.html` | Added `data-i18n-title="toolbar.fillBucketTitle"` to the fill bucket toolbar button |

## AUDIT STATUS — 2026-06-14 (browser QA-sweep → ALL FIXED)

Real-browser sweep (Playwright MCP + in-page pdf.js / DOCX-unzip / pixel instrumentation) across 5 PDF
types. Full evidence: [`docs/reviews/2026-06-14-qa-sweep-findings.md`](docs/reviews/2026-06-14-qa-sweep-findings.md).
Living tracker: [`KNOWN_ISSUES.md`](KNOWN_ISSUES.md). 0 uncaught console errors — all defects were *silent*.

**ISSUE-1..5 are all FIXED**, each with a real-browser regression test (`npm run test:browser`):
toolbar DnD (forceFallback/pointer), subset/embedded-font true-edit data loss (gate byte-swap +
in-stream redraw), DOCX `commonObjs` images, DOCX no-op on image-only PDFs, and unified text mode.
A real-browser harness now exists (`@vitest/browser` + Playwright) — the structural gap that let these
ship green. **Two earlier findings were false positives, corrected during the fix run:** the toolbar
SortableJS was already attached (real bug = native-DnD mode), and `qa-imagetext.pdf` page-local images
already exported (ISSUE-3 is specifically the cross-page `commonObjs` case).

### Resolved (2026-06-14) — see KNOWN_ISSUES.md for fix + test per issue
| ID | Severity | Status |
|---|---|---|
| ISSUE-1 | P1 | ✅ Fixed — `forceFallback` pointer DnD (`toolbarCustomizer.ts`) |
| ISSUE-2 | P1 | ✅ Fixed — `isByteSwapUnsafeFont` gate + in-stream fallback redraw (`contentStreamEditor.ts`) |
| ISSUE-3 | P1 | ✅ Fixed — resolve `g_` images from `commonObjs` (`exportService.ts`) |
| ISSUE-4 | P2 | ✅ Fixed — export when text OR images present (`exportService.ts`) |
| ISSUE-5 | P2 | ↩ Reverted (Sprint 3) — text modes are now SEPARATE: `editText` edits existing text only; new text via draw-to-place `addText`. The unified blank-drop trapped users in a non-interactive mode (`textEditHandler.ts`) |

### Confirmed bugs (still open — pre-existing, out of scope for the 2026-06-14 fix run)
| ID | Severity | Description |
|---|---|---|
| BUG-01 | P1 | **Element visual distortion on rotation**: position math fixed; CSS `transform: rotate()` still missing — content wraps into narrow column on rotated pages |
| BUG-02 | P1 | **No per-element rotation UI**: no rotation handle; cannot freely rotate individual elements |
| BUG-09 | P1 | **IndexedDB restore race**: `_restoreSession()` missing `_isLoading` guard — concurrent file drop can mix session elements with new PDF |
| BUG-04 | P2 | **No SELECT mode toolbar button**: users must press Escape to exit drawing mode |
| BUG-05 | P2 | **Export preview no-toggle**: clicking eye icon while preview is open re-opens instead of closing |
| BUG-07 | P3 | **`setPointerCapture` console error**: uncaught on synthetic element placement; needs try/catch |

### All features verified working
Text tool, Signature tool, Image tool, Comment/note, Arrow/Rect/Circle shapes, Freehand, Highlight, Eraser, **Fill Bucket** (shapes + freehand ink strokes), Redact (cryptographically secure — full rasterization), Edit Text overlay, QR/barcode code tool, Copy/paste, Delete, Undo/redo, Export/download PDF (full + single page + PNG), Export preview, Help modal, Language switcher (EN/FR/AR), RTL Arabic layout, Storage banner dismiss, Zoom in/out/fit, Page rotation (transform math correct), Thumbnail panel (all buttons), Search bar (with permanent highlight add), Watermark modal (density fix applied), Session persistence/restore, Clear all annotations, Form field fill

### Known limitations (by design)
- Freehand strokes are canvas-only — not individually selectable, moveable, or undoable stroke-by-stroke
- Eraser only erases freehand canvas strokes; does not delete pdf-element divs (use Delete key)
- Search only searches native PDF text (pdfjs extraction); user-added text boxes are NOT searched
- Undo/redo is async — DOM updates after `_renderCurrentPage()` completes (~1-2s in automation, fast in prod)
- Empty comment elements are NOT auto-deleted on Escape; must use Delete key to remove
- Multi-page PDF behavior not tested in this audit pass

---

## Table of Contents

**File I/O (6)**
1. [Open PDF](#1-open-pdf)
2. [Add Pages from Another PDF](#2-add-pages-from-another-pdf)
3. [Export — Full PDF](#3-export--full-pdf)
4. [Export — Single Page PDF](#4-export--single-page-pdf)
5. [Export — Page as PNG Image](#5-export--page-as-png-image)
6. [Export Preview](#6-export-preview)

**Page Management (5)**
7. [Page Navigation](#7-page-navigation)
8. [Page Thumbnail Panel](#8-page-thumbnail-panel)
9. [Delete Page](#9-delete-page)
10. [Page Rotation](#10-page-rotation)
11. [Page Reorder](#11-page-reorder)

**Annotation Tools (15)**
12. [Element Controls](#12-element-controls-all-annotations)
13. [Text Tool + Formatting](#13-text-tool--formatting)
14. [Arrow Shape](#14-arrow-shape)
15. [Rectangle Shape](#15-rectangle-shape)
16. [Ellipse Shape](#16-ellipse-shape)
17. [Freehand Draw](#17-freehand-draw)
18. [Eraser Tool](#18-eraser-tool)
19. [Signature](#19-signature)
20. [Image Overlay](#20-image-overlay)
21. [Highlight](#21-highlight)
22. [Comment / Sticky Note](#22-comment--sticky-note)
23. [Redaction](#23-redaction)
38. [Edit Text Tool](#38-edit-text-tool)
39. [Fill Bucket Tool](#39-fill-bucket-tool)
40. [QR Code / Barcode Tool](#40-qr-code--barcode-tool)

**Search & Forms (2)**
24. [Text Search / Find](#24-text-search--find)
25. [Form Field Detection & Fill](#25-form-field-detection--fill)

**Document Settings (3)**
26. [Watermark](#26-watermark)
27. [Zoom & View](#27-zoom--view)
28. [Undo / Redo](#28-undo--redo)

**Session & State (2)**
29. [Session Persistence & Autosave](#29-session-persistence--autosave)
30. [Clear All Annotations](#30-clear-all-annotations)

**UX & Misc (7)**
31. [Keyboard Shortcuts](#31-keyboard-shortcuts)
32. [Help Modal](#32-help-modal)
33. [Toast Notifications](#33-toast-notifications)
34. [Mode Badge](#34-mode-badge)
35. [Done Pill (Freehand exit)](#35-done-pill-freehand-exit)
36. [Mobile / Touch Support](#36-mobile--touch-support)
37. [PWA / Offline Support](#37-pwa--offline-support)

---

## 1. Open PDF

**How it works**: Click **📁 Upload PDF** in toolbar row 1 (or click the empty-state landing area). Accepts `application/pdf` only. Loads via pdf.js, resets all state (elements, history, form values), computes a fit-to-width zoom, shows the thumbnail strip, and triggers autosave.

**Test steps**:
1. Open the app fresh — you should see an empty landing zone, all toolbar buttons disabled.
2. Click **Upload PDF** → select any PDF → verify it renders on the canvas.
3. Verify the zoom display updates (e.g. "82%").
4. Verify thumbnail strip appears on the left.
5. Try uploading a non-PDF file → verify an alert appears ("Please select a valid PDF file").
6. Upload a multi-page PDF → verify page count shows correctly.

**Known bugs**: None.

---

## 2. Add Pages from Another PDF

**How it works**: Click **+ Add PDF** button at the bottom of the thumbnail strip (or the hidden input triggered by it). Appends all pages from each uploaded PDF to the current document. Multiple PDFs can be selected at once. Failed files are skipped with a toast. Fully undoable.

**Test steps**:
1. Load a PDF with 2 pages.
2. Scroll down the thumbnail strip → click **+ Add PDF** → select a different PDF.
3. Verify new pages are appended (page count increases).
4. Verify thumbnails appear for the new pages.
5. Press **Ctrl+Z** → verify the added pages are removed.

**Known bugs**: None.

---

## 3. Export — Full PDF

**How it works**: Click **⬇ Download** button. Builds a pdf-lib document: copies all pages, fills+flattens form fields, draws all annotations as vectors (text, shapes, images, highlights, comments, redactions), adds watermark if enabled. Pages with redaction use rasterization (see §23). Downloads as `<name>-edited.pdf`. UI dims to 40% opacity during generation.

**Test steps**:
1. Load a PDF, add a text annotation, a rectangle, and a highlight.
2. Click **⬇ Download** → verify the UI dims briefly then a file downloads.
3. Open the downloaded PDF in any viewer → verify annotations are present and positioned correctly.
4. Verify the filename is `<original>-edited.pdf`.

**Known bugs**: None currently.

---

## 4. Export — Single Page PDF

**How it works**: Click **📄 Export Page** in toolbar row 1 (exports current page), or click **⬇** on any thumbnail (exports that specific page). Creates a single-page pdf-lib document with that page's annotations. Downloads as `<name>-page<N>.pdf`. If the page has redactions, uses rasterization.

**Test steps**:
1. Load a multi-page PDF, go to page 2, add a text annotation.
2. Click **📄 Export Page** → verify a single-page PDF downloads with the annotation.
3. Alternatively, click the **⬇** icon on any thumbnail → verify that specific page downloads.

**Known bugs**: None.

---

## 5. Export — Page as PNG Image

**How it works**: Click **📷 Export Image** in toolbar row 1. Builds a single-page PDF with all annotations, then re-rasterizes it via pdf.js at **2× scale** for high resolution. Downloads as `<name>-page<N>.png`.

**Test steps**:
1. Load a PDF with some annotations on the current page.
2. Click **📷 Export Image** → verify a PNG file downloads.
3. Open the PNG → verify annotations are present and the image is high resolution (2× the canvas size).

**Known bugs**: None.

---

## 6. Export Preview

**How it works**: Click the **👁 Preview Export** button (toolbar row 1). Shows a full-screen overlay with blue dashed rectangles showing where each annotation will land in the exported PDF (after coordinate transform). Click **Confirm** to proceed with download, or **✕ Close** to cancel.

**Test steps**:
1. Load a PDF, add 2-3 different annotations (text, rectangle, highlight).
2. Click **👁 Preview Export** → verify an overlay appears showing blue dashed boxes.
3. Verify each box corresponds to an annotation's approximate position.
4. Click **Confirm** → verify the full PDF downloads.
5. Click **👁 Preview Export** again → click **✕ Close** → verify no download happens.
6. Press **Escape** → verify the overlay closes without downloading.

**Known bugs**: (1) The ghost positions may not account for all rotation cases precisely. (2) **BUG-05 (P2)** — Clicking 👁 while preview is already open re-opens it instead of closing (no toggle). Must use the explicit ✕ Close button.

---

## 7. Page Navigation

**How it works**: Toolbar navigation group. Controls: **◀◀ First**, **◀ Prev**, **▶ Next**, **▶▶ Last**, page number input (type + Enter or blur). Keyboard: `Ctrl+←` / `Ctrl+→`. Page counter shows `current / total`.

**Test steps**:
1. Load a PDF with 3+ pages.
2. Click **▶ Next** → verify page advances, counter updates, thumbnail highlight moves.
3. Click **◀◀ First** → verify jumps to page 1.
4. Click **▶▶ Last** → verify jumps to last page.
5. Click the page number input, type `2`, press Enter → verify jumps to page 2.
6. On page 1, click **◀ Prev** → verify nothing happens (clamped).
7. Press `Ctrl+→` → verify next page. Press `Ctrl+←` → verify previous page.

**Known bugs**: None.

---

## 8. Page Thumbnail Panel

**How it works**: Left sidebar. Renders JPEG thumbnails (15% scale) with lazy loading and in-memory cache. Each thumbnail shows: page number, rotate CCW/CW buttons, download button (single page export), delete button (disabled at 1 page). Active page has a highlighted border.

**Test steps**:
1. Load a multi-page PDF → verify thumbnails appear for each page.
2. Click a thumbnail → verify the canvas navigates to that page.
3. Verify the active thumbnail has a highlighted border.
4. Verify the thumbnail updates after you rotate a page (see §10).

**Known bugs**: Thumbnails do not update to show annotations placed on the page (they only show the base PDF).

---

## 9. Delete Page

**How it works**: Click **×** on a thumbnail. Removes the page and all its annotations. Minimum 1 page enforced. Fully undoable (restores page and annotations at original index).

**Test steps**:
1. Load a 2-page PDF.
2. Click **×** on page 1 thumbnail → verify page is removed, page 2 becomes page 1.
3. Press **Ctrl+Z** → verify the deleted page is restored.
4. With only 1 page remaining, click **×** → verify a toast appears ("Cannot delete the only page") and nothing is deleted.

**Known bugs**: None.

---

## 10. Page Rotation

**How it works**: Click **↺ Rotate CCW** or **↻ Rotate CW** on a thumbnail. Rotates by ±90°. Compounded with source PDF intrinsic rotation. Thumbnail cache invalidated. Toast warns if annotations exist. Undoable.

**Test steps**:
1. Load any PDF, click **↺** on the current page thumbnail.
2. Verify the page rotates 90° CCW in the canvas.
3. Verify the thumbnail updates.
4. Add a text annotation, then rotate → verify the toast warning appears.
5. Press **Ctrl+Z** → verify rotation is undone.
6. Rotate 4× → verify page returns to original orientation.

**Known bugs**: **BUG-01 (P1)** — Element position math is correct after `fb87e8b` (`_transformPoint` fix). However, the element *content* is not visually rotated — no CSS `transform: rotate()` is applied to the element div. A text element that was 200×30 becomes 30×200 (bounding box swaps correctly) but the text still renders horizontally, wrapping into a narrow column. Fix: add `rotation` field to element data model + apply `transform: rotate(Ndeg)` in `renderElements()` + handle in export path.

---

## 11. Page Reorder

**How it works**: Drag a thumbnail and drop it on another thumbnail to swap page order. Recorded as `ReorderPagesCmd` with before/after ID arrays. Fully undoable.

**Test steps**:
1. Load a 3-page PDF.
2. Drag thumbnail 3 and drop it before thumbnail 1 → verify pages reorder.
3. Verify the canvas shows the new page 1.
4. Press **Ctrl+Z** → verify the original order is restored.

**Known bugs**: ⚠ Unverified by automation (2026-06-14). Thumbnails have `ondragstart` handlers, but
neither Playwright `dragTo` nor a manual HTML5 DnD sequence reordered pages — Playwright cannot reliably
drive native HTML5 drag-and-drop, so this needs **manual** confirmation (THUMB-DND in `KNOWN_ISSUES.md`).

---

## 12. Element Controls (all annotations)

**How it works**: Every placed element (text, signature, image, highlight, comment, redaction, shape) supports:
- **Move**: drag the element body.
- **Resize**: drag bottom-right resize handle (min 50×20 px).
- **Delete**: click **×** control button, or press `Delete`/`Backspace` when selected.
- **Select**: click element; click canvas background to deselect.
- **Nudge**: Arrow keys move ±1 px; `Shift+Arrow` moves ±10 px.

**Test steps**:
1. Add any annotation (e.g. text).
2. Click it → verify it gets a selection border and control buttons.
3. Drag it to a new position → verify it moves.
4. Drag the resize handle → verify it resizes.
5. Click **×** → verify it's deleted.
6. Add another annotation, select it, press `Delete` → verify deleted.
7. Add an annotation, select it, press `Arrow Right` 5× → verify it moves 5 px right.
8. Press `Shift+Arrow Up` → verify it moves 10 px up.

**Known bugs**: None.

---

## 13. Text Tool + Formatting

**How it works**: Activate with **T Text** button or `T` key. Click anywhere on canvas to place a text box centered on click. Type inline. Formatting toolbar becomes active when text element is selected:

| Property | Control | Values |
|----------|---------|--------|
| Font family | Dropdown | Arial, Helvetica, Times New Roman, Courier New |
| Font size | Spinner + A−/A+ | 8–72 px |
| Bold | **B** button | toggle |
| Italic | **I** button | toggle |
| Color | Color picker (native) | any hex |

Empty text elements are removed automatically on deselect. Text changes debounced 500ms into undo history. Multi-line text supported (press Enter in the text box).

**Test steps**:
1. Click **T Text** or press `T` → verify cursor becomes crosshair, mode badge shows "+ TEXT".
2. Click on the PDF → verify a text box appears, focused and ready to type.
3. Type "Hello World" → verify text appears in the box.
4. Click outside → verify text element is placed and deselected.
5. Click the text element to select → verify formatting toolbar activates.
6. Change font to "Times New Roman" → verify font updates live.
7. Click **B** → verify text becomes bold. Click again → verify bold removed.
8. Click **I** → verify italic. Change font size to 24 → verify.
9. Click the color picker → select a color → verify text color changes live.
10. Press `T` again → verify mode toggles off (returns to SELECT).
11. Place a text element, don't type anything, click away → verify empty element is removed.
12. Place text, type "line1\nline2" (press Enter) → verify two lines render.

**Export check**: Download PDF, verify text appears in correct position with correct styling.

**Known bugs**: None.

---

## 14. Arrow Shape

**How it works**: Activate with **→ Arrow** button or `A` key. Click-drag from start to end point. A preview arrow is shown during drag. On release, arrow is placed with arrowhead at the endpoint. Minimum 5×5 px bounding box required. Properties: stroke color + line width from toolbar row 2.

**Test steps**:
1. Click **→** or press `A` → verify mode badge shows "→ ARROW".
2. Click-drag diagonally on the PDF → verify an arrow appears with arrowhead.
3. Select the arrow → verify color/width controls activate in toolbar row 2.
4. Change stroke color to blue → verify the arrow updates.
5. Make a tiny gesture (< 5 px) → verify it's discarded (no arrow placed).
6. Press `A` again → verify mode toggles off.

**Export check**: Arrow renders as 3 lines (shaft + 2 head lines) in the exported PDF.

**Known bugs**: None.

---

## 15. Rectangle Shape

**How it works**: Activate with **□ Rect** button or `R` key. Click-drag to define the bounding box. Preview shown during drag. Minimum 5×5 px. Properties: stroke color + line width.

**Test steps**:
1. Click **□** or press `R` → verify mode badge shows "□ RECT".
2. Click-drag on the PDF → verify a rectangle outline appears.
3. Select it → change stroke color → verify it updates.
4. Change line width to 5 → verify thicker border.

**Export check**: Renders as `drawRectangle` (outline only, no fill) in PDF.

**Known bugs**: None.

---

## 16. Ellipse Shape

**How it works**: Activate with **○ Circle** button or `C` key. Click-drag to define bounding ellipse. Preview during drag. Minimum 5×5 px. Properties: stroke color + line width.

**Test steps**:
1. Click **○** or press `C` → verify mode badge shows "○ CIRCLE".
2. Click-drag on the PDF → verify an ellipse appears.
3. Drag a perfect square region → verify it creates a circle.

**Export check**: Renders as `drawEllipse` in PDF.

**Known bugs**: None.

---

## 17. Freehand Draw

**How it works**: Activate with **✏ Draw** button, `D` key, or `F` key. Hold and draw freely; points sampled every 3 px. Path glows while drawing. A **Done** pill appears at the bottom center to exit the mode (or press `Escape`). Properties: stroke color + line width.

> **Architecture note**: Freehand strokes are stored in the **ink layer canvas** (`inkLayer._strokes` — a `Map<pageId, InkStroke[]>`), NOT in `app.elements`. They are rendered on a dedicated `<canvas>` overlay per page. This means they are **canvas-only** — they cannot be individually selected, moved, or resized after drawing. To erase them, use the Eraser tool. To change fill color of an existing stroke, use the Fill Bucket tool.

**Test steps**:
1. Click **✏** or press `D` → verify mode badge shows "✏ DRAW".
2. Verify a **Done** pill appears at the bottom center of the screen.
3. Draw a signature-like stroke → verify it appears as a freehand path on the canvas.
4. Draw a second stroke → verify it appears as a separate independent path.
5. Click **Done** → verify returns to SELECT mode, pill disappears.
6. Press `F` → verify it also activates freehand mode.

**Export check**: Renders as an SVG-derived polyline path embedded in the PDF.

**Known bugs / by design**: Individual ink strokes are canvas-only — not individually selectable, moveable, or undoable stroke-by-stroke. `Ctrl+Z` undoes the most recent stroke batch, not one stroke at a time.

---

## 18. Eraser Tool

**How it works**: Activate with **⌫ Erase** button or `E` key. Draw a stroke over the freehand canvas ink to erase it. The eraser adds "erase" type strokes to the ink layer, which are rendered as white overlays masking the underlying freehand ink. A dashed red preview stroke is shown during drawing. Fully undoable.

> **Scope**: The eraser only affects **freehand canvas ink strokes** (`inkLayer`). It does **not** delete annotation element overlays (text boxes, shapes, images, comments, highlights, etc.). To remove those, select and press `Delete`.

**Test steps**:
1. Draw 2 freehand strokes on the canvas.
2. Click **⌫ Erase** or press `E` → verify mode badge shows "⌫ ERASE".
3. Draw the eraser across one freehand stroke → verify that portion is erased (covered in white).
4. Press **Ctrl+Z** → verify the erased portion is restored.
5. Press `E` again → verify eraser mode toggles off (or press `Escape`).
6. Try drawing the eraser over a text box or shape element → verify they are **not** deleted (eraser has no effect on them).

**Known bugs / by design**: Eraser is canvas-only — does not delete annotation element divs. To delete a shape/text/image element, use the `Delete` key while it is selected.

---

## 19. Signature

**How it works**: Activate with **✍ Sign** button or `S` key. Opens a modal with a canvas pad. Draw signature with mouse or touch. Set line width (slider) and color (color picker). Click **Save** → modal closes, cursor enters placement mode. Click on PDF to place the signature. Reusable: the same signature can be placed multiple times. Click **Cancel** or press `Escape` to abort.

**Test steps**:
1. Click **✍ Sign** or press `S` → verify a modal appears with a drawing canvas.
2. Draw a signature on the canvas pad.
3. Adjust line width slider → verify stroke weight changes.
4. Change signature color → verify color changes.
5. Click **Clear** → verify the canvas is cleared.
6. Draw again, click **Save** → verify modal closes, mode badge shows "✍ SIGN".
7. Click on the PDF → verify signature image is placed.
8. Resize the signature by dragging the resize handle.
9. Click **✍ Sign** again (with existing signature) → verify modal opens for new signature.
10. Open modal, draw nothing, click **Cancel** → verify modal closes without placing anything.

**Export check**: Renders as embedded PNG image in the PDF.

**Known bugs**: Signature reuse — after placing one, re-clicking the button always opens the modal (can't place same signature twice without redrawing). This is by design.

---

## 20. Image Overlay

**How it works**: Activate with **🖼 Image** button or `I` key. System file picker opens. Accepts any image type (PNG, JPEG, GIF, WebP, etc.). After file selection: toast appears, click PDF canvas to place at 200×150 px default size. Resize via handle.

**Test steps**:
1. Click **🖼 Image** or press `I` → verify file picker opens.
2. Select a PNG image → verify a toast: "Click on the PDF to place the image".
3. Click on the PDF → verify the image appears at 200×150 px.
4. Drag the resize handle → verify the image resizes.
5. Select the image, press `Delete` → verify it's removed.
6. Try `I` key → verify file picker opens directly.

**Export check**: JPEG images embedded as JPEG; PNG/other re-encoded to PNG via canvas.

**Known bugs**: None.

---

## 21. Highlight

**How it works**: Activate with **🖊 Highlight** button or `H` key. Click-drag to draw a highlight rectangle. Semi-transparent yellow overlay shown during drag. Default color `#FFFF00`, opacity 0.3.

> ⚠️ **Color parse bug**: `highlightElement.ts:20-22` — `parseInt(hex, 16) || fallback`. Any RGB channel with value `0` is replaced by fallback. Example: red `#FF0000` becomes orange `rgba(255,220,0,0.3)`. Only the default yellow is unaffected.

**Test steps**:
1. Click **🖊 Highlight** or press `H` → verify mode badge shows "🖊 HIGHLIGHT".
2. Click-drag over a word in the PDF → verify a semi-transparent yellow box appears.
3. Place multiple highlights → verify they stack correctly.
4. Select a highlight, press `Delete` → verify removed.
5. *(Color bug check)*: Open `highlightElement.ts` and manually change default to `#FF0000` → verify it renders orange instead of red (confirms bug).

**Export check**: Renders as semi-transparent filled rectangle in PDF.

**Known bugs**: Color parse bug (`|| fallback` replaces 0-valued channels). Only affects non-yellow colors since color is not user-configurable in the UI currently.

---

## 22. Comment / Sticky Note

**How it works**: Activate with **💬 Comment** button or `N` key. Click anywhere on the canvas → places a 200×120 px pastel-yellow sticky note. Type directly into the note. Resize via handle. Background color fixed at `#FFFDE7`.

**Test steps**:
1. Click **💬 Comment** → verify mode badge shows "💬 COMMENT".
2. Click on the PDF → verify a yellow sticky note appears.
3. Type some text in it → verify text appears.
4. Resize the note by dragging the handle.
5. Click outside the note → verify it deselects.
6. Reselect → verify text is preserved.

**Export check**: Renders as a filled yellow rectangle with Helvetica text (first 200 chars). Background color preserved.

**Known bugs**: Double-append risk: if `CommentElement.createDom()` is called without clearing existing DOM, elements can be duplicated in the container. (Historical bug, may be fixed.)

---

## 23. Redaction

**How it works**: Activate with **⬛ Redact** button. Click-drag to define the redaction area. Renders as a solid black box with a dashed red border (dashes hidden when not selected). Z-index 15 — above all other elements.

**Export — TRUE RASTERIZATION**: When a page contains ANY redaction element, the entire page is rasterized via pdf.js at 2× scale before embedding. Black boxes are painted onto the canvas pixels. This permanently destroys the text layer for that page — redacted content **cannot** be extracted from the exported PDF.

**Test steps**:
1. Click **⬛ Redact** → verify mode badge shows "⬛ REDACT".
2. Click-drag over a word → verify a solid black box covers it.
3. Verify the box has a dashed red border when selected, solid when deselected.
4. Download the PDF → open in any PDF viewer → try to select/copy text under the black box → verify it's not selectable.
5. Try `pdftotext` or similar tool on the exported PDF → verify redacted text does not appear.

**Known bugs**: None (P0 security issue from prior audit is now fixed by rasterization).

---

## 24. Text Search / Find

**How it works**: Activate with **🔍** button or `Ctrl+F`. Find bar appears above the canvas. Type a query (case-insensitive, live search with 300ms debounce). Match count shown. Matches highlighted as semi-transparent yellow overlays. Navigate with **◀ Prev** / **▶ Next** or Enter / Shift+Enter. **Add Highlight** creates a permanent highlight element at the current match. **✕ Close** clears overlays. Search is page-scoped (only current page).

**Test steps**:
1. Load a text-based PDF.
2. Click **🔍** or press `Ctrl+F` → verify find bar appears.
3. Type a word that appears in the PDF → verify yellow match overlays appear and counter shows "1 / N".
4. Click **▶ Next** → verify next match is highlighted differently.
5. Press Enter → verify same as Next. Press Shift+Enter → verify Previous.
6. Click **Add Highlight** → verify a permanent highlight element is created at the match position.
7. Press **Ctrl+Z** → verify the added highlight is removed.
8. Navigate to a different page → verify overlays are cleared.
9. Press **Escape** → verify find bar closes.
10. Type a word that doesn't exist → verify "0 / 0" shown.
11. Zoom in/out while find bar is open with a query → verify match overlays reposition correctly.

**Known bugs**: Search is current-page only. Navigating away resets the search.

---

## 25. Form Field Detection & Fill

**How it works**: Automatic on PDF load. If the PDF has AcroForm text fields (`Tx` type), they are detected via `page.getAnnotations()` and rendered as transparent `<input>` overlays matching the PDF field rectangles. Values are tracked per source PDF. Only text fields (`Tx`) supported — checkboxes/radios/dropdowns are silently ignored (with a one-time toast).

**Test steps** (requires a PDF with form fields):
1. Load a fillable PDF → verify input overlays appear over form fields.
2. Click a field → type some text → verify it accepts input.
3. Navigate to another page and back → verify typed values are preserved.
4. Download the PDF → open in a viewer → verify form values are baked in (flattened).
5. If the PDF has checkboxes/dropdowns → verify a toast appears mentioning unsupported fields.

**Known bugs**: Only `Tx` (text) fields supported. Checkboxes, radio buttons, and select lists are not rendered.

---

## 26. Watermark

**How it works**: Click **≋ Watermark** button. Modal with: enabled checkbox, text input, color picker, font size slider (20–120), opacity slider (10–100%), angle slider (−90°–90°). Live preview in the modal. Click **Apply** → watermark settings saved. Toast confirms.

**Export behavior**: Watermark is drawn as a **tiled repeating pattern** across every page (not just centered once). Uses Helvetica font. Does NOT appear on the canvas — export-only.

**Test steps**:
1. Click **≋ Watermark** → verify modal opens.
2. Check the **Enabled** checkbox.
3. Type "CONFIDENTIAL" in the text field → verify preview updates.
4. Adjust opacity slider → verify preview opacity changes.
5. Adjust angle slider → verify preview rotation changes.
6. Click **Apply** → verify toast: "Watermark enabled".
7. Download the PDF → verify watermark appears tiled across the page.
8. Reopen modal → uncheck Enabled → Apply → verify toast: "Watermark disabled".
9. Download again → verify watermark is gone.
10. Close modal via **Cancel** or clicking the backdrop → verify no changes applied.
11. Press **Escape** while modal is open → verify it closes.

**Known bugs**: None.

---

## 27. Zoom & View

**How it works**:

| Control | Action |
|---------|--------|
| **−** | Zoom out by 0.1 |
| **+** | Zoom in by 0.1 |
| **⊡ Fit** | Fit to container width |
| `Ctrl+Scroll` | Zoom in/out by 0.05 per tick |
| Pinch (touch) | Two-finger pinch to zoom |

Zoom range: 0.25× – 3.0×. Display shows integer percentage. On zoom: full page re-render, element positions recalculated, thumbnail cache invalidated, active search results repositioned.

**Test steps**:
1. Click **+** 3× → verify zoom increases by 30%, display updates.
2. Click **−** 3× → verify zoom decreases.
3. Click **⊡ Fit** → verify zoom resets to fit container width.
4. Hold `Ctrl` and scroll up on the canvas → verify zoom in.
5. Hold `Ctrl` and scroll down → verify zoom out.
6. Zoom to minimum (25%) then click **−** → verify clamped at 25%.
7. Zoom to maximum (300%) then click **+** → verify clamped at 300%.
8. Add annotations, zoom in → verify annotations scale correctly with the page.

**Known bugs**: None.

---

## 28. Undo / Redo

**How it works**: **↩ Undo** / **↪ Redo** buttons, or `Ctrl+Z` / `Ctrl+Y` / `Ctrl+Shift+Z`. History capacity: 50 commands. Buttons disabled when respective stack is empty.

**Command types**:
| Command | Undo behaviour |
|---------|----------------|
| `AddElementCmd` | Remove element |
| `RemoveElementCmd` | Re-insert element at original index |
| `MoveResizeCmd` | Restore position/size/style before gesture |
| `TextEditCmd` | Restore previous text (500ms debounce) |
| `ClearAllCmd` | Restore all cleared elements |
| `AddPagesCmd` | Remove added pages |
| `DeletePageCmd` | Re-insert page + annotations |
| `ReorderPagesCmd` | Restore original page order |
| `RotatePageCmd` | Restore previous rotation |
| `BulkDeleteCmd` | Restore batch-deleted elements (eraser) |
| `SplitStrokeCmd` | Restore original freehand + remove splits (eraser) |
| `MacroCmd` | Atomically undo a group of commands (eraser uses this) |

**Test steps**:
1. Add 3 annotations → press `Ctrl+Z` 3× → verify all 3 are removed.
2. Press `Ctrl+Y` → verify the last annotation is restored.
3. Delete a page → press `Ctrl+Z` → verify page is restored with annotations.
4. Reorder pages → press `Ctrl+Z` → verify original order.
5. Type text in a text element → wait 500ms → press `Ctrl+Z` → verify text reverts.
6. With empty undo stack → verify **↩ Undo** button is disabled.
7. After an undo → press `Ctrl+Shift+Z` → verify redo works.

**Known bugs**: None.

---

## 29. Session Persistence & Autosave

**How it works**: Autosave to IndexedDB (`pdf-editor` db v2, `state` store, `current` key) after every edit (debounced 800ms). Saves: elements, page list, page order, watermark settings, current page index, source PDF bytes, form field values. On page load, if saved state exists, it's restored silently with toast "Session restored". Click **✕ Clear Save** to wipe the saved session.

**Test steps**:
1. Load a PDF, add some annotations, wait 1 second for autosave.
2. Close the browser tab / hard-refresh the page.
3. Verify the app restores the previous session with a "Session restored" toast.
4. Verify all annotations, page structure, and zoom are preserved.
5. Click **✕ Clear Save** → verify toast "Saved session cleared".
6. Refresh → verify the app starts blank (no session restored).
7. Open in a private/incognito window → load a PDF → verify the app works (no error shown even though IDB is unavailable).

**Known bugs**: IDB unavailable in private browsing — silently degrades (no save). Storage quota exceeded shows a specific toast warning.

---

## 30. Clear All Annotations

**How it works**: Click **✕ Clear All** button. If there are any annotations on the current document, removes ALL of them across all pages. Recorded as `ClearAllCmd` → fully undoable. Toast: "All annotations cleared — Ctrl+Z to undo". Does nothing if there are no annotations.

**Test steps**:
1. Add annotations on multiple pages.
2. Click **✕ Clear All** → verify all annotations are removed, toast appears.
3. Press `Ctrl+Z` → verify all annotations are restored.
4. With no annotations, click **✕ Clear All** → verify nothing happens (no toast, no change).

**Known bugs**: None.

---

## 31. Keyboard Shortcuts

**How it works**: Global `keydown` listener. Ignored when focus is on an input/textarea/select. `Ctrl`/`Meta` shortcuts handled separately.

| Key | Action |
|-----|--------|
| `T` | Toggle Text mode |
| `S` | Toggle Signature mode (opens modal) |
| `I` | Open Image file picker |
| `A` | Toggle Arrow mode |
| `R` | Toggle Rectangle mode |
| `C` | Toggle Circle/Ellipse mode |
| `B` | Toggle Fill Bucket mode |
| `D` or `F` | Toggle Freehand Draw mode |
| `H` | Toggle Highlight mode |
| `N` | Toggle Comment mode |
| `E` | Toggle Eraser mode |
| `K` | Toggle Redact mode |
| `W` | Open Watermark modal |
| `X` | Toggle Edit Text mode |
| `Q` | Open QR/barcode modal |
| `?` | Toggle Help modal |
| `Escape` | Return to SELECT mode; close modals/find bar |
| `Delete` / `Backspace` | Delete selected element |
| `Arrow keys` | Nudge selected element ±1 px |
| `Shift+Arrow` | Nudge selected element ±10 px |
| `Ctrl+Z` | Undo |
| `Ctrl+Y` / `Ctrl+Shift+Z` | Redo |
| `Ctrl+C` | Copy selected annotation element |
| `Ctrl+V` | Paste annotation element |
| `Ctrl+F` | Open Find bar |
| `Ctrl+→` | Next page |
| `Ctrl+←` | Previous page |
| `Enter` (find bar) | Next match |
| `Shift+Enter` (find bar) | Previous match |
| `Escape` (find bar) | Close find bar |

**Test steps**:
1. Load a PDF. Press `T` → verify text mode activates. Press `T` again → verify returns to SELECT.
2. Press `A`, `R`, `C`, `D`, `H`, `E`, `B`, `K`, `X` → verify each activates its mode.
3. Press `F` → verify freehand mode activates (alias for `D`).
4. Press `W` → verify watermark modal opens.
5. Press `Q` → verify QR/barcode modal opens.
6. Press `Escape` → verify returns to SELECT from any mode; modals close.
7. Add an annotation, select it, press `Delete` → verify deleted.
8. Select an element, press arrow keys → verify nudges 1px. `Shift+Arrow` → verify 10px.
9. Press `Ctrl+Z` / `Ctrl+Y` → verify undo/redo.
10. Press `Ctrl+F` → verify find bar opens. Press `Escape` → verify it closes.
11. Press `Ctrl+→` / `Ctrl+←` → verify page navigation.
12. Press `?` → verify help modal opens/closes.

**Known bugs**: None.

---

## 32. Help Modal

**How it works**: Click **?** button in toolbar or press `?` key. Shows a table of keyboard shortcuts. Close by clicking **×**, pressing `Escape`, or clicking the backdrop.

**Test steps**:
1. Click **?** → verify a modal appears with a shortcuts table.
2. Press `Escape` → verify modal closes.
3. Click the backdrop (outside the white box) → verify modal closes.
4. Check the shortcuts table matches what actually works.

**Known bugs**: None. All 25+ working shortcuts are listed in the help modal (verified in EN, FR, AR). The `B` (fill bucket) row was missing prior to the 2026-06-11 QA audit and has since been added.

---

## 33. Toast Notifications

**How it works**: Bottom-right corner (top on mobile). Dark background, white text. 3 second default duration (configurable per toast). Stacks are NOT supported — a new toast immediately replaces any existing one.

**Test steps**:
1. Perform any action that triggers a toast (upload file, enable watermark, clear all, etc.).
2. Verify the toast appears, is readable, and disappears after ~3 seconds.
3. Trigger two quick actions → verify only the second toast shows (first is replaced).
4. On mobile (or narrow window): verify toast appears at top, not bottom.

**Known bugs**: No stacking — if two toasts fire in quick succession, the first is lost.

---

## 34. Mode Badge

**How it works**: A badge in the top-right area of toolbar row 1 shows the current active mode. Grey when in SELECT mode, blue when any tool mode is active.

| Mode | Badge text |
|------|-----------|
| select | `SELECT` (grey) |
| addText | `+ TEXT` (blue) |
| addSignature | `✍ SIGN` (blue) |
| addImage | `🖼 IMAGE` (blue) |
| drawArrow | `→ ARROW` (blue) |
| drawRect | `□ RECT` (blue) |
| drawEllipse | `○ CIRCLE` (blue) |
| drawFreehand | `✏ DRAW` (blue) |
| drawHighlight | `🖊 HIGHLIGHT` (blue) |
| addComment | `💬 COMMENT` (blue) |
| drawRedaction | `⬛ REDACT` (blue) |
| drawErase | `⌫ ERASE` (blue) |
| editText | `✎ EDIT TEXT` (blue) |
| addCode | `⊡ CODE` (blue) |
| fillBucket | `🪣 FILL` (blue) |

**Test steps**:
1. Verify badge shows "SELECT" in grey on load.
2. Activate each tool mode → verify badge text and color update correctly.
3. Press `Escape` → verify badge returns to "SELECT" in grey.

**Known bugs**: None.

---

## 35. Done Pill (Freehand exit)

**How it works**: When Freehand mode is active, a **Done** pill button appears at the bottom center of the screen (above the soft keyboard on mobile). Clicking it exits freehand mode and returns to SELECT. Also exits via `Escape`.

**Test steps**:
1. Activate freehand mode (`D` key or button).
2. Verify the **Done** pill appears at the bottom center.
3. Draw a stroke.
4. Click **Done** → verify mode returns to SELECT, pill disappears.
5. Activate freehand again → press `Escape` → verify pill disappears and mode returns to SELECT.

**Known bugs**: None.

---

## 36. Mobile / Touch Support

**How it works**:
- `touch-action: none` during draw modes to prevent scroll interference.
- 5px movement threshold before committing to a drag (prevents accidental drags on tap).
- Pinch zoom: two-finger pinch handled in DrawingHandler; CSS transform applied during gesture, `applyZoom` called on finger lift.
- Minimum zoom 0.65× enforced on mobile.
- Touch targets are 40px minimum on mobile.
- Toast moves to top of screen on mobile (keyboard covers bottom).
- First/last page buttons hidden on mobile to save space.

**Test steps** (requires mobile device or browser DevTools mobile emulation):
1. Open app in mobile DevTools (e.g. Chrome → F12 → Toggle Device Toolbar, select a phone).
2. Verify layout wraps correctly, toolbar reorganizes.
3. Tap **Upload PDF** → upload a PDF → verify it loads.
4. Pinch to zoom → verify zoom applies on finger lift.
5. Tap a tool button → draw/place an annotation with a finger.
6. Tap an existing annotation → verify it selects.
7. Drag the annotation → verify 5px threshold before move starts.
8. Verify the **Done** pill for freehand is reachable.

**Known bugs**: Pinch zoom centroid calculation may be slightly off (zoom may not anchor to the pinch center precisely).

---

## 37. PWA / Offline Support

**How it works**: `vite-plugin-pwa` with `autoUpdate`. Service worker (Workbox `generateSW`) precaches all JS/CSS/HTML/SVG. Large chunks (pdf.js worker, pdf-lib) use `CacheFirst` with 30-day TTL. Max precache file size: 6 MB. Manifest: name "PDFturbo", `standalone` display, blue theme. `vite.config.ts` sets `manifestFilename: 'manifest.json'` so the generated filename matches the `<link>` tag in `index.html`.

**Test steps** (requires `npm run build` + serving the built output):
1. Build: `npm run build` → serve `dist/` folder.
2. Open in Chrome → DevTools → Application → Service Workers → verify SW is registered.
3. DevTools → Application → Manifest → verify app is installable.
4. Go offline (DevTools → Network → Offline) → reload → verify app still loads.
5. Check for the PWA install banner in the browser URL bar.

**Known bugs**: None. (H-14 manifest URL collision was fixed by `manifestFilename: 'manifest.json'` in `vite.config.ts`.)

---

## Summary

| Category | Count |
|----------|-------|
| File I/O | 6 |
| Page Management | 5 |
| Annotation Tools | 15 |
| Search & Forms | 2 |
| Document Settings | 3 |
| Session & State | 2 |
| UX & Misc | 7 |
| **Total** | **40** |

### Known bugs (pre-existing)
| # | Severity | Description |
|---|----------|-------------|
| B1 | P1 | Highlight color parse: `|| fallback` zeroes out channels → non-yellow colors render wrong |
| B2 | P2 | Eraser is canvas-only — does not delete annotation element overlays (text, shapes, images); must use `Delete` key for those |
| ~~B3~~ | ~~P2~~ | ~~Help modal missing `E` (eraser), `F` (freehand alt), `B` (fill bucket) shortcuts~~ **Fixed** — all appear in locale files under `modal.help.actions` |
| ~~B4~~ | ~~P2~~ | ~~PWA manifest URL collision (H-14) → install prompt fails in production~~ **Fixed** — `manifestFilename: 'manifest.json'` in `vite.config.ts` |
| B5 | P3 | Annotations don't reposition after page rotation |
| B6 | P3 | Thumbnails don't reflect placed annotations |
| B7 | P3 | Toast notifications don't stack (second replaces first) |
| B8 | P3 | Signature pad: can't reuse same signature without redrawing |

---

## 38. Edit Text Tool

**How it works** (updated 2026-06-14): Activate with the **✎ Edit Text** button (mode badge "✎ EDIT TEXT").
Click any word in the PDF. The handler now tries **two paths**:

1. **True content-stream edit (preferred):** `findTextOpAt` (`contentStreamEditor.ts`) matches the
   clicked pdf.js item to a content-stream show-op within `TRUE_EDIT_TOLERANCE` (3 pt), with a
   multi-candidate fallback (50 pt radius) for sub-word items. On a match it opens a floating
   `input.true-edit-input` pre-filled with the original text, font, size, bold/italic. **Enter applies**
   (genuinely rewrites the PDF text via `ReplaceSourcePdfBytesCmd` — no overlay), **empty deletes**,
   **Esc cancels**. Undoable.
2. **Overlay fallback:** when no content-stream match is found (e.g. Form-XObject / Type3 / vertical /
   invisible-OCR text), it places a background-colored `RedactionElement` over the original plus an
   editable `TextElement` on top (a `<textarea>` where Enter inserts a newline; commit by clicking away).
   Non-destructive overlay, wrapped in a single `MacroCmd`.

**Edit-existing-only (Sprint 3, 2026-06-15):** a click on an **empty** area does NOT create a box (it
re-shows the mode hint). To **add new text**, use the draw-to-place **Add Text** tool (drag to size, like
a shape; it auto-switches to Select after placing). This reverts the earlier ISSUE-5 unification, whose
blank-drop trapped users in a non-interactive mode.

**Verified (2026-06-14):** body-text true-edits are consistent across the live view, exported PDF, and
exported DOCX (e.g. `"…C#, Bash"`→`"…C#, Go"`; `"Symfony, Angular, API Platform…"`→`"…NestJS, Spring Boot"`).
Undo restores the original cleanly.

**Test steps**:
1. Load a text-based PDF (must have a text layer — scanned images won't work).
2. Click **✎ Edit Text** → verify mode badge shows "✎ EDIT TEXT".
3. Click on a word in the PDF → verify a text box appears over it, pre-filled with the word's text.
4. Edit the text → verify the new text replaces the original visually.
5. Press **Ctrl+Z** → verify both the cover element and the text element are removed.
6. Click on whitespace (no text nearby) → verify a **new editable text box** is created there
   (unified text mode — ISSUE-5 fix; previously a no-op).
7. Download the PDF → verify the edited word appears correctly in the export.

**Known bugs / limitations**:
- **ISSUE-2 (P1, data loss) — ✅ FIXED 2026-06-14.** Editing a heading drawn in a subset/embedded font
  used to delete the original and lose the replacement (subset byte-swap → wrong/blank glyphs; the
  fallback redraw was orphaned). Now: the literal byte-swap is gated by `isByteSwapUnsafeFont`, the
  standard-font fallback redraw is emitted as in-stream operators (renders + stays extractable), and
  XObject targets refuse before blanking. Verified on the real CV (ink 4878→5499, text extractable) and
  guarded by `tests/browser/issue2-true-edit.browser.test.ts`. Out-of-subset characters fall back to a
  standard font; in-subset edits keep the original font via glyph reuse.
- Works only on PDFs with a text layer (pdf.js extraction required). Scanned/image-only PDFs have no text
  layer and will not respond to clicks.
- Whether a click true-edits vs. falls back to overlay depends on the pdf.js item ↔ content-stream
  position match (3 pt tolerance + 50 pt multi-candidate fallback).

---

## 39. Fill Bucket Tool

**How it works**: Activate with the **🪣 Fill** toolbar button or `B` key. Click any shape element or freehand ink stroke to fill it with the current **fill color** (the color swatch labeled "Fill" in the formatting toolbar — separate from the stroke color). A single click performs a hit test and applies a `FillColorCmd` (undo-able).

**Two distinct color pickers**:
- **Stroke color** (`#color` input) — outline/line color for shapes and ink strokes
- **Fill color** (`#fillColor` input / "Fill" label in toolbar row 2) — used exclusively by the fill bucket

**Hit testing logic**:
1. **Shape elements** (`app.elements`): bounding-box test — clicks within the element's bounding box trigger a fill
2. **Freehand ink strokes** (`inkLayer._strokes`): polyline proximity test — clicks within 8 px of any point on the stroke trigger a fill
3. **No-fill state**: if the "Fill" color picker has `_noFill` active (transparent fill), `effectiveFillColor` returns `undefined` and the fill operation is a no-op

**Test steps**:
1. Draw a rectangle shape → activate Fill Bucket (`B`) → set fill color to red → click inside the rectangle → verify it fills red.
2. Press `Ctrl+Z` → verify the fill is undone.
3. Draw a freehand stroke → with fill bucket active, click near the stroke → verify stroke fill color changes.
4. Set the "Fill" swatch to transparent (no-fill) → click a shape → verify nothing changes (no-op).
5. Verify mode badge shows "🪣 FILL" when active.
6. Verify tooltip on the toolbar button says "Fill shape (B)".
7. Verify mode hint toast appears explaining fill bucket behavior.
8. Press `Escape` → verify returns to SELECT mode.
9. Switch language to FR → verify badge shows "🪣 REMPLIR", hint toast is in French.
10. Switch to AR → verify badge shows "🪣 تعبئة", hint toast is in Arabic (RTL).

**Export check**: Fill color is written to the exported PDF. Shape elements use `pdf-lib`'s fill color property; ink strokes apply the fill to the rendered polyline.

**Known bugs**: None. Fill bucket on ink strokes uses polyline-proximity hit testing (fixed from bounding-box during 2026-06-10 development).

---

## 40. QR Code / Barcode Tool

**How it works**: Activate with the **⊡ Code** toolbar button or `Q` key (opens the modal directly). A modal allows configuration before placement:

- **Format**: QR code, Code 128, Code 39, EAN-13, EAN-8, UPC, and others
- **Content**: free-text input (URL, text, number)
- **Styled QR** toggle: enables custom dot style, dot color, background color, and optional logo overlay
- **Error correction** (QR only): L / M / Q / H
- **Show text** (linear barcodes): show human-readable text below barcode
- **Live preview**: updates as content is typed

After configuring, click **Place on PDF →** → click-drag on the canvas to define the placement area and size. The code is rendered as an image element. Supports **Edit** (reopen modal from a placed code element) and **Undo** (removes the placed element).

**Test steps**:
1. Press `Q` → verify the QR/barcode modal opens.
2. Enter a URL → verify a QR code preview appears.
3. Click **Place on PDF →** → drag on the canvas → verify the QR code is placed.
4. Press `Ctrl+Z` → verify the placed code is removed.
5. Select a placed code element → verify a resize handle appears.
6. Double-click or use the edit control on a placed code → verify the modal reopens for editing.
7. Switch format to "Code 128" → enter a number → verify a linear barcode preview appears.
8. Enable "Styled QR" → change dot color → verify the preview updates.
9. Add a logo image → verify logo appears centered in the QR preview.
10. Close the modal (Escape / Cancel) → verify no element is placed.
11. Verify mode badge shows "⊡ CODE" when code placement is active.

**Export check**: QR codes and barcodes are embedded as rasterized PNG images in the exported PDF.

---

## 41. Export — DOCX / Markdown / TXT (PDF → editable document)

**How it works**: From the **Export options (▾)** flyout, choose **DOCX** (`#exportDocxBtn`), **MD**, or
TXT. The pipeline reconstructs a flow model (lines → paragraphs → headings/styles/RTL/lists/2-column) from
the pdf.js text items (`flowDoc.ts`) and emits the chosen format (`flowDocWriters.ts`; the `docx` npm
package is **dynamically imported** — a ~395 KB lazy chunk). Source-PDF text only — overlay annotations are
NOT exported. Reflects in-place true-edits (edited PDF bytes are the source).

**Usage**:
1. Open a PDF → **Export options (▾)** → **DOCX** / **MD**.
2. The file downloads as `<name>.docx` / `<name>.md`.
3. DOCX includes native heading styles, ordered-list numbering (`w:numPr`), and (when extractable) images.

**Verified working (2026-06-14, across 5 PDFs)**: text extraction is accurate for every text-bearing PDF
(headings, body, key/value rows, FR/RTL). Edited body text is carried into both DOCX and PDF exports.

**Known bugs / limitations**:
- **ISSUE-3 (P1) — ✅ FIXED 2026-06-14.** Images reused across pages land in pdf.js `commonObjs` with a
  `g_` name; extraction read `page.objs` only and silently dropped them. Now resolved from `commonObjs`
  (bitmap typed `CanvasImageSource`; v6 `VideoFrame` handled). Guarded by
  `tests/browser/issue3-docx-images.browser.test.ts`.
- **ISSUE-4 (P2) — ✅ FIXED 2026-06-14.** An image-only PDF now exports a DOCX containing its images;
  only a genuinely empty document shows the "no extractable text" toast (never a silent no-op).
- By design: overlay annotations (added text boxes, shapes, signatures, QR) are not exported to DOCX/MD/TXT
  — only source-PDF text. Lattice tables are not yet reconstructed.

See `KNOWN_ISSUES.md` and `docs/reviews/2026-06-14-qa-sweep-findings.md`.

**Test steps**:
1. Export DOCX from a text PDF → unzip → verify `word/document.xml` has the expected `<w:t>` runs.
2. Export DOCX from a PDF with a `commonObjs` (cross-page reused) image → verify `word/media/` is non-empty (ISSUE-3 fix).
3. Export DOCX from a scanned/image-only PDF → verify a file with the image is produced (ISSUE-4 fix).
4. True-edit a body line → export DOCX and PDF → verify both contain the new text.

**Known bugs**: None.
