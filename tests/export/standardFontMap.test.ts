/**
 * `getStandardFont` names the base-14 face a text box is baked with, and the bake then embeds
 * `StandardFonts[name]`. A name that is not a key of `StandardFonts` embeds `undefined`, the element's
 * render throws, and the text box is missing from the exported PDF (the export only warns
 * `toast.elementRenderFailed`). Times New Roman in bold, italic and bold-italic did exactly that: the
 * map said `TimesBold` / `TimesItalic` / `TimesBoldItalic`, pdf-lib's keys are `TimesRoman…`.
 * Found 2026-09-26 by the A5 ink-containment test, which exported a bold-italic Times box and got a
 * blank page. Every family × variant is checked, so a new entry cannot repeat it.
 */
import { describe, it, expect } from 'vitest';
import { StandardFonts } from '@cantoo/pdf-lib';
import { getStandardFont } from '../../src/export/pdfElementRenderer';

const FAMILIES = ['Arial', 'Helvetica', 'Times New Roman', 'Courier New', 'Courier', 'Unknown Family'];

describe('getStandardFont names a real pdf-lib standard font for every family and variant', () => {
  for (const family of FAMILIES) {
    for (const [bold, italic] of [[false, false], [true, false], [false, true], [true, true]]) {
      it(`${family}${bold ? ' bold' : ''}${italic ? ' italic' : ''}`, () => {
        const name = getStandardFont(family, bold, italic);
        expect(Object.keys(StandardFonts)).toContain(name);
      });
    }
  }
});
