/**
 * G14 — PDF form-fill must honour checkbox / radio / dropdown / listbox, not only
 * text. The persisted value store is a flat `Record<fieldName, string>` (no schema
 * bump), so the bake path discovers each field's type from pdf-lib and applies the
 * stored string accordingly:
 *   - checkbox : on-value when checked, "" when unchecked
 *   - radio    : selected option's export (button) value
 *   - dropdown : selected export value
 *   - listbox  : selected export values joined by "\n" (multi-select)
 *
 * RED before G14: `applyFormFieldValue` does not exist (compile error) and the bake
 * loop only calls `getTextField().setText()`, so the four non-text types are ignored.
 *
 * Pure pdf-lib — jsdom suffices (no canvas / DOM overlay here; the interactive
 * overlay rendering is covered manually + by type-check, see the task report).
 */
import { describe, it, expect } from 'vitest';
import {
  PDFDocument,
  PDFCheckBox,
  PDFRadioGroup,
  PDFDropdown,
  PDFOptionList,
} from '@cantoo/pdf-lib';
import { ExportService, applyFormFieldValue, type IExportContext } from '../../src/export/exportService';
import { FormFieldOverlay } from '../../src/utils/formFieldOverlay';

/**
 * Author a source PDF with one of each interactive field type plus a text field.
 * Returns the bytes and the radio/checkbox on-values discovered from pdf-lib so the
 * test asserts against the real export values rather than hard-coded literals.
 */
async function multiFieldSourceBytes(): Promise<{
  bytes: Uint8Array;
  checkOn: string;
  radioOptions: string[];
}> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 600]);
  const form = doc.getForm();

  const text = form.createTextField('the.text');
  text.addToPage(page, { x: 40, y: 540, width: 200, height: 24 });

  const check = form.createCheckBox('the.check');
  check.addToPage(page, { x: 40, y: 500, width: 16, height: 16 });

  const radio = form.createRadioGroup('the.radio');
  radio.addOptionToPage('alpha', page, { x: 40, y: 460, width: 16, height: 16 });
  radio.addOptionToPage('beta', page, { x: 80, y: 460, width: 16, height: 16 });

  const dropdown = form.createDropdown('the.dropdown');
  dropdown.addOptions(['red', 'green', 'blue']);
  dropdown.addToPage(page, { x: 40, y: 420, width: 120, height: 24 });

  const list = form.createOptionList('the.list');
  list.addOptions(['one', 'two', 'three']);
  list.enableMultiselect();
  list.addToPage(page, { x: 40, y: 340, width: 120, height: 60 });

  const bytes = await doc.save({ useObjectStreams: false });
  const onName = check.acroField.getOnValue();
  return {
    bytes,
    checkOn: onName ? onName.decodeText() : 'On',
    radioOptions: radio.getOptions(),
  };
}

interface Probe {
  svc: ExportService;
  downloads: { blob: Blob; filename: string }[];
  warns: { key: string; opts?: unknown }[];
}

function buildProbe(src: Uint8Array, formValues: Record<string, Record<string, string>>): Probe {
  const downloads: { blob: Blob; filename: string }[] = [];
  const warns: { key: string; opts?: unknown }[] = [];
  const handle = { done() {}, failed() {}, update() {}, setFraction() {} };
  const ctx = {
    documentModel: {
      pageCount: 1,
      pages: [{ id: 'p1', sourcePdfId: 's1', sourcePageNum: 1, rotation: 0 }],
      sourcePdfs: new Map([['s1', { bytes: src }]]),
      watermark: { enabled: false },
    },
    elements: [],
    formValues,
    currentFilename: 'form.pdf',
    exportPassword: null,
    inkLayer: { getStrokes: () => [] },
    reportError: { info: () => {}, warn: (key: string, opts?: unknown) => warns.push({ key, opts }), error: () => {} },
    progress: { begin: () => handle },
    cleanEmptyTextElements() {},
    renderCurrentPage: () => Promise.resolve(),
    rebuildElementLayer() {},
  } as unknown as IExportContext;
  const svc = new ExportService(ctx);
  (svc as unknown as { _downloadBlob: (b: Blob, f: string) => void })._downloadBlob = (blob, filename) =>
    downloads.push({ blob, filename });
  return { svc, downloads, warns };
}

describe('G14 — form-fill applies checkbox/radio/dropdown/listbox values', () => {
  it('applyFormFieldValue checks a checkbox by its on-value (and unchecks on empty)', async () => {
    const { bytes, checkOn } = await multiFieldSourceBytes();
    const doc = await PDFDocument.load(bytes);
    const form = doc.getForm();

    applyFormFieldValue(form, 'the.check', checkOn);
    expect((form.getField('the.check') as PDFCheckBox).isChecked()).toBe(true);

    applyFormFieldValue(form, 'the.check', '');
    expect((form.getField('the.check') as PDFCheckBox).isChecked()).toBe(false);
  });

  it('applyFormFieldValue selects a radio option', async () => {
    const { bytes, radioOptions } = await multiFieldSourceBytes();
    const doc = await PDFDocument.load(bytes);
    const form = doc.getForm();
    const target = radioOptions[1]; // 'beta'
    applyFormFieldValue(form, 'the.radio', target);
    expect((form.getField('the.radio') as PDFRadioGroup).getSelected()).toBe(target);
  });

  it('applyFormFieldValue selects a dropdown option', async () => {
    const { bytes } = await multiFieldSourceBytes();
    const doc = await PDFDocument.load(bytes);
    const form = doc.getForm();
    applyFormFieldValue(form, 'the.dropdown', 'green');
    expect((form.getField('the.dropdown') as PDFDropdown).getSelected()).toEqual(['green']);
  });

  it('applyFormFieldValue selects one or many listbox options (newline-joined)', async () => {
    const { bytes } = await multiFieldSourceBytes();
    const doc = await PDFDocument.load(bytes);
    const form = doc.getForm();
    applyFormFieldValue(form, 'the.list', 'one\nthree');
    const sel = (form.getField('the.list') as PDFOptionList).getSelected();
    expect([...sel].sort()).toEqual(['one', 'three']);
  });

  it('still fills a text field unchanged', async () => {
    const { bytes } = await multiFieldSourceBytes();
    const doc = await PDFDocument.load(bytes);
    const form = doc.getForm();
    applyFormFieldValue(form, 'the.text', 'hello world');
    expect((form.getField('the.text') as import('@cantoo/pdf-lib').PDFTextField).getText()).toBe('hello world');
  });

  it('a missing field name is a silent no-op (never throws)', async () => {
    const { bytes } = await multiFieldSourceBytes();
    const doc = await PDFDocument.load(bytes);
    const form = doc.getForm();
    expect(() => applyFormFieldValue(form, 'no.such.field', 'x')).not.toThrow();
  });

  // ── B1: a real option-mismatch must be surfaced, not silently swallowed ───
  // Empirically (pdf-lib): radio/listbox `.select(badValue)` THROW on a value
  // that isn't an option (real silent-drop) — dropdown is lenient and silently
  // accepts it (the typed value survives on flatten, so there's nothing to
  // drop). So the throwing types are what B1 must catch and report.
  it('returns true on a valid choice and false when a radio value is not an option', async () => {
    const { bytes, radioOptions } = await multiFieldSourceBytes();
    const doc = await PDFDocument.load(bytes);
    const form = doc.getForm();
    expect(applyFormFieldValue(form, 'the.radio', radioOptions[0])).toBe(true);
    expect(applyFormFieldValue(form, 'the.radio', 'not-an-option')).toBe(false);
  });

  it('returns false when a listbox value is not an option', async () => {
    const { bytes } = await multiFieldSourceBytes();
    const doc = await PDFDocument.load(bytes);
    const form = doc.getForm();
    expect(applyFormFieldValue(form, 'the.list', 'one')).toBe(true);
    expect(applyFormFieldValue(form, 'the.list', 'nope')).toBe(false);
  });

  it('returns true when there is no value to drop (missing field, text field)', async () => {
    const { bytes } = await multiFieldSourceBytes();
    const doc = await PDFDocument.load(bytes);
    const form = doc.getForm();
    expect(applyFormFieldValue(form, 'no.such.field', 'x')).toBe(true);
    expect(applyFormFieldValue(form, 'the.text', 'anything goes')).toBe(true);
  });

  it('export warns (toast.formValueDropped) when a typed value is dropped on mismatch', async () => {
    const { bytes } = await multiFieldSourceBytes();
    const { svc, warns } = buildProbe(bytes, { s1: { 'the.radio': 'not-an-option', 'the.text': 'ok' } });
    await svc.downloadPDF();
    expect(warns.some(w => w.key === 'toast.formValueDropped')).toBe(true);
  });

  it('export does NOT warn when all typed values are valid', async () => {
    const { bytes, radioOptions } = await multiFieldSourceBytes();
    const { svc, warns } = buildProbe(bytes, { s1: { 'the.radio': radioOptions[0], 'the.text': 'ok' } });
    await svc.downloadPDF();
    expect(warns.some(w => w.key === 'toast.formValueDropped')).toBe(false);
  });

  it('bakes all choice values into the exported PDF via downloadFlattened (e2e)', async () => {
    const { bytes, checkOn, radioOptions } = await multiFieldSourceBytes();
    const formValues = {
      s1: {
        'the.text': 'baked',
        'the.check': checkOn,
        'the.radio': radioOptions[1],
        'the.dropdown': 'blue',
        'the.list': 'two',
      },
    };
    const probe = buildProbe(bytes, formValues);
    await probe.svc.downloadFlattened();
    expect(probe.downloads).toHaveLength(1);
    // After flatten the fields are baked into static content (no AcroForm fields left)
    // and the output must be a valid, reloadable PDF.
    const out = new Uint8Array(await probe.downloads[0].blob.arrayBuffer());
    const reloaded = await PDFDocument.load(out, { updateMetadata: false });
    expect(reloaded.getForm().getFields()).toHaveLength(0);
    expect(reloaded.getPageCount()).toBe(1);
  });

  it('reflects checkbox/dropdown choices in getForm() BEFORE flatten (fill correctness)', async () => {
    // Drive only the fill (not the flatten) on the source, save, reload with
    // updateMetadata:false, and read the field state back — proves the bake path
    // mutated the real AcroForm, independent of flatten's appearance baking.
    const { bytes, checkOn } = await multiFieldSourceBytes();
    const doc = await PDFDocument.load(bytes);
    const form = doc.getForm();
    applyFormFieldValue(form, 'the.check', checkOn);
    applyFormFieldValue(form, 'the.dropdown', 'red');
    const saved = await doc.save({ useObjectStreams: false });
    const reloaded = await PDFDocument.load(saved, { updateMetadata: false });
    const rForm = reloaded.getForm();
    expect((rForm.getField('the.check') as PDFCheckBox).isChecked()).toBe(true);
    expect((rForm.getField('the.dropdown') as PDFDropdown).getSelected()).toEqual(['red']);
  });
});

// ── Interactive overlay rendering (jsdom — DOM controls are plain elements) ──

type Annot = Record<string, unknown> & { subtype: string; rect: number[] };

/** A fake pdf.js page + viewport: rect is returned 1:1 (identity placement). */
function fakePage(annots: Annot[]) {
  return { getAnnotations: () => Promise.resolve(annots) } as unknown as import('pdfjs-dist').PDFPageProxy;
}
function fakeViewport() {
  return {
    convertToViewportPoint: (x: number, y: number) => [x, y],
  } as unknown as import('pdfjs-dist').PageViewport;
}

describe('G14 — interactive overlay renders the new field controls', () => {
  it('renders checkbox / radio / dropdown / listbox controls and reports only pushButton/Sig unsupported', async () => {
    const container = document.createElement('div');
    const overlay = new FormFieldOverlay(container);
    const annots: Annot[] = [
      { subtype: 'Widget', fieldType: 'Tx', fieldName: 't', rect: [0, 0, 100, 20] },
      { subtype: 'Widget', fieldType: 'Btn', checkBox: true, buttonValue: 'Yes', fieldName: 'c', rect: [0, 30, 16, 46] },
      { subtype: 'Widget', fieldType: 'Btn', radioButton: true, buttonValue: 'a', fieldName: 'r', rect: [0, 60, 16, 76] },
      { subtype: 'Widget', fieldType: 'Btn', radioButton: true, buttonValue: 'b', fieldName: 'r', rect: [30, 60, 46, 76] },
      { subtype: 'Widget', fieldType: 'Ch', combo: true, options: [{ exportValue: 'x', displayValue: 'X' }], fieldName: 'd', rect: [0, 90, 120, 110] },
      { subtype: 'Widget', fieldType: 'Ch', multiSelect: true, options: [{ exportValue: 'm', displayValue: 'M' }], fieldName: 'l', rect: [0, 120, 120, 180] },
      { subtype: 'Widget', fieldType: 'Btn', pushButton: true, fieldName: 'submit', rect: [0, 200, 80, 220] },
      { subtype: 'Widget', fieldType: 'Sig', fieldName: 'sig', rect: [0, 230, 120, 260] },
    ];
    const { unsupportedCount } = await overlay.render(
      fakePage(annots), fakeViewport(), { left: 0, top: 0 }, {}, () => {},
    );
    expect(container.querySelectorAll('input[type=text]')).toHaveLength(1);
    expect(container.querySelectorAll('input[type=checkbox]')).toHaveLength(1);
    expect(container.querySelectorAll('input[type=radio]')).toHaveLength(2);
    // combo (single) + multi listbox → 2 <select>; the multi one is [multiple]
    expect(container.querySelectorAll('select')).toHaveLength(2);
    expect(container.querySelectorAll('select[multiple]')).toHaveLength(1);
    // push-button + signature are the only unsupported widgets (still counted)
    expect(unsupportedCount).toBe(2);
  });

  it('checkbox toggle reports the on-value / empty via the same callback', async () => {
    const container = document.createElement('div');
    const overlay = new FormFieldOverlay(container);
    const seen: Array<[string, string]> = [];
    await overlay.render(
      fakePage([{ subtype: 'Widget', fieldType: 'Btn', checkBox: true, buttonValue: 'Yes', fieldName: 'c', rect: [0, 0, 16, 16] }]),
      fakeViewport(), { left: 0, top: 0 }, {}, (n, v) => seen.push([n, v]),
    );
    const box = container.querySelector('input[type=checkbox]') as HTMLInputElement;
    box.checked = true;
    box.dispatchEvent(new Event('change'));
    box.checked = false;
    box.dispatchEvent(new Event('change'));
    expect(seen).toEqual([['c', 'Yes'], ['c', '']]);
  });

  it('listbox multi-select reports newline-joined export values', async () => {
    const container = document.createElement('div');
    const overlay = new FormFieldOverlay(container);
    const seen: Array<[string, string]> = [];
    await overlay.render(
      fakePage([{
        subtype: 'Widget', fieldType: 'Ch', multiSelect: true, fieldName: 'l', rect: [0, 0, 120, 60],
        options: [{ exportValue: 'one', displayValue: 'One' }, { exportValue: 'two', displayValue: 'Two' }],
      }]),
      fakeViewport(), { left: 0, top: 0 }, {}, (n, v) => seen.push([n, v]),
    );
    const sel = container.querySelector('select') as HTMLSelectElement;
    sel.options[0].selected = true;
    sel.options[1].selected = true;
    sel.dispatchEvent(new Event('change'));
    expect(seen).toEqual([['l', 'one\ntwo']]);
  });

  it('restores a stored checkbox tick and dropdown selection on render', async () => {
    const container = document.createElement('div');
    const overlay = new FormFieldOverlay(container);
    await overlay.render(
      fakePage([
        { subtype: 'Widget', fieldType: 'Btn', checkBox: true, buttonValue: 'Yes', fieldName: 'c', rect: [0, 0, 16, 16] },
        { subtype: 'Widget', fieldType: 'Ch', combo: true, fieldName: 'd', rect: [0, 30, 120, 50],
          options: [{ exportValue: 'red', displayValue: 'Red' }, { exportValue: 'blue', displayValue: 'Blue' }] },
      ]),
      fakeViewport(), { left: 0, top: 0 }, { c: 'Yes', d: 'blue' }, () => {},
    );
    expect((container.querySelector('input[type=checkbox]') as HTMLInputElement).checked).toBe(true);
    expect((container.querySelector('select') as HTMLSelectElement).value).toBe('blue');
  });
});
