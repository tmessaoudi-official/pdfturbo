# Forms fill / flatten (#62) + AcroForm residue — QA review 2026-06-23

Reviewer: skeptical senior code review pass.
Files read:
- `src/utils/formFieldOverlay.ts` (interactive overlay controls)
- `src/export/exportService.ts` (`applyFormFieldValue`, `_assemblePdfDoc` fill+flatten, `downloadFlattened`, `_applyOverlaysToPage`)
- `src/core/pageRenderPipeline.ts` (`_renderFormFields` wiring + `onValueChange`)
- `src/core/pdfTurboApp.ts` (`setFormValue`, `_formValues`, `formValues` getter)
- `src/infra/storage.ts` (`SavedState.formValues` persistence)
- `src/ui/documentLoader.ts` (restore/reset of form values)
- `locales/{en,fr,ar}.json` (toast keys)
- `tests/export/{formFieldFill,flatten}.test.ts`

## Summary of architecture (verified)

- The interactive overlay (`FormFieldOverlay`) renders HTML `<input>/<select>` over pdf.js widget rects. Values are pushed via `onValueChange` → `setFormValue(sourcePdfId, fieldName, value)` (pdfTurboApp.ts:169) → a flat `_formValues[srcId][fieldName] = string` map → `autosave()`.
- Export (`_assemblePdfDoc`): per source, if the user typed values OR `flattenAllForms`, it `getForm()`, applies each persisted value via `applyFormFieldValue` (type-dispatched), then `form.flatten()` — **before** `copyPages`. Ordering is correct: flatten bakes widget appearances into the source page content stream, then the baked page is copied. `copyPages` drops the doc `/AcroForm`, so flattened pages carry no widgets. Verified by `tests/export/flatten.test.ts` (0 widget annots after `downloadFlattened`).
- Rotation/crop/watermark/Bates overlays are applied to the copied page AFTER flatten in `buildPageOverlays`, so flattened field appearances rotate/crop with page content. No coordinate-flip defect found in the flatten path.
- XSS surface: text field values are written via `input.value` (DOM property) and baked via pdf-lib `setText` + `flatten` (vector text, no HTML). No `innerHTML` sink. Clean.

## Findings

### P1 — Form fills are NOT undoable (mutation bypasses the Command/history system)

`src/core/pdfTurboApp.ts:169-171`
```ts
setFormValue(sourcePdfId: string, fieldName: string, value: string): void {
  if (!this._formValues[sourcePdfId]) this._formValues[sourcePdfId] = {};
  this._formValues[sourcePdfId][fieldName] = value;
}
```
`src/core/pageRenderPipeline.ts:150-153`
```ts
(fieldName, value) => {
  this._ctx.setFormValue(docPage.sourcePdfId, fieldName, value);
  this._ctx.autosave();
}
```

**Evidence:** `setFormValue` mutates `_formValues` directly and calls `autosave()`. There is no `historyManager.push(...)` / Command object anywhere in the form-fill path (grep for `formValues`/`setFormValue` shows zero command usage). The project's cardinal rule (CLAUDE.md): "every mutation goes through a Command object pushed to `historyManager` — never mutate `documentModel` directly from a handler without a command, or undo breaks."

**Impact:** Ctrl+Z after typing into a form field does nothing to the field value (undo will instead pop the previous *element/document* command, silently skipping form edits — a confusing UX where undo "jumps over" form input). Filling a 30-field form then wanting to revert one entry has no undo path; the user must manually retype/clear. This is a real undo/redo gap, not a documented ceiling (CLAUDE.md does not list form-fill as a non-undoable exception).

**Category:** undo
**Recommendation:** Route form-value changes through a `SetFormValueCmd` (capturing `{srcId, fieldName, oldValue, newValue}`) pushed to `historyManager`, mirroring how text/element edits work. Coalesce rapid `input` events on a text field into one command on blur/debounce so each keystroke isn't a separate undo step.

---

### P2 — `toast.unsupportedFields` message is stale and actively misleading

`locales/en.json:504-505`
```
"unsupportedFields_one": "This PDF has {{count}} checkbox/dropdown field — only text fields are supported",
"unsupportedFields_other": "This PDF has {{count}} checkbox/dropdown fields — only text fields are supported",
```
fired from `src/core/pageRenderPipeline.ts:156-158` with `count = unsupportedCount`.

**Evidence:** `unsupportedCount` is computed in `formFieldOverlay.ts:58` as widgets failing `_isSupported`. But `_isSupported` (lines 32-37) now returns **true** for text (`Tx`), choice/dropdown/listbox (`Ch`), AND checkbox/radio (`Btn` with `checkBox || radioButton`). So `unsupported` = push-buttons + signature widgets only. The toast therefore:
1. Says the unsupported fields are "checkbox/dropdown" — but checkboxes and dropdowns ARE rendered as interactive controls (`_renderCheckbox`/`_renderRadio`/`_renderChoice`).
2. Says "only text fields are supported" — false; four field types are supported.

The message describes a much older state of the feature where only text fields worked. It now actively misinforms the user (e.g. fires on a PDF that has a push-button, telling them their checkboxes won't work when they will).

**Category:** rtl-i18n / ux
**Recommendation:** Rewrite all three locales to reflect reality, e.g. "This PDF has {{count}} field(s) (push-buttons / signatures) that can't be filled here." Have a native speaker confirm the Arabic (CLAUDE.md flags ar values as needing review).

---

### P2 — Low-zoom / small widgets silently disappear (no feedback)

`src/utils/formFieldOverlay.ts:91`
```ts
if (w < 2 || h < 2) return null;
```

**Evidence:** `_placeRect` returns null (control not rendered) when the viewport-projected widget is under 2px in either dimension. A 12–16pt checkbox/radio at a low zoom (e.g. scale 0.1) projects to ~1.2–1.6px and is dropped with no indication. The supported/unsupported counts are computed before placement (`render` lines 57-58), so the unsupported toast doesn't account for these; the field just isn't there.

**Impact:** Minor — at usable zoom levels widgets are >2px. But a user zoomed out who can't see/fill a field gets no feedback and may assume the PDF has no such field. Fill value for a dropped widget is still preserved if previously set (values map is independent of rendering), so it's a rendering-only gap, not data loss.

**Category:** ux
**Recommendation:** Acceptable as-is given it only bites at extreme zoom; optionally skip the cull when a stored value exists, or clamp to a 2px minimum hit-target so the control stays reachable.

---

### P3 — Form values persisted to IndexedDB in cleartext (consistent with existing design)

`src/infra/storage.ts:16` — `formValues?: Record<string, Record<string, string>>` is part of `SavedState`, written by autosave to IndexedDB.

**Evidence:** Form input (potentially PII: names, IDs, addresses typed into a fillable form) is persisted unencrypted. However this is consistent with the established design — the **entire source PDF bytes** are already stored unencrypted in the same `SavedState.sourcePdfs` (line 15). Form values are not an incremental exposure beyond what the document persistence model already does, and the app is explicitly offline/single-user/no-upload.

**Category:** security / data-safety
**Recommendation:** No action required for the threat model. Noted only for completeness — if a "clear session / privacy wipe" feature is ever added, ensure it clears `formValues` too (documentLoader.ts:347 already does `setFormValues({})` on reset, so the reset path is covered).

## Non-findings / verified clean

- **Flatten ordering across all source pages:** flatten runs on `srcDoc` before `copyPages`, so every page of every flattened source bakes correctly (not just page 1). Verified.
- **Untouched-field residue:** default `downloadPDF` intentionally leaves untouched sources' widgets (documented #62 behavior); `downloadFlattened` flattens every source unconditionally (`flattenAllForms: true`, exportService.ts:249) → 0 widgets. Matches CLAUDE.md + `flatten.test.ts`.
- **Field-value injection / XSS:** values flow through DOM `.value` and pdf-lib `setText`; no HTML interpolation. Clean.
- **`applyFormFieldValue` robustness:** missing field → no-op returns true (exportService.ts:64-66); bad option value → caught, returns false, collected into `droppedFields`, surfaced via `toast.formValueDropped` warn (lines 567-571). Good — no silent data loss, no export abort.
- **Rotation/crop interaction:** flatten output inherits page rotation/crop because overlays + `setRotation`/`setCropBox` are applied to the copied (already-flattened) page. No coordinate flip bug.
