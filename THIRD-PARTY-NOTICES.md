# Third-Party Notices

PDFturbo is distributed with the following third-party open-source software. Each is used
under a permissive license that allows commercial use, distribution, and sale. Full license
texts are available in each package's repository (and, for fonts, in the vendored file noted
below).

_Last generated: 2026-06-26, from `package.json`._

---

## Bundled runtime libraries (shipped in the application)

### pdfjs-dist (PDF.js)
- **Version**: ^6.0.0 · **License**: Apache-2.0
- **Repository**: https://github.com/mozilla/pdf.js
- Copyright © Mozilla Foundation and PDF.js contributors

### @cantoo/pdf-lib
- **Version**: ^2.7.1 · **License**: MIT
- **Repository**: https://github.com/cantoo-scribe/pdf-lib
- Copyright © 2019 Andrew Dillon; maintained by Cantoo Scribe

### @pdf-lib/fontkit
- **Version**: ^1.1.1 · **License**: MIT
- **Repository**: https://github.com/Hopding/fontkit
- Copyright © 2014 Devon Govett

### bidi-js
- **Version**: 1.0.3 · **License**: MIT
- **Repository**: https://github.com/lojjic/bidi-js
- Copyright © 2021 Jason Johnston

### bwip-js
- **Version**: ^4.11.1 · **License**: MIT
- **Repository**: https://github.com/metafloor/bwip-js
- Copyright © 2011-2026 Mark Warren

### docx
- **Version**: ^9.7.1 · **License**: MIT
- **Repository**: https://github.com/dolanmiu/docx
- Copyright © 2016 Dolan Miu

### i18next
- **Version**: ^26.3.1 · **License**: MIT
- **Repository**: https://github.com/i18next/i18next
- Copyright © 2011-present i18next

### i18next-browser-languagedetector
- **Version**: ^8.2.1 · **License**: MIT
- **Repository**: https://github.com/i18next/i18next-browser-languageDetector
- Copyright © i18next

### node-forge
- **Version**: ^1.4.0 · **License**: BSD-3-Clause (dual-licensed `BSD-3-Clause OR GPL-2.0`; PDFturbo elects **BSD-3-Clause**)
- **Repository**: https://github.com/digitalbazaar/forge
- Copyright © 2010-2022 Digital Bazaar, Inc.

### ProseMirror (prosemirror-commands, -history, -keymap, -model, -schema-basic, -schema-list, -state, -tables, -view)
- **Versions**: commands ^1.7.1 · history ^1.5.0 · keymap ^1.2.3 · model ^1.25.9 · schema-basic ^1.2.4 · schema-list ^1.5.1 · state ^1.4.4 · tables 1.8.5 · view ^1.41.9
- **License**: MIT (all)
- **Repository**: https://github.com/ProseMirror
- Copyright © 2015-2017 by Marijn Haverbeke and others

### qr-code-styling
- **Version**: ^1.9.2 · **License**: MIT
- **Repository**: https://github.com/kozakdenys/qr-code-styling
- Copyright © 2019 Denys Kozak

### SortableJS
- **Version**: ^1.15.7 · **License**: MIT
- **Repository**: https://github.com/SortableJS/Sortable
- Copyright © 2019 All contributors to Sortable

### tesseract.js
- **Version**: ^7.0.0 · **License**: Apache-2.0
- **Repository**: https://github.com/naptha/tesseract.js
- Copyright © 2015 Project Naptha and Tesseract.js contributors

---

## Bundled font

### Noto Naskh Arabic
- **License**: SIL Open Font License 1.1 (OFL)
- **Source**: https://fonts.google.com/noto/specimen/Noto+Naskh+Arabic
- Copyright © The Noto Project Authors (https://github.com/notofonts/arabic)
- Full OFL text is vendored at `src/assets/fonts/OFL.txt`.
- Under the OFL the font may be bundled and sold **as part of** PDFturbo; it may not be sold on
  its own, and the reserved name "Noto Naskh Arabic" may not be applied to a modified version of
  the font.

---

## Apache-2.0 note

PDF.js and tesseract.js are used under the Apache License 2.0. PDFturbo consumes them as
published (no modification of their source). Their copyright notices are preserved above.

## Build-time tooling (NOT distributed in the application)

Development and build tools — Vite, vite-plugin-pwa, Vitest, Playwright, oxlint, TypeScript,
jsdom, fake-indexeddb, axe-core and related `@types/*` — are all MIT/Apache-2.0/BSD licensed and
are **not** included in the distributed application bundle, so they impose no distribution
obligations. They are listed in `package.json` under `devDependencies`.
