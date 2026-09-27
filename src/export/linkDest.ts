/**
 * Limits row 22 (D11) — where a PDF GoTo link points: a 1-based page number and the top edge of the view it asks
 * for, in that page's ABSOLUTE user space (y-up), or no top when the destination names none.
 *
 * pdf.js reports a Link annotation's destination as `dest`: either an explicit array
 * `[pageRef, { name: 'XYZ' | 'Fit' | … }, ...args]` or a NAME looked up with `getDestination`. The page is a
 * reference resolved with `getPageIndex`, or — in some producers — already a 0-based page index.
 */

/** The slice of pdf.js's document proxy this needs. */
export interface DestDoc {
  numPages: number;
  getDestination(id: string): Promise<unknown[] | null>;
  getPageIndex(ref: { num: number; gen: number }): Promise<number>;
}

export interface GoToTarget {
  pageNum: number;
  top?: number;
}

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/**
 * Resolve `dest` to its page and view top, or null when it names no page this document has — the link is then
 * dropped and its text still exports: a malformed destination is a malformed link, never a failed export. Both
 * lookups can reject, measured in pdf.js 6.3.289, so both are caught. `getPageIndex` rejects a reference to a missing
 * object and one to a non-page object (a font) alike — "The reference does not point to a /Page dictionary."
 * `getDestination` resolves `null` for a name the tree lacks, but REJECTS when the `/Names /Dests` tree itself is
 * corrupt — a dangling reference ("Cannot read properties of null (reading 'has')"), a non-dictionary, or a `/Kids`
 * entry to no object.
 */
export async function resolveGoToDest(doc: DestDoc, dest: unknown): Promise<GoToTarget | null> {
  const explicit = typeof dest === 'string' ? await doc.getDestination(dest).catch(() => null) : dest;
  if (!Array.isArray(explicit) || explicit.length < 2) return null;
  const [ref, kind, ...args] = explicit as [unknown, { name?: string } | undefined, ...unknown[]];
  let index: number | null = null;
  if (typeof ref === 'number' && Number.isInteger(ref)) index = ref;
  else if (ref && typeof ref === 'object' && 'num' in ref) {
    index = await doc.getPageIndex(ref as { num: number; gen: number }).catch(() => null);
  }
  if (index === null || index < 0 || index >= doc.numPages) return null;
  const name = kind?.name;
  const top = name === 'XYZ' ? num(args[1]) : name === 'FitH' || name === 'FitBH' ? num(args[0]) : name === 'FitR' ? num(args[3]) : undefined;
  return top === undefined ? { pageNum: index + 1 } : { pageNum: index + 1, top };
}
