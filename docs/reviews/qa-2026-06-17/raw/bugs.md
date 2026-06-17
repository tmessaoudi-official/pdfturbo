# Sleuth — runtime bugs (passes review, fails live) — 2026-06-17

Read-only analysis. No source edited. Focus: handlers, historyManager command discipline,
export pipeline, storage restore, elementFactory. Drawn-signature regression investigated first.

## P0 — DRAWN-signature "resets on Save" (root-cause hypothesis)

The user-reported symptom ("the drawn signature is LOST / RESETS when I click Save") is almost
certainly the **signature MODAL re-opening with a blank pad the instant you click the modal's
"Save" button** — not the document download. Trace:

1. Toolbar ✍ click → `setMode('addSignature')` → `ToolModeService.setMode` (`src/core/toolModeService.ts:48`)
   unconditionally calls `ctx.openSignatureModal()`. Modal opens; `SignatureManager.openModal`
   (`src/core/signatureManager.ts:30`) calls `signaturePad.clear()`.
2. User draws, clicks the modal **Save** (`saveSignature` → `SignatureManager.save`,
   `src/core/signatureManager.ts:46`). It correctly stores `currentSignature`, removes the modal's
   `active` class, then on **line 56 calls `setMode('addSignature')` again**.
3. That second `setMode('addSignature')` RE-ENTERS `ToolModeService.setMode:48` →
   `openSignatureModal()` → modal re-shows AND `signaturePad.clear()` wipes the canvas.

So clicking "Save" makes the just-drawn signature visibly disappear and the empty modal pop back
up. The `currentSignature` data URL is in fact retained, but the UX reads as "it reset". If the user
then clicks Save again on the now-blank pad, `isEmpty()` is true → `warn('toast.drawSignatureFirst')`
and `currentSignature` is left intact but no placement happens — reinforcing "the signature is lost".
(Placement itself only happens later, on a canvas drag in `addSignature` mode →
`DrawingHandler` → `_commitPlacement` → `placementManager.ts:185-201`, which IS correct and undoable.)

Root cause: `save()` re-uses `setMode('addSignature')` purely to set the active-mode state, but
`addSignature` mode has the side effect of opening (and clearing) the modal. The mode-entry side
effect and the "arm placement after save" intent are conflated. **Long-standing latent coupling**
(the `mode==='addSignature' → openSignatureModal()` side effect predates the SignatureManager /
ToolModeService extraction `b8e7927`; `save()` has always called `setMode('addSignature')`).

Fix direction (NOT applied — read-only): decouple "modal open" from "mode entry". Options:
(a) `save()` should set the armed-placement state without routing through the modal-opening branch
(e.g. set `mode='addSignature'` + button-active directly, or add a `armSignaturePlacement()` that
does the non-modal half of setMode); or (b) gate `openSignatureModal()` in `setMode` so it only
opens when there is no pending `currentSignature` / when entering from a non-armed state. Verify
live with Playwright (jsdom won't reproduce the visible modal flash but the second `openModal()`
call + `clear()` is assertable).

| Bug | Location | Repro / Trigger | Severity |
|-----|----------|-----------------|----------|
| Drawn-signature modal re-opens & clears the pad on "Save" (signature appears to reset/vanish) | `signatureManager.ts:56` (`save()` calls `setMode('addSignature')`) + `toolModeService.ts:48` (`addSignature` mode → `openSignatureModal()` → `openModal()` `signaturePad.clear()` `signatureManager.ts:30`) | ✍ toolbar → draw in modal → click modal **Save**; modal immediately re-appears blank. Save-again on blank pad → `toast.drawSignatureFirst`, no placement | **P0** (matches user report; core feature unusable / confusing) |

## Other findings (secondary scan)

| Bug | Location | Repro / Trigger | Severity |
|-----|----------|-----------------|----------|
| `signature` and `code` elements both serialize their payload under the JSON key `data`, but mean different things (signature = PNG data-URL; code = QR/barcode source text, with the image in `cachedDataUrl`). Restore relies on `type` to disambiguate, so it works today — but the overloaded key is a latent foot-gun for any future generic-by-key handling. | `elementFactory.ts:33` (sig reads `data['data']`) vs `:68` (code reads `data['data']` as source text + `cachedDataUrl` as image); `signatureElement.toJSON` `signatureElement.ts:34` vs `codeElement` | Not user-reproducible today; fragile under future refactor / XFDF-style generic mapping | P3 (latent) |
| `ElementFactory.fromJSON` `applyBase` sets `el.id = data['id']` unconditionally; a malformed/legacy blob missing `id` yields `el.id = undefined`, which then poisons `syncIdCounter` (`Math.floor(undefined)` → `NaN`, `Math.max(0, NaN)` → `NaN`) — every subsequently created element could get a broken id. Signature/text restore from a hand-edited or pre-id session blob is the trigger. | `elementFactory.ts:17-19`, `:79` | Restore a session/IndexedDB blob whose element lacks `id` (legacy / corrupted) | P2 (restore-path robustness; not the reported bug) |

## Cleared (looked suspicious, verified CORRECT — no action)

- **Move/resize/rotate drag** mutates `el.x/.y/.width/.height/.rotation` directly during the gesture
  (`interactionHandler.ts:155-156,183-189,218`) but `_finish()` records a `MoveResizeCmd`/`RotateElementCmd`
  with captured before/after state (`:235`,`:246`) → undo works. Intended live-preview-then-record pattern.
- **Signature persistence round-trip**: `SignatureElement.toJSON` includes `data`
  (`signatureElement.ts:34`); session serialization maps `el.toJSON()` (`sessionManager.ts:31`); restore
  rebuilds via `fromJSON` with `data['data']` (`elementFactory.ts:33`). Round-trip intact.
- **Export of signature**: `exportService` filters `elements.filter(el => el.pageId === docPage.id)`
  (`:413/:570/:626`) and `renderSignature` embeds the PNG (`pdfElementRenderer.ts:145-155`) — signature
  IS included in downloaded/assembled PDF. The reported "lost on Save" is the modal-reset above, not a
  missing-from-export bug.
- No empty `catch {}` blocks in handlers/export/historyManager/storage.
- `void this.app.cropPage(...)` (`drawingHandler.ts:251`) and `await applyZoom` are intentional and guarded.
