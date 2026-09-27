/**
 * XFDF codec (#57) — import/export PDF annotations as Adobe XFDF (XML Forms
 * Data Format), so markups can be shared without the PDF and round-tripped with
 * Acrobat. Plain XML, no dependency (uses the platform DOMParser).
 *
 * Records are normalised to PDF DEFAULT USER SPACE: points, y-up, origin at the
 * page's bottom-left, page index 0-based (the XFDF convention). The export and
 * import wiring performs the display(top-left,y-down) ↔ user-space flip; this
 * module only serialises/parses, so it is pure and fully unit-testable.
 *
 * Supported subtypes (clean two-way mapping): highlight, text (sticky note),
 * freetext, plus the shape subtypes square, circle, line and ink (G21 —
 * mapped to the app's `shape` element rect/ellipse/arrow/freehand). A highlight
 * carries its QuadPoints (`coords`, several quads for a multi-line highlight),
 * and form `<fields>` values are written and read (limits row 26). Remaining
 * subtypes (stamp, polygon, polyline) and richtext/DA appearances are a
 * documented ceiling (#57b) — on import they are ignored (forward-compatible),
 * never mis-mapped.
 */

export type XfdfAnnotType =
  | 'highlight' | 'text' | 'freetext'
  | 'square' | 'circle' | 'line' | 'ink';

export interface XfdfAnnot {
  type: XfdfAnnotType;
  /** 0-based page index (XFDF convention). */
  page: number;
  /** PDF user-space bounding box [x1,y1,x2,y2], y-up. */
  rect: [number, number, number, number];
  /** #rrggbb. */
  color?: string;
  /** Note / free-text body. */
  contents?: string;
  /** Highlight fill opacity 0..1. */
  opacity?: number;
  /** Free-text font size (points). Non-standard attribute — app round-trip only. */
  fontSize?: number;
  /** Border/stroke width in points (square/circle/line/ink — XFDF `width`). */
  width?: number;
  /** Line endpoints [x1,y1,x2,y2] in PDF user space (XFDF `start`/`end`). */
  line?: [number, number, number, number];
  /** Ink gesture paths; each path is a flat [x0,y0,x1,y1,…] list in user space. */
  inkList?: number[][];
  /**
   * Highlight QuadPoints in user space, 8 numbers per quad in the TL,TR,BL,BR order of the text they cover
   * (XFDF `coords`). Absent → one quad derived from `rect`.
   */
  quads?: number[];
  /** Free-text rotation in degrees (XFDF `rotation`) — set on a page the viewer shows turned (row 26). */
  rotation?: number;
}

/** One form field's value(s) — XFDF `<field name><value>…</value></field>`; `name` is fully qualified (dotted). */
export interface XfdfField {
  name: string;
  values: string[];
}

const NS = 'http://ns.adobe.com/xfdf/';
const SUPPORTED = new Set<string>(['highlight', 'text', 'freetext', 'square', 'circle', 'line', 'ink']);

function escAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function escText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Highlight QuadPoints from the bounding rect (TL,TR,BL,BR) — lets Acrobat
 *  render the highlight; ignored on parse (rect is the source of truth). */
function quadFromRect(r: readonly [number, number, number, number]): string {
  const [x1, y1, x2, y2] = r;
  return `${x1},${y2},${x2},${y2},${x1},${y1},${x2},${y1}`;
}

/** Flat [x0,y0,x1,y1,…] point list → XFDF `<gesture>` body "x0,y0;x1,y1;…". */
function pathToGesture(path: readonly number[]): string {
  const pairs: string[] = [];
  for (let i = 0; i + 1 < path.length; i += 2) pairs.push(`${path[i]},${path[i + 1]}`);
  return pairs.join(';');
}

/** XFDF `<gesture>` body "x0,y0;x1,y1;…" → flat [x0,y0,x1,y1,…]; non-finite
 *  coordinates are dropped (the pair is skipped). */
function gestureToPath(body: string): number[] {
  const out: number[] = [];
  for (const pair of body.split(';')) {
    const t = pair.trim();
    if (t === '') continue;
    const [xs, ys] = t.split(',');
    const x = Number(xs), y = Number(ys);
    if (Number.isFinite(x) && Number.isFinite(y)) out.push(x, y);
  }
  return out;
}

/**
 * `<fields>` for XFDF: dotted names nest one `<field>` per segment, as Acrobat writes them, and each value is
 * its own `<value>`. A name that is both a leaf and a parent carries its values and its children.
 */
function buildFields(fields: readonly XfdfField[], indent: string): string {
  interface Node { values?: string[]; kids: Map<string, Node> }
  const root: Node = { kids: new Map() };
  for (const f of fields) {
    let node = root;
    for (const seg of f.name.split('.')) {
      let next = node.kids.get(seg);
      if (!next) { next = { kids: new Map() }; node.kids.set(seg, next); }
      node = next;
    }
    node.values = f.values;
  }
  const emit = (node: Node, pad: string): string[] => [...node.kids].flatMap(([name, kid]) => [
    `${pad}<field name="${escAttr(name)}">`,
    ...(kid.values ?? []).map(v => `${pad}  <value>${escText(v)}</value>`),
    ...emit(kid, pad + '  '),
    `${pad}</field>`,
  ]);
  return [`${indent}<fields>`, ...emit(root, indent + '  '), `${indent}</fields>`].join('\n');
}

/** Serialise annotation records (and, when given, form field values) to an XFDF document string. */
export function buildXfdf(annots: XfdfAnnot[], fields: readonly XfdfField[] = []): string {
  const lines = annots.map(a => {
    const attrs = [`page="${a.page}"`, `rect="${a.rect.join(',')}"`];
    if (a.color) attrs.push(`color="${escAttr(a.color)}"`);
    if (a.type === 'highlight') {
      if (a.opacity !== undefined) attrs.push(`opacity="${a.opacity}"`);
      const quads = a.quads && a.quads.length >= 8 && a.quads.length % 8 === 0 ? a.quads.join(',') : quadFromRect(a.rect);
      attrs.push(`coords="${quads}"`);
      return `    <highlight ${attrs.join(' ')}/>`;
    }
    if (a.type === 'square' || a.type === 'circle') {
      if (a.width !== undefined) attrs.push(`width="${a.width}"`);
      return `    <${a.type} ${attrs.join(' ')}/>`;
    }
    if (a.type === 'line') {
      if (a.width !== undefined) attrs.push(`width="${a.width}"`);
      const ln = a.line ?? a.rect;
      attrs.push(`start="${ln[0]},${ln[1]}"`, `end="${ln[2]},${ln[3]}"`);
      return `    <line ${attrs.join(' ')}/>`;
    }
    if (a.type === 'ink') {
      if (a.width !== undefined) attrs.push(`width="${a.width}"`);
      const gestures = (a.inkList ?? [])
        .map(path => `<gesture>${pathToGesture(path)}</gesture>`).join('');
      return `    <ink ${attrs.join(' ')}>${gestures}</ink>`;
    }
    if (a.type === 'freetext' && a.fontSize !== undefined) attrs.push(`fontsize="${a.fontSize}"`);
    if (a.type === 'freetext' && a.rotation) attrs.push(`rotation="${a.rotation}"`);
    const body = a.contents !== undefined ? `<contents>${escText(a.contents)}</contents>` : '';
    return `    <${a.type} ${attrs.join(' ')}>${body}</${a.type}>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>
<xfdf xmlns="${NS}" xml:space="preserve">${fields.length ? '\n' + buildFields(fields, '  ') : ''}
  <annots>
${lines.join('\n')}
  </annots>
</xfdf>`;
}

function num(v: string | null): number | undefined {
  if (v === null || v.trim() === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/** Parse an XFDF document string into annotation records. Malformed XML, or a
 *  document with no <annots>, yields an empty array. Unknown subtypes are
 *  skipped. */
export function parseXfdf(xml: string): XfdfAnnot[] {
  return parseXfdfDocument(xml).annots;
}

/** The `<fields>` of a parsed XFDF: nested names joined with `.`; a field with no `<value>` is skipped. */
function parseFields(doc: Document): XfdfField[] {
  const fieldsEl = doc.getElementsByTagName('fields')[0];
  if (!fieldsEl) return [];
  const out: XfdfField[] = [];
  const walk = (el: Element, prefix: string) => {
    for (const f of Array.from(el.children)) {
      if (f.localName !== 'field') continue;
      const name = f.getAttribute('name');
      if (!name) continue;
      const full = prefix ? `${prefix}.${name}` : name;
      const values = Array.from(f.children).filter(c => c.localName === 'value').map(c => c.textContent ?? '');
      if (values.length) out.push({ name: full, values });
      walk(f, full);
    }
  };
  walk(fieldsEl, '');
  return out;
}

/** Parse an XFDF document into its annotations and its form field values. Malformed XML yields both empty. */
export function parseXfdfDocument(xml: string): { annots: XfdfAnnot[]; fields: XfdfField[] } {
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(xml, 'application/xml');
  } catch {
    return { annots: [], fields: [] };
  }
  if (doc.getElementsByTagName('parsererror').length > 0) return { annots: [], fields: [] };
  return { annots: parseAnnots(doc), fields: parseFields(doc) };
}

function parseAnnots(doc: Document): XfdfAnnot[] {
  const annotsEl = doc.getElementsByTagName('annots')[0];
  if (!annotsEl) return [];

  const out: XfdfAnnot[] = [];
  for (const el of Array.from(annotsEl.children)) {
    const type = el.localName;
    if (!SUPPORTED.has(type)) continue;

    const rectParts = (el.getAttribute('rect') ?? '').split(',').map(s => Number(s.trim()));
    if (rectParts.length !== 4 || rectParts.some(n => !Number.isFinite(n))) continue;
    const page = num(el.getAttribute('page'));
    if (page === undefined) continue;

    const annot: XfdfAnnot = {
      type: type as XfdfAnnotType,
      page,
      rect: [rectParts[0], rectParts[1], rectParts[2], rectParts[3]],
    };
    const color = el.getAttribute('color');
    if (color) annot.color = color;

    if (type === 'highlight') {
      const op = num(el.getAttribute('opacity'));
      if (op !== undefined) annot.opacity = op;
      const quads = (el.getAttribute('coords') ?? '').split(',').map(v => Number(v.trim()));
      if (quads.length >= 8 && quads.length % 8 === 0 && quads.every(Number.isFinite)) annot.quads = quads;
    } else if (type === 'square' || type === 'circle' || type === 'line' || type === 'ink') {
      const w = num(el.getAttribute('width'));
      if (w !== undefined) annot.width = w;
      if (type === 'line') {
        const start = (el.getAttribute('start') ?? '').split(',').map(s => Number(s.trim()));
        const end = (el.getAttribute('end') ?? '').split(',').map(s => Number(s.trim()));
        if (start.length === 2 && end.length === 2 && [...start, ...end].every(n => Number.isFinite(n))) {
          annot.line = [start[0], start[1], end[0], end[1]];
        }
      } else if (type === 'ink') {
        const paths: number[][] = [];
        for (const g of Array.from(el.getElementsByTagName('gesture'))) {
          const path = gestureToPath(g.textContent ?? '');
          if (path.length >= 2) paths.push(path);
        }
        annot.inkList = paths;
      }
    } else {
      const contentsEl = el.getElementsByTagName('contents')[0];
      if (contentsEl) annot.contents = contentsEl.textContent ?? '';
      if (type === 'freetext') {
        const fs = num(el.getAttribute('fontsize'));
        if (fs !== undefined) annot.fontSize = fs;
        const rot = num(el.getAttribute('rotation'));
        if (rot) annot.rotation = rot;
      }
    }
    out.push(annot);
  }
  return out;
}
