import type { PDFTurboApp } from '../../core/pdfTurboApp';

export function bindFormattingEvents(app: PDFTurboApp): void {
  app.ui.fontFamily.addEventListener('change', (e) => {
    app.setFontFamily((e.target as HTMLInputElement).value);
  });
  app.ui.boldBtn.addEventListener('click', () => app.toggleBold());
  app.ui.italicBtn.addEventListener('click', () => app.toggleItalic());
  app.ui.underlineBtn.addEventListener('click', () => app.toggleUnderline());
  app.ui.strikeBtn.addEventListener('click', () => app.toggleStrikethrough());
  app.ui.alignBtn.addEventListener('click', () => app.cycleAlign());
  app.ui.fontSizeInput.addEventListener('change', (e) => {
    const size = Math.max(8, Math.min(72, parseInt((e.target as HTMLInputElement).value, 10) || 14));
    app.setFontSize(size);
  });
  app.ui.colorInput.addEventListener('input', (e) => {
    app.setElementColor((e.target as HTMLInputElement).value);
  });
  app.ui.fillNoneBtn.addEventListener('click', () => app.setFillNone());
  app.ui.fillColorInput.addEventListener('mousedown', () => app.startFillColor());
  app.ui.fillColorInput.addEventListener('input', (e) => {
    app.setFillColor((e.target as HTMLInputElement).value);
  });
  app.ui.redactColorInput.addEventListener('input', (e) => {
    app.setRedactColor((e.target as HTMLInputElement).value);
  });
  document.getElementById('redactEyedropperBtn')?.addEventListener('click', async () => {
    if (!('EyeDropper' in window)) { app.reportError.warn('toast.eyedropperUnsupported'); return; }
    try {
      const dropper = new (window as { EyeDropper: new() => { open(): Promise<{ sRGBHex: string }> } }).EyeDropper();
      const result = await dropper.open();
      app.ui.redactColorInput.value = result.sRGBHex;
      app.ui.redactColorInput.dispatchEvent(new Event('input', { bubbles: true }));
    } catch { /* user cancelled */ }
  });
  app.ui.colorEyedropperBtn.addEventListener('click', async () => {
    if (!('EyeDropper' in window)) { app.reportError.warn('toast.eyedropperUnsupported'); return; }
    try {
      const dropper = new (window as { EyeDropper: new() => { open(): Promise<{ sRGBHex: string }> } }).EyeDropper();
      const result = await dropper.open();
      app.ui.colorInput.value = result.sRGBHex;
      app.ui.colorInput.dispatchEvent(new Event('input', { bubbles: true }));
    } catch { /* user cancelled */ }
  });
  app.ui.fontSizeDownBtn.addEventListener('click', () => app.adjustFontSize(-2));
  app.ui.fontSizeUpBtn.addEventListener('click', () => app.adjustFontSize(2));
  app.ui.shapeWidth.addEventListener('change', (e) => {
    app.setShapeStrokeWidth(parseInt((e.target as HTMLInputElement).value, 10) || 2);
  });
}
