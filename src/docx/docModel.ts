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

/** Resolved style/numbering ids for writing paragraph-level props (from opcParts). */
export interface DocApplyIds {
  heading: { 1: string; 2: string; 3: string };
  bulletNumId: number;
  orderedNumId: number;
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

/** Parse the main document XML into the editable top-level-paragraph model.
 * `numberingMap` (numId→format) resolves each list paragraph's `ordered`. */
export function parseDocModel(documentXml: string, numberingMap?: NumberingMap): DocModel {
  const dom = new DOMParser().parseFromString(documentXml, 'application/xml');
  if (dom.getElementsByTagName('parsererror').length > 0) throw new Error('document.xml not well-formed');
  const body = dom.getElementsByTagName('w:body')[0];
  const blocks: DocBlock[] = body ? parseContainerBlocks(body, numberingMap) : [];
  const paragraphs = blocks.filter((b): b is DocParagraph => !isDocTable(b));
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
const MANAGED_RPR = new Set(['w:b', 'w:i', 'w:u', 'w:rFonts', 'w:sz', 'w:szCs']);

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

/**
 * Write a full per-run model back into the ORIGINAL document XML IN PLACE — the
 * formatting-preserving successor to applyParagraphTexts. For each top-level
 * paragraph, the existing `w:r` runs are replaced by runs rebuilt from the model
 * (bold/italic per run; the original first run's `w:rPr` is reused as the base so
 * unmodeled formatting like font/size survives). `w:pPr` and every non-run node
 * (tables, bookmarks, …) pass through verbatim. Extra paragraphs are appended by
 * cloning the last; removed paragraphs are deleted.
 */
export function applyParagraphRuns(documentXml: string, paragraphs: DocParagraph[], ids?: DocApplyIds): string {
  const dom = new DOMParser().parseFromString(documentXml, 'application/xml');
  if (dom.getElementsByTagName('parsererror').length > 0) return documentXml;
  const body = dom.getElementsByTagName('w:body')[0];
  if (!body) return documentXml;
  let ps = topLevelParagraphs(dom);
  if (ps.length === 0) return documentXml;

  const setRuns = (p: Element, para: DocParagraph): void => {
    const existing = Array.from(p.children).filter(c => c.tagName === 'w:r');
    const baseRPr = existing.length
      ? (Array.from(existing[0].children).find(c => c.tagName === 'w:rPr') as Element | undefined)
      : undefined;
    for (const r of existing) r.remove();
    // Paragraph-level props (heading/list) need resolved style/numbering ids; without
    // `ids` they are ignored → byte-identical to the #1c runs-only behavior.
    if (ids) applyParagraphProps(dom, p, para, ids);
    // An empty paragraph still needs one (empty) run to stay valid/visible.
    const runs = para.runs.length ? para.runs : [{ text: '' }];
    for (const run of runs) p.appendChild(buildRun(dom, baseRPr, run));
  };

  const template = ps[ps.length - 1];
  for (let i = 0; i < paragraphs.length; i++) {
    if (i < ps.length) {
      setRuns(ps[i], paragraphs[i]);
    } else {
      const clone = template.cloneNode(true) as Element;
      setRuns(clone, paragraphs[i]);
      body.appendChild(clone);
    }
  }
  ps = topLevelParagraphs(dom);
  for (let i = ps.length - 1; i >= paragraphs.length; i--) ps[i].remove();

  return new XMLSerializer().serializeToString(dom);
}
