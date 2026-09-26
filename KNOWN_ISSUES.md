# PDFturbo — Known Limitations & Structural Ceilings

PDFturbo runs **entirely in the browser** with no backend and nothing uploaded. That design
choice is the product's core value — and it also sets hard limits in a few places: where a glyph
outline simply isn't present in the file, where the target format can't represent the source, or
where a library/spec doesn't expose the operation.

The items below are **not defects and not on a fix list** — they are the honest edges of a pure
client-side editor. Each notes the "escape hatch" that *would* lift it and the trade-off of taking
it, so the limit is understood rather than mistaken for a bug.

_Last updated: 2026-09-04._

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
| C9 | DOCX **borderless** tables | **STAYS UNWIRED — measured against a real corpus on 2026-09-04 and the gate did not clear it.** 15 public PDFs / 360 pages (IRS + GSA + USPTO forms, arXiv articles 1- and 2-column, Census/Budget/Pub-17 reports; rebuild with `scripts/c9-corpus-fetch.sh`, probe with `C9_CORPUS=1 npx vitest run tests/tools/c9Corpus.test.ts` (double-gated, so it never runs in `npm run test`)). 15 firings: 5 are genuine data tables (1099-MISC box grids x3, the W-4 withholding tables, a Pub-17 rate schedule) and **10 are multi-column LAYOUT misread as tables** — 9 pages of Publication 17's alphabetical INDEX plus one paper's table of contents. Reading an index row-wise (`Accounting periods | American Indians | Bequests | Certificates`) destroys its order AND removes the words from the paragraph flow, which is exactly the harm this row exists to prevent. **Not a tuning gap**: the index pages score median 3 words/cell — the identical value as the 1099-MISC and W-4 tables that are TRUE positives — so no threshold on that statistic separates them, and lowering it would refuse the real forms. The two-column ARTICLES scored zero firings, so the existing discriminators do work on the shape they were built for | A discriminator that separates a multi-column index from a data table. Corpus breadth is no longer the blocker; the statistic is |
| C10 | DOCX **4+** column layout | Recursive XY-cut ships (B6) but is depth-capped; 3 columns work, 4 measured as 3 groups | Deeper recursion / a looser gutter threshold. Corrected 2026-07-31 — this row previously said "Reconstructor is 2-column", which B6 had already made false |
| C11 | DOCX internal GoTo links / sheared images / ICC spot colour | No DOCX representation / no client ICC engine | EH-D. External URL links already work |
| C12 | Markup-annotation flatten | pdf-lib has no generic markup-flatten API | Narrowed 2026-08-29 — this row previously said the raster path "covers the redaction-rasterise case". It did NOT: pdf.js paints annotations *after* the content stream, so a note/stamp/widget over a redaction was repainted on top of the burn and baked in visibly (measured). Covered annotations are now STRIPPED before rasterising, so the redaction case is genuinely closed; what remains is flattening an annotation that is *not* under a redaction |
| ~~C13~~ | ~~Borderless table → CSV~~ | **CLOSED 2026-08-04** — EH-E released for the CSV path (`src/utils/borderlessTable.ts`): columns inferred from global whitespace bands, behind a confidence gate that refuses rather than guesses | — |
| C14 | Arabic searchable-OCR **exact search** | Shaping yields contextual glyphs with incomplete ToUnicode | EH-B + richer ToUnicode. Selectable/screen-reader text already works |
| C15 | OCR recognition **accuracy** | Bounded by the tesseract LSTM model | Cloud OCR (breaks EH-D) or a larger local model |
| ~~C16~~ | ~~Encryption R6 hash-hardening~~ | **CLOSED 2026-09-13** by the upgrade to `@cantoo/pdf-lib` 2.11.0, which writes `/R 6`. Pinned by CORE-P0-2 in `tests/blockers/core-security.blockers.test.ts`; the R6 password hashing is exercised by the password round-trip in `tests/export/exportPasswordSave.test.ts` (pdf.js opens it with the password) | — |
| C17 | PAdES / TSA / LTV / CA-trusted signatures | node-forge can't emit ESS signing-cert-v2; TSA/LTV need a backend | Hand-rolled CAdES + EH-D. Valid ISO-32000 `adbe.pkcs7.detached` ships today |
| C18 | RTL text-layer select/copy/search **precision** | pdf.js builds the layer per-glyph, visual-order; highlight is item-level | EH-B. Logical copy/search reconstruction already works |
| C19 | Arabic overlay tashkeel/GPOS micro-positioning | Needs a GPOS shaper; legibility is already fine | EH-B |
| C20 | XFDF Acrobat byte-exactness + rotated-page coords | No Acrobat to verify against | Internal round-trip is the correctness guarantee |
| C21 | Raster ink — no per-stroke edit | Rasterised by design | Use the **vector** freehand tool |
| ~~C22~~ | ~~Flow LAYOUT on a non-zero CropBox origin~~ | **CLOSED 2026-09-02** — the normalisation happens ONCE, at the `_extractFlowDoc` boundary: words, links, rules, images, margins and the position-derived `colorMap` keys are all translated by the CropBox origin, so every consumer sees a single origin-(0,0) frame. The lockstep the row demanded is bought structurally rather than by discipline — `rules`, `vRules`, image CTMs and the colour keys all derive from `walkPageOps`' ctm, so one base-transform argument moves the four together and a partial normalisation of them is unexpressible. Guarded by `tests/browser/cropbox-origin-layout.browser.test.ts` | — |

---

## Deferred / nice-to-have (non-blocking)

### From the WS8 design probe (2026-09-24)

- ~~**A layer the source switches OFF is visible in every PDF export**~~ — **FIXED by WS8 step 5 (2026-09-24).**
  `/OCProperties` lives on the catalog and `copyPages` never copied it, so the export had no optional-content
  configuration and every viewer drew every layer (measured: the OFF layer's band 0 dark pixels on the original, 307
  on the copy). Every export that copies source pages now carries the source's layer settings, copied with the same
  object copier as the pages so the groups the page references and the groups the settings list stay one object
  (`src/export/copySourcePages.ts`) — the PDF exports, the page as image, the thumbnail and the redaction rasteriser.
  One bound: an export combining two or more sources that EACH carry layer settings, where at least one switches a
  layer off, is refused (`toast.exportLayersConflict`) rather than merged — a PDF has one `/OCProperties`, and
  reconciling two means their order, radio groups and base states. Two layered sources whose layers are all ON
  export without either, which hides nothing — their groups stay referenced from the pages with no catalog listing,
  which pdf.js draws as visible; how Acrobat treats that, and the carried settings in general, is unmeasured (only
  pdf.js has been run on these exports). Guards: `tests/export/exportLayers.test.ts`,
  `tests/browser/export-layers.browser.test.ts`.
- **What the viewer check does not compare** (P3, bounds of a fix — WS8, 2026-09-24). The check runs pdf.js on a
  source and on the copy the export builds and compares each page's text (strings and origins) and drawing operators
  with a hash of their numeric operands and colours (per-document ids excluded).
  Not compared: pages pdf.js does not show when pdf-lib holds more — they are never exported; annotation appearances
  (operators are taken with annotations disabled, because the export copy drops the form dictionary and pdf.js
  draws widgets differently without it); which image an image-painting operator paints when two candidates have the
  same size and placement; and encrypted sources, which pdf-lib refuses without a password before the check, as
  before. A file pdf.js cannot open at all is refused, as the app cannot open it either.

### From the WS7 closing audit (2026-09-24)

- ~~**The viewer/export agreement check models pdf.js on pdf-lib's parse, and a crafted file can get past it**~~
  — **CLOSED by WS8 (2026-09-24)**: the mirror is gone and the check runs pdf.js itself; none of the ten shapes below loads any
  more — nine refuse with a page mismatch, and P6, which pdf.js cannot open, fails with pdf.js's own error — pinned by `tests/utils/ws8AuditShapes.test.ts`. Kept for the record: A branch-by-branch audit of pdf.js 6.3.289's cross-reference reader
  and page walk against `src/utils/pdfLoadGuard.ts` measured ten shapes that show one page and export or sign
  another while the guard loads the file: a `%startxref` comment after `%%EOF` (pdf.js takes it), a
  cross-reference stream without `/Type /XRef`, a table hidden inside stream data, a middle table short of rows,
  a non-first subsection `1 N` with a free first row, a row offset written `100.0` or `+100`, an entry landing on
  `4 0 obj` text inside another object, a `/Type /XRef` stream without `/W` before a good one, a page tree listing
  `5 0 R` and `5 1 R` (pdf.js caches objects by number), and a linearization dictionary with `/P null`. One cause:
  wherever the two libraries tokenize the same bytes differently, the mirror sees a success pdf.js did not have or
  compares nothing. The 15 real files are unaffected. Closing the class needs pdf.js itself run and compared per
  page, not a closer mirror — see `docs/ws7-certification-record.md` § Closing audit. The audit's one false
  refusal (a table declaring more or fewer rows than it has) is FIXED.

### From WS7 round 17 (2026-09-14)

- **A second cross-reference stream after one pdf.js rejects refuses the file** (P3, deliberate) **Superseded by WS8 (2026-09-24)**: this describes the mirror, which is gone — the current bounds are in "What the viewer check does not compare" above. — when pdf-lib
  parses the rejected stream. pdf.js reads the second stream with the first one's position, widths and ranges,
  which PDFturbo does not model, so it refuses rather than guess. When pdf-lib cannot build the rejected stream at
  all (a `/Type /XRef` stream without `/W`), the guard never learns it was rejected and LOADS — one of the ten
  shapes of the closing-audit bound above. No real file measured has this shape.
- **What the page-order check does not compare** (P3, bounds of a fix). **Superseded by WS8 (2026-09-24)**: this describes the mirror, which is gone — the current bounds are in "What the viewer check does not compare" above. The PDF exports and signing refuse a
  file where a page pdf.js shows is not the page pdf-lib holds at that position — a wrong `/Count`, a page
  dictionary without `/Type`, a linearized file's first-page object. Not compared: a file whose page tree
  pdf-lib cannot list, where every export fails anyway. Loads: pdf.js showing fewer pages than pdf-lib holds
  while every page it shows is the one pdf-lib holds there. Pages written directly inside `/Kids` rather than as
  references are compared by position only. When pdf.js rebuilds its table by scanning, the pages are walked
  over pdf-lib's objects and root.

### From WS7 round 14 (2026-09-13)

- ~~**A damaged file pdf.js repairs while opening can be refused**~~ — **CLOSED by WS7 round 16 (2026-09-14).**
  pdf.js checks the first and last page as it opens a file and, when an entry on the way to one lands on the
  wrong object, rebuilds its table by scanning (`checkFirstPage` / `checkLastPage`, including the whole-tree walk
  the last-page check falls back to). PDFturbo now mirrors those walks and compares nothing for such a file.
  The bound this left — pdf.js takes a linearized file's first page and page count from its linearization
  dictionary — is closed by WS7 round 17, which mirrors both.
- **A cross-reference stream PDFturbo does not decode the way pdf.js does is not compared** (P3). **Superseded by WS8 (2026-09-24)**: this describes the mirror, which is gone — the current bounds are in "What the viewer check does not compare" above. pdf-lib
  never applies a cross-reference stream's predictor, so PDFturbo decodes those entries itself; a stream with
  abbreviated filter keys, a predictor under a second filter, or a TIFF predictor at other than 8 bits is not
  modelled, and nothing is compared through it — nor through one pdf.js rejects. None of the 15 real files
  uses such a stream.

### From WS7 round 13 (2026-09-13)

- **What the viewer/export agreement check still does not compare** (P3, bounds of a fix). **Superseded by WS8 (2026-09-24)**: this describes the mirror, which is gone — the current bounds are in "What the viewer check does not compare" above. Since rounds 13
  and 14, the PDF exports, a page image, signing, the searchable OCR layer, sanitizing and compressing refuse a file whose cross-reference table names
  a copy of an object pdf-lib did not keep, marks a used object free, or (round 16) places it at bytes that are
  not that object — also behind an older section pdf.js cannot read and skips, and (round 17) behind a table it
  cannot finish, after which it reads no later table — whose startxref trailer names a
  different document root from the last trailer pdf-lib keeps, or whose root pdf-lib replaced — the shapes
  that let a crafted file show one page and export or sign another. Editing in place falls back to an
  editable overlay instead, and the export built afterwards refuses. The Word/Markdown/text, table and XFDF
  exports and OCR's other modes read through pdf.js, the viewer's own reader, so they cannot disagree with the
  screen and are not checked. Not compared: objects the table places
  inside an object stream; a file pdf.js rebuilds by scanning — no section of its chain yields a trailer, the
  root is unusable, or its opening walk to the first or last page meets an entry it cannot read — where it keeps
  the last definition like pdf-lib, measured — except that when two copies differ in generation it keeps the
  FIRST (closing audit, 2026-09-24) — but picks its trailer by its own rule. Since round 17 a
  linearized file is read from its first-page table, where pdf.js starts. Zero refusals over the 15 files of `var/corpus` and the 5 of
  `tests/fixtures/corpus-public`; all 15 are read through the chain pdf.js follows, with every in-use entry
  landing on an object pdf-lib parsed (`tests/utils/pdfLoadGuardCorpus.test.ts`). Round 13 recorded "14 of
  the 15 reaching the comparison": for 10 of those 14, the chain was a cross-reference stream pdf-lib had
  parsed without its predictor, whose entries pointed nowhere, so nothing was really compared on them.
- **A reachable damaged object makes any dropped object refuse the file** (P3, deliberate). Its contents
  cannot be read, so whether it points at a dropped object cannot be decided; the guard refuses rather than
  guess. A file with one reachable damaged object and one unrelated, unused dropped object is refused.

### From WS7 round 10 (2026-09-13)

- ~~**A damaged object in an incrementally-updated PDF can export its OLDER revision**~~ — **CLOSED by
  WS7 round 12 (2026-09-13).** Since the 2026-09-13 upgrade, `@cantoo/pdf-lib` silently drops an object
  it cannot parse when no `endobj` follows, and PDFturbo refuses such a file rather than exporting it
  without the object. The refusal used to look for a reference that resolves to nothing, so when an
  incremental update rewrote an object and the NEW revision was the one dropped, the old revision stood
  in and the export carried stale content. The guard now records when pdf-lib dropped each object and
  refuses unless pdf-lib assigned that object again afterwards; a drop that a later revision replaced still
  loads — since round 13 even when the replacement is the same value as the older revision, which the
  round-12 comparison by value refused. Both are pinned in `tests/utils/pdfLoadGuard.test.ts`, on a file
  built for it.
- **A legal dangling reference can be taken over by pdf-lib's metadata stamp** (P3, pre-existing).
  When pdf-lib stamps `/Info` on load it registers the dictionary under the next free object number;
  a reference to that number which pointed at nothing (legal — it reads as null) then resolves to the
  Info dictionary. The load guard closes this for DROPPED objects by checking before the stamp, and
  deliberately leaves header-less dangling references alone, because refusing them would reject
  ordinary old files. [Inferred from the mechanism measured for the dropped case.] Since WS7 round 12 the
  guard does not read the file's text at all: it records each drop inside pdf-lib's parser, so text that
  merely reads `9 0 obj` cannot make a legal dangling reference look dropped. Rounds 10 and 11 scanned the
  text for object headers, and that scan could both refuse a legal file and — for a stream with no
  `endstream`, a glued or commented header, or `>> stream` inside a string — accept one pdf-lib had
  dropped from. What the recorder cannot see: bytes pdf-lib never parses as an object (skipped as junk,
  or swallowed by a stream whose end it places too late) are not a drop, so they are not detected; and
  when an object stream fails before its member list is known, ANY reachable dangling or damaged reference
  in that file refuses it, since the lost members cannot be named.
- **Sanitize refuses a file that holds an object it cannot parse**, rather than cleaning it. Such an
  object can hide an active script no walk can see, so a clean report would be false; the cost is that
  a merely damaged file cannot be sanitized. An unreferenced damaged object is swept first and does not
  trigger the refusal.

### From the WS5 adversarial audit (2026-09-04)

- ~~**Text drawn outside its Form XObject's `/BBox` exports to Word/Markdown/text although it is
  invisible everywhere else**~~ — **FIXED 2026-09-26 (A2).** Each text item is now attributed to the
  form that drew it: marker injection on a throwaway copy of the page, paired with the clip of each form
  placement. An item wholly outside its clip leaves the Word/Markdown/text and CSV/XLSX exports. Real
  files: 5 such runs in 1 of 15 (figure labels in an arXiv paper), each render-confirmed invisible; the
  other 14 files pay nothing, because the attribution runs only on a page where the operator walk sees
  form text outside its box. Bounds: a run that crosses the box edge is one item and exports whole;
  a run that starts after a `TJ` gap or an unpositioned second show op may not trip the trigger and is
  kept; on any disagreement between the copy and the page, or any failure, the page exports as before.
  The editor's own text layer (select, copy, search) still exposes such text; this fix covers the
  exports only. Guards: `tests/browser/form-hidden-text.browser.test.ts` and
  `tests/export/formHiddenText.test.ts`.

- ~~**A disabled crop flag leaves the editor drawing a frame the export ignores**~~ — **CLOSED
  2026-09-04.** It was INTRODUCED in this range (an earlier note called it pre-existing and that was
  WRONG: `d945127`, which added `isEnabled('crop')` to `exportPipeline`, is INSIDE `dfe34ae..HEAD` —
  `git merge-base --is-ancestor d945127 dfe34ae` → not an ancestor. Before it the export honoured a
  stored crop unconditionally. Checking that a commit exists is not checking that it is out of
  range). With `VITE_FEATURE_CROP` off, a restored session showed a dimmed crop frame with LIVE
  grips that still committed `SetPageCropCmd`, while the export emitted the full page.
  **It was deferred as a product call and it was not one.** `main.ts` already removes the crop button
  and `#cropControls` when the flag is off, and `exportPipeline` gates BOTH its paths, so the frame
  was the one surface where the feature outlived its own switch — the seam had already decided, and
  `_renderCropFrame` had simply missed the gate. The alternative reading (keep honouring a stored
  crop on export) contradicts the comment at `exportPipeline.ts:299-303`, which says in as many words
  that a switch killing the button rather than the feature is the opposite of what a kill switch is
  for. Now gated, with the gate placed AFTER the stale-overlay removal so flipping the switch off
  clears a frame an earlier render left behind. Guarded by three cases in
  `tests/core/pageRenderPipeline.test.ts`; sabotage-verified twice — reverting the gate fails the two
  switched-off cases and not the ON control, and moving the gate ABOVE the removal fails exactly the
  leftover-frame case.

- ~~**Redaction over VERTICAL-writing text is UNCERTIFIED**~~ — **CLOSED 2026-09-25** (limits walkthrough A1).
  Measured in real pdf.js on pdf.js's own `vertical.pdf` (dvipdfmx, `Identity-V`) and a synthetic `Identity-V`
  run: a vertical run's ink is centred across its origin and runs DOWN by its advance, while the old footprint
  sat right of the origin and ABOVE it — so it leaked (12 of 14 guard cases red on the old code) and dropped
  text a redaction above the column never touched. `isItemRedacted` now branches on pdf.js's `dir: 'ttb'`.
  Remaining bound: ±0.6 em across and 0.1 em past each end covers every measured shape; a font whose `/W2`
  vertical metrics place ink further out is not covered (`getTextContent` does not expose them). Guards:
  `tests/browser/redaction-vertical.browser.test.ts` (14) and the vertical block in
  `tests/utils/flowDocRedaction.test.ts`.


Thirty findings across three lenses. The P0 and both P1s were fixed in that stream under TDD, as
were the trivial P2/P3s; what follows is everything left open, each with the reason it was NOT
landed rather than a bare "todo". Full lens reports: `var/claude/ws5/` (gitignored).

- ~~**OCR "visible" mode places words with no user-rotation term** (P2).~~ **FIXED 2026-09-26 (A3).**
  Each word keeps its reading size from the bbox. Its centre is mapped from the OCR canvas to the
  display by the exact inverse of the redaction burn's mapping, and it carries `rotation = userRot`, so
  on a page the user rotated it lands on, and reads along, the text it came from (measured up to 110pt
  off before). User rotation 0 is the original formula. Remaining bound: the engine still READS the
  canvas at the intrinsic `/Rotate`, so on a page rotated upright by the user it sees the glyphs
  sideways, as before. A word also keeps its rotation if the page is rotated again later, like every
  element. Guards: `tests/browser/ocr-visible-rotation.browser.test.ts` (10 + 2 visual) and the A3
  cases in `tests/handlers/ocrHandler.test.ts`.
- ~~**FileAttachment annotations survive `sanitizePdf`** (P2).~~ **CLOSED 2026-09-05** by developer
  ruling: the whole paperclip annotation goes, with its `/Popup` (from whichever page lists it), and
  BOTH `/FS` and `/AF` are deleted on the dict itself so the file leaves the bytes even when a reply
  note (`/IRT`) or a popup still references the annotation — removing it from `/Annots` alone left the
  payload reachable for the sweep, which is the reference-deleted, payload-serialised shape WS5 P1
  found. The first version cut `/FS` only; a post-push review found a paperclip carrying `/FS` AND
  `/AF` kept its file with the flag saying removed (P0), fixed the same night. `/AF` now goes on every
  annotation, field and bookmark, not only the catalog and pages. The same ruling widened sanitize to the
  non-JavaScript egress action class (`/SubmitForm`, `/Launch`, `/GoToR`, `/GoToE`, `/ImportData`),
  spliced at every chain position like scripts. WS7 round 9 then found the walks' blind spots — `/AA`
  inherited through `/Parent` (page-tree root, unlisted field parent), a Filespec shared with kept media,
  XMP and `/AF` on XObjects, a paperclip reachable only through `/Fields`, and the paperclip's own
  scripts — closed by a backstop over every dictionary in the file and by cutting the embedded stream on
  the Filespec itself. Guards: three blocks in `tests/utils/pdfSanitizer.test.ts` — 15 (the ruling), 5
  (the `/AF` review), 11 (round 9; the twelfth code finding, opcGc, is pinned in `tests/docx/opcGc.test.ts`) — sabotage-verified with the figures in CLAUDE.md § PDF sanitizer.
- ~~**An overlay text link is lost on the RASTER export path**~~ — **CLOSED 2026-09-25** (limits
  walkthrough A4). The rasteriser now reads the temp page's links after the overlays are baked —
  source links that survived the annotation strip AND overlay links — keeps each `/S /URI` link whose
  URL passes `sanitizeLinkUrl` and whose rect meets no redaction, and re-creates it FRESH on the image
  page, mapped through the same viewport and clip offset as the crop. Not carried: links that meet a
  redaction (including an overlay link stacked under one), `GoTo` links (their destination page is
  gone), and any non-web scheme. Guards: `tests/export/rasterLinks.test.ts` (19) +
  `tests/browser/redaction-raster-links.browser.test.ts` (10 — four rotations, source `/Rotate`,
  source CropBox origin, two crops, a pixel under every re-added rect).
- ~~**A text element's lines below its stored box escape the blank-page drop** (P3).~~ **CLOSED
  2026-09-26** (limits walkthrough A5). Reachability was VERIFIED, not unlikely: the default 200×30 box
  at 14pt draws its SECOND line at baseline y+29.4, i.e. below the box, and a long line runs past the
  right edge because the bake never wraps. Reproduced first — a redaction clear of the stored box but
  across the overflow left the line as live text in the PDF and in the Markdown export — then fixed by
  testing the DRAWN extent: `textDrawnFootprint` (`src/export/textExtent.ts`) is the union of the stored
  footprint and every line's drawn box, with line positions from `layoutTextLines`, the same function
  the bake draws with. One finding on the way: pdf-lib's `widthOfTextAtSize` applies kerning while the
  bake draws un-kerned `Tj`, so a kerned line inks past its measured width (by over 1 em for Times-Bold
  "AVAVAVAVA" at 40pt), and the same holds for the Latin runs of a mixed Arabic line; the
  footprint uses the un-kerned advance. Guards: `tests/browser/redaction-text-overflow.browser.test.ts`
  (5), `tests/browser/text-extent-ink.browser.test.ts` (33 — every inked pixel inside the footprint
  across 26 configs, and the drop's decisions both ways) and `tests/export/textExtent.test.ts` (6).
  Stated over-drop bounds are in `SECURITY.md` § "Dropping is blunt by design".
- ~~**A failed redaction render degrades to an un-redacted THUMBNAIL** (P3).~~ **CLOSED 2026-09-26**
  (limits walkthrough A6). `renderThumbnailWithOverlays` now REJECTS when a page carrying a redaction
  cannot be rendered — a bake error, a refused source load, a missing source document or no canvas
  context — and the thumbnail panel shows a visible "Preview unavailable" tile instead of the plain
  source raster. An unredacted page keeps the old fallback (its plain raster hides nothing). The failure
  is not cached, so the next re-render tries again. Guards: `tests/export/thumbnailFailClosed.test.ts`
  (5, each rejection case with an unredacted control), the A6 case in
  `tests/ui/pageThumbnailPanel.test.ts` (which also pins the page button's `aria-describedby`, since its
  `aria-label` would otherwise hide the placeholder from a screen reader), and
  `tests/browser/thumbnail-unavailable.browser.test.ts` (5 — the tile is visible, the page image is
  hidden, the text fits in en/fr/ar, and a REAL failure: with the Arabic font unreachable, as offline on
  first use, the live ExportService + panel show the placeholder for a redacted page and still fall
  back to the plain raster for an unredacted one).
- ~~**`getPageCropBox` falls back to a MediaBox-derived box with a hardcoded (0,0) origin** (P3).~~
  **FIXED 2026-09-26 (B1), and it was a P1 redaction leak, not a P3.** The premise "pdf-lib's
  `getCropBox` essentially never throws" was wrong: it throws on a malformed `/CropBox`, and on a
  MediaBox whose origin is not (0,0) the burn then missed its secret. Three sibling shapes leaked
  through the same function, because it returned pdf-lib's RAW `/CropBox` while every editor coordinate
  is measured against pdf.js's view (CropBox ∩ MediaBox): a CropBox past the MediaBox and a disjoint
  one left the secret visible, and a zero-area one exported a blank Letter page. All four pass the
  source loader. `getPageCropBox` is now a mirror of pdf.js's `Page.view`, and equals pdf.js's
  `viewBox` on all 360 corpus pages (none of which has any of the four shapes). Guards:
  `tests/browser/cropbox-view-parity.browser.test.ts` (18 — parity against pdf.js itself, and the burn
  on the secret for each shape including a rotated one) and `tests/core/exportCoords.test.ts` (11).
- ~~**A page with `/UserUnit` misplaces every overlay, redactions included** (P1).~~ **FIXED
  2026-09-26.** pdf.js scales every viewport by `/UserUnit` (`pdf.mjs:826`) and the export works in
  plain points, so on a `/UserUnit 2` page a redaction drawn over the secret baked at twice its position
  and the secret stayed visible, in the PDF and the Word/Markdown/text exports. Every viewport in `src/`
  now comes from `pointViewport` (scale ÷ UserUnit), direct `.getViewport(` calls are banned by a test,
  and the text layer's CSS factor is `scale × userUnit` — it was already 1/u the canvas size on such
  pages. The redaction raster and lossy compress, which build a new page from a render, copy the
  source's `/UserUnit` onto it so the page keeps its physical size. Bounds, both consequences of the ruling: at 100% zoom such a page shows at its size in points,
  not its physical size; elements saved in a session before the fix were measured at u times and
  restore scaled by 1/u (no `SCHEMA_VERSION` bump — they exported to the wrong place anyway, and 0 of
  360 corpus pages carry `/UserUnit`). The three rasters (redaction page, lossy compress, page-as-image) multiply their raster scale
  by the UserUnit, so the chosen DPI stays physical. Guards: `tests/infra/pointViewport.test.ts` (5) and
  `tests/browser/userunit-frame.browser.test.ts` (16).
- **The searchable-OCR layer ignores the CropBox** (P2, found 2026-09-26, not yet ruled).
  `searchableTextLayer.ts` positions its invisible text with the MediaBox size at origin (0,0) while
  the OCR canvas is pdf.js's view, so on a page whose CropBox differs from its MediaBox, or whose
  MediaBox origin is not (0,0), the searchable text is offset from the words it transcribes. Placement
  only, not a leak. 0 of 360 corpus pages have a CropBox that differs from the MediaBox.
- **`MODE_HINT_KEYS` is not exhaustive by type or test** (P3). All 16 modes are present today, so
  this is a guard gap, not a defect — the sibling `badgeKeys` was made exhaustive AND pinned after
  the signRect drift. Deferred as a one-line follow-up rather than mixed into an audit commit.
- **The vendored Arabic `.ttf` is not precached and no runtime rule matches it** (P3), so the Arabic
  overlay and searchable-OCR need network after install, which README's "app shell offline" does not
  say. Deferred: adding it to `globPatterns` grows the install payload, the opposite of the #48
  decision that moved the OCR assets OUT of precache.
- **The PWA guard pins the tesseract caching rule's presence, not its ORDER** (P3), though the
  comment says the order is load-bearing — reordering keeps the test green while the cores fall into
  the wrong cache. Deferred with the same one-line-follow-up reasoning as `MODE_HINT_KEYS`.
- **Two exports have no production caller** (#54 / #54b): `canUseFsSave`
  (`src/utils/fileSystemAccess.ts`) and `clearRecentFiles` (`src/infra/recentFiles.ts`). The first is
  a capability probe nothing branches on — `pickSaveTarget` degrades internally instead, which is the
  better design, so the probe is simply unused. Both are kept as the tests' entry points and as the
  natural hooks for a "save location" hint and a "clear recents" control — until a control exists a
  user clears recents through the browser's site-data settings. Recorded rather than
  deleted, and recorded TOGETHER: the audit found `clearRecentFiles` first and the sibling only on
  the next round, which is the pattern this list exists to break.

- **The live OCR `status` string is dropped** (P3): `ocrHandler` emits `{progress, status}` while the
  callback is typed `{progress}`, so the modal shows a static "Recognizing text…" through model
  download and recognition alike. Deferred as a UX improvement, not a defect.


- **Arabic locale strings** — reviewed 2026-07-30: all 31 then-unverified keys were validated by a
  native speaker, and that pass changed no value. The fifteen values added or re-worded after it —
  `toolbar.exportXlsxTitle`, `badge.signRect`, the six `toolbar.cropMargin*` keys,
  `toast.cropMarginsTooLarge`, the three re-worded on 2026-08-05 to match the hide-vs-remove grades
  (`toolbar.cropTitle`, `toast.modeHint.crop`, `toast.redactionPlaced`), the two added by #54b
  (`toolbar.recentFiles`, `toast.recentFileUnavailable`) and `toolbar.sanitizeTitle` — plus the two
  UNRECONCILED marker sets (`formatting.*` Slice 2, `modal.signers.*`) were **CLOSED BY DEVELOPER
  RULING on 2026-09-13** ("consider the arabic review done"). That is a ruling, not a second native
  read, and it is recorded as one. **Three values are pending.** `toolbar.sanitizeTitle` had UNDER-claimed
  since `8ae525c` deleted a word and the 2026-09-05 scope widening left it behind, so it was re-worded
  the same day to the English and French scope — by the session, not by a native speaker, so the new
  wording starts `[Unverified]` like any new value. WS7 round 10 added two more the same day,
  `docxEditor.pdfImagesSkipped`, `toast.sanitizeRefusedInvalidObject`, also written by the session. This list lived in four prose copies and drifted
  three times (11 / 12 / 14 / 15) before the closure; `CLAUDE.md` § "The hide-vs-remove audit" is the
  count's home. **RTL rendering was not part of that review** and is unchanged — see ceilings C18 (select/copy/search precision) and C19 (tashkeel/GPOS),
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
- ~~Open-via-picker + recent-files for the native save dialog.~~ **SHIPPED 2026-09-04 (#54b)** —
  `showOpenFilePicker` where available, handles remembered in an IndexedDB `recent` store, and a
  recent-files list in the File menu with permission re-requested at click time. The plain
  `<input type=file>` path is untouched, so browsers without the API are unaffected.

> Releasing any escape hatch is a deliberate, per-need decision — most cost multi-MB dependencies,
> significant build complexity, or the no-backend privacy promise. **EH-E is released (2026-08-04) for
> the CSV *and* XLSX table exports**, which was possible precisely because it costs none of those three:
> no dependency, no WASM, no backend — only an algorithm and a confidence gate. Both exports call the
> same `_resolveTableGrid`, and the harm reasoning is identical for each: the fallback runs only when the
> user has explicitly asked for a table. EH-A through EH-D remain un-greenlit.
