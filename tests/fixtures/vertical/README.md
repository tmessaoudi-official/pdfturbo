# Vertical-writing fixtures

- `pdfjs-vertical.pdf` — pdf.js's own `test/pdfs/vertical.pdf` (mozilla/pdf.js, Apache-2.0;
  produced by dvipdfmx, an `Identity-V` subset of AokinMincho). A genuinely vertical font:
  pdf.js reports `dir: 'ttb'` and `styles[...].vertical === true`. It needs pdf.js's CMap files
  (`cMapUrl`) to extract any text.
- `libreoffice-tb-rl.pdf` — generated for this repo by LibreOffice (`soffice --headless
  --convert-to pdf`) from a one-page document with `style:writing-mode="tb-rl"` in Noto Serif CJK JP.
  NOT a vertical font: LibreOffice places one horizontal glyph per position (`dir: 'ltr'`).

Used by `tests/browser/redaction-vertical.browser.test.ts`.
