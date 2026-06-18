import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CodeModalManager, type ICodeModalContext } from '../../src/ui/codeModalManager';
import { getCodeFormat, type CodeFormat } from '../../src/utils/codeGenerator';
import { HistoryManager } from '../../src/core/historyManager';
import type { AppDOMRefs } from '../../src/ui/uiController';
import type { ToolMode } from '../../src/core/pdfTurboApp';
import type { CodeElement } from '../../src/elements/codeElement';
import type { PDFElement } from '../../src/elements/annotationElement';

vi.mock('../../src/utils/i18n', () => ({ t: (key: string) => key }));
vi.mock('../../src/utils/focusTrap', () => ({ trapFocus: vi.fn().mockReturnValue(vi.fn()) }));
vi.mock('../../src/utils/codeGenerator', () => ({
  generateCodeDataUrl: vi.fn().mockResolvedValue('data:image/png;base64,ABC'),
  getCodeFormat: vi.fn().mockReturnValue(null),
}));

// jsdom does not load images; fire onload synchronously when src is set
vi.stubGlobal('Image', class MockImage {
  naturalWidth = 100;
  naturalHeight = 100;
  onload: (() => void) | null = null;
  set src(_: string) { if (this.onload) this.onload(); }
});

function makeUI(): Pick<AppDOMRefs,
  | 'codeFormatSelect' | 'codeDataInput' | 'qrStyledChk' | 'qrEclevelSelect'
  | 'qrDotStyle' | 'qrDotColor' | 'qrBgColor' | 'qrLogoInput' | 'qrLogoName'
  | 'qrLogoClearBtn' | 'barcodeShowTextChk' | 'codePreviewImg' | 'codePreviewStatus'
  | 'saveCodeModal' | 'codeModal' | 'addCodeBtn' | 'qrStyleSection' | 'qrStyleControls'
  | 'barcodeShowTextRow'
> {
  const codeModal = document.createElement('div');
  const h2 = document.createElement('h2');
  const content = document.createElement('div');
  content.className = 'code-modal-content';
  codeModal.appendChild(h2);
  codeModal.appendChild(content);
  document.body.appendChild(codeModal);

  const codeFormatSelect = document.createElement('select');
  const opt = document.createElement('option');
  opt.value = 'qrcode';
  opt.selected = true;
  codeFormatSelect.appendChild(opt);
  const opt128 = document.createElement('option');
  opt128.value = 'code128';
  codeFormatSelect.appendChild(opt128);

  const codeDataInput = document.createElement('input');
  const qrStyledChk = document.createElement('input');
  qrStyledChk.type = 'checkbox';
  const qrEclevelSelect = document.createElement('select');
  const qrDotStyle = document.createElement('select');
  const qrDotColor = document.createElement('input');
  qrDotColor.type = 'color';
  const qrBgColor = document.createElement('input');
  qrBgColor.type = 'color';
  const qrLogoInput = document.createElement('input');
  qrLogoInput.type = 'file';
  const qrLogoName = document.createElement('span');
  const qrLogoClearBtn = document.createElement('button');
  const barcodeShowTextChk = document.createElement('input');
  barcodeShowTextChk.type = 'checkbox';
  const codePreviewImg = document.createElement('img');
  const codePreviewStatus = document.createElement('span');
  const saveCodeModal = document.createElement('button');
  const addCodeBtn = document.createElement('button');
  const qrStyleSection = document.createElement('div');
  const qrStyleControls = document.createElement('div');
  const barcodeShowTextRow = document.createElement('div');

  return {
    codeModal,
    codeFormatSelect,
    codeDataInput,
    qrStyledChk,
    qrEclevelSelect,
    qrDotStyle,
    qrDotColor,
    qrBgColor,
    qrLogoInput,
    qrLogoName,
    qrLogoClearBtn,
    barcodeShowTextChk,
    codePreviewImg,
    codePreviewStatus,
    saveCodeModal,
    addCodeBtn,
    qrStyleSection,
    qrStyleControls,
    barcodeShowTextRow,
  } as unknown as AppDOMRefs;
}

function makeCtx(ui: ReturnType<typeof makeUI>, initialMode: ToolMode = 'select'): ICodeModalContext & { mode: ToolMode; historyManager: HistoryManager } {
  const ctx = {
    ui: ui as unknown as AppDOMRefs,
    elements: [] as PDFElement[],
    historyManager: new HistoryManager(50, vi.fn()),
    mode: initialMode,
    setMode: vi.fn((m: ToolMode) => { ctx.mode = m; }),
    autosave: vi.fn(),
    rebuildElementLayer: vi.fn(),
    setPendingCode: vi.fn(),
  };
  return ctx;
}

describe('CodeModalManager.open', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('adds active class to modal', () => {
    const ui = makeUI();
    const ctx = makeCtx(ui);
    const mgr = new CodeModalManager(ctx);
    mgr.open();
    expect(ui.codeModal.classList.contains('active')).toBe(true);
  });

  it('resets form for new element (no arg)', () => {
    const ui = makeUI();
    const ctx = makeCtx(ui);
    const mgr = new CodeModalManager(ctx);
    ui.codeDataInput.value = 'previous data';
    mgr.open();
    expect(ui.codeDataInput.value).toBe('');
    expect(ui.saveCodeModal.disabled).toBe(true);
  });

  it('disables saveCodeModal button on open', () => {
    const ui = makeUI();
    const ctx = makeCtx(ui);
    const mgr = new CodeModalManager(ctx);
    ui.saveCodeModal.disabled = false;
    mgr.open();
    expect(ui.saveCodeModal.disabled).toBe(true);
  });
});

describe('CodeModalManager.close', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('removes active class from modal', () => {
    const ui = makeUI();
    const ctx = makeCtx(ui);
    const mgr = new CodeModalManager(ctx);
    mgr.open();
    mgr.close();
    expect(ui.codeModal.classList.contains('active')).toBe(false);
  });

  it('calls setMode("select") when not in addCode mode', () => {
    const ui = makeUI();
    const ctx = makeCtx(ui, 'select');
    const mgr = new CodeModalManager(ctx);
    mgr.open();
    mgr.close();
    expect(ctx.setMode).toHaveBeenCalledWith('select');
  });

  it('does NOT call setMode when already in addCode mode', () => {
    const ui = makeUI();
    const ctx = makeCtx(ui, 'addCode');
    const mgr = new CodeModalManager(ctx);
    mgr.open();
    (ctx.setMode as ReturnType<typeof vi.fn>).mockClear();
    mgr.close();
    expect(ctx.setMode).not.toHaveBeenCalled();
  });
});

describe('CodeModalManager.save', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('does nothing when data input is empty', async () => {
    const ui = makeUI();
    const ctx = makeCtx(ui);
    const mgr = new CodeModalManager(ctx);
    mgr.open();
    ui.codeDataInput.value = '   ';
    await mgr.save();
    expect(ctx.setPendingCode).not.toHaveBeenCalled();
    expect(ctx.setMode).not.toHaveBeenCalledWith('addCode');
  });

  it('calls setPendingCode and setMode("addCode") for new element', async () => {
    const ui = makeUI();
    const ctx = makeCtx(ui);
    const mgr = new CodeModalManager(ctx);
    mgr.open();
    ui.codeDataInput.value = 'https://example.com';
    await mgr.save();
    expect(ctx.setPendingCode).toHaveBeenCalled();
    expect(ctx.setMode).toHaveBeenCalledWith('addCode');
  });

  it('updates existing element in-place and calls autosave + rebuildElementLayer', async () => {
    const ui = makeUI();
    const ctx = makeCtx(ui);
    const fakeEl = { id: 42, codeType: 'qrcode', data: 'old', qrStyle: null, bwipOpts: null, cachedDataUrl: '' } as unknown as CodeElement;
    (ctx.elements as PDFElement[]).push(fakeEl);
    const mgr = new CodeModalManager(ctx);
    mgr.open(fakeEl);
    ui.codeDataInput.value = 'new-data';
    await mgr.save();
    expect(fakeEl.data).toBe('new-data');
    expect(ctx.autosave).toHaveBeenCalled();
    expect(ctx.rebuildElementLayer).toHaveBeenCalled();
    expect(ctx.setMode).not.toHaveBeenCalledWith('addCode');
  });

  it('records a command on in-place edit, and undo restores prior data + codeType', async () => {
    const ui = makeUI();
    const ctx = makeCtx(ui);
    const fakeEl = { id: 7, codeType: 'qrcode', data: 'old-data', qrStyle: null, bwipOpts: null, cachedDataUrl: 'old-url' } as unknown as CodeElement;
    (ctx.elements as PDFElement[]).push(fakeEl);
    const mgr = new CodeModalManager(ctx);
    mgr.open(fakeEl);
    ui.codeFormatSelect.value = 'code128';
    ui.codeDataInput.value = 'new-data';
    await mgr.save();
    expect(fakeEl.data).toBe('new-data');
    expect(fakeEl.codeType).toBe('code128');
    expect(ctx.historyManager.canUndo()).toBe(true);
    ctx.historyManager.undo();
    expect(fakeEl.data).toBe('old-data');
    expect(fakeEl.codeType).toBe('qrcode');
  });

  it('closes the modal after save', async () => {
    const ui = makeUI();
    const ctx = makeCtx(ui);
    const mgr = new CodeModalManager(ctx);
    mgr.open();
    ui.codeDataInput.value = 'test';
    await mgr.save();
    expect(ui.codeModal.classList.contains('active')).toBe(false);
  });
});

describe('CodeModalManager.syncVisibility', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('shows QR style section for qrcode format', () => {
    const ui = makeUI();
    const ctx = makeCtx(ui);
    const mgr = new CodeModalManager(ctx);
    ui.qrStyleSection.style.display = 'none';
    ui.codeFormatSelect.value = 'qrcode';
    mgr.syncVisibility();
    expect(ui.qrStyleSection.style.display).toBe('');
  });

  it('hides QR style section for non-qr format', () => {
    const ui = makeUI();
    const ctx = makeCtx(ui);
    const mgr = new CodeModalManager(ctx);
    ui.codeFormatSelect.value = 'code128';
    mgr.syncVisibility();
    expect(ui.qrStyleSection.style.display).toBe('none');
  });

  it('shows barcode text row for 1D barcodes', () => {
    const ui = makeUI();
    const ctx = makeCtx(ui);
    const mgr = new CodeModalManager(ctx);
    ui.codeFormatSelect.value = 'code128';
    mgr.syncVisibility();
    expect(ui.barcodeShowTextRow.style.display).toBe('');
  });

  it('hides barcode text row for 2D codes', () => {
    const ui = makeUI();
    const ctx = makeCtx(ui);
    const mgr = new CodeModalManager(ctx);
    ui.codeFormatSelect.value = 'qrcode';
    mgr.syncVisibility();
    expect(ui.barcodeShowTextRow.style.display).toBe('none');
  });

  // ── I1: per-format input placeholder (wire the previously-dead field) ──────
  const fmt = (id: string, placeholder: string): CodeFormat =>
    ({ id, label: id, category: '2d', bcid: id, squareOutput: true, placeholder });

  it('sets codeDataInput placeholder from the selected format', () => {
    const ui = makeUI();
    const ctx = makeCtx(ui);
    const mgr = new CodeModalManager(ctx);
    vi.mocked(getCodeFormat).mockReturnValueOnce(fmt('qrcode', 'https://example.com'));
    ui.codeFormatSelect.value = 'qrcode';
    mgr.syncVisibility();
    expect(ui.codeDataInput.placeholder).toBe('https://example.com');
  });

  it('falls back to the generic anyText placeholder when the format has none', () => {
    const ui = makeUI();
    const ctx = makeCtx(ui);
    const mgr = new CodeModalManager(ctx);
    vi.mocked(getCodeFormat).mockReturnValueOnce(fmt('datamatrix', ''));
    ui.codeFormatSelect.value = 'datamatrix';
    mgr.syncVisibility();
    expect(ui.codeDataInput.placeholder).toBe('modal.code.anyTextPlaceholder');
  });
});

describe('CodeModalManager.setQrLogoDataUrl', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('stores the data URL', () => {
    const ui = makeUI();
    const ctx = makeCtx(ui);
    const mgr = new CodeModalManager(ctx);
    mgr.setQrLogoDataUrl('data:image/png;base64,X');
    // Verify indirectly via _getQrStyleOptions called in syncVisibility/save
    // Just ensure no error is thrown
    expect(() => mgr.setQrLogoDataUrl(null)).not.toThrow();
  });
});
