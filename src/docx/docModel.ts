/**
 * docModel — a small editable model over a .docx main document part.
 *
 * Scope (Phase 1 #1b): the TOP-LEVEL paragraphs of `w:body` only — runs with
 * bold/italic. Anything else (tables `w:tbl`, section props, styles, …) is NOT
 * modeled and therefore passes through verbatim on save (the #1a guarantee). Reads
 * run formatting for display; #1b save is text-level (see applyParagraphTexts).
 */

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

export interface DocRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
}
export interface DocParagraph {
  runs: DocRun[];
}
export interface DocModel {
  paragraphs: DocParagraph[];
}

/** Direct-child `w:p` elements of `w:body` (NOT paragraphs nested inside tables). */
function topLevelParagraphs(dom: Document): Element[] {
  const body = dom.getElementsByTagName('w:body')[0];
  if (!body) return [];
  return Array.from(body.children).filter(el => el.tagName === 'w:p');
}

function hasChild(rPr: Element | undefined, tag: string): boolean {
  if (!rPr) return false;
  for (let i = 0; i < rPr.children.length; i++) if (rPr.children[i].tagName === tag) return true;
  return false;
}

/** Parse the main document XML into the editable top-level-paragraph model. */
export function parseDocModel(documentXml: string): DocModel {
  const dom = new DOMParser().parseFromString(documentXml, 'application/xml');
  if (dom.getElementsByTagName('parsererror').length > 0) throw new Error('document.xml not well-formed');
  const paragraphs: DocParagraph[] = topLevelParagraphs(dom).map(p => {
    const runs: DocRun[] = [];
    const rs = p.getElementsByTagName('w:r');
    for (let i = 0; i < rs.length; i++) {
      const r = rs[i];
      const ts = r.getElementsByTagName('w:t');
      let text = '';
      for (let j = 0; j < ts.length; j++) text += ts[j].textContent ?? '';
      if (!text) continue;
      const rPr = Array.from(r.children).find(c => c.tagName === 'w:rPr');
      runs.push({ text, bold: hasChild(rPr, 'w:b') || undefined, italic: hasChild(rPr, 'w:i') || undefined });
    }
    return { runs };
  });
  return { paragraphs };
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
 * Per-run formatting round-trip on EDITED paragraphs is a documented #1c refinement.
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
