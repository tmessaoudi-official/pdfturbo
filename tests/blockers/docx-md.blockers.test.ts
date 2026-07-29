/**
 * DOCX/MD/TXT export blockers — confirming tests. See ./README.md for the convention.
 * Source research: research-2026-06-15-blockers/raw/docx.md (removed from the repo — see ./README.md)
 *
 * Focus: the Markdown/TXT writers (the DOCX scorecard never covered them). All four
 * blockers below were FIXED on 2026-06-15 (CLAUDE.md § "MD/TXT parity") — the writers
 * now carry ordered-list ordinals, list nesting and images. These tests therefore run as
 * REGRESSION guards on the corrected behaviour; they were `it.fails` only before the fix.
 *
 * Each assertion pins the writers' MEASURED output (verified 2026-07-29), not a weak
 * "is not the old broken value" — a writer that emitted nothing would have satisfied the
 * original negative assertions just as well as a correct one does.
 */
import { describe, it, expect } from 'vitest';
import { flowDocToMarkdown, flowDocToText } from '../../src/utils/flowDocWriters';
import type { FlowDoc, FlowPage, FlowParagraph, FlowRun, FlowImage } from '../../src/utils/flowDoc';

const run = (text: string, extra: Partial<FlowRun> = {}): FlowRun => ({
  text, bold: false, italic: false, fontSize: 12, fontFamily: 'serif', rtl: false, ...extra,
});
const para = (extra: Partial<FlowParagraph> = {}): FlowParagraph => ({
  runs: [run('item')], heading: 0, alignment: 'left', rtl: false, ...extra,
});
const page = (extra: Partial<FlowPage> = {}): FlowPage => ({
  width: 600, height: 800, paragraphs: [], ...extra,
});
const docOf = (p: FlowPage): FlowDoc => ({ pages: [p] });

const orderedPara = (text: string): FlowParagraph =>
  para({ listType: 'ordered', listFormat: 'lowerLetter', listOrdinalText: '%1)', runs: [run(text)] });

describe('DOCX/MD blocker MD-1 (FIXED) — Markdown ordered lists carry their ordinals', () => {
  // WAS: flowDocToMarkdown hardcoded "1. " for every ordered item, ignoring listFormat /
  // listOrdinalText and sequence position, so a numbered list read "1. 1. 1.".
  // NOW: orderedMarker + computeOrderedOrdinals honour listFormat ('lowerLetter' here) and
  // the ordinal template ('%1)'), producing a genuine a/b/c sequence.
  it('emits the listFormat-correct marker AND advances the ordinal per item', () => {
    const md = flowDocToMarkdown(docOf(page({
      paragraphs: [orderedPara('alpha'), orderedPara('beta'), orderedPara('gamma')],
    })));
    expect(md).toBe('a) alpha\n\nb) beta\n\nc) gamma');
  });
});

describe('DOCX/TXT blocker TX-1 (FIXED) — TXT ordered lists carry their ordinals', () => {
  it('emits the listFormat-correct marker AND advances the ordinal per item', () => {
    const txt = flowDocToText(docOf(page({
      paragraphs: [orderedPara('alpha'), orderedPara('beta')],
    })));
    expect(txt).toBe('a) alpha\n\nb) beta');
  });
});

describe('DOCX/MD blocker MD-2 (FIXED) — Markdown honours list nesting depth', () => {
  // WAS: listDepth was computed and honoured by the DOCX writer, but the MD writer emitted
  // every item flush-left. NOW: two spaces of indent per depth level ('  '.repeat(listDepth)).
  it('indents a nested list item by two spaces per depth level', () => {
    const md = flowDocToMarkdown(docOf(page({
      paragraphs: [para({ listType: 'bullet', listDepth: 2, runs: [run('nested')] })],
    })));
    expect(md).toBe('    - nested'); // depth 2 → 4 spaces
  });
});

describe('DOCX/MD blocker MD-3 (FIXED) — Markdown exports images', () => {
  // WAS: the DOCX writer embedded page.images but the MD writer never read them, so an
  // image-only page exported as an EMPTY .md while its .docx carried the picture.
  // NOW: a data-URI Markdown image reference.
  it('emits a data-URI image reference for an image-only page', () => {
    const img: FlowImage = {
      x: 0, y: 0, width: 100, height: 100, base64: 'iVBORw0KGgo=', mimeType: 'image/png',
    };
    const md = flowDocToMarkdown(docOf(page({ paragraphs: [], images: [img] })));
    expect(md).toBe('![image](data:image/png;base64,iVBORw0KGgo=)');
  });
});
