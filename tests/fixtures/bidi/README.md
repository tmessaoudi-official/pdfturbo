# Mixed-direction fixtures

- `mixed-bidi.pdf` — generated for this repo (limits row 19) by LibreOffice
  (`soffice --headless --convert-to pdf mixed-bidi.fodt`) from `mixed-bidi.fodt`, seven one-line paragraphs in
  Noto Sans Arabic / Noto Sans: RTL paragraphs with an embedded English word, a number, a two-word English run
  split by a bold word, and brackets; an English paragraph with an Arabic phrase split by a bold word; pure
  controls; and one line with a lam-alef ligature (`كلام`). The `.fodt` is the source of truth for the typed text.

Used by `tests/browser/docx-mixed-bidi.browser.test.ts`.
