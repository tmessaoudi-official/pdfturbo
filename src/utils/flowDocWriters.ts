/**
 * FlowDoc writers — one shared intermediate model (flowDoc.ts), one writer
 * per target flow format. DOCX uses the `docx` package (MIT) loaded via
 * dynamic import so the writer chunk never bloats the initial bundle.
 */

import type { FlowDoc, FlowParagraph, FlowRun, FlowImage } from './flowDoc';

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
    .flatMap(page => page.paragraphs.map(p => {
      const text = paragraphText(p);
      if (p.listType === 'bullet') return `• ${text}`;
      if (p.listType === 'ordered') return `1. ${text}`;
      return text;
    }))
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
      if (p.listType === 'bullet') { blocks.push(`- ${body.trim()}`); continue; }
      if (p.listType === 'ordered') { blocks.push(`1. ${body.trim()}`); continue; }
      blocks.push(p.heading > 0 ? `${'#'.repeat(p.heading)} ${body.trim()}` : body);
    }
  }
  return blocks.join('\n\n');
}

/** Build the DOCX and return it as a base64 string (jsdom-testable core). */
export async function flowDocToDocxBase64(doc: FlowDoc): Promise<string> {
  const docx = await import('docx');
  const { Document, Packer, Paragraph, TextRun, ImageRun, HeadingLevel, AlignmentType, LevelFormat } = docx;

  const HEADINGS = [undefined, HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3] as const;
  const ALIGN = {
    left: AlignmentType.LEFT,
    center: AlignmentType.CENTER,
    right: AlignmentType.RIGHT,
  } as const;

  // Assign ordered-list instance numbers: consecutive ordered paragraphs share
  // one instance; a non-ordered paragraph between them starts a new instance.
  // A different instance value causes Word to restart numbering from 1.
  const orderedInstances = new Map<FlowParagraph, number>();
  let instanceCounter = 0;
  let inOrderedRun = false;
  for (const page of doc.pages) {
    for (const p of page.paragraphs) {
      if (p.listType === 'ordered') {
        if (!inOrderedRun) { instanceCounter++; inOrderedRun = true; }
        orderedInstances.set(p, instanceCounter);
      } else {
        inOrderedRun = false;
      }
    }
  }

  const sections = doc.pages.map(page => {
    const textChildren = page.paragraphs
      .filter(p => paragraphText(p).trim().length > 0)
      .map(p => {
        const textRuns = p.runs.map(
          r =>
            new TextRun({
              text: r.text,
              bold: r.bold || undefined,
              italics: r.italic || undefined,
              font: FAMILY_TO_WORD[r.fontFamily],
              size: Math.round(r.fontSize * 2), // docx half-points
              rightToLeft: r.rtl || undefined,
              color: r.color,
            })
        );
        return new Paragraph({
          heading: p.listType ? undefined : HEADINGS[p.heading],
          alignment: ALIGN[p.alignment],
          bidirectional: p.rtl || undefined,
          bullet: p.listType === 'bullet' ? { level: p.listDepth ?? 0 } : undefined,
          numbering: p.listType === 'ordered'
            ? { reference: 'ordered-list', level: p.listDepth ?? 0, instance: orderedInstances.get(p) }
            : undefined,
          children: textRuns,
        });
      });

    const imageChildren = (page.images ?? []).map((img: FlowImage) => {
      const bin = atob(img.base64);
      const data = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i);
      return new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new ImageRun({
          data,
          transformation: {
            // PDF points → pixels at 96 DPI (1pt = 96/72 px)
            width: Math.round(img.width * 96 / 72),
            height: Math.round(img.height * 96 / 72),
          },
          type: img.mimeType === 'image/jpeg' ? 'jpg' : 'png',
        })],
      });
    });

    return {
      properties: {
        page: {
          // PDF points → DOCX twips (1pt = 20 twips)
          size: { width: Math.round(page.width * 20), height: Math.round(page.height * 20) },
        },
      },
      children: [...textChildren, ...imageChildren],
    };
  });

  const numberingConfig = instanceCounter > 0
    ? {
        config: [{
          reference: 'ordered-list',
          levels: [{
            level: 0,
            format: LevelFormat.DECIMAL,
            text: '%1.',
            alignment: AlignmentType.START,
          }],
        }],
      }
    : undefined;

  const document = new Document({ sections, numbering: numberingConfig });
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
