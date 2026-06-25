# Sub-project A — True in-place PDF text editing fidelity (design)

Date: 2026-06-25. Parent: `2026-06-25-trueedit-docx-maxfidelity-program-design.md`.
Module: `src/utils/contentStreamEditor.ts` (+ `src/handlers/textEditHandler.ts` for the UX item).
Scope confirmed by a code-is-truth audit (line numbers verified against the current file).

## Goal
Push the **true-edit engine** (genuine content-stream surgery — Path 1 literal byte-swap / Path 2 subset
glyph reuse / Path 3 standard-font redraw) toward maximum reachable fidelity **without regressions**: every
item is gated/additive so a normal horizontal visible edit, and every edit that does not hit the new branch,
is **byte-identical** to today. The engine already refuses (→ overlay) what it cannot do faithfully; this
work converts a few of those losses into faithful in-place edits and closes Path-3 attribute gaps.

## Audit — two umbrella items are ALREADY SHIPPED (dropped from scope)
The 2026-06-15 matrix/scorecards under-counted shipped work (same lesson as B2/B4). Verified in code:
- **A4 / TE-7 (Path-3 bold/italic-aware face)** — `matchStandardFont(effectiveName, effectiveFlags)` is
  already called in the Path-3 redraw (`contentStreamEditor.ts:2027`), reading the original font name +
  FontDescriptor `/Flags` (bits FixedPitch/Serif/Italic/ForceBold) and `style` overrides, selecting
  Helvetica/Times/Courier Bold/Oblique variants. **DONE — removed.**
- **A5 / TE-4 (non-WinAnsi / ligature refuse→overlay)** — `hasNonWinAnsi(newText)` (`:2004`, the B-3 refuse)
  already returns true for `ﬁ`/U+FB01 and every non-WinAnsi codepoint → Path 3 refuses → overlay. Arabic is
  refused separately (`:1997`). **DONE — removed.**

## Pipeline anchors (verified)
- `locateTextOps` (`:~389-562`) — walks a content stream, tracking `textMatrix`/`ctm`/`renderMode`/`fillColor`/
  `Tc`/`Tw`/`Tz`/`Ts`/stroke/`lineWidth`. It already computes `trm = textMatrix×ctm` (`:531`), `vScale`
  (`:526`), and a `tilted` flag (`:535`); `fontSize` is stored as `fontSize * vScale` (`:544`). It does **not**
  capture ExtGState alpha or dash/cap/join.
- `buildPath3Redraw` (`:2074`) — emits `\nq\n<rg>\nBT\n/<res> <size> Tf\n<state>\n1 0 0 1 <x> <y> Tm\n<show> Tj\nET\nQ`.
  The `Tm` is **hard-coded identity** — rotation/scale from `trm` is discarded (A1).
- `replaceTextAt` (`:~1900-2065`) — refuse gates (Type3 / `Tr` 3·7 / vertical at `:1917`; Arabic `:1997`;
  non-WinAnsi `:2004`), Path 1 (`:1952`), Path 2 (`:1961`), Path 3 (`:2008-2055`). Path-3-in-XObject refuses
  (`:1982`-area). `writeBack` (`:1132`) already calls `setFormXObjectContent` (`:1135`) for XObject targets.
- `getEditableTextAt` (`:~1325`) returns null for XObject targets (`:1331`); `textEditHandler.ts:263` skips
  XObject hits (`!hit.inXObject`). These two HANDLER gates are the only thing blocking XObject Path-1/2.
- `textEditHandler` inline-input placement (`:152-161`) is already rotation-aware
  (`getViewport({rotation:(page.rotate+userRot)%360})` + `convertToPdfPoint`).

---

## A1 — Path-3 full-affine transform redraw (highest value/risk; build after the low-risk items)
**State:** `buildPath3Redraw` emits identity `1 0 0 1 x y Tm`, so a rotated/scaled run redrawn via Path 3
lands axis-aligned upright. The matched op's `trm` (full text→user matrix) is already captured by
`locateTextOps`; `tilted` text is currently **not** refused, so it silently un-rotates today.
**Decision (user, 2026-06-25): FULL AFFINE** — reproduce the entire `trm` (rotation + scale + shear) in the
redraw `Tm`, not just rotation+uniform-scale.
**Approach:**
1. Carry the captured `trm` onto the `EditTarget` (a new optional `textMatrix?: Matrix` / `trm` field; absent
   ⇒ identity ⇒ byte-identical). Decompose is **not** needed for the matrix itself — emit `trm[0..3]` directly
   as the `Tm` linear part with the op's origin as `Tm[4,5]`.
2. **Critical (double-scale trap):** `target.fontSize` is already `Tf_size × vScale`. If the `Tm` carries the
   full scale, the `Tf` size must be the **BASE** `Tf` operand (un-baked), or scale applies twice. Capture the
   raw `Tf` size separately on the target (`baseFontSize`), and pass THAT to `buildPath3Redraw` whenever a
   non-identity `Tm` is emitted. A size-only/no-transform edit keeps using the effective size (unchanged).
3. `buildPath3Redraw` gains an optional `textMatrix?: [a,b,c,d]`; present → emit `a b c d x y Tm` instead of
   `1 0 0 1 x y Tm`. Absent → byte-identical.
**Gate:** only emit a non-identity `Tm` when `trm` is non-identity (rotation/scale/shear detected). Upright
1:1 text → identity → **byte-identical**. Style fontSize override still works (multiplies the base).
**Files:** `contentStreamEditor.ts`. **Risk:** Medium-High (most intricate module, decoration interaction).
**Tests:** unit — `buildPath3Redraw` with a `textMatrix` emits the right `Tm` + base size; a rotated-op target
forces Path 3 (CID restyle) and the redraw carries the rotation matrix. Browser — render a rotated text op,
true-edit it, assert the rasterized glyph is still rotated (pixel band), and an upright control stays upright.

## A2 — Path-3 alpha (`ca`/`CA`) preservation
**State:** semi-transparent (watermark/faded) text redraws fully opaque — `locateTextOps` ignores ExtGState
alpha. **Approach:** (1) in `locateTextOps`, track the active fill alpha: on a `gs` operator resolve the
named ExtGState's `/ca` (and `/CA` for stroke) from the page/XObject resource dict, carry the current value;
stamp `fillAlpha`/`strokeAlpha` on the target only when `< 1`. (2) In the Path-3 block, when alpha < 1, embed
(or reuse) an ExtGState resource (`/ca`,`/CA`) — mirror `addPageFontResource`'s resource-dict insertion with
a new `addPageExtGStateResource(doc, pageIndex, {ca,CA})` — and prepend `/<GSx> gs` inside the redraw `q…Q`
block (extend `buildPath3Redraw` with an optional `gsName`). **Gate:** alpha == 1 (the default) → no `gs`
emitted → byte-identical. **Files:** `contentStreamEditor.ts`. **Risk:** Low-Med (new resource-dict write —
keep it inside the same atomic `writeBack`). **Tests:** unit — alpha captured from a `gs`+ExtGState; redraw
contains `/GSx gs` only when alpha<1; resource added. Browser — a faded text op edited stays faded (sampled
pixel alpha/lightness vs an opaque control).

## A3a (TE-6a) — XObject Path-1/2 in-place true-edit
**State:** Form-XObject text refuses → overlay, even for the SAFE Path-1/2 cases — purely because of two
HANDLER gates; the engine write-back for XObjects already ships (`setFormXObjectContent`, used by Path 1/2's
`writeBack`). **Approach:** (1) `getEditableTextAt` — when the target is in an XObject, still derive the
prefill from the matched op's own decoded text **if** the edit would be Path-1/2-safe (standard font ⇒ Path 1,
or a ToUnicode/subset-reuse ⇒ Path 2); return null only for the Path-3 case (still refused). (2)
`textEditHandler.ts:263` — accept an XObject hit when it is Path-1/2-editable (drop the blanket `!hit.inXObject`
for that case). Path 1/2 only swap show-op bytes, which is coordinate-space-agnostic — safe inside an XObject.
**Gate:** Path-3-in-XObject stays refused (`:1982`) until A3b. A non-XObject edit is unaffected → byte-identical.
**Files:** `contentStreamEditor.ts` (relax `getEditableTextAt`), `textEditHandler.ts` (relax the hit gate).
**Risk:** Low-Med (coordinate-safe; the risk is prefill/decoding correctness in the XObject font). **Tests:**
unit — `getEditableTextAt` returns prefill for a Path-1/2-safe XObject target, null for a Path-3 one. Browser —
build a PDF with editable text in a Form XObject; true-edit a word (standard font) → assert the XObject stream
changed and pdf.js renders the new text; a CID/Path-3 XObject target still overlays.

## A3b (TE-6b) — XObject Path-3 redraw
**State:** Path-3-in-XObject is explicitly refused. **Approach:** once A1 lands the transform machinery and
A3a proves XObject prefill, allow the Path-3 redraw to target the XObject stream via the existing
`buildStreamContent`/`setFormXObjectContent` single-stream write — emitting the redraw (with the A1 `trm`
mapped through the XObject's own CTM) into that stream. **Gate:** behind A1+A3a; non-XObject Path 3 unchanged.
**Files:** `contentStreamEditor.ts`. **Risk:** Med (XObject-local coordinate space + the redraw matrix).
**Tests:** browser — a CID-font word inside an XObject true-edited via Path-3 substitution renders in place.
**Fallback:** if XObject-local coordinates prove unreliable, KEEP the refuse→overlay (document as the ceiling)
— A3a already delivers the common-case win.

## A6 — Path-3 attribute polish (narrow, low risk; build last)
- **TE-5 — stroke dash / line-cap / line-join on Path-3.** `locateTextOps` captures stroke color + line width
  but not dash/cap/join, so a dashed/round-capped outline redraws solid. Capture the dash array (`d`), cap
  (`J`), join (`j`) and re-emit in the Path-3 state block. **Gate:** defaults (solid, butt, miter) → nothing
  emitted → byte-identical. Only meaningful on render-mode-2 (outline) text.
- **TE-8 — Path-3 size-change decoration width.** A Path-3 edit that ALSO changes `fontSize` measures the new
  text width at `target.fontSize` (the OLD size) → the resized underline can be slightly off. Use the
  effective new size for the width measurement when a size change is requested. **Gate:** no size change →
  unchanged.
- **TE-3 — rotated-page inline-input placement (UX).** `textEditHandler` is already rotation-aware
  (`convertToPdfPoint` with `(page.rotate+userRot)`). **Verify-on-build:** confirm the floating `<input>`
  box position on a 90/180/270° page; only adjust if a real misplacement reproduces. May already be correct →
  then this is a no-op + a guard test.

---

## Build order within A (low-risk → hard)
**A2 → A3a → A1 → A3b → A6** (A1's transform machinery is a prerequisite for A3b; A2 + A3a are the
independent low-risk wins; A6 polish last). Each item = its own commit + the FULL deploy gate + a
byte-identical-when-inactive control assertion.

## Cross-cutting invariants
- **Byte-identical when inactive** is a REQUIRED test per item (the regression guard) — a normal horizontal
  visible edit, and any edit that doesn't hit the new branch, must produce identical bytes.
- New `EditTarget` / `buildPath3Redraw` fields are OPTIONAL; absent ⇒ today's output.
- No new runtime dep. Client-side only (GRDF: no network, no upload).
- Every change keeps the existing refuse→overlay contract: never paint a wrong glyph or over a scan.

## Tests (added)
`tests/utils/contentStreamEditor.test.ts` (extend: A1 matrix + base-size, A2 alpha capture/emit, A3a
getEditableTextAt XObject, A6 dash/cap/join + size-width) · browser: `trueedit-transform.browser.test.ts`
(A1 rotated stays rotated), `trueedit-alpha.browser.test.ts` (A2), `trueedit-xobject.browser.test.ts` (A3a/b).

## Out of scope (walls, unchanged)
In-place Arabic/RTL (overlay IS the right answer — subset CID fonts lack new glyphs), Type3, vertical writing,
invisible Tr 3/7 (OCR layers), multi-line reflow, multi-show-op single word (G7 overlay), text-clip modes 4–6
side-effect, embedded-face exact reproduction (Path-3 substitutes base-14 by design).
