/**
 * docModel — a small editable model over a .docx main document part.
 *
 * Scope (Phase 1 #1b/#1c): the TOP-LEVEL paragraphs of `w:body` only — runs with
 * bold/italic. Anything else (tables `w:tbl`, section props, styles, …) is NOT
 * modeled and therefore passes through verbatim on save (the #1a guarantee). The
 * editor saves via applyParagraphRuns (per-run bold/italic preserved); the older
 * text-level applyParagraphTexts is retained for callers that only carry plain text.
 */

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

export interface DocRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  /** Run font family (w:rFonts@w:ascii). */
  fontFamily?: string;
  /** Run font size in POINTS (w:sz is half-points: written as pt*2). */
  fontSize?: number;
  /** Run color as a #rrggbb hex string (w:color@w:val, which stores RRGGBB without '#'). */
  color?: string;
  /** External hyperlink target (http/https/mailto). Maps to the PM `link` mark; on save,
   * consecutive runs sharing a linkUrl are wrapped in one `w:hyperlink` (C3). */
  linkUrl?: string;
}
export interface DocParagraph {
  /** Discriminates DocBlock; optional (absent ⇒ paragraph) to keep existing literals valid. */
  kind?: 'paragraph';
  runs: DocRun[];
  /** Heading level 1–3 (w:pStyle = HeadingN); undefined = body paragraph. */
  heading?: 1 | 2 | 3;
  /** List membership (w:numPr): ordered=decimal vs bullet; level = w:ilvl. */
  list?: { ordered: boolean; level: number };
}
export interface DocCell {
  blocks: DocBlock[];                                   // recursive → nested tables
  /** Horizontal merge span (OOXML w:gridSpan ↔ PM colspan). Absent/1 = no h-merge. */
  colspan?: number;
  /** Vertical merge span (OOXML w:vMerge restart run ↔ PM rowspan). Absent/1 = no v-merge. */
  rowspan?: number;
}
export interface DocRow { cells: DocCell[]; }
export interface DocTable { kind: 'table'; rows: DocRow[]; }
/**
 * An OPAQUE anchor block (third DocBlock variant, sibling of DocTable): a top-level
 * `w:p` that contains a `w:drawing` or a `w:hyperlink`. It carries ONLY display data
 * (image bytes / link text); the source `w:p` is preserved verbatim by the reconciler's
 * DOM-structural anchor skip — so the model and DOM cannot drift into data loss.
 */
export interface DocImageBlock {
  kind: 'image';
  image?: { dataB64: string; mime: 'image/png' | 'image/jpeg'; widthPt: number; heightPt: number };
  linkText?: string;
  /** 0-based index among TOP-LEVEL drawing anchors (w:p with w:drawing), in document order.
   * Stamped at parse; absent for hyperlink anchors and cell-nested anchors. C2 image-edit identity. */
  anchorId?: number;
}
export type DocBlock = DocParagraph | DocTable | DocImageBlock;
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

/** Narrow a DocBlock to DocImageBlock (opaque image/hyperlink anchor). */
export function isDocImageBlock(b: DocBlock): b is DocImageBlock {
  return (b as DocImageBlock).kind === 'image';
}

/** Resolved style/numbering ids for writing paragraph-level props (from opcParts). */
export interface DocApplyIds {
  heading: { 1: string; 2: string; 3: string };
  bulletNumId: number;
  orderedNumId: number;
  /** url → rId for external hyperlinks (C3): consecutive runs sharing a linkUrl are wrapped
   * in a `w:hyperlink r:id`. Resolved (reuse-or-create) by the caller via opcParts. */
  links?: Map<string, string>;
}

/** numId → list format, used to resolve a paragraph's `ordered` on read. */
export type NumberingMap = Map<number, 'bullet' | 'decimal' | 'other'>;

/** Run-property (CT_RPr / EG_RPrBase) child order per ECMA-376 — used to keep
 * rebuilt `w:rPr` spec-valid. Unknown tags sort after all known ones (stable). */
const RPR_ORDER = [
  'w:rStyle', 'w:rFonts', 'w:b', 'w:bCs', 'w:i', 'w:iCs', 'w:caps', 'w:smallCaps',
  'w:strike', 'w:dstrike', 'w:outline', 'w:shadow', 'w:emboss', 'w:imprint',
  'w:noProof', 'w:snapToGrid', 'w:vanish', 'w:webHidden', 'w:color', 'w:spacing',
  'w:w', 'w:kern', 'w:position', 'w:sz', 'w:szCs', 'w:highlight', 'w:u', 'w:effect',
  'w:bdr', 'w:shd', 'w:fitText', 'w:vertAlign', 'w:rtl', 'w:cs', 'w:em', 'w:lang',
  'w:eastAsianLayout', 'w:specVanish', 'w:oMath',
];
function rPrOrderIndex(tag: string): number {
  const i = RPR_ORDER.indexOf(tag);
  return i < 0 ? RPR_ORDER.length : i;
}
/** Reorder a `w:rPr`'s children into canonical CT_RPr order (stable). */
function sortRPrChildren(rPr: Element): void {
  const kids = Array.from(rPr.children);
  kids
    .map((el, idx) => ({ el, idx, ord: rPrOrderIndex(el.tagName) }))
    .sort((a, b) => a.ord - b.ord || a.idx - b.idx)
    .forEach(({ el }) => rPr.appendChild(el)); // appendChild moves it to the end → final order
}

/** Direct-child `w:p` elements of `w:body` (NOT paragraphs nested inside tables). */
function topLevelParagraphs(dom: Document): Element[] {
  const body = dom.getElementsByTagName('w:body')[0];
  if (!body) return [];
  return Array.from(body.children).filter(el => el.tagName === 'w:p');
}

/** Direct child of `el` with the given tag (not a deep descendant). */
function childEl(el: Element | undefined, tag: string): Element | undefined {
  if (!el) return undefined;
  for (let i = 0; i < el.children.length; i++) if (el.children[i].tagName === tag) return el.children[i];
  return undefined;
}
const OFF_VALS = new Set(['false', '0', 'none', 'off']);
/** A boolean toggle child (w:b/w:i/w:u): on unless explicitly w:val="false|0|none|off". */
function toggleOn(rPr: Element | undefined, tag: string): boolean {
  const el = childEl(rPr, tag);
  if (!el) return false;
  const v = el.getAttribute('w:val');
  return v === null || !OFF_VALS.has(v.toLowerCase());
}

/** Parse a single `w:r` element into a DocRun (or null when it has no text), optionally
 * tagging it with an external hyperlink target. */
function parseRunEl(r: Element, linkUrl?: string): DocRun | null {
  const ts = r.getElementsByTagName('w:t');
  let text = '';
  for (let j = 0; j < ts.length; j++) text += ts[j].textContent ?? '';
  if (!text) return null;
  const rPr = childEl(r, 'w:rPr');
  const fonts = childEl(rPr, 'w:rFonts');
  const sz = childEl(rPr, 'w:sz');
  const szVal = sz ? Number(sz.getAttribute('w:val')) : NaN;
  const family = fonts?.getAttribute('w:ascii') ?? fonts?.getAttribute('w:hAnsi') ?? undefined;
  const colorVal = childEl(rPr, 'w:color')?.getAttribute('w:val') ?? '';
  const color = /^[0-9a-f]{6}$/i.test(colorVal) ? `#${colorVal.toLowerCase()}` : undefined;
  return {
    text,
    bold: toggleOn(rPr, 'w:b') || undefined,
    italic: toggleOn(rPr, 'w:i') || undefined,
    underline: toggleOn(rPr, 'w:u') || undefined,
    fontFamily: family || undefined,
    fontSize: Number.isFinite(szVal) && szVal > 0 ? szVal / 2 : undefined,
    color,
    linkUrl: linkUrl || undefined,
  };
}

/** The `r:id` of a `w:hyperlink` (external relationship), or null for an internal-anchor link. */
function hyperlinkRelId(hl: Element): string | null {
  return hl.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id')
    ?? hl.getAttribute('r:id');
}

/** Parse one `w:p` element into a DocParagraph (runs + heading/list). Walks DIRECT children in
 * order so an external `w:hyperlink`'s runs are read ONCE and tagged with the resolved URL. */
function parseParagraph(p: Element, numberingMap?: NumberingMap, linkMap?: Map<string, string>): DocParagraph {
  const runs: DocRun[] = [];
  for (const child of Array.from(p.children)) {
    if (child.tagName === 'w:r') {
      const run = parseRunEl(child);
      if (run) runs.push(run);
    } else if (child.tagName === 'w:hyperlink') {
      const url = (() => { const id = hyperlinkRelId(child); return id ? linkMap?.get(id) : undefined; })();
      for (const r of Array.from(child.children)) {
        if (r.tagName !== 'w:r') continue;
        const run = parseRunEl(r, url);
        if (run) runs.push(run);
      }
    }
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

/** A `w:hyperlink` that is an INTERNAL anchor only (a `w:anchor` bookmark/GoTo target with
 * NO external `r:id`). These cannot round-trip as a URL link, so they stay opaque (C3 ceiling). */
export function isInternalOnlyHyperlink(hl: Element): boolean {
  return !hyperlinkRelId(hl) && hl.getAttribute('w:anchor') !== null;
}

/**
 * A `w:p` is an OPAQUE ANCHOR (preserved verbatim, never reconciled) iff it deeply contains a
 * `w:drawing` (inline OR floating) OR a `w:hyperlink` that is internal-anchor-only. EXTERNAL
 * hyperlinks (with an `r:id`) are NOT opaque (C3): they parse into editable linkUrl runs.
 * Detection is purely structural so it holds in both the parse and reconcile passes.
 */
export function isAnchorParagraphEl(p: Element): boolean {
  if (p.getElementsByTagName('w:drawing').length > 0) return true;
  const hls = p.getElementsByTagName('w:hyperlink');
  for (let i = 0; i < hls.length; i++) if (isInternalOnlyHyperlink(hls[i])) return true;
  return false;
}

/** Build the display-only DocImageBlock for an anchor `w:p` (image bytes are merged later
 * by the caller via the extractDocImages channel; hyperlink text is read here directly). */
function parseAnchorBlock(p: Element): DocImageBlock {
  const block: DocImageBlock = { kind: 'image' };
  if (p.getElementsByTagName('w:drawing').length === 0) {
    const hls = p.getElementsByTagName('w:hyperlink');
    if (hls.length > 0) {
      let text = '';
      const ts = hls[0].getElementsByTagName('w:t');
      for (let i = 0; i < ts.length; i++) text += ts[i].textContent ?? '';
      block.linkText = text;
    }
  }
  return block;
}

/** Parse the ordered w:p / w:tbl children of a container (body or cell) into DocBlocks.
 * `stampAnchorIds` (body level only) numbers top-level drawing anchors so the C2 save pre-pass can
 * map an edited image block back to its source w:p; cell parsing leaves it false (cell images opaque). */
function parseContainerBlocks(container: Element, numberingMap?: NumberingMap, linkMap?: Map<string, string>, stampAnchorIds = false): DocBlock[] {
  const out: DocBlock[] = [];
  let drawingCount = 0;
  for (const el of Array.from(container.children)) {
    if (el.tagName === 'w:p') {
      if (isAnchorParagraphEl(el)) {
        const blk = parseAnchorBlock(el);
        if (stampAnchorIds && el.getElementsByTagName('w:drawing').length > 0) blk.anchorId = drawingCount++;
        out.push(blk);
      } else out.push(parseParagraph(el, numberingMap, linkMap));
    } else if (el.tagName === 'w:tbl') out.push(parseTable(el, numberingMap, linkMap));
  }
  return out;
}
/** The w:gridSpan value of a w:tc (horizontal span), default 1. */
function cellGridSpan(tc: Element): number {
  const v = Number(childEl(childEl(tc, 'w:tcPr'), 'w:gridSpan')?.getAttribute('w:val') ?? '1');
  return Number.isFinite(v) && v > 1 ? v : 1;
}
/** The w:vMerge state of a w:tc: 'restart' (top of a v-merge), 'continue' (placeholder), or null. */
function cellVMerge(tc: Element): 'restart' | 'continue' | null {
  const el = childEl(childEl(tc, 'w:tcPr'), 'w:vMerge');
  if (!el) return null;
  return el.getAttribute('w:val') === 'restart' ? 'restart' : 'continue';
}

/**
 * Parse a w:tbl into a DocTable in the PM shape: w:gridSpan → DocCell.colspan,
 * a w:vMerge restart+continue run → rowspan on the restart cell with the continuation
 * placeholders DROPPED (covered grid positions are simply absent, matching
 * prosemirror-tables). Cells tile the grid left-to-right; colCursor sums gridSpans so a
 * 'continue' is matched to the restart open at the same start column.
 */
function parseTable(tbl: Element, numberingMap?: NumberingMap, linkMap?: Map<string, string>): DocTable {
  const rows: DocRow[] = [];
  const openRestart = new Map<number, DocCell>(); // startCol → the restart cell to grow
  for (const tr of Array.from(tbl.children).filter(c => c.tagName === 'w:tr')) {
    const cells: DocCell[] = [];
    let colCursor = 0;
    for (const tc of Array.from(tr.children).filter(c => c.tagName === 'w:tc')) {
      const span = cellGridSpan(tc);
      const vm = cellVMerge(tc);
      const startCol = colCursor;
      if (vm === 'continue' && openRestart.has(startCol)) {
        const rc = openRestart.get(startCol);
        if (rc) rc.rowspan = (rc.rowspan ?? 1) + 1; // absorb the placeholder → grow the restart
      } else {
        const cell: DocCell = { blocks: parseContainerBlocks(tc, numberingMap, linkMap) };
        if (span > 1) cell.colspan = span;
        if (vm === 'restart') { cell.rowspan = 1; openRestart.set(startCol, cell); }
        else openRestart.delete(startCol); // a normal cell here ends any open v-merge
        cells.push(cell);
      }
      colCursor += span;
    }
    rows.push({ cells });
  }
  return { kind: 'table', rows };
}

/** Parse the main document XML into the editable top-level-paragraph model.
 * `numberingMap` (numId→format) resolves each list paragraph's `ordered`;
 * `linkMap` (rId→external Target) resolves each external hyperlink's `linkUrl`. */
export function parseDocModel(documentXml: string, numberingMap?: NumberingMap, linkMap?: Map<string, string>): DocModel {
  const dom = new DOMParser().parseFromString(documentXml, 'application/xml');
  if (dom.getElementsByTagName('parsererror').length > 0) throw new Error('document.xml not well-formed');
  const body = dom.getElementsByTagName('w:body')[0];
  const blocks: DocBlock[] = body ? parseContainerBlocks(body, numberingMap, linkMap, true) : [];
  const paragraphs = blocks.filter((b): b is DocParagraph => !isDocTable(b) && !isDocImageBlock(b));
  return { blocks, paragraphs };
}

/** Concatenated text of a paragraph (helper for callers). */
export function paragraphText(p: DocParagraph): string {
  return p.runs.map(r => r.text).join('');
}

/**
 * Write edited paragraph texts back into the ORIGINAL document XML IN PLACE.
 * Pass-through everything else (tables, styles). #1b is text-level: each top-level
 * paragraph's text replaces its first run's `w:t` (preserving that run's `w:rPr`
 * formatting), and trailing runs are dropped; extra paragraphs are appended by
 * cloning the last paragraph as a template; removed paragraphs are deleted.
 * Text-level only — for per-run bold/italic preservation use applyParagraphRuns (#1c).
 */
export function applyParagraphTexts(documentXml: string, texts: string[]): string {
  const dom = new DOMParser().parseFromString(documentXml, 'application/xml');
  if (dom.getElementsByTagName('parsererror').length > 0) return documentXml;
  const body = dom.getElementsByTagName('w:body')[0];
  if (!body) return documentXml;
  let ps = topLevelParagraphs(dom);
  if (ps.length === 0) return documentXml;

  const setText = (p: Element, text: string): void => {
    const runs = Array.from(p.children).filter(c => c.tagName === 'w:r');
    if (runs.length === 0) return;
    // Keep the first run (and its rPr); set its text; drop the rest.
    for (let k = runs.length - 1; k >= 1; k--) runs[k].remove();
    const first = runs[0];
    let t = Array.from(first.children).find(c => c.tagName === 'w:t');
    if (!t) {
      t = dom.createElementNS(W_NS, 'w:t');
      first.appendChild(t);
    }
    // Preserve significant whitespace.
    t.setAttribute('xml:space', 'preserve');
    t.textContent = text;
  };

  // Update / append.
  const template = ps[ps.length - 1];
  for (let i = 0; i < texts.length; i++) {
    if (i < ps.length) {
      setText(ps[i], texts[i]);
    } else {
      const clone = template.cloneNode(true) as Element;
      setText(clone, texts[i]);
      body.appendChild(clone);
    }
  }
  // Remove paragraphs beyond the new count.
  ps = topLevelParagraphs(dom);
  for (let i = ps.length - 1; i >= texts.length; i--) ps[i].remove();

  return new XMLSerializer().serializeToString(dom);
}

/** Tags managed by the model run — stripped before re-adding so we never duplicate. */
const MANAGED_RPR = new Set(['w:b', 'w:i', 'w:u', 'w:rFonts', 'w:sz', 'w:szCs', 'w:color']);

/**
 * Build a `w:r` for one model run: clone the paragraph's BASE `w:rPr` (so unmodeled
 * properties — color, spacing, … — survive), strip the model-managed toggles, then
 * set bold/italic/underline/font/size per the model run, re-sorted into canonical
 * CT_RPr order. The `w:rPr` is attached only when non-empty.
 */
function buildRun(dom: Document, baseRPr: Element | undefined, run: DocRun): Element {
  const r = dom.createElementNS(W_NS, 'w:r');
  const rPr = baseRPr ? (baseRPr.cloneNode(true) as Element) : dom.createElementNS(W_NS, 'w:rPr');
  Array.from(rPr.children)
    .filter(c => MANAGED_RPR.has(c.tagName))
    .forEach(c => c.remove());
  if (run.fontFamily) {
    const f = dom.createElementNS(W_NS, 'w:rFonts');
    f.setAttribute('w:ascii', run.fontFamily);
    f.setAttribute('w:hAnsi', run.fontFamily);
    f.setAttribute('w:cs', run.fontFamily);
    rPr.appendChild(f);
  }
  if (run.bold) rPr.appendChild(dom.createElementNS(W_NS, 'w:b'));
  if (run.italic) rPr.appendChild(dom.createElementNS(W_NS, 'w:i'));
  if (run.color) {
    const hex = /^#?([0-9a-f]{6})$/i.exec(run.color.trim());
    if (hex) {
      const col = dom.createElementNS(W_NS, 'w:color');
      col.setAttribute('w:val', hex[1].toLowerCase());
      rPr.appendChild(col);
    }
  }
  if (run.underline) {
    const u = dom.createElementNS(W_NS, 'w:u');
    u.setAttribute('w:val', 'single');
    rPr.appendChild(u);
  }
  if (run.fontSize && run.fontSize > 0) {
    const hp = String(Math.round(run.fontSize * 2)); // points → half-points
    const sz = dom.createElementNS(W_NS, 'w:sz');
    sz.setAttribute('w:val', hp);
    const szCs = dom.createElementNS(W_NS, 'w:szCs');
    szCs.setAttribute('w:val', hp);
    rPr.appendChild(sz);
    rPr.appendChild(szCs);
  }
  if (rPr.children.length > 0) {
    sortRPrChildren(rPr);
    r.appendChild(rPr);
  }
  const t = dom.createElementNS(W_NS, 'w:t');
  t.setAttribute('xml:space', 'preserve');
  t.textContent = run.text;
  r.appendChild(t);
  return r;
}

/** Get the paragraph's `w:pPr`, creating it as the FIRST child of `w:p` if absent
 * (pPr must precede runs per CT_P). */
function ensurePPr(dom: Document, p: Element): Element {
  const existing = childEl(p, 'w:pPr');
  if (existing) return existing;
  const pPr = dom.createElementNS(W_NS, 'w:pPr');
  p.insertBefore(pPr, p.firstChild);
  return pPr;
}

/** Apply the paragraph-level model props (heading pStyle + list numPr) to `w:pPr`.
 * Only the props we manage are added/removed; a foreign existing pStyle is left
 * intact when `heading` is undefined. */
function applyParagraphProps(dom: Document, p: Element, para: DocParagraph, ids: DocApplyIds): void {
  const needPPr = para.heading !== undefined || para.list !== undefined;
  const pPr = childEl(p, 'w:pPr') ?? (needPPr ? ensurePPr(dom, p) : undefined);
  if (!pPr) return;

  // Heading → w:pStyle. Remove a managed HeadingN pStyle when heading is cleared;
  // leave a foreign (non-heading) pStyle untouched.
  const existingStyle = childEl(pPr, 'w:pStyle');
  if (para.heading !== undefined) {
    const styleId = ids.heading[para.heading];
    if (existingStyle) existingStyle.setAttribute('w:val', styleId);
    else {
      const s = dom.createElementNS(W_NS, 'w:pStyle');
      s.setAttribute('w:val', styleId);
      pPr.insertBefore(s, pPr.firstChild); // pStyle is first in CT_PPr
    }
  } else if (existingStyle) {
    const v = existingStyle.getAttribute('w:val') ?? '';
    if (/heading/i.test(v) || Object.values(ids.heading).includes(v)) existingStyle.remove();
  }

  // List → w:numPr. Replace/add when listed; remove our numPr when cleared.
  const existingNum = childEl(pPr, 'w:numPr');
  if (para.list) {
    if (existingNum) existingNum.remove();
    const numPr = dom.createElementNS(W_NS, 'w:numPr');
    const ilvl = dom.createElementNS(W_NS, 'w:ilvl');
    ilvl.setAttribute('w:val', String(Math.max(0, para.list.level)));
    const numId = dom.createElementNS(W_NS, 'w:numId');
    numId.setAttribute('w:val', String(para.list.ordered ? ids.orderedNumId : ids.bulletNumId));
    numPr.appendChild(ilvl);
    numPr.appendChild(numId);
    // numPr follows pStyle in CT_PPr; insert after an existing pStyle, else at start.
    const after = childEl(pPr, 'w:pStyle');
    if (after && after.nextSibling) pPr.insertBefore(numPr, after.nextSibling);
    else if (after) pPr.appendChild(numPr);
    else pPr.insertBefore(numPr, pPr.firstChild);
  } else if (existingNum) {
    existingNum.remove();
  }
}

/** The first `w:r` directly under `p` OR inside a direct-child `w:hyperlink` (for the base rPr). */
function firstRunEl(p: Element): Element | undefined {
  for (const c of Array.from(p.children)) {
    if (c.tagName === 'w:r') return c;
    if (c.tagName === 'w:hyperlink') {
      const r = Array.from(c.children).find(x => x.tagName === 'w:r');
      if (r) return r;
    }
  }
  return undefined;
}

/** Rewrite a w:p element's runs from a DocParagraph in place (rPr base reused; props via ids).
 * Removes existing direct-child `w:r` AND `w:hyperlink` (we rebuild the run sequence, re-emitting
 * external hyperlinks from run linkUrls — so a previously-linked paragraph never duplicates). */
function setRunsOn(dom: Document, p: Element, para: DocParagraph, ids?: DocApplyIds): void {
  const existing = Array.from(p.children).filter(c => c.tagName === 'w:r' || c.tagName === 'w:hyperlink');
  const firstRun = firstRunEl(p);
  const baseRPr = firstRun
    ? (Array.from(firstRun.children).find(c => c.tagName === 'w:rPr') as Element | undefined)
    : undefined;
  for (const e of existing) e.remove();
  if (ids) applyParagraphProps(dom, p, para, ids);
  const runs = para.runs.length ? para.runs : [{ text: '' }];
  // Re-emit, grouping maximal consecutive runs that share an external linkUrl (with a resolved
  // rId) into one `w:hyperlink`. Runs with no linkUrl (or no resolved rId) append directly.
  let i = 0;
  while (i < runs.length) {
    const url = runs[i].linkUrl;
    const rId = url ? ids?.links?.get(url) : undefined;
    if (url && rId) {
      const hl = dom.createElementNS(W_NS, 'w:hyperlink');
      hl.setAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'r:id', rId);
      let j = i;
      while (j < runs.length && runs[j].linkUrl === url) { hl.appendChild(buildRun(dom, baseRPr, runs[j])); j += 1; }
      p.appendChild(hl);
      i = j;
    } else {
      p.appendChild(buildRun(dom, baseRPr, runs[i]));
      i += 1;
    }
  }
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
  // Opaque boundaries = tables AND anchor paragraphs (drawing/hyperlink). They delimit the
  // editable paragraph segments and are NEVER reconciled — tables recurse into cells; image/
  // hyperlink anchors are left byte-exact (the preservation fix). Detection is DOM-structural.
  const isBoundaryEl = (e: Element): boolean => e.tagName === 'w:tbl' || (e.tagName === 'w:p' && isAnchorParagraphEl(e));
  const isBoundaryBlk = (b: DocBlock): boolean => isDocTable(b) || isDocImageBlock(b);
  const domBoundaries = domEls.filter(isBoundaryEl);
  const modelBoundaries = blocks.filter(isBoundaryBlk);
  // Boundary counts must line up 1:1. If not, bail (leave every boundary verbatim, reconcile
  // only the plain paragraph blocks against the non-anchor DOM paragraphs) to avoid corruption.
  if (domBoundaries.length !== modelBoundaries.length) {
    reconcileParagraphsOnly(dom, container, blocks.filter((b): b is DocParagraph => !isBoundaryBlk(b)), ids, requireParagraph);
    return;
  }
  // Segment both sides by boundaries.
  const modelSegs: DocParagraph[][] = [];
  let seg: DocParagraph[] = [];
  for (const b of blocks) {
    if (isBoundaryBlk(b)) { modelSegs.push(seg); seg = []; } else seg.push(b as DocParagraph);
  }
  modelSegs.push(seg);
  const domSegs: Element[][] = [];
  let dseg: Element[] = [];
  for (const e of domEls) {
    if (isBoundaryEl(e)) { domSegs.push(dseg); dseg = []; } else dseg.push(e);
  }
  domSegs.push(dseg);
  // Reconcile each paragraph segment with the following boundary as its insert anchor.
  for (let k = 0; k < modelSegs.length; k++) {
    const anchor = k < domBoundaries.length ? domBoundaries[k] : null; // null → append at container end
    reconcileSegment(dom, container, domSegs[k], modelSegs[k], anchor, ids, requireParagraph && k === modelSegs.length - 1);
  }
  // Recurse into TABLE boundaries only; opaque image/hyperlink anchors are skipped (verbatim).
  // Guard on both sides so a type divergence leaves the DOM element untouched rather than corrupt.
  for (let t = 0; t < domBoundaries.length; t++) {
    const e = domBoundaries[t];
    const mb = modelBoundaries[t];
    if (e.tagName === 'w:tbl' && isDocTable(mb)) writeTable(dom, e, mb, ids);
  }
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

/** Reconcile only paragraph blocks against DOM paragraphs (fallback when boundary counts
 * diverge). Anchor paragraphs (drawing/hyperlink) are EXCLUDED so they are never reconciled —
 * the robustness invariant: an anchor `w:p` is skipped in every path, never reaching setRunsOn. */
function reconcileParagraphsOnly(dom: Document, container: Element, paras: DocParagraph[], ids: DocApplyIds | undefined, requireParagraph: boolean): void {
  const domParas = Array.from(container.children).filter(c => c.tagName === 'w:p' && !isAnchorParagraphEl(c));
  reconcileSegment(dom, container, domParas, paras, null, ids, requireParagraph);
}

/** Any cell with a horizontal (colspan>1) or vertical (rowspan>1) span. */
function hasAnyMerge(rows: DocRow[]): boolean {
  return rows.some(r => r.cells.some(c => (c.colspan ?? 1) > 1 || (c.rowspan ?? 1) > 1));
}
/** Sum of colspans of a row's cells (the grid width contributed by explicit cells). */
function sumColspans(cells: DocCell[]): number {
  return cells.reduce((s, c) => s + Math.max(1, c.colspan ?? 1), 0);
}
/** A compact per-row span signature — used to detect whether a merge layout changed. */
function gridSignature(rows: DocRow[]): string {
  return rows.map(r => r.cells.map(c => `${c.colspan ?? 1}x${c.rowspan ?? 1}`).join(',')).join('|');
}

/** Reconcile a w:tr's w:tc children against a model row's cells. Content is always
 * reconciled for the overlap; when `allowStructural`, extra cells are cloned from the
 * row's last w:tc (preserving tcPr) and trailing cells removed. */
function reconcileRowCells(dom: Document, tr: Element, cells: DocCell[], ids: DocApplyIds | undefined, allowStructural: boolean): void {
  const domCells = Array.from(tr.children).filter(c => c.tagName === 'w:tc');
  const n = Math.min(domCells.length, cells.length);
  for (let c = 0; c < n; c++) reconcileContainer(dom, domCells[c], cells[c].blocks, ids, true);
  if (!allowStructural) return;
  const template = domCells.length ? domCells[domCells.length - 1] : null;
  for (let c = n; c < cells.length; c++) {
    const tc = template ? (template.cloneNode(true) as Element) : dom.createElementNS(W_NS, 'w:tc');
    tr.appendChild(tc); // w:tc children follow w:trPr → append puts it after the last cell
    reconcileContainer(dom, tc, cells[c].blocks, ids, true);
  }
  for (let c = domCells.length - 1; c >= cells.length; c--) domCells[c].remove();
}

/** Ensure w:tblGrid has exactly `cols` w:gridCol children (clone the last to add,
 * trim to remove). No-op when the count already matches → byte-identical for
 * non-structural edits and for tables whose grid omits gridCol. */
function syncTableGrid(dom: Document, tbl: Element, cols: number): void {
  const grid = Array.from(tbl.children).find(c => c.tagName === 'w:tblGrid');
  if (!grid || cols <= 0) return;
  const cur = Array.from(grid.children).filter(c => c.tagName === 'w:gridCol');
  if (cur.length === cols || cur.length === 0) return; // matched, or no gridCol to template/trim
  if (cur.length < cols) {
    const template = cur[cur.length - 1];
    for (let i = cur.length; i < cols; i++) grid.appendChild(template.cloneNode(true) as Element);
  } else {
    for (let i = cur.length - 1; i >= cols; i--) cur[i].remove();
  }
}

/** Build a fresh w:tc with the given span/merge tcPr (gridSpan before vMerge per
 * CT_TcPr) and one empty w:p (reconcileContainer fills the content). */
function makeMergeCell(dom: Document, opts: { colspan?: number; vMerge?: 'restart' | 'continue' }): Element {
  const tc = dom.createElementNS(W_NS, 'w:tc');
  const tcPr = dom.createElementNS(W_NS, 'w:tcPr');
  if (opts.colspan && opts.colspan > 1) {
    const gs = dom.createElementNS(W_NS, 'w:gridSpan');
    gs.setAttribute('w:val', String(opts.colspan));
    tcPr.appendChild(gs);
  }
  if (opts.vMerge) {
    const vm = dom.createElementNS(W_NS, 'w:vMerge');
    if (opts.vMerge === 'restart') vm.setAttribute('w:val', 'restart'); // continue = no val
    tcPr.appendChild(vm);
  }
  tc.appendChild(tcPr);
  tc.appendChild(dom.createElementNS(W_NS, 'w:p'));
  return tc;
}

/** Content-only reconcile for a merged table whose layout is UNCHANGED: rewrite each
 * non-continuation w:tc's content from the model (cells line up 1:1 because parse
 * drops continuation placeholders identically), leaving the merge structure verbatim. */
function reconcileMergedContent(dom: Document, tbl: Element, table: DocTable, ids: DocApplyIds | undefined): void {
  const domRows = Array.from(tbl.children).filter(c => c.tagName === 'w:tr');
  const n = Math.min(domRows.length, table.rows.length);
  for (let r = 0; r < n; r++) {
    const cells = Array.from(domRows[r].children).filter(c => c.tagName === 'w:tc' && cellVMerge(c) !== 'continue');
    const m = Math.min(cells.length, table.rows[r].cells.length);
    for (let c = 0; c < m; c++) reconcileContainer(dom, cells[c], table.rows[r].cells[c].blocks, ids, true);
  }
}

/**
 * Rebuild a table's w:tr/w:tc skeleton from a PM-shape model whose merge LAYOUT
 * changed (a merge or split happened). Walks the grid row-by-row: model cells emit a
 * w:tc with gridSpan (colspan) / vMerge restart (rowspan); columns covered by a rowspan
 * from above emit a fabricated <w:vMerge/> continuation placeholder. Cell CONTENT is
 * carried over from the model (reconcileContainer); per-cell box styling (tcPr shading/
 * width) is regenerated minimal — the documented merge/split ceiling. w:tblPr is
 * untouched; w:tblGrid is resized. Scoped in-DOM surgery, never a docx-writer rebuild.
 */
function rebuildMergedTable(dom: Document, tbl: Element, table: DocTable, ids: DocApplyIds | undefined): void {
  const totalCols = table.rows.length ? sumColspans(table.rows[0].cells) : 0;
  if (totalCols <= 0) return;
  // Match the w:tr count to the model (clone last to add, remove the tail).
  let domRows = Array.from(tbl.children).filter(c => c.tagName === 'w:tr');
  let lastRow = domRows.length ? domRows[domRows.length - 1] : null;
  for (let r = domRows.length; r < table.rows.length; r++) {
    const nr = lastRow ? (lastRow.cloneNode(true) as Element) : dom.createElementNS(W_NS, 'w:tr');
    if (lastRow && lastRow.nextSibling) tbl.insertBefore(nr, lastRow.nextSibling);
    else tbl.appendChild(nr);
    lastRow = nr;
  }
  for (let r = domRows.length - 1; r >= table.rows.length; r--) domRows[r].remove();
  domRows = Array.from(tbl.children).filter(c => c.tagName === 'w:tr');

  const remaining = new Array<number>(totalCols).fill(0); // rows still covered from above, per col
  const spanOf = new Array<number>(totalCols).fill(1);    // colspan of the covering cell, per col
  for (let r = 0; r < table.rows.length; r++) {
    const tr = domRows[r];
    const modelCells = table.rows[r].cells;
    const newCells: Element[] = [];
    let col = 0;
    let ci = 0;
    while (col < totalCols) {
      if (remaining[col] > 0) {
        const span = spanOf[col];
        newCells.push(makeMergeCell(dom, { colspan: span, vMerge: 'continue' }));
        for (let k = col; k < col + span && k < totalCols; k++) remaining[k]--;
        col += span;
        continue;
      }
      const cell = modelCells[ci++];
      if (!cell) { newCells.push(makeMergeCell(dom, {})); col += 1; continue; } // defensive pad
      const cs = Math.max(1, cell.colspan ?? 1);
      const rs = Math.max(1, cell.rowspan ?? 1);
      const tc = makeMergeCell(dom, { colspan: cs, vMerge: rs > 1 ? 'restart' : undefined });
      reconcileContainer(dom, tc, cell.blocks, ids, true);
      newCells.push(tc);
      if (rs > 1) for (let k = col; k < col + cs && k < totalCols; k++) { remaining[k] = rs - 1; spanOf[k] = cs; }
      col += cs;
    }
    for (const old of Array.from(tr.children).filter(c => c.tagName === 'w:tc')) old.remove();
    for (const nc of newCells) tr.appendChild(nc); // appended after w:trPr
  }
  syncTableGrid(dom, tbl, totalCols);
}

/**
 * Rewrite a table's cells from a DocTable IN PLACE. Three paths:
 *  - Simple table (no merges in model OR DOM): the 3b path — cell text reconciled and
 *    row/column COUNT changes applied (clone/trim w:tr·w:tc, w:tblGrid synced).
 *  - Merged table, layout UNCHANGED: content-only reconcile, merge structure verbatim.
 *  - Merged table, layout CHANGED (merge/split): rebuild the w:tr/w:tc skeleton from the
 *    PM-shape model (gridSpan/vMerge emitted, continuation placeholders fabricated).
 * tblPr is never touched; the cardinal in-place rule holds (no docx-writer rebuild).
 */
function writeTable(dom: Document, tbl: Element, table: DocTable, ids: DocApplyIds | undefined): void {
  const domTable = parseTable(tbl); // PM-shape snapshot of the current DOM
  const merged = hasAnyMerge(table.rows) || hasAnyMerge(domTable.rows);
  if (!merged) {
    writeSimpleTable(dom, tbl, table, ids);
    return;
  }
  if (gridSignature(domTable.rows) === gridSignature(table.rows)) reconcileMergedContent(dom, tbl, table, ids);
  else rebuildMergedTable(dom, tbl, table, ids);
}

/** The 3b in-place reconcile for a simple (un-merged) table: content + row/column COUNT. */
function writeSimpleTable(dom: Document, tbl: Element, table: DocTable, ids: DocApplyIds | undefined): void {
  const domRows = Array.from(tbl.children).filter(c => c.tagName === 'w:tr');
  const n = Math.min(domRows.length, table.rows.length);
  for (let r = 0; r < n; r++) reconcileRowCells(dom, domRows[r], table.rows[r].cells, ids, true);
  // Add extra rows by cloning the last w:tr (inherits cell tcPr / column structure).
  let lastRow = domRows.length ? domRows[domRows.length - 1] : null;
  for (let r = n; r < table.rows.length; r++) {
    const newRow = lastRow ? (lastRow.cloneNode(true) as Element) : dom.createElementNS(W_NS, 'w:tr');
    if (lastRow && lastRow.nextSibling) tbl.insertBefore(newRow, lastRow.nextSibling);
    else tbl.appendChild(newRow);
    reconcileRowCells(dom, newRow, table.rows[r].cells, ids, true);
    lastRow = newRow;
  }
  // Remove extra rows at the tail.
  for (let r = domRows.length - 1; r >= table.rows.length; r--) domRows[r].remove();
  // Keep the grid column count in step with the (rectangular) model.
  const maxCols = table.rows.reduce((mx, row) => Math.max(mx, row.cells.length), 0);
  syncTableGrid(dom, tbl, maxCols);
}

/** Top-level w:p that contain a w:drawing, in document order (C2 image-edit anchors). */
function drawingAnchorParas(container: Element): Element[] {
  return Array.from(container.children).filter(
    (e): e is Element => e.tagName === 'w:p' && e.getElementsByTagName('w:drawing').length > 0,
  );
}

/** Set cx/cy on the drawing's wp:extent and (when present) the inner pic a:ext. In-place. */
function rewriteExtent(drawingPara: Element, cx: number, cy: number): void {
  const drawing = drawingPara.getElementsByTagName('w:drawing')[0];
  if (!drawing) return;
  const ext = drawing.getElementsByTagName('wp:extent')[0];
  if (ext) { ext.setAttribute('cx', String(cx)); ext.setAttribute('cy', String(cy)); }
  const aExt = drawing.getElementsByTagName('a:ext')[0];
  if (aExt) { aExt.setAttribute('cx', String(cx)); aExt.setAttribute('cy', String(cy)); }
}

const EMU_PER_PT_M = 12700;

/**
 * C2 image edit (save pre-pass, BEFORE reconcileContainer): delete top-level drawing anchors whose
 * anchorId no longer survives in the model, and resize the rest in place. Identity is anchorId
 * (parse-time index among top-level drawing anchors). SAFETY GUARD: if the surviving anchorIds aren't
 * a duplicate-free subset of {0..m-1}, leave every image verbatim (never corrupt). The surviving set
 * is identity-only (any block with a numeric anchorId) — this INCLUDES an unsupported-format image that
 * round-tripped as a docx_link fallback, so it is preserved rather than treated as deleted.
 */
function reconcileImageAnchors(body: Element, blocks: DocBlock[]): void {
  const D = drawingAnchorParas(body);
  const m = D.length;
  if (m === 0) return;
  const drawBlocks = blocks.filter((b): b is DocImageBlock => isDocImageBlock(b) && typeof b.anchorId === 'number');
  const ids = drawBlocks.map(b => b.anchorId as number);
  const S = new Set(ids);
  if (S.size !== ids.length || ids.some(i => i < 0 || i >= m)) return; // guard → verbatim
  for (let i = 0; i < m; i++) {
    if (!S.has(i)) { D[i].remove(); continue; }     // user-deleted (no surviving anchor for id i)
    const blk = drawBlocks.find(b => b.anchorId === i);
    if (!blk || !blk.image) continue;                // unextracted image → preserve verbatim, no resize
    const cx = Math.round(blk.image.widthPt * EMU_PER_PT_M);
    const cy = Math.round(blk.image.heightPt * EMU_PER_PT_M);
    const ext = D[i].getElementsByTagName('wp:extent')[0];
    const curCx = Number(ext?.getAttribute('cx'));
    const curCy = Number(ext?.getAttribute('cy'));
    if (cx > 0 && cy > 0 && (cx !== curCx || cy !== curCy)) rewriteExtent(D[i], cx, cy);
  }
}

/**
 * Write a full block model back into the ORIGINAL document XML IN PLACE. Generalizes
 * applyParagraphRuns: top-level paragraphs AND tables (cells rewritten, structure verbatim).
 * `opts.editImages` (editor save only) runs the C2 image delete/resize pre-pass; legacy callers
 * (applyParagraphRuns, paragraphs-only) omit it → images preserved verbatim (byte-identical).
 */
export function applyBlocks(documentXml: string, blocks: DocBlock[], ids?: DocApplyIds, opts?: { editImages?: boolean }): string {
  const dom = new DOMParser().parseFromString(documentXml, 'application/xml');
  if (dom.getElementsByTagName('parsererror').length > 0) return documentXml;
  const body = dom.getElementsByTagName('w:body')[0];
  if (!body) return documentXml;
  if (opts?.editImages) reconcileImageAnchors(body, blocks);
  reconcileContainer(dom, body, blocks, ids, false);
  return new XMLSerializer().serializeToString(dom);
}

/**
 * Write a full per-run model back into the ORIGINAL document XML IN PLACE — the
 * formatting-preserving successor to applyParagraphTexts. Delegates to applyBlocks;
 * a table-free doc has zero w:tbl → single segment with anchor=null → byte-identical
 * update/append-at-end/remove behavior to the original implementation.
 */
export function applyParagraphRuns(documentXml: string, paragraphs: DocParagraph[], ids?: DocApplyIds): string {
  return applyBlocks(documentXml, paragraphs, ids);
}
