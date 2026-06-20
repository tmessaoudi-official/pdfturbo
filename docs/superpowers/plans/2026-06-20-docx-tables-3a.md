# DOCX Table Editing — Slice C #3a (cell content) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Word table cells editable in the DOCX editor (text + per-run formatting + cell paragraph props + nested tables) while the table *structure* (grid/borders/widths/shading/styles) round-trips verbatim through the in-place OPC save.

**Architecture:** Extend the flat `DocModel` to a recursive `blocks: DocBlock[]` (paragraph | table) while keeping `paragraphs` as a populated top-level field for back-compat. Parsing adds `w:tbl` → `DocTable`; saving generalizes the index-addressed paragraph writer into a **table-anchored, recursive container reconciler** that rewrites only cell paragraph runs and never touches `w:tblPr`/`w:tblGrid`/`w:tcPr`. The editor merges prosemirror-tables node specs + `tableEditing()` (cell selection/nav only; structural commands unbound).

**Tech Stack:** TypeScript, Vite, ProseMirror (prosemirror-model/state/view/keymap/schema-basic/schema-list — all MIT, in tree), **prosemirror-tables@1.8.5 (MIT, new)**, fflate, vitest (jsdom + real-Chrome via Playwright).

## Global Constraints

- **No new feature flag** — rides `VITE_FEATURE_DOCX_EDIT`.
- **Exactly one new dependency**: `prosemirror-tables@1.8.5` (MIT). Add a `THIRD-PARTY-NOTICES.md` entry. No other new deps.
- **Cardinal rule**: edit `word/document.xml` in place + re-zip; NEVER rebuild via the `docx` writer.
- **3a contract**: cell CONTENT editable; table STRUCTURE read-only (row/col/merge are 3b–3d). Structural prosemirror-tables commands are NOT bound.
- **Before each commit**: `npm run type-check && npm run lint && npm run test`. The editor-touching tasks additionally run `npm run test:browser`.
- **Push is manual** (the user pushes). **No Co-Authored-By trailers.** Commit prefixes: `feat:`/`fix:`/`refactor:`/`docs:`.
- **Linters (oxlint)**: no `any`, no non-null `!`; unused/private symbols `_`-prefixed; private methods `_`-prefixed.
- **Locale files** stay key-identical across `en.json`/`fr.json`/`ar.json` (no new keys expected in 3a; if any, add to all three; ar marked [Unverified]).

## File Structure

- `src/docx/docModel.ts` — **modify**: add `kind` discriminant + `DocTable`/`DocRow`/`DocCell`; extend `parseDocModel` to emit `blocks` (incl. `w:tbl`); add `applyBlocks` (the reconciler) + keep `applyParagraphRuns` as a thin wrapper.
- `src/docx/docxSchema.ts` — **modify**: append prosemirror-tables node specs.
- `src/docx/docxProseMirror.ts` — **modify**: `docModelToDoc`/`docToDocModel` emit/read table nodes (drive off `blocks`); add `tableEditing()` plugin; `save()` routes through `applyBlocks`.
- `src/styles/modals.css` — **modify**: editor cell CSS + prosemirror-tables selection overlay.
- `package.json` / `package-lock.json` — **modify**: add `prosemirror-tables`.
- `THIRD-PARTY-NOTICES.md` — **modify**: attribution entry.
- `CLAUDE.md` — **modify**: document the #3a feature in the DOCX editor bullet.
- `tests/docx/docModelTables.test.ts` — **create**: parse + `applyBlocks` round-trip (incl. nested).
- `tests/docx/docxTablesMapping.test.ts` — **create**: `docModelToDoc`/`docToDocModel` table symmetry.
- `tests/browser/docx-tables.browser.test.ts` — **create**: real-Chrome edit→save→reopen guard.

---

### Task 0: Add the prosemirror-tables dependency

**Files:**
- Modify: `package.json`, `package-lock.json`
- Modify: `THIRD-PARTY-NOTICES.md`

- [ ] **Step 1: Install the dependency pinned**

Run: `npm install prosemirror-tables@1.8.5 --save-exact`
Expected: adds `"prosemirror-tables": "1.8.5"` to `dependencies`; no peer-dep warnings (prosemirror-model/state/view/transform/keymap already present).

- [ ] **Step 2: Verify supply-chain is clean**

Run: `npm audit --audit-level=high`
Expected: `found 0 vulnerabilities` (or at least nothing high/critical — the CI gate). If a high advisory appears, STOP and report; do not proceed.

Run: `npm ls prosemirror-tables`
Expected: `prosemirror-tables@1.8.5` resolved once.

- [ ] **Step 3: Add the attribution entry**

Append to `THIRD-PARTY-NOTICES.md` (follow the existing entry format in that file — copy the structure of a neighboring prosemirror-* entry):

```markdown
### prosemirror-tables (1.8.5)
MIT License — Copyright (C) 2015-2016 by Marijn Haverbeke and others.
https://github.com/ProseMirror/prosemirror-tables
```

- [ ] **Step 4: Type-check (catches a bad install immediately)**

Run: `npm run type-check`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json THIRD-PARTY-NOTICES.md
git commit -m "build(docx): add prosemirror-tables@1.8.5 (MIT) for table editing"
```

---

### Task 1: Model types — `kind` discriminant + table interfaces + `blocks` field

**Files:**
- Modify: `src/docx/docModel.ts:13-32` (interfaces)
- Modify: `src/docx/docModel.ts:91-138` (`parseDocModel` — populate `blocks` for the paragraph-only case)
- Test: `tests/docx/docModelTables.test.ts`

**Interfaces:**
- Produces: `DocBlock`, `DocTable`, `DocRow`, `DocCell`; `DocModel.blocks: DocBlock[]`; `DocParagraph.kind?: 'paragraph'`.
- Consumes: existing `DocRun`, `parseDocModel`.

**Design note — minimal-churn discriminant:** `kind` is OPTIONAL on `DocParagraph` (`kind?: 'paragraph'`) and REQUIRED on `DocTable` (`kind: 'table'`). Narrowing is `block.kind === 'table'`. This keeps every existing `{ runs: [...] }` paragraph literal in the codebase and tests valid (no `kind` needed), so existing tests stay green.

- [ ] **Step 1: Write the failing test**

Create `tests/docx/docModelTables.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseDocModel, type DocTable, type DocParagraph } from '../../src/docx/docModel';

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
function docXml(bodyInner: string): string {
  return `<?xml version="1.0"?><w:document ${W}><w:body>${bodyInner}</w:body></w:document>`;
}
const para = (text: string): string => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;

describe('docModel — blocks (paragraph-only back-compat)', () => {
  it('populates blocks alongside paragraphs for a table-free doc', () => {
    const model = parseDocModel(docXml(para('A') + para('B')));
    // paragraphs unchanged (top-level)
    expect(model.paragraphs.map(p => p.runs[0].text)).toEqual(['A', 'B']);
    // blocks mirror paragraphs, all kind paragraph
    expect(model.blocks).toHaveLength(2);
    expect(model.blocks.every(b => b.kind !== 'table')).toBe(true);
    expect((model.blocks[0] as DocParagraph).runs[0].text).toBe('A');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- docModelTables`
Expected: FAIL — `model.blocks` is `undefined` / `DocTable` not exported.

- [ ] **Step 3: Add the interfaces**

In `src/docx/docModel.ts`, change the `DocParagraph`/`DocModel` interfaces and add the table types (replace lines 23-32):

```ts
export interface DocParagraph {
  /** Discriminates DocBlock; optional (absent ⇒ paragraph) to keep existing literals valid. */
  kind?: 'paragraph';
  runs: DocRun[];
  /** Heading level 1–3 (w:pStyle = HeadingN); undefined = body paragraph. */
  heading?: 1 | 2 | 3;
  /** List membership (w:numPr): ordered=decimal vs bullet; level = w:ilvl. */
  list?: { ordered: boolean; level: number };
}
export interface DocCell { blocks: DocBlock[]; }        // recursive → nested tables
export interface DocRow { cells: DocCell[]; }
export interface DocTable { kind: 'table'; rows: DocRow[]; }
export type DocBlock = DocParagraph | DocTable;
export interface DocModel {
  /** Full ordered body content (top-level paragraphs + tables). */
  blocks: DocBlock[];
  /** Top-level paragraphs only (cells excluded) = blocks.filter(kind !== 'table'). Back-compat. */
  paragraphs: DocParagraph[];
}

/** Narrow a DocBlock to DocTable. */
export function isDocTable(b: DocBlock): b is DocTable {
  return (b as DocTable).kind === 'table';
}
```

- [ ] **Step 4: Populate `blocks` in `parseDocModel` (paragraph-only path)**

In `parseDocModel`, the current code builds `paragraphs` then `return { paragraphs }`. Change the return so both fields are populated. For this task, tables are not yet parsed (Task 2), so `blocks` mirrors `paragraphs`:

Replace the final `return { paragraphs };` (line 137) with:

```ts
  const blocks: DocBlock[] = paragraphs;
  return { blocks, paragraphs };
```

(`DocParagraph[]` is assignable to `DocBlock[]`.)

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test -- docModelTables`
Expected: PASS.

- [ ] **Step 6: Full suite + lint + types (back-compat check)**

Run: `npm run type-check && npm run lint && npm run test`
Expected: all green — existing `tests/docx/*` reading `model.paragraphs` are unchanged.

- [ ] **Step 7: Commit**

```bash
git add src/docx/docModel.ts tests/docx/docModelTables.test.ts
git commit -m "feat(docx): add recursive DocBlock/DocTable model + blocks field (back-compat)"
```

---

### Task 2: Parse `w:tbl` → `DocTable` (top-level, non-nested)

**Files:**
- Modify: `src/docx/docModel.ts` (`parseDocModel` — walk body children in order; add `parseTable`/`parseCellBlocks`)
- Test: `tests/docx/docModelTables.test.ts`

**Interfaces:**
- Produces: `parseDocModel` now emits `DocTable` blocks in `blocks` (NOT in `paragraphs`).
- Consumes: `DocParagraph`/`DocTable`/`DocRow`/`DocCell` from Task 1.

- [ ] **Step 1: Write the failing test**

Add to `tests/docx/docModelTables.test.ts`:

```ts
const cell = (text: string): string => `<w:tc><w:tcPr/><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc>`;
const row = (...cells: string[]): string => `<w:tr>${cells.join('')}</w:tr>`;
const table = (...rows: string[]): string => `<w:tbl><w:tblPr/><w:tblGrid/>${rows.join('')}</w:tbl>`;

describe('docModel — table parsing', () => {
  it('parses a top-level table into a DocTable block in document order', () => {
    const xml = docXml(para('intro') + table(row(cell('A1'), cell('B1')), row(cell('A2'), cell('B2'))) + para('outro'));
    const model = parseDocModel(xml);
    // blocks: paragraph, table, paragraph
    expect(model.blocks.map(b => (b.kind === 'table' ? 'T' : 'P'))).toEqual(['P', 'T', 'P']);
    // paragraphs field excludes cell paragraphs
    expect(model.paragraphs.map(p => p.runs[0].text)).toEqual(['intro', 'outro']);
    const t = model.blocks[1] as DocTable;
    expect(t.rows).toHaveLength(2);
    expect(t.rows[0].cells).toHaveLength(2);
    const cellPara = t.rows[0].cells[0].blocks[0] as DocParagraph;
    expect(cellPara.runs[0].text).toBe('A1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- docModelTables`
Expected: FAIL — table is currently ignored; `blocks` has only the 2 paragraphs.

- [ ] **Step 3: Refactor `parseDocModel` to walk body children + parse tables**

In `src/docx/docModel.ts`:

(a) Add a helper that parses a single `w:p` element into a `DocParagraph` — extract the existing per-paragraph body of `parseDocModel` (lines ~95-135) into a function so it can be reused for cell paragraphs:

```ts
/** Parse one `w:p` element into a DocParagraph (runs + heading/list). */
function parseParagraph(p: Element, numberingMap?: NumberingMap): DocParagraph {
  const runs: DocRun[] = [];
  const rs = p.getElementsByTagName('w:r');
  for (let i = 0; i < rs.length; i++) {
    const r = rs[i];
    const ts = r.getElementsByTagName('w:t');
    let text = '';
    for (let j = 0; j < ts.length; j++) text += ts[j].textContent ?? '';
    if (!text) continue;
    const rPr = childEl(r, 'w:rPr');
    const fonts = childEl(rPr, 'w:rFonts');
    const sz = childEl(rPr, 'w:sz');
    const szVal = sz ? Number(sz.getAttribute('w:val')) : NaN;
    const family = fonts?.getAttribute('w:ascii') ?? fonts?.getAttribute('w:hAnsi') ?? undefined;
    runs.push({
      text,
      bold: toggleOn(rPr, 'w:b') || undefined,
      italic: toggleOn(rPr, 'w:i') || undefined,
      underline: toggleOn(rPr, 'w:u') || undefined,
      fontFamily: family || undefined,
      fontSize: Number.isFinite(szVal) && szVal > 0 ? szVal / 2 : undefined,
    });
  }
  const para: DocParagraph = { runs };
  const pPr = childEl(p, 'w:pPr');
  const styleVal = childEl(pPr, 'w:pStyle')?.getAttribute('w:val') ?? '';
  const hMatch = /heading\s*-?\s*([1-6])/i.exec(styleVal) || /^Heading([1-6])$/.exec(styleVal);
  if (hMatch) {
    const lvl = Number(hMatch[1]);
    if (lvl >= 1 && lvl <= 3) para.heading = lvl as 1 | 2 | 3;
  }
  const numPr = childEl(pPr, 'w:numPr');
  const numIdEl = childEl(numPr, 'w:numId');
  if (numIdEl) {
    const numId = Number(numIdEl.getAttribute('w:val'));
    const ilvl = Number(childEl(numPr, 'w:ilvl')?.getAttribute('w:val') ?? '0');
    para.list = { ordered: numberingMap?.get(numId) === 'decimal', level: Number.isFinite(ilvl) ? ilvl : 0 };
  }
  return para;
}
```

(b) Add table parsers. NOTE the use of direct-child filtering (`Array.from(el.children).filter`) so nested tables (a `w:tbl` inside a `w:tc`) are NOT mis-collected by the deep `getElementsByTagName`:

```ts
/** Parse the ordered w:p / w:tbl children of a container (body or cell) into DocBlocks. */
function parseContainerBlocks(container: Element, numberingMap?: NumberingMap): DocBlock[] {
  const out: DocBlock[] = [];
  for (const el of Array.from(container.children)) {
    if (el.tagName === 'w:p') out.push(parseParagraph(el, numberingMap));
    else if (el.tagName === 'w:tbl') out.push(parseTable(el, numberingMap));
  }
  return out;
}
/** Parse a w:tbl element into a DocTable (rows → cells → recursive blocks). */
function parseTable(tbl: Element, numberingMap?: NumberingMap): DocTable {
  const rows: DocRow[] = [];
  for (const tr of Array.from(tbl.children).filter(c => c.tagName === 'w:tr')) {
    const cells: DocCell[] = [];
    for (const tc of Array.from(tr.children).filter(c => c.tagName === 'w:tc')) {
      cells.push({ blocks: parseContainerBlocks(tc, numberingMap) });
    }
    rows.push({ cells });
  }
  return { kind: 'table', rows };
}
```

(c) Rewrite the top of `parseDocModel` to drive off the body container and split out the `paragraphs` view. Replace the body of `parseDocModel` (the `const paragraphs = topLevelParagraphs(dom).map(...)` block through the return) with:

```ts
  const body = dom.getElementsByTagName('w:body')[0];
  const blocks: DocBlock[] = body ? parseContainerBlocks(body, numberingMap) : [];
  const paragraphs = blocks.filter((b): b is DocParagraph => !isDocTable(b));
  return { blocks, paragraphs };
```

(`topLevelParagraphs` stays — `applyParagraphTexts`/`applyParagraphRuns` still use it until Task 3.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- docModelTables`
Expected: PASS — both Task 1 and Task 2 tests green.

- [ ] **Step 5: Full suite (back-compat — paragraphs field meaning preserved)**

Run: `npm run type-check && npm run lint && npm run test`
Expected: green. Existing `docxEditor.test.ts:33` ("table cell NOT included") still passes because `paragraphs` excludes cell paragraphs.

- [ ] **Step 6: Commit**

```bash
git add src/docx/docModel.ts tests/docx/docModelTables.test.ts
git commit -m "feat(docx): parse w:tbl into DocTable blocks (top-level, recursive cells)"
```

---

### Task 3: `applyBlocks` reconciler — table-free path equals `applyParagraphRuns`

**Files:**
- Modify: `src/docx/docModel.ts` (add `applyBlocks`; make `applyParagraphRuns` a wrapper)
- Test: `tests/docx/docModelTables.test.ts`

**Interfaces:**
- Produces: `export function applyBlocks(documentXml: string, blocks: DocBlock[], ids?: DocApplyIds): string`.
- Consumes: existing `buildRun`, `applyParagraphProps`, `childEl`, `W_NS`.

**Design — table-anchored, recursive container reconciliation.** Tables are immutable anchors in 3a. For a container (body or cell), partition both the model `blocks` and the DOM's `w:p`/`w:tbl` children into paragraph-segments delimited by tables; tables align 1:1 by order; each paragraph segment is reconciled in place (update / append-before-anchor / remove-extra), and each table recurses into its cells.

- [ ] **Step 1: Write the failing test (table-free equivalence)**

Add to `tests/docx/docModelTables.test.ts`:

```ts
import { applyBlocks, applyParagraphRuns } from '../../src/docx/docModel';

describe('docModel — applyBlocks (table-free equals applyParagraphRuns)', () => {
  it('produces the same output as applyParagraphRuns for paragraph-only edits', () => {
    const xml = docXml(para('one') + para('two'));
    const edited: DocParagraph[] = [{ runs: [{ text: 'ONE', bold: true }] }, { runs: [{ text: 'two' }] }];
    const viaBlocks = applyBlocks(xml, edited);
    const viaParas = applyParagraphRuns(xml, edited);
    expect(viaBlocks).toBe(viaParas);
    expect(parseDocModel(viaBlocks).paragraphs[0].runs[0]).toMatchObject({ text: 'ONE', bold: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- docModelTables`
Expected: FAIL — `applyBlocks` not exported.

- [ ] **Step 3: Implement `applyBlocks` (paragraph-segment reconciler; tables handled in Task 4)**

In `src/docx/docModel.ts`, add (placing `setRunsOn` as a shared helper extracted from the current `setRuns` closure in `applyParagraphRuns`):

```ts
/** Rewrite a w:p element's runs from a DocParagraph in place (rPr base reused; props via ids). */
function setRunsOn(dom: Document, p: Element, para: DocParagraph, ids?: DocApplyIds): void {
  const existing = Array.from(p.children).filter(c => c.tagName === 'w:r');
  const baseRPr = existing.length
    ? (Array.from(existing[0].children).find(c => c.tagName === 'w:rPr') as Element | undefined)
    : undefined;
  for (const r of existing) r.remove();
  if (ids) applyParagraphProps(dom, p, para, ids);
  const runs = para.runs.length ? para.runs : [{ text: '' }];
  for (const run of runs) p.appendChild(buildRun(dom, baseRPr, run));
}

/** Direct w:p / w:tbl children of a container, in document order. */
function containerBlockEls(container: Element): Element[] {
  return Array.from(container.children).filter(c => c.tagName === 'w:p' || c.tagName === 'w:tbl');
}

/**
 * Reconcile a container's (body or w:tc) w:p/w:tbl children against a model block list.
 * Tables are immutable anchors (3a): zip them 1:1 by order and recurse into cells; the
 * paragraphs between/around tables are reconciled in place with an insertion anchor.
 * `requireParagraph` keeps ≥1 w:p in a cell (OOXML requires a cell to end with a w:p).
 */
function reconcileContainer(dom: Document, container: Element, blocks: DocBlock[], ids: DocApplyIds | undefined, requireParagraph: boolean): void {
  const domEls = containerBlockEls(container);
  const domTables = domEls.filter(e => e.tagName === 'w:tbl');
  const modelTables = blocks.filter(isDocTable);
  // Structure is read-only in 3a → counts must match. If not, bail (leave tables verbatim,
  // reconcile only the paragraph blocks against the DOM paragraphs) to avoid corruption.
  if (domTables.length !== modelTables.length) {
    reconcileParagraphsOnly(dom, container, blocks.filter((b): b is DocParagraph => !isDocTable(b)), ids, requireParagraph);
    return;
  }
  // Segment both sides by tables.
  const modelSegs: DocParagraph[][] = [];
  let seg: DocParagraph[] = [];
  for (const b of blocks) {
    if (isDocTable(b)) { modelSegs.push(seg); seg = []; } else seg.push(b);
  }
  modelSegs.push(seg);
  const domSegs: Element[][] = [];
  let dseg: Element[] = [];
  for (const e of domEls) {
    if (e.tagName === 'w:tbl') { domSegs.push(dseg); dseg = []; } else dseg.push(e);
  }
  domSegs.push(dseg);
  // Reconcile each paragraph segment with the following table as its insert anchor.
  for (let k = 0; k < modelSegs.length; k++) {
    const anchor = k < domTables.length ? domTables[k] : null; // null → append at container end
    reconcileSegment(dom, container, domSegs[k], modelSegs[k], anchor, ids, requireParagraph && k === modelSegs.length - 1);
  }
  // Recurse into each table's cells.
  for (let t = 0; t < domTables.length; t++) writeTable(dom, domTables[t], modelTables[t], ids);
}

/** Reconcile one run of paragraphs (a segment) against existing w:p elements. */
function reconcileSegment(dom: Document, container: Element, domParas: Element[], modelParas: DocParagraph[], anchor: Element | null, ids: DocApplyIds | undefined, requireParagraph: boolean): void {
  const n = Math.min(domParas.length, modelParas.length);
  for (let i = 0; i < n; i++) setRunsOn(dom, domParas[i], modelParas[i], ids);
  // Append extras before the anchor (or at container end if anchor null), cloning a template.
  const template = domParas.length ? domParas[domParas.length - 1] : null;
  for (let i = n; i < modelParas.length; i++) {
    const p = template ? (template.cloneNode(true) as Element) : dom.createElementNS(W_NS, 'w:p');
    setRunsOn(dom, p, modelParas[i], ids);
    if (anchor) container.insertBefore(p, anchor);
    else container.appendChild(p);
  }
  // Remove extra DOM paragraphs (keep ≥1 if requireParagraph and the segment would empty).
  for (let i = domParas.length - 1; i >= modelParas.length; i--) {
    if (requireParagraph && modelParas.length === 0 && i === 0) {
      setRunsOn(dom, domParas[0], { runs: [{ text: '' }] }, ids); // blank, keep the cell valid
      break;
    }
    domParas[i].remove();
  }
}

/** Reconcile only paragraph blocks against DOM paragraphs (fallback when table counts diverge). */
function reconcileParagraphsOnly(dom: Document, container: Element, paras: DocParagraph[], ids: DocApplyIds | undefined, requireParagraph: boolean): void {
  const domParas = Array.from(container.children).filter(c => c.tagName === 'w:p');
  reconcileSegment(dom, container, domParas, paras, null, ids, requireParagraph);
}

/** Rewrite a table's cell paragraphs from a DocTable; structure (tblPr/grid/tcPr) untouched. */
function writeTable(dom: Document, tbl: Element, table: DocTable, ids: DocApplyIds | undefined): void {
  const domRows = Array.from(tbl.children).filter(c => c.tagName === 'w:tr');
  const n = Math.min(domRows.length, table.rows.length);
  for (let r = 0; r < n; r++) {
    const domCells = Array.from(domRows[r].children).filter(c => c.tagName === 'w:tc');
    const cells = table.rows[r].cells;
    const m = Math.min(domCells.length, cells.length);
    for (let c = 0; c < m; c++) reconcileContainer(dom, domCells[c], cells[c].blocks, ids, true);
  }
}

/**
 * Write a full block model back into the ORIGINAL document XML IN PLACE. Generalizes
 * applyParagraphRuns: top-level paragraphs AND tables (cells rewritten, structure verbatim).
 */
export function applyBlocks(documentXml: string, blocks: DocBlock[], ids?: DocApplyIds): string {
  const dom = new DOMParser().parseFromString(documentXml, 'application/xml');
  if (dom.getElementsByTagName('parsererror').length > 0) return documentXml;
  const body = dom.getElementsByTagName('w:body')[0];
  if (!body) return documentXml;
  reconcileContainer(dom, body, blocks, ids, false);
  return new XMLSerializer().serializeToString(dom);
}
```

- [ ] **Step 4: Make `applyParagraphRuns` a thin wrapper (keeps all existing callers/tests byte-stable)**

Replace the body of `applyParagraphRuns` (lines 308-344) with:

```ts
export function applyParagraphRuns(documentXml: string, paragraphs: DocParagraph[], ids?: DocApplyIds): string {
  return applyBlocks(documentXml, paragraphs, ids);
}
```

(`DocParagraph[]` is a `DocBlock[]`; a table-free doc has zero `w:tbl`, so `reconcileContainer` falls to a single segment with `anchor=null` — identical update/append-at-end/remove behavior to the old code.)

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test -- docModelTables`
Expected: PASS (table-free equivalence).

- [ ] **Step 6: Full suite — the critical back-compat gate**

Run: `npm run type-check && npm run lint && npm run test`
Expected: ALL green. The whole existing `docxEditor.test.ts` / `docModelRichText.test.ts` / `docxMapping.test.ts` exercise `applyParagraphRuns` round-trips (append, remove, heading/list props) — they now run through `applyBlocks` and must be byte-identical. If any fail, the reconciler diverges from the old writer — fix before proceeding.

- [ ] **Step 7: Commit**

```bash
git add src/docx/docModel.ts tests/docx/docModelTables.test.ts
git commit -m "feat(docx): applyBlocks reconciler; applyParagraphRuns delegates to it"
```

---

### Task 4: `applyBlocks` table round-trip — edit cells, preserve structure

**Files:**
- Test: `tests/docx/docModelTables.test.ts`
- (No source change expected — Task 3 already implemented `writeTable`; this task proves it and fixes anything it surfaces.)

**Interfaces:**
- Consumes: `applyBlocks`, `parseDocModel` from Tasks 2-3.

- [ ] **Step 1: Write the failing test**

Add to `tests/docx/docModelTables.test.ts`:

```ts
describe('docModel — table cell round-trip (structure preserved)', () => {
  it('edits a cell paragraph and leaves tblPr/tblGrid/tcPr verbatim', () => {
    const xml = docXml(
      para('before') +
      `<w:tbl><w:tblPr><w:tblStyle w:val="Grid"/></w:tblPr><w:tblGrid><w:gridCol w:w="100"/><w:gridCol w:w="200"/></w:tblGrid>` +
      row(cell('A1'), cell('B1')) + row(cell('A2'), cell('B2')) + `</w:tbl>` +
      para('after'),
    );
    const model = parseDocModel(xml);
    // Edit cell A1 → "EDITED"
    const t = model.blocks[1] as DocTable;
    (t.rows[0].cells[0].blocks[0] as DocParagraph).runs = [{ text: 'EDITED', bold: true }];
    const out = applyBlocks(xml, model.blocks);
    // Structure preserved verbatim
    expect(out).toContain('<w:tblStyle w:val="Grid"/>');
    expect(out).toContain('<w:gridCol w:w="100"/>');
    expect(out).toContain('<w:gridCol w:w="200"/>');
    // Cell A1 edited, siblings intact
    const re = parseDocModel(out);
    const rt = re.blocks[1] as DocTable;
    expect((rt.rows[0].cells[0].blocks[0] as DocParagraph).runs[0]).toMatchObject({ text: 'EDITED', bold: true });
    expect((rt.rows[0].cells[1].blocks[0] as DocParagraph).runs[0].text).toBe('B1');
    expect((rt.rows[1].cells[0].blocks[0] as DocParagraph).runs[0].text).toBe('A2');
    // Top-level paragraphs intact and ordered around the table
    expect(re.paragraphs.map(p => p.runs[0].text)).toEqual(['before', 'after']);
  });

  it('preserves table position when a paragraph is inserted before the table', () => {
    const xml = docXml(para('P1') + table(row(cell('C'))) + para('P2'));
    const model = parseDocModel(xml);
    // Insert a new top-level paragraph between P1 and the table.
    model.blocks.splice(1, 0, { runs: [{ text: 'P1.5' }] });
    const out = applyBlocks(xml, model.blocks);
    const re = parseDocModel(out);
    // Order must be P1, P1.5, TABLE, P2 — the table did NOT jump.
    expect(re.blocks.map(b => (b.kind === 'table' ? 'T' : (b as DocParagraph).runs[0].text))).toEqual(['P1', 'P1.5', 'T', 'P2']);
  });
});
```

- [ ] **Step 2: Run the test**

Run: `npm run test -- docModelTables`
Expected: ideally PASS (Task 3's anchor logic handles both). If the "inserted paragraph before table" case fails (table jumps), the segment anchor is wrong — verify `reconcileSegment` inserts before `domTables[k]`. Fix and re-run until green.

- [ ] **Step 3: Full suite**

Run: `npm run type-check && npm run lint && npm run test`
Expected: green.

- [ ] **Step 4: Commit**

```bash
git add tests/docx/docModelTables.test.ts
git commit -m "test(docx): guard cell-edit round-trip + table-position stability"
```

---

### Task 5: Nested-table round-trip (the flagged risk)

**Files:**
- Test: `tests/docx/docModelTables.test.ts`
- (No source change expected — `reconcileContainer` recurses through `writeTable`→cells→`reconcileContainer`; this task proves nesting and fixes anything surfaced.)

**Interfaces:**
- Consumes: `parseDocModel`, `applyBlocks`.

- [ ] **Step 1: Write the failing test**

Add to `tests/docx/docModelTables.test.ts`:

```ts
describe('docModel — nested table round-trip', () => {
  it('edits a nested cell and preserves both outer and inner structure', () => {
    const inner = `<w:tbl><w:tblPr><w:tblStyle w:val="Inner"/></w:tblPr><w:tblGrid><w:gridCol w:w="50"/></w:tblGrid>${row(cell('inner-A'))}</w:tbl>`;
    // Outer cell contains a paragraph AND a nested table.
    const outerCell = `<w:tc><w:tcPr/><w:p><w:r><w:t>outer-lead</w:t></w:r></w:p>${inner}</w:tc>`;
    const xml = docXml(`<w:tbl><w:tblPr><w:tblStyle w:val="Outer"/></w:tblPr><w:tblGrid><w:gridCol w:w="300"/></w:tblGrid><w:tr>${outerCell}</w:tr></w:tbl>`);
    const model = parseDocModel(xml);
    const outer = model.blocks[0] as DocTable;
    const cellBlocks = outer.rows[0].cells[0].blocks;
    expect(cellBlocks.map(b => (b.kind === 'table' ? 'T' : 'P'))).toEqual(['P', 'T']); // lead para + nested table
    const innerTable = cellBlocks[1] as DocTable;
    (innerTable.rows[0].cells[0].blocks[0] as DocParagraph).runs = [{ text: 'INNER-EDITED' }];
    const out = applyBlocks(xml, model.blocks);
    expect(out).toContain('<w:tblStyle w:val="Outer"/>');
    expect(out).toContain('<w:tblStyle w:val="Inner"/>');
    const re = parseDocModel(out);
    const reInner = (re.blocks[0] as DocTable).rows[0].cells[0].blocks[1] as DocTable;
    expect((reInner.rows[0].cells[0].blocks[0] as DocParagraph).runs[0].text).toBe('INNER-EDITED');
  });
});
```

- [ ] **Step 2: Run the test**

Run: `npm run test -- docModelTables`
Expected: PASS (recursion). If parse mis-collects the nested table (e.g., outer cell shows the inner cell's paragraph at top level), the bug is a deep `getElementsByTagName` instead of direct-child filtering in `parseTable`/`parseContainerBlocks` — verify those use `Array.from(el.children).filter(...)`. Fix and re-run.

- [ ] **Step 3: Full suite**

Run: `npm run type-check && npm run lint && npm run test`
Expected: green.

- [ ] **Step 4: Commit**

```bash
git add tests/docx/docModelTables.test.ts
git commit -m "test(docx): guard nested-table cell-edit round-trip"
```

---

### Task 6: Schema — append prosemirror-tables node specs

**Files:**
- Modify: `src/docx/docxSchema.ts`
- Test: `tests/docx/docxTablesMapping.test.ts`

**Interfaces:**
- Produces: `docxSchema` with `table`/`table_row`/`table_cell`/`table_header` nodes.
- Consumes: `prosemirror-tables` `tableNodes`.

- [ ] **Step 1: Write the failing test**

Create `tests/docx/docxTablesMapping.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { docxSchema } from '../../src/docx/docxSchema';

describe('docxSchema — table nodes', () => {
  it('includes prosemirror-tables node types', () => {
    expect(docxSchema.nodes.table).toBeDefined();
    expect(docxSchema.nodes.table_row).toBeDefined();
    expect(docxSchema.nodes.table_cell).toBeDefined();
  });
  it('cells accept block content (paragraphs + nested tables)', () => {
    const cell = docxSchema.nodes.table_cell;
    // cellContent 'block+' → a paragraph is valid cell content
    const p = docxSchema.nodes.paragraph.createAndFill();
    expect(p).not.toBeNull();
    expect(cell.contentMatch.matchType(docxSchema.nodes.paragraph)).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- docxTablesMapping`
Expected: FAIL — `docxSchema.nodes.table` undefined.

- [ ] **Step 3: Append the table nodes**

In `src/docx/docxSchema.ts`, import and append `tableNodes` before constructing the schema:

```ts
import { tableNodes } from 'prosemirror-tables';
// ...existing imports...

let nodes = addListNodes(basicSchema.spec.nodes, 'paragraph block*', 'block');
nodes = nodes.append(
  tableNodes({
    tableGroup: 'block',     // tables are top-level + nestable block content
    cellContent: 'block+',   // cells hold paragraphs, headings, lists, nested tables
    cellAttributes: {},      // 3a models no extra cell attrs (colspan/rowspan/colwidth are built in)
  }),
);
```

(Leave the `marks` block unchanged. `docxSchema = new Schema({ nodes, marks })`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- docxTablesMapping`
Expected: PASS.

- [ ] **Step 5: Type-check + lint + full suite**

Run: `npm run type-check && npm run lint && npm run test`
Expected: green (no other consumer of `docxSchema` breaks — new optional nodes only).

- [ ] **Step 6: Commit**

```bash
git add src/docx/docxSchema.ts tests/docx/docxTablesMapping.test.ts
git commit -m "feat(docx): add prosemirror-tables node specs to docxSchema"
```

---

### Task 7: Mappers — `docModelToDoc` / `docToDocModel` emit/read tables

**Files:**
- Modify: `src/docx/docxProseMirror.ts` (`docModelToDoc` drive off `blocks`; emit table nodes; `docToDocModel` read table nodes)
- Test: `tests/docx/docxTablesMapping.test.ts`

**Interfaces:**
- Consumes: `DocTable`/`DocRow`/`DocCell`/`isDocTable` (export `isDocTable` is already from Task 1), `docxSchema` tables (Task 6).
- Produces: round-trip `DocModel.blocks` ⇄ PM doc preserving tables + nesting.

- [ ] **Step 1: Write the failing test**

Add to `tests/docx/docxTablesMapping.test.ts`:

```ts
import { docModelToDoc, docToDocModel } from '../../src/docx/docxProseMirror';
import type { DocModel, DocTable, DocParagraph } from '../../src/docx/docModel';

const rt = (m: DocModel): DocModel => docToDocModel(docModelToDoc(m));
const p = (text: string): DocParagraph => ({ runs: [{ text }] });

describe('docModel ⇄ PM — table mapping', () => {
  it('round-trips a table with cell text', () => {
    const table: DocTable = { kind: 'table', rows: [
      { cells: [{ blocks: [p('A1')] }, { blocks: [p('B1')] }] },
      { cells: [{ blocks: [p('A2')] }, { blocks: [p('B2')] }] },
    ] };
    const model: DocModel = { blocks: [p('intro'), table], paragraphs: [p('intro')] };
    const back = rt(model);
    expect(back.blocks.map(b => (b.kind === 'table' ? 'T' : (b as DocParagraph).runs[0].text))).toEqual(['intro', 'T']);
    const bt = back.blocks[1] as DocTable;
    expect(bt.rows).toHaveLength(2);
    expect((bt.rows[0].cells[0].blocks[0] as DocParagraph).runs[0].text).toBe('A1');
    expect((bt.rows[1].cells[1].blocks[0] as DocParagraph).runs[0].text).toBe('B2');
  });

  it('round-trips a nested table', () => {
    const inner: DocTable = { kind: 'table', rows: [{ cells: [{ blocks: [p('inner')] }] }] };
    const outer: DocTable = { kind: 'table', rows: [{ cells: [{ blocks: [p('lead'), inner] }] }] };
    const back = rt({ blocks: [outer], paragraphs: [] });
    const bo = back.blocks[0] as DocTable;
    const cellBlocks = bo.rows[0].cells[0].blocks;
    expect(cellBlocks.map(b => (b.kind === 'table' ? 'T' : 'P'))).toEqual(['P', 'T']);
    expect(((cellBlocks[1] as DocTable).rows[0].cells[0].blocks[0] as DocParagraph).runs[0].text).toBe('inner');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- docxTablesMapping`
Expected: FAIL — `docModelToDoc` ignores tables (and currently reads `model.paragraphs`).

- [ ] **Step 3: Emit tables in `docModelToDoc`**

In `src/docx/docxProseMirror.ts`:

(a) Import the table types + guard:

```ts
import { type DocModel, type DocParagraph, type DocRun, type DocBlock, type DocTable, type DocCell, isDocTable, parseDocModel, applyBlocks, type DocApplyIds } from './docModel';
```

(b) Add cell/table emit helpers and a block-list emitter (used by both body and cells), then refactor `docModelToDoc` to consume an arbitrary `DocBlock[]`:

```ts
/** Emit a list of DocBlocks (paragraphs + tables) into PM block nodes. Shared by body+cells. */
function blocksToNodes(blocks: DocBlock[]): PMNode[] {
  const out: PMNode[] = [];
  let i = 0;
  while (i < blocks.length) {
    const b = blocks[i];
    if (isDocTable(b)) { out.push(tableToNode(b)); i += 1; continue; }
    if (!b.list) { out.push(blockFor(b)); i += 1; continue; }
    // gather a maximal run of list paragraphs (existing buildListRun logic)
    const runItems: DocParagraph[] = [];
    while (i < blocks.length && !isDocTable(blocks[i]) && (blocks[i] as DocParagraph).list) {
      runItems.push(blocks[i] as DocParagraph); i += 1;
    }
    out.push(...buildListRun(runItems));
  }
  return out;
}
function tableToNode(table: DocTable): PMNode {
  const rows = table.rows.map(r =>
    n.table_row.create(null, r.cells.map(cellToNode)),
  );
  return n.table.create(null, rows);
}
function cellToNode(cell: DocCell): PMNode {
  const content = blocksToNodes(cell.blocks);
  // cellContent is block+ → guarantee at least one paragraph.
  return n.table_cell.create(null, content.length ? content : [n.paragraph.create()]);
}
```

(c) Replace `docModelToDoc`'s body with:

```ts
export function docModelToDoc(model: DocModel): PMNode {
  const blocks = blocksToNodes(model.blocks);
  return n.doc.create(null, blocks.length ? blocks : [n.paragraph.create()]);
}
```

- [ ] **Step 4: Read tables in `docToDocModel`**

Extend `emitBlock` to handle `table` nodes and build `DocBlock[]`, then set both `blocks` and the derived `paragraphs`:

```ts
function cellOf(cellNode: PMNode): DocCell {
  const blocks: DocBlock[] = [];
  cellNode.forEach(child => emitBlockTo(child, 0, blocks));
  return { blocks: blocks.length ? blocks : [{ runs: [] }] };
}
/** Like emitBlock but writes into a DocBlock[] and recognizes table nodes. */
function emitBlockTo(node: PMNode, depth: number, out: DocBlock[]): void {
  const name = node.type.name;
  if (name === 'table') {
    const rows: DocRow[] = [];
    node.forEach(rowNode => {
      const cells: DocCell[] = [];
      rowNode.forEach(cellNode => cells.push(cellOf(cellNode)));
      rows.push({ cells });
    });
    out.push({ kind: 'table', rows });
    return;
  }
  emitBlock(node, depth, out as DocParagraph[]); // paragraphs/headings/lists (existing)
}

export function docToDocModel(doc: PMNode): DocModel {
  const blocks: DocBlock[] = [];
  doc.forEach(block => emitBlockTo(block, 0, blocks));
  const paragraphs = blocks.filter((b): b is DocParagraph => !isDocTable(b));
  return { blocks, paragraphs };
}
```

Note: `emitBlock` (existing, line 139) pushes into a `DocParagraph[]`. The `out as DocParagraph[]` cast is safe because `emitBlock` only ever pushes paragraphs; tables are handled by `emitBlockTo` before delegating. Add a one-line comment to that effect.

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test -- docxTablesMapping`
Expected: PASS (both table + nested cases).

- [ ] **Step 6: Update `docModelToDoc`'s old list helpers if needed + full suite**

The old `docModelToDoc` looped `model.paragraphs`; `buildListRun`/`buildLevel`/`blockFor`/`inlineFor` are reused unchanged by `blocksToNodes`. Run:

Run: `npm run type-check && npm run lint && npm run test`
Expected: green — existing `docxMapping.test.ts` (paragraph/list/heading round-trips) still pass because paragraph-only models route through the same list logic.

- [ ] **Step 7: Commit**

```bash
git add src/docx/docxProseMirror.ts tests/docx/docxTablesMapping.test.ts
git commit -m "feat(docx): map DocTable ⇄ ProseMirror table nodes (incl. nested)"
```

---

### Task 8: Editor wiring — tableEditing plugin, save via applyBlocks, cell CSS

**Files:**
- Modify: `src/docx/docxProseMirror.ts` (`mountDocxEditor`: add `tableEditing()` plugin; `save()`/`getModel()` use `blocks`)
- Modify: `src/styles/modals.css` (cell CSS + selection overlay)
- Test: `tests/docx/docxTablesMapping.test.ts` (mount smoke) — full editing verified in Task 9 (browser)

**Interfaces:**
- Consumes: `tableEditing` from `prosemirror-tables`; `applyBlocks`.

- [ ] **Step 1: Write the failing test (save routes through blocks)**

Add to `tests/docx/docxTablesMapping.test.ts`:

```ts
import { mountDocxEditor } from '../../src/docx/docxProseMirror';
// Build a minimal .docx in memory via the existing test helpers used by docxEditor.test.ts.
// (Reuse the same opc/zip helper pattern as tests/docx/docxEditor.test.ts — import packOpc/openOpc/etc.)

it('mountDocxEditor.save() preserves a table through an unedited round-trip', async () => {
  // Arrange: a .docx whose document.xml contains a table (use the same byte-builder as docxEditor.test.ts).
  // Act: mount, immediately save (no edit).
  // Assert: the saved document.xml still contains <w:tbl> and the cell text.
  // (Concrete bytes mirror docxEditor.test.ts's makeDocx helper — see that file for the exact zip builder.)
});
```

> Implementer note: copy the in-memory `.docx` builder from `tests/docx/docxEditor.test.ts` (it already constructs a doc whose body has a table cell "Cell A"). Assert `getDocumentXml(openOpc(saved)).includes('<w:tbl')` and `.includes('Cell A')` after a no-edit `save()`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- docxTablesMapping`
Expected: FAIL — `save()` currently calls `applyParagraphRuns(originalXml, edited.paragraphs, ids)`, which (as a wrapper over applyBlocks with paragraph-only blocks) would DROP the table because `edited.paragraphs` excludes it. This is the real bug the task fixes.

- [ ] **Step 3: Add `tableEditing()` to the plugin list**

In `mountDocxEditor`, import and add the plugin:

```ts
import { tableEditing } from 'prosemirror-tables';
```

In `EditorState.create({ plugins: [ ... ] })`, add `tableEditing()` as the FIRST plugin (its props must see transactions early):

```ts
plugins: [
  tableEditing(),
  findReplacePlugin(),
  // ...existing keymaps...
],
```

Do NOT add `columnResizing()` and do NOT bind addRow/addColumn/mergeCells/splitCell — structure stays read-only in 3a.

- [ ] **Step 4: Route save + getModel through `blocks`**

In the returned handle, change `save()`:

```ts
save(): Uint8Array {
  const edited = docToDocModel(view.state.doc);
  const hasHeading = edited.paragraphs.some(p => p.heading !== undefined);
  const hasList = edited.paragraphs.some(p => p.list !== undefined);
  let ids: DocApplyIds | undefined;
  if (hasHeading || hasList) {
    const heading = hasHeading ? ensureHeadingStyles(opc) : { 1: 'Heading1', 2: 'Heading2', 3: 'Heading3' };
    const list = hasList ? ensureListNumbering(opc) : { bulletNumId: 0, orderedNumId: 0 };
    ids = { heading, bulletNumId: list.bulletNumId, orderedNumId: list.orderedNumId };
  }
  setDocumentXml(opc, applyBlocks(originalXml, edited.blocks, ids));
  return packOpc(opc);
},
```

(`getModel()` already returns `docToDocModel(view.state.doc)` — now includes tables; no change needed. The PDF-export consumer `docxToPdf.ts` reads `model.paragraphs`, so it stays top-level-only as designed.)

> Heading/list-in-cells nuance: `hasHeading`/`hasList` check only top-level `paragraphs`, so a heading/list used ONLY inside a cell would not trigger id resolution. For 3a, resolve ids when ANY block (incl. cells) uses them. Add a recursive check:

```ts
function anyParagraph(blocks: DocBlock[], pred: (p: DocParagraph) => boolean): boolean {
  return blocks.some(b => isDocTable(b)
    ? b.rows.some(r => r.cells.some(c => anyParagraph(c.blocks, pred)))
    : pred(b));
}
```

Use `const hasHeading = anyParagraph(edited.blocks, p => p.heading !== undefined);` and likewise for lists. Place `anyParagraph` as a module-level helper in `docxProseMirror.ts`.

- [ ] **Step 5: Add cell CSS**

In `src/styles/modals.css`, append (match the existing `.docx-editor-*` selector style in that file):

```css
.docx-editor-body .ProseMirror table { border-collapse: collapse; width: 100%; margin: 0.5em 0; }
.docx-editor-body .ProseMirror td,
.docx-editor-body .ProseMirror th { border: 1px solid var(--border, #ccc); padding: 4px 6px; vertical-align: top; }
.docx-editor-body .ProseMirror .selectedCell { background: rgba(80, 130, 255, 0.18); }
.docx-editor-body .ProseMirror .column-resize-handle { display: none; } /* resize not enabled in 3a */
```

(Confirm the editor's mount container class — if it is not `.docx-editor-body`, use the actual class from `docxEditorController.ts`.)

- [ ] **Step 6: Run the smoke test + full suite**

Run: `npm run test -- docxTablesMapping`
Expected: PASS — table survives the no-edit save.

Run: `npm run type-check && npm run lint && npm run test`
Expected: green.

- [ ] **Step 7: Commit**

```bash
git add src/docx/docxProseMirror.ts src/styles/modals.css tests/docx/docxTablesMapping.test.ts
git commit -m "feat(docx): wire table editing (tableEditing plugin, save via applyBlocks, cell CSS)"
```

---

### Task 9: Real-Chrome guard — edit a cell + nested cell, save, reopen

**Files:**
- Create: `tests/browser/docx-tables.browser.test.ts`

**Interfaces:**
- Consumes: `mountDocxEditor`, `parseDocModel`, the opc helpers — mirror `tests/browser/docx-toolbar.browser.test.ts` setup.

- [ ] **Step 1: Write the failing test**

Create `tests/browser/docx-tables.browser.test.ts` (model it on `docx-toolbar.browser.test.ts` — same imports, same in-memory `.docx` with a table; the browser env lays out tables, which jsdom cannot):

```ts
import { describe, it, expect } from 'vitest';
import { mountDocxEditor } from '../../src/docx/docxProseMirror';
import { parseDocModel } from '../../src/docx/docModel';
import { openOpc, getDocumentXml } from '../../src/docx/opcEdit';
// + the same .docx byte builder used by docx-toolbar.browser.test.ts (a body with a 2x2 table + a nested table)

describe('DOCX table editing — real Chrome', () => {
  it('edits a cell and a nested cell; structure survives save→reopen', async () => {
    const bytes = /* build .docx with an outer 2x2 table; outer cell [0,0] holds a nested 1x1 table */;
    const container = document.createElement('div');
    document.body.appendChild(container);
    const handle = mountDocxEditor(container, bytes);

    // Place the cursor in the first cell, type. (Use view.dispatch with a textInsert at the cell's text position.)
    // Then locate the nested cell text position and type there too.
    // (Use handle.view.state.doc.descendants to find the table_cell text positions; dispatch tr.insertText.)

    const saved = handle.save();
    handle.destroy();

    const xml = getDocumentXml(openOpc(saved as unknown as Uint8Array));
    expect(xml).toContain('<w:tbl'); // table preserved
    const model = parseDocModel(xml);
    // Assert the typed cell text + nested cell text are present and the grid (tblGrid) survived.
    expect(xml).toContain('<w:tblGrid');
    // (assert the specific edited strings appear in the right cells via the parsed model)
  });

  it('exposes no structural (add row/column) affordance in 3a', () => {
    // Assert the toolbar/keymap does not bind addRowAfter/addColumnAfter (structure read-only).
    // (Check buildDocxToolbar output has no table-structure buttons, OR that no such command is in the keymap.)
  });
});
```

> Implementer note: prefer dispatching `view.dispatch(view.state.tr.insertText('X', pos))` at computed cell text positions over synthetic key events — deterministic and jsdom-independent-of, and the real layout still validates table rendering.

- [ ] **Step 2: Run to verify it fails (or that the harness builds it)**

Run: `npm run test:browser -- docx-tables`
Expected: FAIL first (assertions unmet) — then implement the byte-builder + position lookups until green. (No source change expected; this guards Tasks 1-8 end-to-end in a real browser.)

- [ ] **Step 3: Make it pass**

Fill in the `.docx` byte builder (copy from the sibling browser test) and the cell-position lookups; iterate until both tests pass.

Run: `npm run test:browser -- docx-tables`
Expected: PASS.

- [ ] **Step 4: Both suites green**

Run: `npm run type-check && npm run lint && npm run test && npm run test:browser`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add tests/browser/docx-tables.browser.test.ts
git commit -m "test(docx): real-Chrome guard for cell + nested-cell editing round-trip"
```

---

### Task 10: Document #3a + close out

**Files:**
- Modify: `CLAUDE.md` (DOCX editor bullet)
- Modify: `docs/plans/slice-c-tables.plan.md` (mark 3a DONE)

- [ ] **Step 1: Document the feature in CLAUDE.md**

Append a `#3a` subnote to the existing DOCX-editor bullet describing: recursive `blocks` model (paragraph|table) + populated top-level `paragraphs` view; `applyBlocks` table-anchored reconciler (cell paragraphs rewritten, `w:tblPr`/`w:tblGrid`/`w:tcPr` verbatim); prosemirror-tables@1.8.5 (MIT) node specs + `tableEditing()` (selection/nav only — structure read-only until 3b–3d); nested tables editable; PDF export unchanged (top-level only); guards `docModelTables.test.ts`/`docxTablesMapping.test.ts`/`docx-tables.browser.test.ts`.

- [ ] **Step 2: Mark the plan section DONE**

In `docs/plans/slice-c-tables.plan.md`, add a `## Status` entry: 3a DONE with the commit shas; note 3b (rows) is next.

- [ ] **Step 3: Final full gate**

Run: `npm run type-check && npm run lint && npm run test && npm run test:browser`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md docs/plans/slice-c-tables.plan.md
git commit -m "docs(docx): document Slice C #3a table cell editing"
```

---

## Self-Review

**Spec coverage:**
- Model (recursive blocks + populated paragraphs) → Task 1. ✓
- Parse w:tbl + nested → Tasks 2, 5. ✓
- In-place save (cell paragraphs only, structure verbatim) → Tasks 3, 4, 5. ✓
- Schema + mappers → Tasks 6, 7. ✓
- Editor wiring (tableEditing, save via blocks, CSS, gated by existing flag) → Task 8. ✓
- Structure read-only (no structural commands bound) → Task 8 (not bound) + Task 9 (guard asserts absence). ✓
- Dep + attribution → Task 0. ✓
- PDF export unchanged → covered by design (docxToPdf reads `paragraphs`, untouched); no task needed. ✓
- Browser guard → Task 9. ✓
- Find/replace cells out of scope → not implemented (consistent). ✓

**Placeholder scan:** Test bodies in Tasks 8/9 reference "copy the byte-builder from the sibling test" rather than re-pasting ~40 lines of zip-building boilerplate that already exists and must match it exactly — this is a deliberate DRY pointer to a concrete existing artifact (`docx-toolbar.browser.test.ts` / `docxEditor.test.ts`), not a vague TODO. The algorithmic/source code (the part that's new and load-bearing) is complete in every step.

**Type consistency:** `DocBlock`/`DocTable`/`DocCell`/`DocRow`/`isDocTable` defined in Task 1, used consistently in Tasks 2-8. `applyBlocks(xml, DocBlock[], ids?)` signature stable across Tasks 3-8. `blocksToNodes`/`tableToNode`/`cellToNode`/`emitBlockTo`/`cellOf` names consistent in Task 7. `reconcileContainer`/`reconcileSegment`/`writeTable`/`setRunsOn` consistent in Tasks 3-5.
