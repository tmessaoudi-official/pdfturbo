/**
 * DOCX/MD/TXT export blockers — confirming tests. See ./README.md for the convention.
 * Source research: research-2026-06-15-blockers/raw/docx.md (removed from the repo — see ./README.md)
 *
 * Focus: the Markdown/TXT writers (the DOCX scorecard never covered them). These
 * blockers are now FIXED — the writers carry ordered-list ordinals, list nesting,
 * and images. The tests assert that corrected behavior (formerly it.fails).
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

describe('DOCX/MD blocker MD-1 — Markdown ordered lists lose their ordinals', () => {
  // REACHABLE. flowDocToMarkdown hardcodes "1. " for every ordered item, ignoring
  // listFormat/listOrdinalText and sequence position → a numbered list reads 1. 1. 1.
  it('renders distinct ordinals for successive ordered items', () => {
    const md = flowDocToMarkdown(docOf(page({
      paragraphs: [orderedPara('alpha'), orderedPara('beta'), orderedPara('gamma')],
    })));
    const lines = md.split('\n\n');
    // DESIRED: 2nd item is not another "1." (either "2." or "b)"). TODAY: "1. beta".
    expect(lines[1]).not.toMatch(/^1\./);
  });
});

describe('DOCX/TXT blocker TX-1 — TXT ordered lists lose their ordinals', () => {
  it('renders distinct ordinals for successive ordered items', () => {
    const txt = flowDocToText(docOf(page({
      paragraphs: [orderedPara('alpha'), orderedPara('beta')],
    })));
    const lines = txt.split('\n\n');
    expect(lines[1]).not.toMatch(/^1\./);
  });
});

describe('DOCX/MD blocker MD-2 — Markdown ignores list nesting depth', () => {
  // REACHABLE. listDepth is computed and honored by the DOCX writer, but the MD
  // writer emits every item flush-left regardless of depth.
  it('indents a nested list item', () => {
    const md = flowDocToMarkdown(docOf(page({
      paragraphs: [para({ listType: 'bullet', listDepth: 2, runs: [run('nested')] })],
    })));
    // DESIRED: nesting → leading indent. TODAY: "- nested" flush-left.
    expect(md).toMatch(/^ {2,}- /m);
  });
});

describe('DOCX/MD blocker MD-3 — Markdown silently drops images', () => {
  // REACHABLE. The DOCX writer embeds page.images; the MD writer never reads them,
  // so an image-only page exports as an EMPTY .md while its .docx has the picture.
  it('emits an image reference for an image-only page', () => {
    const img: FlowImage = {
      x: 0, y: 0, width: 100, height: 100, base64: 'iVBORw0KGgo=', mimeType: 'image/png',
    };
    const md = flowDocToMarkdown(docOf(page({ paragraphs: [], images: [img] })));
    // DESIRED: a Markdown image reference. TODAY: "" (content silently lost).
    expect(md).toContain('![');
  });
});
