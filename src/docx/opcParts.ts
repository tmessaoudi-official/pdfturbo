/**
 * opcParts — read/modify the secondary OPC parts a rich-text edit depends on:
 * `word/styles.xml` (heading paragraph styles) and `word/numbering.xml` (list
 * definitions). Strategy (spec 2026-06-20): reuse existing definitions when present,
 * inject minimal spec-valid ones when missing, and create + register the whole part
 * (in `[Content_Types].xml` and `word/_rels/document.xml.rels`) when it is absent.
 * Untouched parts still pass through verbatim (the OPC cardinal rule).
 *
 * Pure DOM + fflate, jsdom + browser. No new deps.
 */
import { strFromU8, strToU8 } from 'fflate';
import type { OpcPackage } from './opcEdit';
import type { NumberingMap } from './docModel';

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT_NS = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const CT_PATH = '[Content_Types].xml';
const DOC_RELS = 'word/_rels/document.xml.rels';

const HYPERLINK_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink';

const STYLES_PATH = 'word/styles.xml';
const STYLES_CT = 'application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml';
const STYLES_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles';
const NUMBERING_PATH = 'word/numbering.xml';
const NUMBERING_CT = 'application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml';
const NUMBERING_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering';

const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

export function hasPart(opc: OpcPackage, path: string): boolean {
  return Boolean(opc.files[path]);
}
export function getPart(opc: OpcPackage, path: string): string | undefined {
  const b = opc.files[path];
  return b ? strFromU8(b) : undefined;
}
export function setPart(opc: OpcPackage, path: string, xml: string): void {
  opc.files[path] = strToU8(xml);
}

function parse(xml: string): Document {
  return new DOMParser().parseFromString(xml, 'application/xml');
}
function serialize(dom: Document): string {
  return new XMLSerializer().serializeToString(dom);
}
function el(dom: Document, tag: string, attrs?: Record<string, string>): Element {
  const e = dom.createElementNS(W_NS, tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}
function firstChildByTag(parent: Element, tag: string): Element | undefined {
  for (let i = 0; i < parent.children.length; i++) if (parent.children[i].tagName === tag) return parent.children[i];
  return undefined;
}

/** Register a newly-created part in [Content_Types].xml (Override) and
 * word/_rels/document.xml.rels (Relationship). No-op if either part is absent or
 * the registration already exists. */
function registerPart(opc: OpcPackage, partPath: string, contentType: string, relType: string, relTarget: string): void {
  const ctXml = getPart(opc, CT_PATH);
  if (ctXml) {
    const dom = parse(ctXml);
    const overrides = dom.getElementsByTagName('Override');
    let exists = false;
    for (let i = 0; i < overrides.length; i++) if (overrides[i].getAttribute('PartName') === `/${partPath}`) exists = true;
    if (!exists) {
      const o = dom.createElementNS(CT_NS, 'Override');
      o.setAttribute('PartName', `/${partPath}`);
      o.setAttribute('ContentType', contentType);
      dom.documentElement.appendChild(o);
      setPart(opc, CT_PATH, serialize(dom));
    }
  }
  const relsXml = getPart(opc, DOC_RELS);
  if (relsXml) {
    const dom = parse(relsXml);
    const rels = dom.getElementsByTagName('Relationship');
    let exists = false;
    let maxId = 0;
    for (let i = 0; i < rels.length; i++) {
      if (rels[i].getAttribute('Type') === relType) exists = true;
      const m = /^rId(\d+)$/.exec(rels[i].getAttribute('Id') ?? '');
      if (m) maxId = Math.max(maxId, Number(m[1]));
    }
    if (!exists) {
      const rel = dom.createElementNS(REL_NS, 'Relationship');
      rel.setAttribute('Id', `rId${maxId + 1}`);
      rel.setAttribute('Type', relType);
      rel.setAttribute('Target', relTarget);
      dom.documentElement.appendChild(rel);
      setPart(opc, DOC_RELS, serialize(dom));
    }
  }
}

/** Map of rId → external hyperlink Target, read from word/_rels/document.xml.rels.
 * Only `Type=…/hyperlink` relationships with `TargetMode="External"` are included. */
export function buildHyperlinkMap(opc: OpcPackage): Map<string, string> {
  const map = new Map<string, string>();
  const relsXml = getPart(opc, DOC_RELS);
  if (!relsXml) return map;
  const rels = parse(relsXml).getElementsByTagName('Relationship');
  for (let i = 0; i < rels.length; i++) {
    const rel = rels[i];
    if (rel.getAttribute('Type') !== HYPERLINK_REL) continue;
    if (rel.getAttribute('TargetMode') !== 'External') continue;
    const id = rel.getAttribute('Id');
    const target = rel.getAttribute('Target');
    if (id && target) map.set(id, target);
  }
  return map;
}

/** Return the rId of an existing External hyperlink relationship whose Target equals `url`,
 * else create one (`<Relationship Id rIdN Type=…/hyperlink Target=url TargetMode=External/>`)
 * and return its new Id. Creates the rels part if absent. */
export function ensureHyperlinkRel(opc: OpcPackage, url: string): string {
  const relsXml = getPart(opc, DOC_RELS)
    ?? `${XML_DECL}<Relationships xmlns="${REL_NS}"></Relationships>`;
  const dom = parse(relsXml);
  const rels = dom.getElementsByTagName('Relationship');
  let maxId = 0;
  for (let i = 0; i < rels.length; i++) {
    const rel = rels[i];
    if (rel.getAttribute('Type') === HYPERLINK_REL
      && rel.getAttribute('TargetMode') === 'External'
      && rel.getAttribute('Target') === url) {
      return rel.getAttribute('Id') ?? '';
    }
    const m = /^rId(\d+)$/.exec(rel.getAttribute('Id') ?? '');
    if (m) maxId = Math.max(maxId, Number(m[1]));
  }
  const id = `rId${maxId + 1}`;
  const rel = dom.createElementNS(REL_NS, 'Relationship');
  rel.setAttribute('Id', id);
  rel.setAttribute('Type', HYPERLINK_REL);
  rel.setAttribute('Target', url);
  rel.setAttribute('TargetMode', 'External');
  dom.documentElement.appendChild(rel);
  setPart(opc, DOC_RELS, serialize(dom));
  return id;
}

/** Heading level (1–3) implied by a paragraph style's id/name, else 0. */
function headingLevelOf(styleId: string, name: string): number {
  const m = /^heading\s*-?\s*([1-6])$/i.exec(styleId) || /heading\s*-?\s*([1-6])/i.exec(name);
  return m ? Number(m[1]) : 0;
}
function uniqueStyleId(dom: Document, base: string): string {
  const ids = new Set<string>();
  const styles = dom.getElementsByTagName('w:style');
  for (let i = 0; i < styles.length; i++) ids.add(styles[i].getAttribute('w:styleId') ?? '');
  if (!ids.has(base)) return base;
  let n = 1;
  while (ids.has(`${base}Pdfturbo${n}`)) n++;
  return `${base}Pdfturbo${n}`;
}
const HEADING_SZ = { 1: '32', 2: '28', 3: '26' } as const;
function makeHeadingStyle(dom: Document, styleId: string, level: 1 | 2 | 3): Element {
  const s = el(dom, 'w:style', { 'w:type': 'paragraph', 'w:styleId': styleId });
  s.appendChild(el(dom, 'w:name', { 'w:val': `heading ${level}` }));
  s.appendChild(el(dom, 'w:qFormat'));
  const pPr = el(dom, 'w:pPr');
  pPr.appendChild(el(dom, 'w:outlineLvl', { 'w:val': String(level - 1) }));
  s.appendChild(pPr);
  const rPr = el(dom, 'w:rPr');
  rPr.appendChild(el(dom, 'w:b'));
  rPr.appendChild(el(dom, 'w:sz', { 'w:val': HEADING_SZ[level] }));
  rPr.appendChild(el(dom, 'w:szCs', { 'w:val': HEADING_SZ[level] }));
  s.appendChild(rPr);
  return s;
}

/** Resolve (reuse or inject) the three heading paragraph-style ids. */
export function ensureHeadingStyles(opc: OpcPackage): { 1: string; 2: string; 3: string } {
  const created = !hasPart(opc, STYLES_PATH);
  const xml = getPart(opc, STYLES_PATH) ?? `${XML_DECL}<w:styles xmlns:w="${W_NS}"></w:styles>`;
  const dom = parse(xml);
  const root = dom.documentElement;

  const found: Record<number, string> = {};
  const styles = dom.getElementsByTagName('w:style');
  for (let i = 0; i < styles.length; i++) {
    const s = styles[i];
    if (s.getAttribute('w:type') !== 'paragraph') continue;
    const id = s.getAttribute('w:styleId') ?? '';
    const name = firstChildByTag(s, 'w:name')?.getAttribute('w:val') ?? '';
    const lvl = headingLevelOf(id, name);
    if (lvl >= 1 && lvl <= 3 && !found[lvl]) found[lvl] = id;
  }

  const result = {} as { 1: string; 2: string; 3: string };
  for (const lvl of [1, 2, 3] as const) {
    if (found[lvl]) {
      result[lvl] = found[lvl];
    } else {
      const styleId = uniqueStyleId(dom, `Heading${lvl}`);
      root.appendChild(makeHeadingStyle(dom, styleId, lvl));
      result[lvl] = styleId;
    }
  }
  setPart(opc, STYLES_PATH, serialize(dom));
  if (created) registerPart(opc, STYLES_PATH, STYLES_CT, STYLES_REL, 'styles.xml');
  return result;
}

/** numId → list format, read from a numbering Document (abstractNum ilvl-0 numFmt). */
function numberingMapFromDom(dom: Document): NumberingMap {
  const map: NumberingMap = new Map();
  const absFmt = new Map<string, 'bullet' | 'decimal' | 'other'>();
  const abs = dom.getElementsByTagName('w:abstractNum');
  for (let i = 0; i < abs.length; i++) {
    const id = abs[i].getAttribute('w:abstractNumId') ?? '';
    const lvls = abs[i].getElementsByTagName('w:lvl');
    let fmt: 'bullet' | 'decimal' | 'other' = 'other';
    for (let j = 0; j < lvls.length; j++) {
      if ((lvls[j].getAttribute('w:ilvl') ?? '') === '0') {
        const v = lvls[j].getElementsByTagName('w:numFmt')[0]?.getAttribute('w:val') ?? '';
        fmt = v === 'bullet' ? 'bullet' : v === 'decimal' ? 'decimal' : 'other';
        break;
      }
    }
    absFmt.set(id, fmt);
  }
  const nums = dom.getElementsByTagName('w:num');
  for (let i = 0; i < nums.length; i++) {
    const numId = Number(nums[i].getAttribute('w:numId'));
    const absRef = nums[i].getElementsByTagName('w:abstractNumId')[0]?.getAttribute('w:val') ?? '';
    if (Number.isFinite(numId)) map.set(numId, absFmt.get(absRef) ?? 'other');
  }
  return map;
}

/** numId → list format for the package's numbering part (empty when absent). */
export function buildNumberingMap(opc: OpcPackage): NumberingMap {
  const xml = getPart(opc, NUMBERING_PATH);
  return xml ? numberingMapFromDom(parse(xml)) : new Map();
}

function makeAbstractNum(dom: Document, absId: number, fmt: 'bullet' | 'decimal'): Element {
  const a = el(dom, 'w:abstractNum', { 'w:abstractNumId': String(absId) });
  for (let ilvl = 0; ilvl < 9; ilvl++) {
    const lvl = el(dom, 'w:lvl', { 'w:ilvl': String(ilvl) });
    lvl.appendChild(el(dom, 'w:start', { 'w:val': '1' }));
    lvl.appendChild(el(dom, 'w:numFmt', { 'w:val': fmt }));
    lvl.appendChild(el(dom, 'w:lvlText', { 'w:val': fmt === 'bullet' ? '•' : `%${ilvl + 1}.` }));
    lvl.appendChild(el(dom, 'w:lvlJc', { 'w:val': 'left' }));
    const pPr = el(dom, 'w:pPr');
    pPr.appendChild(el(dom, 'w:ind', { 'w:left': String(720 * (ilvl + 1)), 'w:hanging': '360' }));
    lvl.appendChild(pPr);
    if (fmt === 'bullet') {
      const rPr = el(dom, 'w:rPr');
      rPr.appendChild(el(dom, 'w:rFonts', { 'w:ascii': 'Symbol', 'w:hAnsi': 'Symbol', 'w:hint': 'default' }));
      lvl.appendChild(rPr);
    }
    a.appendChild(lvl);
  }
  return a;
}
function makeNum(dom: Document, numId: number, absId: number): Element {
  const n = el(dom, 'w:num', { 'w:numId': String(numId) });
  n.appendChild(el(dom, 'w:abstractNumId', { 'w:val': String(absId) }));
  return n;
}

/** Resolve (reuse or inject) one bullet and one ordered (decimal) numId. */
export function ensureListNumbering(opc: OpcPackage): { bulletNumId: number; orderedNumId: number } {
  const created = !hasPart(opc, NUMBERING_PATH);
  const xml = getPart(opc, NUMBERING_PATH) ?? `${XML_DECL}<w:numbering xmlns:w="${W_NS}"></w:numbering>`;
  const dom = parse(xml);
  const root = dom.documentElement;

  let bulletNumId = 0;
  let orderedNumId = 0;
  for (const [numId, fmt] of numberingMapFromDom(dom)) {
    if (fmt === 'bullet' && !bulletNumId) bulletNumId = numId;
    if (fmt === 'decimal' && !orderedNumId) orderedNumId = numId;
  }

  let maxAbs = 99; // floor 100 for injected ids
  let maxNum = 99;
  const abs = dom.getElementsByTagName('w:abstractNum');
  for (let i = 0; i < abs.length; i++) maxAbs = Math.max(maxAbs, Number(abs[i].getAttribute('w:abstractNumId')) || 0);
  const nums = dom.getElementsByTagName('w:num');
  for (let i = 0; i < nums.length; i++) maxNum = Math.max(maxNum, Number(nums[i].getAttribute('w:numId')) || 0);

  const inject = (fmt: 'bullet' | 'decimal'): number => {
    maxAbs += 1;
    maxNum += 1;
    // abstractNum MUST precede every num in document order.
    const firstNum = dom.getElementsByTagName('w:num')[0];
    const absEl = makeAbstractNum(dom, maxAbs, fmt);
    if (firstNum) root.insertBefore(absEl, firstNum);
    else root.appendChild(absEl);
    root.appendChild(makeNum(dom, maxNum, maxAbs));
    return maxNum;
  };

  if (!bulletNumId) bulletNumId = inject('bullet');
  if (!orderedNumId) orderedNumId = inject('decimal');

  setPart(opc, NUMBERING_PATH, serialize(dom));
  if (created) registerPart(opc, NUMBERING_PATH, NUMBERING_CT, NUMBERING_REL, 'numbering.xml');
  return { bulletNumId, orderedNumId };
}
