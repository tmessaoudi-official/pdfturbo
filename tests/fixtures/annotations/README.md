# Annotation fixtures (limits row 23)

Four of pdf.js's own test files (mozilla/pdf.js `test/pdfs/`, Apache-2.0), fetched 2026-09-27:

- `annotation-freetext.pdf` — two FreeText annotations.
- `annotation-highlight.pdf` — a Highlight with its Popup.
- `annotation-square-circle.pdf` — a Square and a Circle, with a Popup.
- `annotation-stamp.pdf` — a Stamp with its Popup.

Each is one page whose annotations all carry an appearance. Flattened, each renders pixel-identically to the
source rendered with its annotations, and leaves no annotation behind (measured 2026-09-27; so did the Line,
Polygon/PolyLine, Squiggly, StrikeOut and Underline files, not vendored). Used by
`tests/browser/flatten-annotations.browser.test.ts`.
