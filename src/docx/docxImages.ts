/**
 * DOCX inline-image extraction for the DOCX→PDF export (Feature 5, Track B).
 *
 * Images are read DIRECTLY from the OPC package (document.xml + rels + word/media) and kept
 * SEPARATE from the editable DocModel — the in-place save path (`buildRun`) rebuilds every model
 * run as a text `w:r`, so routing image data through the model would corrupt the `w:drawing`.
 * This read-only channel feeds `docModelToPdfBytes({ images })` only; the save path is untouched.
 *
 * Scope: top-level paragraphs' inline images (`w:drawing` → `a:blip/@r:embed`), PNG/JPEG only
 * (pdf-lib embeds those). Images nested inside table cells and non-PNG/JPEG media are skipped.
 */

const EMU_PER_PT = 12700;

export interface DocImage {
  /** Index among the document's TOP-LEVEL w:p/w:tbl blocks that this image sits in. */
  blockIndex: number;
  /** Base64 of the raw image bytes (no data: prefix). */
  dataB64: string;
  mime: 'image/png' | 'image/jpeg';
  /** On-page size in points (from wp:extent EMU); 0 when the extent is absent. */
  widthPt: number;
  heightPt: number;
}

function strFrom(bytes: Uint8Array | undefined): string | null {
  if (!bytes) return null;
  try { return new TextDecoder().decode(bytes); } catch { return null; }
}

/** PNG magic `89 50 4E 47`; JPEG `FF D8 FF`. Returns null for anything pdf-lib can't embed. */
function sniffMime(bytes: Uint8Array): 'image/png' | 'image/jpeg' | null {
  if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  return null;
}

function bytesToB64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

/** Build the relationship Id → Target map from word/_rels/document.xml.rels. */
function relMap(files: Record<string, Uint8Array>): Map<string, string> {
  const map = new Map<string, string>();
  const xml = strFrom(files['word/_rels/document.xml.rels']);
  if (!xml) return map;
  const dom = new DOMParser().parseFromString(xml, 'application/xml');
  for (const rel of Array.from(dom.getElementsByTagName('*'))) {
    if (rel.localName !== 'Relationship') continue;
    const id = rel.getAttribute('Id');
    const target = rel.getAttribute('Target');
    if (id && target) map.set(id, target);
  }
  return map;
}

/** localName-based attribute read (namespace-prefix-agnostic, e.g. r:embed). */
function attrLocal(el: Element, local: string): string | null {
  const a = Array.from(el.attributes).find(at => at.localName === local);
  return a ? a.value : null;
}

/** First descendant with the given localName, or null. */
function firstByLocal(root: Element, local: string): Element | null {
  for (const el of Array.from(root.getElementsByTagName('*'))) {
    if (el.localName === local) return el;
  }
  return null;
}

/**
 * Extract inline images from an unzipped DOCX package. Returns one DocImage per top-level
 * paragraph that contains a resolvable PNG/JPEG drawing, in document order. Never throws.
 */
export function extractDocImages(files: Record<string, Uint8Array>): DocImage[] {
  const out: DocImage[] = [];
  try {
    const docXml = strFrom(files['word/document.xml']);
    if (!docXml) return out;
    const dom = new DOMParser().parseFromString(docXml, 'application/xml');
    if (dom.getElementsByTagName('parsererror').length > 0) return out;
    const body = firstByLocal(dom.documentElement, 'body');
    if (!body) return out;
    const rels = relMap(files);

    const blocks = Array.from(body.children).filter(c => c.localName === 'p' || c.localName === 'tbl');
    blocks.forEach((block, blockIndex) => {
      if (block.localName !== 'p') return; // nested-in-table images are out of scope (ceiling)
      const blip = firstByLocal(block, 'blip');
      if (!blip) return;
      const relId = attrLocal(blip, 'embed') ?? attrLocal(blip, 'link');
      if (!relId) return;
      const target = rels.get(relId);
      if (!target) return;
      const path = target.startsWith('/') ? target.slice(1) : `word/${target}`;
      const bytes = files[path] ?? files[target];
      if (!bytes) return;
      const mime = sniffMime(bytes);
      if (!mime) return;

      let widthPt = 0;
      let heightPt = 0;
      const extent = firstByLocal(block, 'extent');
      if (extent) {
        const cx = Number(extent.getAttribute('cx'));
        const cy = Number(extent.getAttribute('cy'));
        if (Number.isFinite(cx) && cx > 0) widthPt = cx / EMU_PER_PT;
        if (Number.isFinite(cy) && cy > 0) heightPt = cy / EMU_PER_PT;
      }
      out.push({ blockIndex, dataB64: bytesToB64(bytes), mime, widthPt, heightPt });
    });
  } catch {
    return out;
  }
  return out;
}
