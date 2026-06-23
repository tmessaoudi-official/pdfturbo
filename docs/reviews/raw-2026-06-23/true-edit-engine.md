# True-edit engine — deep QA (2026-06-23)

Files read in full:
- `src/utils/contentStreamEditor.ts` (2495 lines)
- `src/handlers/textEditHandler.ts` (745 lines)
- cross-checks: `src/core/pdfTurboApp.ts` `_applySourcePdfEdit` (510–549), `locales/{en,fr,ar}.json` true-edit keys.

## Verdict

This is a mature, heavily-hardened module. The primary risk this review targets —
**byte mutation without a guaranteed replacement (data loss)** — is explicitly closed:

- **Path 3 (F9, line 1901–1944):** the redraw string is built inside a `try` BEFORE
  `blankShowOp` runs (line 1942). Any throw in `embedFont`/`encodeText`
  (e.g. a CP1252-high char the base-14 AFM lacks a width for) returns `false` with the
  original op untouched → caller overlay fallback. Verified: `blankShowOp` is reached
  only after `redraw` is assigned.
- **Refuse-without-blanking gates** (Type3 / invisible Tr 3,7 / vertical, line 1810–1816;
  XObject, line 1875–1882; Arabic, 1890; non-WinAnsi, 1897) all `return false` BEFORE any
  mutation. None of them blank first.
- **Path 1/2** mutate only the show-op operand (preserving font), and `blankAllNearby` only
  touches genuine same-payload shadow duplicates (line 1019–1029).

The overlay toast (`toast.trueEditOverlay`) is surfaced on **every** commit-time refuse via
`_emitOverlay` (textEditHandler 445) which is the single sink for `replaceTextAt → false`
(line 709–716) and the click-time Arabic/no-match paths. Locale keys are 3-way parity-clean
(en/fr/ar all carry trueTextEdited/Overlay/Deleted/FontSubstituted/trueEditInput).
Undo is sound: every commit funnels through `_applySourcePdfEdit` → `ReplaceSourcePdfBytesCmd`
(one save → one undoable command), with a TOCTOU snapshot guard (pdfTurboApp 511–531).

Genuine defects found are minor (P2/P3). No P0/P1.

---

## Findings

### P2 — `setFormXObjectContent` silently swallows write failures → false-success toast (decoration-add path)
`contentStreamEditor.ts:967` (`catch { /* silently ignore */ }`) and `addDecorationAt`
(1772–1776).

`setFormXObjectContent` wraps its entire body in `try { … } catch {}`. For the main
`replaceTextAt` path this is harmless because XObject text-edit is refused upstream (line
1875). BUT `addDecorationAt` (line 1716) honours `found.xObjectName` (line 1772) and writes
via `setFormXObjectContent`. If that write throws (malformed XObject dict, missing stream
ref, etc.) the error is swallowed, `addDecorationAt` still `return true` (line 1777), and
`commit()` then `save()`s + reports `toast.trueTextEdited` (textEditHandler 718–724) — the
user is told the decoration was added when nothing changed in the XObject.

Evidence: `addDecorationAt` returns `true` unconditionally after the `setFormXObjectContent`
call; the call cannot signal failure because it returns `void` and eats exceptions.

Recommendation: have `setFormXObjectContent` return a `boolean` (false on the catch / early
returns) and propagate it from `addDecorationAt`; or, since true-edit already treats XObject
targets as not-editable, gate `addDecorationAt` to refuse `found.xObjectName` (return false →
no decoration claimed). In practice the editor only opens for `!hit.inXObject` targets, so a
simple `if (found.xObjectName) return false;` is the cleanest fix and keeps the contract honest.

### P2 — Decoration resize/remove uses `getPageFontGlyphWidths` only for measure but ignores non-Identity CID gap silently in the remove path
`removeDecorationForText` (1280–1298) matches a decoration by passing **the rule's own width**
as the run extent (line 1290), with a left-edge proximity guard (`|r.x − origin.x| ≤ 0.5·size`,
line 1289). This is documented as the #bg-fill mitigation. The guard is sound for the common
case, but a real underline whose `re` left edge was rounded/kerned a fraction past
`0.5·fontSize` from the glyph origin will silently NOT be removed on delete → an orphaned
underline survives under deleted text. This is a fidelity gap, not data loss (the orphan is
visible and undoable), but it is undocumented (the resize path documents its ceilings; the
delete-remove path's tolerance does not).

Evidence: `Math.abs(r.x - target.origin.x) <= 0.5 * target.fontSize` — a hard tolerance with
no fallback when it misses.

Recommendation: document the 0.5·size left-edge tolerance as a known remove-path ceiling in
CLAUDE.md alongside the resize ceilings, or widen slightly / fall back to the symmetric-overlap
test used in `matchDecorationForText` (711) for the delete case.

### P3 — `getPageContent` byte→char decode assumes Latin-1, can corrupt multi-byte stream bytes on round-trip for non-edited regions
`getPageContent` (904–911) and `setPageContent` (915–922) round-trip the decoded content
stream through `String.fromCharCode(bytes[i])` ↔ `charCodeAt(i) & 0xff`. This is a faithful
1:1 byte↔char map for bytes 0–255, so it is lossless **today** — the project notes F3
(byte-splice rewrite) is deferred precisely because this round-trip is lossless for 0–255.
The `& 0xff` mask in `setPageContent` is the only thing keeping it safe: if any code path ever
inserts a char > 0xFF into the ops (e.g. a future helper that puts a real Unicode string into
a token `raw`), the mask silently truncates it. Currently all inserted text goes through
`encodeLiteralString` (ASCII-gated) or `font.encodeText().toString()` (Latin-1 byte string),
so it holds — but it is a latent footgun with no assertion.

Evidence: `bytes[i] = content.charCodeAt(i) & 0xff` (line 918) — silent truncation of any
char ≥ 256.

Recommendation: leave the behaviour (it's correct for the current callers) but add a dev-time
assertion or a comment at `setPageContent` flagging that `content` MUST be a Latin-1 byte
string; this is the documented F3 deferral, so a one-line note pointing to it suffices.

### P3 — `replaceShowOpHex` TJ distribution can land a non-even hex slice if an original segment had odd hex length
`replaceShowOpHex` (1439–1470) distributes `newHex` across existing hex segments by their
original *character* lengths (`origLen`, line 1457). The comment asserts "newHex is a multiple
of bytesPerCode and so is each original segment, so the slices stay aligned." That holds for a
well-formed source. But a malformed/odd-length original hex item (e.g. `<41A>`) would make
`origLen` odd, so a non-last segment could receive an odd-length slice, splitting a 2-byte code
mid-byte and producing a garbled glyph in that segment. The A2 guarantee (no stale glyphs) still
holds, but the *new* glyphs could be wrong for that segment. This is an edge case (odd hex is
itself malformed PDF) and the last segment absorbs the remainder, so the overall text is mostly
right — but it's an unvalidated assumption.

Evidence: `const take = isLast ? … : Math.min(origLen, inner.length - cursor)` with no
parity check on `origLen`.

Recommendation: round `take` down to an even number for non-last segments
(`take -= take % 2`) so a 2-byte code is never split; cheap and defensive.

### P3 — `addDecorationAt` proxy-fallback embeds a font on the doc even when the measure is the only use (minor bloat, not a leak)
`addDecorationAt` (1752–1754) calls `doc.embedFont(matchStandardFont(...))` purely to MEASURE
the text width when the embedded-advance path is unavailable. `prepareDecorationResize`
explicitly defers its proxy embed to inside the mutator "so a later-refused edit never embeds an
unused font" (1998–2009). `addDecorationAt` does not apply that discipline — the proxy font dict
is left embedded in the saved PDF even though it is used only as a ruler (the decoration itself
draws a stroked line, no text). Result: a tiny orphan font dict per add-decoration-via-proxy.

Evidence: `const proxy = await doc.embedFont(...); width = proxy.widthOfTextAtSize(text, size);`
— the embed's only consumer is the width measurement.

Recommendation: this mirrors the prior "tiny orphan font on every match" issue the resize path
already fixed; if it matters for output size, measure with a non-embedding metric or strip the
ruler font, but it's cosmetic (pdf-lib may also GC unreferenced fonts on save depending on
version) — lowest priority.

## Things checked and found CLEAN

- No blank-before-redraw anywhere (F9 closes Path 3; Path 1/2 mutate operand only).
- Every refuse gate returns false before mutation; overlay toast surfaced on every refuse.
- `findTarget` skips blanked ghost ops (showOpPayload.trim()==='' , lines 1073, 1092) in both
  page-stream and XObject loops → sequential-edit ghost bug stays fixed.
- Mirror/negative-scale + sheared CTM refused for both rect and stroked-line decorations
  (locateDecorationRects 563–566, 605, 662).
- Double-rule (≠1 candidate) refused in `matchDecorationForText` (711) and the remove path (1292).
- Negative-height `re` normalized to true bbox (645) so background bands aren't eaten.
- ToUnicode CMap parser has OOM guards (MAX_CMAP_ENTRIES, MAX_CODE_POINT, inverted-range skip).
- Inline-image EI terminator is whitespace-delimited (F7, findInlineImageEnd) → no mid-image
  truncation corrupting the page.
- Undo: single save → single ReplaceSourcePdfBytesCmd, with TOCTOU snapshot guard.
- i18n: en/fr/ar parity clean for all true-edit keys (ar values marked [Unverified] per project
  convention, consistent with CLAUDE.md).
