# OCR usability Plan

## Decisions Log
- [2026-06-20] AGREED: QA sweep complete; PDFturbo wrap-up for LinkedIn.
- [2026-06-20] AGREED: Make OCR genuinely usable — chose Option 1 (default searchable + text export) + Option 3 (OCR→DOCX).
- [2026-06-20] DISCOVERY: searchable is ALREADY the default (index.html option order + searchableOcr flag ON). The unreadable result the user saw = the `visible` ("editable boxes") mode overlaying the scan. So Option 1's "flip default" is already done; real work = de-trap visible + add text/DOCX export.
- [2026-06-20] AGREED: zero-regression mandate (TDD, full suite green). Autonomous 3C chosen.

## Formal Plan
Approach: extract the shared render+recognize step once; keep `visible`/`searchable` byte-identical; add two read-only export modes off the same recognition result.

1. `src/utils/flowDoc.ts` — `ocrTextToFlowDoc(text)` pure helper → single-page FlowDoc (one body paragraph per non-blank line; RTL→right-aligned). Linear text transcription; column/table layout NOT reconstructed (ceiling).
2. `src/handlers/ocrHandler.ts` — extract private `_recognize(page,src,lang,onProgress)`; `run('visible'|'searchable')` calls it (behavior preserved). New public `recognizeCurrentPage(lang,onProgress)` (same guards + single-flight) → `OcrResult | null`.
3. `src/export/exportService.ts` — `exportOcrText(text)` (best-effort clipboard + `.txt` download) and `exportOcrDocx(text)` (`ocrTextToFlowDoc`→`flowDocToDocxBlob`→download). Empty text → warn, never empty file.
4. `src/core/pdfTurboApp.ts` `runOcr()` — branch on raw select value: text/docx → recognize + export; visible/searchable → `run()` (unchanged). `OcrOutputMode` NOT widened.
5. `index.html` — add `text` + `docx` options; relabel searchable "(recommended)", visible as "editable boxes — best for clean pages, not scans"; fix hint.
6. `locales/{en,fr,ar}.json` — new keys (mode labels, hint, toast.ocrTextCopied / ocrTextExported). Key-identical (hook-enforced). ar [Unverified].
7. Tests — jsdom: ocrTextToFlowDoc; exportOcrText/Docx (unzip docx, assert text). Browser: extend ocr real-engine e2e (text/docx). Existing OCR guards stay green.

Acceptance: visible/searchable byte-identical; new paths red→green; type-check && lint && test && test:browser exit 0.
No new feature flag (low-risk additive).
