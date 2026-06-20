# DOCX Rich-Text Toolbar — Design Spec (Phase 2 Slice A)

**Date:** 2026-06-20
**Status:** Approved (design locked via AskUserQuestion 2026-06-20)
**Track:** B (DOCX read+edit editor), follows #1d DOCX→PDF.

## Goal

Add a rich-text formatting toolbar to the in-browser DOCX editor: **bold, italic,
underline, font family, font size, headings (H1–H3), bullet & ordered lists** — every
operation round-tripping IN PLACE to the OPC package (the cardinal rule:
edit `word/document.xml` + `styles.xml`/`numbering.xml`, never rebuild via the `docx`
writer; untouched parts pass through verbatim).

## Constraints (verbatim, project-wide)

- **License:** MIT/BSD only. New dep `prosemirror-schema-list` is **MIT** (verified). No
  AGPL/GPL/paid.
- **OPC cardinal rule:** in-place XML edit + re-zip; never normalize the whole document.
- **Feature flag:** rides the existing `VITE_FEATURE_DOCX_EDIT` (#28 seam) — no new flag.
- **Self-contained editor:** never touches the PDF `documentModel`/`uiController`.
- **i18n:** every visible string via `t()`; en/fr/ar key-identical (AR `[Unverified]`).
- **Tests executed, not just written.** jsdom unit + ≥1 real-Chrome round-trip.

## Architecture

Six units, each one responsibility:

### 1. Model extensions — `src/docx/docModel.ts` (modify)

```ts
interface DocRun {
  text: string;
  bold?: boolean;       // w:b
  italic?: boolean;     // w:i
  underline?: boolean;  // NEW → w:u (w:val="single")
  fontFamily?: string;  // NEW → w:rFonts (ascii+hAnsi+cs)
  fontSize?: number;    // NEW → w:sz / w:szCs (points; written half-points = pt*2)
}
interface DocParagraph {
  runs: DocRun[];
  heading?: 1 | 2 | 3;                       // NEW → w:pPr/w:pStyle val="HeadingN"
  list?: { ordered: boolean; level: number };// NEW → w:pPr/w:numPr (ilvl + numId)
}
```

- `parseDocModel`: read `w:u`/`w:rFonts@w:ascii`/`w:sz` from each run's `rPr`; read
  `w:pStyle@w:val` (map `Heading1|2|3` → 1|2|3, case-insensitive prefix `heading`) and
  `w:numPr` (`w:ilvl@w:val` → level; presence of `w:numId` → list; `ordered` resolved at
  parse time by looking up the numId's abstractNum `numFmt` — bullet vs decimal — via a
  numbering-map passed in; if unavailable, default `ordered:false`).
- `buildRun`: extends the existing clear-then-set discipline. Strip stale
  `w:b/w:i/w:u/w:rFonts/w:sz/w:szCs`, then set from the model run. Order inside `w:rPr`
  must follow the OOXML CT_RPr sequence: `rFonts, b, i, u, sz, szCs`.
- `applyParagraphRuns`: after rebuilding runs, set paragraph-level props in `w:pPr`
  (create `w:pPr` as the FIRST child of `w:p` if absent — pPr must precede runs):
  - heading: set/replace `w:pStyle w:val="HeadingN"`; heading `undefined` → remove our
    `w:pStyle` only if it points at a HeadingN we manage (leave foreign styles alone — if
    the source paragraph had a non-heading pStyle we preserve it; we only ADD/REMOVE
    HeadingN).
  - list: set/replace `w:numPr` (`<w:ilvl w:val="L"/><w:numId w:val="N"/>`) where N is the
    resolved bullet/ordered numId; `list undefined` → remove the `w:numPr` we added.

  `applyParagraphRuns` signature gains an optional resolver: `applyParagraphRuns(xml,
  paragraphs, ids?)` where `ids = { heading: {1:styleId,2,3}, bulletNumId, orderedNumId }`.
  When `ids` omitted (legacy callers, #1c PDF export path), paragraph-level props are
  ignored → byte-identical to today.

### 2. Multi-part OPC helpers — `src/docx/opcParts.ts` (new, pure, jsdom-testable)

The highest-risk unit; gets the heaviest tests (reuse path + inject path + re-parse verify).

- `getPart(opc, path): string | undefined`, `setPart(opc, path, xml)`, `hasPart`.
- `ensureHeadingStyles(opc): { 1: string; 2: string; 3: string }`
  - If `word/styles.xml` exists: scan `<w:style w:type="paragraph">` for ones whose
    `w:styleId` or `<w:name w:val>` matches `heading 1|2|3` (case-insensitive). Reuse those
    styleIds.
  - For any missing level, append a minimal style to the existing `<w:styles>` root:
    ```xml
    <w:style w:type="paragraph" w:styleId="Heading1">
      <w:name w:val="heading 1"/>
      <w:qFormat/>
      <w:pPr><w:outlineLvl w:val="0"/></w:pPr>
      <w:rPr><w:b/><w:sz w:val="32"/><w:szCs w:val="32"/></w:rPr>
    </w:style>
    ```
    (H2: outlineLvl 1, sz 28; H3: outlineLvl 2, sz 26.) styleId collisions avoided by
    suffixing (`Heading1`, else `Heading1Pdfturbo`).
  - If `styles.xml` is ABSENT (rare): create it with a `<w:styles>` root + the 3 styles,
    register `/word/styles.xml` in `[Content_Types].xml` (Override, ContentType
    `…wordprocessingml.styles+xml`) and add a `styles` relationship to
    `word/_rels/document.xml.rels`.
- `ensureListNumbering(opc): { bulletNumId: number; orderedNumId: number }`
  - If `word/numbering.xml` exists: scan `<w:num>`→`<w:abstractNumId>`→`<w:abstractNum>`
    `<w:lvl w:ilvl="0"><w:numFmt w:val>`; reuse the first `bullet` numId and first
    `decimal` numId found. Inject only the missing kind.
  - Inject = append a fresh `<w:abstractNum w:abstractNumId="A">` (A = max existing +1,
    floor 100) with 9 levels (ilvl 0–8) and a paired `<w:num w:numId="N">`. Bullet level:
    ```xml
    <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/>
      <w:lvlText w:val="&#8226;"/><w:lvlJc w:val="left"/>
      <w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr>
      <w:rPr><w:rFonts w:ascii="Symbol" w:hAnsi="Symbol" w:hint="default"/></w:rPr>
    </w:lvl>
    ```
    Ordered level: `<w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/>` (lvlText uses the
    1-based level index per ilvl). Per-level indent = `720*(ilvl+1)` twips.
  - **abstractNum MUST precede num** in the `<w:numbering>` child order (schema-ordered);
    helper inserts accordingly.
  - If `numbering.xml` ABSENT: create root `<w:numbering xmlns:w="…">`, register in
    `[Content_Types].xml` (Override PartName `/word/numbering.xml`, ContentType
    `…wordprocessingml.numbering+xml`) AND add `<Relationship Type="…/numbering"
    Target="numbering.xml" Id="rIdN">` to `word/_rels/document.xml.rels` (rId = unique).
- `buildNumberingMap(opc): Map<numId, 'bullet'|'decimal'|'other'>` — used by
  `parseDocModel` to resolve `ordered` on read.

### 3. ProseMirror schema — `src/docx/docxSchema.ts` (new)

Extend `prosemirror-schema-basic`:
- marks: keep `strong`,`em`,`link`,`code`; add `underline` (`<u>` / `text-decoration:
  underline`), `fontFamily` (attr `family`, renders `<span style="font-family">`),
  `fontSize` (attr `size` in pt, `<span style="font-size:Npt">`).
- nodes: replace `paragraph` group set so `bullet_list`/`ordered_list`/`list_item` from
  `prosemirror-schema-list` (`addListNodes`) are present; add a `heading` node (attr
  `level` 1–3, parseDOM `h1–h3`, toDOM `hN`).

### 4. Toolbar UI — `src/docx/docxToolbar.ts` (new)

`buildDocxToolbar(view): HTMLElement` — a `.docx-toolbar` row of controls:
- B / I / U buttons → `toggleMark(schema.marks.strong|em|underline)`.
- Heading `<select>` (Normal / H1 / H2 / H3) → `setBlockType(heading,{level})` or
  `setBlockType(paragraph)`.
- Font-family `<select>` (a small allowlist + the doc's current) → applies `fontFamily`
  mark to the selection (custom `applyMarkAttr` command — toggle off if empty).
- Size `<select>` (8–48 pt presets) → `fontSize` mark.
- Bullet / ordered buttons → `wrapInList(bullet_list|ordered_list)` /
  `liftListItem` to toggle off.
- Active-state: a ProseMirror plugin (or a `view`-update callback) reflects mark/blocktype
  state onto the controls each transaction.
CSS: `.docx-toolbar`/`.docx-tb-*` added to `modals.css` (reuses existing modal styling).

### 5. Mapping — `src/docx/docxProseMirror.ts` (modify)

- `docModelToDoc`: marks for underline/font/size; `heading` paragraphs → `heading` nodes;
  consecutive `list` paragraphs of the same `ordered` → wrapped in a `bullet_list`/
  `ordered_list` with `list_item`s (nesting by `level`).
- `docToDocModel`: inverse — `heading` node → `paragraph.heading`; list items flattened to
  `paragraph.list={ordered,level}` (one model paragraph per `list_item`'s paragraph).
- `mountDocxEditor`: build the numbering-map (for parse), include `prosemirror-schema-list`
  keymap (`splitListItem`, `sinkListItem`, `liftListItem` on Enter/Tab/Shift-Tab), mount
  the toolbar above the editable area, and on `save()` resolve `ensureHeadingStyles` +
  `ensureListNumbering` and pass their ids into `applyParagraphRuns`.

### 6. i18n + tests

- `locales/{en,fr,ar}.json`: `docxToolbar.{bold,italic,underline,heading,headingNormal,
  h1,h2,h3,font,size,bulletList,orderedList}` (AR `[Unverified]`).
- jsdom: `docModel` parse+apply round-trip for underline/font/size/heading/list;
  `opcParts` ensureHeadingStyles/ensureListNumbering reuse-and-inject + re-parse-well-formed;
  `docxProseMirror` mapping both directions (incl. list grouping); buildNumberingMap.
- real-Chrome (`tests/browser/docx-toolbar.browser.test.ts`): mount editor on a fixture
  .docx → apply bold + H1 + bullet list via toolbar commands → `save()` → reopen the bytes
  → assert the formatting survived AND an untouched table/section still present (the
  pass-through guarantee).

## Error handling

- All injectors operate on cloned DOM; a parse error returns the input unchanged (matches
  `applyParagraphRuns` today). A failed list/heading resolve degrades to skipping that
  paragraph-level prop (runs still saved) rather than corrupting.
- Save is download-only (existing `<base>-edited.docx`); no overwrite of source.

## Ceilings (documented, not built)

- Deep list nesting beyond ilvl 0–8; mixed list restart semantics (single shared numId per
  kind — adjacent ordered lists continue numbering rather than restart; acceptable v1).
- Font availability (Word substitutes absent fonts; we only write the name).
- Per-run text color / highlight (not in requested set — future slice).
- Style inheritance nuances (we inject minimal standalone styles; theme fonts untouched).

## New dependency

`prosemirror-schema-list@^1.5.1` (MIT). Added to `dependencies`.
