# QA Review — History / Undo-Redo domain (2026-06-23)

Reviewer: skeptical senior code reviewer. Files read in full:
- `src/core/historyManager.ts`
- `src/core/commands/command.ts`, `macroCmds.ts`, `sourcePdfCmds.ts`, `pageCmds.ts`, `moveCmds.ts`, `elementCmds.ts`, `inkCmds.ts`
- `src/core/undoRedoController.ts`
- `src/core/pdfTurboApp.ts` (`_applySourcePdfEdit`, history wiring, lines ~336, 501–558, 920–944)
- `src/core/pageService.ts` (apply-to-all crop/rotate, lines ~110–193)
- `src/handlers/interactionHandler.ts` (drag/resize/rotate finalization, lines ~180–251)
- `src/handlers/textEditHandler.ts` (overlay MacroCmd + blur commit)

## Overall health

The history layer is **well-engineered and notably defensive**. Highlights verified as correct:

- **50-command cap** (`HistoryManager` constructed with `50` in `pdfTurboApp.ts:336`): overflow evicts the oldest via `shift()` and calls `evicted?.dispose?.()` (`_push`, lines 33–36). Correct.
- **Redo-stack clearing on new command**: `_push` disposes every stale redo command then resets the array (lines 37–39). Correct and leak-safe.
- **Undo of source-bytes-replace correctly restores the pdfjs doc**: `ReplaceSourcePdfBytesCmd.undo()` swaps `src.doc`/`src.bytes` back to the `before` snapshot; both pdfjs docs are kept alive on the stack by design, and `dispose()` only destroys the *non-live* snapshot's `loadingTask` (identity-checked against `this.src.doc`) — a leak is preferred over a use-after-free. I traced the eviction/redo-clear/clear() paths: in every case the live doc is preserved. Solid.
- **TOCTOU hardening in `_applySourcePdfEdit`** (`pdfTurboApp.ts:511–531`): snapshots `before` *before* the async parse, then re-checks source identity + bytes after the `await` and discards a superseded parse. Excellent.
- **execute-then-rollback** in `_applySourcePdfEdit` (lines 540–557): if the post-execute render throws, it undoes the just-pushed command. Correct.

Findings below are genuine but mostly low-to-mid severity. No P0.

---

## P1 — In-flight overlay-text edit is silently discarded on undo (broken undo)

**File:** `src/core/undoRedoController.ts:27–55`
**Category:** undo / bug

`handleTextInput` mutates the element live (`element.text = input.value`, line 32) and **defers** recording a `TextEditCmd` behind a 500 ms debounce timer (lines 33–44). The only places that touch the pending state besides the timer are `undo()`/`redo()`, which call `_cancelPendingTextEdit()` (lines 57, 73). That helper **clears the timer and nulls the pending before/id WITHOUT recording the command**:

```ts
private _cancelPendingTextEdit(): void {
  if (this._textChangeTimer !== null) {
    clearTimeout(this._textChangeTimer);
    this._textChangeTimer = null;
    this._pendingTextBefore = null;     // discarded, never recorded
    this._pendingTextElementId = null;
  }
}
```

Consequence: user types into an overlay text element, then presses Ctrl+Z **within 500 ms**. The just-typed text is already applied to the element, but its `TextEditCmd` is thrown away. The undo then pops the *previous* command (or no-ops), and the in-flight typed text becomes **permanently non-undoable** — it is now part of the baseline state with no history entry. This is a real undo gap: a mutation reached the model but never went through a recorded Command.

There is also **no flush-on-blur** — `grep` confirms the only `blur`/commit path is in `textEditHandler.ts` (the *true-edit* inline input), not the overlay-text debounce. The debounced edit relies entirely on the 500 ms timer; switching documents or pages before it fires also drops it (the timer closure holds the element ref, so it may fire against a stale element instance after a layer rebuild).

**Recommendation:** `_cancelPendingTextEdit()` should *flush* (record the pending `TextEditCmd` if `before !== element.text`) before clearing, not discard. Alternatively, before `historyManager.undo()/redo()` run, force-record the pending edit so the typed text is a proper undo step. Add a flush on element blur and on document/page switch.

---

## P2 — MacroCmd has no atomic rollback if a child throws mid-execute/undo

**File:** `src/core/commands/macroCmds.ts:5–6`
**Category:** bug

```ts
execute(): void { this.cmds.forEach(c => c.execute()); }
undo(): void { [...this.cmds].reverse().forEach(c => c.undo()); }
```

If child *k* throws, children `0..k-1` are already applied and stay applied; the throw propagates out of `MacroCmd.execute()`. In `HistoryManager.execute(cmd)` the `_push` never runs (good — the macro isn't on the stack), but the **partial mutation is left in the model with no undo entry at all**. Same hazard on `undo()`.

In practice today this is *latent*: every constructed `MacroCmd` I traced is composed of non-throwing children — `AddElementCmd` (xfdf import `pdfTurboApp.ts:939`, overlay fallback `textEditHandler.ts:434`), `BulkDeleteCmd`/`SplitStrokeCmd` (eraser), `TransformAnnotationsCmd`+`RotatePageCmd`/`SetPageCropCmd` (pageService apply-to-all). None of these throw under normal input. So the severity is P2 (a robustness gap, not an active bug), but it is the kind of thing that becomes a P0 the day a `ReplaceSourcePdfBytesCmd` (which *can* throw) is added to a macro.

**Recommendation:** make `MacroCmd.execute()`/`undo()` roll back already-applied children on throw (try/catch that reverses the applied prefix), or document the invariant "MacroCmd children must be infallible" prominently on the class.

---

## P2 — `BulkDeleteCmd.undo()` loses z-order (and is asymmetric with `RemoveElementCmd`)

**File:** `src/core/commands/elementCmds.ts:36–50`
**Category:** bug / export-fidelity

```ts
undo(): void {
  this.arr.push(...this._deleted);   // appended to END — original positions lost
}
```

`RemoveElementCmd` deliberately captures and restores the original index (`this.index`, lines 17, 24) to preserve paint order, but `BulkDeleteCmd.undo()` just appends deleted elements to the end of `this.arr`. Elements render in array order (DOM append = paint order), so undoing an eraser bulk-delete re-inserts the elements **on top of everything else**, changing their z-order vs. the pre-delete state. For overlapping shapes/highlights this is a visible, non-faithful undo. It is used by the eraser (`eraserHandler.ts:119`).

**Recommendation:** capture each deleted element's original index (like `RemoveElementCmd`) and re-insert at those indices on undo (ascending order so earlier splices don't shift later ones).

---

## P3 — `MoveResizeCmd`/`TextEditCmd`/`FillColorCmd` silently no-op when element id is missing

**File:** `src/core/commands/moveCmds.ts:11–18`, `elementCmds.ts` text/fill cmds
**Category:** bug (minor / defensive)

`MoveResizeCmd` falls back to `this.el` when the id isn't found in the live array (`?? this.el`), so it mutates a *detached* element that's no longer in the document — a no-op the user can't see. `TextEditCmd`/`FillColorCmd` simply do nothing if the id is gone. These are reasonable defensive choices, but they mean an undo can *appear* to do nothing (no feedback) if the target element was removed by a later, since-truncated command. Edge-case only; acceptable, noting for completeness.

**Recommendation:** none required; optionally surface a debug log when an undo/redo target id is missing.

---

## Notes / verified-clean

- **i18n parity:** all history-adjacent toast keys (`trueEditFailed`, `cropApplied`, `cropRemoved`, `cropAppliedAll`, `annotationsAdjusted`) are present in en/fr/ar (1:1:1). No parity gap in this domain.
- **No security surface** in the history layer (no innerHTML, no eval, no network). Source-bytes swap parses via pdf.js with a copied buffer (`newBytes.slice(0)`), no injection vector here.
- **`SetPageCropCmd` / `RotatePageCmd`** correctly snapshot prior state and restore exactly (including "no crop" via `delete page.crop`); rotation-invariant crop is stored in unrotated content space — consistent with the documented design. No bug.
- **`SnapshotCmd`** rebuilds elements via `ElementFactory.fromJSON` on both execute and undo — heavy but correct; `captureAfter()` must be called by the caller before the command is useful (the `if (!this.after) return` guard prevents a half-built redo). Fragile-by-contract but not a defect.
- **`undo()`/`redo()`** give no positive user feedback (no toast), but Ctrl+Z/Y is a universally understood gesture and the canvas re-renders — not flagging as a defect.
