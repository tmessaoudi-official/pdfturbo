# pdfturbo gotchas — conventions

Moved verbatim from CLAUDE.md § Gotchas on 2026-09-28 (review-remediation 5.3, /rules-split). Scope: repo-wide conventions: base path, jsdom tests, the one PDF write library, private methods. These entries are this project's decision register (the design docs they came from were removed in `ac4ef68`). New entries for this area go HERE, not into CLAUDE.md. A § "…" reference names a heading in CLAUDE.md or in another `.claude/rules/` file — CLAUDE.md § Gotchas lists every moved heading; a § that names a bold paragraph (e.g. "MD/TXT parity") or paraphrases a heading resolves by grepping the phrase in `.claude/rules/`.

### Base path is `/pdfturbo/`

(vite.config.ts) — asset URLs and SW scope depend on it.

### Tests run in jsdom

Canvas rendering, real PDF rasterization, and pointer gestures
are not exercised by `npm run test`. There is now a real-browser harness — `npm run test:browser`
(`tests/browser/*.browser.test.ts`, real Chrome) — that DOES exercise these; use it for
editor/export/DnD changes alongside `npm run dev` manual checks. CI runs both suites (deploy.yml).

### Only `@cantoo/pdf-lib` is the PDF write library

(the dead `pdf-lib` and `qpdf-wasm`
deps were removed 2026-06-11). Never add the bare `pdf-lib` back — it has been abandoned
upstream since ~2021.

### Private-method convention

`_underscore` prefix throughout; oxlint's `no-unused-vars`
allows unused args/vars only when `_`-prefixed (`argsIgnorePattern`/`varsIgnorePattern`).
`no-underscore-dangle` is deliberately OFF in `.oxlintrc.json` so it doesn't fight this convention.
