import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CompressPanel, type ICompressContext } from '../../src/ui/compressPanel';
import type { AppDOMRefs } from '../../src/ui/uiController';
import type { CompressOptions } from '../../src/export/compress';

vi.mock('../../src/utils/focusTrap', () => ({ trapFocus: vi.fn().mockReturnValue(vi.fn()) }));
vi.mock('../../src/utils/i18n', () => ({ t: (key: string) => key }));

function makeUI() {
  const compressModal = document.createElement('div');
  const content = document.createElement('div');
  content.className = 'watermark-content';
  compressModal.appendChild(content);
  document.body.appendChild(compressModal);

  const mode = document.createElement('select');
  for (const v of ['lossless', 'lossy']) {
    const op = document.createElement('option'); op.value = v; mode.appendChild(op);
  }
  return {
    compressModal,
    compressBtn: document.createElement('button'),
    compressMode: mode,
    compressModeHint: document.createElement('p'),
    compressLossyGroup: document.createElement('div'),
    compressDpi: Object.assign(document.createElement('input'), { type: 'number', value: '200' }),
    compressQuality: Object.assign(document.createElement('input'), { type: 'range', value: '0.8' }),
    compressQualityVal: document.createElement('output'),
    compressApply: document.createElement('button'),
    compressCancel: document.createElement('button'),
  } as unknown as Pick<AppDOMRefs,
    'compressModal' | 'compressBtn' | 'compressMode' | 'compressModeHint' | 'compressLossyGroup' |
    'compressDpi' | 'compressQuality' | 'compressQualityVal' | 'compressApply' | 'compressCancel'>;
}

function makeCtx(): ICompressContext & { compress: ReturnType<typeof vi.fn> } {
  return {
    ui: makeUI() as unknown as AppDOMRefs,
    compress: vi.fn<(opts: CompressOptions) => void>(),
  };
}

const lastOpts = (ctx: { compress: { mock: { calls: CompressOptions[][] } } }): CompressOptions =>
  ctx.compress.mock.calls[0][0];

describe('CompressPanel.open', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('adds active class and hides the lossy group in the default lossless mode', () => {
    const ctx = makeCtx();
    new CompressPanel(ctx).open();
    expect(ctx.ui.compressModal.classList.contains('active')).toBe(true);
    expect(ctx.ui.compressLossyGroup.style.display).toBe('none');
  });

  it('seeds the quality readout from the slider value', () => {
    const ctx = makeCtx();
    ctx.ui.compressQuality.value = '0.65';
    new CompressPanel(ctx).open();
    expect(ctx.ui.compressQualityVal.textContent).toBe('0.65');
  });
});

describe('CompressPanel mode visibility', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('reveals the lossy DPI/quality group when lossy is selected', () => {
    const ctx = makeCtx();
    const panel = new CompressPanel(ctx);
    panel.setupListeners();
    panel.open();
    ctx.ui.compressMode.value = 'lossy';
    ctx.ui.compressMode.dispatchEvent(new Event('change'));
    expect(ctx.ui.compressLossyGroup.style.display).not.toBe('none');
    expect(ctx.ui.compressModeHint.getAttribute('data-i18n')).toBe('modal.compress.hintLossy');
  });
});

describe('CompressPanel.apply', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('lossless mode emits only the mode and closes the modal', () => {
    const ctx = makeCtx();
    const panel = new CompressPanel(ctx);
    panel.open();
    panel.apply();
    expect(ctx.compress).toHaveBeenCalledWith({ mode: 'lossless' });
    expect(ctx.ui.compressModal.classList.contains('active')).toBe(false);
  });

  it('lossy mode emits clamped DPI + quality', () => {
    const ctx = makeCtx();
    const panel = new CompressPanel(ctx);
    panel.open();
    ctx.ui.compressMode.value = 'lossy';
    ctx.ui.compressDpi.value = '150';
    ctx.ui.compressQuality.value = '0.7';
    panel.apply();
    expect(lastOpts(ctx)).toEqual({ mode: 'lossy', dpi: 150, quality: 0.7 });
  });

  it('clamps an out-of-range DPI and quality to the supported bounds', () => {
    const ctx = makeCtx();
    const panel = new CompressPanel(ctx);
    panel.open();
    ctx.ui.compressMode.value = 'lossy';
    ctx.ui.compressDpi.value = '5000';   // above max 300
    ctx.ui.compressQuality.value = '5';  // above max 0.95
    panel.apply();
    const opts = lastOpts(ctx);
    expect(opts.dpi).toBe(300);
    expect(opts.quality).toBeCloseTo(0.95, 5);
  });
});
