/**
 * Where an overlay text box's ink can actually land — the footprint the redaction drop tests (A5).
 *
 * A text box has a fixed height and the export bake never wraps or clips, so typing a second line
 * into the default 200×30 box at 14pt already draws it below the box (baseline at y + 29.4). The drop
 * used to test the STORED box, so a redaction the box did not touch but its overflow did kept the
 * element: on a blank page the overflowing line was baked as live text under the burn, and the
 * DOCX/Markdown/TXT and XFDF exports carried the whole text.
 *
 * The footprint is the UNION of the stored footprint and every line's drawn box, so it only ever
 * grows — the direction a leak filter may err in. Line positions come from `layoutTextLines`, the
 * same function the bake draws with. What is NOT shared is the glyph band around each line: for a
 * Latin line it is the drawn face's own FontBBox (so a glyph's ink may reach up to ~0.2 em left of the
 * line start and ~0.07 em above the box top — a stated over-drop bound, not a guess), for an Arabic
 * line Noto Naskh's measured FontBBox. A rotated element turns about its box centre, every line
 * with it, so each line's band is bounded by its four corners turned the same way. `tests/browser/text-extent-ink.browser.test.ts` pins both, and
 * the one number the metrics cannot supply (right-hand overhang), against rendered pixels.
 */
import { StandardFontEmbedder, StandardFonts } from '@cantoo/pdf-lib';
import type { TextElement } from '../elements/textElement';
import { rotatedElementFootprint } from '../utils/geometry';
import { visualRuns } from '../utils/bidi';
import { hasAdvancedText } from './styledText';
import { getStandardFont, _rotateInElementSpace } from './pdfElementRenderer';
import { layoutTextLines } from './textLayout';

export type Rect = { x: number; y: number; width: number; height: number };

/** Measures an Arabic (or mixed Arabic + Latin) line as the bake draws it. May reject. */
export type ArabicMeasurer = (text: string, size: number, charSpacing?: number, horizontalScale?: number) => Promise<number>;

type TextLike = Pick<TextElement,
  'text' | 'x' | 'y' | 'width' | 'height' | 'fontSize' | 'lineHeight' | 'align' | 'list' | 'fontFamily'
  | 'bold' | 'italic' | 'charSpacing' | 'horizontalScale' | 'strokeWidth' | 'baselineShift' | 'rotation'>;

// Glyph band for Arabic lines, in ems — Noto Naskh Arabic's measured FontBBox (yMax 1.056,
// yMin −0.61, xMin −0.249) rounded outward. Latin lines use the drawn face's OWN FontBBox instead.
// Checked on rendered pixels (20 strings — ligatures, tashkeel, kashida, presentation forms, mixed
// digits and Latin — 30pt, 2026-09-26): worst ink past the measured line was right 0.011, left 0.056,
// top 0.889, bottom 0.433 em. The Arabic FONT has no kerning twin: the measure and the drawn W array
// both sum fontkit's raw glyph advanceWidth (CustomFontEmbedder widthOfTextAtSize / computeWidths).
// The Latin runs of a MIXED line do — see mixedLatinKernExcess.
const ARABIC = { top: 1.1, bottom: 0.65, left: 0.25, right: 0.25 };
// The base-14 metrics pdf-lib ships carry advances but no per-glyph ink box, so how far a glyph's ink
// runs past its advance on the RIGHT is not in the data. Measured on rendered pixels instead: past the
// UN-KERNED advance, the worst of 240 cases (all 12 faces × 20 overhang-prone strings, 40pt, scale 8,
// 2026-09-26) was 0.014 em upright (Helvetica "_____") and 0.117 em slanted (Times-Italic "Vf"). The
// constants keep 7× and 2× headroom; text-extent-ink.browser.test.ts pins them against the real bake.
const LATIN_RIGHT_OVERHANG = { upright: 0.1, slanted: 0.25 };

/**
 * How much WIDER a mixed Arabic line's Latin runs are drawn than measured. `measureBidiRuns` measures
 * each Latin run with Helvetica's kerned `widthOfTextAtSize` and `drawBidiLine` draws it with
 * `drawText`, which does not kern — the same mismatch as on Latin lines, where the rightmost run's
 * excess inks past the measured line. Summed over EVERY Latin run (only the rightmost can reach past
 * the line; the rest overlap the next run), which over-counts in the safe direction. Same run split as
 * the bake (`visualRuns`), and 0 for a line the bake draws as pure Arabic.
 */
function mixedLatinKernExcess(line: string, size: number): number {
  if (!/[A-Za-z0-9]/.test(line)) return 0;
  const helv = StandardFontEmbedder.for(StandardFonts.Helvetica as unknown as Parameters<typeof StandardFontEmbedder.for>[0]);
  let excess = 0;
  for (const r of visualRuns(line)) {
    if (r.rtl) continue;
    const unkerned = Array.from(r.text).reduce((sum, g) => sum + helv.widthOfTextAtSize(g, size), 0);
    excess += Math.max(0, unkerned - helv.widthOfTextAtSize(r.text, size));
  }
  return excess;
}

/**
 * The base-14 face the bake draws `te` with. It measures exactly as the bake does, including a
 * character the face cannot encode (CJK typed into a box): the @cantoo fork substitutes `?` for it in
 * both measuring and drawing, so nothing throws and the widths agree.
 */
function faceOf(te: TextLike): StandardFontEmbedder {
  const name = getStandardFont(te.fontFamily ?? 'Helvetica', !!te.bold, !!te.italic) as keyof typeof StandardFonts;
  // StandardFonts values ARE the FontNames strings; the two enums are only nominally distinct.
  const face = (StandardFonts[name] ?? StandardFonts.Helvetica) as unknown as Parameters<typeof StandardFontEmbedder.for>[0];
  return StandardFontEmbedder.for(face);
}

/**
 * The display-space box every mark of `te` can land in, united with its stored footprint.
 * `measureArabic` is only called for Arabic lines; if it rejects, that line counts as reaching the
 * page edge (fail closed — an over-drop, never a leak).
 */
export async function textDrawnFootprint(te: TextLike, measureArabic: ArabicMeasurer): Promise<Rect> {
  const stored = rotatedElementFootprint(te);
  if (!te.text || !(te.fontSize > 0)) return stored;
  const fs = te.fontSize;
  const rot = te.rotation ?? 0;
  // The bake keeps Tier-2 attrs on a rotated element too (its text matrix carries the rotation).
  const advanced = hasAdvancedText(te);
  const drawSize = advanced && te.baselineShift ? fs * 0.65 : fs;
  const rise = !advanced ? 0 : te.baselineShift === 'super' ? fs * 0.33 : te.baselineShift === 'sub' ? -(fs * 0.15) : 0;
  const stroke = Math.max(0, te.strokeWidth ?? 0);

  let x0 = stored.x, y0 = stored.y, x1 = stored.x + stored.width, y1 = stored.y + stored.height;
  const grow = (a: number, b: number, c: number, d: number) => {
    x0 = Math.min(x0, a); y0 = Math.min(y0, b); x1 = Math.max(x1, c); y1 = Math.max(y1, d);
  };

  const emb = faceOf(te);
  const [bx0, by0, , by1] = emb.font.FontBBox;
  const overhang = te.italic ? LATIN_RIGHT_OVERHANG.slanted : LATIN_RIGHT_OVERHANG.upright;
  const hsF = (advanced ? te.horizontalScale ?? 100 : 100) / 100;
  const cs = advanced ? te.charSpacing ?? 0 : 0;
  for (const laid of layoutTextLines(te, emb, advanced)) {
    let left: number, right: number, top: number, bottom: number;
    if (laid.arabic) {
      let w: number;
      try { w = await measureArabic(laid.line, fs, te.charSpacing, te.horizontalScale); } catch { w = Infinity; }
      // drawArabicLine: right-aligned to the box edge, never left of the box.
      const startX = Math.max(te.x, te.x + (te.width || 0) - w);
      left = startX - ARABIC.left * fs - stroke;
      right = startX + w + mixedLatinKernExcess(laid.line, fs) + ARABIC.right * fs + stroke;
      top = laid.baseY - ARABIC.top * fs - stroke;
      bottom = laid.baseY + ARABIC.bottom * fs + stroke;
    } else {
      // The bake draws WITHOUT kerning (drawText and the raw Tj path both emit plain Tj), while the
      // layout measures WITH it — so kerned text ("AVAVA") inks up to ~0.55 em past `lineW` [measured
      // 2026-09-26, Times-Bold at 40pt]. Measure the drawn advance glyph by glyph (a lone glyph has
      // no kerning pair) and add whatever it exceeds the layout's width by.
      const unkerned = (Array.from(laid.line).reduce((sum, g) => sum + emb.widthOfTextAtSize(g, drawSize), 0)
        + cs * Math.max(0, laid.line.length - 1)) * hsF; // Tc term as effectiveLineWidth counts it
      const drawnW = Math.max(laid.lineW, laid.wordSpacing > 0 ? laid.boxW : 0) + Math.max(0, unkerned - laid.lineW);
      const start = te.x + laid.off;
      const baseline = laid.baseY - rise;
      const em = drawSize / 1000;
      // A negative Tc can pull a glyph back past the line start; bound it by the full pull.
      const pull = cs < 0 ? -cs * laid.line.length * hsF : 0;
      left = start + Math.min(0, bx0) * em * hsF - pull - stroke;
      right = start + drawnW + overhang * drawSize * hsF + stroke;
      top = baseline - by1 * em - stroke;
      // The underline (baseY + 0.12·fs, thickness 0.06·fs) ends ≤ 0.15 em below the baseline, inside
      // every face's descender band (yMin ≤ −0.218 em); the underline ink case pins that.
      bottom = baseline - by0 * em + stroke;
    }
    if (!rot) { grow(left, top, right, bottom); continue; }
    // A rotated element turns about its BOX CENTRE, every line with it — in the editor and, since
    // A3-pre (2026-09-26), in the bake. The line's band is a rigid rectangle in that turned frame, so
    // its four corners turned the same way bound it exactly.
    const cx = te.x + (te.width || 0) / 2, cy = te.y + (te.height || 0) / 2;
    for (const [qx, qy] of [[left, top], [right, top], [left, bottom], [right, bottom]]) {
      const p = _rotateInElementSpace(qx, qy, cx, cy, rot);
      grow(p.x, p.y, p.x, p.y);
    }
  }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}
