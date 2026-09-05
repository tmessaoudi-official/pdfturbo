/**
 * WS4-D — orphan `word/media/*` GC. The recorded risk is DESTROYING a referenced picture, which is
 * far worse than leaving an orphan, so most of these cases assert what must SURVIVE.
 */
import { describe, it, expect } from 'vitest';
import { strToU8, strFromU8 } from 'fflate';
import { gcOrphanMediaParts, resolveRelTarget } from '../../src/docx/opcGc';
import type { OpcPackage } from '../../src/docx/opcEdit';

const REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const IMG_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image';

const rels = (...entries: Array<{ id: string; target: string; type?: string }>): string =>
  `<?xml version="1.0"?><Relationships xmlns="${REL_NS}">${entries
    .map(e => `<Relationship Id="${e.id}" Type="${e.type ?? IMG_TYPE}" Target="${e.target}"/>`)
    .join('')}</Relationships>`;

/** Build a package from text parts plus named media blobs. */
function pkg(text: Record<string, string>, media: string[] = []): OpcPackage {
  const files: Record<string, Uint8Array> = {};
  for (const [k, v] of Object.entries(text)) files[k] = strToU8(v);
  for (const m of media) files[m] = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
  return { files };
}

/**
 * A body that embeds `ids`, with the namespaces DECLARED as a real `word/document.xml` declares
 * them. The declarations are load-bearing now that liveness is decided by parsing: an undeclared
 * `w:` prefix makes `DOMParser` reject the document, the owner counts as unreadable, and everything
 * it declares stays live — the safe direction, but it means a fixture without them silently stops
 * testing removal at all. Three REMOVE cases went green-to-empty when the parse landed, which is how
 * this was caught.
 */
const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const A_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const bodyWith = (...ids: string[]): string =>
  `<?xml version="1.0"?><w:document xmlns:w="${W_NS}" xmlns:a="${A_NS}" xmlns:r="${R_NS}"><w:body>${ids
    .map(i => `<w:p><w:r><w:drawing><a:blip r:embed="${i}"/></w:drawing></w:r></w:p>`)
    .join('')}</w:body></w:document>`;

describe('resolveRelTarget', () => {
  it('resolves relative to the owning part directory', () => {
    expect(resolveRelTarget('word/_rels/document.xml.rels', 'media/image1.png'))
      .toBe('word/media/image1.png');
  });
  it('collapses .. segments and accepts an absolute target', () => {
    expect(resolveRelTarget('word/_rels/header1.xml.rels', '../media/image2.png'))
      .toBe('media/image2.png');
    expect(resolveRelTarget('word/_rels/document.xml.rels', '/word/media/image3.png'))
      .toBe('word/media/image3.png');
  });
});

describe('gcOrphanMediaParts', () => {
  it('removes a media part whose only relationship is dangling, and drops that relationship', () => {
    const p = pkg({
      'word/document.xml': bodyWith(),                       // the r:embed is gone (image deleted)
      'word/_rels/document.xml.rels': rels({ id: 'rId5', target: 'media/image1.png' }),
    }, ['word/media/image1.png']);

    const r = gcOrphanMediaParts(p);
    expect(r.removedParts).toEqual(['word/media/image1.png']);
    expect(r.removedRels).toEqual(['word/_rels/document.xml.rels#rId5']);
    expect(p.files['word/media/image1.png']).toBeUndefined();
    // The package stays internally consistent: no relationship left pointing at a missing part.
    expect(strFromU8(p.files['word/_rels/document.xml.rels'])).not.toContain('rId5');
  });

  it('KEEPS an image reachable only from a HEADER — the cross-part scan is the whole deliverable', () => {
    // document.xml no longer references anything; the picture lives in header1.xml, a part the
    // editor never models and passes through verbatim. A scan that only read
    // word/_rels/document.xml.rels would delete a picture that is still on every page.
    const p = pkg({
      'word/document.xml': bodyWith(),
      'word/_rels/document.xml.rels': rels(),
      'word/header1.xml': `<?xml version="1.0"?><w:hdr xmlns:w="${W_NS}" xmlns:a="${A_NS}" xmlns:r="${R_NS}"><w:p><w:r><w:drawing><a:blip r:embed="rId1"/></w:drawing></w:r></w:p></w:hdr>`,
      'word/_rels/header1.xml.rels': rels({ id: 'rId1', target: 'media/image1.png' }),
    }, ['word/media/image1.png']);

    expect(gcOrphanMediaParts(p).removedParts).toEqual([]);
    expect(p.files['word/media/image1.png']).toBeDefined();
  });

  it('walks a relationships part spelled .RELS or _RELS/ — OPC part names are case-insensitive (WS7 r9)', () => {
    // `canonicalPart` and `partText` already fold case; the `relsPaths` filter did not, so a header's
    // `.RELS` was never scanned, its image got no `live` entry, and the GC deleted a picture that is
    // on every page. The module's own header says every decision errs towards keeping.
    for (const relsPath of ['word/_rels/header1.xml.RELS', 'word/_RELS/header1.xml.rels']) {
      const p = pkg({
        'word/document.xml': bodyWith(),
        'word/_rels/document.xml.rels': rels(),
        'word/header1.xml': `<?xml version="1.0"?><w:hdr xmlns:w="${W_NS}" xmlns:a="${A_NS}" xmlns:r="${R_NS}"><w:p><w:r><w:drawing><a:blip r:embed="rId1"/></w:drawing></w:r></w:p></w:hdr>`,
        [relsPath]: rels({ id: 'rId1', target: 'media/image1.png' }),
      }, ['word/media/image1.png']);
      expect(gcOrphanMediaParts(p).removedParts).toEqual([]);
      expect(p.files['word/media/image1.png']).toBeDefined();
    }
  });

  it('drops a dangling relationship through a .RELS part too — the cleanup must see what the scan sees', () => {
    const p = pkg({
      'word/document.xml': bodyWith(),
      'word/_rels/document.xml.RELS': rels({ id: 'rId5', target: 'media/image1.png' }),
    }, ['word/media/image1.png']);
    expect(gcOrphanMediaParts(p)).toEqual({
      removedParts: ['word/media/image1.png'], removedRels: ['word/_rels/document.xml.RELS#rId5'],
    });
  });

  it('KEEPS a media part whose relationship id is still used in the document', () => {
    const p = pkg({
      'word/document.xml': bodyWith('rId9'),
      'word/_rels/document.xml.rels': rels({ id: 'rId9', target: 'media/image1.png' }),
    }, ['word/media/image1.png']);
    expect(gcOrphanMediaParts(p).removedParts).toEqual([]);
  });

  it('KEEPS everything when the owning part is MISSING — fail towards keeping', () => {
    // A .rels whose owner part is not in the package: we cannot know what it references, so every
    // relationship it declares is live.
    const p = pkg({
      'word/_rels/document.xml.rels': rels({ id: 'rId3', target: 'media/image1.png' }),
    }, ['word/media/image1.png']);
    expect(gcOrphanMediaParts(p).removedParts).toEqual([]);
  });

  it('KEEPS everything when the owning part is BINARY despite an .xml name', () => {
    // `strFromU8` does NOT throw on non-UTF-8 — it substitutes replacement characters. So a binary
    // part named `.xml` decodes to garbage, the garbage contains no "rIdN", and a naive scan would
    // call every one of its relationships dangling and delete live images. This case failed for
    // exactly that reason before `partText` learned to reject non-XML text.
    const p = pkg({
      'word/_rels/document.xml.rels': rels({ id: 'rId3', target: 'media/image1.png' }),
    }, ['word/media/image1.png', 'word/document.xml']);
    expect(gcOrphanMediaParts(p).removedParts).toEqual([]);
  });

  it('does not match rId7 inside rId70', () => {
    // Ids are compared as whole ATTRIBUTE VALUES, so `rId7` cannot match inside `rId70`. The
    // property is what matters and is why this case stays: the regex scan this module replaced had
    // to match the id WITH its surrounding quotes to get here, and a bare `includes` left the image
    // owning rId7 "referenced" by an unrelated rId70 forever — an orphan never collected, the
    // silent-failure direction. The comment used to describe that quoting trick; the code it
    // described is gone, the guarantee is not. [WS7 round 6]
    const p = pkg({
      'word/document.xml': bodyWith('rId70'),
      'word/_rels/document.xml.rels': rels(
        { id: 'rId7', target: 'media/image1.png' },
        { id: 'rId70', target: 'media/image2.png' },
      ),
    }, ['word/media/image1.png', 'word/media/image2.png']);

    const r = gcOrphanMediaParts(p);
    expect(r.removedParts).toEqual(['word/media/image1.png']);
    expect(p.files['word/media/image2.png']).toBeDefined();
  });

  it('removes a media part that no relationship mentions at all', () => {
    const p = pkg({
      'word/document.xml': bodyWith(),
      'word/_rels/document.xml.rels': rels(),
    }, ['word/media/image1.png']);
    expect(gcOrphanMediaParts(p).removedParts).toEqual(['word/media/image1.png']);
  });

  it('is a no-op on a package with no orphan — every part byte-identical', () => {
    const p = pkg({
      'word/document.xml': bodyWith('rId1'),
      'word/_rels/document.xml.rels': rels({ id: 'rId1', target: 'media/image1.png' }),
      'word/styles.xml': '<?xml version="1.0"?><w:styles/>',
    }, ['word/media/image1.png']);
    const before = Object.fromEntries(Object.entries(p.files).map(([k, v]) => [k, Array.from(v)]));

    const r = gcOrphanMediaParts(p);
    expect(r).toEqual({ removedParts: [], removedRels: [] });
    expect(Object.fromEntries(Object.entries(p.files).map(([k, v]) => [k, Array.from(v)]))).toEqual(before);
  });

  it('never removes a non-media part, however unreferenced', () => {
    // Only word/media/** is eligible. An unreferenced styles.xml or customXml item is not garbage
    // to this pass — deleting one would break the document for a refcount it has no business
    // reasoning about.
    const p = pkg({
      'word/document.xml': bodyWith(),
      'word/_rels/document.xml.rels': rels({ id: 'rId2', target: 'customXml/item1.xml', type: 'http://x/customXml' }),
      'customXml/item1.xml': '<x/>',
      'word/styles.xml': '<?xml version="1.0"?><w:styles/>',
    });
    expect(gcOrphanMediaParts(p).removedParts).toEqual([]);
    expect(p.files['customXml/item1.xml']).toBeDefined();
    expect(p.files['word/styles.xml']).toBeDefined();
  });

  it('KEEPS everything when a .rels part itself is unreadable — the one path that failed toward DELETING', () => {
    // Found by the WS5 audit, in this module's own code and against its own stated invariant. An
    // undecodable `.rels` was `continue`d, so every media target it declares never entered the live
    // set and was then collected. A UTF-16-encoded `.rels` is legal XML and decodes to replacement
    // characters through strFromU8 — so a perfectly valid DOCX could lose its header image.
    //
    // We cannot know WHICH targets an unreadable .rels declares, so the only safe answer is to
    // collect NOTHING on that pass: the reachability graph is incomplete, and a partial graph is
    // exactly what makes a GC delete live data.
    const p = pkg({
      'word/document.xml': bodyWith(),
      'word/_rels/document.xml.rels': rels({ id: 'rId1', target: 'media/image1.png' }),
      'word/header1.xml': `<?xml version="1.0"?><w:hdr xmlns:w="${W_NS}"/>`,
    }, ['word/media/image1.png', 'word/_rels/header1.xml.rels']);

    const r = gcOrphanMediaParts(p);
    expect(r.removedParts).toEqual([]);
    expect(p.files['word/media/image1.png']).toBeDefined();
  });

  it("KEEPS an image referenced with SINGLE-quoted attribute values", () => {
    // XML permits `r:embed='rId1'`, and header/footer parts are passed through verbatim by the
    // editor — so a document written by a tool that single-quotes had its header image collected.
    // Every fixture in this file was double-quoted, which is why nothing here caught it.
    const p = pkg({
      'word/document.xml': bodyWith(),
      'word/_rels/document.xml.rels': rels(),
      'word/header1.xml': `<?xml version='1.0'?><w:hdr xmlns:w="${W_NS}" xmlns:a="${A_NS}" xmlns:r="${R_NS}"><w:r><w:drawing><a:blip r:embed='rId1'/></w:drawing></w:r></w:hdr>`,
      'word/_rels/header1.xml.rels': rels({ id: 'rId1', target: 'media/image1.png' }),
    }, ['word/media/image1.png']);

    expect(gcOrphanMediaParts(p).removedParts).toEqual([]);
    expect(p.files['word/media/image1.png']).toBeDefined();
  });

  it("KEEPS an image whose .rels itself uses SINGLE-quoted Id/Target", () => {
    // Round 1 taught the OWNER scan both quote styles and left the .rels parser double-quote-only,
    // so Id and Target came back undefined, the entry was skipped, and the part entered neither
    // `live` nor `dangling` — deleted, with its relationship left behind. A well-formed document.
    const p = pkg({
      'word/document.xml': bodyWith('rId4'),
      'word/_rels/document.xml.rels':
        `<?xml version="1.0"?><Relationships xmlns="${REL_NS}"><Relationship Id='rId4' Type='${IMG_TYPE}' Target='media/image1.png'/></Relationships>`,
    }, ['word/media/image1.png']);

    expect(gcOrphanMediaParts(p).removedParts).toEqual([]);
    expect(p.files['word/media/image1.png']).toBeDefined();
  });

  it("KEEPS a media part named by a SINGLE-quoted Content-Types Override", () => {
    const p = pkg({
      '[Content_Types].xml':
        "<?xml version='1.0'?><Types><Override PartName='/word/media/image9.emf' ContentType='image/x-emf'/></Types>",
      'word/document.xml': bodyWith(),
      'word/_rels/document.xml.rels': rels(),
    }, ['word/media/image9.emf']);

    expect(gcOrphanMediaParts(p).removedParts).toEqual([]);
  });

  it("REMOVES through a single-quoted .rels, and drops the element too", () => {
    // The case the panel found MISSING: both single-quote tests were KEEP cases, so the removal
    // REWRITE — which carried its own double-quote-only Id pattern — went unexercised. It deleted
    // the part, left the <Relationship> behind, and reported a removal that had not happened: a
    // dangling package, which Word reports as unreadable content and which is worse than the orphan.
    const p = pkg({
      'word/document.xml': bodyWith(),                       // nothing references rId9
      'word/_rels/document.xml.rels':
        `<?xml version="1.0"?><Relationships xmlns="${REL_NS}"><Relationship Id='rId9' Type='${IMG_TYPE}' Target='media/image1.png'/></Relationships>`,
    }, ['word/media/image1.png']);

    const r = gcOrphanMediaParts(p);
    expect(r.removedParts).toEqual(['word/media/image1.png']);
    expect(r.removedRels).toEqual(['word/_rels/document.xml.rels#rId9']);
    // …and `removedRels` must be TRUE, not just reported.
    expect(strFromU8(p.files['word/_rels/document.xml.rels'])).not.toContain('rId9');
  });

  it('KEEPS an image whose Target is PERCENT-ENCODED — OPC requires it for non-ASCII names', () => {
    // `word/media/図.png` is written `media/%E5%9B%B3.png`. Comparing the two raw made the part look
    // absent from the package, so it never entered the live set and a referenced image was deleted.
    const p = pkg({
      'word/document.xml': bodyWith('rId1'),
      'word/_rels/document.xml.rels': rels({ id: 'rId1', target: 'media/%E5%9B%B3.png' }),
    }, ['word/media/図.png']);

    expect(gcOrphanMediaParts(p).removedParts).toEqual([]);
    expect(p.files['word/media/図.png']).toBeDefined();
  });

  it('KEEPS an image whose Target carries an XML ENTITY', () => {
    // A filename with `&` must be written `&amp;` in the attribute. The parser resolves it; a regex
    // reading the raw text did not, and deleted the live part.
    const p = pkg({
      'word/document.xml': bodyWith('rId1'),
      'word/_rels/document.xml.rels': rels({ id: 'rId1', target: 'media/logo&amp;v2.png' }),
    }, ['word/media/logo&v2.png']);

    expect(gcOrphanMediaParts(p).removedParts).toEqual([]);
  });

  it('KEEPS an image behind a NAMESPACE-PREFIXED <pr:Relationship> element', () => {
    // Legal OPC. `<Relationship\b` never matched it, so nothing parsed, nothing entered live, and a
    // referenced image was deleted. Matching by namespace rather than by spelling settles it.
    const p = pkg({
      'word/document.xml': bodyWith('rId1'),
      'word/_rels/document.xml.rels':
        `<?xml version="1.0"?><pr:Relationships xmlns:pr="${REL_NS}"><pr:Relationship Id="rId1" Type="${IMG_TYPE}" Target="media/image1.png"/></pr:Relationships>`,
    }, ['word/media/image1.png']);

    expect(gcOrphanMediaParts(p).removedParts).toEqual([]);
  });

  it('ignores a SINGLE-quoted external relationship, as it does a double-quoted one', () => {
    // The two legal quote styles gave OPPOSITE results on identical semantics: the single-quoted
    // external target was resolved as an internal part path and its co-located media part deleted.
    const p = pkg({
      'word/document.xml': bodyWith(),
      'word/_rels/document.xml.rels':
        `<?xml version="1.0"?><Relationships xmlns="${REL_NS}"><Relationship Id='rId7' Type='${IMG_TYPE}' Target='media/ext.png' TargetMode='External'/></Relationships>`,
    }, ['word/media/ext.png']);

    // No INTERNAL relationship names it, so it is a genuine orphan and goes — but it must go as an
    // orphan, not because an external target was mistaken for a local path.
    const r = gcOrphanMediaParts(p);
    expect(r.removedRels).toEqual([]);   // the external rel is skipped, never reported dangling
    expect(r.removedParts).toEqual(['word/media/ext.png']);
  });

  it('KEEPS an image whose ZIP ENTRY is itself percent-encoded', () => {
    // OPC allows the entry to be stored encoded OR decoded. Round 3 decoded only the Target, which
    // lost the image on a conformant package where BOTH are encoded — deleting where the previous
    // implementation had kept, the one direction a rewrite must never take. Both sides are now
    // compared through one canonical key.
    const p = pkg({
      'word/document.xml': bodyWith('rId1'),
      'word/_rels/document.xml.rels': rels({ id: 'rId1', target: 'media/%E5%9B%B3.png' }),
    }, ['word/media/%E5%9B%B3.png']);

    expect(gcOrphanMediaParts(p).removedParts).toEqual([]);
    expect(p.files['word/media/%E5%9B%B3.png']).toBeDefined();
  });

  it('KEEPS an image whose Target differs from the entry only in CASE', () => {
    // OPC defines part-name equivalence as case-insensitive ASCII.
    const p = pkg({
      'word/document.xml': bodyWith('rId1'),
      'word/_rels/document.xml.rels': rels({ id: 'rId1', target: 'Media/Image1.PNG' }),
    }, ['word/media/image1.png']);

    expect(gcOrphanMediaParts(p).removedParts).toEqual([]);
  });

  it('KEEPS an image whose rId is written as a CHARACTER REFERENCE in the owner', () => {
    // The owner side decided liveness by raw text `includes`, so `r:embed="rId&#55;"` — legal XML
    // meaning rId7 — made a live image look orphaned. Parsing resolves it on both halves.
    const p = pkg({
      'word/document.xml':
        `<?xml version="1.0"?><w:document xmlns:w="${W_NS}" xmlns:a="${A_NS}" xmlns:r="${R_NS}"><w:body><w:p><w:r><w:drawing><a:blip r:embed="rId&#55;"/></w:drawing></w:r></w:p></w:body></w:document>`,
      'word/_rels/document.xml.rels': rels({ id: 'rId7', target: 'media/image1.png' }),
    }, ['word/media/image1.png']);

    expect(gcOrphanMediaParts(p).removedParts).toEqual([]);
  });

  it('KEEPS a media part named by a [Content_Types].xml Override', () => {
    // A media extension with no `Default` is typed by an Override instead. Deleting the part while
    // the Override still names it leaves a dangling declaration that strict readers reject, so an
    // Override-named media part counts as reachable — the same fail-towards-keeping rule as the
    // unreadable-owner cases above.
    const p = pkg({
      '[Content_Types].xml':
        '<?xml version="1.0"?><Types><Override PartName="/word/media/image1.emf" ContentType="image/x-emf"/></Types>',
      'word/document.xml': bodyWith(),
      'word/_rels/document.xml.rels': rels({ id: 'rId1', target: 'media/image1.emf' }),
    }, ['word/media/image1.emf']);

    expect(gcOrphanMediaParts(p).removedParts).toEqual([]);
    expect(p.files['word/media/image1.emf']).toBeDefined();
  });

  it('ignores an EXTERNAL relationship rather than resolving it as a part path', () => {
    const p = pkg({
      'word/document.xml': bodyWith(),
      'word/_rels/document.xml.rels':
        `<?xml version="1.0"?><Relationships xmlns="${REL_NS}"><Relationship Id="rId4" Type="${IMG_TYPE}" Target="http://example.test/media/image1.png" TargetMode="External"/></Relationships>`,
    }, ['word/media/image1.png']);
    // The external target must not be read as `word/media/image1.png` and thereby keep the local
    // orphan alive.
    expect(gcOrphanMediaParts(p).removedParts).toEqual(['word/media/image1.png']);
  });
});
