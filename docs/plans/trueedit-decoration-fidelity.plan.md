# True-edit decoration + graphics-state fidelity Plan

> STATUS: 2026-06-19 — STROKED-LINE underline resize implemented (UNCOMMITTED working tree).
> Root cause of "still not propagated" = the first ship (1f70d77+19b7c58) handled ONLY filled `re`
> rects; Word/LibreOffice underlines are STROKED LINES (`m…l…S`) → refused → frozen. Now
> `locateDecorationRects` detects+resizes both (DecorationRule = discriminated rect|line union),
> delete neutralises `S`→`n`. Green: jsdom 1619+2xfail, real-Chrome 72 (2 new stroked-line pixel
> tests). AWAITING user's redacted C1/C2 sample (#2) to CONFIRM against the real file, then commit.
> Old "overlay path" hypothesis (#1 below) is OVERTURNED — the symptom proves an in-place edit.

## Why it failed on the real file (ranked hypotheses — investigate FIRST next session)
The mechanism is proven on synthetic PDFs (jsdom + real-Chrome pixels), so the gap is the REAL
file's structure routing around the resize. Ranked by likelihood — get EVIDENCE before fixing
(systematic-debugging: reproduce with the user's actual file, don't guess):

1. **The edit is an OVERLAY, not a true in-place edit (MOST LIKELY).** `applyDeco` lives INSIDE
   `replaceTextAt`; if the true edit refuses (subset/CID font where the NEW char isn't in the
   subset, Arabic, Form XObject, encrypted), it returns false → `textEditHandler` adds an
   **overlay** TextElement and the source underline rect is NEVER touched. The word "added text"
   hints at this. → CHECK: does the `toast.trueEditOverlay` ("couldn't edit in place…") fire? If
   yes, decoration resize must move to the OVERLAY path (draw a fresh underline under the overlay
   element), not the content-stream path. This is probably the real fix.
2. **Underline is a STROKED LINE (`m … l … S`), not a filled `re`** → we deliberately refuse →
   stays frozen. v1 ceiling. Fix = handle the line form (rewrite the `l` endpoint x).
3. **Underline rect lives in a separate content stream or a Form XObject** → `locateDecorationRects`
   only walks `found.ops` (the matched op's stream). CHECK whether findTarget merges all page
   content streams; rect in another stream/XObject = not found.
4. **Rect shares its painter with an m/l/c subpath** → `sawOtherPath` refuses (correct, but means
   no resize). 5. Rect drawn as STROKE (`re S` + line width), not fill → only FILL_PAINTERS match.

**Fastest repro:** get the user's PDF (or a redacted 1-page sample) into `tests/fixtures/` and add a
browser test that edits the actual underlined word; assert the tail underline ink. That converts the
"works on synthetic / fails on real" gap into a red test. Likely outcome: route decoration through
the overlay fallback (#1).

## NEW FEATURE REQUEST (separate, LARGE — not started): DOCX read + edit
User wants the app to READ and EDIT .docx (today it only EXPORTS pdf→docx via flowDocWriters.ts).
This is a major new capability: parse OOXML (word/document.xml + styles/numbering/media), render to
the editor model, edit, re-serialize valid OOXML. Scope/spike needed — likely `mammoth`/`docx` for
parse + the existing `docx` npm for write, or a custom OOXML round-trip. Treat as its own Large
sprint with brainstorm → design → plan gates. NOT part of #text-decoration.

## Decisions Log
- [2026-06-19] DIAGNOSIS (Verified by code read): the shipped fix only resizes FILLED `re`
  rects (`contentStreamEditor.ts:475/535`); the stroked-line form `m…l…S` is deliberately
  refused. The reported symptom (old text underlined, only appended tail bare) = a SUCCESSFUL
  in-place edit with a frozen rule, NOT the overlay path (overlay covers the original +
  underline). `found.ops` already concatenates all page content streams (`:747`), so
  "separate stream" is not the cause. → #1 suspect = real underline is a STROKED LINE.
- [2026-06-19] AGREED (user: "1 and 2 and 3 and four"): do ALL of — (#1) broaden engine to
  resize the stroked-line underline form + ≥2-rule disambiguation, TDD with synthetic
  fixtures; (#2) user will share a redacted C1/C2 sample to reproduce exactly; (#3) inventory
  other text attributes lost on edit; (#4) DOCX read+edit as its own Large design sprint.
  Sequence: #1 first (live bug, actionable now), fold in #2 sample, #3 inline, #4 separate.
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
