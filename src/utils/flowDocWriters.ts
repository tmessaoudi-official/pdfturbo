/**
 * FlowDoc writers — one shared intermediate model (flowDoc.ts), one writer
 * per target flow format. DOCX uses the `docx` package (MIT) loaded via
 * dynamic import so the writer chunk never bloats the initial bundle.
 */

import type { FlowDoc, FlowParagraph, FlowRun } from './flowDoc';

// Word-safe font mapping — PDF subset fonts can't be carried over directly,
// so each run maps to the closest universally-available family.
const FAMILY_TO_WORD: Record<FlowRun['fontFamily'], string> = {
  serif: 'Times New Roman',
  'sans-serif': 'Arial',
  monospace: 'Courier New',
};

function paragraphText(p: FlowParagraph): string {
  return p.runs.map(r => r.text).join('');
}

export function flowDocToText(doc: FlowDoc): string {
  return doc.pages
    .flatMap(page => page.paragraphs.map(paragraphText))
    .filter(t => t.trim().length > 0)
    .join('\n\n');
}

function mdEscapeInline(text: string): string {
  // Escape only the markers we emit, so literal * / # in the PDF text survive.
  return text.replace(/([*\\])/g, '\\$1');
}

export function flowDocToMarkdown(doc: FlowDoc): string {
  const blocks: string[] = [];
  for (const page of doc.pages) {
    for (const p of page.paragraphs) {
      if (!paragraphText(p).trim()) continue;
      const body = p.runs
        .map(r => {
          // Style markers must hug non-space chars — shift edge whitespace outside.
          const lead = r.text.match(/^\s*/)?.[0] ?? '';
          const trail = r.text.match(/\s*$/)?.[0] ?? '';
          const core = mdEscapeInline(r.text.trim());
          if (!core) return r.text;
          let styled = core;
          if (r.bold && r.italic) styled = `***${core}***`;
          else if (r.bold) styled = `**${core}**`;
          else if (r.italic) styled = `*${core}*`;
          return lead + styled + trail;
        })
        .join('');
      blocks.push(p.heading > 0 ? `${'#'.repeat(p.heading)} ${body.trim()}` : body);
    }
  }
  return blocks.join('\n\n');
}

/** Build the DOCX and return it as a base64 string (jsdom-testable core). */
export async function flowDocToDocxBase64(doc: FlowDoc): Promise<string> {
  const docx = await import('docx');
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } = docx;

  const HEADINGS = [undefined, HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3] as const;
  const ALIGN = {
    left: AlignmentType.LEFT,
    center: AlignmentType.CENTER,
    right: AlignmentType.RIGHT,
  } as const;

  const sections = doc.pages.map(page => ({
    properties: {
      page: {
        // PDF points → DOCX twips (1pt = 20 twips)
        size: { width: Math.round(page.width * 20), height: Math.round(page.height * 20) },
      },
    },
    children: page.paragraphs
      .filter(p => paragraphText(p).trim().length > 0)
      .map(
        p =>
          new Paragraph({
            heading: HEADINGS[p.heading],
            alignment: ALIGN[p.alignment],
            bidirectional: p.rtl || undefined,
            children: p.runs.map(
              r =>
                new TextRun({
                  text: r.text,
                  bold: r.bold || undefined,
                  italics: r.italic || undefined,
                  font: FAMILY_TO_WORD[r.fontFamily],
                  // docx half-points
                  size: Math.round(r.fontSize * 2),
                  rightToLeft: r.rtl || undefined,
                  color: r.color,
                })
            ),
          })
      ),
  }));

  const document = new Document({ sections });
  return Packer.toBase64String(document);
}

/** Browser entry point: DOCX as a downloadable Blob. */
export async function flowDocToDocxBlob(doc: FlowDoc): Promise<Blob> {
  const b64 = await flowDocToDocxBase64(doc);
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
}
