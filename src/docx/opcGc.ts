/**
 * WS4-D — garbage-collect `word/media/*` parts that nothing references any more.
 *
 * Deleting an image in the DOCX editor removed its anchor paragraph but left the bytes in the
 * package: `word/media/imageN.png` survived as an unreferenced part, recoverable by renaming the
 * file to `.zip`. The picture vanished in the editor AND in Word, which is what made it
 * convincing. Disclosed in `SECURITY.md` § "Deleting an image in the DOCX editor does not remove
 * it from the file"; this closes it.
 *
 * **The scan's completeness IS the deliverable** — the recorded risk is destroying a picture that
 * is still referenced, which is far worse than leaving an orphan. So every decision here errs
 * towards KEEPING:
 *
 *   - every `_rels/*.rels` part in the package is walked, not just `word/_rels/document.xml.rels`
 *     — a header, footer, footnote, endnote, comment or an unmodelled part reaches its images
 *     through its own `.rels`, and those parts are passed through verbatim by the editor, so they
 *     are exactly the ones a naive scan would miss;
 *   - a relationship counts as LIVE if its Id appears ANYWHERE in the owning part's text. That
 *     over-approximates deliberately: matching `r:embed` and friends by name would have to
 *     enumerate every attribute Word can hang an rId on (`r:id`, `r:embed`, `r:link`, `r:pict`,
 *     `r:dm`, `r:lo`, `r:qs`, `r:cs`, `v:imagedata/@r:id`, …) and a missed one deletes a live
 *     image;
 *   - an owner part that is missing, binary or unreadable makes ALL of its relationships live;
 *   - only `word/media/**` is ever removed. Nothing else in the package is eligible, whatever the
 *     refcount says.
 *
 * The Id is matched with its quotes (`"rId7"`) so that `rId7` cannot match inside `rId70`.
 */
import { strFromU8 } from 'fflate';
import type { OpcPackage } from './opcEdit';

/** What a GC pass removed. Empty arrays ⇒ the package is byte-identical afterwards. */
export interface GcResult {
  /** Part paths deleted, e.g. `word/media/image2.png`. */
  removedParts: string[];
  /** Dangling relationships dropped, as `<owning .rels path>#<Id>`. */
  removedRels: string[];
}

const MEDIA_PREFIX = 'word/media/';

/** `word/_rels/document.xml.rels` → `word/document.xml`; `_rels/.rels` → null (the package root). */
function ownerOf(relsPath: string): string | null {
  const m = /^(.*)_rels\/([^/]+)\.rels$/.exec(relsPath);
  if (!m) return null;
  const [, dir, name] = m;
  // `_rels/.rels` describes the PACKAGE itself: `name` is empty, there is no owning part to scan,
  // and its relationships are therefore always treated as live.
  return name.length === 0 ? null : `${dir}${name}`;
}

/** Resolve a relationship Target against its owning part's directory, collapsing `.` and `..`. */
export function resolveRelTarget(relsPath: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const dir = relsPath.replace(/_rels\/[^/]*\.rels$/, '');
  const out: string[] = [];
  for (const seg of `${dir}${target}`.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') out.pop();
    else out.push(seg);
  }
  return out.join('/');
}

/**
 * Decode a part as XML text, or null when it is absent or does not look like XML.
 *
 * The `looksLikeXml` check is not belt-and-braces: `strFromU8` does NOT throw on bytes that are not
 * valid UTF-8, it substitutes replacement characters. So a binary part that happens to be named
 * `.xml` would decode to garbage, that garbage would not contain any `"rIdN"`, and every
 * relationship it owns would be judged dangling — deleting live images. Returning null here makes
 * that case fail towards KEEPING instead. Found by the fail-safe test, which passed for the wrong
 * reason before this.
 */
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
  return text.includes('<') && !text.includes('�') ? text : null;
}

/**
 * Remove `word/media/*` parts that no live relationship points at, plus the dangling
 * relationships that pointed at them. Returns what it removed; both arrays empty means nothing
 * was touched and `packOpc` will produce the same bytes as before.
 *
 * Pure over `opc.files` apart from the deletions it reports — it never rewrites a part it is not
 * removing a relationship from.
 */
export function gcOrphanMediaParts(opc: OpcPackage): GcResult {
  const relsPaths = Object.keys(opc.files).filter(p => /(^|\/)_rels\/[^/]*\.rels$/.test(p));

  /** Media part path → the dangling relationships that reference it, if it turns out to be orphaned. */
  const dangling = new Map<string, string[]>();
  const live = new Set<string>();

  for (const relsPath of relsPaths) {
    const relsXml = partText(opc, relsPath);
    if (relsXml === null) continue;
    const owner = ownerOf(relsPath);
    // No owning part to scan (the package `.rels`), or an owner we cannot read as text (binary, or
    // absent): every relationship it declares is treated as LIVE. Fail towards keeping.
    const ownerXml = owner === null ? null : partText(opc, owner);
    const ownerUnreadable = owner === null || ownerXml === null;

    for (const m of relsXml.matchAll(/<Relationship\b[^>]*>/g)) {
      const tag = m[0];
      if (/TargetMode\s*=\s*"External"/.test(tag)) continue;
      const id = /\bId\s*=\s*"([^"]*)"/.exec(tag)?.[1];
      const target = /\bTarget\s*=\s*"([^"]*)"/.exec(tag)?.[1];
      if (!id || !target) continue;
      const resolved = resolveRelTarget(relsPath, target);
      if (!resolved.startsWith(MEDIA_PREFIX)) continue;

      if (ownerUnreadable || (ownerXml as string).includes(`"${id}"`)) {
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
    // A media part with no relationship at all pointing at it is unreachable by definition, and a
    // part whose only relationships are dangling is unreachable too. Both are removed; the second
    // also has its dead relationships dropped so the package stays internally consistent.
    removedParts.push(path);
    removedRels.push(...(dangling.get(path) ?? []));
  }
  if (removedParts.length === 0) return { removedParts, removedRels: [] };

  for (const path of removedParts) delete opc.files[path];

  // Drop the dead relationship elements, one rewrite per affected .rels part.
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
    const next = xml.replace(/<Relationship\b[^>]*\/?>(?:<\/Relationship>)?/g, (tag) => {
      const id = /\bId\s*=\s*"([^"]*)"/.exec(tag)?.[1];
      return id !== undefined && ids.has(id) ? '' : tag;
    });
    opc.files[relsPath] = new TextEncoder().encode(next);
  }

  return { removedParts, removedRels };
}
