/**
 * WS4-D — garbage-collect `word/media/*` parts that nothing references any more.
 *
 * Deleting an image in the DOCX editor removed its anchor paragraph but left the bytes in the
 * package: `word/media/imageN.png` survived as an unreferenced part, recoverable by renaming the
 * file to `.zip`. The picture vanished in the editor AND in Word, which is what made it convincing.
 *
 * **The scan's completeness IS the deliverable** — the recorded risk is destroying a picture that is
 * still referenced, which is far worse than leaving an orphan. So every decision here errs towards
 * KEEPING:
 *
 *   - every `_rels/*.rels` part is walked, not just `word/_rels/document.xml.rels` — a header,
 *     footer, footnote, endnote, comment or unmodelled part reaches its images through its own
 *     `.rels`, and those parts are passed through verbatim by the editor;
 *   - a relationship counts as LIVE if its Id appears ANYWHERE in the owning part's text, which
 *     over-approximates deliberately rather than enumerating every attribute Word hangs an rId on;
 *   - an owner that is missing, binary or unreadable makes ALL of its relationships live, and an
 *     unreadable `.rels` ABORTS the pass — we cannot know what it references;
 *   - a part named by a `[Content_Types].xml` `<Override>` is live;
 *   - only `word/media/**` is ever removed, whatever the refcount says.
 *
 * **This scan is PARSED, not pattern-matched, and that is the whole story of its second version.**
 * The first was built from regexes, and three consecutive certification rounds each found a fresh
 * shape of perfectly legal XML that made it delete a LIVE image: single-quoted attribute values, the
 * removal pass carrying its own `"`-only Id pattern, percent-encoded `Target`s, XML entity
 * references, and namespace-prefixed elements (`<pr:Relationship>`). Each round patched the shape
 * that was found and the next round found another. A regex scan over arbitrary OPC cannot be made
 * correct one round at a time; `DOMParser` — which `opcEdit`/`opcParts` already use on this very
 * package — settles quoting, entities, namespaces and whitespace by construction.
 * [WS7 rounds 1-3; rewritten 2026-09-04 on the developer's ruling]
 */
import { strFromU8, strToU8 } from 'fflate';
import type { OpcPackage } from './opcEdit';

/** What a GC pass removed. Empty arrays ⇒ the package is byte-identical afterwards. */
export interface GcResult {
  /** Part paths deleted, e.g. `word/media/image2.png`. */
  removedParts: string[];
  /** Dangling relationships dropped, as `<owning .rels path>#<Id>`. */
  removedRels: string[];
}

const MEDIA_PREFIX = 'word/media/';
const REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';

const parseXml = (xml: string): Document => new DOMParser().parseFromString(xml, 'application/xml');
const serializeXml = (dom: Document): string => new XMLSerializer().serializeToString(dom);

/** True when parsing failed — reported as a `parsererror` element rather than a throw. */
function parseFailed(dom: Document): boolean {
  return dom.getElementsByTagName('parsererror').length > 0 || dom.documentElement === null;
}

/** `word/_rels/document.xml.rels` → `word/document.xml`; `_rels/.rels` → null (the package root). */
function ownerOf(relsPath: string): string | null {
  const m = /^(.*)_rels\/([^/]+)\.rels$/.exec(relsPath);
  if (!m) return null;
  const [, dir, name] = m;
  // `_rels/.rels` describes the PACKAGE itself: no owning part to scan, so its relationships are
  // always treated as live.
  return name.length === 0 ? null : `${dir}${name}`;
}

/**
 * Resolve a relationship Target against its owning part's directory, collapsing `.` and `..`.
 *
 * **Percent-DECODED.** OPC requires percent-encoding for a part name outside the pchar set, so a
 * document from a non-English generator carries `Target="media/%E5%9B%B3.png"` while the ZIP entry
 * is `word/media/図.png`. Comparing those two raw made the part look absent from the package, so it
 * never entered the live set and a referenced image was DELETED. A malformed escape is used
 * verbatim rather than allowed to resolve to something else.
 */
export function resolveRelTarget(relsPath: string, target: string): string {
  let decoded = target;
  try {
    decoded = decodeURIComponent(target);
  } catch {
    // Not valid percent-encoding — keep it as written; over-keeping is the safe direction.
  }
  if (decoded.startsWith('/')) return decoded.slice(1);
  const dir = relsPath.replace(/_rels\/[^/]*\.rels$/, '');
  const out: string[] = [];
  for (const seg of `${dir}${decoded}`.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') out.pop();
    else out.push(seg);
  }
  return out.join('/');
}

/** Decode a part as XML text, or null when it is absent or does not look like XML. */
function partText(opc: OpcPackage, path: string): string | null {
  const bytes = opc.files[path];
  if (!bytes) return null;
  if (!/\.(xml|rels)$/i.test(path)) return null;
  let text: string;
  try {
    text = strFromU8(bytes);
  } catch {
    return null;
  }
  // `strFromU8` does NOT throw on bytes that are not valid UTF-8 — it substitutes replacement
  // characters. A binary part named `.xml` would decode to garbage containing no `"rIdN"`, and every
  // relationship it owns would be judged dangling: live images deleted. A try/catch around a decoder
  // that does not throw is not a guard.
  return text.includes('<') && !text.includes('�') ? text : null;
}

/**
 * Every `<Relationship>` element, whatever namespace prefix it carries.
 *
 * `getElementsByTagNameNS` matches by NAMESPACE, so `<Relationship>` and `<pr:Relationship>` are the
 * same element — which a `<Relationship\b` pattern is not. The fallback covers a `.rels` declaring
 * no namespace at all: out of spec, but such files exist and refusing to read one would fail toward
 * deleting.
 */
function relationshipElements(dom: Document): Element[] {
  const ns = Array.from(dom.getElementsByTagNameNS(REL_NS, 'Relationship'));
  if (ns.length > 0) return ns;
  return Array.from(dom.getElementsByTagName('Relationship'));
}

/**
 * Remove `word/media/*` parts no live relationship points at, plus the dangling relationships that
 * pointed at them. Both arrays empty means nothing was touched and `packOpc` produces the same bytes.
 */
export function gcOrphanMediaParts(opc: OpcPackage): GcResult {
  const relsPaths = Object.keys(opc.files).filter(p => /(^|\/)_rels\/[^/]*\.rels$/.test(p));

  /** Media part path → the dangling relationships referencing it, if it proves orphaned. */
  const dangling = new Map<string, string[]>();
  const live = new Set<string>();

  // `[Content_Types].xml` is part of the reachability model, not just the relationship graph: a
  // media extension with no `Default` is typed by an `<Override PartName="/word/media/…">`, and
  // deleting the part while that Override names it leaves a declaration strict readers reject.
  const ctXml = partText(opc, '[Content_Types].xml');
  if (ctXml !== null) {
    const ctDom = parseXml(ctXml);
    if (parseFailed(ctDom)) return { removedParts: [], removedRels: [] };
    for (const el of Array.from(ctDom.getElementsByTagName('*'))) {
      if (el.localName !== 'Override') continue;
      const part = el.getAttribute('PartName');
      if (part === null) continue;
      const named = part.startsWith('/') ? part.slice(1) : part;
      if (named.startsWith(MEDIA_PREFIX)) live.add(named);
    }
  }

  for (const relsPath of relsPaths) {
    const relsXml = partText(opc, relsPath);
    // ABORT the pass rather than skipping this file. Unlike an unreadable OWNER — whose targets are
    // known and can simply be kept — we cannot know WHICH targets an unreadable `.rels` declares, so
    // the graph is incomplete and any deletion is a guess.
    if (relsXml === null) return { removedParts: [], removedRels: [] };
    const relsDom = parseXml(relsXml);
    if (parseFailed(relsDom)) return { removedParts: [], removedRels: [] };

    const owner = ownerOf(relsPath);
    const ownerXml = owner === null ? null : partText(opc, owner);
    const ownerUnreadable = owner === null || ownerXml === null;

    for (const rel of relationshipElements(relsDom)) {
      if (rel.getAttribute('TargetMode') === 'External') continue;
      const id = rel.getAttribute('Id');
      const target = rel.getAttribute('Target');
      if (id === null || target === null) continue;
      const resolved = resolveRelTarget(relsPath, target);
      if (!resolved.startsWith(MEDIA_PREFIX)) continue;

      const referenced = ownerXml !== null
        && (ownerXml.includes(`"${id}"`) || ownerXml.includes(`'${id}'`));
      if (ownerUnreadable || referenced) {
        live.add(resolved);
      } else {
        const list = dangling.get(resolved) ?? [];
        list.push(`${relsPath}#${id}`);
        dangling.set(resolved, list);
      }
    }
  }

  const removedParts: string[] = [];
  const removedRels: string[] = [];
  for (const path of Object.keys(opc.files)) {
    if (!path.startsWith(MEDIA_PREFIX)) continue;
    if (live.has(path)) continue;
    removedParts.push(path);
    removedRels.push(...(dangling.get(path) ?? []));
  }
  if (removedParts.length === 0) return { removedParts, removedRels: [] };

  for (const path of removedParts) delete opc.files[path];

  // Drop the dead relationship ELEMENTS through the same parser that found them. The first version
  // rewrote with a regex carrying its own `"`-only Id pattern, so on a single-quoted `.rels` the part
  // was deleted, the element survived, and `removedRels` reported a removal that had not happened —
  // a dangling relationship, which Word reports as unreadable content and which is worse than the
  // orphan this module exists to collect.
  const byRels = new Map<string, Set<string>>();
  for (const ref of removedRels) {
    const hash = ref.lastIndexOf('#');
    const relsPath = ref.slice(0, hash), id = ref.slice(hash + 1);
    const set = byRels.get(relsPath) ?? new Set<string>();
    set.add(id);
    byRels.set(relsPath, set);
  }
  for (const [relsPath, ids] of byRels) {
    const xml = partText(opc, relsPath);
    if (xml === null) continue;
    const dom = parseXml(xml);
    if (parseFailed(dom)) continue;
    for (const rel of relationshipElements(dom)) {
      const id = rel.getAttribute('Id');
      if (id !== null && ids.has(id)) rel.parentNode?.removeChild(rel);
    }
    opc.files[relsPath] = strToU8(serializeXml(dom));
  }

  return { removedParts, removedRels };
}
