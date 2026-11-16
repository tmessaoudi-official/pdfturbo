import { COLOR_PRESETS, getRecentColors, pushRecentColor } from '../utils/recentColors';
import { isWhite } from '../utils/signatureInk';
import { INK_SET_EVENT } from './signatureInkBoxes';
import { t } from '../utils/i18n';

/**
 * The ✍ modal's colour swatch row (phone-signature-pad row 10; ruling 2026-11-12 09:56, plan approved 2026-11-16 08:38):
 * the PC modal's native `#sigColor` gets the editor's shared palette, as the phone pad has since 7b.
 *  - The swatches: COLOR_PRESETS, then the shared recent colours, then the box's own colour when it is none of them
 *    (a scan, a stored box) — never white, which is invisible ink on paper (the phone pad's rule) — then a custom
 *    swatch that opens the native picker. The box's colour is marked with `aria-pressed`.
 *  - A swatch click sets `#sigColor` and fires its `input` and `change`, so every existing listener (the pad, the
 *    phone link: `signatureInkBoxes.ts`) follows unchanged. Only a pick made in the native picker joins the shared
 *    recent colours (`pdfturbo.recentColors`), as on the phone pad.
 *  - It re-renders on the box's `input`/`change`, on a scan's `inkBoxes.set` (`INK_SET_EVENT` — a scan fires neither
 *    `input` nor `change`), and through `render()`, which modalBinder calls whenever the dialog opens.
 */
export function bindSignatureSwatches(row: HTMLElement, colorBox: HTMLInputElement): { render(): void } {
  row.setAttribute('role', 'group');
  row.setAttribute('aria-labelledby', 'sigColorLabel');
  // True only while a swatch click dispatches the box's events (synchronously): those are not native-picker picks.
  let picking = false;

  const render = (): void => {
    const current = colorBox.value.toLowerCase();
    const seen = new Set<string>();
    const colours: string[] = [];
    for (const hex of [...COLOR_PRESETS, ...getRecentColors(), current]) {
      const norm = hex.toLowerCase();
      if (!/^#[0-9a-f]{6}$/.test(norm) || isWhite(norm) || seen.has(norm)) continue;
      seen.add(norm);
      colours.push(norm);
    }
    const buttons = colours.map((hex) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'color-swatch';
      b.style.background = hex;
      b.title = hex;
      b.setAttribute('aria-pressed', String(hex === current));
      b.addEventListener('click', () => {
        colorBox.value = hex;
        picking = true;
        try {
          colorBox.dispatchEvent(new Event('input', { bubbles: true }));
          colorBox.dispatchEvent(new Event('change', { bubbles: true }));
        } finally {
          picking = false;
        }
      });
      return b;
    });
    const custom = document.createElement('button');
    custom.type = 'button';
    custom.className = 'color-swatch color-swatch-custom';
    custom.title = t('toolbar.customColorTitle');
    custom.setAttribute('aria-label', t('toolbar.customColorTitle'));
    custom.addEventListener('click', () => colorBox.click());
    row.replaceChildren(...buttons, custom);
  };

  colorBox.addEventListener('input', render);
  colorBox.addEventListener('change', () => {
    if (!picking) pushRecentColor(colorBox.value);
    render();
  });
  colorBox.addEventListener(INK_SET_EVENT, render);
  render();
  return { render };
}
