---
paths:
  - "src/docx/**"
  - "tests/docx/**"
---

# pdfturbo gotchas — docx-edit

Moved verbatim from CLAUDE.md § Gotchas on 2026-09-28 (review-remediation 5.3, /rules-split). Scope: DOCX read + edit and its package garbage collection. These entries are this project's decision register (the design docs they came from were removed in `ac4ef68`). New entries for this area go HERE, not into CLAUDE.md. A § "…" reference names a heading in CLAUDE.md or in another `.claude/rules/` file — CLAUDE.md § Gotchas lists every moved heading; a § that names a bold paragraph (e.g. "MD/TXT parity") or paraphrases a heading resolves by grepping the phrase in `.claude/rules/`.

### Deleting a DOCX image left its bytes in the package — WS4-D, and the scan IS the fix (2026-09-04)

> **[Re-checked 2026-09-28]** the `tests/docx/opcGc.test.ts` case count below has grown (`6f08fc7`) — the file is the authority.

`reconcileImageAnchors` removed the image's anchor `w:p`, which strips its `r:embed` from
`document.xml` — but the relationship in `word/_rels/document.xml.rels` and the bytes in
`word/media/imageN.*` both stayed. The picture vanished in the editor AND in Word while remaining
recoverable by renaming the file to `.zip`. Disclosed since 2026-08-05 with "removing a package part
safely means proving nothing else references it"; `src/docx/opcGc.ts` is that proof.

**Every decision in the scan errs towards KEEPING, because the failure modes are wildly asymmetric:**
an orphan left behind is the bug we already disclosed, a live picture deleted destroys the user's
document. Four consequences, each pinned:

- **Walk every `_rels/*.rels`, not just the document's.** Headers, footers, footnotes, endnotes and
  comments reach their images through their own `.rels`, and those parts are passed through verbatim
  by the editor — so they are exactly the ones a naive scan never sees. Sabotage S1 (scan only
  `word/_rels/document.xml.rels`) fails exactly the header case.
- **A relationship is live if its Id equals ANY ATTRIBUTE VALUE in the owning part.** Matching
  `r:embed` by name would mean enumerating every attribute Word can hang an rId on (`r:id`, `r:link`,
  `r:pict`, `r:dm`, `r:lo`, `r:qs`, `v:imagedata/@r:id`, …) and one missed name deletes a live image.
  The over-approximation is the safe direction. **This paragraph and the module header both said
  "anywhere in the owning part's TEXT" until 2026-09-04**, which was true of the regex scan and never
  of the DOMParser one that replaced it — the doc kept describing the implementation it superseded.
- **Substring safety comes free from comparing VALUES, and the note that said otherwise described
  deleted code.** `rId7` is a substring of `rId70`, so the regex scan had to match the id *with its
  surrounding quotes*; exact equality against a parsed attribute value cannot make that mistake at
  all. The guard at `tests/docx/opcGc.test.ts` still earns its place — it pins the property, not the
  mechanism — but its comment described the quoting trick of an implementation that no longer exists.
- **`[Content_Types].xml` is part of the reachability model, not just the relationship graph.** A
  media extension with no `Default` is typed by an `<Override PartName="/word/media/…">`; deleting
  the part while that Override still names it leaves a dangling declaration strict readers reject.
  Such a part counts as live. The narrow cost is stated rather than hidden — an Override-typed media
  part that really IS orphaned is never collected. S6 fails exactly that case.
- **Only `word/media/**` is ever eligible.** An unreferenced `styles.xml` or `customXml` item is not
  this pass's garbage; deleting one would break the document for a refcount it has no business
  reasoning about. S3 (`MEDIA_PREFIX = ''`) fails **22 of 25** [measured 2026-09-04]. It read "9 of
  12" — the pre-DOMParser figure, contradicting this section's own re-measured "22 of 25" four
  paragraphs down. Worth the words because of how the correction went: a reviewer reported 21 of 25
  from an "equivalent" mutation, and running it here gave 22. **Two shapes of the same sabotage do
  not have to fail the same count**, so cite the mutation you ran, not the one someone described.

**`strFromU8` does NOT throw on non-UTF-8 — it substitutes replacement characters.** So a binary part
that happens to be named `.xml` decodes to garbage, the garbage contains no `"rIdN"`, and every
relationship it owns is judged dangling: live images deleted. The fail-safe test passed for the wrong
reason until `partText` learned to reject text that does not look like XML. **A `try/catch` around a
decoder that does not throw is not a guard.**

The GC runs LAST in the editor's `save()`, after every part that save will rewrite has been written,
because it decides reachability by reading those parts. It is a no-op on a package with no orphan, so
an open-and-save is byte-identical — pinned by a CONTROL case, without which an eagerly-deleting pass
would satisfy the delete case while destroying every picture in every document merely opened.

**Stated in `SECURITY.md` rather than hidden:** a picture orphaned by some OTHER program before you
opened the file is collected too. That is the same rule applied evenly, and it means a save can shrink
a file the user did not knowingly change.

Guards: `tests/docx/opcGc.test.ts` (25) + two cases in
`tests/browser/docx-image-edit.browser.test.ts` (the end-to-end removal, and the no-op control).
**Sabotage RE-MEASURED against the DOMParser implementation.** The earlier figures were taken on the
regex version that replaced it, and leaving them here as current was itself a WS7 finding — unproven
rather than false, which by this file's own standard is worse than saying nothing. Current: the
owner-side reference test disabled → 12 of 25; the `word/media/**`-only restriction dropped → 22 of
25; the call removed from `save()` → the end-to-end case only, control green. And the five legal-XML
shapes that defeated the regex scan are guards proven non-vacuous by running them against THAT
implementation — 5 of 22 fail, exactly the five the panel reported.

### DOCX read+edit (#1, Track B)

> **[Re-checked 2026-09-28]** this section is an append-only changelog — a later paragraph supersedes an earlier one. The earlier statements it overtook carry dated markers in place; the `docxToPdf.ts` line citation has drifted (cite `DocxToPdfOptions` by name).

A SEPARATE editor from the PDF pipeline (it edits a Word doc, not a
PDF) — `src/docx/*`, gated `VITE_FEATURE_DOCX_EDIT` (#28 seam). Entry: file-menu `fileMenuEditDocx` →
`createDocxEditorController` (lazy-imported on first click; `main.ts` removes the menu item when the flag
is off). The controller is **self-contained** — it creates its OWN hidden file input + modal overlay
(`.docx-editor-*` in `modals.css`), never touching `documentModel`/`uiController`, so opening a Word doc
can't disturb PDF editing. **Modal a11y (#QA-2026-06-23 P1):** the controller ships its OWN Esc-to-close,
backdrop-click-close (target===modal), and `trapFocus(panel, prevFocus)` (initial focus + Tab trap + focus
restoration) — it is NOT in the central `keyboardBinder` Esc chain (self-contained by design). **Silent
table-discard guard (#QA-2026-06-23 P1):** keyboard table/row deletion is possible (prosemirror-tables nodes
are editable, no transaction-filter) but the in-place reconcile keeps the ORIGINAL tables on a count
divergence — so the controller counts tables (`countTables`, recursive) at load vs save and warns
`docxEditor.tableStructureUnsupported` instead of the misleading "saved" toast (the save still succeeds with
the original tables; genuine block-on-delete is deferred). **Cardinal rule (2026-06-20 spike
verdict — recovery command in `src/docx/opcEdit.ts`):** edit `word/document.xml` IN PLACE in the
unzipped OPC and re-zip — NEVER rebuild via the `docx` writer (it drops every unmodeled part:
tables/styles/numbering/headers). `opcEdit.ts` = fflate(MIT) unzip + platform DOMParser edit + re-zip;
`docModel.ts` models TOP-LEVEL `w:body` paragraphs with per-run **bold/italic/underline/fontFamily/fontSize**
(`w:sz` is half-points → pt×2) and per-paragraph **heading (1–3, `w:pStyle`) + list (`w:numPr`, ordered=decimal
vs bullet)** (everything else — tables/styles/numbering/headers — passes through verbatim); `docxProseMirror.ts`
maps the FLAT model ↔ a NESTED ProseMirror(MIT) doc (headings + bullet/ordered lists via
**prosemirror-schema-list**, MIT) + `mountDocxEditor`.
**Save preserves per-run formatting** via `applyParagraphRuns(xml, paras, ids?)`: it clones the original
first run's `w:rPr` (so unmodeled color/spacing survive), strips the model-managed toggles (`MANAGED_RPR` =
b/i/u/rFonts/sz/szCs), re-adds b/i/u/font/size, and `sortRPrChildren` re-orders them into canonical CT_RPr
order (rFonts,b,i,u,sz,szCs — underline is AFTER sz per ECMA-376) — NOT the older text-level
`applyParagraphTexts` (which flattened a paragraph to one run). Paragraph props (heading `w:pStyle` + list
`w:numPr`, `w:pPr` inserted as first child) are written ONLY when the `ids` arg is passed → without it the
output is byte-identical to the #1c runs-only path.
**Rich-text toolbar (Phase 2 Slice A)**: `docxToolbar.ts` `buildDocxToolbar(view)` — B/I/U (toggleMark) +
heading select (setBlockType) + font/size selects (a custom `setMarkAttr` Command) + bullet/ordered buttons
(`inList ? liftListItem : wrapInList`); active-state reflects after every transaction via a hooked
`dispatchTransaction`. It rides on `DocxEditorHandle.toolbarDom` (built inside the lazy chunk, so the
controller mounts it above the editor with NO extra dynamic import). `docxSchema.ts` extends schema-basic
with the u/fontFamily/fontSize marks + `addListNodes(...)`. **opcParts.ts (inject-if-missing)**:
`ensureHeadingStyles`/`ensureListNumbering` REUSE existing Heading1–3 / bullet+decimal numbering defs when
present, else INJECT minimal spec-valid `<w:style>`/abstractNum+num (abstractNum BEFORE num; ids floored at
100) and `registerPart` adds the Override to `[Content_Types].xml` + a Relationship to `document.xml.rels`
(creating styles.xml / numbering.xml if absent); `buildNumberingMap` resolves numId→bullet|decimal on read.
`save()` resolves these ids ONLY when the edited model actually uses a heading/list. **Ceiling (Slice A):**
run formatting beyond b/i/u/font/size (color/highlight/strike), nested-list depth beyond `w:ilvl` round-trip,
a styles-gallery UI, and table-cell editing — all deferred to later slices. **Lazy split (verified in `vite build`):** the
controller chunk (~2.5 KB) loads on first menu click, the ProseMirror+model editor (~213 KB) on first
document open — neither is in the initial bundle. Deps all permissive: prosemirror-* + prosemirror-schema-list
(MIT), fflate (MIT), docx (MIT). **#1d DOCX→PDF export DONE:** `src/docx/docxToPdf.ts`
is a PURE flow→PDF renderer (the sibling of `flowDocWriters.ts`) — `docModelToPdfBytes(model, opts?)` lays
out the editable model with @cantoo/pdf-lib Helvetica StandardFonts (run-level tokenization → preserves
inter-run spaces AND mid-word font changes; greedy word-wrap; hard-break of over-wide tokens; pagination;
per-run bold/italic via the 4 Helvetica faces). `DocxEditorHandle.getModel()` returns the live model; the
editor modal's "Export PDF" button (`docModelToPdfBytes` **dynamically imported** to keep pdf-lib lazy)
downloads `<base>.pdf`. **WinAnsi-only:** StandardFonts encode CP1252, so `sanitizeWinAnsi` maps non-WinAnsi
codepoints (CJK/Arabic/emoji) → `?` and the controller warns (`docxEditor.pdfUnsupportedChars`); French/
German/Spanish accents are in CP1252 → intact. The `notify` seam was widened to `'warn'` (+ `main.ts` lambda).
**DOCX→PDF fidelity (Workstream A, 2026-06-21):** the renderer now also draws **heading sizes**
(`headingFontSize(level, base)` — H1/H2/H3 × 1.7/1.4/1.18, bold), **list markers** (`listMarkerText(ordered,
ordinal, level)` — bullet `•` vs decimal/lower-alpha/lower-roman cycling per 3 levels, `makeListState()` ordinal
counter, indent `INDENT_PER_LEVEL` per `list.level`), per-run **underline** (`page.drawLine` at baseline) and
per-run **color**. Color is a full vertical slice: `DocRun.color?` (`#rrggbb`) ↔ OPC `w:color@w:val`
(`docModel.ts` parse/`buildRun`, added to `MANAGED_RPR`) ↔ ProseMirror `color` mark (`docxSchema.ts`
`cssColorToHex` + `docxProseMirror.ts` map) ↔ a color picker in `docxToolbar.ts` ↔ `_hexColor` in the PDF render.
**DOCX→PDF fidelity (Feature 5, 2026-06-24) — fonts + merged cells + images NOW rendered:**
(a) **Real font faces** — `resolveStandardFontFamily(family)` maps `DocRun.fontFamily` → Times (serif) /
Courier (mono) / Helvetica (sans/unknown); all 12 non-symbol StandardFonts embedded up-front, `fontFor(family,
bold,italic)` picks the 4-way variant (was: everything Helvetica). (b) **Merged-cell tables** — pure
`buildCellGrid(t)` resolves the existing `DocCell.colspan`/`rowspan` (the 3c/3d shape, continuation cells
ABSENT) onto a grid (walks rows skipping rowspan-occupied columns); `tableLayout` computes equal column widths
+ per-row heights (rowspan cells top up their LAST spanned row), and the renderer draws colspan cells `N*colW`
wide and rowspan cells spanning the summed row heights (was: equal `max(cells)` columns → merged tables
misrendered). (c) **Images** — `src/docx/docxImages.ts` `extractDocImages(opc.files)` reads `word/media` via
`w:drawing`→`a:blip/@r:embed`→rels, sniffs PNG/JPEG, base64s + reads `wp:extent` EMU→pt; **kept DECOUPLED from
the editable model** (the in-place `buildRun` save rewrites runs as text `w:r` — routing image bytes through
the model would corrupt the `w:drawing`), exposed read-only via `DocxEditorHandle.getImages()` and passed to
`docModelToPdfBytes(model, { images })`, which embeds (`embedPng`/`embedJpg`) + interleaves each image after its
top-level `blockIndex`. **The save path + PM round-trip are UNTOUCHED → zero cardinal-rule regression.**
~~Default `images:[]` → byte-identical for image-less docs.~~ **That option NO LONGER EXISTS and this
sentence was a rotted byte-identity claim** — `DocxToPdfOptions` (`docxToPdf.ts:118`) has no `images`
field. It was removed by the "Export-PDF staleness FIXED" follow-up below, which made the export read
each `DocImageBlock.image` directly so an in-session resize or delete shows immediately; that entry
records the removal, and this earlier paragraph was simply never updated. [Found by the WS5 audit,
2026-09-04 — the guard the claim describes has been guarding nothing.] **Ceiling:** per-column `w:tblGrid` widths (equal columns
only), a rowspan cell straddling a page break, images nested in table cells / inline-with-text / non-PNG-JPEG,
per-run formatting beyond b/i/u/size/color/font-family, image positional drift after heavy editing (index-based),
non-WinAnsi scripts → `?` (true face embedding is the future path); Approach B (docx-preview raster) remains the
documented high-fidelity future alternative.
Guards: `tests/docx/docxImages.test.ts` + the `resolveStandardFontFamily`/`buildCellGrid` cases in
`docxToPdf.test.ts` + the image/colspan/serif cases in `tests/browser/docx-to-pdf.browser.test.ts`. Guards:
`tests/docx/{docxEditor,docxEditorController,docModelRichText,opcParts,docxSchema,docxMapping,docxToolbar,docxToPdf}.test.ts`
(jsdom), `tests/browser/docx-editor.browser.test.ts` + `tests/browser/docx-to-pdf.browser.test.ts`
+ `tests/browser/docx-toolbar.browser.test.ts` (real Chrome: toolbar drives bold+H1+bullet via genuine
commands → save → reopen → formatting survives AND an untouched table passes through; the cardinal in-place
rule), confirming selectable text, reading order, French fidelity.
**Paste-from-Word (Slice C #1)**: `src/docx/wordPaste.ts` `cleanWordHtml(html)` is a PURE MSO sanitiser
(platform `DOMParser`; strips `mso-*` style decls, `<o:p>`/`<xml>`/`<style>`/`<meta>`/office-namespaced tags,
BOTH conditional-comment forms — downlevel-hidden `<!--[if]…<![endif]-->` removed, downlevel-revealed
`<![if]…<![endif]>` UNWRAPPED so list bullets survive — empty `MsoNormal` spacers, `file://`/src-less images;
keeps `data:`/`http(s):` images) wired as the EditorView `transformPastedHTML` hook (`docxProseMirror.ts`); the
default DOMParser then parses through the EXISTING schema parseDOM (b/i/u/font/size/H1–6/lists/links) — NO new
schema, NO new dep, NO new flag (rides `VITE_FEATURE_DOCX_EDIT`). Ctrl+Shift+V arms a one-shot `_plainPasteArmed`
flag (keydown on `view.dom`) → `handlePaste` does `tr.insertText` (NOT `view.pasteText` — pasteText builds a
`ClipboardEvent` internally, which jsdom lacks; insertText is jsdom-safe and correctly "match destination style":
drops SOURCE formatting, inherits the cursor context). **Ceiling:** pasted tables fall back to ProseMirror default
(grid dropped, cell text → paragraphs — feature #3 upgrades this); colour/highlight/strikethrough dropped (no
schema mark); [superseded 2026-09-28 for colour: `docxSchema.ts` has a `color` mark since `e7e2096`] link URL survives in the editor but NOT the OPC save (`DocRun` carries no `linkUrl`). [superseded 2026-09-28: `DocRun.linkUrl` exists and the `link` mark maps to it] Guards:
`tests/docx/wordPaste.test.ts` (12 jsdom: MSO strip + format survival + totality), `tests/docx/docxPaste.test.ts`
(wiring + plain-text via fake event), `tests/browser/docx-paste.browser.test.ts` (real Chrome: `view.pasteHTML`
real pipeline → bold/underline/list through save→reopen; plain-text drops formatting).
**Find/replace (Slice C #2)**: a Word-style find & replace bar in the DOCX editor — plain + case +
whole-word + **regex** (with `$1` capture-group replacement). Three units + wiring, NO new dep, NO new flag
(rides `VITE_FEATURE_DOCX_EDIT`): (1) `src/docx/findReplace.ts` PURE core — `findMatches(doc,query,opts)`
searches **per textblock** over the flattened `textContent` (so a match spans runs/marks), mapping string
offsets → PM positions (`pos+1+offset`); regex compiles in try/catch → typed `{ok:false,error:'invalid-regex'}`
(never throws), zero-length matches guarded; `expandReplacement` does `$n` substitution. (2)
`src/docx/findReplacePlugin.ts` PM plugin — state `{active,query,replacement,opts,matches,activeIndex,error}`
recomputed on query/opts change OR `tr.docChanged` (activeIndex clamped); a `DecorationSet` paints `.fr-match`
+ active `.fr-match-active`; commands `open/close/setFindQuery/setReplacement/findNext/findPrev/replaceCurrent/
replaceAll`. **Replace inherits the marks at the MATCH START** (first char) — `replaceCurrent` deletes+inserts
with `doc.resolve(from+1).marks()`; **`replaceAll` applies matches RIGHT-TO-LEFT in ONE transaction** (one undo
step; earlier positions stay valid mid-apply, marks read from the original doc). (3) `src/docx/findReplaceBar.ts`
the UI (find/replace inputs, case/whole-word/regex toggles, ▲▼, "n of m" counter, Replace/Replace-all, ✕);
`Enter`/`Shift+Enter` = next/prev, `Esc` closes; invalid regex → red `.fr-error` field. (4) Wiring in
`docxProseMirror.ts`: `findReplacePlugin()` + a `Mod-f`/`Mod-h` keymap that opens the bar via a forward-declared
`barRef` (the keymap is built at state-create, before the view/bar exist); `DocxEditorHandle.findReplaceBar?`
mounted by `docxEditorController.ts` below the toolbar; a CENTRALISED `dispatchTransaction` supersedes the
toolbar's own hook to refresh BOTH toolbar + bar (setProps merges, so paste props survive). **Non-obvious:**
the bar's `run()` calls `update()` after each command so the counter refreshes even in unit tests with no
view-level hook; the central hook covers external doc edits. **Ceilings (v1):** matches do NOT cross paragraph
boundaries (regex `^`/`$` anchor per block); replace formatting = match-start marks only (mixed-format matches
collapse); table-cell text is not searched (tables aren't in the PM model until feature #3); [superseded 2026-09-28: lifted by the Slice C #3a paragraph below] PDF find/replace
is the separate follow-up ("DOCX first, PDF after"). i18n `findReplace.*` in en/fr/ar (ar reviewed 2026-07-30). Guards:
`tests/docx/findReplace.test.ts` (15 pure), `tests/docx/findReplacePlugin.test.ts` (11), `tests/docx/findReplaceBar.test.ts`
(7), `tests/browser/docx-find-replace.browser.test.ts` (real Chrome: Mod-f opens, decorations paint+cycle,
replace-all keeps bold through save→reopen, table passes through).
**C#2 hardening (2026-06-20):** (a) **match cap** — `findReplace.ts` exports `MAX_MATCHES=1000`; `findMatches`
stops the descend + bounds each `matchBlock(…, limit)` at the cap and returns `truncated?:true`, threaded through
the plugin state (`FindReplaceState.truncated`) so the bar counter shows `"n of 1000+"`. A broad query (`.`, `\s`,
a lone letter) over a large doc would otherwise build tens of thousands of decorations + a giant replace-all tx =
frozen tab; `replaceAll` now acts on the first batch (re-run for the rest). **Residual ceiling:** catastrophic
backtracking *inside one `re.exec()`* is uninterruptable in synchronous JS without a Worker/RE2 (both excluded by
the no-new-dep rule) — NOT defended, documented. (b) **`Mod-f` override is intentional and already focus-scoped** —
a `prosemirror-keymap` handler fires only on editor-focused keydown, so native browser Find works everywhere except
inside the open editor (the in-app-editor norm: Docs/VS Code/Notion). No new locale key (counter reuses
`findReplace.counter` with a string `total`). Guards: the 3 truncation cases above (core+plugin+bar).
**Table editing (Slice C #3a)**: `src/docx/*` extends the DOCX model to recursive `blocks: (DocParagraph | DocTable)[]` (replacing the flat `paragraphs` array, which is now a derived view for back-compat). `DocTable = { rows: DocRow[] }`, `DocRow = { cells: DocCell[] }`, `DocCell = { blocks: ... }` — nested tables are supported. The in-place save uses a table-anchored recursive reconciler `applyBlocks` in `docxMapping [2026-09-28: sic: `applyBlocks` lives in `docModel.ts` — no `docxMapping.ts` source file ever existed].ts` (partitions a container's `w:p`/`w:tbl` children into table-delimited paragraph segments; tables zip 1:1 by order and recurse into cells; cell paragraphs are rewritten in place via `applyParagraphRuns`; `w:tblPr`/`w:tblGrid`/`w:tcPr` structural/grid/styling elements are preserved verbatim — zero reconstruction). The **cardinal rule is maintained**: no docx-writer rebuild, only position-addressed in-place text edits. Schema integration via `prosemirror-tables@1.8.5` (MIT) — `tableEditing()` plugin + node specs merged into `docxSchema` (`docxSchema.ts`) supply cell selection/nav only (add row/col/merge/split NOT bound — structure read-only in 3a; 3b/3c/3d deferred). `docModelToDoc`/`docToDocModel` emit/read table nodes recursively; PDF export (`docxToPdf.ts`) reads the top-level `paragraphs` view only (table structure not rendered in v1) [superseded 2026-09-28: Feature 5 renders tables — `buildCellGrid` in `docxToPdf.ts`]. Find/replace now reaches cell text (the C#2 scope was lifted — `findMatches` descendants() recurses into cells; zero code change post-3a). Deps: prosemirror-tables (0 vulns; shipping MIT + attr). Gated by existing `VITE_FEATURE_DOCX_EDIT` (no new flag). Guards: `tests/docx/docModelTables.test.ts` (recursive model + populated paragraphs), `tests/docx/docxTablesMapping.test.ts` (in-place reconcile + nested round-trip), `tests/browser/docx-tables.browser.test.ts` (real Chrome: cell edit+format → save → reopen, nested table survives, structure byte-identical).
**Table editing — Slice 3b (add/del row & column, 2026-06-23)**: the 3a "structure read-only" limitation is LIFTED for SIMPLE (un-merged) tables. `docxToolbar.ts` wires four prosemirror-tables commands — `addRowAfter`/`deleteRow`/`addColumnAfter`/`deleteColumn` (data-act = the command name; `update()` toggles `button.disabled` from `isInTable(view.state)` so they're greyed outside a table). The real work is `writeTable` in `docModel.ts`: it now reconciles row & cell COUNTS in place (NOT just the 1:1-min overlap) — extra rows cloned from the last `w:tr` (inherits cell `tcPr`/column structure), extra cells per row cloned from the row's last `w:tc`, trailing rows/cells removed, and `w:tblGrid` kept in sync (`syncTableGrid`: clone last `w:gridCol` to widen, trim to shrink — **no-op when the count already matches**, so a non-structural cell-text edit stays byte-identical and the 3a verbatim-structure tests still pass). **Cardinal rule preserved** — still in-place OPC surgery, never a docx-writer rebuild. **REFUSE gate (the 3b ceiling):** `tableHasMerges(tbl)` [2026-09-28: removed since: `currentTableHasMerges` + the rebuild path, `db24f01`] (a direct cell carries `w:gridSpan` or `w:vMerge`) → fall back to the 3a text-only min-reconcile (structure verbatim) — restructuring a spanned grid is deferred to **3c/3d (merge/split)**, which still need `DocCell` colspan/rowspan + the gridSpan/vMerge round-trip. The controller's `tableStructureUnsupported` warning is unchanged and still correct: row/col edits keep the table COUNT equal → the `saved` toast fires AND the change now genuinely round-trips (the prior silent-discard for same-count structural edits is fixed). i18n `docxToolbar.{addRow,deleteRow,addColumn,deleteColumn}` (ar reviewed 2026-07-30). Mid-column-insert may shift a cell's `tcPr` (text content + column count stay correct) — documented ceiling. Guards: `docModelTables.test.ts` (add/del row+col, grid sync, merged-table refusal, byte-identical non-structural), `docxToolbar.test.ts` (the 4 acts dispatch), `docx-tables.browser.test.ts` (real Chrome: add-row via the toolbar button → save → reopen → 3 rows; buttons disabled outside a table). Verified live (synthetic table .docx, `qa-shots/f2-table-3b/`).
**Table editing — Slice 3c/3d (cell merge & split, 2026-06-23)**: `DocCell` gains OPTIONAL `colspan?`/`rowspan?`
(the **PM shape** — covered grid positions are ABSENT, matching prosemirror-tables AND `docToDocModel`; `toJSON`
not involved — docx model isn't persisted to IndexedDB). `parseTable` (docModel.ts) reads `w:gridSpan`→colspan and
resolves a `w:vMerge restart`+`continue` run→rowspan on the restart cell, **dropping the continuation placeholder
cells** (`colCursor` sums gridSpans so a `continue` matches the restart open at the same start column). The PM bridge
(`docxProseMirror.ts` `cellToNode`/`cellOf`) passes colspan/rowspan through the `table_cell` attrs. Toolbar adds
**Merge cells**/**Split cell** (`mergeCells`/`splitCell`; data-act = command name; `disabled` mirrors the command's
own applicability — probed via `cmd(view.state)` with no dispatch). `writeTable` now has THREE paths: simple table →
the 3b path (byte-identical for non-structural); **merged table, layout UNCHANGED** → `reconcileMergedContent`
(content-only, merge structure verbatim — cells line up 1:1 because parse drops continuations identically); **merged
table, layout CHANGED** (a merge/split, detected by `gridSignature` divergence) → `rebuildMergedTable`. The rebuild
walks the grid row-by-row: a model cell emits a `w:tc` with `w:gridSpan` (colspan) / `w:vMerge restart` (rowspan),
columns covered by a rowspan-from-above emit a fabricated `<w:vMerge/>` continuation placeholder (`makeMergeCell`);
grid width = `sumColspans(rows[0])`; `w:tblGrid` resized. **Cardinal rule preserved** — scoped in-DOM `w:tr`/`w:tc`
surgery (cell CONTENT carried over via `reconcileContainer`), NEVER a docx-writer rebuild. **Supersedes the 3b
merged-table REFUSE** at the SAVE layer (the rebuild handles merged-table row/col too, latent defense-in-depth) — but
the toolbar still DISABLES row/col on a merged table (`currentTableHasMerges`), so v1's merged-table UI op is
merge/split only. **Ceiling:** per-cell box `tcPr` (shading/width) is regenerated minimal on the rebuild path (a
merge/split resets cell-box styling — content preserved); a pure text edit on a merged table keeps everything verbatim
(the UNCHANGED path). i18n `docxToolbar.{mergeCells,splitCell}` (ar reviewed 2026-07-30). Guards: `docModelTables.test.ts`
(parse gridSpan/vMerge→colspan/rowspan; emit colspan→gridSpan, rowspan→vMerge restart+continuation, split re-expand,
unchanged-merged verbatim, add-row-on-merged rebuild), `docxTablesMapping.test.ts` (colspan/rowspan PM round-trip),
`docxToolbar.test.ts` (merge via CellSelection, split, enabled-probes), `docx-tables.browser.test.ts` (real Chrome:
merge via toolbar → save → reopen → gridSpan/colspan survive). Verified live (`qa-shots/f2-merge-3cd/`: 2 header
cells → 1 colspan-2 cell; 0 console errs).
**Image & hyperlink preservation + display (Sub-project C Phase 1, 2026-06-26):** the DOCX editor's `save()`
was **data-lossy** — verified by probe: an image-bearing top-level `w:p` parsed to `{runs:[]}` and `setRunsOn`
wiped its `w:drawing` (image DESTROYED); a `w:hyperlink` survived but `parseParagraph`'s DEEP
`getElementsByTagName('w:r')` counted its nested run, so save APPENDED a duplicate plain run (link text TWICE).
Fix = a third OPAQUE `DocBlock` variant `DocImageBlock {kind:'image', image?, linkText?}` (sibling of `DocTable`).
**The preservation guarantee is DOM-structural, NOT model-based:** `isAnchorParagraphEl(p)` (deeply contains
`w:drawing` OR `w:hyperlink`) is checked at reconcile time, and `reconcileContainer` treats anchor `w:p` as
immutable BOUNDARIES (like tables) — segmenting around them and NEVER passing them to `setRunsOn`, in BOTH the
main path AND the count-mismatch fallback (`reconcileParagraphsOnly` now filters `&& !isAnchorParagraphEl(c)`).
So an anchor `w:p` is preserved byte-exact even if the PM doc diverges (e.g. user "deletes" the read-only atom →
it persists on save; true delete is Phase-2 C2). `parseContainerBlocks` emits `DocImageBlock` for anchors
(linkText read from XML; image bytes MERGED later in `mountDocxEditor` by block index from the existing
read-only `extractDocImages` channel — indices align: both walk `body` children filtering `w:p`/`w:tbl` in order).
`docxSchema` gains read-only atom nodes `docx_image` (renders the real PNG/JPEG via a `data:` URI) + `docx_link`
(shows link text); the PM bridge maps `DocImageBlock`↔atom (`imageBlockToNode`/`emitBlockTo`). `docxToPdf` SKIPS
image blocks in its text-flow loops (the image is drawn via its own `imagesByBlock` channel [2026-09-28: removed by `539f308` — see below] — never as a
paragraph). **Byte-identical when no drawing/hyperlink present** (the boundary set is then just tables, as before
— guarded by a no-regression control test). `parseDocModel`'s `paragraphs` view excludes image blocks too
(`!isDocTable && !isDocImageBlock`). **Ceiling (Phase 1):** a paragraph mixing flowing text + an inline
image/link is read-only (whole anchor is opaque); anchors are non-deletable/non-reorderable; an image INSIDE a
table cell is still PRESERVED byte-exact (cell anchor `w:p` skipped during cell recursion) but renders as an empty
atom, not the picture (image bytes are merged only for TOP-LEVEL blocks — `extractDocImages` skips nested-in-table,
the same ceiling as the PDF export); image EDITING (move/resize/delete) + EDITABLE links (`w:hyperlink`↔link-mark+rels
round-trip) are Phase 2 (C2/C3).
Guards: `tests/docx/{docModelImagePreserve,docxImageBridge}.test.ts` (jsdom: parse→block, drawing survives,
hyperlink single-occurrence, byte-identical control, atom round-trip) + `tests/browser/docx-image-preserve.browser.test.ts`
(real Chrome: img renders inline, link shown once, save round-trips drawing+blip+single hyperlink, plain para intact).
**Editable external hyperlinks (Sub-project C Phase 2a, 2026-06-26):** EXTERNAL `w:hyperlink` (`r:id`→http/https/
mailto) are now EDITABLE — they SUPERSEDE the Phase-1 hyperlink-opaque rule. `DocRun.linkUrl?` ↔ the
prosemirror-schema-basic `link` mark (`href`). `isAnchorParagraphEl` now returns opaque ONLY for `w:drawing` OR a
`w:hyperlink` that `isInternalOnlyHyperlink` (has `w:anchor`, NO `r:id`) — so an external-link paragraph parses as
an editable `DocParagraph`. `parseParagraph` walks DIRECT children IN ORDER (not the old deep `getElementsByTagName`
that double-counted), reading a `w:hyperlink`'s runs ONCE with `linkUrl` resolved from a rId→Target `linkMap`
(`opcParts.buildHyperlinkMap`). On save, `setRunsOn` removes existing `w:r` AND `w:hyperlink` and re-emits, grouping
maximal consecutive same-`linkUrl` runs into ONE `w:hyperlink` whose `r:id` comes from `DocApplyIds.links` (url→rId,
resolved reuse-or-create by `opcParts.ensureHyperlinkRel`, `sanitizeLinkUrl`-gated in `mountDocxEditor.save()` — an
invalid scheme drops to plain text, no rel). **De-dup is now STRUCTURAL** (read once / emit once), not opaque-skip.
**Byte-identical when no run has a linkUrl** (`ids.links` empty → grouping no-ops). Toolbar 🔗 button (`docxToolbar`)
+ inline URL input: caret-in-link removes; else reveal input, Enter sanitizes + applies the `link` mark.
INTERNAL-anchor (`w:anchor`) links stay opaque/preserved (Phase-1 `docx_link` atom) — editing them is the ceiling
(also: mixed external+internal paragraph stays opaque; Word `Hyperlink` char-style not re-applied; field-code
`HYPERLINK` instructions unhandled).
Guards: `tests/docx/{docModelLinks,opcPartsHyperlink,docxToolbar}.test.ts` + `tests/browser/docx-links.browser.test.ts`
(real Chrome: external link editable `<a href>`, internal read-only, save round-trips `w:hyperlink`+rels, toolbar
add-link creates a relationship). NB Phase-1 hyperlink fixtures were switched to internal-anchor (the now-opaque case).
**Image DELETE + RESIZE + editor undo (Sub-project C Phase 2b, 2026-06-26):** a TOP-LEVEL image anchor is now
resizable + deletable; untouched images (and hyperlink anchors, tables, cell-nested images) stay byte-exact.
**Identity:** `DocImageBlock.anchorId?` (OPTIONAL, **no `SCHEMA_VERSION` bump** — the docx model isn't persisted)
= 0-based index among TOP-LEVEL drawing anchors, stamped at parse (`parseContainerBlocks(..., stampAnchorIds)` —
body level only, so cell images get none and stay opaque), carried on BOTH the `docx_image` AND `docx_link` node
(`anchorId` attr, default -1). **The link also carries it** because an unsupported-format / unextracted image
(`extractDocImages` skips EMF/WMF/missing-media) falls back to a `docx_link` node — keeping its `anchorId` means the
save pre-pass PRESERVES it instead of treating it as deleted (would have been a data-loss regression). **Save
pre-pass** `reconcileImageAnchors(body, blocks)` in `applyBlocks`, GATED behind `opts.editImages` (only the editor
save passes it; `applyParagraphRuns` and every other caller omit it → byte-identical, images verbatim — else the
paragraphs-only path would see `S=∅` and DELETE every image). It deletes the `w:p` for an absent anchorId and
rewrites `wp:extent` (+ inner `a:ext`) cx/cy ONLY when dims differ (byte-exact when unchanged; EMU=pt×12700).
**SAFETY GUARD:** if surviving anchorIds aren't a duplicate-free subset of `{0..m-1}` → skip the pre-pass entirely
(Phase-1 verbatim, never corrupt). `S` is identity-only (any block with a numeric anchorId); RESIZE additionally
requires `image` (dims). **UI:** `src/docx/docxImageView.ts` NodeView — corner SE drag handle (px→pt ×0.75; base
on the node's stored widthPt NOT getBoundingClientRect, which `max-width:100%` clamps; aspect-locked, Shift = free
tracks dy independently) dispatching `setNodeMarkup`, + a ✕ button (`docxEditor.deleteImage`, ar reviewed 2026-07-30) and
Delete/Backspace on the selected atom. **Undo:** `prosemirror-history` (NEW dep, MIT) + `Mod-z`/`Mod-y` — the
editor had NO undo before; resize/delete (and now typing) are undoable, composing with findReplacePlugin's
single-tx replace-all. **Ceilings (v1):** image MOVE/reorder + new-image INSERT → v2; cell-nested images opaque;
a MIXED image+text paragraph deletes WHOLE (the Phase-1 atom = the whole `w:p`, hidden text too — undo recovers;
stripping just the drawing leaves a model-less text para the reconciler removes anyway). Guards:
`tests/docx/{docModelImageEdit,docxImageBridge,docxUndo}.test.ts` +
`tests/browser/docx-image-edit.browser.test.ts` (real Chrome: handles render, drag resizes pixels, Shift=free,
✕/Delete removes, save round-trips wp:extent/w:drawing, undo reverts).
**Export-PDF staleness FIXED (follow-up C, 2026-06-26):** `docxToPdf.docModelToPdfBytes` now renders each
`DocImageBlock` from its OWN live `image` data (`dataB64`/`mime`/`widthPt`/`heightPt`, round-tripped through the PM
node) in the `model.blocks` loop — so an in-session **resize** (live dims) and **delete** (block absent) show in
the exported PDF immediately, NOT only after save+reopen. The stale `getImages()`/`opts.images` second channel +
the positional `imagesByBlock` map are GONE (`DocxToPdfOptions.images` removed; controller calls
`docModelToPdfBytes(model)` with no images arg); `getImages()` stays on the handle, unused by export, for phase-B
insert/move. At mount, `extractDocImages` bytes are still merged into the model's image blocks, so an UNEDITED
export is byte-equivalent (every supported image still embedded, same place/size). A block with `image: undefined`
(unsupported format / link-fallback / cell-nested) draws nothing — unchanged ceiling. Guards:
`tests/browser/docx-to-pdf.browser.test.ts` (render-from-block / delete→no paintImageXObject / resize→wider
painted image, all real pdf.js) + the jsdom no-throw case in `tests/docx/docxToPdf.test.ts`. Live
eyes-on (2026-06-26): an in-session image resize was confirmed baked into the exported PDF — the
artifact itself is not retained (`qa-shots/` is gitignored and the container is reclaimed).
**New-image INSERT (Sub-project B, sub-slice 1 of 4, 2026-06-26):** the DOCX editor can now INSERT a
PNG/JPEG (📷 toolbar button → hidden file input → sniff magic bytes → `createImageBitmap` for natural
px → `widthPt = min(px×0.75, 468pt)` proportional → a `docx_image` PM node with `anchorId: -1`). It
renders inline immediately (the C2 NodeView) and survives `save()` as a brand-new `w:drawing` + `word/media`
part + Content-Types Default + image rel. **Engine:** `opcParts.ensureImagePart(opc, bytes, mime) → {rId,
target}` mints a fresh `word/media/imageN.png|jpg` (N = 1 + max existing), adds the Content-Types `Default`
for the extension **once** (images are typed by Default, not Override), and a `…/relationships/image` rel.
[superseded 2026-09-28: absorbed into `placeImageAnchors` (slice 2, below)] `docModel.materializeNewImageAnchors(mintImage, body, blocks)` is a save pre-pass that inserts a DOM `w:p`
anchor (`buildDrawingParagraph` → minimal spec-valid inline pic) for every NEW image block (`kind:'image'`,
`image` defined, **no** `anchorId`), placed by a per-block parallel walk of `blocks` vs the body's block
children so boundary order lines up and `reconcileContainer`'s segment-zip stays aligned. **Minting is a
CALLBACK** (`opts.mintImage?: (bytes, mime) => string`), NOT `opcParts` directly — `docModel` must not
import `opcParts` (cycle); the editor save passes `mintImage: (b, m) => ensureImagePart(opc, b, m).rId`.
**Ordering is load-bearing (deviates from the original spec):** `reconcileImageAnchors` runs FIRST (it keys
on parse-time anchor POSITIONS — inserting a new anchor before an existing one would shift those positions
and make it delete/resize the wrong anchor = data loss), THEN `materializeNewImageAnchors`, THEN
`reconcileContainer`. **Byte-identical when no image is inserted** (materialize no-ops without a new image;
legacy `applyBlocks` callers omit `mintImage`). A new image carries no `anchorId`, so `reconcileImageAnchors`
(identity-only on numeric `anchorId`) never touches it during the same save; on the NEXT open it parses as
an existing anchor with a fresh parse-time `anchorId`. **Ceiling (later sub-slices):** image MOVE/reorder
(slice 2 ▲▼+Alt), cut&paste (3), drag (4) — all sharing one save-side reorder built in slice 2; inline-
with-text insert, cell-nested insert, non-PNG/JPEG, dedup-by-content all out of scope. The toolbar exposes
`insertImage(bytes, mime, widthPt, heightPt)` for tests; an undecodable image (`createImageBitmap` throws,
caught) still inserts at 0 dims. i18n `docxToolbar.insertImage` (en/fr/ar, ar reviewed 2026-07-30). No new feature
flag (rides `VITE_FEATURE_DOCX_EDIT`); no `SCHEMA_VERSION` bump. Guards: `tests/docx/opcImagePart.test.ts`,
`tests/docx/docImageInsert.test.ts` (incl. the insert-BEFORE-existing data-loss case that proves the
ordering), the insertImage cases in `tests/docx/docxToolbar.test.ts`, and
`tests/browser/docx-image-insert.browser.test.ts` (real Chrome: file-pick → render → save mints
`w:drawing` + media part + Default + rel into a doc that had none). Live eyes-on: `qa-shots/b-insert/`.
**Image MOVE/reorder (Sub-project B, sub-slice 2 of 4, 2026-06-26):** the DOCX editor can move an
existing image up/down — **any distance, including crossing tables / other images** — persisted through
the in-place `save()` with **full fidelity** (no other content rebuilt). UI = ▲/▼ buttons on the selected
image's NodeView (beside C2's ✕/resize) + **Alt+↑/↓** when an image is selected; each press moves it past
one adjacent top-level block. **PM side:** `src/docx/docxImageMove.ts` — `moveImageAt(state, pos, dir) →
Transaction | null` (delete the node, re-insert before the prev / after the next top-level block, keep it
NodeSelected; null at a bound → no-op) + `moveImage(dir): Command` (gated on a `docx_image` NodeSelection),
one undoable transaction via the wired `prosemirror-history`. **Save side (the engine):** `applyBlocks`'
`editImages` branch builds an `anchorEl: Map<anchorId, Element>` **once, pre-mutation** (the DOM is parse
order, so `D[i]` has `anchorId i`) and shares it across two passes: `reconcileImageAnchors` (C2 delete/resize,
**refactored from positional to map-keyed** — behavior-identical, removes the old "ordering is load-bearing"
footgun) → `placeImageAnchors` (move existing by `anchorId` + insert new — **absorbs the former
`materializeNewImageAnchors`**). `placeImageAnchors` walks the model blocks with a cursor over the body's
**non-image-anchor** block children (text + tables + hyperlink anchors = fixed reference points, never
touched); an existing image is **moved** (`body.insertBefore` re-parents the element in place), a new image
is **inserted** (mint via the `opts.mintImage` callback — `docModel` still must not import `opcParts`, the
cycle). Then `reconcileContainer` runs **unchanged**. **Why full fidelity:** only image `w:p` elements
relocate, so after placement the boundary order matches the model and the segment-zip is all in-place
`setRunsOn` — a displaced paragraph's unmodeled `pPr` is **not** rebuilt (a strict improvement over a
reorder-then-reconcile-shuffle approach). **`applyBlocks` always re-parses the pristine `originalXml`**, so
multiple session moves compose and there's no mid-session `anchorId` churn (on the next open the doc
re-parses and anchorIds are reassigned by the new order). **Byte-identical when nothing
moved/inserted/deleted** (all passes no-op; legacy `applyParagraphRuns` omits `editImages`). C2 SAFETY GUARD
(model image anchorIds ⊆ map keys, dup-free) still bails to verbatim. **Ceiling:** moving tables/paragraphs
themselves, move-to-top/bottom, multi-select move; cell-nested images stay opaque/non-movable; cut&paste
(slice 3) + drag (slice 4) reuse `placeImageAnchors`. No new dep, no `SCHEMA_VERSION` bump, rides
`VITE_FEATURE_DOCX_EDIT`. i18n `docxEditor.moveImageUp`/`moveImageDown` (ar reviewed 2026-07-30). Guards:
`tests/docx/docImageMove.test.ts` (engine: move past text with `pPr` survival, cross-table, swap, move+insert,
byte-identical, map-keyed delete/resize regression), `tests/docx/docxImageMove.test.ts` (command bounds +
selection gate + undoable + NodeView ▲/▼ present), `tests/browser/docx-image-move.browser.test.ts` (real
Chrome: move past a table round-trips through save). Live eyes-on: `qa-shots/b-move/move-controls.png`.
**Image cut & paste (Sub-project B, sub-slice 3 of 4, 2026-06-26):** the DOCX editor supports
Ctrl/Cmd+**X/C/V** on a selected image and **paste of an external image blob** (OS "copy image" /
screenshot), persisted through the in-place `save()`. **Adds NO new save logic** — three small
ProseMirror-layer hooks (new `src/docx/docxImagePaste.ts`) route a pasted image into the *existing*
slice-1/2 `anchorId:-1 ⇒ mint-fresh` insert path. **The bug it fixes:** `docx_image` has a `toDOM`
but had no `parseDOM`, and PM's native copy preserves attrs → an intra-editor COPY duplicates
`anchorId` (two nodes both `anchorId:0`) → at save, `placeImageAnchors`' dup-free guard trips → the
save **bails to verbatim** → the pasted copy is silently dropped. **Fix = every PASTED image arrives
with `anchorId:-1`** so the save mints fresh OPC media instead. Three units: (1) `resetPastedImageAnchors(slice)`
wired as the `transformPasted` PM prop — walks the pasted fragment and rebuilds every `docx_image` with
`anchorId:-1`; PM runs `transformPasted` on the FINAL slice for BOTH the intra-editor slice path AND the
HTML-parse path, so one hook covers copy/paste AND cut/paste; (2) a scoped `parseDOM` on the `docx_image`
schema node — `img[data-docx-image]` with a `data:image/png|jpeg` src only (`priority:60` to win over
prosemirror-schema-basic's inline `image` rule `img[src]`; `getAttrs` returns `false` for any non-data
src so an arbitrary web `<img>` NEVER matches) → `{mime,dataB64,anchorId:-1}`; (3) a `handlePaste`
image-blob branch (AFTER the existing Ctrl+Shift+V plain-text check) — `firstImageFile(clipboardData)`
(files then items, png/jpeg) → `insertImageBlob` (slice-1 dims: `createImageBitmap`, `PT_PER_PX=0.75`,
`CONTENT_WIDTH_PT=468`, catch→0 dims) → insert `docx_image` `anchorId:-1`. **Cut needs no new wiring** —
it is PM-native copy+delete: the original's `w:drawing` is removed by `reconcileImageAnchors` (its anchorId
vanishes from the model), the pasted copy re-mints → move-via-clipboard (old media part orphaned, same as a
C2 delete). The shared image primitives (`sniffImageMime`/`imgBytesToB64`/`imageDimsPt` + the PT consts)
were LIFTED from `docxToolbar.ts` into `docxImagePaste.ts` (toolbar now imports them — behavior-identical,
the 📷 Insert button unchanged). No new dep, no `SCHEMA_VERSION` bump, rides `VITE_FEATURE_DOCX_EDIT`.
**Ceiling:** `http(s)` `<img src>` from web HTML (CORS — can't read the bytes client-side, never matched);
GIF/SVG/WebP (only PNG/JPEG minted, matches the slice-1 sniff); **~~orphaned-media GC after a cut
(no part GC in v1)~~ — CLOSED 2026-09-04**, `gcOrphanMediaParts` runs on every editor save and
collects the cut orphan along with every other unreferenced `word/media` part; mixed text+image HTML fragments (an embedded image embeds only if it is a `data:`-uri
`<img data-docx-image>`). Guards: `tests/docx/docxImagePaste.test.ts` (jsdom: `resetPastedImageAnchors`
reset + non-image untouched, `parseDOM` data-uri parse + http/no-attr rejection, `firstImageFile`,
`transformPasted` wired) + `tests/browser/docx-image-cutpaste.browser.test.ts` (real Chrome: copy→paste →
**two** `w:drawing` after save = no verbatim-bail; cut→paste → one relocated; eyes-on before/after shot).
Live eyes-on: `qa-shots/b-cutpaste/{before-one-image,after-two-images}.png`.
**Image drag-to-reorder (Sub-project B, sub-slice 4 of 4 — COMPLETES follow-up B, 2026-06-26):** drag an
image with the pointer to reorder it among the document's **top-level** blocks, with a live drop-indicator
line, persisted through the in-place `save()`. **Custom pointer drag** (NOT native HTML5 drag) on the
`<img>` body — the `.se` resize handle / ✕ / ▲▼ children keep their own events, so image-body=move vs
SE-handle=resize is a clean element-level hit-test. **No new save logic** — reuses the slice-2 path:
`placeImageAnchors` already relocates a top-level `w:drawing` by `anchorId`. Two new PURE helpers in
`docxImageMove.ts`: `moveImageToGap(state, pos, gap)` (generalizes `moveImageAt`'s ±1 to an arbitrary
top-level block gap ∈ [0, childCount]; null on the image's own gap `g===ci||g===ci+1` or a non-top-level
target; `moveImageAt` was **refactored to delegate** — `dir -1 → gap ci-1`, `dir +1 → gap ci+2` — so slice-2
▲▼/Alt stay byte-green) + `dropTargetIndex(view, clientY)` (nearest top-level gap, counting block midpoints
above the pointer via `coordsAtPos` — top-level only, so a drop can never target a cell/inline position the
save can't represent). `docxImageView.ts`: pointerdown on the `<img>` records start X/Y but does NOT
preventDefault (a plain click must still select via PM); past a **5px threshold** it enters drag mode
(`.docx-image-dragging` dims the image) and renders a single reused `.docx-image-drop-line` (2px accent line,
`pointer-events:none`) at the gap; pointerup → `moveImageToGap(…, dropTargetIndex(…))` (no-op if it's the
image's own gap) or, below threshold, nothing (a click). The drop-line is appended to `view.dom.parentElement`,
which is set `position:relative` for the duration of the drag (restored on clear) so the absolute `top`
anchors correctly. One `prosemirror-history` undo step (same as ▲▼/resize). No new dep, no `SCHEMA_VERSION`
bump, rides `VITE_FEATURE_DOCX_EDIT`. **Ceiling:** drag into/out of a table cell (top-level only), drop at an
arbitrary inline position, touch-drag auto-scroll on very long docs (drop still computes; no auto-scroll),
multi-image drag-select. Guards: `tests/docx/docxImageMove.test.ts` (jsdom: `moveImageToGap` front/end/middle/
own-gap/clamp, `moveImageAt` slice-2 regression, `dropTargetIndex` above/below/between with stubbed coords,
NodeView sub-threshold-click no-move) + `tests/browser/docx-image-drag.browser.test.ts` (real Chrome: drag
below a table → `w:drawing` relocated after save; sub-threshold click → unmoved; eyes-on dim + drop-line shot).
Live eyes-on: `qa-shots/b-drag/{dragging,drop-indicator}.png`.
