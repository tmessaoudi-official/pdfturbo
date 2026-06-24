/**
 * Bullet / numbered list markers for overlay text elements.
 *
 * One item per `\n`-separated line (the overlay bake treats `\n`-lines as the unit and
 * never auto-wraps, so lists inherit that model). Pure + side-effect free.
 */

export type ListType = 'bullet' | 'ordered';

/** The marker string for one item. `ordinal` is 1-based; ignored for bullets. */
export function listMarker(kind: ListType, ordinal: number): string {
  return kind === 'bullet' ? '• ' : `${ordinal}. `;
}

/**
 * Split `text` on '\n' and prefix each NON-EMPTY line with its marker.
 *
 * Ordered ordinals count only non-empty lines (1-based). Empty lines pass through as ''
 * (the bake skips them and they do not advance the ordinal). Never throws.
 */
export function applyListMarkers(text: string, kind: ListType): string[] {
  const out: string[] = [];
  let ord = 0;
  for (const line of text.split('\n')) {
    if (line.length === 0) {
      out.push('');
      continue;
    }
    ord += 1;
    out.push(listMarker(kind, ord) + line);
  }
  return out;
}
