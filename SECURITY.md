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
| **Redaction** | **removed** | **[pinned]** The page is rasterised, so the text is genuinely unextractable — and so is the *rest* of that page's text. That cost is why it is not the default. Applies to a page from a real PDF; see the note below on **blank** pages, and on the CSV/Excel and OCR exports. |
| **Delete page** | **removed** | **[pinned]** The export is assembled from copied pages; a deleted page is never copied. |
| **Edit text → delete** | **removed** | **[pinned]** Surgically removes the string from the content stream, with no rasterisation, so the rest of the page stays real text. Unlike *replacing* text — which can decline on fonts it cannot redraw — deleting is font-agnostic: it blanks the operator that draws the text, so nothing needs drawing. |
| **Compress → flatten to images** | **removed** | The **flatten-to-images** setting only; "lossless optimise" keeps all text. Rasterises every page, so it is redaction's grade applied document-wide. |
| **Export page as image** (PNG/JPEG) | **removed** | Rasterises the page, so only what you can see survives. |
| **Extract page range** | **removed** | Like deleting pages: the new file is built from copied pages, so pages outside the range are never in it. |
| **Crop** | *hidden only* | A view setting. See below. |
| **Shape / rectangle over text** | ***not even hidden*** | **[pinned]** See below — this is the one that catches people. |
| **Highlight** | *not hidden* | A semi-transparent annotation drawn over the text. |
| **Sanitize** | metadata only | **[pinned]** Strips `/Info`, XMP, document JavaScript and embedded files. It does **not** touch page content, and does not claim to. |
| **Form flatten** | *converts, not conceals* | **[pinned]** See below. |

Every grade above is about **the file you export** — none is about the copy in your browser. To restore
your work after a reload, PDFturbo keeps the opened PDF's bytes in IndexedDB. Redaction and page deletion
do not touch those bytes, so neither removes the underlying content from your own machine. (Editing text
in place *does* rewrite them, so the stored copy is not always the file you opened.) (Deleting
*every* page that came from a given file does drop that file's bytes.) See **Data at rest** below.

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

All of those now remove the content, at every rotation. Two limits are worth stating rather than leaving
you to discover them:

- **Dropping is blunt by design.** An element only *partly* under the box is removed entirely, because
  leaving it would leak the covered part. An element you deliberately placed *on top of* a redaction is
  also removed from these exports, even though the PDF export draws it above the box.
- **Freehand ink is not covered.** Ink is composited above the redaction, so handwriting under a box
  stays visible in the export. Use redaction over ink with that in mind.

### Deleting an image in the DOCX editor does not remove it from the file

The grades above are about PDFs. The **Word editor** has one case worth knowing: deleting an image
removes it from the document, but **the image data stays inside the `.docx`**. An OPC package is a ZIP,
and the picture remains as an unreferenced part that anyone can extract by renaming the file to `.zip`.

Not yet fixed — removing a package part safely means proving nothing else references it. If an image is
confidential, delete it before it goes into the document, or rebuild the file without it.

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
