/**
 * opcEdit — in-place editing of a .docx OPC (Open Packaging Conventions) package.
 *
 * Phase 1 foundation for the DOCX editor. The cardinal rule (2026-06-20 spike verdict —
 * removed by ac4ef68, recover with
 * `git show ac4ef68^:docs/reviews/2026-06-20-docx-phase0-spike-verdict.md`): edit `word/document.xml`
 * IN PLACE inside the unzipped package and re-zip — NEVER rebuild the document via
 * the `docx` writer, which would drop every OOXML part the model doesn't represent
 * (tables, styles, numbering, headers, comments, drawings). Untouched parts pass
 * through verbatim.
 *
 * Permissive, zero-new-dep: fflate (MIT) for zip I/O, the platform DOMParser /
 * XMLSerializer for the XML edit. Used in the browser and jsdom alike.
 */
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';

const DOCUMENT_PATH = 'word/document.xml';

/** An opened OPC package: every part kept verbatim, keyed by zip path. */
export interface OpcPackage {
  files: Record<string, Uint8Array>;
}

/** Unzip a .docx into its parts (all retained for verbatim pass-through). */
export function openOpc(bytes: Uint8Array): OpcPackage {
  const files = unzipSync(bytes);
  if (!files[DOCUMENT_PATH]) throw new Error(`not a Word document: ${DOCUMENT_PATH} missing`);
  return { files };
}

/** The main document part as a string. */
export function getDocumentXml(opc: OpcPackage): string {
  return strFromU8(opc.files[DOCUMENT_PATH]);
}

/** Replace the main document part (other parts are untouched). */
export function setDocumentXml(opc: OpcPackage, xml: string): void {
  opc.files[DOCUMENT_PATH] = strToU8(xml);
}

/** Re-zip the package back into .docx bytes — all non-edited parts survive verbatim. */
export function packOpc(opc: OpcPackage): Uint8Array {
  return zipSync(opc.files);
}

/**
 * Replace the first `w:t` run whose text equals `oldText` with `newText`, editing
 * the document DOM in place and re-serializing. Returns the XML unchanged when no
 * exact match is found (caller decides what to do). Operates only on the matched
 * run — every other node (tables, styles, …) is serialized back verbatim.
 */
export function replaceTextInXml(xml: string, oldText: string, newText: string): string {
  const dom = new DOMParser().parseFromString(xml, 'application/xml');
  if (dom.getElementsByTagName('parsererror').length > 0) return xml;
  const ts = dom.getElementsByTagName('w:t');
  for (let i = 0; i < ts.length; i++) {
    if ((ts[i].textContent ?? '') === oldText) {
      ts[i].textContent = newText;
      return new XMLSerializer().serializeToString(dom);
    }
  }
  return xml;
}
