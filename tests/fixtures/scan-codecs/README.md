# Scan-codec fixtures (row 36)

Four of pdf.js's own test files (mozilla/pdf.js `test/pdfs/`, Apache-2.0), fetched 2026-09-26:

- `jbig2_symbol_offset.pdf` — a JBIG2 image with a symbol dictionary.
- `jbig2_file_header.pdf` — a JBIG2 image carrying the embedded-file header.
- `bug_jpx.pdf` — a JPEG 2000 (JPX) image.
- `jp2k-resetprob.pdf` — a small JPX image using the reset-probabilities coding pass option.

None carries `/JBIG2Globals`. Without pdf.js's `wasmUrl` every one of these draws nothing (measured
2026-09-26). Used by `tests/browser/scan-codecs.browser.test.ts`.
