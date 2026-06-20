# DOCX read+edit Plan

> Client-side (no backend) round-trip Microsoft Word `.docx` editor for PDFturbo:
> open a `.docx`, render it high-fidelity (read-only first), then edit it as rich
> text, and save back to `.docx`. Built on a permissively-licensed rich-text
> editor core + our own OOXML↔model mapping, reusing the existing `flowDocWriters`
> DOCX writer as the "write" half. License constraint is **overriding**: MIT/BSD
> only — NO GPL, NO AGPL (PDFturbo may go proprietary/commercial).

## Decisions Log

- [2026-06-20] AGREED: Architecture = permissively-licensed (MIT/BSD) rich-text
  **editor core** (ProseMirror, MIT) for caret/selection/undo/tables + **our own**
  OOXML(.docx)↔model mapping (parse in, `docx` lib out). Ship a **read-only**
  high-fidelity render FIRST, then layer editing on top.
- [2026-06-20] AGREED: License is the overriding constraint — the entire stack must
  be **MIT/BSD/Apache-2.0 permissive only**. NO GPL, NO AGPL. SuperDoc (AGPL-3.0),
  OnlyOffice (AGPL-3.0), and CKEditor 5 (GPL-2+ open core / paid commercial) are
  **FORBIDDEN**. PDFturbo may ship proprietary/commercial; copyleft would force
  open-sourcing or a paid license.
- [2026-06-20] AGREED: Chosen editor core = **ProseMirror** (not Lexical) — its
  explicit, schema-validated document model maps to OOXML block/inline structure
  (tables, nested lists, marks, node attrs) more directly than Lexical's node graph,
  and `prosemirror-tables` is a first-party, battle-tested table implementation.
  This is the same core SuperDoc/TipTap build on — proven for DOCX editing.
- [2026-06-20] AGREED: Reuse the existing `src/utils/flowDocWriters.ts` `docx`
  (MIT) writer as the **write** half rather than introducing a new DOCX serializer;
  extend its FlowDoc-derived model as needed. Gate the whole feature behind a new
  `#28`-seam flag `VITE_FEATURE_DOCX_EDIT` (`FeatureKey: 'docxEdit'`), default ON,
  one env var away from disabled.

## Formal Plan

### 1. License verification (Rule 11 — all verified 2026-06-20 via WebSearch/WebFetch)

| Library | Role | License | Verdict | Source / note |
|---|---|---|---|---|
| **ProseMirror** | Editor core (model/view/state/transform/tables) | **MIT** | ✅ KEEP (chosen) | [Verified: web search; prosemirror-* packages MIT on npm] |
| **Lexical** (Meta) | Editor core alternative | **MIT** | ✅ keep-eligible (not chosen) | [Verified: facebook/lexical README "licensed under the MIT license"] |
| **Slate.js** | Editor core alternative | **MIT** | ✅ keep-eligible | [Verified: web search] |
| **Quill** | Editor (Delta model) | **BSD-3-Clause** | ✅ permissive (not chosen — Delta model is a poor OOXML fit) | [Verified: web search] |
| **TipTap core** | ProseMirror wrapper | **MIT** | ✅ optional sugar over ProseMirror | [Verified: ueberdosis/tiptap MIT; 10 ex-Pro extensions open-sourced MIT] |
| **TipTap Pro / Platform** | Comments, AI, conversion, collab cloud | **Proprietary / paid subscription** ($149/mo+) | ⚠️ AVOID (paid; not needed — we own the OOXML mapping) | [Verified: tiptap.dev pricing/pro-license] |
| **mammoth** | DOCX→HTML converter (read aid) | **BSD-2-Clause** | ✅ permissive — usable as a parse *reference*, not the editor model | [Verified: web search; deps.dev] |
| **docx** (`docx` npm) | DOCX **writer** (already a dep) | **MIT** | ✅ KEEP — the write half | [Verified: package.json dep + flowDocWriters header] |
| **docx-preview** (docxjs) | DOCX→HTML/CSS renderer | **Apache-2.0** | ✅ permissive — optional read-only render bootstrap | [Verified: WebFetch github.com/VolodymyrBaydalka/docxjs] |
| **docxtemplater** (core) | Template-fill (not an editor) | **MIT or GPLv3 (dual)** core; paid modules | ⚠️ MIT branch OK but wrong tool (templating, not editing) — AVOID for this feature | [Verified: open-xml-templating LICENSE.md dual MIT/GPLv3; PRO modules paid] |
| **SuperDoc** (Harbour) | Full DOCX editor | **AGPL-3.0** (or paid commercial) | ❌ FORBIDDEN (copyleft) | [Verified: web search — "dual licensed under AGPLv3 … commercial license for proprietary"] |
| **OnlyOffice Document Editor** | Full office suite | **AGPL-3.0** (or paid) | ❌ FORBIDDEN (copyleft) | [Verified: web search — AGPL-3.0-only + proprietary] |
| **CKEditor 5** | Rich editor | **GPL-2+** open core / paid commercial | ❌ FORBIDDEN (copyleft/paid) | [Verified: ckeditor.com licensing — GPL 2+ or commercial] |

**Net keep-set (all permissive):** ProseMirror (+optional TipTap core MIT, +optional
`prosemirror-tables`/`prosemirror-*` modules, all MIT), `docx` (MIT, writer),
optionally `docx-preview` (Apache-2.0) for an early read-only render, optionally
`mammoth` (BSD-2) and `fflate` (MIT, already a dep) for OOXML unzip/parse. **Avoid
anything copyleft (AGPL/GPL) or paid.** Note: SuperDoc itself is built on
ProseMirror/TipTap — independent confirmation that ProseMirror is a proven DOCX-edit
foundation; we adopt the *foundation*, not the AGPL product.

### 2. Editor core recommendation — ProseMirror (chosen)

**Decision: ProseMirror.** [Inferred — grounded in the OOXML structural mapping below + bundle/PWA fit]

| Criterion | ProseMirror | Lexical |
|---|---|---|
| Document model | Explicit, **schema-validated** node/mark tree; node `attrs` carry arbitrary OOXML props (style id, numbering id+level, run props) | Node graph with `exportJSON`/`importJSON`; less rigid, marks are node-internal |
| Tables | `prosemirror-tables` — first-party, mature, handles colspan/rowspan/resize | `@lexical/table` exists but historically less complete for nested/merged cells |
| Lists / numbering | Model lists as nodes with `attrs` (numId, ilvl) → direct OOXML `w:numPr` mapping; we already emit `w:numPr` in `flowDocWriters` | List plugin is solid but numbering-restart/format mapping is more bespoke |
| Marks / run props | First-class `marks` with attrs (bold/italic/color/font/size/underline/strike/super-sub) → 1:1 with OOXML `w:rPr` | Marks live as format bitflags + node styles; richer-than-bool run props need custom nodes |
| Transforms / round-trip | `Transform`/`Step` give precise, position-stable mutations — ideal for preserving unknown OOXML on edited nodes | History via editor state; equally capable but the explicit-schema discipline helps OOXML fidelity audits |
| Bundle size / PWA fit | Modular (`prosemirror-model/-state/-view/-transform/-commands/-keymap/-history/-tables`), tree-shakeable, **no React dependency** (PDFturbo is vanilla TS + Vite) | Core is small but the ergonomic path is React-flavored; adds friction in a vanilla-TS app |
| RTL/bidi reuse | DOM-based view → reuse our existing Arabic/RTL plumbing (`reverseRtlText`, complex-script run props) | Same DOM reuse possible |

**Why not Lexical:** Lexical's strengths (React ergonomics, collaborative perf at
Meta scale) don't pay off here — PDFturbo is vanilla TS, and our hard problem is
**lossless OOXML structure**, where ProseMirror's explicit schema + `attrs` give a
cleaner, auditable mapping and a mature tables module. Both are MIT, so license is a
tie; structural fidelity + framework fit decide it. **Pick: ProseMirror.**

### 3. Full Word-like editor feature set — tiered

Legend: **MVP** = first shippable read+light-edit; **Core** = a genuinely useful Word
substitute; **Parity** = approaching desktop Word (largely ceiling territory).

**Document model & I/O**
- MVP: parse `.docx` zip (fflate) → `document.xml` body; ProseMirror schema for
  paragraphs + runs; preserve unknown nodes as opaque "pass-through" attrs.
- Core: styles.xml (paragraph/character/table styles), numbering.xml, theme fonts,
  relationships (`rels`), `[Content_Types].xml`, settings.xml.
- Parity: **lossless round-trip of unknown OOXML** (sectPr, custom XML parts,
  content controls/SDT, `w:bookmark`, revision ids) — keep verbatim XML for
  untouched parts; only re-serialize edited subtrees. (Genuine ceiling — see §4.)

**Layout / reflow / pagination**
- MVP: continuous reflow (browser layout), single column, no page breaks shown.
- Core: page width/margins from `sectPr`, manual page breaks, basic widow/orphan-free
  continuous view; print/PDF export paginates.
- Parity: Word's exact line-breaking, hyphenation, keep-with-next, balanced columns,
  exact pagination — **ceiling** (browser reflow ≠ Word's layout engine).

**Caret / selection / input**
- MVP: caret, click+drag selection, keyboard nav (ProseMirror gives this).
- Core: word/line/paragraph select, shift+arrow extend, double/triple-click, **IME**
  composition (CJK/diacritics), **RTL/bidi caret** (reuse Arabic work).
- Parity: column/block (Alt+drag) selection, vertical caret movement honoring layout.

**Inline (run) formatting**
- MVP: bold, italic, underline, strikethrough, font family, font size, text color.
- Core: highlight, super/subscript, small caps, all-caps, char spacing, kerning,
  text-highlight color, clear-formatting, format painter.
- Parity: every `w:rPr` (emboss/shadow/outline, east-asian props, complex-script
  pairing, `w:vanish`), exact theme-color resolution.

**Paragraph formatting**
- MVP: alignment (L/C/R/justify), basic indent.
- Core: line spacing, space-before/after, first-line/hanging indent, borders/shading,
  tabs, RTL paragraph direction, paragraph styles (apply named style).
- Parity: keep-lines/keep-with-next, full tab-stop editor, contextual spacing.

**Lists (nested / numbered / bulleted)**
- MVP: flat bullet + flat ordered (decimal) — reuse `flowDocWriters` numbering.
- Core: nested levels, ordered formats (decimal/alpha/roman, already in writer),
  restart/continue numbering, bullet glyph choice, list↔paragraph conversion.
- Parity: full `numbering.xml` multilevel definitions, legal numbering, custom
  level text patterns, linked list styles.

**Tables**
- MVP: render existing tables read-only (grid); basic cell text edit.
- Core: insert/delete row/col, merge/split cells (`prosemirror-tables`), cell
  borders/shading, column widths, table alignment.
- Parity: nested tables, `w:tblPr` style inheritance, header-row repeat, cell margins,
  text direction per cell, autofit.

**Images (inline / floating)**
- MVP: render inline images (extract from `word/media/` via the rels map).
- Core: insert/replace/resize/delete inline images; alt text.
- Parity: floating/anchored images with wrap modes, crop, rotation (we already emit
  floating anchors + rotation in the DOCX writer), drawing canvas/shapes — **shapes
  are a ceiling**.

**Headers / footers / page setup / sections**
- Core: read+edit `header*/footer*.xml`, page size/margins/orientation from `sectPr`,
  page numbers (reuse Bates engine concepts).
- Parity: multiple sections, different first-page/odd-even headers, columns, line
  numbers, section breaks of all kinds.

**Find / replace, clipboard**
- Core: find, find+replace (plain), highlight matches (reuse search infra patterns);
  copy/paste **with formatting** within the editor (ProseMirror clipboard);
  paste-from-Word (HTML→schema), paste-as-plain.
- Parity: regex find/replace, find by format/style.

**RTL / bidi / multi-language**
- MVP/Core: reuse the shipped Arabic RTL stack (`reverseRtlText`, complex-script run
  props, `alignSpanOrderToVisual`, NFKC presentation-form folding). Cyrillic/CJK are
  LTR — preserved verbatim (already proven in DOCX export).
- Parity: mixed LTR+RTL single-line bidi reorder on edit, tashkeel GPOS — **ceiling**.

**Undo / redo**
- MVP: `prosemirror-history` (out of the box). (Note: PDFturbo's own historyManager
  is for the PDF editor; the DOCX editor uses ProseMirror history internally and
  exposes a thin command bridge.)

**Styles**
- Core: apply named paragraph/character styles; style dropdown; basic style editing.
- Parity: full style inheritance chain (`basedOn`/`next`/`link`), latent styles,
  document defaults, theme.

**Track changes / comments / footnotes / fields / TOC / equations**
- Parity-only (each is a large feature):
  - Track changes (`w:ins`/`w:del`/`w:rPrChange`) — **hard ceiling** to do faithfully.
  - Comments (`comments.xml` + `commentRangeStart/End`) — reachable but large.
  - Footnotes/endnotes (`footnotes.xml`) — reachable, niche.
  - Fields (`w:fldSimple`/`w:instrText`), **TOC** — render cached result; live field
    recalculation is a **ceiling**.
  - Equations (OMML `m:oMath`) — render/round-trip only; editing is a **ceiling**.

**Export**
- MVP: save back to `.docx` (via `docx` writer / extended FlowDoc model).
- Core: **export to PDF** — reuse PDFturbo's existing render+export pipeline (this is
  the strategic synergy: DOCX in → edit → PDF out, fully client-side).
- Parity: export HTML/MD (reuse `flowDocToMarkdown`), print.

### 4. Hard parts & fidelity ceilings (honest)

**Genuinely reachable client-side:**
- High-fidelity read-only render of common business docs (paragraphs, runs, styles,
  lists, tables, inline+floating images, headers/footers).
- Editing the above with stable undo/redo, selection, IME, RTL.
- Round-trip where edited subtrees re-serialize and **untouched parts are preserved
  verbatim** (the key technique to avoid round-trip loss).
- DOCX→PDF export (we already own the renderer/exporter).

**Ceilings (structural — do not promise parity):**
1. **A ProseMirror/HTML-ish model cannot represent 100% of OOXML.** OOXML has
   constructs with no DOM analogue (SDT/content controls, complex field codes,
   VML/DrawingML shapes, OMML math, custom XML parts). Mitigation: opaque
   pass-through nodes + verbatim-XML preservation for untouched parts; **never**
   normalize the whole document through the model.
2. **Browser reflow ≠ Word's layout engine.** Line-breaking, hyphenation,
   justification spacing, exact pagination, widow/orphan, keep-with-next, column
   balancing differ. We render a *faithful editable approximation*, not a
   pixel-identical Word page. Pagination is best-effort and exact only at PDF export.
3. **Round-trip loss is inevitable on edited regions.** Any node the user edits gets
   re-serialized from our model; props we don't model on that node are dropped *for
   that node*. Mitigation: model the long tail of `rPr`/`pPr` props as pass-through
   `attrs` so edits preserve them; scope re-serialization as tightly as possible.
4. **Track changes faithfully** (insertions/deletions with author/date, accept/reject,
   `w:rPrChange`) is a major sub-project and a practical ceiling for v1.
5. **Fonts:** we can't embed/substitute every Word font; rendering uses
   web/system fonts (same ceiling as the DOCX export `WORD_FONT_ALLOWLIST`). CJK
   east-asian font-face is a documented ceiling.
6. **Equations (OMML), shapes/SmartArt/charts, live fields/TOC recalculation,
   macros** — render/preserve at best; full editing is out of scope.
7. **Encrypted/password-protected .docx** — out of scope (no decrypt).

### 5. Module structure, flag, i18n, tests

```
src/docx/
├── parse/
│   ├── unzip.ts              # fflate (MIT, existing dep) → part map
│   ├── opc.ts                # OPC: [Content_Types].xml + _rels relationship graph
│   ├── stylesParser.ts       # styles.xml → style table
│   ├── numberingParser.ts    # numbering.xml → list defs
│   └── bodyParser.ts         # document.xml body → DocxModel (block/inline tree)
├── model/
│   ├── docxModel.ts          # normalized model (block nodes, runs, run/para props)
│   └── passthrough.ts        # opaque verbatim-XML nodes for unmodeled parts
├── mapping/
│   ├── toProseMirror.ts      # DocxModel → ProseMirror doc (schema-validated)
│   ├── fromProseMirror.ts    # ProseMirror doc → DocxModel (edited subtrees only)
│   └── toFlowDoc.ts          # DocxModel → FlowDoc (bridge to the existing writer)
├── editor/
│   ├── schema.ts             # ProseMirror schema: nodes (doc/para/table/list/image),
│   │                         #   marks (bold/italic/underline/strike/color/font/size/
│   │                         #   super-sub), attrs carry styleId/numId/ilvl/rPr tail
│   ├── plugins.ts            # history, keymap, tables, input rules, RTL
│   ├── commands.ts           # formatting commands (bold/list/align/table ops)
│   └── docxEditor.ts         # EditorView lifecycle, mount/destroy, toolbar wiring
├── render/
│   └── readonlyRender.ts     # Phase-1 read-only render (optionally bootstrap via
│                             #   docx-preview Apache-2.0, then replace with PM view)
├── write/
│   └── docxWriter.ts         # reuse flowDocWriters.flowDocToDocxBlob via toFlowDoc;
│                             #   extend FlowDoc/docx writer where the model is richer
└── index.ts                  # public surface: openDocx(file) / editor / saveDocx()
```

**Repo conventions:** `_underscore` private methods; `set -eEuo`-equivalent strict TS;
oxlint clean; jsdom unit + real-Chrome browser tests; base path `/pdfturbo/`; PWA
(heavy editor chunks **dynamically imported** like `docx`/tesseract, so the initial
bundle is unaffected). Reuse the existing toast/i18n/focus-trap/keyboard-binder seams.

**Feature flag (#28 seam):** add `'docxEdit'` to the `FeatureKey` union in
`src/config/features.ts`, with `case 'docxEdit': return import.meta.env.VITE_FEATURE_DOCX_EDIT;`.
Default ON; `VITE_FEATURE_DOCX_EDIT=false` disables; `main.ts` removes the entry
button/modal when off (mirrors crop/compress/signers). Env-undefined → ON (every flag's
contract).

**i18n keys (add to all 3 locales — must stay key-identical; hook enforces):**
- `toolbar.docxOpen`, `toolbar.docxSave`, `toolbar.ariaDocxEditor`
- `docx.modeRender`, `docx.modeEdit`
- `docx.bold/italic/underline/strike/align*/list*/insertTable/insertImage/findReplace`
- `toast.docxOpened`, `toast.docxSaved`, `toast.docxUnsupportedFeature`,
  `toast.docxParseFailed`, `toast.docxRoundTripLossy` (honest "some unsupported
  formatting may not be preserved" notice — mirrors `toast.trueEditOverlay`)
- `docx.error.encrypted`, `docx.error.corrupt`
- Arabic values flagged **[Unverified]** pending native review (per project convention).

**Test strategy:**
- **jsdom unit (`tests/docx/`):** OPC/parse fixtures → model assertions; `toProseMirror`
  ↔ `fromProseMirror` **round-trip** invariants (parse→map→edit-noop→write yields a
  structurally-equal doc); `toFlowDoc` bridge; numbering/style mapping;
  pass-through preservation (unmodeled XML survives a no-op round-trip). Unzip DOCX
  output with `fflate` and assert `document.xml`/`numbering.xml` shape (same technique
  the existing DOCX tests use).
- **real-Chrome browser (`tests/browser/docx-edit.browser.test.ts`):** mount the
  ProseMirror view, type/format/insert-table/insert-image, IME + RTL caret, copy-paste
  with formatting, save→reopen fidelity, DOCX→PDF export — jsdom can't lay out the
  editor view (same reason OCR/true-edit have browser tests).
- **TDD:** write the failing parse/round-trip test before each parser/mapper.
  CI runs both suites (deploy.yml) — no extra wiring needed.
- **Fixtures:** small `.docx` files covering each tier (plain, styled, lists, table,
  image, RTL Arabic, headers/footers) under `tests/docx/fixtures/`.

### 6. Phased delivery plan

> Effort estimates are in "sessions" (a focused work block), rough. [Speculative — sizing for a single dev]

**Phase 0 — Spike (1–2 sessions).** Prove the riskiest unknowns before committing:
parse a real `.docx` with fflate, map a paragraph+run subtree into a minimal
ProseMirror schema, render it, edit one word, serialize back via the existing `docx`
writer, reopen in Word. Verdict doc in `docs/reviews/`. Decide: build vs. bootstrap
read-only render with `docx-preview` first. **Milestone:** one round-tripped paragraph,
written verdict, go/no-go.

**Phase 1 — MVP read+light-edit (3–5 sessions).** Read-only high-fidelity render of
common docs (paragraphs, runs, basic styles, flat lists, simple tables read-only,
inline images); ProseMirror schema + view; inline formatting (bold/italic/underline/
strike/font/size/color), alignment, flat lists editable; save back to `.docx` via the
reused writer; DOCX→PDF export reusing PDFturbo's pipeline; flag + i18n + tests; honest
lossy-round-trip toast. **Milestone:** open→edit text+inline format→save reopens in
Word with edits intact; DOCX→PDF works.

**Phase 2 — Core editor (6–10 sessions).** styles.xml/numbering.xml; nested+ordered
lists with restart; table editing (insert/delete/merge via `prosemirror-tables`);
paragraph spacing/indent/borders; image insert/resize/delete; find+replace;
copy-paste with formatting incl. paste-from-Word; headers/footers + page setup; RTL
paragraph editing reusing the Arabic stack; pass-through preservation of unmodeled
parts. **Milestone:** a genuinely useful Word substitute for everyday business docs;
round-trip preserves untouched parts verbatim.

**Phase 3 — Parity push (open-ended, prioritize by demand).** Comments; footnotes;
multiple sections/columns; floating images with wrap; full style inheritance; field/TOC
render+preserve; OMML/equation render+preserve. **Track changes, live fields, shapes,
exact pagination remain documented ceilings** — schedule only with explicit scope.
**Milestone(s):** per-feature, each behind sub-gates if risky.

### Top risks / ceilings (carry into every phase)
1. **OOXML ⊄ editor model** → mandatory verbatim pass-through of untouched parts;
   never round-trip the whole document through ProseMirror.
2. **Browser reflow ≠ Word layout** → faithful editable approximation only; exact
   layout only at PDF export.
3. **Edited-region round-trip loss** → model the `rPr`/`pPr` long tail as pass-through
   `attrs`; surface the honest `toast.docxRoundTripLossy` notice.

---

> **Status:** Phase 0 spike = GO (`d1cc455`, verdict `docs/reviews/2026-06-20-docx-phase0-spike-verdict.md`).
> Phase 1 #1a DONE (`2b4a682`): in-place OPC edit with verbatim pass-through (`src/docx/opcEdit.ts`,
> proven to preserve an untouched table while editing a paragraph; zero new deps). **Next: Phase 1 #1b**
> — add ProseMirror (MIT) deps + map the document model ↔ ProseMirror doc + mount an editable view,
> wiring saves through `opcEdit` (in-place, never docx-rebuild). #1b needs the ProseMirror dep addition.
>
> ## Phase 1 increment log
> - #1a (DONE, `2b4a682`): `opcEdit.ts` open/get/set/pack + `replaceTextInXml` (in-place, pass-through). 3 tests.
> - #1b (NEXT): ProseMirror deps + model↔PM mapping + editable view (read-only render first), behind `VITE_FEATURE_DOCX_EDIT`.
> - #1c: DOCX→PDF via existing FlowDoc export; open-file wiring + UI entry point.
