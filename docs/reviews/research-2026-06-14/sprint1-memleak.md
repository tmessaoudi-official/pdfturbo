# Sprint 1 — pdf.js document leak on history-stack eviction (P1)

Date: 2026-06-14
Scope (strict): `src/core/historyManager.ts`, `src/core/commands/sourcePdfCmds.ts`,
`src/core/commands/command.ts`, `src/core/commands/macroCmds.ts`, `tests/core/`.
Untouched (other agents own): exportService, contentStreamEditor, flowDoc, UI/a11y.

## Bug

`ReplaceSourcePdfBytesCmd` holds two `SourcePdfSnapshot`s (`before`, `after`), each
carrying a multi-MB `PDFDocumentProxy` (plus pdf.js *worker* memory). `HistoryManager._push`
evicts the oldest command via `undoStack.shift()` when the 50-command cap overflows, and a
fresh push silently drops the entire `redoStack` (`this.redoStack = []`). Nothing ever called
`.destroy()` on the pdf.js docs owned by those discarded commands, so every overflow/redo-drop
leaked a whole pdfjs document + its worker allocation. The PWA runs long autoUpdate sessions,
so the leak compounds until the tab is reloaded.

Three exit paths where a command leaves the stack **for good**:
1. Overflow eviction in `_push` (`shift()`).
2. Redo-branch invalidation in `_push` (`this.redoStack = []` after a new execute).
3. `clear()` (e.g. loading a new document / reset) — wipes both stacks.

(Note: path 2 was an *additional* leak the original ticket did not call out — found via
blast-radius. The redo stack was being dropped with zero cleanup.)

## TDD — red first

New file `tests/core/historyManagerDispose.test.ts`. Confirmed RED against un-fixed code
(TAP): 7/9 failing — eviction/clear assertions reported `expected +0 to be 1`, and
`ReplaceSourcePdfBytesCmd.dispose` failed with `TypeError: cmd.dispose is not a function`.
The 2 passing were negative controls (assert dispose is NOT called while reachable). A 10th
MacroCmd test was added after the blast-radius finding below.

Tests cover:
- dispose() called exactly once on the overflow-evicted command.
- NOT called for commands still reachable for undo/redo (the live invariant).
- All commands on BOTH stacks disposed exactly once on `clear()`.
- Redo-branch commands disposed when a new execute supersedes them.
- Commands without `dispose` never throw.
- `ReplaceSourcePdfBytesCmd`: after execute() frees ONLY `before.doc` (undo branch), never live.
- after undo() frees ONLY `after.doc` (redo branch), never live.
- conservative guard: a doc equal to live `src.doc` is never destroyed.
- dispose() idempotent (single destroy on repeat call).
- `MacroCmd.dispose()` forwards to every child (and tolerates children without dispose).

## Fix

1. **`command.ts`** — added OPTIONAL `dispose?(): void` to the `Command` interface, documented
   as "called only when the command permanently leaves the stack; never while reachable;
   safe when absent (invoked as `cmd.dispose?.()`)". Purely additive — no existing implementer
   declares `dispose`, so all 20 implementers stay valid (grep-verified).

2. **`historyManager.ts`** — `_push`: on overflow, `evicted?.dispose?.()`; before resetting
   the redo stack, `for (const stale of this.redoStack) stale.dispose?.()`. `clear()`: dispose
   every command on both stacks before emptying. undo()/redo() are unchanged — they MOVE
   commands between stacks (still reachable), so they never dispose.

3. **`sourcePdfCmds.ts`** — `ReplaceSourcePdfBytesCmd.dispose()` with a `_disposed` idempotency
   guard. Destroys a snapshot's doc ONLY when `doc !== this.src.doc` (the live, currently-rendered
   document). `destroy()` is best-effort (returns a promise; wrapped so a rejection during
   worker teardown can't throw out of a stack mutation).

4. **`macroCmds.ts`** — `MacroCmd.dispose()` forwards to each child (`c.dispose?.()`), so a
   ReplaceSourcePdfBytesCmd nested inside a macro is freed when the macro is evicted.

## Use-after-free avoidance (the critical requirement)

The design intentionally keeps the *currently-referenced* pdfjs doc alive. `src.doc` is the
single source of truth for "what the app is rendering right now". `dispose()` compares each
snapshot's doc by reference identity against `this.src.doc` and destroys **only** the one that
is NOT the live doc:
- after execute(): live === `after.doc` → free `before.doc` (the undo branch).
- after undo(): live === `before.doc` → free `after.doc` (the redo branch).
- if a doc equals live (or before/after share one doc) → skip it.

This is deliberately conservative: any uncertainty falls through to the skip branch, so a
leak is chosen over a use-after-free (a leak is recoverable on reload; a use-after-free crashes
render). dispose() is only ever invoked by HistoryManager on the for-good exit paths, never
while the command is still on a stack and thus never on the live branch a user can return to.
Idempotency (`_disposed`) plus pdfjs `destroy()` being a no-op when already destroyed prevents
double-free. Identity comparison is sufficient because no doc is shared/deduped beyond a single
command instance.

## Green evidence

```
# RED (pre-fix): npx vitest run tests/core/historyManagerDispose.test.ts --reporter=tap
not ok 1 ... expected +0 to be 1            (eviction)
not ok 3 ... expected +0 to be 1            (clear)
not ok 4 ... expected +0 to be 1            (redo-branch)
TypeError: cmd.dispose is not a function    (x4 ReplaceSourcePdfBytesCmd)
=> 7 failing / 2 passing (negative controls). EXIT=1.

# GREEN (post-fix):
npx vitest run tests/core/historyManagerDispose.test.ts \
               tests/core/historyManager.test.ts \
               tests/core/historyManagerCommands.test.ts --reporter=tap
EXIT=0  passes: 87  fails: 0
  (10 new dispose tests + 77 pre-existing history tests — no regression)

# Lint:
npx oxlint src/core/historyManager.ts src/core/commands/sourcePdfCmds.ts \
           src/core/commands/command.ts src/core/commands/macroCmds.ts \
           tests/core/historyManagerDispose.test.ts
=> ok
```

Project-wide `tsc`/`oxlint .` deliberately NOT run (parent owns the full gate; parallel edits in flight).

## Files changed
- `src/core/commands/command.ts` (+ optional `dispose?`)
- `src/core/historyManager.ts` (dispose on overflow eviction, redo-drop, clear)
- `src/core/commands/sourcePdfCmds.ts` (`dispose()` with live-ref guard + idempotency)
- `src/core/commands/macroCmds.ts` (forward dispose to children)
- `tests/core/historyManagerDispose.test.ts` (new — 10 tests)
