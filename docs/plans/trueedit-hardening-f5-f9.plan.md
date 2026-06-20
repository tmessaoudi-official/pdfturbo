# True-edit hardening (F5–F9) Plan

Backlog source: `docs/reviews/2026-06-20-trueedit-edgecase-audit.md`. F1/F2 already fixed @ `130f5c0`.

## Decisions Log
- [2026-06-20] AGREED: Track A scope = root-cause **F7** (inline-image EI tokenization) + safe REFUSE guards **F5/F6/F8/F9**; the full **F3 byte-splice rewrite is DEFERRED** as a separately-designed hardening effort.
- [2026-06-20] DONE: F5/F6/F7/F8/F9 all implemented in `src/utils/contentStreamEditor.ts` with 9 new jsdom tests (5 fix + 4 control). Green: type-check ✓, lint ✓, jsdom 1664 ✓, real-Chrome browser 81/81 ✓. CLAUDE.md REFUSE-gates paragraph updated. Remaining audit backlog (lower sev): F3 byte-splice (deferred), F10–F16. Rationale: byte round-trip verified lossless for bytes 0–255 (`String.fromCharCode` ⇄ `charCodeAt & 0xff`, getPageContent:854 / setPageContent:864), so F3/F4/F12 are blast-radius risks, not active corruption; the one concrete corruption vector (F7) has a clean spec-correct fix. A full rewrite's regression surface (all of Path 1/2/3 + decoration + XObject) outweighs the narrow inline-image risk it would close, and the user requires "no regressions."

## Formal Plan

Single file touched: `src/utils/contentStreamEditor.ts` (+ tests). All fixes are pure / jsdom-unit-testable except the Path-3 reorder which has an existing browser guard.

### F7 — inline-image `EI` false boundary (root-cause corruption fix)
- **Where:** `tokenizeContentStream` line ~211–216 (`src.indexOf('EI', i)`).
- **Fix:** scan for an `EI` that is **whitespace-delimited** (preceded by whitespace, followed by whitespace/delimiter/EOF), starting the scan after the `ID` data marker. Per PDF spec §8.9.7 the `EI` terminator is whitespace-delimited; a bare `indexOf` matches the bytes `"EI"` inside binary image data and truncates the image early, corrupting the rest of the page on re-serialize.
- **Test:** `BI … ID <bytes containing "EI" not ws-delimited> EI` must tokenize as ONE inline-image token ending at the real `EI`; the trailing op after `EI` must survive.

### F5 — mirror / negative-scale CTM not refused
- **Where:** `locateDecorationRects` — `re` case (~549) and the stroked-line build (~602–619).
- **Fix:** add `mirrored() = ctm[0] < 0 || ctm[3] < 0`; refuse the rect (`if (skewed() || mirrored()) break;`) and carry `mirrored` on each `m` entry so a mirrored stroked line is rejected. The line path uses `abs()` so today a mirror flips resize direction — refuse instead (can't scalar-resize mirrored geometry).
- **Test:** a stroked underline under a `-1 0 0 1` (mirror-X) CTM must NOT be collected.

### F6 — super/subscript baseline confidence (textRise)
- **Where:** `prepareDecorationResize` (~1839, before returning the mutator) — refuse when the target run carries a non-zero `textRise`.
- **Fix:** `if (target.textRise) return null;` — a super/subscript run's reported baseline (origin.y, no rise applied) makes the band-match unreliable, risking matching an unrelated nearby rule. Refuse → decoration simply not resized (safe no-op), never mutate wrong geometry. (cm-only sizing without Tm scale documented as remaining ceiling.)
- **Test:** `prepareDecorationResize` returns null when target.textRise ≠ 0.

### F8 — `"` show op spacing operands ignored
- **Where:** `locateTextOps` ~466–469 (`'`/`"` block).
- **Fix:** for `"` (`aw ac string "`), set running `wordSpacing = num(op0); charSpacing = num(op1)` (spec: `"` ≡ `aw Tw ac Tc string '`, persistent state) before emitting the TextOpInfo, so a later Path-3 redraw uses correct spacing.
- **Test:** a `"` op emits a TextOpInfo whose charSpacing/wordSpacing reflect its aw/ac operands.

### F9 — Path-3 build-then-blank (latent data-loss + CP1252 throw)
- **Where:** `replaceTextAt` Path-3 (~1750–1782).
- **Root cause:** the original op is **blanked at 1750 BEFORE** the redraw is built (embedFont 1764 / encodeText 1769 / applyDeco 1779). Any throw between blank and `setPageContent` destroys the original with no replacement (CP1252-high chars €/Œ that pass `hasNonWinAnsi` are the audit's hypothesized trigger).
- **Fix:** build the redraw string + run `applyDeco` **inside try/catch FIRST**; only `blankShowOp`/`blankAllNearby` once the redraw is guaranteed; on throw `return false` (caller overlay, original untouched). The proxy-width path (1878) is already guarded — this extends the guarantee to the main encode.
- **Test:** a `€`/`Œ` Path-3 edit completes (promise resolves true, text replaced) and does not reject; ordering invariant documented.

## Acceptance
`npm run type-check && npm run lint && npm run test` green; `npm run test:browser` green (Path-3 reorder + decoration guards). New jsdom tests for F5–F9 in `tests/utils/contentStreamEditor.test.ts`. No change to byte-output for unaffected ops (guards only REFUSE or reorder; F8 only fires on `"` ops).

## Rollback
Single-file change; `git checkout -- src/utils/contentStreamEditor.ts tests/utils/contentStreamEditor.test.ts`.
