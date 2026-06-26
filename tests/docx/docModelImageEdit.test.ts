import { describe, it, expect } from 'vitest';
import { parseDocModel, isDocImageBlock, applyBlocks } from '../../src/docx/docModel';

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const NS = `${W} xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"`;
const drawing = () =>
  `<w:p><w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><wp:extent cx="952500" cy="952500"/></wp:inline></w:drawing></w:r></w:p>`;
const doc = (body: string): string => `<w:document ${NS}><w:body>${body}</w:body></w:document>`;

describe('C2 anchorId stamping', () => {
  it('numbers top-level drawing anchors 0..n in order; hyperlink anchors get none', () => {
    const xml = doc(
      `<w:p><w:r><w:t>text</w:t></w:r></w:p>` +
      drawing() +
      `<w:p><w:hyperlink w:anchor="_Toc1"><w:r><w:t>jump</w:t></w:r></w:hyperlink></w:p>` +
      drawing(),
    );
    const m = parseDocModel(xml);
    const imgs = m.blocks.filter(isDocImageBlock);
    expect(imgs.map(b => b.anchorId)).toEqual([0, undefined, 1]); // drawing, hyperlink, drawing
  });
});

const drawA = (cx: number, cy: number): string =>
  `<w:p><w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><wp:extent cx="${cx}" cy="${cy}"/><a:graphic><a:graphicData><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:spPr><a:xfrm><a:ext cx="${cx}" cy="${cy}"/></a:xfrm></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;

describe('C2 reconcileImageAnchors', () => {
  it('deletes an image whose anchorId is gone, keeps the other byte-exact', () => {
    const xml = doc(drawA(952500, 952500) + `<w:p><w:r><w:t>mid</w:t></w:r></w:p>` + drawA(635000, 635000));
    const m = parseDocModel(xml);
    const kept = m.blocks.filter(b => !(isDocImageBlock(b) && b.anchorId === 0)); // delete anchorId 0
    const out = applyBlocks(xml, kept, undefined, { editImages: true });
    expect((out.match(/<w:drawing/g) || []).length).toBe(1);
    expect(out).toContain('cx="635000"');        // survivor untouched
    expect(out).not.toContain('cx="952500"');     // deleted one gone
  });

  it('rewrites wp:extent + a:ext on resize, byte-identical when unchanged', () => {
    const xml = doc(drawA(952500, 952500));
    const m = parseDocModel(xml);
    const img = m.blocks.find(isDocImageBlock);
    if (!img) throw new Error('image block missing');
    // parseDocModel does NOT merge bytes (that happens in mountDocxEditor); simulate the merged
    // editor state at the original size → byte-identical (no resize).
    img.image = { dataB64: '', mime: 'image/png', widthPt: 75, heightPt: 75 };
    expect(applyBlocks(xml, m.blocks, undefined, { editImages: true })).toContain('cx="952500"');
    // now resize to 150pt
    img.image = { dataB64: '', mime: 'image/png', widthPt: 150, heightPt: 150 };
    const out = applyBlocks(xml, m.blocks, undefined, { editImages: true });
    expect((out.match(/cx="1905000"/g) || []).length).toBe(2); // wp:extent AND a:ext (150*12700)
    expect(out).not.toContain('cx="952500"');
  });

  it('safety guard: a duplicate anchorId skips the pre-pass (verbatim)', () => {
    const xml = doc(drawA(952500, 952500) + drawA(635000, 635000));
    const m = parseDocModel(xml);
    m.blocks.filter(isDocImageBlock)[1].anchorId = 0; // dup id 0 (isDocImageBlock narrows → no cast/!)
    const out = applyBlocks(xml, m.blocks, undefined, { editImages: true });
    expect((out.match(/<w:drawing/g) || []).length).toBe(2); // nothing deleted/resized
  });

  it('WITHOUT editImages (legacy applyParagraphRuns path) images stay verbatim even if a block is gone', () => {
    const xml = doc(drawA(952500, 952500) + drawA(635000, 635000));
    const m = parseDocModel(xml);
    const kept = m.blocks.filter(b => !(isDocImageBlock(b) && b.anchorId === 0));
    const out = applyBlocks(xml, kept); // no opt-in → pre-pass off
    expect((out.match(/<w:drawing/g) || []).length).toBe(2); // both preserved (regression guard)
  });

  it('preserves an UNEXTRACTED-image anchor (anchorId but no image bytes) — never deleted/resized', () => {
    const xml = doc(drawA(952500, 952500));
    const blocks = [{ kind: 'image' as const, anchorId: 0 }]; // no image bytes
    const out = applyBlocks(xml, blocks, undefined, { editImages: true });
    expect((out.match(/<w:drawing/g) || []).length).toBe(1); // preserved
    expect(out).toContain('cx="952500"');                     // not resized
  });

  it('deleting a mixed image+text anchor removes the whole w:p (documented; undo recovers)', () => {
    const mixed = `<w:p><w:r><w:t>see </w:t></w:r><w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><wp:extent cx="952500" cy="952500"/></wp:inline></w:drawing></w:r><w:r><w:t> here</w:t></w:r></w:p>`;
    const xml = doc(mixed + `<w:p><w:r><w:t>after</w:t></w:r></w:p>`);
    const m = parseDocModel(xml);
    const kept = m.blocks.filter(b => !isDocImageBlock(b)); // delete the only image anchor
    const out = applyBlocks(xml, kept, undefined, { editImages: true });
    expect(out).not.toContain('w:drawing');
    expect(out).not.toContain('see ');   // whole para gone (consistent with the opaque-atom model)
    expect(out).toContain('after');       // sibling paragraph intact
  });

  it('leaves untouched hyperlink anchor, table, and cell-nested image alone on a top-level image delete', () => {
    const cellImg = `<w:tbl><w:tr><w:tc><w:p><w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><wp:extent cx="111000" cy="111000"/></wp:inline></w:drawing></w:r></w:p></w:tc></w:tr></w:tbl>`;
    const xml = doc(
      drawA(952500, 952500) +
      `<w:p><w:hyperlink w:anchor="_Toc1"><w:r><w:t>jump</w:t></w:r></w:hyperlink></w:p>` +
      cellImg,
    );
    const m = parseDocModel(xml);
    const kept = m.blocks.filter(b => !(isDocImageBlock(b) && b.anchorId === 0)); // delete the top-level image
    const out = applyBlocks(xml, kept, undefined, { editImages: true });
    expect(out).toContain('jump');                 // hyperlink anchor intact
    expect(out).toContain('<w:tbl');               // table intact
    expect(out).toContain('cx="111000"');          // cell-nested image intact
    expect((out.match(/<w:drawing/g) || []).length).toBe(1); // only the cell drawing remains
    expect(() => parseDocModel(out)).not.toThrow(); // re-parses cleanly
  });
});
