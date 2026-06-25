# Max-Fidelity Program (true-edit + PDF→DOCX + DOCX editor) Plan

Design spec: `docs/superpowers/specs/2026-06-25-trueedit-docx-maxfidelity-program-design.md`

## Decisions Log
- [2026-06-25] AGREED: Improve true-edit + PDF→DOCX (+ DOCX editor) toward max reachable fidelity, no regressions.
- [2026-06-25] AGREED: Committed items DX-1 (struct-tree), DX-2 (lattice tables), TE-1 (Path-3 transform), TE-2 (Path-3 alpha).
- [2026-06-25] AGREED: Added TE-6 (XObject true-edit, spike-gated), DX-6 (outline→TOC), TE-7 (Path-3 bold/italic face), polish bundle (TE-3/5/8, DX-4) + DX-5 (headers/footers).
- [2026-06-25] AGREED: Added DOCX-editor items DXE-1 (display images), DXE-2 (image editing), DXE-3 (link survives save), DX-8 (Latin ligature NFKC). (Triggered by "do we support images in docx edit?" — verified: images preserved + PDF-export-rendered but NOT view-visible/editable.)
- [2026-06-25] AGREED: Structure = ONE umbrella program design doc → 2 feasibility spikes (TE-6, TE-1) → per-sub-project spec→plan→build, user approves each sub-project spec before its build.

- [2026-06-25] AGREED: After spikes (both positive), spec+build Sub-project B (PDF→DOCX) FIRST.
- [2026-06-25] AGREED: Sub-project B COMPLETE (5/5; B1 committed f0e2b72). NEXT = spec Sub-project A (true-edit) via the brainstorming flow → user review → plan → build.
- [2026-06-25] AGREED: A1 (Path-3 transform redraw) scope = FULL AFFINE — reproduce the entire trm (rotation + scale + shear) as the redraw Tm, using the BASE Tf size (not the vScale-baked fontSize) to avoid double-scaling. (Max fidelity over the lower-risk rotation+uniform-scale option.)
- [2026-06-25] AUDIT (code-is-truth): A4/TE-7 (Path-3 bold/italic face, matchStandardFont wired :2027) + A5/TE-4 (non-WinAnsi/ligature refuse, hasNonWinAnsi :2004) are ALREADY SHIPPED → dropped from Sub-project A. Remaining: A2 (alpha) · A3a (XObject Path-1/2) · A1 (full-affine transform) · A3b (XObject Path-3) · A6 (TE-5 dash/cap/join · TE-8 size-width · TE-3 rotated-input verify).
- [2026-06-25] AGREED: Sub-project A spec (`docs/superpowers/specs/2026-06-25-trueedit-subproject-a-design.md`) APPROVED → proceed to implementation plan. Build order A2→A3a→A1→A3b→A6.

## Program structure (locked)
- Sub-project A — True-edit: A1 TE-1 · A2 TE-2 · A3 TE-6(spike) · A4 TE-7 · A5 TE-4 · A6 polish(TE-3/5/8)
- Sub-project B — PDF→DOCX: B1 DX-1 · B2 DX-2 · B3 DX-6 · B4 DX-3 · B5 DX-5 · B6 DX-4 · B7 DX-8
- Sub-project C — DOCX editor: C1 DXE-1 · C2 DXE-2 · C3 DXE-3
- Order: spikes → B → A → C

## Hard walls (out of scope)
In-place Arabic/RTL, Type3, vector→OOXML, exact subset face, borderless tables, multi-line reflow,
text-clip modes 4–6, TSA/CA (network).

## Formal Plan
<!-- per-sub-project plans written by writing-plans at each sub-project's Phase 4 -->
- [x] Spike-1 TE-6 XObject true-edit — POSITIVE (engine write-back exists; Path-1/2 complete; handler gate is the only block). TE-6 SPLITS: TE-6a (Path-1/2, low risk, early) + TE-6b (Path-3, rides A1).
- [x] Spike-2 TE-1 Path-3 transform capture — POSITIVE (`trm` computed at `:531`, discarded in `buildPath3Redraw :2103`). Must decompose rotation+scale vs the vScale-baked fontSize. A1 sequences before TE-6b.
- AUDIT 2026-06-25: B2 (lattice tables) + B4 (heading bold/caps promotion) are ALREADY SHIPPED (verified in code: detectLatticeTables/FlowTable/mkTable + assignHeadings G11) → removed from scope. Scorecards were stale.
- [x] Sub-project B spec → `docs/superpowers/specs/2026-06-25-docx-export-subproject-b-design.md` (5 open items: B7 ligature, B3 outline→TOC, B6 3-col recursion, B5 headers/footers, B1 struct-tree exact-replace). Build order B7→B3→B6→B5→B1; B1 behind a marked-content correlation sub-spike.
- [ ] Sub-project B build (per the spec, item-by-item, each own commit + full gate + byte-identical-when-inactive guard)
  - [x] B7 Latin ligature fold — `foldLatinLigatures` (flowDoc.ts) + wired at reconstructPage word-build; tests/utils/flowDocLigature.test.ts (5, incl. wire guard + byte-identical control); type-check/lint/208-flowDoc-regression green. STAGED, not committed.
  - [x] B3 outline→Word TOC field — `flattenOutline` + `FlowDoc.outline` (flowDoc.ts) + TOC field in flowDocWriters.ts (gated outline+heading) + getOutline fetch in exportService._extractFlowDoc; tests/utils/flowDocOutline.test.ts (6, incl. 2 no-TOC controls); type-check/lint/215-regression green. STAGED.
  - [x] B6 3-col recursive XY-cut — `splitColumns` (recursive, depth-2) + `detectColumnSplit` optional `bounds` arg (default→byte-identical); wired in reconstructPage. tests/utils/flowDocColumns.test.ts (5, incl. 1/2-col byte-identical). 220-regression green. STAGED.
  - [x] B5 headers/footers — `detectRepeatedBands` + `applyRepeatedBands` (conservative ≥3pg/≥60%/tight-band/digit-norm; removes hoisted inline dup) + `FlowDoc.header/footer` + Header/Footer per section in writer; wired in exportService. tests/utils/flowDocHeaderFooter.test.ts (8, incl. no-false-positive + no-op control + writer part). 227-regression green. STAGED.
  - [x] B1 SUB-SPIKE done (Node, legacy pdfjs, w3c-accessible-table.pdf): roles Root/Sect/H1/P/Table/TR/TH/TD; **100% correlation** — all 38 struct content-leaf ids match `getTextContent({includeMarkedContent:true})` marker ids (`beginMarkedContentProps {id,tag}`). → **exact-replace VIABLE, no HINTS fallback needed.**
  - [x] B1 BUILD DONE: `buildMarkedContentMap` (innermost-MCID attribution, no-MCID artifacts dropped) + `structTreeToFlow` (walks H1-6→heading / P/Note/Caption/Quote→body / L+LI→list w/ depth+ordered-marker detect / Table+TR+TH/TD→FlowTable; Figure skipped; returns null→heuristic fallback when zero text resolved) + `buildRunsFromLines` extracted from buildParagraph (reused, byte-identical) + `FlowPage.tagged` + assignHeadings skips tagged pages (all 3 loops) + reconstructPage `struct?` param (exact-replace, margins still from words) + exportService fetches getStructTree()/includeMarkedContent and passes `struct` (untagged → plain getTextContent, byte-identical). tests/utils/flowDocStructTree.test.ts (10) + tests/browser/docx-structtree.browser.test.ts (2: real tagged PDF heading+table; untagged byte-identical). FULL deploy gate GREEN (audit 0 / tc / lint / jsdom 2168+2 / browser 157 / coverage:export 44% / build). **Sub-project B COMPLETE (5/5).** Ceiling: partially-tagged page drops untagged-as-artifact text (exact-replace contract); alignment/indent not tag-derived; multi-column tagged page reading-order rides y-sort.
- [x] Sub-project A spec → plan → build — COMPLETE 2026-06-25. Spec `docs/superpowers/specs/2026-06-25-trueedit-subproject-a-design.md`, plan `docs/superpowers/plans/2026-06-25-trueedit-subproject-a.md`. Built A2 (alpha `14f5a55`) → A3a (XObject Path-1/2 `a5bc8f3`) → A1 (full-affine transform `6586c23`) → A3b (XObject Path-3 `5d0cb2e`) → A6 (dash/cap/join + size-change deco width + rotated-input guard `3b9a553`); A2-fixup `7ba455a`. AUDIT dropped A4 (matchStandardFont already wired) + A5 (hasNonWinAnsi already refuses) as ALREADY SHIPPED. Each item own commit + full gate (final: jsdom 2186+2, browser 161). All gated/additive → byte-identical at defaults. KEY traps handled: A3a XObject-aware font introspection (else Path-1 corrupts XObject CID fonts); A1 base-Tf-size to avoid double-scaling; A3b XObject-local coords (no fallback needed).
- [ ] Sub-project C spec → plan → build
