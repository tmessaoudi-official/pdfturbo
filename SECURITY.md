# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| latest (master) | Yes |

## Reporting a Vulnerability

**Please do not report security vulnerabilities in public GitHub issues.**

Use GitHub's private [security advisory](https://github.com/tmessaoudi-official/pdfturbo/security/advisories/new) to report vulnerabilities confidentially.

Include:
- A description of the vulnerability
- Steps to reproduce it
- Potential impact
- Any suggested fix (optional)

You can expect an acknowledgment within 48 hours and a resolution within 14 days for confirmed issues.

## Scope

This is a **client-side only** application — no server, no database, no user accounts. All PDF processing happens in your browser. All libraries (pdf.js, @cantoo/pdf-lib, and others) are bundled via npm — no CDN dependencies, no external network requests at runtime.

Security concerns most relevant to this project:
- XSS via malicious PDF content
- Malicious PDF files causing unexpected behavior in pdf.js
- Privacy: PDFs are processed locally and never uploaded anywhere

## Hiding is not removing — which tool actually deletes content

Several tools make content *stop being visible*. Only some make it *stop being in the file*. If you are
removing something confidential, the difference is the only thing that matters — so here is every
surface, graded. Rows marked **[pinned]** have a test in `tests/browser/hide-vs-remove.browser.test.ts`
that builds a file, performs the operation, and tries to recover the content with pdf.js. Two of those
(shape, redaction) drive the real export bake; the others exercise the underlying operation directly, so
they prove the mechanism behaves as described rather than that every export path invokes it. Unmarked
rows were established by reading the code. Both are said plainly instead of implied to be measured.

| Tool | Content is… | Notes |
|---|---|---|
| **Redaction** | **removed** | **[pinned]** The page is rasterised, so the text is genuinely unextractable — and so is the *rest* of that page's text. That cost is why it is not the default. Applies to a page from a real PDF; see the note below on **blank** pages, on the CSV/Excel and OCR exports, on **vertical (top-to-bottom) text**, and on **source annotations** (a note, stamp or form field under a redaction is now removed with it). |
| **Delete page** | **removed** | **[pinned]** The export is assembled from copied pages; a deleted page is never copied. |
| **Edit text → delete** | **removed** | **[pinned]** Surgically removes the string from the content stream, with no rasterisation, so the rest of the page stays real text. Unlike *replacing* text — which can decline on fonts it cannot redraw — deleting is font-agnostic: it blanks the operator that draws the text, so nothing needs drawing. |
| **Compress → flatten to images** | **removed** | The **flatten-to-images** setting only; "lossless optimise" keeps all text. Rasterises every page, so it is redaction's grade applied document-wide. |
| **Export page as image** (PNG/JPEG) | **removed** | Rasterises the page, so only what you can see survives. |
| **Extract page range** | **removed** | Like deleting pages: the new file is built from copied pages, so pages outside the range are never in it. |
| **Crop** | *hidden only* | A view setting. See below. |
| **Shape / rectangle over text** | ***not even hidden*** | **[pinned]** See below — this is the one that catches people. |
| **Highlight** | *not hidden* | A semi-transparent annotation drawn over the text. |
| **Sanitize** | metadata only | **[pinned]** Strips `/Info`, XMP and document JavaScript — including a script reached through an action chain (`/Next`), listed in an array-valued `/A`, or attached to an `/Outlines` bookmark, all of which survived until 2026-09-04. Embedded files are removed from the `/Names` tree **only**: a `/FileAttachment` annotation's own `/FS`→`/EF` SURVIVES, so "embedded files stripped" is not unconditional — see `KNOWN_ISSUES.md`. The `[pinned]` marker covers the metadata and JavaScript claims, which have tests; the FileAttachment gap has none. It does **not** touch page content, and does not claim to. |
| **Form flatten** | *converts, not conceals* | **[pinned]** See below. |

Every grade above is about **the file you export** — none is about the copy in your browser. To restore
your work after a reload, PDFturbo keeps the opened PDF's bytes in IndexedDB. Redaction and page deletion
do not touch those bytes, so neither removes the underlying content from your own machine. (Editing text
in place *does* rewrite them, so the stored copy is not always the file you opened.) (Deleting
*every* page that came from a given file does drop that file's bytes.) See **Data at rest** below.

### A note or form field under a redaction used to survive it (fixed 2026-08-29)

If the area you redacted contained a **source annotation** — a sticky note, a FreeText comment, a
stamp, or a form field still holding its value — that annotation's content was drawn back **on top of
the black box** in the exported file, and stayed plainly readable.

This was worse than the leaks fixed on 2026-08-05, which left content *extractable*. Here it was
simply *visible*: the export looked like a redacted page with the secret printed over the redaction.

The cause is an ordering rule in the PDF format. The black box is written into the page's content
stream, but annotations are painted **after** the content stream, so they land above it. Redaction has
always rasterised the page — that part was true — but it rasterised with the annotations still
attached, so they were baked into the image on top of the burn.

Any annotation whose rectangle touches a redaction is now removed before the page is rasterised — on
every export path, at every page rotation, and with or without a crop. (The first version of this fix
got that wrong: it removed the annotation correctly on the PDF export but not on the image export or
the thumbnail when the page was rotated or cropped.)

To be precise about what is *tested* rather than merely believed: the PDF-export rasteriser, the
thumbnail and "export page as image" are each driven end-to-end on real pdf.js pixels, at rotations
0/90/180/270 and with a crop. Until 2026-09-02 the image export was the exception — it was covered
only by tests that stub pdf.js at the module seam, so they pinned the option →
viewport/format/save-name wiring rather than the output, and reverting the fix left that one path
green. It no longer does. Two consequences worth knowing:

- **The whole annotation goes, not just the covered part.** A comment that overlaps a redaction by one
  corner disappears entirely. That is deliberate: for a leak filter, removing too much is the only safe
  direction to err in.
- **Annotations clear of every redaction are untouched** and still appear in your export.

### Redaction reaches the other exports too (fixed 2026-08-05)

Redaction rasterises the page, which is what makes it removal-grade — but several exports do not go
through that path, and until 2026-08-05 each handed the redacted text back:

- **Table → CSV / Excel** read the page's text directly, so a redacted cell appeared in the file.
- **OCR → "Copy text" / "Export to Word"** recognised the page *before* the box was applied.
- **Export to Word / Markdown / text and XFDF** exported a redacted *text box you had typed* — the PDF
  export removed it, and these handed it back.
- **A redaction on a blank page** (one you added in PDFturbo, not from a PDF) was drawn as an opaque
  rectangle over text that remained fully selectable.
- **On a rotated page**, the filter that was supposed to protect the Word/Markdown export did nothing at
  90° and 270°, so redacted text leaked there — despite a code comment claiming rotation was handled.

Two more of the same shape were found and fixed on 2026-08-28:

- **Pictures were never filtered at all.** A redaction over an image removed the *words* on top of it
  while the image itself was embedded whole in the Word / Markdown / text export. On a **scanned** page
  that image is the entire page, which is the case redaction exists for — so the tool's core promise was
  inverted exactly where it mattered most.
- **A page with a non-zero CropBox origin defeated the filter completely.** PDF pages can declare a
  visible area that does not start at the origin (common in print-ready and cropped files). On such a
  page the redaction box and the page's text were compared in two different coordinate frames, nothing
  matched, and the redacted text went straight into the Word, Markdown, text, CSV and Excel exports.
  Nothing about the document looked unusual, and every other export path was unaffected.

Two more of the same family were found and fixed on 2026-08-29, both in the Word / Markdown / text
export and both about *where a picture sits* rather than whether it was filtered:

- **A picture wrapped in a "form" escaped the filter.** PDFs often place an image inside a reusable
  container rather than directly on the page — what most tools produce for a stamp or a placed page.
  The filter computed such an image's position without the container's own offset, so it looked for
  the picture in the wrong place, found no overlap with your redaction, and exported it intact.
- **A picture drawn by a stamp or comment escaped it too.** An image painted by an annotation was
  positioned as if it sat at the page's bottom-left corner. A redaction over the stamp therefore
  missed it — and, in the other direction, a redaction that happened to sit in that corner wrongly
  removed a picture nowhere near it.

All of those now remove the content, at every rotation and at any CropBox origin. The limits below are
worth stating rather than leaving you to discover them:

- **A redacted picture is dropped whole.** There is no way to remove part of an embedded image from
  these text-oriented exports, so the whole picture is left out. The practical consequence: on a scanned
  document, *one* redaction anywhere on the page removes that page's scan from the Word / Markdown / text
  export. The PDF export is unaffected — it rasterises, so it keeps the page with the box burned in. Use
  that one if you need the rest of the scan.

- **Dropping is blunt by design.** An element only *partly* under the box is removed entirely, because
  leaving it would leak the covered part. An element you deliberately placed *on top of* a redaction is
  also removed from these exports, even though the PDF export draws it above the box.
  This was re-examined on 2026-09-04 and deliberately left as it is. Clipping the element down to just
  its uncovered part was tried and measured: a PDF clip stops the covered words being *drawn*, but they
  stay in the file — still copyable, and still reaching the Word / Markdown export. It works for
  freehand ink, which is stored as pixels and really can have the covered ones erased (see above), and
  it does not work for anything stored as text or shapes. Removing the whole element is what actually
  removes it.
- **Rotation is now accounted for (since 2026-09-02).** A redaction — like any element — can be rotated,
  and the box burned into the export is the rotated one. Until this date every filter tested the upright
  box instead, so content under the parts that stick out was painted over yet left fully extractable.
  Both sides of the test now use the upright box that *contains* the rotated one. That errs towards
  removing more than the box strictly covers rather than less — and for a long, thin redaction it is
  considerably more, not slightly: a 20x260 bar turned on its side is tested as a 260x260 square.
- **A little MORE than the box is removed, by design.** The filter treats a line of text as reaching
  a quarter of its type size below the baseline, because that is where the tails of g, j, p, q and y
  sit and a box covering only those tails must still remove the line. The cost is that a redaction
  placed immediately under a line can also remove text just below it from the Word / Markdown / text
  / CSV / Excel exports. Removing slightly more than you drew is the safe direction for a redaction;
  the PDF export is unaffected.

- **Vertical (top-to-bottom) text is NOT covered — a known gap, disclosed rather than assumed away.**
  A redaction over text set in a vertical writing mode, as some Japanese and Chinese documents use,
  may leave that text extractable in the Word / Markdown / text / CSV / Excel exports. The filter
  reads the run's direction from the PDF, and for vertical text the two size fields swap roles and
  the text advances downward; we have no vertical-font document to measure the exact behaviour
  against, so rather than claim it works we are telling you it is unverified. **Horizontal text,
  including text set at an angle, IS covered** — that was fixed on 2026-09-04. If you are redacting a
  vertically-set document, use the PDF export, which rasterises the page and removes the content in
  every case.

  **It can also go the other way, and that is the more surprising half.** Because the tested area for
  a vertical run is placed on the wrong side of where the text starts, a redaction drawn *above* such
  a run can REMOVE it from the Word / Markdown / text / CSV / Excel exports even though the box is
  nowhere near it. So on a vertically-set document a redaction may leave text you meant to remove,
  and may remove text you did not touch. Neither is what you asked for; the PDF export is the one to
  use until this is fixed.

- **Freehand ink IS covered (since 2026-09-02).** It previously was not: the ink layer is stamped after
  the burn, so handwriting under a box was composited on top of it and baked into the exported pixels.
  Ink is now clipped to the redactions on the layer's own canvas, which removes the covered pixels and
  leaves the rest of the same stroke intact. A rotated redaction clips by the upright box containing it,
  so more ink is removed than the box strictly covers — considerably more for a long, thin one, and the
  safe direction.

### Deleting an image in the DOCX editor now removes it from the file (fixed 2026-09-04)

The grades above are about PDFs. The **Word editor** used to have a case worth knowing: deleting an
image removed it from the document, but **the image data stayed inside the `.docx`**. An OPC package
is a ZIP, so the picture remained as an unreferenced part that anyone could extract by renaming the
file to `.zip`. It disappeared in the editor and in Word, which is what made it convincing.

**Fixed.** Saving now also removes any picture in the package that nothing refers to any more, along
with the dead reference that pointed at it.

The care is all in deciding what "nothing refers to it" means, because deleting a picture that is
still in use is far worse than leaving a stray one. So the check reads **every** part of the package,
not just the main document — a picture used only in a header, a footer, a footnote or a comment is
kept — and anything it cannot read with confidence is kept as well. Only pictures are ever removed;
no other part of the file is touched. A save that deletes nothing leaves the file exactly as it was.

One thing it does not do: a picture that was already orphaned by some other program before you opened
the file is also collected on the next save. That is the same rule applied evenly, but it means a save
can shrink a file you did not knowingly change.

### A black rectangle over text hides nothing

Drawing an opaque filled shape over sensitive text is the single most common way people believe they
have redacted a PDF, and on screen the result is indistinguishable from a real redaction. **The text
underneath is completely untouched** — select-all/copy returns it, and so does any extraction tool. The
shape is an annotation painted on top, nothing more.

PDFturbo does not claim otherwise, but the tools sit next to each other in the same toolbar, so: if the
goal is concealment, the shape tool is never the right one. Use **Redaction**.

### Crop hides content — it does not remove it

**Cropping a page is a view setting, not a deletion.** PDFturbo writes the PDF `CropBox`, which tells a
viewer to display only that region; the page's full content stream and `MediaBox` are unchanged, so the
cropped-away area is still in the exported file and a recipient can bring it back by removing one key.

This matters because **the obvious way to check gives a false negative**: text extraction (select-all /
copy, or a text-extraction tool) respects the CropBox, so cropped-away text looks gone even though the
drawing operators are still present.

If you need content **actually gone** — a classification banner, a case number, a letterhead, anything
confidential — use **Redaction**, which rasterises the affected page so the content is not recoverable.
Cropping is for framing.

Exceptions worth knowing — crop *is* destructive whenever the page gets rasterised on the way out, which
happens in more than one place: on a page that also carries a redaction, when you use **Compress →
flatten to images**, and when you **export a page as an image**. In each of those the cropped-away region
is genuinely gone. So the grade depends on the export you choose, not on the crop alone — do not
generalise in either direction.

### Form flatten makes field values *more* exposed, not less

"Flatten" can sound like it might obscure what was typed into a form. It does the opposite, by design:
the value stops being an editable field and becomes permanent page text that anyone can select and copy.
That is the point of the feature — it is just worth knowing that flattening a form containing a national
insurance number does not protect it.

## Data at rest (session persistence)

To restore your work after a reload, PDFturbo saves the open document — **including the raw
PDF bytes** — in your browser's **IndexedDB**. This data:

- **never leaves your device** (no upload, no sync, no network);
- is stored **unencrypted**, like normal browser site data, so anyone with access to your OS
  user profile / browser data can read it;
- persists until you clear it. Use **"Start fresh"** on load, clear site data, or use a
  private/incognito window if you are editing sensitive documents on a shared machine.

If you need stronger guarantees for sensitive files, edit them in a private window and do not
restore the saved session.
