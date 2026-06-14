# PDFturbo Mega-Roadmap Plan — 2026-06-14

Comprehensive, research-backed plan to "wrap up without compromise": true-edit reliability,
DOCX near-100% fidelity, full quality/a11y/i18n/security audit, new features, and total doc
refresh. Evidence-graded. Raw research: `docs/reviews/research-2026-06-14/01..05-*.md`.

## Decisions Log
- [2026-06-14] AGREED: Deliverable = full research + ONE comprehensive prioritized plan; no code changes this session beyond trivial. (user: "Full research + mega-plan")
- [2026-06-14] AGREED: Research engine = HYBRID — parallel research agents for the static sweep + main-loop live browser QA; NOT a heavy multi-agent Workflow (the empirical core is single-browser/sequential; Workflow agents are headless and can't drive the browser). (user delegated via "challenge me")
- [2026-06-14] AGREED: Personal PDFs (CV, attestation) used as black-box test inputs only — never extract/print contents (personal data). `test-document.pdf` is the primary safe fixture.
- [2026-06-14] DONE: Sprint 1 executed (4 parallel TDD agents + parent integration gate) — REDACT-DOCX leak (P0, confirmed RED then fixed in flowDoc/exportService), MEMLEAK (P1, Command.dispose + loadingTask.destroy; corrected agent's no-op doc.destroy), TRUEEDIT-XOBJECT no-op (P1→overlay fallback), TRUEEDIT-OVERBLANK (P1, shadow radius 4→0.5pt), A11Y canvas/toast + I18N update toast (P1). Caught + fixed 2 agent integration misses (no-op destroy via type-check; DOCX browser-test fixture regression). Gate: type-check clean, oxlint 0/0, jsdom 800, browser 11. KNOWN_ISSUES.md updated.
- [2026-06-14] DONE: Sprint 0 executed — H1 (CLAUDE.md doc-truth: escapeValue/registerType/export-consolidation), C1 (oxlint 76→0 warnings), C2 (stale eslint-disable modernized in touched files), D4 (dead `diagnosePage` removed; `getFormXObjectMatrix` NOT dead — 2 live callers), F2 (IndexedDB privacy note in SECURITY.md). Gate: oxlint 0/0, type-check clean, jsdom 771, browser 11. Migration committed separately (462f53e).
- [2026-06-15] DONE: Sprint 2 executed (2 parallel TDD agents, disjoint files, parent full gate + real-Chrome manual QA). True-edit A-1..A-5 (XObject/refused→overlay, full-TJ-hex, UTF-16BE cmap, scoped blanking, Type3/vertical/invisible refuse) + DOCX B-1..B-5 (font allow-list, margins, spacing, floating images, justify/indent). Gate: type-check clean, oxlint 0/0, jsdom 832, browser 11/11. Commits 780193d/d662f98/45a8423. CI failed on flaky `issue1-toolbar-dnd` (verified non-deterministic: 1 fail/4 pass same code) → fixed with scoped `retry:2` (7dd7fd2). CI now green. Confirmed `test:browser` IS in deploy.yml.
- [2026-06-15] AGREED: Sprint 3 = Fidelity & UX Deep Sweep. Fidelity goal = "(1) scorecard + fix reachable + mark ceiling, THEN (2) attempt the hard ones." Method = hybrid (parallel static-research agents to disk + main-loop live browser empirical testing + TDD fixes). Persist plan → user compacts → resume. Fold the live-found text-tool UX defect into Track 3; recommended fix = separate Add Text (draw-to-place) from Edit PDF text. (user: "1 then 2", "persist plan then I compact", "challenge me")
- [2026-06-14] AGREED: Sprint 2 = fidelity, BOTH workstreams, gate mode "Default 30/8 with stops" (user). Scope re-cut around correctness-first: Workstream A = A1 B4 XObject no-op→overlay, A2 B3 replaceShowOpHex all-TJ-segments, A3 B2 cmapHexToUnicodeStr UTF-16BE 4-hex+surrogates, A4 B5 blankAllNearby restrict-to-same-font-size, A5 defensive routing (Type3/vertical/invisible-Tr → overlay). Workstream B = B1 broaden font allow-list, B2 page margins, B3 para/line spacing, B4 image x/y positioning, B5 justify+indent. DEFERRED (research-confirmed multi-day/hard): lattice tables, vector→raster, recursive 3-col XY-cut, rotated-page true-edit, RTL logical reorder, A6 cm-rotation redraw (regression risk). Method: 2 parallel TDD agents on disjoint files + parent full gate; locale edits in parent. (user: "Approve full plan")

- [2026-06-15] DONE (Sprint 3, batch 1): Research fan-out (3 agents → `docs/reviews/research-2026-06-15/01-docx-gaps.md`, `02-trueedit-matrix.md`, `03-ux-a11y.md`) + 2 fidelity scorecards (`scorecard-docx.md`, `scorecard-trueedit.md`). Fixes: **UX text-tool trap** (editText edits existing text only; blank click no longer drops a box → reverts ISSUE-5; commit 873dd37) + **DOCX lettered/parenthesized ordered-list markers** (decimal `(1)`/`1)`, lower/upper-alpha paren forms → docx LevelFormat + per-format numbering refs; commit 5a95192) + ISSUE-5 browser guard updated (7730110). Gate: type-check clean, oxlint 0/0, jsdom **842**, browser **11/11**. Docs refreshed (CLAUDE.md, KNOWN_ISSUES.md, FEATURES.md). NOT pushed (manual).

## Formal Plan

### ▶ RESUME HERE (post-compact, 2026-06-15) — SPRINT 3 sweep

**Sprint 3 batch 1 LANDED (not pushed).** Commits: `873dd37` (UX text-tool trap fix — editText
edit-existing-only), `5a95192` (DOCX lettered ordered-lists), `7730110` (ISSUE-5 browser guard). Gate:
type-check clean, oxlint 0/0, jsdom **842**, browser **11/11**. Scorecards + research in
`docs/reviews/research-2026-06-15/`. **The true-edit routing matrix answers the user's standing question
"why does it overlay some text" — see `scorecard-trueedit.md` top paragraph.**

**NEXT reachable gaps (TDD, highest-ROI first), file:line in the scorecards:** DOCX — JPEG re-encode (S,
extraction hardcodes png), hyperlinks (M, high value: getAnnotations→ExternalHyperlink), list nesting
(listDepth from x0), spot-color black-collapse (B7), super/subscript, underline/strike, H4-6. True-edit —
**TJ kerning preservation (biggest-ROI, ~1d)**, Path-3 color canvas-sample fallback, tokenizer exponent.
**Ceiling (mark, don't chase):** tables, vector→raster, recursive 3-col, RTL reorder, exact subset faces;
true-edit cm-rotation Path-3, Type3, Arabic. Then: Sprint 3 features (page ops, encrypt, PAdES sig, OCR),
engine split (contentStreamEditor.ts ~1499L), a11y/SEO P2/P3, command tests.

---

### (original resume context, pre-batch-1)

**State — all committed, all green, CI green.** Sprint 2 landed: commits `780193d` (true-edit A-1..A-5),
`d662f98` (DOCX B-1..B-5), `45a8423` (docs), `7dd7fd2` (CI flake fix: retry on `issue1-toolbar-dnd`).
Gate last run: type-check clean, oxlint **0/0**, jsdom **832**, browser **11/11**, real-Chrome manual QA
0 errors. **CI is green** (deploy.yml runs type-check→lint→jsdom→`test:browser`→build→deploy; browser
suite IS integrated). All pushed by user. Working tree: only the 3 untracked PDFs.
**RESTART `npm run dev` (:5173) post-compact.** NEVER commit the CV/attestation (personal data) — use
them BLACK-BOX only (structural metrics, never print contents); `test-document.pdf` is the safe fixture.
git push is manual; commits = thematic; NO Co-Authored-By. Run browser tests with
`./node_modules/.bin/vitest run --config vitest.browser.config.ts` (PATH `vitest`/`npx vitest` =
rtk-proxied global nightly → bogus output). `gh` CLI is NOT installed; use the public GitHub API via
`curl` for CI status (logs need a token we don't have).

**NEXT = Sprint 3 — Fidelity & UX Deep Sweep (user-chosen).** Goal order: **(1) scorecard + fix every
reachable gap + honestly mark the unreachable ceiling, THEN (2) attempt the fundamentally-hard items.**
Full detail below in "## Sprint 3 — Fidelity & UX Deep Sweep". Method = HYBRID: parallel static-research
agents write raw findings to `docs/reviews/research-2026-06-15/` (they CANNOT drive a browser); the
**empirical browser testing (DOCX export, true-edit clicks, UX/intuitiveness) is run live by the main
loop** + TDD fixes + parent full gate. Known live-found UX defect to fold into Track 3:
**text tool** — blank-add isn't draw-to-place (can't drag to size like shapes) AND an added box can't be
deleted/resized/rotated because edit-text mode keeps intercepting → re-adds/displaces. Recommended fix:
**separate "Add Text" (draw-to-place) from "Edit PDF text" (click existing)**, auto-switch to Select after
placing (reverts the ISSUE-5 unification).

---

## Sprint 3 — Fidelity & UX Deep Sweep (ACTIVE)

**Goal (user-ordered):** **Phase 1** = build a per-attribute *fidelity scorecard*, fix every **reachable**
gap, and honestly **mark the unreachable ceiling**. **Phase 2** (after Phase 1 lands) = attempt the
**fundamentally-hard** items knowing ROI/certainty is low. Do NOT chase "100%" as a number — measure,
fix-reachable, document-ceiling.

**Method = HYBRID.** Static analysis fans out to parallel agents (write raw findings to
`docs/reviews/research-2026-06-15/`); empirical browser work is run **live by the main loop** (agents are
headless, cannot drive Chrome). Every fix is TDD; parent runs the full gate (type-check + oxlint 0/0 +
`npm run test` + `./node_modules/.bin/vitest run --config vitest.browser.config.ts`) before any commit.
Corpus: `test-document.pdf` + synthetic per-attribute fixtures in `tests/fixtures/` + (BLACK-BOX only,
never print contents) the personal CV/attestation for structural metrics. Prior raw research to build on:
`docs/reviews/research-2026-06-14/01-true-edit.md` + `02-docx-fidelity.md`.

### Track 1 — DOCX fidelity scorecard
Per-attribute measure → fix-reachable → mark-ceiling. Attributes & current state (post-Sprint-2):
DONE: font family allow-list (B-1), size, bold/italic name-sniff, margins (B-2), para/line spacing (B-3),
L/C/R + justify (B-5), indent (B-5), bullet+ordered lists (flat), headings (size cluster), images
position/size (B-4 floating), redaction-aware extraction (Sprint 1), per-page sections, RTL flags.
REACHABLE GAPS (Phase 1 fix): underline/strike (path-seg detect), hyperlinks (`getAnnotations`→
`ExternalHyperlink`), super/subscript (baseline+size ratio), list nesting (x0 buckets) + wider marker
regex (a)/i./(1)), heading bold/caps signal + H1-H6, color robustness (replace origin-keyed `colorMap`;
handle scn/Separation→black bug B7), JPEG photo re-encode (stop PNG bloat), rotated/skewed image sizing.
CEILING (Phase 2 / mark honest): lattice tables (vector ruling detect), borderless tables (chronic FP),
vector→region rasterization, recursive 3-col/мixed XY-cut + tagged-PDF `getStructTree` fast path,
headers/footers routing, RTL logical reorder + Arabic presentation-form normalization, exact subset-font
face matching (no embedded file = impossible). Editor overlay annotations in DOCX = product decision.

### Track 2 — True-edit fidelity scorecard
Edge-case matrix already enumerated in `01-true-edit.md §3` — re-verify each post-Sprint-2 (live + browser
tests): standard/subset/CID/Type3/embedded × ASCII/accent/€/ligature/kerned-TJ/CID-multibyte; cm-transformed;
Form-XObject (now overlay); nested XObject; rotated page; RTL/Arabic; vertical/WMode (now refuse); invisible
Tr (now refuse); encrypted (overlay); scanned (add-box); tagged (breaks MCID). For each: which path
(1 literal / 2 subset-reuse / 3 redraw / overlay / refuse) and is the result visible + extractable + correct?
REACHABLE GAPS (Phase 1): TJ kerning preservation (re-distribute vs collapse — roadmap A5, NOT yet done),
B7/B8 fill-color scn/Separation + `Tr` color tracking, number-tokenizer hardening (B1). CEILING (Phase 2):
cm scale/rotation in Path-3 redraw (A6), rotated-page location/placement, RTL shaped-glyph encoding +
embedded Arabic fallback font, Type3 true-edit, PDFium-WASM moonshot.

### Track 3 — UX / intuitiveness sweep (live browser; qa-sweep skill)
Drive the real app. **Fold in the live-found text-tool defect** (blank-add not draw-to-place; added box
can't be deleted/resized/rotated because edit-text keeps intercepting → re-add/displace). Recommended fix:
**separate Add Text (draw-to-place, drag like shapes) from Edit PDF text (click existing)**, auto-switch to
Select after placing/editing. Broader sweep: tool discoverability / easy-find / labels, the
add→select→transform→delete loop for EVERY element type, keyboard + focus, mobile/touch nav (44px targets),
a11y of the editing flow (axe-core), empty/error states, modal Esc, i18n completeness on new strings.
Output: prioritized UX findings (SYSTEMIC vs PAGE vs MOBILE) + TDD fixes for the defects.

### Execution order (resume)
0. Restart dev server; confirm gate still green.
1. Fan out parallel research agents (Track 1 gap-detail, Track 2 matrix re-verify, Track 3 static UX/a11y
   read) → raw files in `docs/reviews/research-2026-06-15/`. Cap ≤5 concurrent LLM agents.
2. Build the two scorecards (DOCX, true-edit) from a fixture corpus — main loop runs the empirical
   browser/export measurements; write `docs/reviews/research-2026-06-15/scorecard-*.md`.
3. Live browser UX sweep (Track 3) including the text-tool repro.
4. PHASE 1 fixes (reachable gaps), TDD each, thematic commits, gate green, manual QA.
5. PHASE 2 attempts (hard items), clearly labelled experimental; keep or honestly mark unreachable.
6. Update KNOWN_ISSUES.md / CLAUDE.md / FEATURES.md as each lands.

---

### Headline finding: CLAUDE.md & docs are STALE (P1 correctness-of-docs)
Two agents independently found the docs misdescribe the real config — fix before anything cites them:
- `i18n.ts:71` is `escapeValue: true` (SAFE), not `escapeValue:false` as CLAUDE.md claims.
- `vite.config.ts` is `registerType: 'prompt'`, not `'autoUpdate'` — pushes do NOT silently update open sessions; there's a saved-session restore prompt (live-confirmed).
- God-object / export-triplication / handler-coupling smells are RESOLVED (commands/, binders/, exportPipeline, IAppContext) — CLAUDE.md still describes them as open.
[Verified: agents 3 & 4, file:line]

---

## Workstream A — True PDF text edit: reliability & fidelity (HEADLINE)
Goal: maximize the fraction of clicks that yield a real, correct in-place edit; degrade gracefully and visibly otherwise.

| ID | Item | Sev | Effort | Evidence |
|----|------|-----|--------|----------|
| A1 | **XObject replace silently no-ops** → make it fall back to overlay instead of losing the edit (B4) | P1 | 2h | Verified (control flow) |
| A2 | **4pt collateral blanking** — `blankAllNearby` over-blanks distinct adjacent text (B5) | P1 | 4h | Verified |
| A3 | **Raise match rate**: tune `TRUE_EDIT_TOLERANCE`/multi-candidate scan; add occurrence-hint for multiple show-ops sharing one origin | P1 | 1-2d | Verified |
| A4 | `replaceShowOpHex` only replaces first TJ segment (B3); `cmapHexToUnicodeStr` parity heuristic wrong for ligatures/non-BMP (B2) | P1 | 1-2d | Inferred (code) |
| A5 | **TJ kerning preservation** — same-line neighbors shift after edit | P2 | 1-2d | Verified |
| A6 | `cm`/`Tm` scale + rotation in Path-3 redraw (currently mis-oriented); rotated pages | P2 | 1-2d | Verified |
| A7 | Detect Type3/vertical-WMode/`Tr` invisible-OCR layers → force overlay (don't pretend to edit) (B8) | P2 | 4h | Inferred |
| A8 | fillColor `sc/scn` parse so redraw keeps original color (B7); empty-hex U+0000 injection (B6); number-tokenizer sign drop (B1) | P2/P3 | 1d | Inferred |
| A9 | RTL/Arabic true-edit (std fonts lack glyphs) | P3 | 1-2wk | Verified hard |
| A10 | **Harness**: add fixtures (standard/subset/CID/XObject/rotated/RTL/TJ-kerned) to `tests/browser/` proving each path's behavior | P1 | 1d | — |

UX: merge "Add Text" + "Edit PDF text" buttons into one unified mode (ISSUE-5 follow-up); surface a clear toast when an edit fell back to overlay vs true-edit, so users understand the behavior they're seeing.

## Workstream B — DOCX export: toward near-100% fidelity
| ID | Item | Sev | Effort |
|----|------|-----|--------|
| B0 | **Redaction not applied to DOCX export** — if redaction+DOCX combine, redacted source text leaks (security) | P0 | 4h |
| B1 | Broaden font allow-list beyond 3 generics (biggest body-text wrongness) | P1 | 1d |
| B2 | Emit page margins, paragraph/line spacing | P1 | 1d |
| B3 | Robust color (replace fragile origin-keyed lookup) | P1 | 0.5d |
| B4 | Image positioning (currently dumped centered at page end, ignoring x/y) | P1 | 1d |
| B5 | Underline/strike/super-subscript/justify/indentation | P2 | 2d |
| B6 | Lattice (ruled) table detection via vector grid | P2 | 3-5d |
| B7 | Vector-region rasterization (logos/charts via `constructPath` → image) | P2 | 2d |
| B8 | Hyperlinks; list nesting/restart; recursive XY-cut (>2 col) | P2 | 2-3d |
| B9 | `getStructTree()` tagged-PDF fast path (exact, ~15% of PDFs) | P3 | 3d |
Fundamentally hard (flag, don't over-promise): exact subset-font matching, borderless tables, reading order on untagged complex layouts, vector→editable, RTL reorder.

## Workstream C — Lint zero-tolerance + type safety
- C1: Fix all **76 oxlint warnings** — 38 require-await (drop `async`), 19 no-explicit-any (→`unknown`/real types), 10 no-console (remove/guard), 9 no-shadow (rename). [Verified: counts]. Effort: 0.5-1d.
- C2: Remove ~41 stale `eslint-disable` comments (reference the removed tool). 1h.
- C3: Replace avoidable `any` in correctness paths (`moveCmds as any`, `pdfElementRenderer` ctx, `textSearchHandler`). 0.5d.

## Workstream D — Architecture
- D1 (P1): **pdfjs-document memory leak** — `ReplaceSourcePdfBytesCmd` pins multi-MB pdfjs docs on the history stack; `historyManager._push` evicts via `shift()` with no `dispose()`/`.destroy()`. Add a disposer hook on command eviction. 0.5d.
- D2 (P1): **`core/commands/` has zero unit tests** — undo-correctness core. Add pure-logic tests. 1d.
- D3 (P2): split `contentStreamEditor.ts` (1406) → tokenizer/matrix/fonts/edits (pure file move). 0.5d.
- D4 (P3): remove dead code (`diagnosePage`, `getFormXObjectMatrix`); 5 fake-async fns (overlaps C1).

## Workstream E — Cross-cutting (a11y / i18n / mobile / SEO-PWA)
- E1 (P1): canvas annotations need role/tabindex/aria-label (`elementLayerRenderer.ts`) — keyboard+SR can't enumerate elements. WCAG 2.1.1/4.1.2.
- E2 (P1): toasts not announced — add `role/aria-live` to `#toast` + `toastQueue.ts`. WCAG 4.1.3.
- E3 (P1): hardcoded English update toast `main.ts:16` (key `toast.appUpdateAvailable` already exists) — wire to `t()`.
- E4 (P2): desktop `.btn-icon` min-height (2.5.8); `prefers-reduced-motion`; disablable single-key shortcuts (2.1.4); `rel=noreferrer` on GitHub link; tablet breakpoint (toolbar overflow at one 640px bp); SEO description/OG/Twitter meta; PWA raster icons (currently SVG-only → installability).
- E5 (P3): muted-text contrast; robots/sitemap.
- E6: locale files are **key-identical (313 keys, 0 diff)** — PASS; Arabic values still need native-speaker review (mark DRAFT in FEATURES.md). Find any remaining hardcoded user-visible strings (E3 is the known one).

## Workstream F — Security
- F1 (P0): redaction-in-DOCX leak (= B0).
- F2 (P3): document that raw PDF bytes sit unencrypted in IndexedDB (by-design, privacy note in SECURITY.md/README).
- F3: XSS risk LOW — all `innerHTML` are `= ''` clears, no `insertAdjacentHTML/eval/document.write`, no external loads, CSP present. No action beyond keeping `escapeValue:true`.

## Workstream G — New features roadmap (research-confirmed, MIT/Apache only, 100% client-side)
**Tier 1 (quick, high-value):**
- G1 Merge / Split / Extract / Reorder / Delete / Rotate pages — almost free with @cantoo/pdf-lib + fflate. [Verified] S.
- G2 Encrypt (cantoo `.encrypt()`, nearly free) + Decrypt/remove password (pdf.js decrypts with user password → re-save unencrypted). [Verified] S-M.
- G3 PDF compression/optimize (image downsample + re-embed). [Inferred] M.
- G4 Form flattening; flatten annotations. [Verified] S-M.
**Tier 2:**
- G5 **OCR searchable layer** — `tesseract.js` (Apache-2.0) + pdf.js raster + invisible text layer; lazy-load like the docx chunk. Flagship differentiator. [Verified] M-L.
- G6 Compare two PDFs — `pixelmatch` (MIT) + `diff` + pdf.js. [Verified] M.
- G7 Page numbering / Bates stamping (must hit all 3 export paths). M.
**Tier 3 (moonshots / flagged):**
- G8 **Cryptographic e-signature (PAdES/PKCS#7)** — `zgapdfsigner` (MIT, node-forge core) signs with a P12/PFX entirely in-browser, PAdES via `ETSI.CAdES.detached`. [Verified feasible] L. High value, key UX/security design needed (cert handling).
- G9 PDF/A — only via Ghostscript-WASM = **AGPL + 18MB** → NOT recommended.
- G10 Accessibility tagging — no mature in-browser lib (pdf-lib can't author struct tree) → defer.
Recommended first three: G1, G2, G5.

## Workstream H — Documentation refresh (EVERYTHING)
- H1 CLAUDE.md: fix `escapeValue` (true), `registerType` ('prompt'), resolved architecture smells, true-edit path/bug status, DOCX gap list. (P1 — others cite this.)
- H2 FEATURES.md: mark Arabic DRAFT; correct true-edit fidelity claims; add new-feature roadmap section.
- H3 KNOWN_ISSUES.md: add A1-A9 / B-bugs / D1 / E1-E3 as tracked entries with repro + test-needed.
- H4 README.md / SECURITY.md: IndexedDB privacy note (F2); feature list sync.
- H5 Legal/community pages (CODE_OF_CONDUCT, CONTRIBUTING, THIRD-PARTY-NOTICES): verify new deps (tesseract.js/zgapdfsigner/pixelmatch) licenses get added when those features land.
- H6 locales: add keys for any new UI; keep 3-way parity (hook enforces); commission Arabic native review.

## Workstream I — Test harness expansion (empirical vehicle)
- I1: edge-case PDF fixtures for true-edit (A10) and DOCX fidelity (per-dimension) in `tests/browser/`.
- I2: unit tests for `core/commands/` (D2) and pure utils (hitTest/geometry/binaryUtils).
- I3: an export-assembly jsdom test.

## Suggested execution sequencing (post-approval)
1. **Sprint 0 (safe, no-risk):** H1 docs-truth fixes + C1/C2 lint-zero + D4 dead code + F2 note. (1-1.5d)
2. **Sprint 1 (security + headline bugs):** B0/F1 redaction leak, A1/A2 true-edit bugs, D1 memory leak, E1-E3 a11y P1. (2-3d)
3. **Sprint 2 (fidelity):** A3-A6 true-edit match-rate/kerning/transform; B1-B4 DOCX P1. (1wk)
4. **Sprint 3 (features Tier 1):** G1 pages, G2 encrypt/decrypt. (1wk)
5. **Sprint 4 (flagship):** G5 OCR or G8 e-signature (pick one). (1-2wk)
Each item is TDD: failing test (jsdom or browser harness) first, then fix; full gate (type-check + lint + test + test:browser) before commit.
