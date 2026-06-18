# True-edit decoration + graphics-state fidelity Plan

> STATUS: IMPLEMENTED — all tests green (jsdom 1611 pass + 2 xfail; browser +2). Not yet committed.

## Decisions Log
- [2026-06-18] AGREED: Scope = "Decorations + graphics-state fidelity" — resize the
  underline/strikethrough rule tied to edited text AND capture char/word spacing,
  horizontal scale, and text rise so the Path-3 redraw re-emits them. (User chose this
  over underline-only and analysis-only.)
- [2026-06-18] PROPOSED: Highlight (background) rect resize is deferred within the same
  mechanism — bigger rects are more easily confused with page shading; thin-rule
  underline/strike is the robust core. Rationale surfaced for the plan gate.
- [2026-06-18] 3C gate config: Full 30 cycles / 8 clean (user choice).

## 3C convergence findings (folded into the plan)
- F1: matching x-overlap needs the ORIGINAL text extent, but `TextOpInfo.origin` is only the
  start point. → measure old text width from the DECODED old string (already available) in the
  matched standard font; extent = [origin.x, origin.x+oldW]. Same measurement feeds the ratio.
- F2: matched-font metrics ≈ original → x-overlap test is tolerant (≥50%, mirrors
  classifyRuleAsUnderline neighbor logic); ratio is approximate for Path 1/2 (documented).
- F3: a stroked-line underline (`m…l…S`) has NO width operand — width = endpoint x-distance,
  possibly drawn R→L. v1 handles FILLED `re` rects first-class and REFUSES the line form
  (leave unchanged). → ceiling.
- F5: the width operand is in the rect's LOCAL space; new local width = newUserWidth /
  ctmScaleX (refuse if CTM b or c ≠ 0).
- F7 (blast radius): `deleteTextAt` has the SAME orphan-rule bug — deleting underlined text
  leaves a floating rule. → extend: on delete, blank the matched rule too.
- F10: undo is atomic for free — the rule change rides the same SourcePdf.bytes swap
  (`ReplaceSourcePdfBytesCmd`); no new command.
- F11 (resolved, no action): `classifyRuleAsUnderline` is in `flowDoc.ts`; contentStreamEditor
  ALREADY imports `isArabicText` from flowDoc → no circular dep, precedent exists. Reuse it.
- F12: the flag is a PURE BEHAVIOR gate (no toolbar button) → `vite.config.ts` define only;
  NO `main.ts` button-removal (unlike crop/bates). Simpler.
- F17: guard div-by-zero — if measured oldTextWidth ≈ 0, skip decoration adjust (refuse).
- F18: empty newText (delete-by-replace) → route to the same rule-removal as `deleteTextAt`,
  never a 0-width rule.
- F19 (resolved, no action): the ratio method is SCALE-INVARIANT — oldRuleWidth already bakes
  in the original Tz/CTM, and we re-emit the same Tz, so newRuleWidth = oldRuleWidth ×
  (newTextW/oldTextW) measured at 100% is correct without separate hScale handling.

## Root cause (Verified)
PDF has no underline text attribute. Underline/strike are SEPARATE graphics primitives
(thin filled `re … f` rect or stroked `m … l … S` line) with width baked into their own
geometry, decoupled from the text. The edit engine (`contentStreamEditor.ts`) touches only
the show op — Path 1 (`:1417`), Path 2 (`:1431`), Path 3 redraw (`:1471-1496`) — so the
rule keeps its old width: longer text overhangs uncovered (the reported bug), shorter text
over-runs. `TextOpInfo` (`src/types/contentStream.ts:25`) captures fontKey/fontSize/
fillColor/renderMode/origin but NO decoration and NO Tc/Tw/Tz/Ts. Detection logic exists
(`classifyRuleAsUnderline`, `flowDoc.ts:77`) but is wired ONLY into the DOCX/export path.

## Formal Plan

### Files
1. `src/types/contentStream.ts` — extend `TextOpInfo` with `charSpacing`, `wordSpacing`,
   `hScale`, `textRise` (graphics state) — all optional, default-absent.
2. `src/utils/contentStreamEditor.ts`
   - `locateTextOps`: track `Tc`/`Tw`/`Tz`/`Ts` ops → stamp onto each `TextOpInfo`.
   - NEW `locateDecorationRects(ops)`: CTM-transformed walk collecting (a) `re`+painter
     rects and (b) `m…l…S` lines as `{ x, y, width, height, opIndex, widthOperandIndex,
     ctmScaleX, kind:'rect'|'line' }` in page user space. Refuse (omit) any whose CTM has
     rotation/shear (b or c ≠ 0).
   - NEW pure `matchDecorationForText(rects, target, textExtentWidth)`: returns the SINGLE
     rule that passes `classifyRuleAsUnderline` baseline-band thresholds AND x-overlaps the
     original text extent. >1 candidate → null (refuse, no guess).
   - NEW pure `adjustedRuleWidth(oldLocalWidth, oldTextWidth, newTextWidth)` = scale by
     `newTextWidth/oldTextWidth` (both measured in the SAME matched standard font → path-
     independent, never needs original-font metrics).
   - `replaceTextAt`: after a successful edit on ANY path, if `VITE_FEATURE_TEXTDECOR` on,
     measure old/new width in the matched standard font, match the rule, rewrite its width
     operand token in place, re-serialize in the SAME writeBack (atomic + undoable).
   - Path-3 redraw (`:1491`): emit captured `Tc`/`Tw`/`Tz`/`Ts` before `Tj` when present.
3. `vite.config.ts` / `main.ts` — `VITE_FEATURE_TEXTDECOR` seam (#28 pattern), default ON;
   off ⇒ byte-identical edit behavior.

### Ordered steps (TDD)
1. RED: jsdom tests — gfx-state capture, decoration match, width math, refuse-on-ambiguity,
   Path-3 re-emit. 2. Implement capture + pure helpers. 3. Wire into replaceTextAt + Path-3.
4. GREEN jsdom. 5. Browser test: edit underlined text longer → underline ink extends under
   the new tail; flag-off control = unchanged. 6. type-check + lint + full suite + browser.

### Acceptance criteria
- Editing underlined/struck text to a LONGER string extends the rule to cover it; SHORTER
  shrinks it. - Ambiguous/rotated/complex-path decoration → PDF left unchanged (no corruption).
- Tc/Tw/Tz/Ts survive a Path-3 redraw. - Flag off OR no decoration matched ⇒ byte-identical.
- Full jsdom + browser suites green.

### Risk / rollback
Worst failure: mis-resizing an unrelated thin rect (table border, divider). Mitigation: dual
gate (baseline band AND x-overlap with ORIGINAL extent) + single-candidate-only + identity-
CTM-only + feature flag for instant rollback. Rollback = flip `VITE_FEATURE_TEXTDECOR=false`
or `git revert`.

### Ceiling (documented, not built)
Highlight/background rect resize; decorations inside Form XObjects; rotated/sheared-CTM
decorations; multi-segment rules; original-font exact metrics (proxy-font ratio is approximate
for Path 1/2, exact for Path 3).
