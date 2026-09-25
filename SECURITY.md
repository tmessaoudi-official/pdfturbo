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
| **Redaction** | **removed** | **[pinned]** The page is rasterised, so the text is genuinely unextractable — and so is the *rest* of that page's text. That cost is why it is not the default. Web links on that page (`http`, `https`, `mailto`) that meet no redaction are re-created on the image page, where they were drawn (since 2026-09-25); a link that meets a redaction, a link with any other scheme, and a link to another page are not. Applies to a page from a real PDF; see the note below on **blank** pages, on the CSV/Excel and OCR exports, on **vertical (top-to-bottom) text**, and on **source annotations** (a note, stamp or form field under a redaction is now removed with it). |
| **Delete page** | **removed** | **[pinned]** The export is assembled from copied pages; a deleted page is never copied. |
| **Edit text → delete** | **removed** | **[pinned]** Surgically removes the string from the content stream, with no rasterisation, so the rest of the page stays real text. Unlike *replacing* text — which can decline on fonts it cannot redraw — deleting is font-agnostic: it blanks the operator that draws the text, so nothing needs drawing. |
| **Compress → flatten to images** | **removed** | The **flatten-to-images** setting only; "lossless optimise" keeps all text. Rasterises every page, so it is redaction's grade applied document-wide. |
| **Export page as image** (PNG/JPEG) | **removed** | Rasterises the page, so only what you can see survives. |
| **Extract page range** | **removed** | Like deleting pages: the new file is built from copied pages, so pages outside the range are never in it. |
| **Crop** | *hidden only* | A view setting. See below. |
| **Shape / rectangle over text** | ***not even hidden*** | **[pinned]** See below — this is the one that catches people. |
| **Highlight** | *not hidden* | A semi-transparent annotation drawn over the text. |
| **Sanitize** | metadata, scripts, egress, attachments | **[pinned]** Strips `/Info`, XMP `/Metadata` on **every** object (catalog, pages, form and image XObjects, fonts — until 2026-09-05 only the catalog and pages, while this row said "XMP" unqualified), `/PieceInfo` private application data (Illustrator and InDesign embed the source document there), and document JavaScript — including a script reached through an action chain (`/Next`), listed in an array-valued `/A`, attached to an `/Outlines` bookmark, hung as `/AA` on the page-tree root or on a form field that `/Fields` never lists (pdf.js inherits `/AA` through `/Parent`, so both ran after sanitize until 2026-09-05), or a 3D annotation's `/OnInstantiate` — and, since 2026-09-05, the **non-JavaScript actions that reach outside the document**: `/SubmitForm` (posts form data to a URL), `/Launch` (starts an external program or file), `/GoToR` and `/GoToE` (open another document) and `/ImportData` (reads a file into the form). A hyperlink chained behind a removed action keeps working; `/URI` and `/GoTo` links are never touched. Embedded files are removed from the `/Names` tree, as `/FileAttachment` (paperclip) annotations — listed on a page or reached only through a form field, with their Popup removed from whichever page lists it — and as `/AF` associated files on any object (catalog, page, annotation, field, bookmark, XObject). In every case the file's **bytes** leave the exported copy, because the Filespec itself loses its embedded stream rather than only the reference to it: a file that a kept media clip also pointed at is gone too, and that clip degrades to a name-only reference. Every claim in this row, including the kept list below, has a test. It does **not** touch page content, and does not claim to. A file holding an object the sanitizer **cannot parse** is refused rather than passed through with a clean report (since 2026-09-13): such an object can hide a script that no walk can see. What it deliberately keeps: in-document media actions (`/Rendition` without script, `/Sound`, `/Movie`, `/GoTo3DView`, `/RichMediaExecute`). These are **not** inert — a reader plays them when you click (pdf.js does; until 2026-09-13 this row said no browser reader executes them, which was false) — but they stay inside the document, and removing them would delete legitimate content. |
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
- **Typed text is judged by where it is DRAWN, not by its box (since 2026-09-26).** A text box does not
  grow as you type and the export never wraps, so a second line can be drawn below the box and a long
  line past its right edge. Before this date a redaction that missed the box but covered that overflow
  left the overflowing text in these exports and, on a blank page, in the PDF too. Now the test uses
  every line's drawn position. It errs towards removing: a glyph's ink is bounded by the font's own
  outer box, so text a fraction of a letter-width left of its line or just above its box can count as
  covered; all the lines of one text box count as one block, so an empty line between them counts too;
  and an Arabic line whose font cannot be loaded counts as reaching the page edge.
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

- **Vertical (top-to-bottom) text IS covered (since 2026-09-25).** Until then it was not: for text set
  in a vertical writing mode, as some Japanese and Chinese documents use, the filter placed the area
  it tested on the wrong side of the text, so a redaction over a vertical column could leave it in the
  Word / Markdown / text / CSV / Excel exports, and a redaction drawn just *above* a column could
  remove it although the box was nowhere near it. The tested area is now measured against where
  pdf.js actually draws vertical text — on pdf.js's own vertical test document and on a synthetic
  one, at every page rotation and with a non-zero crop origin. **One bound:** the area reaches 0.6 of
  a character's size either side of the column's centre and a tenth of a character past its ends,
  which covers every shape measured; a font whose own vertical metrics place characters further out
  is not covered, because the text extraction does not report those metrics. The PDF export
  rasterises the page and removes the content in every case.

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

### A layer switched off in the source stays off in the export (found and fixed 2026-09-24)

A PDF can carry **optional-content layers** (a draft stamp, an alternate language, a print-only layer) that
the file itself switches off, so the viewer does not draw them. PDFturbo shows them hidden, as the file says.
Until 2026-09-24 the PDF export did not keep that setting: it builds a fresh document and copies the pages into
it, and the setting lives on the document, not on the pages. Every viewer then drew every layer, so content never
seen on screen was visible to whoever received the file (measured on a synthetic file: 0 dark pixels in the hidden
layer's band on the original, 307 in the export). Every export that copies pages — the PDF downloads, a page as an
image, the thumbnails and a redacted page — now carries the source's layer settings with its pages.

One case is refused instead: an export that combines two or more documents which each carry layer settings, when
one of them switches a layer off. A PDF has a single set of layer settings, and merging two is not done here, so
PDFturbo says so rather than publish the hidden layer. Export those documents separately.

### Lock PDF — what the password encrypts, and what it cannot

**Lock PDF** encrypts the export with AES-256 (`/R 6`). Until 2026-09-13 the encryption covered only
content streams: strings such as a link's URL or a note's text were written **in plaintext** —
readable in a text editor — while the file told readers they were encrypted, so a reader given the
correct password showed them as blank. A locked export now places ordinary objects inside encrypted
object streams, which covers page content, annotation text, link URLs, form values and document
metadata. **Sanitize & download** applies the password too — until 2026-09-13 its copy was written
unencrypted even when a password was set, and opened without one.

What still cannot be encrypted this way, because the PDF writer keeps these objects outside object
streams — the kinds found so far, not a proof that nothing else is: strings stored **directly** on the
document catalog, the page tree or a page dictionary (including an annotation written inline in a
page's `/Annots` rather than as its own object); strings in the **dictionary** of any stream object,
whose data is encrypted but whose dictionary is not — a form XObject's or an image's dictionary, or an
embedded file's parameters such as its modification date; signature dictionaries; objects with a
non-zero generation number; objects PDFturbo could not parse; and the trailer's document `/ID`. PDFturbo's own annotations are separate objects and are encrypted;
an opened file may carry inline ones. If a string must not be readable without the password, do not
rely on it sitting in one of those places.

## One file, two readers — what you see is what you export and sign

PDFturbo **shows** a PDF with pdf.js and **builds** every PDF export (the whole document, a page range, one
page, a flattened copy, a page image), edit, signature, searchable OCR layer, sanitized copy and compressed
copy with a second library, pdf-lib. The two read a file differently where the file is damaged or
ambiguous, and until 2026-09-13 nothing checked that they agreed — so a file could show one page on screen
while the exported or signed copy carried another. Since then, those operations **refuse** such a file in
the cases below, with a message saying the file cannot be used because its structure is damaged or
ambiguous (since 2026-09-14; before, each showed its own generic failure, and signing and OCR asked for a
retry that could never succeed). Editing text in place shows no error: it falls back to an editable
overlay, and the export or signature built afterwards refuses. The Word, Markdown and text exports, the
table (CSV, XLSX) and XFDF exports, and OCR's text, Word and editable-box modes do not refuse: they read the
document through pdf.js, the same reader that draws it, so they export what is on screen. Opening and
viewing the file are unaffected.

- **pdf-lib dropped part of the file.** A damaged object that never closes is skipped by pdf-lib while
  pdf.js still draws it, so the export would lose it. A file is refused when anything it uses was dropped
  and nothing later in the file replaced it — including when the drop sits behind a second damaged object
  whose contents cannot be read at all.
- **The viewer and the export library would show different pages** (WS7 rounds 13–17; since WS8, 2026-09-24,
  checked by running the viewer itself). pdf.js finds objects through the cross-reference table the end of the
  file points to; pdf-lib reads objects in order and keeps the last copy of each. A crafted file can use that to
  show one page and export or sign another — a valid signature over content the signer never saw. Examples
  measured and refused: a table pointing at an earlier copy of an object; a table marking an object a page uses
  as free, or placing it at bytes that are not that object; an update pointing at a section the viewer skips; a
  trailer or document root the two libraries choose differently; a page tree whose page counts are wrong; a
  linearized ("fast web view") file whose first-page table names another copy.

  Until WS8 PDFturbo decided this by re-reading the file's cross-reference structure the way it believed pdf.js
  does, and a closing audit measured ten crafted shapes that got past that model wherever the two libraries read
  the same bytes differently. The model is gone. When a document is opened, PDFturbo now opens it in pdf.js a
  second time, builds the copy an export builds, opens that in pdf.js as well, and compares every page the viewer
  shows — its text, with each string's position, and its drawing operations with their numbers and colours. Any page that differs
  refuses the export, signing and in-place editing for that document. None of the ten audit shapes loads any more: nine are refused as a page mismatch, and the tenth is a file pdf.js
  itself cannot open. The check
  runs in the background from the moment the file opens, so an export usually finds it finished; on a large file
  it takes seconds.

  Measured on 15 real-world PDFs — forms, papers and reports, most of them updated or linearized — and on the 5
  test files kept in the repository: none is refused.

What the check does not compare, stated rather than hidden: pages the export library holds beyond the ones the
viewer shows (they are never exported); annotation appearances (compared with annotations switched off, because
the export's copy draws form widgets differently); and which picture an image operation paints when two candidates
have the same size and position. Bytes pdf-lib never reads as an object at all are covered only as far as they
change what a page draws. Encrypted files are unchanged: without the password they are refused before the check,
as before.

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
