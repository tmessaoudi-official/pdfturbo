import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TextOptionsPopover, type ITextOptionsContext } from '../../src/ui/textOptionsPopover';

// ---------------------------------------------------------------------------
// Minimal DOM factory — mirrors the markup added to index.html in this task.
// ---------------------------------------------------------------------------
function makePopover(): { pop: TextOptionsPopover; modal: HTMLElement; ui: Record<string, HTMLElement>; svc: Record<string, ReturnType<typeof vi.fn>> } {
  document.body.innerHTML = `
    <button id="textOptionsBtn" disabled></button>
    <button id="alignLeftBtn" disabled></button>
    <button id="alignCenterBtn" disabled></button>
    <button id="alignRightBtn" disabled></button>
    <span id="colorSwatchRow"></span>

    <div id="textOptionsModal" class="watermark-modal" role="dialog" aria-modal="true">
      <div class="watermark-content">
        <h3>Text options</h3>
        <button id="textCaseUpperBtn">AA</button>
        <button id="textCaseLowerBtn">aa</button>
        <button id="textCaseTitleBtn">Aa</button>
        <input type="number" id="textLineHeight" value="1.2" />
        <input type="range"  id="textOpacity"   value="1" />
        <input type="color"  id="textBgColor"   value="#ffff00" />
        <button id="textBgNoneBtn">None</button>
        <button id="clearFmtBtn">Clear formatting</button>
        <button id="formatPainterBtn">Format painter</button>
        <button id="textOptionsCloseBtn">Close</button>
      </div>
    </div>
  `;

  function g(id: string): HTMLElement {
    const el = document.getElementById(id);
    if (!el) throw new Error(`Test setup: #${id} not found in DOM`);
    return el;
  }

  const uiRefs = {
    textOptionsBtn:      g('textOptionsBtn')      as HTMLButtonElement,
    textOptionsModal:    g('textOptionsModal')    as HTMLElement,
    textOptionsCloseBtn: g('textOptionsCloseBtn') as HTMLButtonElement,
    textLineHeight:      g('textLineHeight')      as HTMLInputElement,
    textOpacity:         g('textOpacity')         as HTMLInputElement,
    textBgColor:         g('textBgColor')         as HTMLInputElement,
    textBgNoneBtn:       g('textBgNoneBtn')       as HTMLButtonElement,
    textCaseUpperBtn:    g('textCaseUpperBtn')    as HTMLButtonElement,
    textCaseLowerBtn:    g('textCaseLowerBtn')    as HTMLButtonElement,
    textCaseTitleBtn:    g('textCaseTitleBtn')    as HTMLButtonElement,
    clearFmtBtn:         g('clearFmtBtn')         as HTMLButtonElement,
    formatPainterBtn:    g('formatPainterBtn')    as HTMLButtonElement,
    alignLeftBtn:        g('alignLeftBtn')        as HTMLButtonElement,
    alignCenterBtn:      g('alignCenterBtn')      as HTMLButtonElement,
    alignRightBtn:       g('alignRightBtn')       as HTMLButtonElement,
    colorSwatchRow:      g('colorSwatchRow')      as HTMLElement,
  };

  const svc = {
    setLineHeight:      vi.fn(),
    setTextOpacity:     vi.fn(),
    setTextBackground:  vi.fn(),
    clearTextBackground: vi.fn(),
    transformCase:      vi.fn(),
    clearFormatting:    vi.fn(),
    copyTextStyle:      vi.fn().mockReturnValue(true),
  };

  const ctx: ITextOptionsContext = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ui: uiRefs as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    svc: svc as any,
    selectedText: null,
  };

  const pop = new TextOptionsPopover(ctx);
  return { pop, modal: uiRefs.textOptionsModal, ui: uiRefs as unknown as Record<string, HTMLElement>, svc };
}

// ---------------------------------------------------------------------------
describe('TextOptionsPopover', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('open() adds .active and close() removes it', () => {
    const { pop, modal } = makePopover();
    pop.open();
    expect(modal.classList.contains('active')).toBe(true);
    pop.close();
    expect(modal.classList.contains('active')).toBe(false);
  });

  it('line-height input change calls svc.setLineHeight with the parsed value', () => {
    const { pop, ui, svc } = makePopover();
    pop.setupListeners();
    (ui.textLineHeight as HTMLInputElement).value = '2.0';
    ui.textLineHeight.dispatchEvent(new Event('change'));
    expect(svc.setLineHeight).toHaveBeenCalledWith(2);
  });

  it('case buttons call transformCase with the right mode', () => {
    const { pop, ui, svc } = makePopover();
    pop.setupListeners();
    (ui.textCaseUpperBtn as HTMLButtonElement).click();
    expect(svc.transformCase).toHaveBeenCalledWith('upper');
  });

  it('lower case button calls transformCase(lower)', () => {
    const { pop, ui, svc } = makePopover();
    pop.setupListeners();
    (ui.textCaseLowerBtn as HTMLButtonElement).click();
    expect(svc.transformCase).toHaveBeenCalledWith('lower');
  });

  it('title case button calls transformCase(title)', () => {
    const { pop, ui, svc } = makePopover();
    pop.setupListeners();
    (ui.textCaseTitleBtn as HTMLButtonElement).click();
    expect(svc.transformCase).toHaveBeenCalledWith('title');
  });

  it('opacity input calls setTextOpacity', () => {
    const { pop, ui, svc } = makePopover();
    pop.setupListeners();
    (ui.textOpacity as HTMLInputElement).value = '0.5';
    ui.textOpacity.dispatchEvent(new Event('input'));
    expect(svc.setTextOpacity).toHaveBeenCalledWith(0.5);
  });

  it('bg color input calls setTextBackground', () => {
    const { pop, ui, svc } = makePopover();
    pop.setupListeners();
    (ui.textBgColor as HTMLInputElement).value = '#ff0000';
    ui.textBgColor.dispatchEvent(new Event('input'));
    expect(svc.setTextBackground).toHaveBeenCalledWith('#ff0000');
  });

  it('textBgNoneBtn click calls clearTextBackground', () => {
    const { pop, ui, svc } = makePopover();
    pop.setupListeners();
    (ui.textBgNoneBtn as HTMLButtonElement).click();
    expect(svc.clearTextBackground).toHaveBeenCalled();
  });

  it('clearFmtBtn click calls clearFormatting', () => {
    const { pop, ui, svc } = makePopover();
    pop.setupListeners();
    (ui.clearFmtBtn as HTMLButtonElement).click();
    expect(svc.clearFormatting).toHaveBeenCalled();
  });

  it('formatPainterBtn click calls copyTextStyle and adds active class', () => {
    const { pop, ui, svc } = makePopover();
    pop.setupListeners();
    (ui.formatPainterBtn as HTMLButtonElement).click();
    expect(svc.copyTextStyle).toHaveBeenCalled();
    expect((ui.formatPainterBtn as HTMLButtonElement).classList.contains('btn-active-fmt')).toBe(true);
  });

  it('close btn listener closes the modal', () => {
    const { pop, modal } = makePopover();
    pop.setupListeners();
    pop.open();
    expect(modal.classList.contains('active')).toBe(true);
    (document.getElementById('textOptionsCloseBtn') as HTMLButtonElement).click();
    expect(modal.classList.contains('active')).toBe(false);
  });
});
