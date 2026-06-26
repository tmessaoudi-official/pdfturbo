/**
 * Sub-project B sub-slice 1 — real-Chrome guard for new-image INSERT.
 *
 * jsdom (opcImagePart, docImageInsert, docxToolbar) covers the OPC mint, the materialize engine,
 * and the toolbar node-insert. This exercises what jsdom can't: the real toolbar file-pick flow
 * (sniff + createImageBitmap dims), the image rendering in the live ProseMirror view, and a save
 * that round-trips a brand-new w:drawing + word/media part + Content-Types Default + image rel into
 * a document that had NONE.
 */
import { describe, it, expect } from 'vitest';
import { page } from '@vitest/browser/context';
import { zipSync, strToU8, strFromU8 } from 'fflate';
import { mountDocxEditor } from '../../src/docx/docxProseMirror';
import { openOpc, getDocumentXml } from '../../src/docx/opcEdit';

// A genuinely decodable PNG built at runtime (a minimal 1×1 PNG fails createImageBitmap).
async function makePngBytes(w: number, h: number): Promise<Uint8Array> {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d context');
  ctx.fillStyle = '#3366cc';
  ctx.fillRect(0, 0, w, h);
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(b => { if (b) resolve(b); else reject(new Error('toBlob null')); }, 'image/png');
  });
  return new Uint8Array(await blob.arrayBuffer());
}

// A text-only docx: NO image, NO png Default, empty document rels → proves the full mint path.
const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;
const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rIdDoc" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;
const DOC_TEXT = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body><w:p><w:r><w:t>Hello</w:t></w:r></w:p></w:body></w:document>`;
const DOC_RELS_EMPTY = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`;
function makeTextDocx(): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(CONTENT_TYPES),
    '_rels/.rels': strToU8(ROOT_RELS),
    'word/document.xml': strToU8(DOC_TEXT),
    'word/_rels/document.xml.rels': strToU8(DOC_RELS_EMPTY),
  });
}

function imgPosOf(view: { state: { doc: { descendants: (f: (n: { type: { name: string } }, p: number) => void) => void } } }): number {
  let pos = -1;
  view.state.doc.descendants((n, p) => { if (n.type.name === 'docx_image') pos = p; });
  return pos;
}

async function waitFor(cond: () => boolean, ms = 3000): Promise<void> {
  const start = performance.now();
  while (!cond()) {
    if (performance.now() - start > ms) throw new Error('waitFor timeout');
    await new Promise(r => { setTimeout(r, 20); });
  }
}

describe('DOCX editor — new-image insert (real browser)', () => {
  it('toolbar file-pick inserts an image; save mints w:drawing + media part + png Default + rel', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const handle = mountDocxEditor(container, makeTextDocx());
    const view = handle.view;
    expect(imgPosOf(view)).toBe(-1); // none to start

    // Drive the REAL toolbar file-pick: set the hidden input's files + fire change.
    const pngBytes = await makePngBytes(40, 30);
    const tbDom = handle.toolbarDom;
    if (!tbDom) throw new Error('toolbar dom missing');
    const input = tbDom.querySelector('[data-act="insertImageFile"]') as HTMLInputElement;
    expect(input).not.toBeNull();
    const file = new File([pngBytes as BlobPart], 'pic.png', { type: 'image/png' });
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event('change'));

    // handlePick is async (createImageBitmap) → wait for the node to land.
    await waitFor(() => imgPosOf(view) >= 0);

    const imgEl = container.querySelector('img[data-docx-image]') as HTMLImageElement;
    expect(imgEl).not.toBeNull();
    const inserted = view.state.doc.nodeAt(imgPosOf(view));
    expect(inserted?.attrs.anchorId).toBe(-1);   // new image (no parse-time identity yet)
    expect(Number(inserted?.attrs.widthPt)).toBeCloseTo(30, 1); // 40px × 0.75 pt/px, measured from the bitmap

    // Save → reopen → the brand-new drawing + OPC parts exist.
    const opc = openOpc(handle.save());
    expect(getDocumentXml(opc)).toContain('w:drawing');
    expect(opc.files['word/media/image1.png']).toBeTruthy();
    expect(opc.files['word/media/image1.png']).toEqual(pngBytes); // bytes round-trip
    const ct = strFromU8(opc.files['[Content_Types].xml']);
    expect(ct).toContain('Extension="png"'); // Default added by ensureImagePart (doc had none)
    const rels = strFromU8(opc.files['word/_rels/document.xml.rels']);
    expect(rels).toContain('relationships/image');

    await page.screenshot({ path: '../../qa-shots/b-insert/inserted.png', element: container }).catch(() => {});
    handle.destroy();
    container.remove();
  });
});
