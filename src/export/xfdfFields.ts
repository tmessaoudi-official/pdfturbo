/**
 * Form field values ↔ XFDF `<fields>` (limits row 26, D21).
 *
 * The fields a document has are read the way the form overlay reads them — pdf.js `getAnnotations()`
 * widgets (`getFieldObjects()` returned `{}` for the corpus's IRS forms, measured 2026-09-27) — from every
 * source page the document shows. A deleted page's fields are therefore not exported, and a field is
 * identified by its fully-qualified name, the key the value store already uses.
 *
 * **An XFDF carries TEXT, so a field whose widget sits under a redaction is left out entirely** — the value
 * the user typed and the value the PDF was filled with alike. It is the same rule `exportXfdf` applies to
 * overlay elements, and the same test (`annotationRectRedacted` over `redactionRectToPageSpace`) the export
 * uses to strip a covered annotation. A field with a widget under a redaction on ANY page is dropped whole.
 *
 * Values in the store are strings: a checkbox or radio is its on-value or `''`, a multi-select list is
 * newline-joined. XFDF writes an unticked button as `Off` and each selected option as its own `<value>`.
 */
import type { XfdfField } from '../utils/xfdf';
import type { PDFElement } from '../elements/annotationElement';
import type { DocumentPage } from '../core/documentModel';
import { sourceFieldValue } from '../utils/formFieldOverlay';
import { redactionRectToPageSpace } from '../utils/geometry';
import { pointViewport } from '../utils/pointViewport';
import { annotationRectRedacted } from './exportPipeline';

export type FieldKind = 'text' | 'checkbox' | 'radio' | 'choice' | 'list';

interface WidgetAnnot {
  subtype: string;
  fieldType?: string;
  fieldName?: string;
  fieldValue?: string | string[] | null;
  rect: number[];
  checkBox?: boolean;
  radioButton?: boolean;
  combo?: boolean;
  multiSelect?: boolean;
}

/** One field widget on a page the document shows. */
export interface FormWidget {
  srcId: string;
  name: string;
  kind: FieldKind;
  /** The PDF's own value, in the store's string form. */
  sourceValue: string;
  /** The widget's /Rect meets a redaction on its page. */
  redacted: boolean;
}

/** The fillable kind of a widget, or null for a push button, a signature or anything else. */
export function widgetKind(a: WidgetAnnot): FieldKind | null {
  if (a.subtype !== 'Widget' || !a.fieldName) return null;
  if (a.fieldType === 'Tx') return 'text';
  if (a.fieldType === 'Btn') return a.checkBox ? 'checkbox' : a.radioButton ? 'radio' : null;
  if (a.fieldType === 'Ch') return !a.combo && a.multiSelect ? 'list' : 'choice';
  return null;
}

type SourcePdfsLike = Map<string, {
  doc: {
    getPage(n: number): Promise<{
      rotate?: number;
      userUnit?: number;
      getAnnotations(): Promise<unknown[]>;
      getViewport(o: { scale: number; rotation?: number }): { viewBox: readonly number[] };
    }>;
  };
}>;

/** Every fillable widget on the source pages `docPages` show, each tested against its page's redactions. */
export async function collectFormWidgets(
  docPages: readonly DocumentPage[],
  sourcePdfs: SourcePdfsLike,
  elements: readonly PDFElement[],
): Promise<FormWidget[]> {
  const out: FormWidget[] = [];
  for (const docPage of docPages) {
    if (docPage.sourcePdfId === 'blank') continue;
    const src = sourcePdfs.get(docPage.sourcePdfId);
    if (!src) continue;
    const page = await src.doc.getPage(docPage.sourcePageNum);
    const viewBox = pointViewport(page, { scale: 1, rotation: 0 }).viewBox;
    const totalRot = ((((page.rotate ?? 0) + (docPage.rotation ?? 0)) % 360) + 360) % 360;
    const redactions = elements
      .filter(el => el.pageId === docPage.id && el.type === 'redaction')
      .map(el => redactionRectToPageSpace(el, viewBox, totalRot));
    for (const a of (await page.getAnnotations()) as WidgetAnnot[]) {
      const kind = widgetKind(a);
      if (!kind) continue;
      out.push({
        srcId: docPage.sourcePdfId,
        name: a.fieldName as string,
        kind,
        sourceValue: sourceFieldValue(a),
        redacted: annotationRectRedacted(a.rect, redactions, viewBox[3]),
      });
    }
  }
  return out;
}

/** A stored value → XFDF `<value>`s for a field of `kind`. */
function toXfdfValues(kind: FieldKind, v: string): string[] {
  if (kind === 'checkbox' || kind === 'radio') return [v === '' ? 'Off' : v];
  if (kind === 'list') return v === '' ? [] : v.split('\n');
  return [v];
}

/**
 * The `<fields>` to export: each field once (first in page order wins a name shared by two sources), with the
 * user's value when set, else the PDF's own. A field with no value from either side is left out, and so is any
 * field with a widget under a redaction.
 */
export function fieldsForExport(
  widgets: readonly FormWidget[],
  formValues: Readonly<Record<string, Readonly<Record<string, string>>>>,
): XfdfField[] {
  const covered = new Set(widgets.filter(w => w.redacted).map(w => w.name));
  const out: XfdfField[] = [];
  const seen = new Set<string>();
  for (const w of widgets) {
    if (covered.has(w.name) || seen.has(w.name)) continue;
    seen.add(w.name);
    const userSet = formValues[w.srcId]?.[w.name];
    const value = userSet ?? w.sourceValue;
    if (userSet === undefined && value === '') continue;
    const values = toXfdfValues(w.kind, value);
    if (values.length) out.push({ name: w.name, values });
  }
  return out;
}

/** One field fill to apply on import: the store key and its value in the store's string form. */
export interface FieldFill { srcId: string; name: string; value: string }

/**
 * XFDF `<fields>` → fills for every source that has a field of that name (XFDF names fields, not sources).
 * `Off` unticks a button — stored as `''`, because the bake checks a checkbox for ANY non-empty value.
 * Names no source has are counted as skipped.
 */
export function fillsFromXfdf(fields: readonly XfdfField[], widgets: readonly FormWidget[]): { fills: FieldFill[]; skipped: number } {
  const fills: FieldFill[] = [];
  let skipped = 0;
  for (const f of fields) {
    const targets = new Map<string, FieldKind>();
    for (const w of widgets) if (w.name === f.name && !targets.has(w.srcId)) targets.set(w.srcId, w.kind);
    if (!targets.size) { skipped++; continue; }
    for (const [srcId, kind] of targets) {
      let value: string;
      if (kind === 'checkbox' || kind === 'radio') value = f.values[0] === 'Off' ? '' : (f.values[0] ?? '');
      else if (kind === 'list') value = f.values.join('\n');
      else value = f.values[0] ?? '';
      fills.push({ srcId, name: f.name, value });
    }
  }
  return { fills, skipped };
}
