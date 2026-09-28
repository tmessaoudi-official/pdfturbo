---
paths:
  - "src/export/exportPipeline.ts"
  - "src/export/exportService.ts"
  - "src/export/opStreamWalker.ts"
  - "src/export/pdfElementRenderer.ts"
  - "src/export/formHiddenText.ts"
  - "src/utils/geometry.ts"
  - "src/utils/flowDoc.ts"
  - "tests/browser/*redaction*"
  - "tests/browser/hide-vs-remove*"
  - "tests/browser/form-bbox*"
  - "tests/browser/raster-text*"
  - "tests/browser/_redactedAnnotationFixture*"
---

# pdfturbo gotchas — redaction

Moved verbatim from CLAUDE.md § Gotchas on 2026-09-28 (review-remediation 5.3, /rules-split). Scope: redaction burns, the hide-vs-remove audit, coordinate frames, Form XObjects, annotations under a burn. These entries are this project's decision register (the design docs they came from were removed in `ac4ef68`). New entries for this area go HERE, not into CLAUDE.md. A § "…" reference names a heading in CLAUDE.md or in another `.claude/rules/` file — CLAUDE.md § Gotchas indexes every one.

### Links on the redaction raster — re-created, never copied (A4, 2026-09-25)

A redaction-bearing page is exported as ONE image, so every `/Link` on it used to vanish.
`rasterizePageWithRedactions` now re-creates the safe ones. Three decisions, each pinned:

- **Collect ONCE, after `buildPageOverlays`, from the temp page's `/Annots`.** By then the page holds
  both the source links that survived `stripRedactedAnnotations` and the overlay links `renderText`
  just added. The redaction test is RE-RUN on every link: an overlay text box stacked under a
  redaction still renders on this path and still carries its link, so trusting the strip would
  bring a covered link back.
- **Rebuild, never copy.** `collectSafeUriLinks` returns only a rect and a URL — `/S /URI` only,
  through `sanitizeLinkUrl` — and `addUriLinkAnnotation` makes a fresh dict. Copying the source dict
  would carry `/AA`, `/PA` or a `/Next` chain into an output that until now had none. `GoTo` links
  are skipped: their destination page does not exist in the image page. Unreadable → not re-added.
- **One frame.** `mapLinkRectToRaster` maps all four corners through the render viewport's own
  `convertToViewportPoint`, minus the SAME `clipX/clipY` the crop clip uses (hoisted out of the crop
  branch for exactly this), then clips to the image page. A second mapping is the frame bug this
  repo keeps finding.

Guards: `tests/export/rasterLinks.test.ts` (19) and `tests/browser/redaction-raster-links.browser.test.ts`
(10), which samples the rendered pixel under every re-added `/Rect` — each link sits on its own colour
on a non-square page, far from both centre lines. Sabotage, each landing where predicted: filter
dropped → 2 unit + 9 browser (every survivor case, since covered links come back); sanitiser skipped
→ 1 unit + 8 browser (the `javascript:` link comes back); clip offset omitted → exactly the 3 crop
cases; raw user coordinates instead of the viewport → exactly the 5 rotated cases; re-add removed →
9 browser. One run printed `Tests no tests` at load 20 and was re-run — harness noise, not a result.
One more, found by review: `/Subtype` and `/S` are read with `lookupMaybe(…, PDFName)`, not `get` — a
legal indirect name reads as `12 0 R` through `get` and the link was silently skipped (the case that
pins it was red before the change). The sanitizer had the same defect once; see § PDF sanitizer.

### A redaction filter that read pdf.js's item box backwards — twice (2026-09-04)

`isItemRedacted` extended a source run `+x` by `|item.width|` from `transform[4]`. pdf.js's TextItem
box is **`width` along the transform's FIRST column and `height` along its SECOND**
(`pdf.worker.mjs:35904-35913` in pdfjs-dist 6.3.289), so a run drawn with a rotated Tm was tested in a box DISJOINT from
its glyphs and was never dropped — through DOCX, Markdown, TXT, CSV and XLSX, at every page rotation
**including 0**, and orthogonal to the CropBox origin. One predicate feeds the heuristic flow, the
struct-tree flow and the table extractor, which is why one bug reached five exports.

**The first fix was wrong in the opposite direction, and that is the part worth remembering.** It
took `max(|width|, |height|)` as the advance, on a reading of those lines that had the branches
INVERTED: I read 35814-35819 (pdfjs-dist 6.2.108 line numbers — the same lines are 35906-35911 in 6.3.289)
without the `if (!font.vertical)` immediately above them. For horizontal
text pdf.js sets `width = 0` and `height = hypot(trm[2],trm[3])` — the glyph size — and then
accumulates the advance into `totalWidth`. **`height` is therefore the font size for horizontal text,
never 0**, measured: `{str:"1", width:6.672, height:12, transform:[12,0,0,12,100,300]}`. So `max()`
inflated every SHORT run to a full em and silently deleted text that was clear of the burn — the
over-drop direction this file grades as harmful ("innocent cells deleted").

**And the control could not see it.** The guard hardcoded `height: 0` for horizontal text, a shape
pdf.js never emits, so the case named "the byte-identity control" was vacuous by construction. Same
family as the flate-compressed sanitizer marker and the load-dependent ordering test caught the same
day: **a fixture that does not carry a MEASURED shape cannot certify a claim about that shape.**
The HORIZONTAL fixtures in `tests/utils/flowDocRedaction.test.ts` carry probe output; the rotated
and vertical ones use plausible advances, because the probe cannot produce a rotated Tm or a
vertical font from this repo's fonts. Two earlier versions of this sentence overclaimed — first
"every fixture", then "every fixture in the WS5/WS7 block" — and the file's own docstring says it
correctly, which is where to read it.

The footprint is now `width` along column one and `height` along column two, transformed — which
reduced EXACTLY to the old `[x0, x0+width] × [baseline, baseline+size]` for unrotated horizontal text
— **until the same round extended it downward by a quarter em to cover the DESCENDER**, because a
redaction covering only below the baseline had left the run extractable. So it is the old box plus
that band, NOT byte-identical, and this sentence said otherwise for one commit. Sabotage-verified both ways:
re-introducing `max()` fails only the short-run case; extending `+x` again fails only the two
sideways cases.

**Vertical-writing runs — CERTIFIED 2026-09-25 (limits walkthrough A1), and the reading was half right.**
pdf.js marks a vertical run `dir: 'ttb'` (`pdf.worker.mjs:32549`) and reports `width` = glyph size,
`height` = `Math.abs(totalHeight)` (`:35958`) — so the downward sign survives ONLY in `dir`. Measured
against rendered ink on two genuinely vertical fixtures (pdf.js's own `test/pdfs/vertical.pdf`, now
`tests/fixtures/vertical/`, and a synthetic `Identity-V` run): the ink is CENTRED across the origin and
runs DOWN by the advance; the horizontal footprint sat right of it and ABOVE it, wrong on both axes, so
it leaked AND dropped text a redaction above the column never touched. `verticalItemRedacted` tests
±0.6 em across and 0.1 em past each end — margin, not measurement: pdf.js places a default-metrics
glyph from −DW/2 rather than centring it on its own width (a narrow digit's ink measured −0.48…+0.05),
so "centred" is not a safe assumption for every font, and custom `/W2` metrics stay unmeasured. **Three
traps found on the way:** LibreOffice's vertical Japanese is NOT a vertical font (one horizontal glyph per
position, `dir: 'ltr'`), so a vertical fixture must be checked vertical to pdf.js before it counts; pdf.js's
`vertical.pdf` renders NO text without `cMapUrl`, which `src/` did not pass until row 32 (see § "pdf.js's
CMap files are served by the app"); and an item's `dir` survives `translateItemsToCropOrigin` only because it spreads the item.
Guards: `tests/browser/redaction-vertical.browser.test.ts` (14: ink containment both ways, flow and table
at every user rotation, `/Rotate 90`, a crop origin, the data-loss mirror, both real files). Sabotage:
branch disabled → 12 of 14; sign flipped along the column → 12; centring dropped → 11 — non-vacuity and
LibreOffice stay green every time. The 0.1 em end padding is NOT pinned by any measurement, by design.

### Clipping is not removing, for anything vector — WS4-C refuted (2026-09-04)

> **[Re-checked 2026-09-28]** the `pdfElementRenderer.ts` / `exportService.ts` line citations below have drifted again — cite by symbol (`drawArabicLine`, `drawStyledTextLine`, `dropElementsUnderRedactions`). Since A5 the line layout IS shared (`layoutTextLines`, `src/export/textLayout.ts`), which weakens the "second implementation" argument; the whole-drop conclusion stands.

The blank-page redaction filter drops a partly-covered element WHOLE. WS4-C asked whether it could
clip the element to its un-redacted region instead. **Refuted, and the reason is measured rather
than argued:** a PDF clip is an instruction to the RENDERER, not a deletion. Drawing the secret
inside a clip path that excludes it leaves the page visually blank at that point (patch darkness
47.7 unclipped → under 10 clipped) while `getTextContent` still returns the string in full.

**The tempting precedent is WS4-A, and the difference is the medium.** Ink IS clipped to the
redactions and it works stroke-exact — because the ink layer is rasterised to its own canvas, where
a `destination-out` fill genuinely deletes pixels. A blank page's text, shapes and images are drawn
as vector content. Same word, opposite mechanism; the next reader will reach for the ink fix here,
which is why the pin carries both halves in one test.

**The second avenue — omitting the covered glyphs at the MODEL level, so nothing is emitted rather
than merely hidden — is refused for a structural reason, not a lazy one.** To know which glyphs a
box covers you must reproduce `renderText`'s layout exactly: list-marker prefixing
(`pdfElementRenderer.ts:200`), three different drawing paths per line — `drawArabicLine` (:211,
which reorders glyphs bidirectionally), `drawStyledTextLine` (:239) and plain `drawText` — four
alignment modes including justify's distributed word spacing (:227-234), and the `effectiveLineWidth`
model under `charSpacing`/`horizontalScale` (:222). A leak filter whose safety depends on a SECOND
implementation of that agreeing with the first is this repo's most-repeated defect shape, and it
errs by under-dropping.

**And the filter is model-level on purpose:** `dropElementsUnderRedactions` feeds THREE channels —
XFDF (`exportService.ts:538`), the blank-page PDF assembly (:841) and the DOCX/MD/TXT flow (:1304).
Whole-drop satisfies "never emit covered content in any channel" once; a partial render would have
to re-establish it in each, and express partiality in the persisted element model. **What it tests a
TEXT element against is its drawn extent, not its box** — see § "Typed text overflows its box".
(Line numbers re-read 2026-09-26; they drift.)

Images are unaffected by any of this and stay blunt regardless — there is no way to remove part of
an embedded image without re-encoding it, which `SECURITY.md` already disclosed.

Guard: the WS4-C case in `tests/browser/hide-vs-remove.browser.test.ts`. It asserts BOTH halves, so
it cannot pass on a document where the text simply never drew — removing the clip fails the
visibility half at 47.7, which is also what proves the darkness probe is aimed at real ink.

### A rule the reader never sees deleted a paragraph — the Form `/BBox` clip (2026-09-04)

> **[Re-checked 2026-09-28]** the `flowDoc.ts` line citation below has drifted — search the file for the redaction-region filter rather than the line.

WS4-F, and the first of the six PoCs to land as a fidelity fix rather than a leak fix. pdf.js clips
a Form XObject to its `/BBox` — `pdf.mjs:12534-12545` (6.3.289) does `save()`, then `transform(...matrix)`,
then `ctx.clip(rect(bbox))` — so anything a form draws outside that box is invisible on screen and
in every rasterised export. `walkPageOps` had **zero `BBox` reads**, so it reported that invisible
content as page geometry.

**That is data loss, not a cosmetic drift, and the chain is short.** `_detectLatticeRegions` derives
a table region from the clustered CENTRES of the rules, and `reconstructPage` then REMOVES every
word whose origin falls inside that region from the paragraph flow (`flowDoc.ts:1636`). One vertical
rule nobody can see therefore widens the region across ordinary prose, and the paragraph vanishes
from DOCX / Markdown / TXT with no warning. Measured on shipping code with a form whose `/BBox` is
100×60 and whose content draws one extra rule 300pt out: `vRules` came back with **3** entries and
the reconstructed flow was the **empty string** — the paragraph gone in its entirety.

**pdf.js does NOT cull the out-of-clip path from the operator list, and that had to be measured
rather than assumed.** Clipping happens at paint time in the canvas backend; the worker's evaluator
emits `constructPath` for the phantom rect regardless. Had it culled, the whole fix would be
unnecessary and the guard vacuous — which is exactly the shape that produced this file's earlier
"a synthetic operator table can only confirm what you already believe" lesson. The pre-fix count of
3 is the non-vacuity evidence and is asserted in the guard.

**The clip is applied AFTER the form `/Matrix`, because the `/BBox` numbers are in FORM space.** The
backend issues its clip once the matrix is on the canvas CTM. Building it from the pre-matrix ctm
puts the clip at the form's placement offset instead of over the form — for a form at (150,500) the
clip lands at page x 0..100 and drops the form's own content. Read out of `pdf.mjs`, not inferred.

**Classification runs on the UNCLIPPED rect, and that ordering is the direction guard.** The thin /
line-like predicate is applied first, then the accepted rule is intersected with the clip, so the
clip may only shrink a rule or remove it and can never admit one. Classify the clipped sliver
instead and a 40×40 shading block whose form exposes a 40×2 strip becomes a phantom underline —
the direction that INVENTS rules, which is how prose gets eaten in the first place. This is the
mirror image of `rotatedElementFootprint`'s "may only grow" rule (WS4-B): for a LEAK filter the
footprint may only grow, for a PROSE-DELETING filter the geometry may only shrink.

**So the image channel is deliberately left UNCLIPPED** — it feeds `imagePlacementRedacted`, which
is a leak filter, where over-approximating a footprint is the safe direction. Clipping all four
channels would be symmetric and wrong. Sabotage S3 (clipping images too) fails exactly one case.

**C22 is preserved by construction, not by discipline:** the clip is derived from `ctm`, which
already carries the CropBox `base`, so under an origin it lands in the crop frame in lockstep with
the four channels it filters. A clip built from the raw args would be a mixed frame — the exact
failure C22 exists to make unexpressible — and the guard pins the crop-frame width (80, not 50).

**Two smaller things worth carrying forward.** A REVERSED `/BBox` (`x1 < x0`) is legal to the canvas
backend, which issues `rect(x0, y0, x1 - x0, y1 - y0)` with a negative extent; the clip is therefore
built from all four transformed corners, the same normalisation the negative-height `re` case needed
in `locateDecorationRects`. And **pdf.js's own `getTextContent` TRUNCATES a text item at the page
edge** — a 51-character fixture line at x=200 on a 400pt page came back as `"…restated after t"`
with width 201.75, which reads exactly like a flow-reconstruction bug and is not one. The fixture
line is short on purpose.

**The bound was NOT disclosed in `SECURITY.md`, contrary to the plan that scheduled the PoC** — a
`git grep` for `BBox` / `Form XObject` there returns nothing. It does not belong there either: this
is an export-fidelity bound, not a leak, so this section is its home. Same class of plan-vs-reality
drift WS4-B found for its own bound; check where a bound actually lives before writing "updated".

Guards: `tests/browser/form-bbox-clip.browser.test.ts` (3 — real pdf.js: the phantom rule dropped
with the pre-fix count of 3 pinned as non-vacuity, the prose kept, and a CONTROL that the real
table is still detected and its text still excluded from the flow, which fails if the clip
over-reaches) and `tests/export/opStreamWalker.test.ts` (+11 pure). **The fixture is SYNTHETIC** —
the mechanism is real and pinned, no real-world file exhibiting it was found, and the field
frequency is unmeasured. Sabotage-verified five ways, each landing where predicted: dropping the
intersection fails 8 leak cases (6 pure + 2 browser, MEASURED 2026-09-05 — this read "the 7 leak cases" from the day it was written and was never run); classifying after the clip fails exactly the sliver case;
clipping images too fails exactly the image case; computing the clip before the `/Matrix` fails
exactly the offset case; never popping at the form End fails exactly the End case. A SIXTH
mutation pins the control rather than the fix — making `clipRuleRect` drop every rule inside a form
(the over-reaching clip) fails the phantom-rule case and the real-table case while the prose case
stays GREEN, which is what makes "the prose survived" evidence of a correct clip rather than of no
clip at all.

**The clip is for GEOMETRY, and applying it to the colour channel was a regression [WS7 round 7].**
WS4-F also clipped the `colorMap`, reasoning that "a colour dropped costs a black run, never a missing
word". True, and still wrong: colour is matched to a word BY POSITION, and the words come from
`getTextContent`, which no `/BBox` clips — so the run exported anyway and silently came out BLACK.
That is precisely the partial normalisation the C22 lockstep comment above says must be
unexpressible, committed by the very change that quotes it. Reverted for colour; the clip earns its
place on rules and vRules, where a phantom line widens a table region and `reconstructPage` then
DELETES the prose inside it. **Clip what invents geometry; never clip an attribute of a word that
exports regardless.** The guard case now asserts the opposite of what it asserted when it landed.

**And that exposed a pre-existing bound nobody had written down:** a run drawn past its form's
`/BBox` is invisible on screen and in every raster export, yet exported verbatim into DOCX/MD/TXT and
the CSV/XLSX tables (0 red pixels rendered, control 565). **Fixed by A2 (2026-09-26)**, and the reason
it once read "cannot be fixed" is worth keeping: `getTextContent` recurses into a form with only its
`/Matrix` — no `/BBox`, no marker (`pdf.worker.mjs:36468-36495`) — so its items carry no form identity,
and matching them by POSITION (the colour-map way) is inexact. But pdf.js DOES emit a marker for every
marked-content sequence and flushes the current item at each one (`:36548-36580`). So
`src/export/formHiddenText.ts` copies the page into a throwaway document, wraps every reachable form's
stream in a unique `/PDFTurboFormN BMC … EMC`, and reads the copy's text content: every item arrives
bracketed by its exact form chain. The copy's operator list carries the same tags right after each
`paintFormXObjectBegin`, so the k-th occurrence pairs with that placement's clip (`walkPageOps`'
`markedClips`). An item leaves only when its footprint — advance along its direction, height plus a
quarter-em descender, as an AABB — is wholly outside that clip.

Three things make it safe, and each is a sabotage case. **Trigger first:** the walk that already runs
sets `formTextOutsideClip` when a show op's origin is outside its form's clip; only then is the copy
paid for. Measured on the 15-file corpus: 3 pages trigger (all in one paper), 5 items drop — exactly the
5 render-confirmed invisible labels — and the other 357 pages pay nothing. The same paper driven
through the real `_extractFlowDoc` and `_extractPageTableData` (throwaway probe, not committed): the label
appears 5 times in each with the finder stubbed to return nothing, and 0 times with it live, with the
page's other text present. Those pages are untagged, so the struct-tree path is wired but no real file
drives it. **Pairing by occurrence:** a
shared inner form placed once inside a narrow outer form (hidden) and once on the page (visible) must
keep exactly one copy; pairing every placement to the first occurrence over-drops the visible one.
**Fail-open everywhere:** a different item count, string or origin between the copy and the page, a tag
counted differently in the text and the operator list, an undecodable form, a vertical-writing run, a
thrown error — each keeps every item. Markers inside annotation appearances are not counted, because
`getTextContent` never reads annotations. `/Subtype` is read with `lookup`: `get` returns a PDFRef for an
indirect one, and that form's hidden text would silently stay. The copy is loaded through
`loadPdfDocument(…, 'source')`, a pinned site; the verdict is a cache hit because every source prewarms.
Cost on the triggered file: 9.6 s for the first page (parsing a 2.1 MB file with 2,565 forms), then
about 4 s a page, at load 28. Bounds: a run crossing the box edge is one item and exports whole (pdf.js
gives no per-glyph advances); a run that starts after a `TJ` gap or an unpositioned second show op may
not trip the trigger; and the editor's own text layer still exposes such text. Guards:
`tests/browser/form-hidden-text.browser.test.ts` (8) and `tests/export/formHiddenText.test.ts` (18).
Sabotage, each landing where predicted: trigger off → the 4 export cases + indirect + fail-open + the
walker case; first-occurrence pairing → 3 pure + the 4 export cases; clip ignored → the 4 export cases
+ indirect + the walker case, control green; straddlers dropped → 4 pure + 4 export; `get` for
`/Subtype` → exactly the indirect case; annotation markers counted → exactly that case; each of the
three parity checks and the descender removed → exactly its own pure case. The parity checks are pinned
only at the pure level: no real corpus page diverged, so nothing honest drives them end to end.

**UNCERTIFIED-BY-EXECUTION, named rather than omitted:** the clip reset inside an annotation's
appearance stream. Both clipped channels (rules and vRules) gate on `annotationDepth === 0`, so no assertion can
distinguish resetting the clip there from leaving the page's in place; it stays to keep the stack
paired with the ctm, and the code says so. Content-stream `W n` clips are still not modelled at all.

### A rotated redaction burned a rotated box while every filter tested the upright one (2026-09-02)

WS4-B, and it turned out to be a live leak rather than the bluntness bound the plan described. A
redaction element renders a rotation handle like any other, the editor shows it rotated
(`elementLayerRenderer` sets `transform: rotate()`) and the export burns it rotated (`renderRedaction`
passes `rotate: pdfRotVal`) — but every filter tested the element's **stored, upright** box. A rotated
rectangle protrudes from that box along its long axis, so content under the protruding parts was
painted over by an opaque burn and left **fully extractable** in the DOCX / MD / TXT / CSV / XLSX
exports. Measured on shipping code: `SECRETWORD` present in both the flow model and the table items.

**The plan scoped B as the rotated ELEMENT's footprint; the rotated REDACTION is the same geometry with
the bigger blast radius**, because it reaches the SOURCE-text channels rather than only the blank-page
overlay drop. Both are fixed by one predicate.

**UNION, not replacement — and this is the part that looks wrong until you check it.** The obvious
"true footprint" implementation is the AABB of the rotated corners. At 90° a 120×20 box becomes 20×120,
i.e. **narrower on x**, so substituting it would stop dropping things that are dropped today. For a leak
filter the tested footprint may only ever GROW, so `rotatedElementFootprint` returns the union of the
stored box and the rotated AABB. That also makes the change additive by construction: every existing
drop survives. Sabotage S1 (seeding the AABB without the upright corners) fails 4 pure cases.

**A one-seam normalisation is only structural if callers pass the object through.** The fix went into
`redactionRectToContent`, which all five conversion sites reach — and the table path STILL leaked,
because four sites rebuilt a stripped `{x, y, width, height}` literal and dropped `rotation` on the
floor before the call. Hand-copying exactly the fields you need today is how a future field silently
fails to propagate; those sites now pass `el`.

**And the A fix, landed 40 minutes earlier, shipped the same bug.** `renderInkForExport` mapped the
stored rect, so under a rotated redaction the ink clip covered only the upright box and handwriting
under the protruding parts rode over the burn — the exact leak B closes, on the one path B's own
rect-building sites do not reach. **When a fix introduces a new consumer of a shape, that consumer
joins the class the next fix has to sweep.**

**The struct-tree (tagged-PDF) path was checked and is NOT a second leak.** `reconstructPage` hands
`structTreeToFlow` the already-mapped `contentRedactions`, not the raw display rects, so the ~15% of
files that are tagged inherit this fix — and inherited the C22 and rotation fixes before it — without a
second call site to keep in step. Worth stating because it is exactly where a sibling path would hide.

**One site is UNCERTIFIED-BY-EXECUTION and is named rather than omitted:** the OCR burn
(`ocrHandler.ts`) takes the footprint now, but no test drives it — sabotage S4 re-stripped `rotation`
there and the suite stayed green. Pinning it needs the OCR engine. The rasterizer/annotation-strip site
was in the same position and IS now pinned, by a case whose redaction is a tall thin bar that misses the
annotation upright and crosses it rotated.

Also worth knowing: this bound was listed in the plan as one of six "currently DISCLOSED in
`SECURITY.md`" and **was not in `SECURITY.md` at all** — only in the § "hide-vs-remove" bounds paragraph
here. It is disclosed there now, as closed.

Guards: `tests/browser/redaction-rotated-footprint.browser.test.ts` (8 — flow, table, blank-page drop
for both a rotated redaction and a rotated element, the rasterizer/annotation-strip path, plus an
unrotated regression control asserting the secret is still exported when nothing is rotated, which is
what makes the others rotation findings rather than filter-strength ones) and
`tests/utils/rotatedFootprint.test.ts` (8 pure, including "never shrinks on either axis" swept every 15°
and the negative-extent normalisation). Sabotage-verified five ways: replacement instead of union → 4;
rotation ignored → 4 browser + 3 pure; the CSV site re-stripping → exactly the table case; the
rasterizer site re-stripping → exactly that case; the ink clip back to the stored box → exactly the
rotated-ink case.

### Ink was stamped OVER the burn, and the fixture that "proved" the clip could not see a rotation (2026-09-02)

WS4-A, the first of the six disclosed bounds. `buildPageOverlays` draws the redaction burn inside its
element loop and stamps the ink layer **after** it, so a freehand stroke crossing a redaction was
composited on top of the opaque box and baked into the exported pixels — **visibly readable**, the same
grade as the 2026-08-29 annotation leak rather than the merely-extractable grade of the 2026-08-05 round.
Measured before touching anything: alpha 255 at the covered point.

**The clip is stroke-exact, and that came free from where the fix was placed.** Ink is rasterised to its
own canvas before being stamped, so a `destination-out` fill of the redaction rects removes exactly the
covered pixels and leaves the rest of the same stroke. The plan's floor was "drop (or clip) strokes whose
bbox intersects" — dropping whole strokes at the CALL SITE would have been the obvious reading and is
strictly worse. **Where you put a filter decides how blunt it has to be.**

**The lockstep is structural, again.** Strokes and clip rects both go through one local `toCanvas`, so the
clip cannot end up in a different frame from the ink it clips. Sabotage S4 (rects bypass `toCanvas`) fails
6 cases at 90/180/270 and passes at rotation 0, where the two mappings coincide by construction.

**And S4 is why the fixture is non-square AND off-centre.** The first version used a 200×200 page with the
redaction centred on it, and S4 left **every case green** — under central symmetry the right and wrong
AABBs are the same rect, so the fixture could not detect a rotation error at all. Only the end-to-end
cases, whose geometry is asymmetric, went red. This is CLAUDE.md's own "a square fixture cannot detect a
dimension swap" one step further in: **a CENTRED fixture cannot detect a rotation.** Both properties are
now load-bearing and commented as such.

**The end-to-end half is not optional.** Every helper case still passes if `buildPageOverlays` never passes
the redactions in — the exact shape that left the sign-rect prefill uncertified until 2026-09-02. Sabotage
S1 reverts only the call site and fails exactly the 4 e2e cases and nothing else.

`renderInkForExport`'s new `redactions` parameter is OPTIONAL, so the ~85% of pages with no redaction bake a
**byte-identical** PNG — pinned as a string compare, not asserted in prose. A redaction that covers every
stroke makes the function return `null` and stamp no image at all; that early-out predates this change.

Guard: `tests/browser/redaction-ink-clip.browser.test.ts` — **17, measured as 12 + 5**: twelve in the
clip block (4 rotations x erased/over-reach-control, plus byte-identity, non-vacuity, a far-away
redaction and one more) and five end-to-end through `renderThumbnailWithOverlays`. The breakdown read
"4 rotations x …, 4 standalone, and 5 end-to-end CASES, …, plus 4 end-to-end", which listed both
groups twice and summed past 17 — the same over-counting this file already had to correct for the
env-update suite's per-section tallies. Read the split off the runner
(`--reporter=verbose`, group by describe), never off the prose.
It shares `_redactedAnnotationFixture.ts` with the two annotation-strip files, which gained an optional
`strokes` field; a copied fixture is how a frame fix lands on one caller and not the other. Sabotage-verified
four ways — **RE-MEASURED 2026-09-04 against shipping code, because `347fa63` added a 5th
end-to-end case and neither figure had been updated**: call site reverted → 5 of 17; clip disabled
→ 11 of 17; clip the whole canvas → 13 (including all four
over-reach controls, because an all-transparent canvas makes the helper return `null`); wrong frame → 6.

### The `redaction-orphan-leak` flake did NOT reproduce in 9 file runs — and the obvious cause is refuted (2026-09-02)

`tests/browser/redaction-orphan-leak.browser.test.ts` was recorded as flaky after **one** observed
red (1 failed / 2 passed, 2026-08-29, inside a full-suite run; it passed on an immediate re-run and
in that same day's full run). No failure output was ever captured, so this round set out to
reproduce it before touching anything. **It did not reproduce: 9 runs of the FILE, 0 failures** — 6
isolated (load ~16 on 8 cores) and 3 in-suite (full browser runs at load 16.7–19.6), i.e. 27
`it`-block executions.

**Count the FILE runs, not the `it` blocks — and treat 3 as thin.** The original observation was
"1 failed / 2 passed", which is one file run, so file runs are the comparable unit; quoting 27
inflates the sample fourfold in exactly the way this repo already had to correct for the
env-update suite's `✓` marks. Only 3 samples exist under the condition the flake was actually seen
in, and **3 clean full-suite runs are what you would expect 73% of the time even at a 1-in-10 rate**.
So this is "not reproduced", never "fixed" — and nothing here licenses deleting the flake note.

**The timeout hypothesis is REFUTED, not merely unconfirmed, and the measurement inverts the
intuition.** The natural theory is "slow under full-suite contention, exceeds `testTimeout`". In
fact the test is **FASTER in the suite than alone** — 2689 / 3014 / 3653 ms in-suite versus
4124–13221 ms isolated — because by the time the file runs, pdf.js's worker is already warm. The
budget is 30s and the slowest test anywhere in the browser suite is 10076 ms. So contention makes
this file *cheaper*, and a timeout bump would have been a bandaid aimed at the wrong mechanism.

**Where the time actually goes** (probe, one run): `getDocument` worker spin-up **1797 ms**,
`assemblePdfBytes` 356 ms, verify `getTextContent` 194 ms, the byte scan **24 ms**, the
`includes` + `toUpperCase` 13 ms. So the dominant cost is not the test's subject at all, and the
component CLAUDE.md's § "A flaky gate" rule trains you to suspect — scanning bytes for a string —
is 1% of the runtime, decodes 1.44 MB, and looks for a **42-character** token. A coincidental match
is not a quantitatively plausible mechanism here; that rule's warning is about SHORT sequences.

**Still open, and deliberately unpatched:** Chromium canvas/resource exhaustion surfacing as a
transient export failure, or a browser crash. Both are consistent with a single red inside a long
run and neither is proven. **One data point arrived unbidden during this round's own deploy gate**:
`npm run test:browser` failed at load ~16 with `Failed to connect to the browser session … within
the timeout`, reporting `Test Files (84) / Tests no tests / Errors 1` and exit 1 after 60s; the
identical command passed at load ~6 minutes later. That is not this flake's shape — it kills the
whole run rather than one test — but it establishes that **the browser harness has load-dependent
failure modes that surface as a red with no product defect behind them**, which is the family the
single 2026-08-29 observation most likely belongs to. Re-run before believing a lone browser red,
and record the load. **No retry, no timeout bump, no `2>/dev/null`** — under the anti-bandaid
gate, a fix for a failure mode with no captured evidence is itself the defect.

**What DID change is diagnosability, so the next occurrence is legible.** The ctx's error hooks
threw away everything but the i18n key. Two corrections, applied at all three sites across both
files that use the pattern rather than only the flaky one:

- `IErrorReporter` is `warn(msgKey, params?)` but `error(msgKey, err?, params?)` — the second
  argument means *different things*. The first version of this fix typed `warn`'s as a cause, which
  would have stringified a params object as though it were an exception. **Check the interface
  before writing a handler for it**; `hide-vs-remove` already had `warn` right and `error` wrong.
- `error` now carries the cause (`err.stack ?? err.message`) instead of dropping it.

**UNCERTIFIED-BY-EXECUTION, and worth stating plainly: no current fixture in that file can reach
either hook.** Sabotaging `renderElementToPdfLib` to throw on a text element left the suite green —
the only text element there is dropped under the redaction before rendering, and a redaction render
failure fails CLOSED and rethrows raw (correctly: a swallowed redaction render would ship an
un-redacted page). So this is a defensive diagnostic that has never fired, said out loud rather
than sold as a proven improvement.

### A source annotation under a redaction was painted OVER the burn (2026-08-29)

The burn is written into the page CONTENT STREAM; pdf.js paints annotation appearance streams
**after** it. So a FreeText note, a stamp or an un-flattened form widget sitting over a redaction was
repainted on top of the opaque burn and baked into the exported pixels — **visibly**, which is a worse
grade than every leak found in the 2026-08-05 round, where content was merely extractable. Measured:
the covered annotation's centre sampled `(255,0,0)` through the burn, with a burn-only control sampling
black in the same image.

**This refuted a claim in this very file** — #62b's "the redaction-rasterize path + PNG export already
cover that nuclear case". That sentence had never been driven; it was reasoning about a path nobody had
run. The lesson is the one the 2026-08-05 entry already recorded and this round proves again: **a
documented ceiling is a hypothesis until a test drives it.** Prefer deleting such a claim over
softening it.

Fixed at the shared collaborator: `stripRedactedAnnotations` (exportPipeline) drops any annotation whose
`/Rect` meets a redaction, called from `rasterizePageWithRedactions` AND from `_applyOverlaysToPage` —
the latter because `downloadPageAsImage` and `renderThumbnailWithOverlays` both rasterize what it
produces and carried the identical leak. A per-site fix would have left the next rasterizing caller on
the same cliff. `annotationRectRedacted` is pure and exported, normalises reversed `/Rect` corners (the
spec does not require lower-left-first, and a reversed pair fails OPEN), and fails CLOSED on an
unreadable rect.

**The guard's CONTROL is the load-bearing half.** `annotationMode: DISABLE` would satisfy the leak
assertion while silently deleting every annotation on a redacted page, so the guard asserts that an
annotation clear of every redaction still renders green. **A leak guard needs a case that fails when the
fix over-reaches, not only one that fails when it under-reaches.**

**AND THE FIX ITSELF SHIPPED THE SAME BUG — caught by the review panel, not by the suite.**
`buildPageOverlays` MUTATES the page it is handed: `page.setRotation(totalRot)` and
`page.setCropBox(effBox)`. The strip was placed AFTER that call in `_applyOverlaysToPage`, so it
read a DOUBLED rotation (`srcRot + 2·userRot`) and the NARROWED crop box, while the redaction
elements are still in source-box display coords. On any rotated or cropped page the covered
annotation therefore survived — on exactly the two callers the strip was added for
(`downloadPageAsImage`, `renderThumbnailWithOverlays`), since every other caller routes a
redaction-bearing page to the rasterizer instead. The rasterizer escaped it only by accident of
capturing `srcRot` early and passing `skipCropBox`. **Both call sites now take the frame from
pristine state, before `buildPageOverlays` runs.**

Three things to carry forward. **A collaborator that mutates its argument turns "read it again"
into a different value** — check for `set*` calls before reading page state around one. **The
guards were written at rotation 0 with no crop**, which is the same "a rotation bug shipped inside
a rotation fix" shape recorded for the 2026-08-05 round, two entries down; a fix for a frame bug
must be pinned at every frame. And **the element coords are DISPLAY space**, so a guard that holds
a redaction rect fixed while rotating the page is measuring nothing — the burn genuinely moves off
the target, and the test asserts a leak that is not one. `redaction-annotation-frames` derives the
rect per rotation via `contentRectToDisplay` for that reason.

Guards: `tests/browser/redaction-annotation-frames.browser.test.ts` (6 — every rotation and a
crop, driving `renderThumbnailWithOverlays` end-to-end; asserts NO red pixel survives anywhere
rather than sampling a computed point, so no coordinate arithmetic of the test's own can mask the
leak), **`tests/browser/redaction-annotation-image-export.browser.test.ts` (6, added 2026-09-02 —
the SAME six cases driving the other rasterizing caller, `downloadPageAsImage`)**,
`tests/browser/redaction-annotation-burn.browser.test.ts` (8, real pdf.js pixels — 3 at rotation 0
plus 5 covering all four rotations and a crop) and
`tests/export/redactedAnnotations.test.ts` (17). Sabotage-verified three ways: removing the strip fails
every leak case and no control (6 of 8 in the burn file), a forward loop fails the
adjacent-annotations case and the wrong-typed-entry case (`PDFArray.remove` shifts later indices
down, and the catch re-uses the same removal), and dropping the CropBox origin fails exactly the
origin case. Restoring the PRE-FIX ORDERING (reading rotation and crop box AFTER
`buildPageOverlays` mutates them) fails **5 of 6 in EACH** browser file — every case except the
rotation-0-no-crop regression control, which the pre-fix code got right — with the covered
annotation repainted whole (24000 red pixels at scale 2) rather than partially [measured
2026-09-02]. **Those counts are the measured ones** — an earlier version of this sentence said
"exactly the leak case" and "exactly the adjacent-annotations case", which stopped being true the
moment cases were added to the same files without re-running the sabotage.

The two browser files share `tests/browser/_redactedAnnotationFixture.ts` deliberately. A copied
fixture is how a frame fix gets pinned on one caller and not the other — which is precisely the
defect these guards exist to catch, transposed from the source onto the test surface. Until
2026-09-02 the image export was covered only by `tests/export/imageExportOptions.test.ts`, which
stubs pdf.js at the module seam: it drives `downloadPageAsImage` six times and still went green
against the reverted fix, because what it pins is the option → viewport/format/save-name wiring,
not the pixels. **A test that drives the right entry point can still be blind to the whole
mechanism underneath it.**

### `walkPageOps` ignored Form XObject boundaries, and the fixture that "proved" the fix was vacuous (2026-08-29)

A form XObject is an implicit `q`/`cm`: pdf.js's canvas backend saves the state and applies the form's
`/Matrix` on `paintFormXObjectBegin`, restoring at `End`. The walker handled neither, so an image inside
a form reported the form-LOCAL ctm — `imagePlacementRedacted` placed its footprint wrongly and a redacted
picture exported into DOCX/MD/TXT intact — and the form's inner `cm` **leaked out and compounded
MULTIPLICATIVELY**: a page-level `[100,0,0,50,20,20]` placement after a form containing
`100 0 0 50 0 0 cm` was reported as `[10000,0,0,2500,2000,1000]`.

**Two traps, and both are about fixtures rather than about forms.**

First, the throwaway probe that started this thread asserted, from a HAND-BUILT OPS table, that pdf.js
reports the form-local ctm *and* re-emits the form matrix as a `transform`. It was wrong about real
pdf.js. Dumping the actual operator list settled it in one look:

```
paintFormXObjectBegin[[1,0,0,1,150,500],[0,0,200,200]]   ← the /Matrix is THIS op's first arg
transform[...]                                            ← only the form's INTERNAL cm arrives so
paintImageXObject[...]
paintFormXObjectEnd[]
```

**A synthetic operator table can only confirm what you already believe.** When the question is what a
library emits, dump it.

Second, the first version of the browser guard placed the form with a page-level
`q 1 0 0 1 150 500 cm /Fm0 Do Q` and gave it no `/Matrix` — and **PASSED against the unfixed walker**,
because the placement rode an ordinary `transform` that already worked. A Form XObject fixture MUST
carry its own `/Matrix` or it tests nothing about `Begin`.

Blast radius, stated because nothing pinned the old values: rules and text origins inside forms also move
from form-local to page space. That is the desired direction — a coloured run or an underline inside a
form previously keyed at a position `getTextContent` never reports, so it silently failed to match.

**The same class had a THIRD member, found by the panel: `beginAnnotation`.** An annotation's
appearance stream is placed by ops the page content stream never shows — pdf.js does `save()` then
composes `transform` and `matrix` (its args[2] and args[3]) and restores at `endAnnotation`. Without
them an image painted by a Stamp or FreeText appearance reported its ctm at the PAGE ORIGIN, so
`imagePlacementRedacted` **missed** a redaction over a stamped image *and* **falsely dropped** one
whenever a redaction happened to sit at (0,0) — a filter erring in both directions at once. Note the
annotation strip above does NOT cover this: `_extractFlowDoc` walks the ORIGINAL source page, not the
stripped export copy. `beginAnnotation` RESETS the ctm rather than composing onto it, which is why
the matching `endAnnotation` pop is unobservable in current pdf.js output and is kept as defensive,
**explicitly unpinned** — sabotaging it leaves the suite green, and the code says so.

**Checked and deliberately NOT changed:** `paintInlineImageXObject` and `paintImageMaskXObject` are not
recorded by the walker. That is not a leak — images reach the DOCX export only via named
`paintImageXObject` placements resolved through `page.objs`/`commonObjs`, so an inline image or stencil
mask never enters that export at all. Recorded so nobody adds the recording without the filtering, which
is the one change that WOULD open a leak here.

Guard: `tests/browser/redaction-form-xobject.browser.test.ts` (10, real pdf.js). Sabotage-verified in both
halves independently: removing the `End` pop fails exactly the two leak-out cases; removing the `Begin`
composition fails exactly the placement and redaction cases.

### The redaction filter compared two coordinate frames — a non-zero CropBox origin defeated it, and images were never filtered at all (2026-08-28)

> **[Re-checked 2026-09-28]** the call-site count below is stale — re-count as this section itself says; do not quote it.

Three live leaks, each reproduced against shipping code with a passing control before any fix.

**1. The CropBox origin.** pdf.js reports text items in **absolute** PDF user space
(`item.transform[4]/[5]`); a redaction element's rect is relative to the **rendered** page box, i.e.
the CropBox. They differ by exactly `(viewBox[0], viewBox[1])`, which is `(0,0)` on almost every
page — so the two frames coincide, every fixture agrees, and the mismatch is invisible. Measured on
`/CropBox [50 50 350 350]` with the secret at absolute `100,300`: the flow model returned the
secret's paragraph verbatim and `_extractPageTableData` returned `SECRETWORD|PUBLICWORD`.

**The inventory is the lesson.** The repo already knew about this: `pdfElementRenderer`
(`cropOriginX/Y`) and the OCR burn (`unrot.viewBox[0]/[1]`) both add the origin, and the OCR one
even carries a comment naming the renderer as its precedent. **Both paths that BAKE pixels handled
it; both paths that EXTRACT text did not.** A concern known and solved in half the places it applies
is the repo's recurring shape — same as the `/Rotate` leak, same as the three-of-four `hookTimeout`.
`grep -rn "cropOrigin\|viewBox\[0\]" src/` is the one-line check.

**Fixed at the origin, not per call site:** `redactionRectToPageSpace` (geometry.ts) maps a display
rect into the items' frame, handling rotation and origin together; `isItemRedacted`'s third argument
is now `pageTopY` (`= viewBox[3]`), not `pageHeight` — those two numbers are equal only when the
origin is zero, which is why passing the height was right until it wasn't. `reconstructPage` takes an
optional trailing `viewBox`, defaulting to `[0,0,pageWidth,pageHeight]` so every existing caller and
every existing call site is byte-identical. Precise counts, since a wrong one here would be exactly
the kind of claim this file exists to prevent — and the correction below was itself wrong on its
first attempt, which is the joke this paragraph keeps making: **58 call sites in all, of which one is
production (`exportService.ts`) and 57 are tests** (plus the definition itself, which `git grep`
counts and this sentence does not). It read "58 … one … and 56", which does not add up. RE-COUNT with
`git grep -h 'reconstructPage(' -- src/ tests/` rather than citing any of these numbers. The
production site is `exportService.ts`, the only one that passes the viewBox argument.

**A useful side effect, verified rather than assumed: the redaction filter is now structurally
independent of `getViewport`'s `rotation: 0`.** `viewBox` is rotation-invariant (only `width`/
`height` swap), so the filter no longer reads either. Mutating `{scale:1,rotation:0}` → `{scale:1}`
leaves the new guard 27/27 green. Note the honest negative that goes with it: **that mutation did not
produce a leak on the PRE-fix code either** — at 90° the wrong un-rotation dims and the wrong flip
base cancel for this geometry (14 failed either way, square or non-square crop). So do not record it
as "the rotation guard was vacuous and is now closed"; record it as "that argument is no longer
load-bearing for redaction" (it still is for layout dims — margins, column detection).

**2. Source IMAGES under a redaction were never filtered.** Four text channels were filtered and the
image channel was not, so a redaction over a picture removed the words on top and embedded the
picture whole. On a scan the whole page is one image XObject — the canonical redaction case, exactly
inverted. `imagePlacementRedacted` (exportService) now tests the placement, computing the footprint
from **all four corners of the unit square under the CTM**, not `|a|`/`|d|`: for a rotated placement
the `|a|/|d|` box is too SMALL, and under-dropping is the one direction a leak filter must never err
in. Drop-whole is deliberate and disclosed in `SECURITY.md` — one redaction now removes a scan from
these exports; burning the box into the bitmap (as the OCR path already does) is the follow-up.

**3. A square fixture cannot detect a dimension swap.** The first version of the guard used a 300×300
crop box. Sabotage found it: the rotation mutation changed nothing. Made it 300×240. The origin was
already asymmetric `(30,70)` for the same reason on the other axis — **apply that rule to BOTH axes,
and to the page box as well as the origin.**

Guards: `tests/browser/redaction-crop-origin.browser.test.ts` (27 — origin × 6 rotations × flow and
table, plus the image channel, plus a contract pin asserting pdf.js still reports absolute
coordinates so a future upgrade says so in one line) and `tests/utils/redactionPageSpace.test.ts` (12
pure, including an identity check against the mapping it replaced at every rotation). Sabotage-
verified: dropping the `viewBox` argument fails exactly the 6 flow rows, reverting the table path
exactly the 6 table rows, removing the image guard exactly the 2 image rows.

### The hide-vs-remove audit — every surface graded, and two more traps found (2026-08-05)

> **[Re-checked 2026-09-28]** two `contentStreamEditor.ts` line citations below have drifted — cite the font gates by symbol (`isType3Font`); the "fourth leak … DISCLOSED rather than fixed" paragraph is marked superseded in place.

Crop's disclosure gap begged the obvious question: **what else claims, or merely implies, removal?** So
every surface a user could believe deletes content was graded — building a file, performing the operation,
and trying to recover the content with pdf.js. `tests/browser/hide-vs-remove.browser.test.ts` (7 tests)
pins six of them; **two of those drive the real export bake** (shape, redaction) and the rest exercise the
underlying operation directly, so they pin the MECHANISM, not that every export path invokes it. The
remaining rows come from code reading. The grades are a user-facing table in `SECURITY.md` § *"Hiding is
not removing"* (which absorbed and kept the crop § rather than replacing it). **Say which is which** —
the first draft of that table claimed every row was test-pinned, and a reviewer refuted it.

**Verdict: six surfaces genuinely REMOVE** — redaction (rasterises), page delete (never copied),
extract-page-range (same mechanism), compress→**flatten-to-images** (rasterises; the *lossless* setting
does not), export-page-as-image (rasterises), and **true-edit delete**, which is the only one that removes
surgically: it blanks the show op, so the string leaves the content stream while *the rest of the page
stays real text*. Worth knowing precisely because someone who has internalised "removal means
rasterisation" will expect the neighbouring text to die with it, and it does not.

**Two NEW traps, both undisclosed until now, neither a code defect:**
1. **A filled shape over text hides nothing at all.** Not "recoverable with effort" like crop — the text
   is plainly extractable, untouched. This is the single most famous PDF mistake in the world and the
   product ships a black-rectangle tool in the same toolbar row as redaction, rendering an identical
   result on screen. Nothing claimed otherwise, and that was exactly the crop failure mode: the *absence*
   of a qualifier next to qualified neighbours reads as an equal promise.
2. **Form flatten makes a value MORE exposed, not less.** "Flatten" sounds concealing; it converts an
   editable field into permanent selectable page text. Correct behaviour, opposite connotation.

**Method note worth reusing: pin the traps as tests, not just as prose.** Two of the six assertions
encode behaviour that is *correct* — `expect(text).toContain(SECRET)` after drawing a black box over it.
An assertion that a defect-shaped thing is intended is the only artifact that stops a future reader
"fixing" it, or quietly describing shapes as hiding content. Each carries a comment saying so.

Also confirmed by measurement rather than assumption: sanitize touches metadata only (page content
survives, and it does not claim otherwise), and redaction takes the WHOLE page's text with it — the
documented cost of "text unextractable", and the reason it is not the default.

**The audit's own first draft was the best illustration of its thesis — a reviewer refuted THREE of its
pins, and the redaction one was serious.** All are fixed; the lessons are the point:

1. **A pin made only of NEGATIVE assertions cannot detect the leak it exists to catch.** The redaction
   test asserted `not.toContain(SECRET)` and `not.toContain(PUBLIC)` — but rasterisation alone satisfies
   both, so it could not distinguish *"the burn destroyed the secret"* from *"the page became an image"*.
   Demonstrated, not argued: with the burn moved off-target (the `#QA-2026-06-23` misplaced-burn shape a
   crop offset really produced here) **the assertions still passed** while the secret's glyphs stayed
   inked — i.e. plainly readable. Now gated on `patchDarkness(...) > 200`, sampling a 6×6 patch at the
   cover's centre; that reads **9.3** (near-white) on the off-target simulation and passes on a correct
   burn. **Any redaction guard needs positive evidence the burn landed.** To re-measure, move the
   `RedactionElement`'s `y` off the secret and re-run — the simulation is deliberately not committed, so
   the figure above is the only record; treat it as a one-off measurement, not a ceiling to cite.
2. **"Each row is pinned by a test" was false for 3 of 9 rows** (compress→flatten, crop, highlight). An
   overstated *provenance* claim in a security document is the same defect the audit exists to fix, so
   rows now carry an explicit `[pinned]` marker and the rest say they were established by code reading.
3. **The `/Names` assertion was both vacuous AND wrong.** The fixture never carried `/Names`, so
   `expect(...).toBeUndefined()` held before `sanitizePdf` ran. Adding it to the fixture revealed the
   assertion was also semantically wrong: the sanitizer **keeps** the `/Names` dict on purpose (so
   `/Dests` survives) and deletes only its `/JavaScript` and `/EmbeddedFiles` sub-trees.

Two factual corrections to the prose fell out of the same review: **crop is destructive in at least
three paths, not one** (a redaction-bearing page, compress→flatten-to-images, and export-page-as-image —
pdf.js's viewport *is* the CropBox, so any rasterising export discards the cropped region), and
**export-page-as-image** was missing from a table that claimed to list every surface.

**THREE locale strings contradicted the new table; all are fixed in all three locales — and the one I
missed first was the one that matters most.** `toolbar.cropTitle` still said *"drag to keep only that
area"*, the original finding's exact wording, fixed in the docs but not in the UI. I then wrote that this
tooltip was "the highest-traffic surface of all" and a reviewer refuted it: **`toast.modeHint.crop` is
*pushed* at the user** by `toolModeService`'s `MODE_HINT_KEYS` the instant crop mode is entered, and it
still said *"drag to mark the area to keep"* — a toast you cannot avoid reading beats a tooltip you must
hover for. **When auditing a user-facing claim, grep the locale files for the CLAIM, not for the one key
you already know about.** Third: `toast.redactionPlaced` said content is *"hidden"* on export, which
under the new taxonomy means *recoverable* — the wrong word for the tool that genuinely removes.

The three Arabic edits are single-verb substitutions (`للإبقاء على` → `لإظهار`, `الإبقاء عليها` →
`إظهارها`, `يُخفى` → `يُزال`). **They are the FIRST changes to Arabic values since the 2026-07-30 native
sign-off**, so § i18n's "no Arabic value was changed" no longer holds unqualified. **The pending set is
CLOSED as of 2026-09-13 by developer ruling** ("consider the arabic review done") — accepted by ruling, not
by a second native read — **and the pending count is 14**: `toolbar.compressTitle` and `toast.ocrRotatedUnsupported` (re-worded, limits row 30 on 2026-09-27), `modal.compress.modeImages` and `modal.compress.hintImages` (new, limits row 27 on 2026-09-27), `toast.flattenAnnotationsSkipped` and the re-worded `toast.flattenDone` (limits row 23, 2026-09-27), `progress.ocrLoadingModel` (row 12) and `toolbar.clearRecentFiles` (row 11), added by the limits walkthrough on 2026-09-26, `thumbnail.previewUnavailable`, added by the limits walkthrough (A6) on 2026-09-26, `toast.exportLayersConflict`, added by WS8 on 2026-09-24, `toast.pdfLoadRefused`, added by WS7 round 15 on 2026-09-14, plus `toolbar.sanitizeTitle`, re-worded on the closure day to
en/fr parity by the session, which makes it a new value, and the two keys WS7 round 10 added the same day
(`docxEditor.pdfImagesSkipped`, `toast.sanitizeRefusedInvalidObject`), both session-written. Before the closure the set had grown to **15**: these 3, plus `toolbar.exportXlsxTitle`, `badge.signRect`, the 6 `toolbar.cropMargin*`
keys, `toast.cropMarginsTooLarge`, the two #54b keys added 2026-09-04 (`toolbar.recentFiles`,
`toast.recentFileUnavailable`), and `toolbar.sanitizeTitle` — a word DELETION made by `8ae525c` on
2026-09-04 that every copy of this list missed until WS7 round 9 found it in the range diff, and which
now UNDER-claims: the English and French tooltips were re-worded for the 2026-09-05 scope, the Arabic
one deliberately was not, so it needs a re-wording as well as a review. **This count read 11 here and 12 in the two sections below** — the
home had dropped `badge.signRect` while they kept it, which is the very drift this paragraph warns
about, found again on 2026-09-04. Reconciled at 14. A reviewer found this tracking gap because the two other sections that
enumerate the pending set were not updated — **when the pending list lives in prose in three places, a
change to one is a change to all three.**

**A "defect" I fixed and then had to UNFIX — worth the space, because the reasoning generalises.** The
delete branch reads `if (!ok) return;` with no toast and no fallback, while the replace path 50 lines
below falls back to an overlay and says so. That asymmetry looks exactly like a silent failure on a
removal operation, so I added a warning toast, a test, a doc caveat saying the delete "refuses on Type3 /
invisible / vertical fonts and tells you so" — and a reviewer refuted all three at once. **The branch is
unreachable and the caveat was invented:**

- `deleteTextAt` carries **none** of `replaceTextAt`'s font gates (`isType3Font` / renderMode 3,7 /
  `isVerticalWritingFont` are at `contentStreamEditor.ts:1961-1963`, inside `replaceTextAt` only). It
  needs none: blanking a show op **draws nothing**, so it is font-agnostic. Replace needs the gates
  precisely because Path 3 must RENDER new glyphs. So delete is *unconditionally* removal-grade.
- Its only `false` is `findTarget` missing — and `findTextOpAt` **is** `findTarget(...)?.target`
  (`:1248`), which had to succeed on the same `libDoc`/`pageIndex`/`origin`/tolerance for the editor to
  open. Nothing mutates `libDoc` in between (the delete branch is the first mutating branch in
  `commit`), so a deterministic function cannot now miss.

Reverted; the branch keeps a comment stating the proof. **The lesson: an asymmetry between two sibling
code paths is not evidence of a bug** — the sibling may need the guard for a reason that does not apply.
Under the anti-bandaid gate, adding a fallback for a failure mode with no observed instance is itself the
defect, and the test I wrote for it could only be reached by mocking the impossible return.

**THE AUDIT'S REAL PAYLOAD: three redaction leaks in SHIPPED code, found only once the reviewer panel
attacked the claim rather than the tests (2026-08-05).** Redaction rasterises the page, which is what
makes it removal-grade — but **three export paths do not go through that path**, and every one of them
handed the redacted text straight back. Each fix is pinned by a test proven to fail without it:

1. **Table → CSV / XLSX.** `_extractPageTableData` read the raw `getTextContent()`. Meanwhile
   `_extractFlowDoc`, 500 lines away, filtered redactions and carried a comment saying
   `CORE-P0-1 — without this, redacted text leaked on rotated pages`. **This repo had already graded
   this exact class P0 for the sibling path and fixed only that one.** Reverting the new filter puts
   `Wolgast` back in the CSV. The fix reuses `isItemRedacted` + `redactionRectToContent` with the same
   viewport and `totalRot`, so rotated pages cannot diverge between the two extractors.
2. **OCR → "Copy text" / "Export to Word".** `_recognize` rasterises the RAW source page, so tesseract
   read the text under the box. Fixed by painting the redactions onto the OCR canvas **before**
   recognition — the engine then cannot see the glyphs at all, which beats filtering recognised words
   because there is no partial-overlap word left to reason about.
3. **A redaction on a BLANK page was never rasterised at all** — `sourcePdfId === 'blank'` is checked
   *before* `hasRedaction`, so the box was baked as an opaque vector rect over live overlay text.
   Reverting the fix extracts the secret verbatim. There is no source document to rasterise here, so
   removal is achieved the only other way available: `dropElementsUnderRedactions` omits the covered
   elements. Deliberately blunt — a partially covered element is dropped whole, because leaving it
   would leak the covered part.

**Round 3 then refuted my own fix, and this is the most instructive part.** Fix 1 above was written by
mirroring `_extractFlowDoc`'s call shape — including `page.getViewport({ scale: 1 })`. But
`redactionRectToContent`'s docstring says its `W`/`H` are the **UNROTATED** dims, and `getViewport`
defaults `rotation` to `page.rotate`, so on `/Rotate 90|270` the dims arrive **swapped** and the filter
**silently no-ops**. Measured across all `(pageRot, userRot)` pairs: 6 of 16 leaked, and two of those
*also dropped the wrong region* — innocent cells deleted while the secret survived. The repo's canonical
accessor had it right all along (`PageService._pageGeom` uses `{ scale: 1, rotation: 0 }`).

**And the path I copied had the same bug**, so `CORE-P0-1`'s comment — *"without this, redacted text
leaked on rotated pages"* — was only ever true at 0/180, where the error cancels. DOCX/MD/TXT leaked at
90/270 for as long as that comment has existed. **Mirroring a sibling call site is not verification of
it; check the contract.** Both call sites now pass `{ scale: 1, rotation: 0 }`, pinned across six
rotation combinations — and the fixture's `getViewport` deliberately *mimics pdf.js's swap*, because a
stub returning fixed `W×H` would make those tests pass while the bug stayed.

Two more leaks fell out of the same question: **overlay text under a redaction** had no filter at all in
the DOCX/MD/TXT and XFDF exports (the PDF export removed it; "Export to Word" handed it back, promoted to
a heading if styled as one), and the **OCR burn** was mapped with a plain `el.x * scale` even though that
canvas is rendered at the page's intrinsic `/Rotate` with **no** user rotation — so with a user rotation
applied the fill landed off-target and, for some combinations, *entirely off-canvas*. Now composed from
two proven mappings (`redactionRectToContent`, then the viewport's own `convertToViewportPoint`).

**The lesson is about where to point a safety audit.** The first two rounds hardened the *tests* and the
*wording* and found nothing in the product. What found real leaks was asking "does this claim hold for
every path a user can reach, at every rotation?" — and the answer was no for five of them, each invisible
to a green suite because no test existed on those paths at all. **A sibling path that shares a promise but
not the filter is this repo's recurring leak shape**, and rotation is where it hides: every test written
for the first fix was at rotation 0, which is exactly why a rotation bug shipped inside a rotation fix.

**A fourth leak — DISCLOSED on 2026-08-05, and CLOSED on 2026-09-04. The paragraph below is kept for
its reasoning, but its verdict is SUPERSEDED: `src/docx/opcGc.ts` now collects the orphan, `grep -rn
"delete opc.files" src/docx/` finds it, and `SECURITY.md` reads "now removes it from the file
(fixed 2026-09-04)". See § "Deleting a DOCX image left its bytes in the package — WS4-D".** Leaving a
retracted security grade live in the decision register is the same defect this file recorded for #62b
and C10; found by the WS5 audit the same day the fix landed.

[superseded 2026-09-28: `opcGc.ts` removes the orphan now — § "Deleting a DOCX image left its bytes in the package — WS4-D"] **A fourth leak, verified and DISCLOSED rather than fixed: deleting an image in the DOCX editor leaves
its bytes in the saved file.** `reconcileImageAnchors` does `el.remove()` on the anchor `w:p` and nothing
else; `grep -rn "delete opc.files" src/docx/` returns **nothing**, and `packOpc` re-zips every part
verbatim — so `word/media/imageN.png` survives as an unreferenced part, recoverable by renaming to
`.zip`. The picture disappears in the editor AND in Word, which is what makes it convincing.
`CLAUDE.md` already noted "no part GC in v1" for the **cut/paste** slice only; the ✕-delete ceiling list
did not mention it and no user-facing doc did. Now in `SECURITY.md` § *"Deleting an image in the DOCX
editor does not remove it from the file"*. **Not fixed on purpose:** removing a package part safely means
proving nothing else references it (headers, footers, unmodelled parts), and getting that wrong destroys
images — a worse outcome than a disclosed orphan. The `SECURITY.md` table is otherwise PDF-scoped, which
is exactly how a whole feature went ungraded under a heading that says "every surface".

**Known bounds, deliberately not "fixed" (they are disclosed in `SECURITY.md` instead):** the drop is
blunt — a partially-covered element goes entirely, and so does one the user deliberately stacked *above*
a redaction (the raster path draws that one above the burn, so the two paths differ by design). Two of
the bounds listed here are now **CLOSED as of 2026-09-02**: the stored-AABB intersection test (see § "A
rotated redaction burned a rotated box") and ink composited above the burn (see § "Ink was stamped OVER
the burn").

**A FOURTH leak, and the way I nearly buried it is the most useful lesson in this whole entry.**
`_assemblePdfDoc` pre-copied every needed page, **including redaction-bearing ones** whose copy is never
`addPage`d. pdf-lib does not garbage-collect, so `save()` still serialised the intact page: the
un-redacted content stream shipped inside the exported file as an orphan — absent from `/Pages`, so
`getTextContent()` reported the secret gone, while the text sat there in the raw bytes. Reverting the
`pageHasRedaction` filter makes `tests/browser/redaction-orphan-leak.browser.test.ts` fail with the source
text present.

**I first recorded this as "could not reproduce end-to-end" — and that was wrong, because MY OWN TEST
could not fail.** `pdfjsLib.getDocument({ data })` **TRANSFERS the buffer** to the worker, so the same
`Uint8Array` is left with `byteLength === 0`. The scan ran over zero bytes and answered "clean" every
time, on every variant I tried, which is exactly why the wrong conclusion felt so well-measured. Fixed
with `.slice(0)` at every `getDocument` and a hard throw in `leaks()` on an empty buffer.

**Three rules fall out of it, and they are the transferable part:**
1. **A safety scan that cannot fail is worse than no scan** — it launders a live leak into a documented
   non-finding, and the next reader inherits the false conclusion plus a comment saying the fix is
   removable. The call site now says *do NOT remove this filter*, with the measurement.
2. **Always verify a NEGATIVE result the same way you verify a positive one.** I proved every *fix* in
   this entry non-vacuous by reverting it; I did not apply that discipline to a *non-finding*. A "no
   leak here" needs a control proving the probe can detect the leak at all — which the file now has.
3. **pdf.js detaching its input is a silent, general trap.** Anything that reads bytes after handing them
   to `getDocument` reads nothing. Pass `.slice(0)` whenever the buffer is still needed.

**Two API traps found while writing it:** `PDFDict.lookup(key, PDFDict)` **throws**
`Expected instance of PDFDict, but got instance of undefined` when the key is absent — so asserting a key
was stripped must use `.get(key)`. And a fixture built with `page.drawText` needs a save→load round-trip
before `findTarget` can see it: `drawText` buffers operators and only flushes them at save.
