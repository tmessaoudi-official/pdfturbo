# OCR CSP Fix Plan

Make the OCR feature work in production by serving tesseract.js assets from
`'self'` instead of the CDN (which the app's own CSP `connect-src 'self' blob:`
blocks). Found by /qa-sweep 2026-06-15 (P1).

## Decisions Log
- [2026-06-15] AGREED: Root cause is the app CSP blocking tesseract's CDN fetch (core wasm + traineddata); confirmed via live CSP-violation console errors + `ocrHandler.ts:81` passing no local paths. The CSP is correct (enforces "100% local"); the OCR feature was built CDN-dependent, inconsistent with it.
- [2026-06-15] AGREED: Fix by serving assets from 'self', NOT by relaxing the CSP (relaxing breaks the privacy promise + offline).
- [2026-06-15] AGREED: Asset strategy = **prebuild copy + fetch** — a script copies core+worker from node_modules and downloads traineddata into `public/tesseract/` (gitignored); CI runs it before tests/build. Keeps binaries out of git history.
- [2026-06-15] AGREED: Traineddata tier = **best** (4.0.0), languages **eng + fra + ara** (~33MB in dist, matches EN/FR/AR product scope; user prioritized accuracy).

## Formal Plan

### Assets (prebuild)
- `scripts/prepare-ocr-assets.mjs` (node, idempotent, `--force` to refetch):
  - copy `tesseract.js/dist/worker.min.js` → `public/tesseract/worker.min.js`
  - copy `tesseract.js-core/tesseract-core{,-simd,-relaxedsimd}-lstm.wasm{,.js}` → `public/tesseract/core/` (oem=1 → LSTM variants; co-locate .wasm + .wasm.js so the emscripten glue finds its sibling)
  - download `https://tessdata.projectnaptha.com/4.0.0/{eng,fra,ara}.traineddata.gz` → `public/tesseract/lang/`
- `.gitignore`: add `/public/tesseract/`
- `package.json`: `"ocr:assets"` script + `"predev"`/`"prebuild"` hooks (idempotent skip → cheap re-runs)
- `deploy.yml`: add `- run: npm run ocr:assets` BEFORE `npm run test` (browser test needs assets) — earliest safe point after `npm ci`

### Wiring
- `ocrTypes.ts` `OcrOptions`: add `corePath?`, `workerPath?` (langPath exists); update the stale CDN doc-comment
- `ocrEngine.ts`: extend `TesseractLike.recognize` options type with corePath/workerPath; forward all three in `recognizeOptions`; refresh the OFFLINE CAVEAT header (now local by default)
- `ocrHandler.ts`: new pure helper `ocrAssetPaths(base)` → `{corePath, workerPath, langPath}` from `import.meta.env.BASE_URL`; pass into `recognizePage`. Honest error: distinguish load/CSP failure from recognition failure if feasible.

### Tests (TDD)
- `ocrEngine.test.ts` (extend): corePath/workerPath/langPath forwarded to the mock recognize options
- `ocrAssetPaths` unit test: all paths base-relative, contain NO `http`/`cdn` (the anti-regression guard for the P1)
- `tests/browser/ocr-csp.browser.test.ts`: real-Chrome e2e — render a canvas with known text, run with local paths, assert recognition (proves assets load under CSP). Requires `ocr:assets` first.
- LIVE manual verification in the running app (Playwright) under the real CSP — authoritative.

### Docs
- `CLAUDE.md` OCR section: assets now local/CSP-safe; document `npm run ocr:assets` + prebuild
- engine/handler header comments: drop the "CDN fetch acceptable for v1" caveat

## Key risk to validate (Phase 3C angle)
Blob-URL worker (`workerBlobURL: true`) doing `importScripts(localCoreUrl)` inside the worker, then wasm-instantiating — must pass under `script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:`. Verify LIVE in the browser, not just by reasoning.
→ VALIDATED live in `npm run preview` (production build + real CSP): worker.min.js, tesseract-core-relaxedsimd-lstm.wasm.js, and eng.traineddata.gz all loaded from `localhost:4173/pdfturbo/` with 0 console errors / 0 CSP violations. Risk cleared.

## OUTCOME (2026-06-15) — DONE
The CSP investigation surfaced THREE distinct production-breaking bugs (live QA found what jsdom/browser tests missed because neither enforces the prod CSP / both mocked the engine):
1. **CSP blocks the tesseract CDN** → assets vendored to `public/tesseract/`, served from 'self'. [fixed]
2. **Broken dynamic import** — the engine used `import(/* @vite-ignore */ nonLiteral)`, leaving a bare `tesseract.js` specifier the browser can't resolve (dev AND prod). Switched to a literal `import('tesseract.js')` (lazy chunk + resolves correctly). [fixed]
3. **No word geometry** — tesseract.js v7's `recognize` convenience returns only `data.text`; `data.words` was always empty, so the handler added 0 elements (silent "no text"). Switched to `createWorker` + `recognize(img, {}, { blocks: true })` and flatten `data.blocks[].paragraphs[].lines[].words[]` via `flattenBlockWords`. [fixed]

Verification: tsc 0 · oxlint 0/0 · jsdom 1000/1000 · browser 19/19 (incl. `ocr-csp.browser.test.ts` real-engine e2e: recognizes a hand-drawn canvas AND a rasterized pdf.js page). Live preview under prod CSP: assets load from 'self', 0 errors. Note: OCR targets scanned/image pages; clear large text recognizes well, tiny/thin vector text (e.g. the synthetic test fixtures) may legitimately yield 0 words.
