# Full QA Sweep + IP Research Plan (2026-06-19)

## Decisions Log
- [2026-06-19] AGREED: QA mode = Option 1 (suites + browser walkthrough) + Option 3 (exhaustive manual pass) + stress/fuzz robustness. Skip Option 4 (heavy workflow) to respect token budget.
- [2026-06-19] AGREED: IP research = Options 1+2+3 (France-focused incl. employer angle + international overview + practical checklist). General info, NOT legal advice.
- [2026-06-19] AGREED: User is a **Smile (smile.eu/fr) employee**, NOT GRDF. L113-9 employer-ownership analysis applies to Smile.
- [2026-06-19] AGREED: No fixes this turn — produce a prioritized findings report; user gates fixes after.
- [2026-06-19] AGREED: 3C gate = full 30/8 (converged 8/8 at cycle 12).
- [2026-06-19] AGREED: implement Option 2 (P2 + polish) with ZERO-regression mandate (TDD + full suite green). Fixes: (1) P2 errorReporter.error injects {error}; (2) P3 _assemblePdfDoc `PDFDocument.create({updateMetadata:false})` to drop pdf-lib Producer/dates; (3) package.json `"license":"UNLICENSED"`; (4) verify/ship third-party license notices.
- [2026-06-19] VERIFIED-SAFE: tests/fixtures/private/ (real CV/attestation) is gitignored + NOT git-tracked → no leak in the public repo.
- [2026-06-19] REGRESSION CAUGHT + FIXED: broad P3 (strip in _assemblePdfDoc) broke sanitize.browser.test (toast.sanitizeNothing — assemblePdfBytes had nothing to strip). Resolved by NARROWING P3 to opts.cleanMetadata, passed only by downloadPDF/downloadPageRange/downloadFlattened; assemblePdfBytes left byte-identical → sanitize/sign/compress unchanged. Scope locked by a test asserting assemblePdfBytes still carries /Producer.
- [2026-06-19] VERIFIED: third-party notices were STALE — added tesseract.js/node-forge/docx/SortableJS/@pdf-lib/fontkit/Noto-OFL to THIRD-PARTY-NOTICES.md.

## Formal Plan

### Workstream A — QA sweep (NO source changes this turn)
1. Baseline regression net: type-check -> lint -> jsdom test (~1635) -> test:browser (real Chrome). Run FIRST, sequentially (avoid Chrome contention with live MCP).
2. Generate SYNTHETIC fuzz fixtures into `.playwright-mcp/` (no RGPD sample). Cases: large, many-page, truncated/malformed, 0-byte, encrypted, huge-text, exotic/subset fonts.
3. Fuzz/robustness FIRST (parse-heavy paths), time-boxed; a hang = P0, capture-and-move after 2-3 tries.
4. Live browser walkthrough (real Chrome, screenshot each): open -> true-edit (1/2/3 edits, delete, restyle, underline) -> annotations -> forms fill+flatten -> exports (PDF/page/img/DOCX/MD/CSV/XFDF) -> watermark/Bates/crop/compress/sanitize -> OCR (visible+searchable) -> e-sign (gen cert + sign + re-sign refusal) -> Arabic RTL (overlay/select/copy) -> i18n EN/FR/AR + RTL flip -> undo/redo.
5. Cross-check every finding against documented CEILINGS in CLAUDE.md before assigning P-level (avoid false positives).
6. Report -> `docs/reviews/2026-06-19-full-qa-sweep.md`, prioritized P0-P3.

### Workstream B — IP research (parallel, read-only)
- France: droit d'auteur (automatic), APP depot, L113-9 CPI employer ownership (Smile angle).
- International: copyright vs patent vs trademark, Berne Convention, what a LICENSE does/doesn't.
- Practical pre-LinkedIn checklist.

### Env notes
- Dev server: http://localhost:5173/pdfturbo/
- All VITE_FEATURE_* flags ON in dev (no .env overrides).
- predev runs ocr:assets (network download) -> first OCR use slow.
- Playwright MCP file access limited to project + `.playwright-mcp/` (gitignored).
