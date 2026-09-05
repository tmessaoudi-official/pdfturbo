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
| C16 | Encryption R6 hash-hardening | `@cantoo/pdf-lib` hardcodes R:5 | Fork/patch. AES-256 R5 is already strong |
| C17 | PAdES / TSA / LTV / CA-trusted signatures | node-forge can't emit ESS signing-cert-v2; TSA/LTV need a backend | Hand-rolled CAdES + EH-D. Valid ISO-32000 `adbe.pkcs7.detached` ships today |
| C18 | RTL text-layer select/copy/search **precision** | pdf.js builds the layer per-glyph, visual-order; highlight is item-level | EH-B. Logical copy/search reconstruction already works |
| C19 | Arabic overlay tashkeel/GPOS micro-positioning | Needs a GPOS shaper; legibility is already fine | EH-B |
| C20 | XFDF Acrobat byte-exactness + rotated-page coords | No Acrobat to verify against | Internal round-trip is the correctness guarantee |
| C21 | Raster ink — no per-stroke edit | Rasterised by design | Use the **vector** freehand tool |
| ~~C22~~ | ~~Flow LAYOUT on a non-zero CropBox origin~~ | **CLOSED 2026-09-02** — the normalisation happens ONCE, at the `_extractFlowDoc` boundary: words, links, rules, images, margins and the position-derived `colorMap` keys are all translated by the CropBox origin, so every consumer sees a single origin-(0,0) frame. The lockstep the row demanded is bought structurally rather than by discipline — `rules`, `vRules`, image CTMs and the colour keys all derive from `walkPageOps`' ctm, so one base-transform argument moves the four together and a partial normalisation of them is unexpressible. Guarded by `tests/browser/cropbox-origin-layout.browser.test.ts` | — |

---

## Deferred / nice-to-have (non-blocking)

### From the WS5 adversarial audit (2026-09-04)

- **Text drawn outside its Form XObject's `/BBox` exports to Word/Markdown/text although it is
  invisible everywhere else** (P2, pre-existing, found by WS7 round 7). pdf.js clips a form to its
  `/BBox` when rendering, so such a run shows up in no page render and in no rasterised export — but
  `getTextContent`, which the DOCX/MD/TXT reconstruction reads, applies no clip and returns it
  verbatim. Measured: 0 red pixels rendered against a control of 565, and the run present in the flow
  model. So a document can export text a reader can never see. Not fixed: suppressing it means
  attributing every text item to the form that drew it, which `getTextContent` does not tell us, and
  guessing would delete visible words — the direction that loses data. Related and now closed: the
  same clip was briefly applied to the colour channel alone, which turned such a run BLACK in the
  export rather than hiding it (see `CLAUDE.md` § the Form `/BBox` clip).

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

- **Redaction over VERTICAL-writing text is UNCERTIFIED** (`flowDoc.ts` `isItemRedacted`). The run
  footprint is read from the text transform, and pdf.js swaps the roles of its two size fields for a
  vertical font AND advances downward — so the sign along the second axis is unverified and a
  redaction over vertical CJK text may leave it extractable in the DOCX / MD / TXT / CSV / XLSX
  exports — and the mis-framing is TWO-DIRECTIONAL: the tested box is placed a full run-length on the
  wrong side of the origin, so a redaction drawn ABOVE a vertical run silently REMOVES it from those
  exports, which is data loss rather than a leak. **No vertical font exists anywhere in this repo to
  measure it against**, which is why the
  claim is withdrawn rather than guessed; an earlier guard "covering" it used a rotated Tm with
  `width: 0`, which is not a vertical-writing item and passed for an unrelated reason. Horizontal
  text, at any angle, IS covered. Disclosed to users in `SECURITY.md`.


Thirty findings across three lenses. The P0 and both P1s were fixed in that stream under TDD, as
were the trivial P2/P3s; what follows is everything left open, each with the reason it was NOT
landed rather than a bare "todo". Full lens reports: `var/claude/ws5/` (gitignored).

- **OCR "visible" mode places words with no user-rotation term** (`ocrHandler.ts:110-114`, P2). The
  redaction burn 140 lines below composes `redactionRectToContent` + `convertToViewportPoint`
  precisely because that canvas is rendered at the page's INTRINSIC `/Rotate` with no user rotation;
  the burn was fixed for the asymmetry, the word placement never was. On a page the user rotated,
  every inserted `TextElement` lands off-target. Deferred because the fix needs the same composed
  mapping plus a real-browser guard at all four rotations, and "visible" mode is the non-default,
  explicitly-relabelled OCR output.
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
- **An overlay text link is lost on the RASTER export path** (`exportPipeline.ts:552-559`, P2).
  `renderText` adds a `/Link` to the temp page, but the rasteriser embeds only the PNG into a fresh
  page — so on a redaction-bearing page the link exports as flat pixels, refuting the "survives BOTH
  export paths" claim. Deferred because re-adding annotations after rasterisation means re-deriving
  their rects in the clipped canvas frame, which is the coordinate work that has produced this
  repo's worst bugs; the CLAIM is corrected in CLAUDE.md rather than left standing.
- **A text element's lines below its stored box escape the blank-page drop** (P3).
  `dropElementsUnderRedactions` tests the stored box while `renderText` draws each line at
  `te.y + i*lineHeight` with no clip and no auto-grow. On a blank page — the one path where the drop
  IS the removal — an overflowing line is baked under the burn. Reachability UNVERIFIED: the editor
  textarea hides the overflow, so a user is unlikely to place text there. Deferred pending a
  reproduction; fixing it means either clipping the bake to the box or growing the box.
- **A failed redaction render degrades to an un-redacted THUMBNAIL** (P3).
  `renderThumbnailWithOverlays` catches everything and returns null, and the panel then falls back to
  the plain source raster. On-screen only — never written to a file — but it is the wrong direction
  for a fail-closed path. Deferred because the honest fix is a visibly-failed thumbnail, which needs
  a placeholder and a string.
- **`getPageCropBox` falls back to a MediaBox-derived box with a hardcoded (0,0) origin** (P3).
  An undiagnosed-failure fallback on a safety path; pdf-lib's own `getCropBox` falls back
  internally so it essentially never throws. Deferred under the anti-bandaid gate: there is no
  observed instance, and replacing a fallback with a different fallback is not a root-cause fix.
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
  native speaker, and that pass changed no value. **That sign-off is no longer blanket.** FIFTEEN
  values have been added or re-worded since and are pending a native pass: `toolbar.exportXlsxTitle`,
  `badge.signRect` (added 2026-08-28 — the mode badge had no string for the e-sign rectangle mode),
  the six `toolbar.cropMargin*` keys, `toast.cropMarginsTooLarge`, the three re-worded on
  2026-08-05 to match the hide-vs-remove grades (`toolbar.cropTitle`, `toast.modeHint.crop`,
  `toast.redactionPlaced` — single-verb substitutions, the first changes to a reviewed Arabic value
  since the sign-off), the two added by #54b on 2026-09-04 (`toolbar.recentFiles`,
  `toast.recentFileUnavailable`), and `toolbar.sanitizeTitle` — a word DELETION made by `8ae525c` on
  2026-09-04 that all four copies of this list missed until WS7 round 9, and which now UNDER-claims:
  the English and French tooltips were re-worded for the 2026-09-05 scope, the Arabic one deliberately
  was not, so it needs a re-wording as well as a review. **This was the FOURTH copy of that prose
  list**: CLAUDE.md's three copies were reconciled to 14 the same day and this one still read "Twelve"
  — the drift the count's own paragraph warns about, one file further out than it was looking [WS5
  audit, 2026-09-04]; reconciled again at 15 on 2026-09-05. **RTL rendering was not part of that review** and is unchanged — see ceilings C18 (select/copy/search precision) and C19 (tashkeel/GPOS),
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
