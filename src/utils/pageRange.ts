/**
 * Parse a 1-based page-range spec ("1-3,5,8-10") into sorted, de-duplicated,
 * 0-based page indices, clamped to the document's page count. Used by the
 * "Extract pages" feature (#59). Invalid tokens are ignored; reversed ranges
 * (e.g. "3-1") are swapped; whitespace within a token is tolerated. Output is
 * always ascending document order — reordering is reorderPages' job.
 *
 * @param spec     user input, e.g. "1-3, 5, 8-10"
 * @param maxPages total page count (the valid 1-based range is [1, maxPages])
 * @returns sorted unique 0-based indices (possibly empty)
 */
export function parsePageRange(spec: string, maxPages: number): number[] {
  const out = new Set<number>();
  for (const rawToken of spec.split(',')) {
    const token = rawToken.replace(/\s+/g, '');
    if (!token) continue;
    const range = /^(\d+)-(\d+)$/.exec(token);
    const single = /^(\d+)$/.exec(token);
    if (range) {
      let a = parseInt(range[1], 10);
      let b = parseInt(range[2], 10);
      if (a > b) [a, b] = [b, a];
      for (let n = a; n <= b; n++) {
        if (n >= 1 && n <= maxPages) out.add(n - 1);
      }
    } else if (single) {
      const n = parseInt(single[1], 10);
      if (n >= 1 && n <= maxPages) out.add(n - 1);
    }
    // else: ignore malformed token
  }
  return [...out].sort((x, y) => x - y);
}
