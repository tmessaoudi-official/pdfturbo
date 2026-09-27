# Mixed-direction fixtures

- `mixed-bidi.pdf` — generated for this repo (limits row 19) by LibreOffice
  (`soffice --headless --convert-to pdf mixed-bidi.fodt`) from `mixed-bidi.fodt`, seven one-line paragraphs in
  Noto Sans Arabic / Noto Sans: RTL paragraphs with an embedded English word, a number, a two-word English run
  split by a bold word, and brackets; an English paragraph with an Arabic phrase split by a bold word; pure
  controls; and one line with a lam-alef ligature (`كلام`). The `.fodt` is the source of truth for the typed text.

- `arabic-table.pdf` — generated the same way from `arabic-table.fodt` (limits row 42): a ruled right-to-left table
  in Noto Sans Arabic, flush-right Arabic cells, two wrapped mixed cells and a bracketed `(RTL)`. The `.fodt` is the
  source of truth for the typed text. Note `mixed-bidi.fodt` uses `fo:text-align="end"`, which in right-to-left
  writing is flush LEFT; that is historical, not a choice to copy.

Used by `tests/browser/docx-mixed-bidi.browser.test.ts` and `tests/browser/table-arabic.browser.test.ts`.
