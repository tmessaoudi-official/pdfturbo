---
paths:
  - "src/export/**"
  - "src/utils/pdfSanitizer.ts"
  - "src/utils/xfdf.ts"
  - "tests/export/**"
---

# pdfturbo gotchas — export

Moved verbatim from CLAUDE.md § Gotchas on 2026-09-28 (review-remediation 5.3, /rules-split). Scope: the export pipeline: rotation, text extent, the export frame, links, flatten, XLSX, forms, XFDF, Bates, sanitize, lock, compress. These entries are this project's decision register (the design docs they came from were removed in `ac4ef68`). New entries for this area go HERE, not into CLAUDE.md. A § "…" reference names a heading in CLAUDE.md or in another `.claude/rules/` file — CLAUDE.md § Gotchas lists every moved heading; a § that names a bold paragraph (e.g. "MD/TXT parity") or paraphrases a heading resolves by grepping the phrase in `.claude/rules/`.

### On a rotated page, text, pictures, signatures and comments exported turned by the page rotation (A3-pre, 2026-09-26)

Every orientation-bearing renderer handed pdf-lib `rotate: degrees(-elemRot)` and nothing else. That is
right only on an unrotated page: the viewer turns the page by its `/Rotate` clockwise, so on a scanned
`/Rotate 90` page — or after the user pressed rotate — every text box, image, code, signature and
comment came out turned by the page rotation, and pictures were squashed into their SWAPPED dimensions
(`swapDims` is right for a filled rectangle, which has no orientation, and wrong for anything that
does). Separately, rotated TEXT turned about its line start while the editor turns the box about its
CENTRE (`elementLayerRenderer`: `transform-origin: center center`), so a rotated line landed up to
~120pt from where the editor showed it. Nothing caught either: `rotated-overlay-placement` checks a
symmetric green square, which reads the same in every orientation.

**One shared placement in `renderElementToPdfLib`:** `orientDeg = totalRot − elemRot` (pdf-lib is
CCW), `place()` turns a display point about the box centre then maps it through `tp`, and `placeBox()`
anchors a picture of its OWN (never swapped) size at `C + Rot(φ)(−w/2, −h/2)`. The raw-operator paths
take the angle into their text matrix (`drawStyledTextLine` `rotate`, `drawArabicLine` `rotate`), and an
Arabic line's right-alignment offset runs ALONG the line (`runStart`). Rectangles, highlights,
redactions, shapes, the text background and the link rect are deliberately untouched — they were
already right. `cosSinDeg` snaps quarter turns to exact 0/±1 so no `6e-17` reaches an operand stream.

**Byte-identical at page 0° and element 0°** — proved, not argued: the content stream of every element
type hashed before and after the change (`caecf8e1…`, a throwaway probe, not committed). Every other
orientation changes by design. The textExtent footprint moved with the bake (§ A5 above).

**Two scope extensions, stated because they change output at page 0°:** rotated text now pivots about
the box centre, and a rotated element keeps its Tier-2 attrs (the `!elemRot` gate on the operator path
is gone — its only reason was the missing rotation in the text matrix).

**The oracle is independent of the renderer.** Pictures: a four-colour quadrant PNG, a 4×4 point grid
turned about the ELEMENT centre, colours sampled from the real pdf.js render. Text: pdf.js's own text
transforms mapped to display space against the SAME element exported at page 0°/element 0° (the
byte-identical path), turned about the box centre. `turn()` is checked against CSS itself with
`getBoundingClientRect`, so the oracle does not share the repo's sign convention by construction.
Three fixture lessons, each found by a sabotage that stayed green: **(1)** a signature WITHOUT a caption
has its picture centred on the element, so a band-pivot error is invisible — the fixture carries one;
**(2)** quadrant CENTRES leave ~15pt of slack, more than the caption band's 11pt offset — the grid
reaches 10% from each edge; **(3)** a comment string must be long enough to wrap at the swapped width
but not the real one, or a `maxWidth` from the wrong axis is invisible. And pdf.js truncates a text
item at the page edge, so a turned box near an edge reads as a wrong STRING — the text boxes sit half a
diagonal from every edge.

Guards: `tests/browser/rotated-oriented-overlays.browser.test.ts` (42 = 38 asserting cases — the oracle
check, a reference non-vacuity check, and 6 page orientations × element 0/90/30° for pictures and text:
source `/Rotate` 0/90/180/270, user 90, and source 90 + user 180 — plus 4 NON-asserting visual-record
shots written to `var/claude/qa-shots/a3pre/`), plus three rotated-overflow configs in
`text-extent-ink.browser.test.ts`. On the pre-fix source the new file fails 32 of 42 (measured before
the record shots existed as 32 of 38; the shots pass on any code by design; the six asserting cases that
pass are the oracle, the reference, text at 0/0 and pictures on an unrotated page, which were already
right). The 94add82 commit message says "38; fails 32" — it predates counting the record shots.
**Not measured:** a comment or caption that WRAPS under rotation — the fixtures are one line each by
design (the wrap check needed exactly one); pdf-lib's `T*` moves in text space, so the next line should
follow the turned matrix [Inferred].
Sabotage, each restored and checked with `cmp`: page rotation dropped from the angle → exactly the 30
rotated-page cases; no centre pivot → 18 (12 text at element ≠ 0, 6 captioned-signature pictures at
90° — the 11pt band offset at 30° stays inside the grid's margin, a stated bound); styled text matrix
unrotated → 15; comment `maxWidth` from the swapped axis → exactly the 12 cases on a 90°/270° page;
Arabic start axis-aligned → 15; mixed-line advance axis-aligned → 15 (the 15s are every text case whose
angle is non-zero — at source 90 + element 90 the angle cancels).

**Found, not fixed:** the THUMBNAIL of a blank page whose rotate button was used composites with
`userRot = docPage.rotation` (`_applyOverlaysToPage`), while the editor and the PDF export draw a blank
page unrotated. Pre-existing, cosmetic, thumbnail-only; recorded in the limits plan.

### Typed text overflows its box, and the redaction drop now tests where it is DRAWN (A5, 2026-09-26)

> **[Re-checked 2026-09-28]** the config and case counts below have grown since (`4808f0d`, `7f5094c`) — the `CONFIGS` table in `tests/browser/text-extent-ink.browser.test.ts` is the authority, not the numbers here.

A `TextElement` has a fixed height (nothing grows it; the editor textarea scrolls) and `renderText`
never wraps or clips, so the default 200×30 box at 14pt already draws its second line below the box
and a long line runs past the right edge. `dropElementsUnderRedactions` tested the STORED box, so a
redaction that missed the box but covered the overflow left that text in the blank-page PDF, the
DOCX/MD/TXT flow and XFDF. The drop now tests `textDrawnFootprint` (`src/export/textExtent.ts`), the
UNION of the stored footprint and each line's drawn box — it may only grow.

**The line layout is SHARED, not copied.** `layoutTextLines` (`src/export/textLayout.ts`) was
extracted out of `renderText`, which now draws from it, so the drop and the bake cannot disagree on
where a line is. The glyph band around a line is NOT shared — it comes from the drawn face's own
FontBBox (Latin) and Noto Naskh's measured bbox (Arabic), plus one measured right-overhang constant.
`text-extent-ink.browser.test.ts` is the pin on those numbers: every non-white pixel of the real bake
must lie inside the footprint, across 29 configs. **Rotated lines turn about the BOX CENTRE** — the
editor's pivot, and the bake's since A3-pre (2026-09-26; until then the bake turned each line about its
own start point, and the footprint followed it) — so each line's band is bounded by its four corners
turned the same way.

**Kerning, found by the ink probe and invisible otherwise.** pdf-lib's `widthOfTextAtSize` applies the
AFM kerning pairs; `drawText` and the raw `Tj` path draw with none. So a kerned line inks WIDER than
its measured `lineW` — Times-Bold "AVAVAVAVA" at 40pt ran over 1 em past it. The footprint adds the
un-kerned advance (a lone glyph has no pair, so `widthOfTextAtSize` per character is un-kerned). The
**The mixed Arabic + Latin path has the SAME mismatch**, found only because the review asked:
`measureBidiRuns` measures each Latin run with Helvetica's kerned width and `drawBidiLine` draws it with
`drawText`, so a kerned run at the visual right end inked past the line by more than the 0.25 em Arabic
band ("Tى AVAVAVAVA" at 40pt: 14pt past the footprint). `mixedLatinKernExcess` adds every Latin run's
excess. A probe of the Arabic FONT alone had found nothing, correctly — which is exactly why "no kerning
twin" needed its scope stated. **Trap in writing that case:** the first version ran off the 500pt test
page, the ink was clipped at the page edge, and the case passed against the unfixed code. The
same mismatch exists in the layout itself (alignment offsets and justify use the kerned width) and is
cosmetic there; it is only a leak when a leak filter trusts the kerned number.

**Also found by the ink probe: `'Times New Roman'` bold/italic mapped to the wrong StandardFonts
keys**, so a bold or italic Times text box failed to export at all (fixed separately, e76a996, with
an exhaustive family × variant test). The fork substitutes `?` for anything WinAnsi cannot encode —
CJK included — in measuring AND drawing, so CJK is measured as it is drawn and nothing throws.

Stated over-drop bounds (`SECURITY.md` § "Dropping is blunt by design"): FontBBox left/top headroom,
one union box per element (an empty line in the middle counts as covered), and an Arabic line whose
font cannot load counts as reaching the page edge. Guards: `redaction-text-overflow.browser.test.ts`
(5, reproduction + far-away control), `text-extent-ink.browser.test.ts` (36),
`tests/export/textExtent.test.ts` (6). **Sabotage, RE-MEASURED after the last cases were added** (the
996fd7f commit message predates the four kerning/left-overhang cases and the upright pin, and its S2
and S5 figures are stale): drop tests the stored box → 8 browser; no bottom band → 1 unit + 8 ink;
Arabic never measured → KEPT(b) + 1 unit; rotation ignored → 4 (re-measured 2026-09-26 with the
three rotated-overflow configs A3-pre added; pivoting at each line's start instead of the box centre
fails exactly those three); right overhang 0 → 3 ink (two
italic, and the Helvetica "_____" upright pin — without that pin the kerning term absorbed the upright
constant in every other config and S5 left it unguarded); kerning term removed → exactly the 3 kerning
cases; `advanced` forced off → 1 (Tc/Tz); FontBBox left bound removed → exactly the Times-italic "jfjf"
case; the mixed-line excess term removed → exactly the mixed-line case. Two of those margins are THIN by nature — the upright pin fails its sabotage by 0.3pt at scale 4 —
so a re-measure that finds it green is a tolerance question before it is a regression. The Arabic
bands were swept too (20 strings, see the constant's comment in `textExtent.ts`).

### The export frame is pdf.js's page VIEW, not pdf-lib's CropBox — B1 (2026-09-26)

`getPageCropBox` (`exportPipeline.ts`) is the frame every export mapping uses — the overlay bake, the
redaction rasterizer and both annotation strips — and every editor coordinate is measured against what
pdf.js SHOWS: `Page.view` (`pdf.worker.mjs:59242-59276`), a valid, non-empty `/CropBox` INTERSECTED with
the `/MediaBox`, else the MediaBox, else US Letter. It used to return pdf-lib's RAW `getCropBox()`, and a
box at (0,0) when that threw.

**The ruled fix was "delete the fallback, pdf-lib already falls back to the MediaBox" — and measuring it
refuted the premise.** pdf-lib falls back only when `/CropBox` is ABSENT; `asRectangle` throws on a
malformed one. Four shapes, each passing the source loader, each measured against the real rasterizer
with the burn drawn where the editor would draw it: a malformed CropBox on a MediaBox at (50,50) — burn
50pt off, secret visible; a CropBox past the MediaBox — burn shifted, page grown to the raw box; a
disjoint CropBox — page cut to it, no burn; a zero-area one — a blank Letter page. **The fallback was one
of four leaks through one function, and "no observed instance" (the reason it was deferred as P3) meant
nobody had built the file, not that the file cannot exist.** The developer re-ruled to mirroring pdf.js.

Three things worth carrying forward. **The parity test compares with pdf.js ITSELF** (`viewBox` at scale 1,
rotation 0), not with a copy of its rule, so a pdf.js upgrade that changes the rule reds instead of
drifting. **The nearest value wins, valid or not:** an invalid `/CropBox` on the page does not fall through
to a valid one on an ancestor, in pdf.js or here. **The CropBox's non-empty check is redundant with the
intersection's area check** — sabotaging it reds only the empty-MEDIABOX case, which is correct, not a
weak guard. And `page.setCropBox(effBox)` now writes the intersection onto a page whose raw CropBox
extended past its MediaBox: a byte change on exactly the divergent pages, visually identical in any
conforming viewer, zero corpus pages affected.

Two relatives found by the same probe: **`/UserUnit`**, a leak, fixed the same day (next section), and the
**searchable-OCR layer**, which positions text with `getSize()` at origin (0,0) instead of the view — not
ruled, in `KNOWN_ISSUES.md`.

Guards: `tests/browser/cropbox-view-parity.browser.test.ts` (18 — 12 parity shapes against pdf.js, 6
burn-on-the-secret cases through `rasterizePageWithRedactions` including a `/Rotate 90` page and a
control, each also asserting the exported page size is the view's) and `tests/core/exportCoords.test.ts`
(11 pure, replacing a block that tested a hand-copied fallback and asserted the (0,0) box as correct).
Corpus: equal to pdf.js's `viewBox` on 360 of 360 pages. Sabotage, predicted first: the MediaBox
fallback without its origin → 3 jsdom + 4 browser; the raw CropBox whenever valid → 2 + 6; the raw
CropBox only where it overlaps → 1 + 3 (a narrower mutation than first predicted — disjoint and touching
boxes still fell to the MediaBox); no Letter fallback → 1 + 1; no non-empty check → exactly the
empty-MediaBox case; box entries not resolved through `lookup` → exactly the indirect-number case.

### The flow export mixed absolute and crop-relative coordinates — C22, and the lockstep is now structural (2026-09-02)

> **[Re-checked 2026-09-28]** "216-file jsdom suite" is the count at the fix; `git ls-files tests` is the authority today.

pdf.js reports every CONTENT channel in **absolute user space** — text items, operator-list CTMs
(rules, vRules, image placements, the colour keys) and Link annotation rects alike — while
`reconstructPage` is handed the **CROP** dimensions as the page box. On a `/CropBox [0 0 w h]` page
the two frames coincide, which is why this survived every fixture; give the page an origin and the
DOCX/MD/TXT export gets wrong margins, wrong image anchors and a reading order computed against a
box its coordinates do not belong to. Registered as C22 on 2026-08-28 and pinned as an `it.fails`
rather than bundled into that day's redaction-leak fix.

**Measured before touching anything, on `/CropBox [50 50 350 350]`:** item `(100,300)`, rule
`(100,296)`, colour key `"100,300"`, image ctm e/f `(120,200)` — all absolute, and all mutually
CONSISTENT. That second half is the whole design. Colour, underline and hyperlink are matched **by
position**, so they work today *because* every channel is equally wrong; normalising the words
alone would fix the layout and silently break all three. **The deferral reason was never the
arithmetic — it was that a partial fix is invisible.**

**So the fix is one translation at the `_extractFlowDoc` boundary, and the lockstep is bought
STRUCTURALLY rather than by discipline.** `rules`, `vRules`, image CTMs and the `colorMap` keys all
derive from the walker's ctm, so `walkPageOps` gained an optional CropBox origin that seeds its
**base transform** — one argument moves those four together and a partial normalisation of them
becomes unexpressible. `composeCtm(m, …)` applies `m` last, so the translation stays outermost and
is never scaled by a later `cm`; that was read (`result[4] = m[0]*e + m[2]*f + m[4]`), not assumed.
Words go through the pure `translateItemsToCropOrigin`, links through a two-term subtraction, and
`reconstructPage` + `imagePlacementRedacted` are handed `cropFrame = [0,0,vp.width,vp.height]`.

**The trap that would have made it a partial fix, found by reading rather than by a red test:**
`beginAnnotation` RESETS the ctm (`opStreamWalker.ts`) rather than composing onto it. Seeding only
the *initial* ctm leaves annotation-borne images and rules in absolute space while the rest of the
page has moved — a mixed frame, in the direction where `imagePlacementRedacted` tests a stamped
image against redactions expressed in a different frame. The origin therefore has to be a named
`base` used at BOTH sites. **When a walker has more than one place that establishes its frame, a
frame change is not one edit.**

**The redaction filter is invariant under this, and that is provable rather than hoped for:** an
item's distance below the crop top is `(y1−y0) − (y−y0) = y1−y`, exactly what it was, and
`redactionRectToPageSpace`'s only origin term is `+x0` on x — which cancels against the translated
items. `redaction-crop-origin.browser.test.ts` (27) stayed green throughout.

**One freebie, stated because nobody will look for it:** overlay typed text was ALREADY
crop-relative (`textElementsToFlowParagraphs(…, vp.height)`), so on a cropped page a typed note was
interleaved against absolute source paragraphs and landed in the wrong place in the reading order.
That agrees now without a second change.

**A gap the sabotage round exposed, and the reason the guard has a leak case:** mapping the
redactions into the WRONG frame (`vp.viewBox` instead of `cropFrame`) left
`redaction-crop-origin.browser.test.ts` **fully green at 27/27**. Its image row uses a target wide
enough that a 30pt frame error still overlaps its own mis-placed test region — so it pins that the
filter EXISTS, not that it runs in the right frame. The new guard's image is deliberately narrower
(20pt) than the origin (50pt), because the only difference a wrong frame makes to a redaction rect
is an x-shift of exactly the origin. **A leak guard whose target is bigger than the error it is
looking for cannot see that error.**

Guards: `tests/browser/cropbox-origin-layout.browser.test.ts` (8 — y, image anchor, margins, the
image-under-redaction leak case, three LOCKSTEP cases that pass before and after, and a zero-origin
control), `tests/export/opStreamWalker.test.ts` (+5, including the annotation-reset case) and
`tests/utils/flowDoc.test.ts` (+4 for `translateItemsToCropOrigin`). It REPLACES
`blockers-cropbox-layout.browser.test.ts` — the `blockers-` prefix means "an `it.fails` stating
behaviour we do NOT have", so a green plain-`it` file under that name would be its own doc drift.
Sabotage-verified five ways, each landing where predicted: annotation reset → identity fails
exactly 1 (the annotation case); dropping the walker origin fails 3 (image anchor + colour +
underline — the layout cases stay GREEN, which is the recorded failure mode demonstrated); leaving
the words untranslated fails 5 (y, margins, and all three lockstep channels — S2's mirror image);
leaving link rects absolute fails exactly 1; the redaction frame mismatch fails exactly the leak
case. Byte-identical at a zero origin, and the entire 216-file jsdom suite is that guard.

### Internal links become bookmarks, and a link tags only the words it covers — limits row 22 (2026-09-27)

Until row 22 only a Link carrying a `url` reached the DOCX/MD/TXT flow; a jump inside the document ("see
Section 3", a contents page, a citation) exported as plain text. Now `_extractFlowDoc` resolves a Link's `dest`
with `resolveGoToDest` (`src/export/linkDest.ts`: an explicit array or a NAME through `getDestination`, a page
ref through `getPageIndex` or a bare 0-based index; the view top from `/XYZ`, `/FitH`, `/FitBH`, `/FitR`, none from
`/Fit`), moves the top into the TARGET page's crop frame, and gives the link an anchor KEY. After every page is
built — links point forward — and after the header/footer hoist, `resolveLinkAnchors` places a bookmark on the
paragraph the view lands on: the nearest one starting at or below the top (1pt slack), else the lowest paragraph
(the one the top falls in), and the page's first paragraph when the destination names no height. A target whose
page is not in the export, or a reference to no object, leaves the text plain. **A malformed destination is a
malformed link, never a failed export** — and both lookups can REJECT, measured in pdf.js 6.3.289, so both are
caught: `getPageIndex` on a reference to a missing or non-page object, and `getDestination` whenever the
`/Names /Dests` tree itself is corrupt (dangling, not a dictionary, or a `/Kids` entry to no object). An unknown name
merely resolves `null`, and the catch on `getDestination` was nearly deleted on the strength of that one probe;
`_extractFlowDoc` awaits the resolver with nothing around it, so an uncaught rejection fails the whole export. Word gets `InternalHyperlink` to a
`Bookmark` around the target paragraph's runs; Markdown gets `[text](#name)` and `<a id="name"></a>` after any
heading/list marker; text gets nothing. Names are generated (`_pdfturbo_link_N`), never read from the PDF; the leading `_` should make them
hidden bookmarks in Word, as `_Toc` ones are [Unverified: no Word on this machine].

**The bigger half was item granularity, and it was already costing external links.** pdf.js MERGES abutting text
runs into one item — three separate `drawText` calls came back as one `See Methods for the setup.` — and a word was
tagged only when its ITEM's centre sat inside the link. So a link inside a line tagged the whole line or none of it:
on the corpus 792 of 4,434 links (URL and GoTo) landed on no item centre, most of those in the arXiv papers, where
citation and section links sit mid-line. `splitItemAtLinks` now cuts a surviving LTR horizontal item where a link
edge crosses it — proportionally by character count, snapped within two characters to a token START for a left edge
and a token END for a right edge, so the space beside a linked word stays outside the link. 4,343 of 4,434 now tag.

**The pieces are NOT separate words — that was the first version, and it changed the exported text.** Each piece
got its own estimated `x`, line building sorts by `x`, and where items overlap another item sorted between two
pieces of one item: `library/html>` came out as `libraryhtml>` … `/` on 6 corpus pages. The pieces now ride on ONE
word as `linkParts`, with the item's whole geometry, colour and rules, and become separate runs only in
`buildRunsFromLines`. Measured: the reconstructed text of all 270 link-bearing corpus pages is identical with and
without links. **The cut runs after the redaction filter**, on text that survived it: an estimated boundary a
character off can move text between two parts of a surviving item, never out from under a redaction.

Bounds, stated rather than hidden: a tagged page takes the struct-tree path, which never receives link rects, so it
drops internal AND external links (pre-existing for URLs); lattice/borderless table cells carry no links; an RTL item
is not cut (its characters do not run left to right); two columns' paragraphs are chosen by height alone, so a link
into the right column of a two-column page can land on the left column's paragraph at that height; 91 corpus links
land on no text (not traced per link). A bookmark on a paragraph the running-header hoist removes would vanish —
resolution runs after the hoist for that reason, an ordering pinned by reading, not by a test. Cost, measured in the
browser harness at load ~2: Publication 17's 2,685 destinations (2,285 distinct) resolve, with their target pages'
crop origins, in 138 ms — sequential awaits and no memo, which is why there is none.

Guards: `tests/utils/flowDocLinkAnchors.test.ts` (25: placement rules, a missing target, sharing, the splitter and its
snapping, URL links through `reconstructPage`, no cut on RTL, a redacted item dropped whole, the three writers,
`resolveGoToDest` on every destination form, and a name lookup that rejects) and `tests/browser/docx-internal-links.browser.test.ts` (3, real pdf.js
through the real `_extractFlowDoc`: an explicit `/XYZ` into a page with a CropBox origin, a named destination, a
dangling reference, and a target page left out of the export). Sabotage, predicted first and each restored with
`cmp`: GoTo links never pushed → the 3 browser cases; the crop origin not subtracted → the 2 cases that check
`Methods` (it lands on the paragraph above); no split → 3 splitter cases + the 3 browser cases; no snapping → the
snapping case + the browser Markdown case (`[Methods ](#…)`); the view top ignored → 3 placement cases + 2 browser;
no `Bookmark` in DOCX → the writer case + the browser Word case; `linkParts` ignored → the URL case + the 3 browser
cases; no lowest-paragraph fallback → exactly that case; the `getDestination` catch removed → exactly the rejecting-lookup case; the `getPageIndex` catch removed →
exactly the unknown/dangling/out-of-range case.

### Flatten draws source annotations, the way the editor canvas shows them — limits row 23 (2026-09-27)

"Flatten & download" used to flatten AcroForm widgets only (`form.flatten()`); a note, stamp or shape authored
elsewhere survived as an annotation (C12, #62b). `src/export/flattenAnnotations.ts` now draws each source
annotation's normal appearance into its page and removes it, called in `_assemblePdfDoc` under `flattenAllForms`,
on the SOURCE before any page is copied or rasterised — so an annotation under a redaction becomes content under
the burn (pinned).

**The rule is pdf.js's canvas, not an idealised spec reading**, because that canvas is what the user saw: PDFturbo
renders with no `annotationCanvasMap`, so `beginAnnotation` (`pdf.mjs`) paints every viewable annotation onto the
page canvas — reset to the base transform, clipped to /Rect, through `getTransformMatrix(rect, bbox, matrix)`
(`pdf.worker.mjs`), inside its /OC marked content. The flatten emits exactly that:
`[/OC /PdfturboOCn BDC] q Rect re W n A cm /X Do Q [EMC]`. Four consequences, each deliberate:

- **NoRotate is ignored on a rotated page.** pdf.js honours it only on its own-canvas path, which PDFturbo does
  not use; a /Text note (pdf.js forces NoRotate on all of them) turns with the page in the editor, and so here.
- **Appearance selection is pdf.js `setAppearance`:** /N when it is a stream, else /N[/AS] — no fallback. A missing
  /BBox defaults to the rect's size, a missing /Subtype is set to /Form (the stream belongs to a throwaway load).
- **`Do` also clips to the form's /BBox**, which pdf.js does not — the one inherent difference: identical while the
  appearance stays inside its BBox, spec-correct when it does not.
- **No frame is converted.** /Rect and the appearance are in the page's user space, the same as its content
  stream, so every /Rotate and CropBox is right by construction. The appended ops rely on pdf-lib wrapping the
  existing content in `q…Q` before the first append, so a stray `cm` the page leaves behind cannot scale them —
  pinned by a fixture whose content ends in an unbalanced `2 0 0 2 0 0 cm`.

**Kept on purpose, not counted** — a SESSION-CHOSEN narrowing of "each source annotation": Link (stays
clickable), Popup (removed only with its flattened parent), **Redact** (a PENDING redaction: its `/AP /N` is normally
the mark that says one was placed — the black box is `/RO`, applied later — so baking it would put a redaction
mark into content over text that is still there, the classic hide-not-remove trap; a producer that put `/RO`-like
content in `/N` is not measured), **Widget** (left to `form.flatten()`; that call sits in a bare catch, and a
widget it failed on would, drawn here, show its old appearance while `/V` holds the user's value [Inferred: from
pdf-lib regenerating appearances inside `flatten()`, not reproduced]), FileAttachment/Sound/Movie/Screen/RichMedia/3D (the icon is not the
payload), and anything pdf.js does not view (Invisible, Hidden, NoView). **Skipped and counted**: no usable
appearance, or a zero-size rect — they stay annotations, and `toast.flattenAnnotationsSkipped` says how many.
pdf.js generates appearances for many such annotations when DISPLAYING them, so the editor showed them and the
export still does, as annotations.

**Flatten and Save now treat a redacted page differently, without either leaking.** Save strips a source
annotation that MEETS a redaction, whole; Flatten draws it into content first, so its uncovered part survives as
pixels and only the covered part burns. Nothing under the box survives either way; the pinned case covers an
annotation entirely, and a partially covered one is not driven by a test. The user's rotate button cannot change
the flatten at all — it runs on the source, before the page is turned — and a variant with a user rotation over a
/Rotate 270 CropBox page pins that too.

A flattened note's `/Contents` leaves the file only when nothing else reaches the note: a reply kept as an
annotation keeps its `/IRT`, `copyPages` then carries the note's dictionary, and the text sits in the bytes where
no viewer shows it — measured both ways and stated in `SECURITY.md`. Also stated: an annotation without the Print
flag prints once flattened.

**Real files, measured:** the 15-file corpus carries only Link and Widget annotations, both kept, so flatten leaves
every one of them unchanged — a no-regression result that says nothing about real markup. pdf.js's own annotation
test files do: FreeText, Highlight, Line, Polygon/PolyLine, Square/Circle, Squiggly, Stamp, StrikeOut and Underline
(12 annotations, 9 files) all flatten pixel-identically with their popups gone, and the Widget file is untouched.
Four are vendored in `tests/fixtures/annotations/`.

Guards: `tests/browser/flatten-annotations.browser.test.ts` (13 — the real-file case was split into one per file
plus a count case on 2026-09-27, after the four together timed out at the 30 s budget twice under full-suite load and passed
alone; the sabotage figures below were measured on the 9-case file, where it counted once) and `tests/export/flattenAnnotations.test.ts` (15).
The oracle assumes no frame: the source rendered by pdf.js WITH annotations must equal the export rendered the same
way — measured pixel-identical (no channel off by more than 40) at /Rotate 0/90/180/270, a CropBox origin, and a user
rotation — and,
since that alone passes if flatten does nothing, the export rendered WITHOUT annotations must show every flattened
colour (A plain, B through an /AS state whose /Matrix turns it 90°, a sticky note), the OFF-layer one must stay
hidden AND appear once the layer is forced on (without that half an OFF-layer case cannot fail), and the pending
/Redact must not be baked. Sabotage, predicted first, each landed and restored with `cmp`, re-measured on the final
code (browser figures out of the file's 9 cases, unit out of the jsdom file's 15 — measured before limits row 27
split the real-fixture case into one case per file, 13 browser cases now; the added ones were not re-measured): flatten never
called → 8 browser (the redaction case stays green: the strip already removes a covered annotation); an inherited
`2 0 0 2 0 0 cm` → 1 unit + 8 browser; identity transform instead of §12.5.5 → 7 browser; the first state instead
of /AS → 2 unit + 6 browser (green in the browser until the fixture listed `Off` first); no /OC wrapping → 1 + 6;
Redact drawn → 1 + 6; popups kept → 2 + 8 (the note's text then survives through the popup's `/Parent`);
not-viewed flags ignored → 1 + 6; the rect not normalised → exactly the reversed-rect unit case; skipped ones not
counted → 3 unit + 6 browser; popups swept page by page instead of after every page → exactly the cross-page unit
case (a popup may sit on another page than its parent — the sanitizer met that shape); `/F` read with
`lookupMaybe` again → exactly the malformed-key unit case. Three of those mutations (never called, identity
transform, flags ignored) leave an unused name that `tsc` rejects; vitest runs them as written.

**A malformed key must not fail the export — found at 6C, after 8321fd8 shipped.** pdf-lib's
`lookupMaybe(key, Type)` THROWS when the key holds another type; measured, a string `/F`, an array `/AP`, a
string `/Subtype`, a dictionary `/BBox` and a non-array `/Annots` each failed the whole Flatten, on files the
editor shows fine and that flattened fine before this row. pdf.js tolerates all of them, so every read is now
`lookup` + `instanceof` with pdf.js's defaults: `/F` other than a positive integer is 0, a non-name `/Subtype` is a
generic annotation (drawn), an invalid `/BBox` is the rect's size, an invalid `/Matrix` is identity, the stream is
drawn as a form whatever its `/Subtype`. Pinned by two unit cases, red on 8321fd8. Same class as row 22's
`getDestination` finding: a tolerant reader's input reached through a strict API.

### Export paths are consolidated

(the historic triplication is RESOLVED): `downloadPDF`,
`downloadPage`, `downloadPageAsImage` on `pdfTurboApp.ts` are now thin
one-line delegators to `_exportService`; the shared rotation/cropbox/watermark/ink logic
lives once in `src/export/exportPipeline.ts` (`buildPageOverlays`) + `exportService.ts`
helpers (`_applyOverlaysToPage`, `_saveOrDownload`). Apply export fixes in
`exportService`/`exportPipeline`, not in three places.

### XLSX table export (#56b, 2026-08-04) — and the numeric rule that a unit test cannot catch

`📊 exportXlsxBtn` (export flyout) → `ExportService.exportTableXlsx` → `src/export/xlsxWriter.ts`.
**No new dependency:** XLSX is OPC, the same ZIP-of-XML-parts container as DOCX, and this repo already
writes OPC zips with fflate's `zipSync` (`src/docx/opcEdit.ts`). The writer is **dynamically imported**
and is its own chunk (`xlsxWriter-*.js`). **fflate itself is in the entry bundle** since the 2026-09-13
upgrade: `@cantoo/pdf-lib` 2.11.0 imports it statically for PNG decoding, and `zipSync` appears in
`index-*.js`. This read "fflate stays out of the entry bundle — verified", which that upgrade made false
[WS7 round 10].

Detection is SHARED with the CSV export via a new private `ExportService._resolveTableGrid()` (lattice
first, then EH-E whitespace inference). The precedence lives in exactly one place on purpose — see
§ Export paths are consolidated for what happens here when it does not.

**Two ways XLSX must differ from the CSV writer, both easy to get wrong:**

1. **Do NOT reuse the CSV formula-injection guard.** `csvField` prefixes `= + - @` with an apostrophe
   because a CSV cell is parsed by the spreadsheet. In XLSX a formula is a distinct `<f>` element and a
   `t="inlineStr"` cell is text by construction, so copying the guard would corrupt data (a cell
   legitimately reading `-5` gains a visible apostrophe) while protecting against nothing.
2. **Numeric cells must be real numbers** — a text `"9.99"` cannot be summed, which is the entire
   reason to prefer XLSX over CSV. **The rule is subtler than it looks.** The obvious
   `String(Number(v)) === v` accepts `"9.99"` but REJECTS `"24.50"` and `"5.00"`, so a currency column
   comes out half numeric and half text. All 13 unit tests passed that bug because the fixture happened
   to use `9.99`; it was caught by exporting a real invoice-shaped table and reading the sheet XML.
   The fix compares against a canonical form that drops only **insignificant** trailing zeros, which
   preserves three protections as a side effect rather than as special cases: `007` stays text
   (significant leading zero), a 20-digit account number stays text (would lose IEEE precision), and
   `1,200` / `1e5` stay text. A trailing `.` also stays text — `"1."` is a numeral to JS but in a table
   it is almost always an ordinal marker.

**Verified by an INDEPENDENT reader, not just its own round-trip:** `openpyxl` loads the exported
workbook, reports `A1:C4`, types labels as `str` / Qty as `int` / Price as `float`, and **sums the Price
column to 39.49**. Note `libreoffice` is present in the cloud container but **`libreoffice-calc` is
not**, so `soffice --convert-to` fails on every spreadsheet — including a plain CSV. That failure looks
exactly like "the file I generated is corrupt" and is not; check whether the tool can open a trivial
file before believing it. Guards: `tests/export/xlsxWriter.test.ts` (18, asserting on the unzipped sheet
XML). The button is in the export flyout, so `/pdf-qa-sweep` never clicks it (the flyout closes on any
click) — it is covered by the live drive described above, not by the sweep.
i18n: one new key `toolbar.exportXlsxTitle` (ar accepted by the 2026-09-13 WS3 closure ruling, together
with the 7 `toolbar.cropMargin*` / `toast.cropMarginsTooLarge` keys added the same day and the rest of that
15-value set — **14 values pending as of 2026-09-27**, row 30's re-worded `toolbar.compressTitle` and `toast.ocrRotatedUnsupported`, row 27's `modal.compress.modeImages` and `modal.compress.hintImages`, row 23's new `toast.flattenAnnotationsSkipped` and re-worded `toast.flattenDone`, row 12's `progress.ocrLoadingModel`, row 11's `toolbar.clearRecentFiles`, the re-worded `toolbar.sanitizeTitle`, WS7 round 10's two new keys, round 15's `toast.pdfLoadRefused`, WS8's `toast.exportLayersConflict` and A6's `thumbnail.previewUnavailable`; § The
hide-vs-remove audit is the count's home, so update it there and here together). `toast.noTableFound` also dropped the word "ruled" in all three
locales, since neither table export is lattice-only any more — the Arabic edit is a word DELETION, so it
is verifiable at a glance.

### Form flattening (#62)

⊞ export-flyout button → `ExportService.downloadFlattened()`. The default export
fills+flattens a source's AcroForm **only when the user typed values** into it; an opened PDF's untouched
fields therefore survive into the export as orphaned **widget annotations** (`copyPages` drops the document
`/AcroForm`, so `getForm().getFields()` is 0 in BOTH paths — the residue is the page `/Annots` Widget, not the
form catalog). `downloadFlattened` passes `_assemblePdfDoc(…, { flattenAllForms: true })` → `form.flatten()` runs
on **every** source unconditionally, baking each widget's appearance into the page content stream and removing
the annotation. The opts param defaults false → byte-identical for the other 3 `_assemblePdfDoc` callers
(downloadPDF / downloadPageRange / assemblePdfBytes). Gated by `VITE_FEATURE_FLATTEN` (#28 seam, default ON;
`main.ts` removes the button when off). The app's own overlay annotations are already baked by `buildPageOverlays`;
source annotations (notes/stamps authored elsewhere) were ceiling **#62b** until limits row 23 drew their
appearances into the page — see § "Flatten draws source annotations". **The claim that "the redaction-rasterize path + PNG export already cover that nuclear
case" was FALSE and is retracted (2026-08-29).** It was reasoning about a path nobody had driven: the burn
is written into the page CONTENT STREAM and pdf.js paints annotation appearance streams AFTER it, so a
covered note/stamp/widget was repainted ON TOP of the burn and baked into the exported pixels — measured
`(255,0,0)` through an opaque black burn. Fixed by `stripRedactedAnnotations`; see § "A source annotation
under a redaction was painted OVER the burn". The residual #62b ceiling — an annotation NOT under a redaction
— was lifted by limits row 23 (2026-09-27).
**Form FILLS are undoable (#QA-2026-06-23 P1 fix):** the form-overlay change callback routes through
`app.handleFormInput` → `UndoRedoController.handleFormInput`, which sets `_formValues` live AND coalesces a
burst of edits to one field into a single `SetFormValueCmd` (`src/core/commands/formCmds.ts`) recorded after a
500ms idle (mirrors `handleTextInput`); `undo()`/`redo()` **flush** the in-flight edit (record, not discard).
Undo reverts the stored value and the existing `renderCurrentPage` re-render repaints the overlay input. The
old direct `setFormValue` mutation in the callback is gone (it stays on the app only for bulk session restore).

### XFDF import/export (#57)

`src/utils/xfdf.ts` is a **pure** codec (`buildXfdf`/`parseXfdf`/`parseXfdfDocument` via the platform
`DOMParser`, no dep) over a normalized `XfdfAnnot` record in **PDF user space** (points, y-UP, bottom-left,
0-based page), plus form `<fields>`. `src/export/xfdfMapping.ts` maps each coordinate through the page's
`XfdfFrame` (`elementToXfdfAnnot`/`xfdfAnnotToElements`, frame from `xfdfPageFrame`).
Maps **highlight↔`<highlight>`, comment↔`<text>` (sticky note), text↔`<freetext>`** and the shapes
rect/ellipse/arrow/freehand ↔ square/circle/line/ink (G21) both ways; other subtypes return null / nothing
(skipped, never mis-mapped). Export = `ExportService.exportXfdf` (XFDF↓ flyout button, plain
download); import = `PDFTurboApp.importXfdf(file)` (XFDF↑ button → hidden `xfdfInput`; builds elements with the
target page's id and adds them in ONE undoable `MacroCmd` — `app.elements` is a flat all-pages array filtered by
`pageId` at render, so multi-page import just sets the right pageId). Gated by `VITE_FEATURE_XFDF` (#28 seam).
**Non-obvious:** import constructs elements **directly** (not via `ElementFactory.fromJSON`, whose `applyBase`
overrides `el.id` with `data.id` → `undefined` when absent); the element constructor auto-assigns `id` via
`_nextId`.

**Limits row 26 (D18 + D21, 2026-09-27) — rotated and cropped pages, multi-line highlights, form fields.**
- **The frame is pdf.js's own viewport**, `pointViewport` at scale 1 and `totalRot = (/Rotate + docPage.rotation)
  % 360` — pdf.js `rotation` REPLACES `/Rotate`, so the sum is passed once — and `convertToPdfPoint` /
  `convertToViewportPoint` map POINT by point. Until then the module flipped y about the page top and shifted x
  by the CropBox origin with no un-rotation, so on any turned page every annotation exported elsewhere for any
  other reader; PDFturbo's own round-trip was self-consistent, which is why nothing caught it. A blank page takes
  the plain flip about its height (drawn unrotated in editor and export alike). The user crop needs no term:
  elements live in the full page's display space and `setCropBox` does not move user space.
- **Point by point, not box by box**: an arrow's two ends and an ink path are mapped one by one, so direction
  survives; a highlight writes `coords` (QuadPoints, TL,TR,BL,BR as the reader sees the text). On import each
  quad of a multi-line highlight becomes its own highlight (the app's highlight is one box).
- **A free text on a turned page carries `rotation`** on export [Unverified against Acrobat — row 29 pack]; on
  import it is parsed and ignored (the text box is upright in the editor).
- **`<fields>`** (`src/export/xfdfFields.ts`): every fillable widget on the pages the document shows, read through
  `getAnnotations()` like the form overlay (`getFieldObjects()` returned `{}` on the IRS corpus forms). Export writes
  the user's value, else the PDF's own; a button unticked is `Off`, a multi-select list one `<value>` per option; a
  name shared by two sources is written once, first in page order. **A field with any widget under a redaction is
  left out whole — typed and PDF values alike** (`annotationRectRedacted` over `redactionRectToPageSpace`, the test
  the export strip uses). Import fills every source that has the name, in the same `MacroCmd`, re-renders the page so
  the overlay shows it, and counts names no source has as skipped.
- **Undo restores an untouched field, not a blank one**: `SetFormValueCmd` takes `before: undefined` and DELETES
  the key. Storing `''` overrode the PDF's own value in the overlay (`stored ?? source`) — true of the typed-edit
  path too (`undoRedoController`), fixed with it.
- **Found and fixed on the way:** the form overlay crashed (`stored.split is not a function`) on a PDF's own
  pre-selected list, because pdf.js reports a choice value as an ARRAY; `sourceFieldValue` joins it.

Guards: `tests/export/xfdfMapping.test.ts` (the WS5 `pageHeightPt` pins ported to `xfdfPageFrame` against a stub
copying pdf.js's `PageViewport` transform, which pdf.js does not export), `tests/utils/xfdf.test.ts` (quads,
fields, rotation), `tests/export/xfdfFields.test.ts` (10 — the redaction LEAK cases for a typed and a PDF value,
a widget redacted through a second clear one, a `/Rotate 90` page, each with its CONTROL), the field cases in
`xfdfExport`/`xfdfImport`, and `tests/browser/xfdf-frame.browser.test.ts` (14 — the oracle assumes no frame:
coloured squares at KNOWN user rects, rendered by pdf.js at `/Rotate` 0/90/180/270, `/Rotate 90` + user 90, and a
CropBox origin at 0 and at 270 + user 90; an element on the square's PIXELS must export to the known rect and the
known rect import onto the pixels, and an arrow whose ends are NOT its box's min/max corners must keep its
direction). Sabotage, predicted first, each landed and restored with `cmp` (jsdom set + the
browser file): rotation forced to 0 → 2 + 8 (predicted 10: the `/Rotate 0` case, the CropBox case at 0 AND the
CropBox case at 270 + user 90 — total 0 — are right under it); user rotation not added → 1 + 4; CropBox origin
dropped → 1 + 4; arrow mapped through its box → 1 + 7; the fields redaction filter dropped → exactly the 5 LEAK
cases, controls green; highlight `coords` not parsed → 4 (predicted 3 — the export test reads its own output back
through the parser); import direction the identity → 1 + 7; import undo storing `''` → 1; no re-render after a
fill → 1; a choice array not joined → 2.

Ceiling **#57b**: stamps, polygon/polyline and the other subtypes stay skipped; freetext DA font appearance
(fontSize rides a non-standard attr for the app's own round-trip; Acrobat ignores it); a rotated freetext comes
back upright. Acrobat byte-exactness is unverifiable in-repo (no Acrobat — row 29 pack). **Bound:** on a
redaction-bearing page PDFturbo's own EXPORT is a raster, so its XFDF positions refer to the original page, not
to that image.

### Bates / page-numbering (#61 engine + #61b UI)

`src/export/batesStamp.ts` is a **pure** engine
(`batesStampText` page-mode `N / total` vs bates-mode `prefix+padStart(digits)`; `batesPosition` 6 anchors,
bottom-left origin) + `drawBatesOnPage` in `exportPipeline.ts`, threaded through **all** export paths
(`exportService.ts` passes `documentModel.bates` + the page's **full-document** `pageNumber`/`pageCount` into
`_applyOverlaysToPage`/`rasterizePageWithRedactions`/blank branch — so a single-page or range export still reads
"5 / 10"). UI = `src/ui/batesPanel.ts` (mirrors `watermarkPanel.ts` but **no preview canvas** — Bates is
export-only by design; reuses the `.watermark-modal`/`.wm-*` CSS, so no new layout). `documentModel.bates`
defaults **disabled** → export byte-identical (the engine `ctx.bates?.enabled` guard no-ops). **Non-obvious:**
(1) `SavedState.bates` is **optional with NO `SCHEMA_VERSION` bump** — a pre-#61b blob lacks it and restores via
the model-default fallback (`documentLoader.ts`: `state.bates ?? documentModel.bates`), so legacy sessions are
NOT discarded; (2) input coercion uses a NaN-safe `intOr` (NOT `parseInt(...) || fallback`) so a deliberately
typed `startNumber=0` is preserved (the engine emits `ACME-000000`) — the `|| fallback` idiom silently rewrote 0;
(3) Esc-to-close lives in `keyboardBinder.ts` (every modal needs its own branch there — `trapFocus` only handles
Tab); (4) `documentModel.toJSON()` now includes `bates` (it's dead code today but a future autosave refactor
calling it must not silently drop Bates). Gated `VITE_FEATURE_BATES` (#28 seam).
**#61c closed by limits row 28 (2026-09-27, D22).** `normalizeBatesSettings` (batesStamp.ts) is the ONE check a
settings object passes before it can reach the export: the panel's `apply()` and the session restore both call it,
so a restored blob can hold nothing the panel could not have produced. A field of the wrong type or outside its set
takes the fallback's value (the model's current settings on restore, the form defaults in the panel); numbers are
truncated and clamped. The start number is capped at `BATES_MAX_START` = 999 999 999 999 (twelve digits, the widest
the panel pads to): past 2^53 the number would round and past 1e21 `String()` writes it in exponent form. A stamp
wider than the VISIBLE page between its 24pt side margins is drawn at a smaller size so it stays on the page — the
visible width, so a turned page measures its short side; a stamp that fits keeps the chosen size and draws exactly
as before. The shrink is SESSION-CHOSEN; the ruling named only the cap, and the cap alone does not keep a long
prefix on the page. Guards: `tests/export/batesHardening.test.ts` (10), `tests/ui/batesRestore.test.ts` (3 — the
REAL `saveState`/`loadState` over fake-indexeddb and the real `restoreSession`: exact round-trip, legacy blob,
malformed blob) and a cap case in `batesPanel.test.ts`. Sabotage, predicted first, each restored with `cmp`:
restore not normalised → exactly the malformed-blob case; no cap → 4 (predicted 3 — the malformed blob also stores
`1e20`); shrink removed → the 2 shrink cases; shrink measured on the unturned width → exactly the turned-page case;
`Infinity` accepted → exactly the cap case.

### PDF sanitizer (#53)

`src/utils/pdfSanitizer.ts` `sanitizePdf(bytes)` strips `/Info`, XMP
`/Metadata`, `/OpenAction`, `/AA` (catalog + every page), and `/Names→/JavaScript` +
`/Names→/EmbeddedFiles` via pdf-lib key-deletion (no new dep; 1.31 KB lazy chunk). **Non-obvious:
it MUST load with `PDFDocument.load(bytes, { updateMetadata: false })`** [2026-09-28: the call is now the guard wrapper `loadPdfDocument(…, { updateMetadata: false, … })`; the requirement stands] — the default `true`
makes pdf-lib re-stamp `/Info` Producer + ModDate at *load time* (constructor → `updateInfoDict`),
silently re-injecting the metadata you're stripping. The same applies to any verification re-load.
Wired via `ExportService.sanitizeAndDownload()` (🧹 export-flyout button) over the **assembled**
export, not the raw source. Redaction-completeness check is deferred (#53b).

**Scope since 2026-09-05 (developer ruling): scripts, the non-JavaScript EGRESS class, and paperclip
attachments.** The WS7 round-8 panel found `/SubmitForm` and `/Launch` surviving with their URLs
intact; the ruling was made for the CLASS — `/SubmitForm`, `/Launch`, `/GoToR`, `/GoToE`,
`/ImportData` — because fixing one member and leaving its siblings is the defect shape this module
had already suffered three times (rounds 6, 7 and 8 each fixed one position of the `/A` script
chain). Egress actions ride the SAME `spliceActions` as scripts, so every position (head, `/Next`,
array element, form field, bookmark, cycle) is covered by construction and a `/URI` chained behind a
removed action survives. `/FileAttachment` annotations go whole, with their `/Popup`. **Removing the
annotation from `/Annots` is NOT enough**: a `/Popup` `/Parent` or a reply note's `/IRT` keeps the
attachment dict reachable, the sweep then keeps `/FS`→`/EF`, and the file is re-serialised with the
paperclip gone — the WS5 P1 shape again. So `/FS` is deleted on the dict itself. Two fixture lessons
from the sabotage round: a forward-loop `remove` is only observable when the Popup sits DIRECTLY
after the attachment (a note in between left the guard green), and the `/FS` delete is only
observable through a reference that is NOT itself removed (the `/IRT` reply) — the first version of
each fixture pinned nothing. Deliberately kept: in-document media actions (`/Rendition` without
`/JS`, `/Sound`, `/Movie`, `/GoTo3DView`, `/RichMediaExecute`). Guards: the ruled-2026-09-05 block in
`tests/utils/pdfSanitizer.test.ts` (15). Sabotage-verified five ways, each landing where predicted:
one subtype dropped from the set → exactly that subtype's case; forward loop → the Popup and `/IRT`
cases; `/FS` kept → exactly the `/IRT` case (2 once `128219d` added its P0 case, and **0 since round 9**
— the bytes are now cut on the Filespec one object down, so a dangling `/FS` reaches a stream that is
no longer there; the guard for the bytes moved with them, see below); `/Subtype` compared unresolved →
exactly the indirect case; annotation never removed → the three paperclip cases and no control (5 once
`128219d` added its cases, 7 after round 9 — the same mutation, re-measured each time cases were added
to the file, which is the discipline the ink-clip figures had to learn).

**The first version shipped a P0 of its own, found by a post-push single-lens review the same
night.** `/AF` (PDF 2.0 associated files) is a SECOND path from the paperclip dict to its Filespec; the
strip cut `/FS` and handled `/AF` on the catalog and pages, never on an annotation — so a paperclip
carrying `/FS` AND `/AF`, kept alive by a reply note's `/IRT` or a Popup on another page, re-serialised
its file while `report.fileAttachments` said `true`. Three more from the same review: a Popup listed on
a DIFFERENT page than its paperclip survived (attachments are now collected across all pages before any
page is edited); a `/Next` ARRAY containing itself overflowed the stack because `seen` recorded dicts
only (arrays are now memoised, `null` while expanding); and the SECURITY.md sentence "every claim in
this row has a test" was false for the kept-media list (it has one now). Both `/FS` and `/AF` go on the
dict, and `/AF` goes on every annotation, field and bookmark via `stripNodeActions`. Sabotage: `/AF`
kept on the paperclip → exactly the P0 case (**0 since round 9**: the backstop below cuts `/AF` on every
dictionary, so the per-node cut is no longer load-bearing on its own — the backstop's own `/AF` line
is, → the XObject case); `/AF` kept on ordinary annotations → the P2 case; no array memo → exactly the
self-cyclic array case. **When a strip cuts one path to a payload, list every key that can reach it
before writing "leaves the bytes".**

**WS7 round 9 (2026-09-05) found the walks' blind spots — 22 findings across the three lenses, twelve
of them code-shaped, two P1 from the safety lens and one P1 from the export lens.** The thread: the
sanitizer stripped the dictionaries its WALKS reached (catalog, leaf pages, listed annotations, `/Fields`
downward, bookmarks) while pdf.js reads `/AA` by INHERITANCE — `collectActions` calls
`getInheritableProperty({ key: "AA" })`, which walks `/Parent` up to the `/Pages` root
(`pdf.worker.mjs:1550-1556`, `:1357-1379` in 6.3.289). So a `PageOpen` script on the page-tree root, and a
`Keystroke` script on a widget's parent field that no `/Fields` entry names, both RAN in pdf.js after
sanitize with every report flag false — measured with `page.getJSActions()` and `getFieldObjects()`
before and after. A fourth walk would have closed two shapes; **one pass over every dictionary in the
file closes the class**, for the keys whose meaning is the same wherever they appear (`/AA`, `/AF`,
`/Metadata`, `/PieceInfo`, `/OnInstantiate`), plus the action splice on annotation-shaped dicts. `/A` is
deliberately NOT in that set — a structure element's `/A` is an attribute dictionary. The walks keep the
per-surface reporting; the backstop carries the guarantee.

**The second thread is that a Filespec is an OBJECT.** Cutting the paperclip's `/FS` and `/AF` leaves
the file in the bytes whenever anything ELSE still points at the Filespec — a kept `/Rendition` media
clip's `/D`, measured with `fileAttachments: true` and the payload present. So the Filespec itself now
loses `/EF` and `/RF`, wherever it was reached from (paperclip, `/AF`, the `/EmbeddedFiles` name tree),
and a media clip that shared it degrades to a name-only reference. Two consequences for the older
sabotage figures above: keeping `/FS` on the paperclip no longer fails anything (the stream it reaches
is empty), and keeping `/AF` on a node no longer fails anything (the backstop cuts it). Neither guard
went vacuous by accident — the guarantee moved one object down and one pass later, and the mutations
that guard it now are "Filespec never severed" and "backstop `/AF` dropped". The remaining round-9
shapes: `/AF` and XMP on a form or image XObject (PDF 32000 §14.3.2 and PDF 2.0 §14.13 allow both,
Photoshop images carry XMP routinely), `/PieceInfo` (stripped as metadata — Illustrator/InDesign embed
the source document with author paths there; a disclosure candidate in the lens's grading, cut here
because it is one line inside the same pass — ratified by developer ruling 2026-09-24), a 3D annotation's `/3DD` `/OnInstantiate`, a paperclip
reachable only through `/Fields → /Kids` (listed on no page, flag false), a paperclip's OWN `/A` and
`/AA` scripts (a regression from `3fc0863`, which pulled the dict out of `/Annots` before the strip loop),
`report.associatedFiles` assigned before the walks that set it, and a diamond through a shared script
dropping the `/URI` behind it on the second path (dicts are now memoised like arrays).

**Probe trap, from the safety lens:** `ctx.obj({ JS: 'app.alert(1)' })` makes `/JS` a NAME, which pdf.js
ignores — its first execution probes reported `null` before AND after, a vacuous check. The shipped
fixtures use that idiom harmlessly (the sanitizer keys on `/S`), but any test asserting EXECUTION must use
`PDFString.of`. The round-9 block does.

Guards: the round-9 block in `tests/utils/pdfSanitizer.test.ts` (11 — measured off the runner: 2645 → 2658 with the two opcGc cases, after an earlier draft of this sentence said 12) and two cases in
`tests/docx/opcGc.test.ts` (the export lens's P2: a `.RELS`/`_RELS/` relationships part was never
scanned, so the image only it referenced was DELETED — part names are case-insensitive and the module's
own header says every decision errs towards keeping). Sabotage-verified, each landing where predicted:
backstop `/AA` dropped → the two P1 inheritance cases; Filespec never severed → exactly the shared-media
case; backstop `/Metadata` dropped → exactly the XObject XMP case; backstop `/AF` dropped → exactly the
XObject `/AF` case; `/OnInstantiate` dropped → exactly the 3D case; `/PieceInfo` dropped → the PieceInfo
case and the dirty-fixture report; the paperclip branch dropped → 4 (the `/IRT`, own-scripts,
shared-media and `/Fields`-only cases); the collection loop no longer stripping the paperclip → **0, by
design** (the backstop catches it), and the two together → 4 (the `/IRT`, own-scripts, shared-media and `/Fields`-only cases — re-measured WS7 round 10, where this read 3); `associatedFiles` assigned in the pre-fix
order → the bookmark/field case and the XObject case; the revisited script yielding `[]` → exactly the
diamond case; opcGc case-sensitive again → both `.RELS` cases.

**WS7 round 10 (2026-09-13): an object pdf-lib cannot PARSE bypassed every walk.** pdf-lib keeps it as an
opaque `PDFInvalidObject` and writes it back verbatim, and every walk and the backstop test
`instanceof PDFDict` — so a JavaScript action inside a malformed Widget (a stray `}` in the dict, which
pdf.js skips with an `info()` and reads past) survived a sanitize with every flag but `/Info` false, and
pdf.js still reported `hasJSActions() === true` on the output. The sanitizer cannot strip what it cannot
read, so it REFUSES (`SanitizeRefusedError` → `toast.sanitizeRefusedInvalidObject`) — after the sweep, so
an unreferenced unparseable object is deleted and the file still sanitizes. **Probe trap:** pdf.js's
`getAnnotations()` reports a widget's `actions` as `{}` with or without a script; `hasJSActions()`, with
the widget listed in `/AcroForm /Fields`, is the probe that can answer both ways. **The kept-media
rationale was also wrong:** this section and `SECURITY.md` said pdf.js runs none of `/Rendition`,
`/Sound`, `/Movie`, …; pdf.js's `MediaAnnotationElement` loads and plays a clip on a click. Keeping them
may still be right (in-document, user-initiated), but the 2026-09-05 ruling rested on the false premise,
so it was flagged back to the developer rather than silently re-justified — and RE-RULED on 2026-09-24:
keep them, on the corrected premise (they play only on a user click and stay inside the document). Guards:
`tests/utils/pdfSanitizerInvalidObject.test.ts` (3) + the real-assembly case in
`tests/export/exportSaveRouting.test.ts`, which also proves the object survives `copyPages`. Sabotage: the
refusal removed → exactly those two cases, with the P1 reproduced on the output.

### Lock PDF wrote strings in plaintext — and broke them for the reader (WS7 round 10, 2026-09-13)

pdf-lib's writer encrypts `PDFStream` objects only. Every other string — a link's `/URI`, a note's
`/Contents` — was written as-is while `/Encrypt` told a reader every string was encrypted, so a locked
export leaked them to a text editor AND pdf.js with the correct password "decrypted" them into `""`.
`ExportService._saveForExport` now saves a password-protected export WITH object streams, which puts
ordinary objects inside encrypted streams — one seam for `downloadPDF`, `downloadPageRange`,
`downloadFlattened` and `downloadPage` (`_compressLossless` already used them) — and, since WS7 round 11,
`sanitizeAndDownload`, which had never applied the password at all. It re-loads the sanitized bytes with
`updateMetadata: false` first, because a default load re-injects the `/Info` the sanitizer just removed. **Password-gated on
purpose:** `assemblePdfBytes` feeds the signer, whose `assertClassicXref` refuses xref streams, so an
unencrypted save stays classic and byte-identical. What pdf-lib keeps OUT of object streams, and so stays
plaintext, is bounded in `SECURITY.md` § "Lock PDF". Guard: `tests/export/exportPasswordSave.test.ts`
(29 at limits row 27, which added "shrink images" as an entry point — read the runner's count — per entry point, sanitize and both text-keeping compress modes included: no token in the bytes, pdf.js with the password reads them back, no
document-information string in plaintext, and a no-password control that keeps a classic `xref`). Compress
joined the class in WS7 round 12, which found no test setting a password on it: its control asserts no
`/Encrypt` instead of a classic `xref`, since object streams are its optimisation, and the lossy mode — a
canvas raster — is a case in `tests/browser/compress.browser.test.ts`. Dropping either mode's
`_applyExportPassword` call fails exactly that mode's case. The
metadata case is split by path, because only `downloadPage` writes an `/Info` at all — the other
paths build with `cleanMetadata` or strip it, so for them the case asserts there was nothing to leak
rather than passing vacuously. Sabotage: the password branch without object streams → 11 (the 10 string
cases — five entry points, sanitize among them since round 11 routed it through the seam — plus
`downloadPage`'s metadata case; it read 9 until re-measured after round 12, which is why a figure is
re-run whenever cases join the file); the no-password branch with them → the 4 controls; sanitize ignoring the password → 1 (its plaintext
case — its read-back case passes on an unencrypted file, because pdf.js ignores a password it does not
need); sanitize re-loading with the stamp → 1 (its metadata case). `encryption.ts` claimed `/R 5`; since
2.11.0 pdf-lib writes `/R 6`.
**Inline annotations are hoisted before a locked save (limits row 15, C8).** pdf-lib writes the catalog, the page
tree and every page leaf OUTSIDE object streams (`PDFStreamWriter`'s `shouldNotCompress`), so an annotation written
inline in a page's `/Annots` array went out in plaintext with the page — and pdf.js with the password read it as
garbage. `encryptPdf` now calls `hoistInlineAnnotations` first, registering each inline `/Annots` entry as its own
object; `encryptPdf` has one caller, the export seam, so every locked save gets it and no unlocked one does. The
fixture's third note is inline, so all six entry points pin it. [superseded 2026-09-28: `bc64357` (limits row 27) added a seventh, `compressAndDownload (images)` — the `ENTRY_POINTS` table in `tests/export/exportPasswordSave.test.ts` is the authority for the counts that follow] Sabotage: hoist removed → the 12 locked cases (6
plaintext + 6 read-back); hoist on unlocked saves too → 4 classic controls, not 5 — an unlocked sanitize writes the
sanitizer's bytes directly and never reaches `_saveForExport`. **A non-array `/Annots` is read without a type check**:
the first version used `lookupMaybe(…, PDFArray)`, which THROWS on a malformed page pdf.js simply ignores, so a
locked export failed where the unlocked one succeeded (the other `/Annots` readers tolerate it); an inline dict there
is hoisted too, since it still holds strings. Pinned by the malformed-`/Annots` pair; dropping that branch reds
exactly the locked case.

### PDF compress (#60)

HYBRID modal (`src/ui/compressPanel.ts`, ⇩ export-flyout `compressBtn`, gated
`VITE_FEATURE_COMPRESS`). Three strategies over the **assembled** export bytes (`assemblePdfBytes()` — edits
baked in), wired as `ExportService.compressAndDownload(opts)`: (1) **lossless** "quick optimize" — re-load
`{updateMetadata:false}` (MUST — else pdf-lib re-stamps `/Info` Producer+ModDate at load, undoing the strip,
see [[reference_pdflib_updatemetadata_restamp]]) → `stripDocMetadata` (drops `/Info` + XMP `/Metadata` +
trailer `/ID`) → `save({useObjectStreams:true})`; keeps text/vectors/forms. (2) **lossy** "flatten to images"
— pdfjs renders each page to a JPEG at `dpiToScale(dpi)` (viewport honours page rotation → correctly
oriented), rebuilds an image-only PDF whose pages keep their **point** dimensions (`getViewport({scale:1})`),
drops selectable text. Pure helpers (`dpiToScale`/`clampDpi`/`clampQuality`/`stripDocMetadata`/
`compressLossless`) live in `src/export/compress.ts` (jsdom-testable); the canvas raster loop is in
ExportService (real-Chrome). **Non-obvious:** the export password (when set) is applied to the **same**
`save({useObjectStreams:true})` as the optimization — a re-load-to-encrypt would default `useObjectStreams`
back to false and undo the size win. Defaults **lossless** / **200 DPI / 0.8 quality** (conservative). Toast
reports before→after size + % saved (`formatBytes`).

**(3) "shrink images" — the former ceiling #60b, limits row 27 (D20, 2026-09-27).** Quick optimize plus each
embedded JPEG re-encoded IN PLACE: `src/export/imageDownsample.ts` plans, `browserJpegReencode` decodes, resizes
and re-encodes in the browser, and the stream is re-assigned under the SAME object number (`context.assign`),
so no XObject-replace API is needed — the reason the ceiling gave was never the obstacle. It runs inside
`_compressLossless` on the same document, so the metadata strip, the password and the object-stream save stay one
path. The DPI/quality fields drive it; an image shrinks so it shows at that DPI where it is drawn LARGEST, only
below a 0.9 factor, and only when the result is smaller. Every rule errs towards keeping an image, because one
shrunk below where it shows is a visible loss while one left big only costs bytes:

- **Measured by a walk, never guessed**: page content and every form it draws (`q`/`Q`/`cm`/`Do`, the form
  `/Matrix`, `/UserUnit`). `cm` composes as `multiplyMatrix(m, ctm)` — inner first. `contentStreamEditor`
  composed it the other way at two sites until limits row 47 fixed it (see § "True-edit composed nested `cm`
  backwards"); the two orders agree for any single or commuting `cm` and disagree for a rotation inside an uneven
  scale, which is the exact fixture pinning this walk (the wrong order shrinks a 75-DPI image as if it were 300).
- **Drawn only where measured**: every reference to the image must lead up, through resource and XObject
  dictionaries and forms the walk used, to a page leaf or page-tree node (`usedOnlyWhereMeasured` over a parent
  map of the whole object graph). An annotation appearance, a pattern, `/Alternates`, another image's `/SMask`, or
  a Resources dictionary shared with any of them makes it ineligible.
- **A stream the walk cannot follow measures nothing**: a malformed `cm`, a `Do` name that resolves (decoded or
  as written) to nothing, a form past depth 12 — every image that stream's resources can draw is left alone.
- **Only JPEGs a re-encode keeps meaning-identical**: DCT alone, 8 bits, DeviceRGB, DeviceGray (written back as
  DeviceRGB — a canvas writes three channels) or 3-channel ICCBased; no `/Decode`, `/DecodeParms`, `/ImageMask`,
  colour-key `/Mask` or `/Matte` SMask (whose size must equal the image's). A plain `/SMask` is kept and stays
  valid: the reader stretches a mask of any size over the image, and the test's 4 × 3 mask still cuts the shrunk
  image along the same line.
- **EXIF is stripped before decoding** (`stripExif`): Chrome applied an Orientation-6 JPEG's rotation while
  resizing even with `imageOrientation: 'none'` [measured 2026-09-27], and pdf.js draws it unturned. The option is
  still passed; the stripping is what the test pins.

Guards: `tests/export/imageDownsample.test.ts` (20, jsdom — fake header-only JPEGs, an injected re-encoder),
`tests/browser/compress-images.browser.test.ts` (4, real Chrome: the output image's `/Width`/`/Height`, four
quadrant colours rendered by pdf.js before and after, text still extractable, a turned placement, an image already
at the target left byte-identical, a plain soft mask still masking, an Orientation-6 JPEG unturned), two cases in `tests/ui/compressPanel.test.ts`
and the "shrink images" entry point in `exportPasswordSave`. Sabotage, predicted first, each landed and restored with `cmp` (jsdom = the two files above, browser = the
Chrome file): `cm` composed in reverse → 1 + 1 (the jsdom composition case and the browser turned placement); form
`/Matrix` ignored → 1; `/UserUnit` dropped → 1; malformed `cm` skipped instead of stopping → 1; unresolved `Do`
ignored → 1; usage check always passing → exactly the 3 usage cases, controls green; `/Matte` check removed → 1;
last placement wins → 2 (predicted 1 — the malformed-`cm` CONTROL draws the image again at 1 × 1 pt after the
4-inch placement); not-smaller guard removed → 1; EXIF not stripped → exactly the browser EXIF case; gray not
rewritten → 1; the mode not routed to the downsample → the 3 browser cases, the password case green (its fixture
has no JPEG) — those two figures predate the soft-mask case, which the mode sabotage should red as well [Inferred, not re-run]; the soft
mask removed from the replacement → exactly the soft-mask case. Not pinned: `colorSpaceConversion: 'none'` (no fixture
carries an ICC profile) and the form depth limit.
