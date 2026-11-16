// @vitest-environment jsdom
// The ✍ modal's colour swatch row (phone-signature-pad row 10, ruling 2026-11-12 09:56: the PC modal's lone native
// picker gets the shared swatch row, as the phone pad has since 7b; plan approved 2026-11-16 08:38). The row is the
// editor's shared palette — COLOR_PRESETS, then the recent colours — without white (white ink is invisible on paper,
// the phone pad's rule), plus the box's own colour when it is none of them, then a custom swatch that opens the native
// picker. A swatch click sets #sigColor and fires its `input` and `change`, so every existing listener (the pad, the
// phone link) follows unchanged; only a pick made in the native picker joins the shared recent colours.
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import i18next from 'i18next';
import { readFileSync } from 'node:fs';
import { bindSignatureSwatches } from '../../src/ui/signatureSwatches';
import { inkBoxes, INK_SET_EVENT } from '../../src/ui/signatureInkBoxes';
import { COLOR_PRESETS, getRecentColors, pushRecentColor } from '../../src/utils/recentColors';

beforeAll(async () => {
  await i18next.init({ lng: 'en', resources: {} }); // t() returns the key, as production after initI18n()
});

function setup(color = '#000000') {
  document.body.innerHTML =
    `<span id="sigColorLabel">Color:</span><input type="color" id="sigColor" value="${color}">` +
    '<span id="sigSwatchRow"></span><input id="sigLineWidth" type="number" value="2"><canvas id="cv" width="640"></canvas>';
  const box = document.getElementById('sigColor') as HTMLInputElement;
  const row = document.getElementById('sigSwatchRow') as HTMLElement;
  const events: string[] = [];
  box.addEventListener('input', () => events.push(`input:${box.value}`));
  box.addEventListener('change', () => events.push(`change:${box.value}`));
  const swatches = () => [...row.querySelectorAll<HTMLButtonElement>('button:not(.color-swatch-custom)')];
  const titles = () => swatches().map((b) => b.title);
  const pressed = () => swatches().filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.title);
  return { box, row, events, swatches, titles, pressed };
}

beforeEach(() => {
  localStorage.clear();
});

describe('the ✍ modal colour swatch row (row 10)', () => {
  it('lists the presets WITHOUT white, marks the box colour, and ends with the custom swatch; the group is named by "Color:"', () => {
    const { row, titles, pressed } = setup();
    bindSignatureSwatches(row, document.getElementById('sigColor') as HTMLInputElement);
    const presetsNoWhite = COLOR_PRESETS.filter((c) => c !== '#ffffff');
    expect(presetsNoWhite).toHaveLength(COLOR_PRESETS.length - 1); // the control: white IS a preset
    expect(titles()).toEqual(presetsNoWhite);
    expect(pressed()).toEqual(['#000000']);
    const last = row.lastElementChild as HTMLButtonElement;
    expect([last.classList.contains('color-swatch-custom'), last.getAttribute('aria-label'), last.type]).toEqual([true, 'toolbar.customColorTitle', 'button']);
    expect([row.getAttribute('role'), row.getAttribute('aria-labelledby')]).toEqual(['group', 'sigColorLabel']);
    for (const b of row.querySelectorAll('button')) expect(b.type).toBe('button'); // never a form submit
  });

  it('a swatch click sets #sigColor and fires input then change once each; the mark moves; the recent colours are untouched', () => {
    const { box, row, events, swatches, pressed } = setup();
    bindSignatureSwatches(row, box);
    const red = swatches().find((b) => b.title === '#ff0000');
    expect(red).toBeDefined();
    red?.click();
    expect(box.value).toBe('#ff0000');
    expect(events).toEqual(['input:#ff0000', 'change:#ff0000']);
    expect(pressed()).toEqual(['#ff0000']);
    expect(getRecentColors()).toEqual([]);
  });

  it('a pick in the native picker joins the shared recent colours and shows, marked; white never shows', () => {
    const { box, row, titles, pressed } = setup();
    bindSignatureSwatches(row, box);
    box.value = '#123456';
    box.dispatchEvent(new Event('change'));
    expect(getRecentColors()).toEqual(['#123456']);
    expect(titles()).toContain('#123456');
    expect(pressed()).toEqual(['#123456']);
    box.value = '#ffffff';
    box.dispatchEvent(new Event('change'));
    expect(titles()).not.toContain('#ffffff');
    expect(pressed()).toEqual([]); // the box holds white, which has no swatch to mark
  });

  it('the recent colours follow the presets, once each whatever their case', () => {
    pushRecentColor('#abcdef');
    localStorage.setItem('pdfturbo.recentColors', JSON.stringify(['#FF0000', '#abcdef']));
    const { box, row, titles } = setup();
    bindSignatureSwatches(row, box);
    expect(titles().filter((t) => t === '#ff0000')).toHaveLength(1);
    expect(titles().indexOf('#abcdef')).toBe(COLOR_PRESETS.length - 1); // right after the 9 presets left without white
  });

  it('a colour that is none of them (a scan, a stored box) is shown and marked', () => {
    const { box, row, titles, pressed } = setup('#123123');
    bindSignatureSwatches(row, box);
    expect(titles().at(-1)).toBe('#123123');
    expect(pressed()).toEqual(['#123123']);
  });

  it("a scan's inkBoxes.set moves the mark, through INK_SET_EVENT, and fires neither input nor change", () => {
    const { box, row, events, pressed } = setup();
    bindSignatureSwatches(row, box);
    const fired: string[] = [];
    box.addEventListener(INK_SET_EVENT, () => fired.push(INK_SET_EVENT));
    inkBoxes(document.getElementById('sigLineWidth') as HTMLInputElement, box, document.getElementById('cv') as HTMLCanvasElement)
      .set({ color: '#0066ff', width: 3 });
    expect(fired).toEqual([INK_SET_EVENT]);
    expect(events).toEqual([]);
    expect(pressed()).toEqual(['#0066ff']);
  });

  it('render() picks up a recent colour added elsewhere (the dialog re-renders on open)', () => {
    const { box, row, titles } = setup();
    const swatchRow = bindSignatureSwatches(row, box);
    pushRecentColor('#456789'); // e.g. the toolbar, while the dialog was closed
    expect(titles()).not.toContain('#456789');
    swatchRow.render();
    expect(titles()).toContain('#456789');
  });

  // 6C advisor finding: the click re-renders the row, which destroyed the focused button — focus fell to <body>, outside
  // the dialog's focus trap (its keydown listener is on the dialog), so Tab left the dialog.
  it('keyboard focus survives a swatch click: the new button of the same colour holds it', () => {
    const { box, row, swatches } = setup();
    bindSignatureSwatches(row, box);
    const red = swatches().find((b) => b.title === '#ff0000') as HTMLButtonElement;
    red.focus();
    red.click();
    expect(document.activeElement).toBeInstanceOf(HTMLButtonElement);
    expect((document.activeElement as HTMLButtonElement).title).toBe('#ff0000');
    expect(row.contains(document.activeElement)).toBe(true);
  });

  it('keyboard focus survives a re-render while the custom swatch holds it (the native picker\'s input)', () => {
    const { box, row } = setup();
    bindSignatureSwatches(row, box);
    (row.querySelector('.color-swatch-custom') as HTMLButtonElement).focus();
    box.value = '#13579b';
    box.dispatchEvent(new Event('input'));
    expect((document.activeElement as HTMLElement).classList.contains('color-swatch-custom')).toBe(true);
    expect(row.contains(document.activeElement)).toBe(true);
  });

  it('a re-render does not pull focus into the row when it was elsewhere', () => {
    const { box, row } = setup();
    bindSignatureSwatches(row, box);
    const w = document.getElementById('sigLineWidth') as HTMLInputElement;
    w.focus();
    box.value = '#ff0000';
    box.dispatchEvent(new Event('change'));
    expect(document.activeElement).toBe(w);
  });

  it('the custom swatch opens the native picker', () => {
    const { box, row } = setup();
    bindSignatureSwatches(row, box);
    const click = vi.spyOn(box, 'click');
    (row.querySelector('.color-swatch-custom') as HTMLButtonElement).click();
    expect(click).toHaveBeenCalledTimes(1);
  });
});

describe('the wiring (row 10)', () => {
  it('index.html: the row sits beside #sigColor\'s label (not inside it), named by the "Color:" text, and the settings wrap at 414 px', () => {
    const html = readFileSync('index.html', 'utf8');
    // Beside the <label>, never inside it: a button is a labelable element (invalid inside a label of another control),
    // and a click on a label's content would also open the native picker.
    expect(html).toMatch(/<span id="sigColorLabel" data-i18n="modal\.signature\.colorLabel">Color:<\/span> <input type="color" id="sigColor"[^>]*>\s*<\/label>\s*<span id="sigSwatchRow" class="color-swatch-row"><\/span>/);
    expect(readFileSync('src/styles/editor.css', 'utf8')).toMatch(/\.signature-settings \{[^}]*flex-wrap: wrap;/);
    // The current colour is SEEN, not only announced (aria-pressed): a ring, as the phone pad's (pad.css .pad-swatch).
    expect(readFileSync('src/styles/editor.css', 'utf8')).toMatch(/#sigSwatchRow \.color-swatch\[aria-pressed="true"\] \{[^}]*box-shadow:/);
  });

  it('modalBinder binds the row to the ui refs and re-renders it whenever the dialog opens', () => {
    const src = readFileSync('src/ui/binders/modalBinder.ts', 'utf8');
    expect(src).toMatch(/const sigSwatches = bindSignatureSwatches\(app\.ui\.sigSwatchRow, app\.ui\.sigColorInput\);/);
    expect(src).toMatch(/app\.onSignatureModalOpened\(\(\) => sigSwatches\.render\(\)\);/);
  });
});
