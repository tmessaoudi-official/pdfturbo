# DOCX read+edit — Phase 0 Spike Verdict (2026-06-20)

**Verdict: GO.** The open→edit→save round-trip is proven end-to-end, fully client-side,
on an entirely permissive stack with **zero new dependencies**. (The first attempt — a
background worktree agent — produced no artifact; this spike was re-run inline.)

## What was proven
`src/docx/docxSpike.ts` + `tests/docx/docxRoundtrip.spike.test.ts` (vitest jsdom, **4/4 pass**,
type-check clean):
- **DOMParser is available in jsdom** (and natively in the browser) → client-side XML parsing, no dep.
- **build → parse** recovers paragraph text verbatim, including accented French (`Troisième ligne — éàç`).
- **open → EDIT one paragraph → save → re-open** preserves the edit AND the untouched paragraphs.
- Output is a structurally valid OPC zip (unzips, exposes `word/document.xml`).

Read path: `fflate.unzipSync` → `DOMParser` over `word/document.xml` (`w:p` → `w:t`).
Write path: `docx` `Document`/`Paragraph`/`TextRun` → `Packer.toBuffer`.

## Permissive dependency set (all MIT/BSD — copyleft-free, commercial-safe)
| Lib | Role | License | Status |
|---|---|---|---|
| `fflate` | unzip/zip the .docx OPC | **MIT** | already a dep |
| `docx` | serialize model → .docx | **MIT** | already a dep (`^9.7.1`) |
| platform `DOMParser` | parse document.xml | n/a (built-in) | no dep |
| `prosemirror-model` (+ view/state) | editor core (Phase 1+) | **MIT** | to add |
| `mammoth` (optional richer read) | .docx → HTML | **BSD-2-Clause** | optional |
FORBIDDEN (confirmed avoided): SuperDoc/OnlyOffice (AGPL), CKEditor5 (GPL/paid), TipTap Pro (paid).

## Top fidelity risk (the real Phase 1 design constraint)
The `docx` writer **REBUILDS the whole document from the model** — any OOXML the model doesn't
represent (styles, numbering, tables, headers/footers, comments, fields, drawing) is **DROPPED** on
save. A naive parse→model→`docx`-rebuild is lossy for anything beyond plain paragraphs. The plan's
mitigation is mandatory and confirmed necessary: **verbatim pass-through of untouched parts** — edit
`word/document.xml` (and friends) in place within the unzipped OPC and re-zip, rather than
regenerating the package. For the editor surface, ProseMirror models only what we choose to expose;
everything else must survive as opaque XML. The honest fallback `toast.docxRoundTripLossy` stays.

## Recommended Phase 1 approach (unchanged from plan, now evidence-backed)
1. Read: unzip (fflate) + parse document.xml (DOMParser) into a ProseMirror doc for the editable
   subset; **retain the original OPC bytes** for pass-through.
2. Edit: ProseMirror (MIT).
3. Save: write edited nodes back into the **original** document.xml DOM (not a `docx`-rebuild) and
   re-zip with fflate — preserving unmodeled parts. Use the `docx` writer only for net-new documents.
4. DOCX→PDF reuses the existing FlowDoc/export path.

Ceiling (documented): browser reflow ≠ Word layout (exact only at PDF export); deep OOXML features
land incrementally; never normalize the whole document.
