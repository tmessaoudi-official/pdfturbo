# True PDF Text-Edit — Blocker Enumeration (2026-06-15)

Extends `research-2026-06-15/02-trueedit-matrix.md` + `scorecard-trueedit.md`. All
line numbers re-verified against the current `src/utils/contentStreamEditor.ts`
(1587 lines) and `src/handlers/textEditHandler.ts` (533 lines) by direct read this
session [Verified]. This file lists blockers to **100% reliable true text editing**,
re-confirms the prior scorecard rows, flags mis-classifications, and designs a
confirming `it.fails()` per reachable gap. CLASS = REACHABLE (fixable client-side) /
CEILING (structurally hard) / FIXED (prior gap already closed).

---

## Part A — Re-confirmation of the prior scorecard

### Routing matrix — every row still holds (spot-check of the load-bearing cells)

| Scorecard row | Re-verified at | Verdict |
|---|---|---|
| Std-14 ASCII → Path-1 | `:1228` `!byteSwapUnsafe && replaceShowOpInPlace` | HOLDS |
| Subset/CID in ToUnicode → Path-2 | `:1235-1247` | HOLDS |
| accented/`€` → Path-3 redraw | `:1294` `font.encodeText` | HOLDS |
| Subset glyph-not-in-subset → Path-3 | `:1241` `encodeWithSubset` null → falls through | HOLDS |
| Form-XObject → refuse→overlay | engine `:1256-1263`; handler `:139` `!hit.inXObject` | HOLDS |
| Type3 / Tr3·7 / vertical → refuse | `:1210-1216` | HOLDS |
| Arabic new-text → refuse→overlay | `:1271-1273` `isArabicText` | HOLDS |
| TJ kerning preserve (Gap 1 DONE) | Path-1 `:548-557`, Path-2 `:953-962` segment-split | HOLDS — confirmed implemented |
| blank only same fontKey+size+payload (A4) | `:709-712` | HOLDS |
| cmap UTF-16BE + surrogates (A3) | `:835-856` | HOLDS |
| Path-3 cm scale/rot → identity Tm (A6 ceiling) | `:1298` `1 0 0 1 … Tm` | HOLDS |

No prior row mis-classified on **routing**. One **outcome** row is now stale — see B-2.

---

## Part B — Confirmed reachable gaps (with mis-classification flags)

| ID | One-line | CLASS | file:line | Root cause | Test env | Confirming-test design |
|----|----------|-------|-----------|------------|----------|------------------------|
| **B-1** | Number tokenizer splits `1e-3` exponent → space inserted, op grouping changes | REACHABLE | `:153,156` (main) + `:193,196` (`tokenizeOne`) | open class `[0-9+\-.]` but continuation class `[0-9.]` excludes `e`/`E`; `serializeTokens` re-joins with a space | jsdom | `serializeTokens(tokenizeContentStream('1e-3 0 0 1 0 0 Tm'))` → **today**: `1 e -3 0 0 1 0 0 Tm` (3 tokens for the real, plus a stray `e` operator). **Expect**: round-trips to a single number token `1e-3` so the stream meaning is preserved. Assert `tokenizeContentStream('1e-3').filter(t=>t.type==='number').length === 1`. |
| **B-2** | Path-3 redraw of `scn`/Separation/spot text → **black** when no canvas sample reaches the engine | REACHABLE (scorecard says "🟡 silent black" — now **partly mitigated**, flag as MIS-CLASSIFIED) | parser `:443-462` (rg/g/k only); `cs` reset `:376-379`; black default `:440`; mitigation `:431-441` + handler `:501-502` | `parseFillColorToRgb` returns null for `scn`; `cs` wipes `fillColor`. The handler now passes `sampledFallback`, so the **handler-driven** edit is no longer black — but any **direct** `replaceTextAt` call without `fallbackColor`, AND any case where the sampled pixel is wrong (anti-aliased edge, overlapping glyph) still yields black/wrong. | jsdom (pure) | `resolveRedrawColor(undefined, '1 0 0 1 scn', undefined)` → **today** `{0,0,0}` (black). **Expect**: a Separation/`scn` raw should not collapse to pure black silently — either parsed (1-component tint → gray `1−tint`) or the function should signal "unresolved" so the caller is forced to sample. Minimal confirming test: assert `parseFillColorToRgb('1 0 0 1 scn')` returns non-null OR `resolveRedrawColor` given only a Separation raw returns a non-black value. **Mis-classification note:** scorecard line "silent black" overstates — handler path samples canvas; pure/direct path still black. |
| **B-3** | Non-WinAnsi ligature `ﬁ`/`ﬀ` on Path-3 → `encodeText` substitutes/drops, **no refusal** | REACHABLE | redraw `:1294` `font.encodeText(newText)`; refusals end at `:1273` (only Type3/Tr/vertical/Arabic) | A standard pdf-lib font is WinAnsi; U+FB01 is absent → `encodeText` emits a substitute or `notdef`. Unlike Arabic (`:1271`), no guard refuses, so the engine returns `true` with a wrong glyph painted — violating the A-5 "refuse rather than paint garbage" contract. | jsdom (pure helper) — needs a tiny `isWinAnsiEncodable(text)` seam OR test via embedded font | Pure: add/exercise a predicate `hasNonWinAnsi('ﬁle')`. **Today** there is no such guard → a Path-3 edit with `ﬁ` returns `true`. **Expect**: text containing a non-WinAnsi codepoint refuses→overlay (parallel to `isArabicText`). Confirming `it.fails()`: build a std-font page, `replaceTextAt(...,'ﬁle')`, assert it returns **false** (refuse). Today returns **true**. |

---

## Part C — NEW gaps found this read

| ID | One-line | CLASS | file:line | Root cause | Test env | Confirming-test design |
|----|----------|-------|-----------|------------|----------|------------------------|
| **C-1** | Multi-byte CID edit where a target glyph is split across TJ hex segments mis-distributes when `newHex` length ≠ original total | REACHABLE | `:953-962` | Path-2 split slices `inner` by **original segment char length**, last segment absorbs delta. For 2-byte codes a slice that lands on an odd hex boundary is impossible (origLen even) — OK — BUT if `newHex` is **shorter**, early segments keep their original byte count while the **payload** is fewer codes → trailing segments become `<>` (good) yet the kerning numbers between now-empty segments still advance the cursor → visible gaps. | jsdom | Feed `[<0041> -50 <0042> -50 <0043>] TJ`, replace with 1-char hex `<0058>`. **Today**: `[<0058> -50 <> -50 <>]` — two stray −50 kerns advance with no glyph → 100u gap before nothing. **Expect**: a length-reducing CID edit should also neutralize the orphaned kerning numbers between emptied segments (or collapse). Assert serialized output has no `-50 <>` trailing pattern. |
| **C-2** | ToUnicode-missing font: Path-2 skipped, falls to Path-3 std redraw even for an in-subset glyph that *could* round-trip | REACHABLE (degradation, not corruption) | `:1235` `if (cmapText)` gate; no `/Differences`/built-in-encoding fallback | Many simple TrueType/Type1 subset fonts have **no** `/ToUnicode` but a usable `/Encoding /Differences`. Engine ignores Differences entirely → every edit on such a font degrades to a substitute std face. | jsdom (pure, once a `parseDifferencesEncoding` seam exists) | Document gap: `getPageFontToUnicode` returns null for a Differences-only font; assert that no alternative reverse-map is attempted (today). **Expect** (target): a `/Differences`-derived reverse map lets in-encoding ASCII edits stay in the real font. `it.fails()` asserts Path-2 succeeds for a Differences-only font. |
| **C-3** | `getPageContent` concatenates a `Contents` **array** of streams with `\n`, but `setPageContent` writes back **one** stream — an op spanning a chunk boundary (e.g. `BT` in stream 1, `Tj` in stream 2) is fine, but a **token** split across the boundary (`(par` … `tial)`) is silently corrupted | CEILING-ish / REACHABLE-hard | read `:573-596`; write `:599-606` | PDF allows a single token to straddle two content streams in a `Contents` array. The `\n` join can break a literal string opened in chunk A and closed in chunk B is actually preserved (bytes concatenated) — **but** a token split exactly at the array boundary where chunk A ends mid-escape (`\` last byte) corrupts on re-tokenize. Rare but real per ISO 32000 §7.8.2. | jsdom | Construct two raw streams: A ends with `(ab\`, B starts with `c) Tj`. After `getPageContent` join the `\n` inserts between `\` and `c` → escape now escapes newline, dropping `c`. **Today**: edited text loses a char. **Expect**: array chunks concatenated with no separator (spec says they are a single stream). Assert decoded concatenation has no injected `\n` between chunks. **Note:** changing the join to `''` is the fix but risks merging an operator at A-end with operand at B-start lacking whitespace — so this is REACHABLE only with care; flag as evidence-only if a deterministic fixture can't be built in jsdom. |
| **C-4** | Indirect `/Length` stream: `decodePDFRawStream` relies on pdf-lib having resolved Length; a stream whose `/Length` is an indirect ref to an object in a **compressed object stream** may decode short | EVIDENCE-ONLY (pdf-lib-internal) | `:590` `decodePDFRawStream(s).decode()` | pdf-lib resolves indirect Length on load; if the producer put Length in an ObjStm and pdf-lib mis-parsed, the decoded content is truncated → tokenizer sees a partial stream → target not found → silent overlay fallback (acceptable) OR mid-token truncation. Cannot be reproduced as a pure unit (needs a crafted PDF + pdf-lib load). | browser/jsdom with crafted bytes | Evidence-only: load a PDF with indirect-Length content stream, assert `getPageContent` length === expected decoded length. Non-deterministic across pdf-lib versions → **do not** write as `it.fails()`; capture as a manual QA note. |
| **C-5** | Compressed object streams (`/Type /ObjStm`): a page whose `/Contents` ref lives inside an ObjStm — `doc.context.lookup` resolves it, but `getPageContent` only accepts `PDFRawStream`; a content stream stored as a compressed object is handled by pdf-lib decompression, so OK — the real blocker is a font dict (`getPageFontToUnicode`/descriptor) inside an ObjStm resolving to a non-`PDFRawStream` ToUnicode | REACHABLE (verify) | `:1074` `if (!(tuStream instanceof PDFRawStream)) return null` | If pdf-lib returns the ToUnicode as a different stream class after ObjStm decompression, the `instanceof PDFRawStream` guard returns null → Path-2 skipped → needless Path-3 degradation. | jsdom with crafted doc | Build a doc whose font ToUnicode is reachable only via an object stream; assert `getPageFontToUnicode` returns non-null. **Today** may return null. Evidence-only if the class identity is pdf-lib-version-dependent. |
| **C-6** | Very long replacement overflow on Path-1 single-segment Tj: no width recompute, line runs past margin (no wrap, no clip) | CEILING | `:566` literal swap; no width math | A literal byte-swap keeps the original `Tf`/`Tm`; a much longer string simply overflows the original advance. Inherent to in-place editing without re-layout (re-flow is a full typesetting problem). | n/a | Document as CEILING: in-place edit cannot reflow surrounding text. No `it.fails()` (expected behaviour, not a bug). |
| **C-7** | Negative-kerning edge: an all-number TJ segment edit where `decodeLiteralString` length 0 → `lengths=[0,...]`, cursor never advances on early segments, entire payload dumped in last segment | REACHABLE | `:548-557` | If a string segment is empty `()`, `decodeLiteralString('()')` → `''` length 0; `take=min(0, …)=0` so it stays empty and the cursor only fills the last segment → kerning distribution lost for that line (regresses Gap 1 for the empty-leading-segment case). | jsdom | `replaceShowOpInPlace` on `[() -30 (Word)] TJ` with `'Xyz!'`. **Today**: `[() -30 (Xyz!)]` (fine here) but `[(a) -30 () -30 (bc)]` with `'aXbc'` → middle empty stays empty, last absorbs `Xbc` → `[(a) -30 () -30 (Xbc)]`, the −30 before the empty seg now adds a phantom gap. Assert per-segment char counts track non-empty originals. |
| **C-8** | `'` / `"` show operators: `"` takes `aw ac string` operands; `replaceShowOpInPlace` swaps the **last** operand (correct), but `blankShowOp` / payload extraction also assume last-operand string — a `"` with a hex string last operand on Path-2 is handled, but the `aw`/`ac` spacing numbers are never adjusted for the new text length | REACHABLE (minor) | `:562` (last operand), `:386-389` (`'`/`"` line advance) | The `"` operator's word/char spacing (`aw ac`) is tuned to the original glyph count; editing the string without touching them leaves stale spacing. Cosmetic, narrow. | jsdom | `replaceShowOpInPlace` on a `"` op `1 2 (Hi) "` with `'Hello'`; assert today the `aw=1 ac=2` survive unchanged (documents the gap). Expect: spacing acknowledged or left (low priority — likely WONTFIX). |

---

## Part D — Ceiling items re-confirmed (no fix possible client-side)

| Item | file:line | Why CEILING |
|------|-----------|-------------|
| A6 — cm scale/rotation in Path-3 redraw | `:1298` identity `Tm` | Redraw can't reconstruct an arbitrary CTM into a single `Tm`; would need full CTM-aware glyph placement = re-implementing the renderer. Path-1/2 immune. [Verified] |
| Rotated-page inline-input placement | handler `:409-412` raw screen coords | Edit bytes correct; only the floating `<input>` box is approximate on `/Rotate` pages. [Verified] |
| RTL/Arabic Path-3 redraw | refuse `:1271`; std fonts Latin-only `:982-1006` | No embedded Arabic fallback in the engine; shaping/bidi is a font feature lost on re-encode. Correctly routed to overlay. [Verified] |
| Type3 true-edit | refuse `:1211`, `:1375-1379` | Glyphs are CharProc streams, not byte→glyph. [Verified] |
| In-place reflow / long-text overflow (C-6) | `:566` | No re-layout engine; inherent. |
| PDFium-WASM moonshot | n/a | Several-MB WASM replacing the whole surgery layer; out of scope. [Speculative] |

---

## Highest-ROI reachable

**B-3 (non-WinAnsi ligature refusal)** is the highest-ROI *correctness* fix: it is a
one-line guard (`if (hasNonWinAnsi(newText)) return false;` next to the existing
`isArabicText` refusal at `:1271`) that converts a **silent wrong-glyph paint** into the
honest overlay fallback — closing the last hole in the A-5 "never paint garbage"
contract. Tiny effort, removes a visible-corruption class.

Runner-up **B-1 (exponent tokenizer)** is a ~2-line regex fix in two places with a pure
round-trip test — cheap robustness against non-conformant producers. **B-2 (Separation
black)** is real but already half-mitigated via the handler's canvas sample; the residual
is the pure/direct-call path and bad samples — medium value. **C-7 (empty-segment kerning)**
is a genuine Gap-1 regression for a narrow input and worth folding into the existing
Gap-1 tests. C-3/C-4/C-5 are evidence-only (pdf-lib-internal / fixture-hard) — capture as
manual QA notes, not `it.fails()`.
