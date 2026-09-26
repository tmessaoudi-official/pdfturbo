# Third-Party Notices

PDFturbo is distributed with the following third-party open-source software. Each is used
under a permissive license that allows commercial use, distribution, and sale. Full license
texts are available in each package's repository (and, for fonts, in the vendored file noted
below).

_Last generated: 2026-06-26, from `package.json`; versions refreshed 2026-09-13 after the upgrade to
latest (every licence re-read from the installed `package.json` — none changed). fflate and the four
packages under "Bundled transitively" were added the same day, after WS7 round 10 found them missing;
the transitive dependencies of the other libraries followed after WS7 round 11. The pdf.js data files
(CMaps, decoders, colour module, CMYK profile) were added 2026-09-26 with rows 32, 36 and 37._

---

## Bundled runtime libraries (shipped in the application)

### pdfjs-dist (PDF.js)
- **Version**: ^6.3.289 · **License**: Apache-2.0
- **Repository**: https://github.com/mozilla/pdf.js
- Copyright © Mozilla Foundation and PDF.js contributors
- **Data files served from `pdfjs/`** (copied from the package by `scripts/prepare-pdfjs-assets.mjs`; each
  licence text is served beside its files):
  - `pdfjs/cmaps/` — Adobe CMap resources · BSD-3-Clause · Copyright 1990-2009 Adobe Systems Incorporated (`cmaps/LICENSE`)
  - `pdfjs/wasm/jbig2*` — JBIG2 decoder from PDFium · BSD-3-Clause · Copyright 2014 The PDFium Authors (`LICENSE_JBIG2`; pdf.js build glue Apache-2.0, `LICENSE_PDFJS_JBIG2`)
  - `pdfjs/wasm/openjpeg*` — OpenJPEG · BSD-2-Clause (`LICENSE_OPENJPEG`, `LICENSE_PDFJS_OPENJPEG`)
  - `pdfjs/wasm/qcms_bg.wasm` — qcms colour management · MIT · Copyright 2009-2024 Mozilla Corporation, 1998-2007 Marti Maria (`LICENSE_QCMS`, `LICENSE_PDFJS_QCMS`)
  - `pdfjs/iccs/CGATS001Compat-v2-micro.icc` — default CMYK profile · CC0-1.0 (`iccs/LICENSE`)

### @cantoo/pdf-lib
- **Version**: ^2.11.0 · **License**: MIT
- **Repository**: https://github.com/cantoo-scribe/pdf-lib
- Copyright © 2019 Andrew Dillon; maintained by Cantoo Scribe

### @pdf-lib/fontkit
- **Version**: ^1.1.1 · **License**: MIT
- **Repository**: https://github.com/Hopding/fontkit
- Copyright © 2014 Devon Govett

### bidi-js
- **Version**: 1.1.0 · **License**: MIT
- **Repository**: https://github.com/lojjic/bidi-js
- Copyright © 2021 Jason Johnston

### bwip-js
- **Version**: ^4.11.4 · **License**: MIT
- **Repository**: https://github.com/metafloor/bwip-js
- Copyright © 2011-2026 Mark Warren

### docx
- **Version**: ^9.7.1 · **License**: MIT
- **Repository**: https://github.com/dolanmiu/docx
- Copyright © 2016 Dolan Miu

### i18next
- **Version**: ^26.4.2 · **License**: MIT
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
- **Versions**: commands ^1.7.1 · history ^1.5.0 · keymap ^1.2.3 · model ^1.25.9 · schema-basic ^1.2.4 · schema-list ^1.5.1 · state ^1.4.4 · tables 1.8.5 · view ^1.42.3
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

### fflate
- **Version**: ^0.8.3 · **License**: MIT
- **Repository**: https://github.com/101arrowz/fflate
- Copyright © 2026 Arjun Barrett

### tesseract.js
- **Version**: ^7.0.0 · **License**: Apache-2.0
- **Repository**: https://github.com/naptha/tesseract.js
- Copyright © 2015 Project Naptha and Tesseract.js contributors

### Bundled transitively (runtime dependencies of @cantoo/pdf-lib)

Each grade says how its presence in the built application was established.

- **culori** 4.0.2 · MIT · https://github.com/Evercoder/culori · Copyright © 2018 Dan Burzo —
  *verified*: its colour-space names are in the entry bundle.
- **html-entities** 2.6.0 · MIT · https://github.com/mdevils/html-entities · Copyright © 2021 Dulin Marat —
  *verified*: its entity table is in the entry bundle.
- **node-html-better-parser** 1.5.9 · MIT · https://github.com/Sharcoux/node-html-parser ·
  Copyright 2019 Tao Qiufeng — *inferred*: imported by pdf-lib's `PDFDocument`, which the application
  uses; its warning strings were not found, so presence rests on the import, not on a string match.
- **tslib** 2.8.1 · 0BSD · https://github.com/Microsoft/tslib · Copyright © Microsoft Corporation —
  *inferred*: pdf-lib's ES build imports its helpers, which carry no string a bundle search can match.

### Bundled transitively (runtime dependencies of the other libraries)

The set is the production dependency graph in `package-lock.json`. *Verified* means a string from the
package is in the built `dist/`; *inferred* means the graph plus the importing library's own presence,
without a string match. Licence texts and copyright lines are in each package's own `LICENSE`.

- **pako** 1.0.11 · MIT AND Zlib · https://github.com/nodeca/pako — *verified*: `pako deflate (from
  Nodeca project)` is in the DOCX chunk. Reached through jszip and @pdf-lib/fontkit.
- **jszip** 3.10.1 · dual MIT OR GPL-3.0-or-later, **used under MIT** · https://github.com/Stuk/jszip —
  *verified*: its `JSZip` UMD wrapper is in the DOCX chunk. A dependency of docx.
- **readable-stream** 2.3.8 · MIT · https://github.com/nodejs/readable-stream — *verified*: required by
  name inside the bundled jszip.
- docx's other dependencies — **hash.js** 1.1.7, **nanoid** 5.1.16, **xml** 1.0.1, **xml-js** 1.6.11 (all
  MIT) and xml-js's **sax** 1.6.1 (BlueOak-1.0.0); jszip's **lie** 3.3.0 with **immediate** 3.0.6 and
  **setimmediate** 1.0.5 (all MIT); and beneath readable-stream and hash.js, **core-util-is** 1.0.3,
  **isarray** 1.0.0, **process-nextick-args** 2.0.1, **safe-buffer** 5.1.2, **string_decoder** 1.1.1,
  **util-deprecate** 1.0.2 (all MIT), **inherits** 2.0.4 and **minimalistic-assert** 1.0.1 (both ISC) —
  *inferred*.
- ProseMirror's own dependencies — **prosemirror-transform** 1.12.0, **orderedmap** 2.1.1,
  **rope-sequence** 1.3.4, **w3c-keyname** 2.2.8 (all MIT) — *inferred*.
- **qrcode-generator** 1.5.2 · MIT — a dependency of qr-code-styling — *inferred*.
- **@babel/runtime** 7.29.7 · MIT — a dependency of i18next-browser-languagedetector — *inferred*.
- tesseract.js's dependencies — **idb-keyval** 6.3.0 (Apache-2.0), **wasm-feature-detect** 1.8.0
  (Apache-2.0), **is-url** 1.2.4, **bmp-js** 0.1.0, **zlibjs** 0.3.1, **regenerator-runtime** 0.13.11
  (all MIT) and **tesseract.js-core** 7.0.0 (Apache-2.0, served from `public/tesseract/`) — *inferred*:
  their names appear in the bundle only inside tesseract.js's embedded package manifest, which is not
  evidence of their code.

In the production graph but **not bundled**: `@napi-rs/canvas` (pdf.js loads it only under Node,
through `createRequire`), `node-fetch` with `whatwg-url`, `tr46` and `webidl-conversions`
(tesseract.js's Node path), `require-from-string` (bidi-js's CommonJS build; checked absent from
`dist/` in WS7 round 10), `opencollective-postinstall` (an install script), and `@types/node` /
`undici-types` (type declarations).

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
