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
that builds the file, runs the real export, and tries to recover the content; the rest were established
by reading the code, and are labelled honestly rather than implied to be measured.

| Tool | Content is… | Notes |
|---|---|---|
| **Redaction** | **removed** | **[pinned]** The page is rasterised, so the text is genuinely unextractable — and so is the *rest* of that page's text. That cost is why it is not the default. |
| **Delete page** | **removed** | **[pinned]** The export is assembled from copied pages; a deleted page is never copied. |
| **Edit text → delete** | **removed** | **[pinned]** Surgically removes the string from the content stream, with no rasterisation, so the rest of the page stays real text. In rare font cases (Type3, invisible or vertical text) the in-place delete refuses and tells you so — nothing is removed in that case. |
| **Compress → flatten to images** | **removed** | Rasterises every page. Same grade as redaction, applied document-wide. |
| **Export page as image** (PNG/JPEG) | **removed** | Rasterises the page, so only what you can see survives. |
| **Crop** | *hidden only* | A view setting. See below. |
| **Shape / rectangle over text** | ***not even hidden*** | **[pinned]** See below — this is the one that catches people. |
| **Highlight** | *not hidden* | A semi-transparent annotation drawn over the text. |
| **Sanitize** | metadata only | **[pinned]** Strips `/Info`, XMP, document JavaScript and embedded files. It does **not** touch page content, and does not claim to. |
| **Form flatten** | *converts, not conceals* | **[pinned]** See below. |

Every grade above is about **the file you export**. None of them is about the copy in your browser: to
restore your work after a reload, PDFturbo keeps the *original* PDF bytes in IndexedDB, so redacting or
deleting a page does not remove anything from your own machine. See **Data at rest** below.

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
