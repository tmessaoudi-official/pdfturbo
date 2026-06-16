import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BatesPanel, type IBatesContext } from '../../src/ui/batesPanel';
import type { AppDOMRefs } from '../../src/ui/uiController';
import type { BatesSettings } from '../../src/export/batesStamp';

vi.mock('../../src/utils/focusTrap', () => ({ trapFocus: vi.fn().mockReturnValue(vi.fn()) }));

function defaultBates(): BatesSettings {
  return { enabled: false, mode: 'page', prefix: '', startNumber: 1, digits: 6, position: 'br', fontSize: 10, color: '#555555' };
}

function makeUI() {
  const batesModal = document.createElement('div');
  const content = document.createElement('div');
  content.className = 'watermark-content';
  batesModal.appendChild(content);
  document.body.appendChild(batesModal);

  const sel = (opts: string[]) => {
    const s = document.createElement('select');
    for (const o of opts) { const op = document.createElement('option'); op.value = o; s.appendChild(op); }
    return s;
  };
  return {
    batesModal,
    batesBtn: document.createElement('button'),
    batesEnabled: Object.assign(document.createElement('input'), { type: 'checkbox' }),
    batesMode: sel(['page', 'bates']),
    batesNumberingGroup: document.createElement('div'),
    batesPrefix: document.createElement('input'),
    batesStart: Object.assign(document.createElement('input'), { type: 'number', value: '1' }),
    batesDigits: Object.assign(document.createElement('input'), { type: 'number', value: '6' }),
    batesPosition: sel(['tl', 'tc', 'tr', 'bl', 'bc', 'br']),
    batesFontSize: Object.assign(document.createElement('input'), { type: 'number', value: '10' }),
    batesColor: Object.assign(document.createElement('input'), { type: 'color', value: '#555555' }),
    batesApply: document.createElement('button'),
    batesCancel: document.createElement('button'),
  } as unknown as Pick<AppDOMRefs,
    'batesModal' | 'batesBtn' | 'batesEnabled' | 'batesMode' | 'batesNumberingGroup' | 'batesPrefix' |
    'batesStart' | 'batesDigits' | 'batesPosition' | 'batesFontSize' | 'batesColor' | 'batesApply' | 'batesCancel'>;
}

function makeCtx(bates = defaultBates()): IBatesContext & { bates: BatesSettings } {
  const ctx = {
    ui: makeUI() as unknown as AppDOMRefs,
    bates,
    setBates: vi.fn((b: BatesSettings) => { ctx.bates = b; }),
    autosave: vi.fn(),
    reportError: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), silent: vi.fn() },
    exportPreviewOpen: false,
    showExportPreview: vi.fn(),
  };
  return ctx;
}

describe('BatesPanel.open', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('adds active class to modal', () => {
    const ctx = makeCtx();
    new BatesPanel(ctx).open();
    expect(ctx.ui.batesModal.classList.contains('active')).toBe(true);
  });

  it('pre-fills form from current Bates settings', () => {
    const ctx = makeCtx({ enabled: true, mode: 'bates', prefix: 'ACME-', startNumber: 100, digits: 5, position: 'tl', fontSize: 12, color: '#112233' });
    new BatesPanel(ctx).open();
    expect(ctx.ui.batesEnabled.checked).toBe(true);
    expect(ctx.ui.batesMode.value).toBe('bates');
    expect(ctx.ui.batesPrefix.value).toBe('ACME-');
    expect(ctx.ui.batesStart.value).toBe('100');
    expect(ctx.ui.batesDigits.value).toBe('5');
    expect(ctx.ui.batesPosition.value).toBe('tl');
    expect(ctx.ui.batesFontSize.value).toBe('12');
    expect(ctx.ui.batesColor.value).toBe('#112233');
  });

  it('shows the numbering group in bates mode and hides it in page mode', () => {
    const ctxBates = makeCtx({ ...defaultBates(), mode: 'bates' });
    new BatesPanel(ctxBates).open();
    expect(ctxBates.ui.batesNumberingGroup.style.display).not.toBe('none');

    const ctxPage = makeCtx({ ...defaultBates(), mode: 'page' });
    new BatesPanel(ctxPage).open();
    expect(ctxPage.ui.batesNumberingGroup.style.display).toBe('none');
  });
});

describe('BatesPanel.close', () => {
  beforeEach(() => { document.body.innerHTML = ''; });
  it('removes active class from modal', () => {
    const ctx = makeCtx();
    const panel = new BatesPanel(ctx);
    panel.open();
    panel.close();
    expect(ctx.ui.batesModal.classList.contains('active')).toBe(false);
  });
});

describe('BatesPanel.apply', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('calls setBates with values read from the form', () => {
    const ctx = makeCtx();
    const panel = new BatesPanel(ctx);
    panel.open();
    ctx.ui.batesEnabled.checked = true;
    ctx.ui.batesMode.value = 'bates';
    ctx.ui.batesPrefix.value = 'DOC-';
    ctx.ui.batesStart.value = '42';
    ctx.ui.batesDigits.value = '4';
    ctx.ui.batesPosition.value = 'bl';
    ctx.ui.batesFontSize.value = '14';
    ctx.ui.batesColor.value = '#abcdef';
    panel.apply();
    expect(ctx.setBates).toHaveBeenCalledWith(expect.objectContaining({
      enabled: true, mode: 'bates', prefix: 'DOC-', startNumber: 42, digits: 4, position: 'bl', fontSize: 14, color: '#abcdef',
    }));
  });

  it('clamps digits to >=1 and font size to a sane range', () => {
    const ctx = makeCtx();
    const panel = new BatesPanel(ctx);
    panel.open();
    ctx.ui.batesDigits.value = '0';
    ctx.ui.batesFontSize.value = '0';
    panel.apply();
    const arg = (ctx.setBates as unknown as { mock: { calls: BatesSettings[][] } }).mock.calls[0][0];
    expect(arg.digits).toBeGreaterThanOrEqual(1);
    expect(arg.fontSize).toBeGreaterThanOrEqual(6);
  });

  it('preserves a user-typed startNumber of 0 (min="0"; engine supports ACME-000000)', () => {
    const ctx = makeCtx();
    const panel = new BatesPanel(ctx);
    panel.open();
    ctx.ui.batesStart.value = '0';
    panel.apply();
    const arg = (ctx.setBates as unknown as { mock: { calls: BatesSettings[][] } }).mock.calls[0][0];
    expect(arg.startNumber).toBe(0);
  });

  it('defaults a blank/NaN startNumber to 1 and floors digits/fontSize to their minimums', () => {
    const ctx = makeCtx();
    const panel = new BatesPanel(ctx);
    panel.open();
    ctx.ui.batesStart.value = '';
    ctx.ui.batesDigits.value = '0';     // below floor → floors to 1, NOT the default 6
    ctx.ui.batesFontSize.value = '0';   // below floor → floors to 6, NOT the default 10
    panel.apply();
    const arg = (ctx.setBates as unknown as { mock: { calls: BatesSettings[][] } }).mock.calls[0][0];
    expect(arg.startNumber).toBe(1);
    expect(arg.digits).toBe(1);
    expect(arg.fontSize).toBe(6);
  });

  it('autosaves and closes the modal after applying', () => {
    const ctx = makeCtx();
    const panel = new BatesPanel(ctx);
    panel.open();
    panel.apply();
    expect(ctx.autosave).toHaveBeenCalled();
    expect(ctx.ui.batesModal.classList.contains('active')).toBe(false);
  });

  it('refreshes the export preview when it is open', () => {
    const ctx = makeCtx();
    (ctx as { exportPreviewOpen: boolean }).exportPreviewOpen = true;
    const panel = new BatesPanel(ctx);
    panel.open();
    panel.apply();
    expect(ctx.showExportPreview).toHaveBeenCalled();
  });

  it('does NOT refresh the export preview when it is closed', () => {
    const ctx = makeCtx();
    const panel = new BatesPanel(ctx);
    panel.open();
    panel.apply();
    expect(ctx.showExportPreview).not.toHaveBeenCalled();
  });
});

describe('BatesPanel.syncBtn', () => {
  beforeEach(() => { document.body.innerHTML = ''; });
  it('adds active class when Bates is enabled', () => {
    const ctx = makeCtx({ ...defaultBates(), enabled: true });
    new BatesPanel(ctx).syncBtn();
    expect(ctx.ui.batesBtn.classList.contains('active')).toBe(true);
  });
  it('removes active class when Bates is disabled', () => {
    const ctx = makeCtx({ ...defaultBates(), enabled: false });
    const panel = new BatesPanel(ctx);
    ctx.ui.batesBtn.classList.add('active');
    panel.syncBtn();
    expect(ctx.ui.batesBtn.classList.contains('active')).toBe(false);
  });
});
