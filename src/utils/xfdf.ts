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
 * mapped to the app's `shape` element rect/ellipse/arrow/freehand). Remaining
 * subtypes (stamp, polygon, polyline) and richtext/DA appearances + form
 * `<fields>` data are a documented ceiling (#57b) — on import they are ignored
 * (forward-compatible), never mis-mapped.
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

/** Serialise annotation records to an XFDF document string. */
export function buildXfdf(annots: XfdfAnnot[]): string {
  const lines = annots.map(a => {
    const attrs = [`page="${a.page}"`, `rect="${a.rect.join(',')}"`];
    if (a.color) attrs.push(`color="${escAttr(a.color)}"`);
    if (a.type === 'highlight') {
      if (a.opacity !== undefined) attrs.push(`opacity="${a.opacity}"`);
      attrs.push(`coords="${quadFromRect(a.rect)}"`);
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
    const body = a.contents !== undefined ? `<contents>${escText(a.contents)}</contents>` : '';
    return `    <${a.type} ${attrs.join(' ')}>${body}</${a.type}>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>
<xfdf xmlns="${NS}" xml:space="preserve">
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
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(xml, 'application/xml');
  } catch {
    return [];
  }
  if (doc.getElementsByTagName('parsererror').length > 0) return [];
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
      }
    }
    out.push(annot);
  }
  return out;
}
