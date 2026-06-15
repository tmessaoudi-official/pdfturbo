# True PDF Text-Edit Fidelity Scorecard — 2026-06-15 (Sprint 3)

Honest measurement of the in-place text-edit engine (`contentStreamEditor.ts` +
`textEditHandler.ts`). Built from the full routing matrix in `02-trueedit-matrix.md` (every cell
verified by direct code read this session). This scorecard directly answers the user's standing
question: **"why does it truly edit some text but propose redact+overlay on other text?"**

## Why some clicks true-edit and others overlay (the routing, in one paragraph)
A click resolves to a content-stream show-op, then `replaceTextAt` picks a path by **font + glyph
encoding**: standard-14 ASCII → **Path-1** byte-swap (perfect); subset/CID glyph already in the
font's ToUnicode → **Path-2** glyph reuse (perfect, keeps the real font); a glyph NOT in the subset,
or a standard font needing a non-WinAnsi char → **Path-3** redraw with a substitute standard face
(works, face degraded). When the target is structurally un-editable — a **Form XObject**, a **Type3**
font, **vertical/WMode** text, or an **invisible OCR `Tr` layer** — the engine **refuses** and the
handler falls back to **overlay** (redaction cover + editable text box). Encrypted/unparseable PDFs and
clicks on **scanned/image-only** pages also overlay. So: overlay is not a bug — it is the *honest
graceful-degradation* path for targets where a true byte-level edit would either fail silently or
paint garbage. (A-1, Sprint 2, made sure that fallback is never a silent no-op.)

## Scorecard (path → outcome)

| Scenario | Path | visible | extractable | correct | Grade |
|----------|------|:---:|:---:|:---:|-------|
| Standard-14, ASCII (Tj / plain) | 1 byte-swap | ✓ | ✓ | ✓ | ✅ perfect |
| Subset/CID, glyph in ToUnicode | 2 reuse | ✓ | ✓ | ✓ | ✅ perfect (keeps real font) |
| CID/Type0 in subset | 2 | ✓ | ✓ | ✓ | ✅ |
| Standard font, accented `é` / `€` | 3 redraw | ✓ | ✓ | ~ | 🟡 glyph OK, face degraded |
| Subset, NEW char not in subset | 3 redraw | ✓ | ✓ | ~ | 🟡 face degraded |
| TJ kerned line, standard font | 1 (segment-split) | ✓ | ✓ | ✓ | ✅ kerning preserved (Gap 1 DONE) |
| TJ kerned line, subset | 2 (segment-split) | ✓ | ✓ | ✓ | ✅ per-segment widths kept (Gap 1 DONE) |
| Spot/Separation-colored text, Path-3 | 3 (black) | ✓ | ✓ | ✗ | 🟡 silent black (Gap 2 / B7) |
| Non-WinAnsi ligature `ﬁ`, std/Path-3 | 3 (drop) | ~ | ~ | ✗ | 🟡 wrong glyph, no refusal |
| Form-XObject text | refuse→overlay | ovl | ovl | ~ | ✅ correct fallback (A-1) |
| Type3 font | refuse→overlay | ovl | ovl | ~ | ✅ correct fallback (A-5) |
| Vertical / WMode `-V` | refuse→overlay | ovl | ovl | ~ | ✅ correct fallback (A-5) |
| Invisible `Tr` 3/7 (OCR layer) | refuse→overlay | ovl | ovl | ~ | ✅ correct fallback (A-5) |
| Encrypted PDF | overlay (load throws) | ovl | ovl | ~ | ✅ |
| Scanned / image-only | add-box | new | new | n/a | ✅ (no source text) |
| Multiple distinct ops same baseline | target only | ✓ | ✓ | ✓ | ✅ neighbors survive (A-4 / B5) |
| cm-scaled/rotated block, Path-1/2 | inherit CTM | ✓ | ✓ | ✓ | ✅ |
| cm-scaled/rotated block, Path-3 redraw | 3 (identity Tm) | ✓ | ✓ | ✗ | ⛔ A6 — wrong scale/rot |
| Rotated page `/Rotate`, inline input | 1/2 edit ok | ✓ | ✓ | ~ | ⛔ input box misplaced |
| RTL / Arabic, Path-3 | 3 (notdef) | ✗ | — | ✗ | ⛔ std fonts lack Arabic |
| Nested XObject (Do-in-Do) | no match→overlay | ovl | ovl | ~ | ✅ (one-level recursion) |

## Sprint-2 fixes — still holding (re-verified file:line)
A-1 XObject/refused→overlay (never silent) · A-2 full-TJ-hex + blank trailing · A-3 UTF-16BE cmap +
surrogates · A-4 blank only same fontKey+size+payload · A-5 Type3/vertical/invisible-Tr refuse. All ✅
(`02-trueedit-matrix.md` §"Sprint-2 fixes verified").

## Reachable gaps (queued — file:line + fix in `02-trueedit-matrix.md`)
- ✅ **Gap 1 — TJ kerning preservation (biggest-ROI) — DONE (Sprint 3 batch 2, 2026-06-14):**
  `replaceShowOpInPlace` (Path-1) and `replaceShowOpHex` (Path-2) now DISTRIBUTE the new text across the
  existing TJ string/hex segments by their original char/byte counts (last segment absorbs the length
  delta) instead of collapsing to one literal / jamming into the first hex. Kerning numbers survive in
  place; neighbour glyphs no longer shift on a single-word edit. New `decodeLiteralString` measures
  segment lengths. The A2 no-stale-glyph guarantee still holds (overflow segments → empty `()`/`<>`).
  Guarded by the new `replaceShowOpInPlace`/`replaceShowOpHex` cases in `contentStreamEditor.test.ts`.
- ✅ **Gap 2 — Path-3 fill color:** DONE (`d7879fb`). Canvas-pixel-sample fallback via `resolveRedrawColor`
  + `replaceTextAt(…, fallbackColor)`; handler passes the sampled glyph color. `scn`/Separation text keeps
  its color. Guards: `contentStreamColor.test.ts` + `truedit-spot-color.browser.test.ts`. (Stroke color for
  `Tr 1/2` text remains untracked — narrow, still open.)
- ✅ **Gap 3 — number tokenizer exponent `1e-3`:** DONE. `consumeNumberBody` keeps the exponent as one
  token in both tokenizers (`contentStreamEditor.ts:84-87`).
- 🟡 **Non-WinAnsi ligature on Path-3:** currently drops glyph with no refusal — should refuse→overlay
  (consistency with A-5) rather than paint a wrong glyph.

## Ceiling (confirmed hard — do not promise)
- ⛔ **A6 cm scale/rotation in Path-3 redraw** — redraw emits identity Tm; transformed text redraws upright/wrong-size. Path-1/2 immune.
- ⛔ **Rotated-page inline-input placement** — edit correct, floating box approximate.
- ⛔ **RTL/Arabic shaped glyphs + embedded fallback** — shaping is a font feature lost on re-encode; std fonts carry no Arabic.
- ⛔ **Type3 true-edit** — glyphs are CharProc streams, not byte→glyph; refuse is the correct call.
- ⛔ **PDFium-WASM moonshot** — would replace the whole surgery layer; several-MB integration, out of scope.

## Honest statement
The engine **truly edits** the large majority of real-world text (standard + subset/CID Latin, the
common case) at perfect fidelity, and **degrades visibly and safely** (overlay, never silent garbage)
on the structurally-hard targets. The one gap that hurts a *common* edit is **TJ kerning (Gap 1)** —
that is the right next true-edit investment. The rest of the 🟡 set is narrow; the ⛔ set is the real
client-side ceiling.
