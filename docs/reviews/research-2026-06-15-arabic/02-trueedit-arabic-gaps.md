# True PDF Text-Edit — Arabic Support Gap Analysis

Date: 2026-06-15
Scope: the **true PDF text-edit** engine (`src/utils/contentStreamEditor.ts`) and its
wiring (`src/handlers/textEditHandler.ts`) + overlay export (`src/export/pdfElementRenderer.ts`).
Question: *"the actual text true PDF edit does not support Arabic at all"* — establish ground truth.

Method: full read of `contentStreamEditor.ts` (1576 lines) + `textEditHandler.ts` (534 lines)
+ `pdfElementRenderer.ts` overlay path; grep sweep for `arabic|rtl|bidi|shap|fontkit|joining`
across `src/` and `tests/`; inspection of `@cantoo/pdf-lib` WinAnsi encode behavior in
`node_modules`. Every claim below is [Verified] against a file:line unless marked otherwise.

---

## TL;DR verdict

Arabic is **genuinely unsupported end-to-end**, by both the true-edit paths and the overlay
fallback. There is no Arabic-capable font bundled, no fontkit registration, no shaping engine,
and no bidi/RTL handling anywhere. The two output paths that *could* paint new text both go
through pdf-lib `StandardFonts` (WinAnsi), and pdf-lib **silently substitutes `?` for every
non-WinAnsi code point** (`pdf-lib.esm.js:12816`) — so Arabic input produces a run of `?`
glyphs, not blanks/tofu and not Arabic.

Overall feasibility:
- **In-place (content-stream) Arabic true-edit: ceiling / Hard.** Not realistic client-side for the general case (subset CID fonts lack the new glyphs; no shaping).
- **Overlay-with-real-Arabic-font (no shaping): Moderate.** Achievable: bundle an Arabic font + register fontkit + embed it. Produces *unshaped, visually wrong-joined, LTR-ordered* glyphs — partially legible at best. Only fully correct if the input is already shaped+reordered.
- **Overlay with correct shaping + bidi: Hard but bounded.** Needs a WASM shaper (harfbuzz) + a bidi algorithm. Large new dependency surface; realistic only as a deliberate feature investment.

So: **client-side Arabic true-edit is effectively a ceiling; overlay-only Arabic is realistic
but only "shows the right letters" once a font + shaper + bidi are added.** Today none of those exist.

---

## (A) What already works for Arabic

Essentially nothing in the *edit/render* direction. The only Arabic-positive facts are
adjacent, not in this engine:

- **Reading/extracting** existing Arabic: `findTextOpAt` / `locateTextOps` track the text
  matrix and ToUnicode CMap, and `cmapHexToUnicodeStr` decodes UTF-16BE incl. surrogate
  pairs (`contentStreamEditor.ts:834-855`). Locating an Arabic show-op to click on works;
  it's the *writing back* that fails.
- **App-wide i18n RTL**: the app ships an Arabic UI locale with RTL (`src/utils/i18n.ts`),
  but that is chrome/UI direction, unrelated to PDF content editing.

There is **no** Arabic coverage in the edit tests: grep for `arabic|\u06|rtl|shap|direction`
in `tests/utils/contentStreamEditor.test.ts` and `tests/browser/issue2-true-edit.browser.test.ts`
returns **zero hits** [Verified]. The engine's Arabic behavior is therefore entirely untested.

---

## (B) The real gaps

### Gap 1 — Routing: Arabic always lands on Path 3 (or overlay), never Path 1/2

**Files:** `contentStreamEditor.ts:1182-1292` (`replaceTextAt`), gates at `:1209-1223`.

Path selection in `replaceTextAt`:
- **Path 1** (literal ASCII byte-swap, `:1227`) is gated by `!byteSwapUnsafe`
  (`isByteSwapUnsafeFont`, `:1338-1356`) **and** `isAsciiSafe(newText)` (`:480-486`,
  via `replaceShowOpInPlace`). Arabic text fails `isAsciiSafe` (code points > 126) →
  Path 1 never runs. Even if it did, Arabic fonts are subset/CID → `byteSwapUnsafe` true.
- **Path 2** (subset glyph reuse via ToUnicode, `:1233-1246`) requires
  `encodeWithSubset(newText, reverseMap, …)` to find **every** new character already in the
  font's existing subset (`:912-925` — returns `null` if any char is missing). A subset CID
  Arabic font contains only the glyph *forms* the document already used. Any newly typed
  Arabic letter — or even the same letter in a different *joining form* (initial/medial/final/
  isolated are distinct glyphs) — is absent → `encodeWithSubset` returns `null` → Path 2 fails.
- **Path 3** (standard-font redraw, `:1248-1291`) runs `doc.embedFont(stdFont)` where
  `stdFont` is one of `StandardFonts` chosen by `matchStandardFont` (`:981-1005`) — which only
  ever returns Helvetica/Times/Courier variants. **No Arabic font is reachable.**

**Current behavior:** Arabic edit of normal horizontal visible text → Path 3 redraw with a
Latin standard font. (Type3 / invisible / vertical fonts refuse at `:1209-1215` → overlay.)

**What's needed:** an Arabic-capable embedded font for Path 3, plus glyph availability — which
the standard-fonts approach structurally cannot provide.

**Feasibility:** **Hard** — Path 3 is hardwired to `StandardFonts` (14 Latin faces). Making it
Arabic-capable means abandoning standard fonts for an embedded TrueType/OTF via fontkit (Gap 2).

---

### Gap 2 — No Arabic font + no fontkit anywhere; WinAnsi `?`-substitutes

**Files:**
- `contentStreamEditor.ts:1278` — `const font = await doc.embedFont(stdFont);`
- `contentStreamEditor.ts:1283` — `const showOperand = font.encodeText(newText).toString();`
- `pdfElementRenderer.ts:100` / `:108` — overlay export: `embedFont(StandardFonts[...])` then `page.drawText(line, …)`
- `pdfElementRenderer.ts:196`/`:199` — comment text, same pattern
- `exportPipeline.ts:110` — `embedFont(StandardFonts.Helvetica)`

**Verified facts:**
- grep for `fontkit|registerFontkit` in `src/`: **zero hits**. `@pdf-lib/fontkit` is named in
  the task brief but is **not imported or registered anywhere** [Verified].
- Every `embedFont` call in the repo passes a `StandardFonts.*` enum, never bytes
  (4 call sites, all listed above) [Verified].
- No `.ttf/.otf/.woff*` asset anywhere in the repo (find, excluding `node_modules`):
  **zero results** [Verified] → no Arabic (or any) custom font is bundled.
- pdf-lib's WinAnsi `encodeText` does **not throw** on unencodable code points; it substitutes
  `?`: `pdf-lib.esm.js:12816` → `glyphs[idx] = this.encoding.encodeUnicodeCodePoint(toCodePoint('?'))`
  when `canEncodeUnicodeCodePoint` is false (`:12806-12816`) [Verified].

**Current behavior:** Arabic typed into the true-edit input → Path 3 emits
`font.encodeText("…arabic…")` which becomes a string of `(?)` codes → the redraw shows
`??????`. The overlay fallback (`textEditHandler._emitOverlay` → `TextElement` → export
`pdfElementRenderer.ts:108 page.drawText`) hits the **same** WinAnsi path → also `??????`.
So *both* the true-edit redraw and the overlay produce `?` runs. The "blank/tofu" the user
perceives is actually `?`-substitution (worse: it looks like deliberate redaction failed).

**What's needed:** (1) bundle an Arabic-capable font (e.g. Noto Naskh Arabic / Amiri subset);
(2) `import fontkit from '@pdf-lib/fontkit'; pdfDoc.registerFontkit(fontkit)` before embed;
(3) `embedFont(arabicFontBytes, { subset: true })`; (4) route to it when the text contains
Arabic-range code points (U+0600–U+06FF, U+0750–U+077F, U+FB50–U+FEFF). This fixes *glyph
presence* but NOT shaping/bidi (Gap 3).

**Feasibility:** **Moderate** for the overlay path (well-trodden pdf-lib+fontkit pattern;
~hundreds of KB font asset, lazy-loadable like the DOCX chunk). **Hard** to retrofit into the
Path-3 *in-stream* redraw cleanly, because the redraw is written as raw text operators into the
page content stream (`:1284-1289`) and would need a correctly-registered font resource whose
encoding matches the bytes emitted — doable but fiddly.

---

### Gap 3 — No shaping (contextual joining) and no bidi reordering

**Files:** none — the capability is simply absent. Output is produced by
`page.drawText(line, …)` (`pdfElementRenderer.ts:108`) and the raw `… Tj` redraw
(`contentStreamEditor.ts:1288`), both of which draw glyphs **in logical/code order with no
contextual substitution**.

**Why this breaks Arabic even with a correct font:** Arabic is cursive — each letter has up to
4 contextual forms (isolated/initial/medial/final) selected by GSUB shaping, and the script is
RTL so the *visual* order is the bidi-reordered reverse of logical order. pdf-lib `drawText`
does neither. Result with a real Arabic font but no shaper: **disconnected letters in
left-to-right order** — legible to nobody.

**What's needed (one of):**
1. A client-side shaping engine — **harfbuzzjs (harfbuzz-wasm)** — to map a logical Unicode
   run + font to positioned glyph IDs, then emit those glyph IDs directly (requires a glyph-ID
   show path, not `encodeText`). Highest fidelity; large WASM dependency (~1 MB).
2. A pre-shaping JS library (e.g. an Arabic presentation-forms mapper that picks U+FE70–U+FEFF
   forms) + a bidi library (e.g. `bidi-js`) to reorder. Lighter, lower fidelity (no kerning,
   no mark positioning, breaks on ligatures the font expects via GSUB).
3. Trust that the **input is already shaped+reordered** — impractical for a text input box.

**Feasibility:** **Hard.** Option 1 is the only fully-correct route and is a substantial
dependency + a new glyph-ID rendering path. Option 2 is Moderate-to-Hard and still wrong for
ligatures/marks. Either way this is a deliberate feature, not a patch.

---

### Gap 4 — In-place (non-overlay) Arabic edit is structurally near-impossible

**Files:** `contentStreamEditor.ts:1233-1246` (Path 2), `encodeWithSubset` `:912-925`.

The only path that edits *the original font in the original stream* is Path 2, which can only
reuse glyphs **already present in the document's font subset**. For Arabic:
- The subset contains only the *specific contextual glyph forms* the document already rendered.
- A user edit almost always introduces a new character, or changes the joining context of
  existing characters (inserting a letter changes neighbours from final→medial, etc.), which
  demands glyph forms that are **not in the subset** → `encodeWithSubset` returns `null`.
- Even a same-length swap of one Arabic letter for another typically needs a different glyph
  not in the subset.

So in-place editing degrades to "can only re-stamp the exact glyphs already there in their
exact forms" — useless for real edits. There is no mechanism to *add* glyphs to an existing
embedded subset font (pdf-lib can't append to a third-party subset program).

**Feasibility:** **Hard / ceiling.** Genuinely not realistic client-side for general Arabic
edits. The honest design is to *refuse* in-place and route Arabic to the overlay (mirroring
the existing A5 refusals at `:1209-1215`).

---

### Gap 5 — Inline edit input has no RTL caret / Arabic input affordance

**Files:** `textEditHandler.ts:341-357` (true-edit input creation), `:517-531` (events).
Overlay editor: `src/elements/textElement.ts:39-59`.

**Verified:** grep for `dir|direction|rtl|unicode-bidi` in `textEditHandler.ts` returns
**zero hits**. The `<input>` is created with no `dir` attribute (`:341-343`) and styled only
with font/size/family (`:356`). The overlay `TextElement` input/textarea likewise sets no
`dir` (`textElement.ts:54-59`).

**Current behavior:** typing Arabic into the input *works at the OS/IME level* (the browser
input accepts the Unicode), and the visible caret behaves per the browser's default `dir=auto`
heuristics for the field — but there is no explicit RTL handling, so mixed LTR/RTL content and
caret placement are unreliable, and the field won't visually present as RTL. This is the
*least* severe gap (the input captures the right Unicode; it's the rendering that's broken).

**What's needed:** set `input.dir = 'rtl'` (or `'auto'`) and `style.unicodeBidi`/`textAlign`
when the detected source font / typed content is RTL.

**Feasibility:** **Easy** — a few attribute/style lines. But it's cosmetic until Gaps 2–3 are
fixed; correct input into a renderer that outputs `?` or disjoint glyphs gains nothing.

---

## Severity / ordering

| Gap | Layer | Severity | Feasibility |
|-----|-------|----------|-------------|
| 2 — no Arabic font / no fontkit / WinAnsi `?`-sub | output (both paths) | P0 — root cause of `?` glyphs | Moderate (overlay), Hard (Path 3) |
| 3 — no shaping + no bidi | output | P0 — even a font alone gives disjoint LTR glyphs | Hard |
| 1 — routing always lands Latin Path 3/overlay | dispatch | P1 — consequence of Gap 2 | Hard to fix in-place; Moderate to add an Arabic overlay branch |
| 4 — in-place subset edit impossible | in-stream | P1 — design ceiling | Hard / ceiling |
| 5 — input has no RTL affordance | input | P2 — cosmetic until 2–3 land | Easy |

---

## Recommended honest design (graded)

1. **[Inferred — consistent with the existing A5 refusal pattern at `:1209-1215`]**
   Detect Arabic-range code points in `newText`; in `replaceTextAt`, **refuse the in-stream
   true edit** (return false) so the handler routes to the overlay. This stops the `?`-glyph
   Path-3 redraw immediately and is a small, safe change. Mirrors how Type3/vertical already
   refuse.
2. **[Speculative]** Make the overlay genuinely render Arabic: bundle a subset Arabic font,
   register `@pdf-lib/fontkit`, embed it in `pdfElementRenderer` + `exportPipeline`, and route
   text containing Arabic to it. Without shaping this still produces disjoint glyphs.
3. **[Speculative]** Add shaping+bidi (harfbuzzjs + a bidi pass) to reach correct cursive,
   reordered output — the only path to *correct* Arabic. Treat as a standalone feature with its
   own plan; it is the genuine hard ceiling.
4. **[Verified — trivial change surface, `textEditHandler.ts:341` / `textElement.ts:54`]**
   Set `dir='rtl'`/`unicode-bidi` on the inline + overlay inputs for RTL content (do this
   alongside 2/3, not before — it's cosmetic until the renderer is fixed).

---

## Evidence index (file:line)

- Path dispatch & gates: `contentStreamEditor.ts:1182-1292`, gates `:1209-1223`
- ASCII gate: `:480-486` (`isAsciiSafe`), `:532-567` (`replaceShowOpInPlace`)
- Subset reuse / missing-glyph null: `:912-925` (`encodeWithSubset`), `:1233-1246`
- byte-swap-unsafe (subset/CID/embedded → true): `:1338-1356`
- Path-3 standard-font redraw: `:1248-1291`, `embedFont` `:1278`, `encodeText` `:1283`, raw Tj `:1284-1289`
- standard-font matcher (Latin only): `:981-1005`
- Overlay fallback emit: `textEditHandler.ts:284-309` (`_emitOverlay`), refusal fallback `:503-510`
- Overlay export (WinAnsi drawText): `pdfElementRenderer.ts:99-108`, `:196-199`
- WinAnsi `?` substitution: `node_modules/@cantoo/pdf-lib/dist/pdf-lib.esm.js:12806-12816`
- No fontkit / no font asset / no Arabic test: grep sweeps (all zero hits) — see method note
- Inline input, no RTL: `textEditHandler.ts:341-357`; overlay input `textElement.ts:39-59`
