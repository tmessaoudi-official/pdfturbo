# Sub-project C — Phase 2a (DOCX editor: editable external hyperlinks) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use `- [ ]` tracking.

**Goal:** Make external `w:hyperlink` (`r:id`→http/https/mailto) editable: link text ↔ the `link` mark, save round-trips one `w:hyperlink` + a rels entry. Internal-anchor links stay opaque/preserved.

**Architecture:** `DocRun.linkUrl?` ↔ prosemirror `link` mark. `parseParagraph` walks children in order, attributing `linkUrl` from a rId→URL rels map; external-link paragraphs are no longer opaque (only `w:drawing` / internal-anchor-only hyperlinks are). Save groups consecutive same-`linkUrl` runs into a `w:hyperlink` whose `r:id` is resolved (reuse-or-create) via `opcParts`. Byte-identical when no link present.

**Tech Stack:** TypeScript, jsdom DOMParser, prosemirror-model, vitest (jsdom + real-Chrome).

## Global Constraints

- Cardinal in-place rule; byte-identical when no hyperlink present.
- TDD; full deploy gate per commit (audit → ocr:assets → type-check → lint → test → test:browser → coverage:export → build); browser suite deploy-blocking. Capture vitest output by redirecting `> file 2>&1` (the harness wrapper eats stdout); positional-path jsdom runs are intercepted → run the FULL `npx vitest run`, or `--config vitest.browser.config.ts <file>` for browser.
- No new deps (`sanitizeLinkUrl`, `opcParts`, the existing `link` mark). `VITE_FEATURE_DOCX_EDIT` seam. No `Co-Authored-By`. `git push` manual.
- Spec: `docs/superpowers/specs/2026-06-26-docx-editor-subproject-c-phase2a-links-design.md`.

---

### Task 1: opcParts rels helpers (`buildHyperlinkMap`, `ensureHyperlinkRel`)

**Files:** Modify `src/docx/opcParts.ts`; Test `tests/docx/opcPartsHyperlink.test.ts` (create).

**Interfaces:** Produces `buildHyperlinkMap(opc: OpcPackage): Map<string,string>` (rId → external Target, for `Type=…/hyperlink` + `TargetMode=External`); `ensureHyperlinkRel(opc: OpcPackage, url: string): string` (return an existing External hyperlink rel's Id with the same Target, else create `<Relationship Id="rIdN" Type=…/hyperlink Target="url" TargetMode="External"/>` and return its new Id).

- [ ] **Step 1: failing test** — build an opc (via `openOpc(zipSync({...}))` with a `word/_rels/document.xml.rels` containing one hyperlink rel) → `buildHyperlinkMap` returns `{rId5→https://x}`; `ensureHyperlinkRel(opc,'https://x')` returns `rId5` (reuse); `ensureHyperlinkRel(opc,'https://new')` returns a fresh id and adds a Relationship.
- [ ] **Step 2: run, verify fail.**
- [ ] **Step 3: implement** — reuse the `REL_NS`/`DOC_RELS` constants + the Relationship-creation pattern already in `registerPart`. Compute the next free `rId` by scanning existing `Relationship@Id` (`max numeric suffix + 1`). `buildHyperlinkMap` reads `getPart(opc, DOC_RELS)`, parses, filters `Type` ending `/hyperlink` AND `TargetMode==='External'`.
- [ ] **Step 4: run, verify pass.**
- [ ] **Step 5: type-check + lint.**
- [ ] **Step 6: commit** — `feat(docx): opcParts hyperlink rels helpers (buildHyperlinkMap, ensureHyperlinkRel)`.

---

### Task 2: model — `DocRun.linkUrl`, internal-anchor detection, parse attribution

**Files:** Modify `src/docx/docModel.ts`; Test `tests/docx/docModelLinks.test.ts` (create).

**Interfaces:** Produces `DocRun.linkUrl?: string`; `isInternalOnlyHyperlink(hl: Element): boolean` (no `r:id` attr AND has a `w:anchor` attr); changed `isAnchorParagraphEl` (opaque iff `w:drawing` OR a `w:hyperlink` that `isInternalOnlyHyperlink`); `parseRunEl(r: Element): DocRun` (extracted from `parseParagraph`'s loop body); `parseParagraph` walks DIRECT children, attributing `linkUrl` to `w:hyperlink` runs; `parseDocModel(documentXml, numberingMap?, linkMap?)`.

- [ ] **Step 1: failing tests**

```ts
const NS = `xmlns:w="…main" xmlns:r="http://r"`; // (full ns as in docModelImagePreserve.test.ts)
const linkMap = new Map([['rId9', 'https://example.com']]);

it('parses an external-link paragraph as editable runs carrying linkUrl', () => {
  const m = parseDocModel(doc(`<w:p><w:r><w:t>see </w:t></w:r><w:hyperlink r:id="rId9"><w:r><w:t>here</w:t></w:r></w:hyperlink></w:p>`), undefined, linkMap);
  expect(isDocImageBlock(m.blocks[0])).toBe(false);               // NOT opaque anymore
  const p = m.paragraphs[0];
  expect(p.runs.map(r => r.text)).toEqual(['see ', 'here']);
  expect(p.runs[0].linkUrl).toBeUndefined();
  expect(p.runs[1].linkUrl).toBe('https://example.com');
});

it('keeps an internal-anchor-only hyperlink paragraph opaque', () => {
  const m = parseDocModel(doc(`<w:p><w:hyperlink w:anchor="_Toc1"><w:r><w:t>jump</w:t></w:r></w:hyperlink></w:p>`));
  expect(isDocImageBlock(m.blocks[0])).toBe(true);                // still opaque
});
```

- [ ] **Step 2: run, verify fail.**
- [ ] **Step 3: implement** — extract `parseRunEl(r)` from the existing `parseParagraph` loop (returns a `DocRun`, including the new `linkUrl` arg path: `parseRunEl(r, linkUrl?)`). Rewrite `parseParagraph(p, numberingMap?, linkMap?)` to iterate `p.children`: `w:r`→`parseRunEl`; `w:hyperlink` with `r:id`→resolve `linkMap.get(rId)`, then map its child `w:r`→`parseRunEl(r, url)`. `isAnchorParagraphEl`: `getElementsByTagName('w:drawing').length>0 || Array.from(getElementsByTagName('w:hyperlink')).some(isInternalOnlyHyperlink)`. `parseContainerBlocks`/`parseDocModel` thread `linkMap`.
- [ ] **Step 4: run, verify pass + the Phase-1 `docModelImagePreserve` tests still pass** (an internal-anchor link stays opaque; a plain image stays opaque; NB the Phase-1 test used a generic `w:hyperlink r:id` paragraph — update that fixture to `w:anchor` so it stays opaque, OR assert it's now editable. Adjust the Phase-1 hyperlink test to the new contract: an `r:id` hyperlink is now editable, an internal-anchor one is opaque.)
- [ ] **Step 5: type-check + lint.**
- [ ] **Step 6: commit** — `feat(docx): parse external hyperlinks into editable linkUrl runs`.

---

### Task 3: save — group linked runs into `w:hyperlink`

**Files:** Modify `src/docx/docModel.ts` (`DocApplyIds`, `setRunsOn`/run-emit); Test `tests/docx/docModelLinks.test.ts`.

**Interfaces:** Consumes Task 1/2. Produces `DocApplyIds.links?: Map<string,string>` (url→rId); `setRunsOn` wraps maximal consecutive same-`linkUrl` runs in a `w:hyperlink r:id` (rId from `ids.links`); runs without `linkUrl` emit unchanged.

- [ ] **Step 1: failing tests**

```ts
it('groups consecutive linkUrl runs into a single w:hyperlink on save', () => {
  const xml = doc(`<w:p><w:r><w:t>x</w:t></w:r></w:p>`);
  const blocks = [{ runs: [{ text: 'a' }, { text: 'b', linkUrl: 'https://e.com' }, { text: 'c', linkUrl: 'https://e.com' }] }];
  const ids = { heading: {1:'Heading1',2:'Heading2',3:'Heading3'}, bulletNumId:0, orderedNumId:0, links: new Map([['https://e.com','rId7']]) };
  const saved = applyBlocks(xml, blocks, ids);
  expect((saved.match(/<w:hyperlink/g)||[]).length).toBe(1);
  expect(saved).toContain('r:id="rId7"');
  expect(saved).toContain('>b<'); expect(saved).toContain('>c<'); // both inside the one hyperlink
});

it('is byte-identical when no run has a linkUrl (no-link control)', () => {
  const xml = doc(`<w:p><w:r><w:t>hello</w:t></w:r></w:p>`);
  const before = applyBlocks(xml, parseDocModel(xml).blocks);
  expect(applyBlocks(xml, parseDocModel(xml).blocks)).toBe(before);
  expect(before).not.toContain('w:hyperlink');
});
```

- [ ] **Step 2: run, verify fail.**
- [ ] **Step 3: implement** — in `setRunsOn`, after building each run element, fold a maximal run of same-`linkUrl` runs: build a `w:hyperlink` element (`setAttributeNS(R_NS,'r:id', ids.links.get(url))`), append the run children into it, append the hyperlink to `p`. Runs with no `linkUrl` (or no `ids.links` entry) append directly (unchanged). Add `R_NS` const. Keep `buildRun` unchanged.
- [ ] **Step 4: run, verify pass + all Phase-1 + table tests pass.**
- [ ] **Step 5: type-check + lint.**
- [ ] **Step 6: commit** — `feat(docx): re-emit grouped hyperlink runs on save (rels round-trip)`.

---

### Task 4: bridge — link mark + mountDocxEditor wiring

**Files:** Modify `src/docx/docxProseMirror.ts`; Test `tests/docx/docModelLinks.test.ts` (bridge round-trip).

**Interfaces:** Consumes Task 1–3. Produces `inlineOf`/`runsOf` map `linkUrl`↔`m.link({href})`; `mountDocxEditor` builds `buildHyperlinkMap(opc)` for parse and, in `save()`, collects link URLs → `sanitizeLinkUrl` → `ensureHyperlinkRel` → `ids.links`.

- [ ] **Step 1: failing test** — `docModelToDoc({blocks:[{runs:[{text:'go',linkUrl:'https://e.com'}]}],paragraphs:[…]})` → the text node carries a `link` mark with `href`; `docToDocModel` round-trips `linkUrl`.
- [ ] **Step 2: run, verify fail.**
- [ ] **Step 3: implement** — `inlineOf`: `if (run.linkUrl) marks.push(m.link.create({ href: run.linkUrl }))`. `runsOf`: read `attr('link','href')` → `linkUrl`. `mountDocxEditor`: `const linkMap = buildHyperlinkMap(opc)` → `parseDocModel(originalXml, buildNumberingMap(opc), linkMap)`. In `save()`: walk `edited` runs, collect distinct `sanitizeLinkUrl(linkUrl)` (drop null), `const links = new Map(urls.map(u => [u, ensureHyperlinkRel(opc, u)]))`, add to `ids`. (Build `ids` even when only links exist — generalize the `if (hasHeading||hasList)` guard to `||hasLink`.)
- [ ] **Step 4: run, verify pass.**
- [ ] **Step 5: type-check + lint.**
- [ ] **Step 6: commit** — `feat(docx): wire hyperlink link-mark round-trip through the editor`.

---

### Task 5: toolbar 🔗 link button

**Files:** Modify `src/docx/docxToolbar.ts`, `locales/{en,fr,ar}.json`; Test `tests/docx/docxToolbar.test.ts`.

**Interfaces:** Produces a `link` toolbar button: with a selection and no link → reveal a minimal inline URL input; on submit `sanitizeLinkUrl` + apply `m.link.create({href})` over the selection; when the caret is in a link → button `btn-active` + click removes the mark. `toolbar.update()` reflects active-state.

- [ ] **Step 1: failing test** — build the toolbar over a view with selected text, call the link command with a URL → the selection gains a `link` mark with `href`; call again on a linked selection → mark removed; `update()` sets active when caret in a link.
- [ ] **Step 2: run, verify fail.**
- [ ] **Step 3: implement** — add `btn('link', t('docxToolbar.link'), …)` with an apply/remove command (apply = `addMark` over selection range with `m.link.create({href})`; remove = `removeMark`). The URL input is a tiny inline `<input>` in the toolbar revealed on click (mirrors the find-replace bar; NOT `window.prompt`). i18n keys `docxToolbar.link`/`docxToolbar.linkPrompt` in all 3 locales (ar [Unverified]).
- [ ] **Step 4: run, verify pass.**
- [ ] **Step 5: type-check + lint (+ locale-sync hook clears on the final 3-locale write).**
- [ ] **Step 6: commit** — `feat(docx): toolbar link button (add/edit/remove hyperlink)`.

---

### Task 6: real-Chrome e2e + full gate

**Files:** Test `tests/browser/docx-links.browser.test.ts` (create).

**Interfaces:** Consumes the full C3 stack. fflate-built fixture: a paragraph with an external `w:hyperlink` (rels rId→https), an internal-anchor `w:hyperlink`, and plain text.

- [ ] **Step 1: test** — `mountDocxEditor`: the external link text is editable and renders as a link; the internal-anchor paragraph renders read-only (the `docx_link` atom). Apply a URL to plain text via the toolbar; `handle.save()`; reopen → exactly one `w:hyperlink` per link, the new Relationship exists in `document.xml.rels`, internal-anchor preserved byte-exact. Screenshot to `qa-shots/c-phase2a/links.png`.
- [ ] **Step 2: run** `npm run test:browser --config …` (single file) → pass; view the screenshot.
- [ ] **Step 3: FULL deploy gate** (audit → ocr:assets → type-check → lint → full jsdom → FULL test:browser → coverage:export → build). Paste counts.
- [ ] **Step 4: commit** — `test(docx): real-Chrome guard for editable hyperlinks`.

---

## Self-Review

- **Spec coverage:** rels helpers = T1; model+parse+detection = T2; save grouping = T3; bridge = T4; UI = T5; e2e = T6. Internal-anchor preserved + byte-identical-no-link controls in T2/T3.
- **Type consistency:** `DocRun.linkUrl`, `DocApplyIds.links` (url→rId), `buildHyperlinkMap`(rId→url)/`ensureHyperlinkRel`(url→rId), `link` mark `href` — stable across tasks.
- **Risk:** the only save-path change (T3 link grouping) is bounded by the byte-identical-no-link control; T2 must update the Phase-1 hyperlink fixture to the new contract (r:id editable / anchor opaque).
- **Placeholders:** none.

## Done = ceiling note (carry to CLAUDE.md on completion)

Internal-anchor/GoTo/TOC links preserved-not-editable; mixed external+internal paragraph stays opaque; Word `Hyperlink` char-style not re-applied; field-code `HYPERLINK` instructions unhandled.
