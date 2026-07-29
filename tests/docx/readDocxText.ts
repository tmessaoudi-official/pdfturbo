/**
 * readDocxText — a TEST-ONLY reader that pulls every paragraph's text back out of a .docx.
 *
 * Used to assert what a save actually produced: unzip → parse `word/document.xml` → concatenate
 * each `w:p`'s `w:t` children. Because it walks `w:p` elements document-wide, it also returns
 * paragraphs nested inside table cells — which is exactly what the DOCX-editor tests assert on.
 *
 * Extracted 2026-07-29 from the concluded Phase-0 spike `src/docx/docxSpike.ts`. Only the read half
 * survived: the spike's `buildDocx`/`editParagraph` rebuilt the document through the `docx` writer,
 * which is the approach the spike verdict REJECTED and which `src/docx/opcEdit.ts` documents as the
 * cardinal rule not to take. Keeping a working implementation of it in `src/` was a trap, so it is
 * gone. To recover the original, find the commit that removed it and read the parent's copy:
 *   git log --diff-filter=D --format=%H -1 -- src/docx/docxSpike.ts   # -> <sha>
 *   git show <sha>^:src/docx/docxSpike.ts
 *
 * Not `*.test.ts`, so vitest does not collect it as a suite (`include: ['tests/**\/*.test.ts']`).
 */
import { unzipSync, strFromU8 } from 'fflate';

/** One string per `w:p`, in document order. */
export interface DocxTextModel {
  paragraphs: string[];
}

/** Read a .docx: unzip → parse word/document.xml → collect each w:p's concatenated w:t text. */
export function readDocxParagraphs(bytes: Uint8Array): DocxTextModel {
  const files = unzipSync(bytes);
  const docXml = files['word/document.xml'];
  if (!docXml) throw new Error('not a Word document: word/document.xml missing');
  const xml = strFromU8(docXml);
  const dom = new DOMParser().parseFromString(xml, 'application/xml');
  if (dom.getElementsByTagName('parsererror').length > 0) {
    throw new Error('word/document.xml is not well-formed XML');
  }
  const paragraphs: string[] = [];
  const ps = dom.getElementsByTagName('w:p');
  for (let i = 0; i < ps.length; i++) {
    const ts = ps[i].getElementsByTagName('w:t');
    let text = '';
    for (let j = 0; j < ts.length; j++) text += ts[j].textContent ?? '';
    paragraphs.push(text);
  }
  return { paragraphs };
}
