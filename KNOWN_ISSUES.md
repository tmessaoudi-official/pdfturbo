# PDFturbo — Known Limitations & Structural Ceilings

PDFturbo runs **entirely in the browser** with no backend and nothing uploaded. That design
choice is the product's core value — and it also sets hard limits in a few places: where a glyph
outline simply isn't present in the file, where the target format can't represent the source, or
where a library/spec doesn't expose the operation.

The items below are **not defects and not on a fix list** — they are the honest edges of a pure
client-side editor. Each notes the "escape hatch" that *would* lift it and the trade-off of taking
it, so the limit is understood rather than mistaken for a bug.

_Last updated: 2026-08-29._

---

## Privacy — data at rest (by design)

To restore your work after a reload, PDFturbo saves the open document — **including the raw PDF
bytes** — in your browser's **IndexedDB**. This data never leaves your device, but it is stored
**unencrypted** like normal browser site data. Use **"Start fresh"** on load, clear site data, or
work in a private/incognito window when editing sensitive documents on a shared machine. See
[`SECURITY.md`](SECURITY.md).

---

## Escape-hatch families (the levers — most ceilings map to one)

| EH | Lever | Unlocks | Trade-off |
|----|-------|---------|-----------|
| **EH-A** | **PDFium-WASM** (page-object text API) | True in-place edit of *any* font incl. subset/CID/Type3 (C1–C4) | Several-MB WASM payload; a 2nd engine beside pdf.js + pdf-lib; build/CI complexity |
| **EH-B** | **HarfBuzz-WASM** shaping + bidi-js (already a dep) | Arabic/complex-script char-level shaping + mixed LTR↔RTL single line + tashkeel (C2, C8, C18, C19) | Another WASM dep; shaping↔ToUnicode tension still limits exact Arabic search (C14) |
| **EH-C** | **Page-as-image** export | DOCX/export pixel-identity (C5) | Destroys editable/selectable/searchable text — defeats the DOCX use-case |
| **EH-D** | **Server-side conversion** (headless LibreOffice / render service) | Best-in-class fidelity (C5), TSA/LTV signing (C17) | **Breaks the no-backend / nothing-uploaded promise** — off the table unless that promise changes |
| **EH-E** | **Whitespace-inference table detection** | **RELEASED for CSV (C13) 2026-08-04**; DOCX (C9) still gated | The confidence gate exists and its load-bearing rule is the multi-column-page discriminator (a table's rows span columns; a two-column page's lines do not). Ruled tables keep priority, so lattice output is unchanged |

## The structural ceilings (C1–C22)

| ID | Ceiling | Why it's structural | Escape hatch |
|----|---------|---------------------|--------------|
| C1 | In-place edit of subset/CID fonts with a **new** glyph | The new character's outline is absent from the embedded subset | EH-A (today: reuse in-subset glyphs, else base-14 redraw or overlay) |
| C2 | Arabic in-place true-edit | Subset CID font + no client-side shaping/bidi | EH-A + EH-B (today: refuses → overlay, which renders correctly) |
| C3 | Type3 / Form-XObject true-edit | Type3 glyphs are CharProcs; XObject text has its own space | EH-A (today: overlay) |
| C4 | `cm` rotation/shear in the Path-3 redraw | Standard-font redraw flattens to an axis-aligned matrix | EH-A (today: translation-only redraw) |
| C5 | PDF→DOCX **pixel-identity** | Fixed-layout → reflowable is lossy by definition | EH-C (kills text) or EH-D. Target is high-fidelity *editable*, not identical |
| C6 | DOCX subset-font **face** | Subset tag strips the family name (~75% face accuracy) | EH-D or font-fingerprinting. Content is exact; only typeface is approximate |
| C7 | DOCX CJK font-face | No universal CJK family; content preserved, face approximate | Word's own fallback renders the codepoints |
| C8 | DOCX char-level bidi / mixed LTR+RTL single line | Word-level reorder only | EH-B |
| C9 | DOCX **borderless** tables | Engine exists (C13) but is NOT wired here, now on MEASURED grounds: a realistic corpus found 2 false positives in 6 prose shapes (side-by-side two-column page; bulleted list). Both are fixed, and the corpus is a permanent guard — but `reconstructPage` REMOVES in-region words from the paragraph flow, so a phantom table mangles prose, and 6 synthetic shapes are not real-file evidence | EH-E + a real-file corpus. Gate tightness is no longer the blocker; corpus breadth is |
| C10 | DOCX **4+** column layout | Recursive XY-cut ships (B6) but is depth-capped; 3 columns work, 4 measured as 3 groups | Deeper recursion / a looser gutter threshold. Corrected 2026-07-31 — this row previously said "Reconstructor is 2-column", which B6 had already made false |
| C11 | DOCX internal GoTo links / sheared images / ICC spot colour | No DOCX representation / no client ICC engine | EH-D. External URL links already work |
| C12 | Markup-annotation flatten | pdf-lib has no generic markup-flatten API | Narrowed 2026-08-29 — this row previously said the raster path "covers the redaction-rasterise case". It did NOT: pdf.js paints annotations *after* the content stream, so a note/stamp/widget over a redaction was repainted on top of the burn and baked in visibly (measured). Covered annotations are now STRIPPED before rasterising, so the redaction case is genuinely closed; what remains is flattening an annotation that is *not* under a redaction |
| ~~C13~~ | ~~Borderless table → CSV~~ | **CLOSED 2026-08-04** — EH-E released for the CSV path (`src/utils/borderlessTable.ts`): columns inferred from global whitespace bands, behind a confidence gate that refuses rather than guesses | — |
| C14 | Arabic searchable-OCR **exact search** | Shaping yields contextual glyphs with incomplete ToUnicode | EH-B + richer ToUnicode. Selectable/screen-reader text already works |
| C15 | OCR recognition **accuracy** | Bounded by the tesseract LSTM model | Cloud OCR (breaks EH-D) or a larger local model |
| C16 | Encryption R6 hash-hardening | `@cantoo/pdf-lib` hardcodes R:5 | Fork/patch. AES-256 R5 is already strong |
| C17 | PAdES / TSA / LTV / CA-trusted signatures | node-forge can't emit ESS signing-cert-v2; TSA/LTV need a backend | Hand-rolled CAdES + EH-D. Valid ISO-32000 `adbe.pkcs7.detached` ships today |
| C18 | RTL text-layer select/copy/search **precision** | pdf.js builds the layer per-glyph, visual-order; highlight is item-level | EH-B. Logical copy/search reconstruction already works |
| C19 | Arabic overlay tashkeel/GPOS micro-positioning | Needs a GPOS shaper; legibility is already fine | EH-B |
| C20 | XFDF Acrobat byte-exactness + rotated-page coords | No Acrobat to verify against | Internal round-trip is the correctness guarantee |
| C21 | Raster ink — no per-stroke edit | Rasterised by design | Use the **vector** freehand tool |
| ~~C22~~ | ~~Flow LAYOUT on a non-zero CropBox origin~~ | **CLOSED 2026-09-02** — the normalisation happens ONCE, at the `_extractFlowDoc` boundary: words, links, rules, images, margins and the position-derived `colorMap` keys are all translated by the CropBox origin, so every consumer sees a single origin-(0,0) frame. The lockstep the row demanded is bought structurally rather than by discipline — `rules`, `vRules`, image CTMs and the colour keys all derive from `walkPageOps`' ctm, so one base-transform argument moves the four together and a partial normalisation of them is unexpressible. Guarded by `tests/browser/cropbox-origin-layout.browser.test.ts` | — |

---

## Deferred / nice-to-have (non-blocking)

- **Arabic locale strings** — reviewed 2026-07-30: all 31 then-unverified keys were validated by a
  native speaker, and that pass changed no value. **That sign-off is no longer blanket.** Twelve
  values have been added or re-worded since and are pending a native pass: `toolbar.exportXlsxTitle`,
  `badge.signRect` (added 2026-08-28 — the mode badge had no string for the e-sign rectangle mode),
  the six `toolbar.cropMargin*` keys, `toast.cropMarginsTooLarge`, and the three re-worded on
  2026-08-05 to match the hide-vs-remove grades (`toolbar.cropTitle`, `toast.modeHint.crop`,
  `toast.redactionPlaced` — single-verb substitutions, the first changes to a reviewed Arabic value
  since the sign-off). **RTL rendering was not part of that review** and is unchanged — see ceilings C18 (select/copy/search precision) and C19 (tashkeel/GPOS),
  plus overlay bracket mirroring and RTL list-marker placement. Correct strings, imperfect shaping.
- Crop: numeric per-edge **margins** SHIPPED 2026-08-04 (converted per page); resizable **handles**
  SHIPPED 2026-08-05 (8 grips, clamped so a drag cannot invert the rect). **Aspect-ratio-aware
  apply-to-all SHIPPED 2026-09-04**: a drawn crop now maps onto every page as a PROPORTION of that
  page's own box rather than as one absolute rect clamped to it, preserving the crop's shape (a
  uniform scale, so it is not stretched on a page of a different aspect ratio) and its relative
  position (the centre, not the corner). Exactly the identity on a uniform document.
- **XLSX table export** — DONE (2026-08-04): `src/export/xlsxWriter.ts`, no new dependency (XLSX is OPC,
  written with the fflate `zipSync` this repo already uses for DOCX). Shares table detection with the CSV
  export, and writes numeric cells as real numbers so a price column can be summed.
- Open-via-picker + recent-files for the native save dialog.

> Releasing any escape hatch is a deliberate, per-need decision — most cost multi-MB dependencies,
> significant build complexity, or the no-backend privacy promise. **EH-E is released (2026-08-04) for
> the CSV *and* XLSX table exports**, which was possible precisely because it costs none of those three:
> no dependency, no WASM, no backend — only an algorithm and a confidence gate. Both exports call the
> same `_resolveTableGrid`, and the harm reasoning is identical for each: the fallback runs only when the
> user has explicitly asked for a table. EH-A through EH-D remain un-greenlit.
