// @vitest-environment jsdom
/**
 * F-D D2 — guided Signers panel: the pure caption builder, ISO date helper, and
 * the open/draw/close flow that arms a captioned signature placement.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildSignerCaption, isoDate, SignersPanel, type ISignersContext } from '../../src/ui/signersPanel';

const FIXED = new Date(2026, 5, 18); // 2026-06-18 (month is 0-based)

describe('buildSignerCaption (pure)', () => {
  it('returns null when neither name nor mention is entered', () => {
    expect(buildSignerCaption('', '', true, FIXED)).toBeNull();
    expect(buildSignerCaption('   ', '  ', true, FIXED)).toBeNull();
  });

  it('composes signer + mention + dated stamp, trimming whitespace', () => {
    expect(buildSignerCaption('  Alice Martin ', ' Lu et approuvé ', true, FIXED)).toEqual({
      signer: 'Alice Martin', mention: 'Lu et approuvé', signedDate: '2026-06-18',
    });
  });

  it('omits the date when includeDate is false', () => {
    expect(buildSignerCaption('Bob', 'Lu et approuvé', false, FIXED)).toEqual({
      signer: 'Bob', mention: 'Lu et approuvé',
    });
  });

  it('keeps a mention-only caption (name optional)', () => {
    expect(buildSignerCaption('', 'Lu et approuvé', false, FIXED)).toEqual({ mention: 'Lu et approuvé' });
  });
});

describe('isoDate', () => {
  it('zero-pads month and day', () => {
    expect(isoDate(new Date(2026, 0, 3))).toBe('2026-01-03');
    expect(isoDate(new Date(2026, 11, 25))).toBe('2026-12-25');
  });
});

function makeCtx() {
  const signersModal = document.createElement('div');
  signersModal.innerHTML = '<div class="code-modal-content"><button id="x"></button></div>';
  const ctx = {
    ui: {
      signersModal,
      signersBtn: document.createElement('button'),
      signerName: document.createElement('input'),
      signerMention: document.createElement('input'),
      signerDate: Object.assign(document.createElement('input'), { type: 'checkbox' }),
    },
    reportError: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), silent: vi.fn() },
    setPendingSignatureCaption: vi.fn(),
    setMode: vi.fn(),
    now: () => FIXED,
  } as unknown as ISignersContext;
  return { ctx, signersModal };
}

describe('SignersPanel', () => {
  beforeEach(() => vi.clearAllMocks());

  it('open() prefills the default mention, checks the date, and shows the modal', () => {
    const { ctx, signersModal } = makeCtx();
    new SignersPanel(ctx).open();
    expect(signersModal.classList.contains('active')).toBe(true);
    expect(ctx.ui.signerDate.checked).toBe(true);
    // i18n returns the key when no resources are loaded in jsdom — the field is still set.
    expect(ctx.ui.signerMention.value).toBeTruthy();
  });

  it('draw() sets the pending caption, closes the panel, and arms addSignature mode', () => {
    const { ctx, signersModal } = makeCtx();
    const panel = new SignersPanel(ctx);
    panel.open();
    // User edits the prefilled form, then triggers the draw step.
    ctx.ui.signerName.value = 'Alice';
    ctx.ui.signerMention.value = 'Lu et approuvé';
    ctx.ui.signerDate.checked = true;
    panel.draw();
    expect(ctx.setPendingSignatureCaption).toHaveBeenCalledWith({
      signer: 'Alice', mention: 'Lu et approuvé', signedDate: '2026-06-18',
    });
    expect(signersModal.classList.contains('active')).toBe(false);
    expect(ctx.setMode).toHaveBeenCalledWith('addSignature');
  });

  it('draw() arms a null caption when the form is empty (degrades to a plain signature)', () => {
    const { ctx } = makeCtx();
    ctx.ui.signerMention.value = '';
    const panel = new SignersPanel(ctx);
    panel.draw();
    expect(ctx.setPendingSignatureCaption).toHaveBeenCalledWith(null);
    expect(ctx.setMode).toHaveBeenCalledWith('addSignature');
  });
});
