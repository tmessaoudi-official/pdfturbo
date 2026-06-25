# Sub-project C — Phase 2a (DOCX editor: editable external hyperlinks)

> Part of the max-fidelity program (`docs/plans/maxfidelity-program-2026-06-25.plan.md`).
> Builds on Phase 1 (`docs/superpowers/specs/2026-06-25-docx-editor-subproject-c-design.md`),
> which made hyperlinks *survive* save as opaque read-only anchors. Phase 2b (C2 image edit) follows this.

## Goal

Make EXTERNAL hyperlinks (`w:hyperlink` with `r:id` → http/https/mailto) **editable** in the DOCX
editor: link text becomes normal editable text carrying the `link` mark, link target is shown/edited
via the toolbar, and save round-trips a single `w:hyperlink` + a `document.xml.rels` relationship.
INTERNAL-anchor links (`w:anchor`, no `r:id`) stay preserved-but-read-only (the Phase-1 opaque anchor),
a documented ceiling.

## Why this supersedes Phase 1's hyperlink handling

Phase 1 made *any* `w:hyperlink` paragraph an opaque anchor (read-only) purely to stop the
duplication bug. Phase 2a replaces that for external links with a proper model round-trip, so the
de-dup becomes **structural**: parse reads a hyperlink's runs exactly once (tagging them with the
resolved URL); save re-emits exactly one `w:hyperlink`. No paragraph is both "read once" and
"appended again". Internal-anchor paragraphs keep the Phase-1 opaque treatment unchanged.

## Model

```ts
// docModel.ts — DocRun gains an optional link target.
export interface DocRun { /* …existing… */ linkUrl?: string }
```
- `linkUrl` is an absolute external URL (http/https/mailto). It maps 1:1 to the prosemirror-schema-basic
  `link` mark (`{ href }`), already present in `docxSchema`.
- A run with `linkUrl` is otherwise an ordinary run (keeps bold/italic/font/size/color).

## Detection change (the anchor rule)

`isAnchorParagraphEl(p)` (Phase 1: `w:drawing` OR `w:hyperlink`) becomes:

```
opaque iff: contains a w:drawing
         OR contains a w:hyperlink that is INTERNAL-ANCHOR-ONLY (has w:anchor and NO r:id)
```

So an external-link paragraph is **no longer opaque** → it parses as an editable `DocParagraph`. A
paragraph mixing an external link and an internal-anchor link stays opaque (preserve the internal one;
documented ceiling). Add a pure helper `isInternalOnlyHyperlink(hl: Element): boolean`
(`!hl r:id && hl has w:anchor`) and `hasInternalOnlyHyperlink(p)`.

## Parse: attribute linkUrl to hyperlink runs

`parseParagraph` currently reads runs via a DEEP `getElementsByTagName('w:r')` (which is why Phase 1
double-counted). Restructure it to **walk the paragraph's direct children in order**:
- `w:r` (direct child) → a plain run (existing run-property logic, factored into `parseRunEl(r)`).
- `w:hyperlink` (direct child) with an `r:id` → resolve the URL via the rels map, then each of its
  `w:r` children → `parseRunEl(r)` with `linkUrl` set.
- (internal-anchor-only hyperlinks never reach here — their paragraph is opaque.)

`parseDocModel` gains an optional `linkMap?: Map<string,string>` (rId → external Target), mirroring
`numberingMap`. Built by a new `opcParts.buildHyperlinkMap(opc)` reading
`word/_rels/document.xml.rels` for `Type=…/hyperlink` + `TargetMode=External`. `mountDocxEditor` passes
it to `parseDocModel`.

## Save: group linked runs into a w:hyperlink + rels round-trip

`setRunsOn` (and `buildRun`) rewrite a paragraph's runs. Change the run-emit step to **group maximal
consecutive runs sharing the same `linkUrl`** and wrap each group in a `w:hyperlink r:id="…"` element
(individual non-linked runs unchanged). The `r:id` comes from a `links?: Map<string,string>`
(url → rId) added to `DocApplyIds`, resolved before `applyBlocks`:
- `mountDocxEditor.save()` collects every `linkUrl` in the edited model, runs each through
  `sanitizeLinkUrl` (drop invalid → the run stays plain text, no link), and calls a new
  `opcParts.ensureHyperlinkRel(opc, url): string` (reuse an existing External relationship with the
  same Target, else create one — mirrors `registerPart`) to get the rId, building the url→rId map.
- `applyBlocks(originalXml, blocks, ids)` threads `ids.links` to `setRunsOn`.

**Byte-identical when no link present:** `ids.links` is empty/undefined → the run-emit grouping is a
no-op (no run has `linkUrl`) → output unchanged from the current text/table/list path. (Guarded by a
no-link control test.)

## Bridge (docxProseMirror)

- `inlineOf(run)`: if `run.linkUrl`, push `m.link.create({ href: run.linkUrl })`.
- `runsOf(node)`: read the `link` mark's `href` → `run.linkUrl`.
- The `link` mark is already in `docxSchema` (prosemirror-schema-basic). No schema change for the mark.
- The Phase-1 `docx_link` atom remains — now only INTERNAL-anchor paragraphs (still opaque) render it.

## UI: a toolbar link control

Add a 🔗 button to `docxToolbar` (`btn('link', …)`):
- With a non-empty selection and no link → prompt for a URL (a minimal inline input mirroring the
  find-replace bar pattern, NOT a blocking `window.prompt`), `sanitizeLinkUrl` it, and apply
  `m.link.create({ href })` across the selection via a command.
- With the selection already inside a link → the button is "active" (`btn-active`) and clicking it
  removes the link mark (`toggleMark`-style remove).
- Active-state reflects in `toolbar.update()` (the existing post-transaction sync).

i18n: `docxToolbar.link` / `docxToolbar.linkPrompt` in en/fr/ar (ar [Unverified]).

## Acceptance

- Open a DOCX with an external hyperlink → the link text is editable, shows as a link, and the toolbar
  link button is active when the caret is in it.
- Edit the link text / change the URL / remove the link → save → reopen: the `w:hyperlink` round-trips
  with the right `r:id`→Target (exactly once; no duplication), or is gone when removed.
- Add a link to plain selected text → save → a new `w:hyperlink` + a new `Relationship` exist.
- A DOCX with an internal-anchor link → that paragraph stays read-only/opaque, byte-exact (Phase-1
  behavior unchanged).
- **Byte-identical control:** a DOCX with no hyperlink saves exactly as before Phase 2a.
- `javascript:`/`data:` URLs are rejected by `sanitizeLinkUrl` (no relationship, run stays plain text).

## Ceilings (documented)

- Internal-anchor (`w:anchor`/GoTo/TOC) links are preserved but not editable.
- A paragraph mixing an external and an internal-anchor link stays opaque (preserve the internal one).
- Link `w:rPr` styling (Word's Hyperlink character style — blue/underline) is not auto-applied; the
  link mark renders the editor's default link style, and the run keeps whatever direct formatting it
  had. Re-emitting Word's `Hyperlink` style is out of scope.
- Field-code hyperlinks (`HYPERLINK` instruction-text fields, the legacy form) are not handled — only
  the structured `w:hyperlink` element.

## Constraints (inherited)

Cardinal in-place rule; byte-identical-when-no-link; TDD + full deploy gate per item; no new deps
(`sanitizeLinkUrl` + `opcParts` + the existing `link` mark); `VITE_FEATURE_DOCX_EDIT` seam.

## Files

- `src/docx/docModel.ts` — `DocRun.linkUrl`; `isInternalOnlyHyperlink`/`hasInternalOnlyHyperlink`;
  `isAnchorParagraphEl` change; `parseRunEl` extraction; `parseParagraph` child-walk + linkUrl
  attribution; `parseDocModel(linkMap?)`; `setRunsOn` link-run grouping; `DocApplyIds.links`.
- `src/docx/opcParts.ts` — `buildHyperlinkMap(opc)` (rId→URL) + `ensureHyperlinkRel(opc, url)` (→rId).
- `src/docx/docxProseMirror.ts` — `inlineOf`/`runsOf` link mark; `mountDocxEditor` build linkMap on
  parse + resolve url→rId map on save.
- `src/docx/docxToolbar.ts` — the 🔗 link button + inline URL input.
- `src/utils/linkUrl.ts` — reused (no change).
- `locales/{en,fr,ar}.json` — `docxToolbar.link*`.
- Tests: `tests/docx/docModelLinks.test.ts` (parse external→linkUrl, internal stays opaque, save
  groups → single w:hyperlink, byte-identical no-link control, sanitize on save),
  `tests/docx/opcPartsHyperlink.test.ts` (buildHyperlinkMap / ensureHyperlinkRel reuse-or-create),
  `tests/docx/docxToolbar.test.ts` (link button add/remove), `tests/browser/docx-links.browser.test.ts`
  (real Chrome: open external-link DOCX → editable + active button → edit/add/remove → save round-trips
  rels; internal-anchor stays read-only).
