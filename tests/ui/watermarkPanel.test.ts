import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WatermarkPanel, type IWatermarkContext } from '../../src/ui/watermarkPanel';
import type { AppDOMRefs } from '../../src/ui/uiController';
import type { WatermarkSettings } from '../../src/core/documentModel';

vi.mock('../../src/utils/focusTrap', () => ({ trapFocus: vi.fn().mockReturnValue(vi.fn()) }));
vi.mock('../../src/utils/geometry', () => ({
  hexToRgbValues: vi.fn().mockReturnValue({ r: 0, g: 0, b: 0 }),
}));

function defaultWm(): WatermarkSettings {
  return { enabled: false, text: 'DRAFT', color: '#ff0000', fontSize: 60, opacity: 0.3, angle: 45, density: 3 };
}

function makeUI() {
  const watermarkModal = document.createElement('div');
  const wmContent = document.createElement('div');
  wmContent.className = 'watermark-content';
  watermarkModal.appendChild(wmContent);
  document.body.appendChild(watermarkModal);

  return {
    watermarkModal,
    watermarkBtn: document.createElement('button'),
    wmEnabled: Object.assign(document.createElement('input'), { type: 'checkbox' }),
    wmText: document.createElement('input'),
    wmColor: document.createElement('input'),
    wmFontSize: Object.assign(document.createElement('input'), { value: '60' }),
    wmFontSizeDisplay: document.createElement('span'),
    wmOpacity: Object.assign(document.createElement('input'), { value: '30' }),
    wmOpacityDisplay: document.createElement('span'),
    wmAngle: Object.assign(document.createElement('input'), { value: '45' }),
    wmAngleDisplay: document.createElement('span'),
    wmDensity: Object.assign(document.createElement('input'), { value: '3' }),
    wmDensityDisplay: document.createElement('span'),
    wmPreviewCanvas: document.createElement('canvas'),
  } as unknown as Pick<AppDOMRefs, 'watermarkModal' | 'watermarkBtn' | 'wmEnabled' | 'wmText' | 'wmColor' | 'wmFontSize' | 'wmFontSizeDisplay' | 'wmOpacity' | 'wmOpacityDisplay' | 'wmAngle' | 'wmAngleDisplay' | 'wmDensity' | 'wmDensityDisplay' | 'wmPreviewCanvas'>;
}

function makeCtx(wm = defaultWm()): IWatermarkContext & { watermark: WatermarkSettings } {
  const ctx = {
    ui: makeUI() as unknown as AppDOMRefs,
    watermark: wm,
    setWatermark: vi.fn((w: WatermarkSettings) => { ctx.watermark = w; }),
    zoomScale: 1.0,
    autosave: vi.fn(),
    reportError: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), silent: vi.fn() },
    exportPreviewOpen: false,
    showExportPreview: vi.fn(),
  };
  return ctx;
}

describe('WatermarkPanel.open', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('adds active class to modal', () => {
    const ctx = makeCtx();
    const panel = new WatermarkPanel(ctx);
    panel.open();
    expect(ctx.ui.watermarkModal.classList.contains('active')).toBe(true);
  });

  it('pre-fills form from current watermark settings', () => {
    const ctx = makeCtx({ enabled: true, text: 'CONFIDENTIAL', color: '#ff0000', fontSize: 80, opacity: 0.5, angle: 30, density: 2 });
    const panel = new WatermarkPanel(ctx);
    panel.open();
    expect(ctx.ui.wmText.value).toBe('CONFIDENTIAL');
    expect(ctx.ui.wmFontSize.value).toBe('80');
    expect(ctx.ui.wmOpacity.value).toBe('50');
    expect(ctx.ui.wmAngle.value).toBe('30');
    expect(ctx.ui.wmEnabled.checked).toBe(true);
  });
});

describe('WatermarkPanel.close', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('removes active class from modal', () => {
    const ctx = makeCtx();
    const panel = new WatermarkPanel(ctx);
    panel.open();
    panel.close();
    expect(ctx.ui.watermarkModal.classList.contains('active')).toBe(false);
  });
});

describe('WatermarkPanel.apply', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('calls setWatermark with values from form', () => {
    const ctx = makeCtx();
    const panel = new WatermarkPanel(ctx);
    panel.open();
    ctx.ui.wmEnabled.checked = true;
    ctx.ui.wmText.value = 'DRAFT';
    ctx.ui.wmFontSize.value = '72';
    ctx.ui.wmOpacity.value = '40';
    ctx.ui.wmAngle.value = '30';
    ctx.ui.wmDensity.value = '4';
    panel.apply();
    expect(ctx.setWatermark).toHaveBeenCalledWith(expect.objectContaining({
      enabled: true,
      text: 'DRAFT',
      fontSize: 72,
      opacity: 0.4,
      angle: 30,
      density: 4,
    }));
  });

  it('calls autosave after applying', () => {
    const ctx = makeCtx();
    const panel = new WatermarkPanel(ctx);
    panel.open();
    panel.apply();
    expect(ctx.autosave).toHaveBeenCalled();
  });

  it('closes modal after applying', () => {
    const ctx = makeCtx();
    const panel = new WatermarkPanel(ctx);
    panel.open();
    panel.apply();
    expect(ctx.ui.watermarkModal.classList.contains('active')).toBe(false);
  });

  it('triggers showExportPreview when exportPreviewOpen', () => {
    const ctx = makeCtx();
    (ctx as { exportPreviewOpen: boolean }).exportPreviewOpen = true;
    const panel = new WatermarkPanel(ctx);
    panel.open();
    panel.apply();
    expect(ctx.showExportPreview).toHaveBeenCalled();
  });

  it('does NOT trigger showExportPreview when closed', () => {
    const ctx = makeCtx();
    const panel = new WatermarkPanel(ctx);
    panel.open();
    panel.apply();
    expect(ctx.showExportPreview).not.toHaveBeenCalled();
  });
});

describe('WatermarkPanel.syncBtn', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('adds active class when watermark is enabled', () => {
    const ctx = makeCtx({ ...defaultWm(), enabled: true });
    const panel = new WatermarkPanel(ctx);
    panel.syncBtn();
    expect(ctx.ui.watermarkBtn.classList.contains('active')).toBe(true);
  });

  it('removes active class when watermark is disabled', () => {
    const ctx = makeCtx({ ...defaultWm(), enabled: false });
    const panel = new WatermarkPanel(ctx);
    ctx.ui.watermarkBtn.classList.add('active');
    panel.syncBtn();
    expect(ctx.ui.watermarkBtn.classList.contains('active')).toBe(false);
  });
});
