# DOCX Rich-Text Toolbar Implementation Plan

> **For agentic workers:** inline TDD execution (executing-plans). Each task = failing test → minimal impl → green → commit.

**Goal:** Add a B/I/U + font + size + headings + lists toolbar to the DOCX editor, round-tripping in place to the OPC package.

**Architecture:** Extend the existing `docModel`/`docxProseMirror`/`docxEditorController` units; new `opcParts.ts` (styles/numbering inject-if-missing), `docxSchema.ts` (extended PM schema), `docxToolbar.ts` (UI). Save resolves style/numbering ids then writes `document.xml` via the extended `applyParagraphRuns`.

**Tech Stack:** TypeScript, fflate, DOMParser/XMLSerializer, prosemirror-{model,state,view,keymap,commands,schema-basic}, **+ prosemirror-schema-list (MIT, NEW)**.

## Global Constraints
- License MIT/BSD only (new dep prosemirror-schema-list = MIT).
- OPC cardinal rule: in-place edit + re-zip; untouched parts verbatim.
- Rides `VITE_FEATURE_DOCX_EDIT` (no new flag).
- en/fr/ar key-identical (AR `[Unverified]`).
- Tests executed (jsdom + ≥1 real Chrome). Commit per task.

---

### Task 0: Add prosemirror-schema-list

- [ ] `npm install prosemirror-schema-list@^1.5.1` (MIT)
- [ ] Verify: `npm run type-check` still 0; `node -e` prints license MIT.
- [ ] Commit: `chore: add prosemirror-schema-list (MIT) for DOCX list editing`

### Task 1: Model — underline / fontFamily / fontSize on DocRun

**Files:** Modify `src/docx/docModel.ts`; Test `tests/docx/docModel.test.ts` (extend).

- [ ] Failing tests: `parseDocModel` reads `w:u`→underline, `w:rFonts@w:ascii`→fontFamily, `w:sz`(half-pt)→fontSize(pt); `applyParagraphRuns` round-trips each; `w:rPr` child order rFonts,b,i,u,sz,szCs; unmodeled rPr children (e.g. `w:color`) survive.
- [ ] Run → FAIL.
- [ ] Impl: extend `DocRun`; `parseDocModel` reads the 3 props (`w:sz` val/2); `buildRun` strips stale `w:u/w:rFonts/w:sz/w:szCs` and re-adds in CT_RPr order (rFonts first, then b,i,u,sz,szCs).
- [ ] Run → PASS; `npm run lint`.
- [ ] Commit: `feat(docx): model underline/font/size on runs`

### Task 2: Model — heading + list on DocParagraph

**Files:** Modify `src/docx/docModel.ts`; Test same file.

- [ ] Failing tests: `parseDocModel` reads `w:pStyle val=Heading2`→heading:2 and `w:numPr`(ilvl+numId)→list (ordered resolved via a passed numbering-map: numId→'decimal' ⇒ ordered:true); `applyParagraphRuns(xml, paras, ids)` writes `w:pPr/w:pStyle` + `w:numPr` (pPr first child of w:p); heading/list `undefined` removes only the props we manage; a foreign existing pStyle is preserved when heading undefined; without `ids` arg paragraph-props are ignored (byte-identical to #1c).
- [ ] Run → FAIL.
- [ ] Impl: extend `DocParagraph`; `parseDocModel(xml, numberingMap?)` gains optional map; `applyParagraphRuns(xml, paras, ids?)` ensures/updates `w:pPr` (insert as first child), sets/removes `w:pStyle`(HeadingN) and `w:numPr`(`ilvl`+`numId` from ids.bullet/orderedNumId).
- [ ] Run → PASS; lint.
- [ ] Commit: `feat(docx): model heading + list on paragraphs`

### Task 3: opcParts — getPart/setPart + ensureHeadingStyles

**Files:** Create `src/docx/opcParts.ts`; Test `tests/docx/opcParts.test.ts`.

- [ ] Failing tests: `ensureHeadingStyles` reuses existing Heading1–3 styleIds (by styleId OR `w:name` heading N, case-insensitive); injects minimal `<w:style>` for missing levels; output styles.xml is well-formed and contains 3 resolvable ids; ABSENT styles.xml → creates it + registers Override in `[Content_Types].xml` + `styles` Relationship in `document.xml.rels`.
- [ ] Run → FAIL.
- [ ] Impl: `getPart/setPart/hasPart`; `ensureHeadingStyles(opc): {1,2,3}` per spec minimal XML (outlineLvl + b/sz); content-type + rels registration helper `registerPart(opc, partPath, contentType, relType, relTarget)`.
- [ ] Run → PASS; lint.
- [ ] Commit: `feat(docx): opcParts ensureHeadingStyles (reuse/inject)`

### Task 4: opcParts — ensureListNumbering + buildNumberingMap

**Files:** Modify `src/docx/opcParts.ts`; Test same.

- [ ] Failing tests: `buildNumberingMap` maps numId→'bullet'|'decimal'; `ensureListNumbering` reuses an existing bullet & decimal numId; injects the missing kind (abstractNum BEFORE num; 9 levels; bullet=Symbol •, ordered=`%1.` decimal); ABSENT numbering.xml → creates root + Override content-type + `numbering` rel; re-parse well-formed; returns distinct bullet/ordered numIds.
- [ ] Run → FAIL.
- [ ] Impl per spec; abstractNumId/numId = max existing +1 (floor 100); reuse `registerPart`.
- [ ] Run → PASS; lint.
- [ ] Commit: `feat(docx): opcParts ensureListNumbering + buildNumberingMap`

### Task 5: docxSchema — extended ProseMirror schema

**Files:** Create `src/docx/docxSchema.ts`; Test `tests/docx/docxSchema.test.ts`.

- [ ] Failing tests: schema has marks underline/fontFamily(attr family)/fontSize(attr size); nodes heading(level 1–3), bullet_list/ordered_list/list_item; toDOM/parseDOM round-trip for the marks (underline→`<u>`/text-decoration; font→style); heading→`hN`.
- [ ] Run → FAIL.
- [ ] Impl: build schema from `schema-basic` spec + `addListNodes(baseSpec.nodes, 'paragraph block*', 'block')` + heading node + 3 marks. Export `docxSchema`.
- [ ] Run → PASS; lint.
- [ ] Commit: `feat(docx): extended ProseMirror schema (u/font/size/heading/lists)`

### Task 6: Mapping + mount wiring

**Files:** Modify `src/docx/docxProseMirror.ts`; Test `tests/docx/docxEditor.test.ts` (extend).

- [ ] Failing tests: `docModelToDoc` emits underline/font/size marks, heading nodes, and groups consecutive same-`ordered` list paragraphs into list nodes; `docToDocModel` inverse (heading node→heading, list_item→paragraph.list); `mountDocxEditor.save()` resolves ensureHeadingStyles/ensureListNumbering and passes ids so a heading+list survive a round-trip (reopen → model has heading/list); `getModel()` still returns the model (PDF-export path unaffected).
- [ ] Run → FAIL.
- [ ] Impl: use `docxSchema`; build numbering-map at open, pass to `parseDocModel`; add list keymap (splitListItem Enter, sink/lift Tab/Shift-Tab); `save()` calls the ensure* helpers + `applyParagraphRuns(originalXml, paras, ids)` + writes back any modified styles/numbering parts.
- [ ] Run → PASS; lint.
- [ ] Commit: `feat(docx): map u/font/size/heading/list ProseMirror⇄model + save ids`

### Task 7: docxToolbar — UI + commands

**Files:** Create `src/docx/docxToolbar.ts`; Test `tests/docx/docxToolbar.test.ts`; CSS in `src/styles/modals.css`.

- [ ] Failing tests (jsdom): `buildDocxToolbar(view)` returns an element with B/I/U/heading-select/font-select/size-select/bullet/ordered; clicking B dispatches a strong-mark toggle (selection becomes bold in `view.state`); heading-select→H2 sets the block to heading level 2; bullet button wraps selection in bullet_list.
- [ ] Run → FAIL.
- [ ] Impl: command wiring (`toggleMark`, `setBlockType`, `wrapInList`, custom `applyMarkAttr` for font/size); active-state reflection via a small `update(view)` callback returned alongside the element.
- [ ] Run → PASS; lint.
- [ ] Commit: `feat(docx): rich-text toolbar UI + commands`

### Task 8: Controller wiring + i18n

**Files:** Modify `src/docx/docxEditorController.ts`, `locales/{en,fr,ar}.json`; Test `tests/docx/docxEditorController.test.ts`.

- [ ] Failing test: opening a doc mounts the toolbar (controller appends `buildDocxToolbar` output above the editor); toolbar i18n keys resolve.
- [ ] Run → FAIL.
- [ ] Impl: mount toolbar in the modal; add `docxToolbar.*` to all 3 locales (AR `[Unverified]`).
- [ ] Run → PASS; lint; locale-sync clean.
- [ ] Commit: `feat(docx): wire toolbar into editor modal + i18n`

### Task 9: Real-Chrome round-trip guard

**Files:** Create `tests/browser/docx-toolbar.browser.test.ts`.

- [ ] Test: build a fixture .docx (with a table) → mountDocxEditor → apply bold + H1 + bullet list via toolbar commands → save() → reopen bytes → assert formatting present in model AND table part survived verbatim.
- [ ] Run `npm run test:browser` (this file) → PASS.
- [ ] Commit: `test(docx): real-Chrome toolbar round-trip + pass-through guard`

### Task 10: Docs + full verify

**Files:** Modify `CLAUDE.md` (Track B bullet); `docs/plans/docx-rich-text-toolbar.plan.md` (mark done).
- [ ] Update CLAUDE.md Track B section: toolbar shipped, opcParts inject-if-missing, ceilings.
- [ ] Full gate: `npm run type-check && npm run lint && npm run test` + `npm run test:browser`.
- [ ] Commit: `docs: document DOCX rich-text toolbar (Phase 2 Slice A)`
