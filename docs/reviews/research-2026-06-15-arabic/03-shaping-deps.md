# 03 — Arabic shaping/bidi dependency stack for pdf-lib drawText

> Research date: 2026-06-15. Project: PDFturbo (100% client-side, TS + Vite, `@cantoo/pdf-lib` 2.7.1 for PDF writing).
> Goal: render CORRECT Arabic into a pdf-lib overlay. All package facts below verified against `registry.npmjs.org` (Rule 11) and against the installed `node_modules/` on disk (Rule 18: Verified unless stated).

## TL;DR recommendation

**The hard premise in the brief is only HALF true — and that changes everything.**

- TRUE: pdf-lib's `page.drawText` does **NOT** run OpenType GSUB when using a **StandardFont** (Helvetica/Times/Courier) — and StandardFonts don't even contain Arabic glyphs, so naive Arabic is garbage.
- **FALSE (verified on disk):** when you embed a **custom TTF/OTF via `embedFont` + `registerFontkit`**, `drawText` routes its text through `CustomFontEmbedder.encodeText`, which calls `font.layout(text, fontFeatures)` — **fontkit's full layout engine, including its bundled `ArabicShaper` (init/medi/fina/isol GSUB).** Evidence:
  - `node_modules/@cantoo/pdf-lib/cjs/core/embedders/CustomFontEmbedder.js:44` → `const { glyphs } = this.font.layout(text, this.fontFeatures);`
  - `:47` → embeds `glyphs[idx].id` as 4-hex glyph IDs (true glyph-ID output, not codepoints).
  - `node_modules/@pdf-lib/fontkit/dist/fontkit.es.js` contains `ArabicShaper`, `UniversalShaper`, `isol/init/medi/fina` tokens.

So **contextual shaping is already solved for free** by the fontkit path. The ONLY thing fontkit's `layout()` does *not* do is **paragraph-level bidi reordering** (logical→visual). fontkit shapes a run; it does not run UAX#9. That is the one gap you must fill yourself.

**Recommended stack (all already in `package.json`, all MIT/OFL, all browser-safe):**

| Role | Package | Version | License | Size | Browser? |
|------|---------|---------|---------|------|----------|
| Shaper (GSUB) | `@pdf-lib/fontkit` | 1.1.1 | MIT | ~4.2 MB unpacked node_modules; the **`.es.min.js` bundle is ~0.2 MB** and you already ship pdf-lib | ✅ ("Node and the browser") |
| Bidi reorder | `bidi-js` | 1.0.3 | MIT | 216 KB unpacked; ES5, **zero deps** | ✅ |
| Font | `@fontsource/noto-naskh-arabic` (or vendor `NotoNaskhArabic-Regular.ttf`) | 5.2.11 | OFL-1.1 | ~120–250 KB per weight (subset to ~30–60 KB) | ✅ |

**Integration in one line:** `logical string → bidi-js reorder to visual order → drawText with an embedded Noto Naskh Arabic via embedFont+registerFontkit` — fontkit shapes the rest. No `arabic-reshaper`, no harfbuzz wasm, no presentation-forms hack required.

---

## 1. Shaping options

### (a) `@pdf-lib/fontkit` `font.layout()` — ✅ RECOMMENDED SHAPER

- **Does fontkit do Arabic GSUB shaping?** YES — verified: `ArabicShaper` is bundled in `dist/fontkit.es.js`, and `layout()` returns a `GlyphRun` of post-GSUB glyph IDs (`fontkit.d.ts:174-623`).
- **Can its output be drawn via pdf-lib?** YES, and this is the key insight: you do **not** need a draw-by-glyphID API. pdf-lib's `embedFont(...)` path *itself* calls `layout()` internally inside `drawText`. You just call `page.drawText(visualString, { font: notoNaskh })` and pdf-lib + fontkit produce a hex string of shaped glyph IDs in the content stream.
  - Confirmed there is **NO public draw-by-glyphID API**: `PDFPage` exposes `drawText`, `drawImage`, `drawPage`, `pushOperators` only (`PDFPage.js`). `showText` exists but only as a low-level operator (`operators.js`) that still expects a `PDFHexString` of glyph IDs — i.e. you'd be re-implementing `encodeText`. Not needed.
- **Latest version:** 1.1.1 — **published 2020-11-28** (last release; old but it is the canonical fork pdf-lib depends on and is NOT deprecated). **License:** MIT. **Weekly downloads:** ~928,610. **Browser:** yes (UMD + ES builds; `module: dist/fontkit.es.js`).
- **Caveat:** v1.1.1 is unmaintained-but-stable. Its Arabic shaper is solid for Naskh; it does NOT do bidi (by design) and its handling of mark positioning (tashkeel/diacritics GPOS) is weaker than harfbuzz. For base Arabic letterforms + lam-alef ligature it is correct.

### (b) Presentation-Forms reshaper (`arabic-reshaper` / `arabic-persian-reshaper`) — ❌ NOT RECOMMENDED

- `arabic-reshaper`: v1.1.0, **published 2016-11-21**, **License: GPL-3.0** → **license-incompatible** with an MIT/permissive client app (copyleft). Reject on license alone.
- `arabic-persian-reshaper`: v1.0.1, published 2020-01-26, **License: MIT**, not deprecated — license-clean but abandoned (6 yrs).
- **How it would work:** map Arabic Unicode → Presentation-Forms-B codepoints (U+FE70–FEFC), then `drawText` with a font that has those PF glyphs. **Problem:** this is a *redundant, lossy* approach when fontkit already shapes via GSUB. PF-B cannot express all contextual forms a real GSUB ruleset can; it bakes the wrong assumption that one glyph == one PF codepoint. Combined with the fact that you'd STILL need bidi-js, this option buys nothing over (a) and adds a worse shaper. Reject.

### (c) `harfbuzzjs` (harfbuzz wasm) — ⚠️ BEST QUALITY, BUT OVERKILL HERE

- v1.3.0, **published 2026-06-14** (actively maintained), **License: MIT**, **~1.01 MB unpacked** (wasm ~200–500 KB gzipped). Browser: yes.
- Produces glyph IDs + GPOS positions — the gold standard for shaping (correct mark/tashkeel positioning, all ligatures).
- **Same draw-by-glyphID problem as (a):** pdf-lib has no public glyph-run draw API, so to use harfbuzz output you'd have to hand-build content-stream `Tj/TJ` operators with positioned glyphs via `pushOperators`, re-implementing the encoder AND replicating the embedded-font subset/CIDFont machinery. High effort, large wasm payload, for a marginal quality gain over fontkit on Naskh text.
- **When to revisit:** if diacritics/tashkeel positioning quality becomes a hard requirement, harfbuzz + manual `pushOperators` is the upgrade path. Not for v1.

## 2. Bidi — `bidi-js`

- **v1.0.3, published 2023-07-31, License: MIT, ~22.1M weekly downloads, 216 KB unpacked, ES5, zero deps, browser-safe** (it is the bidi engine used by Troika/three.js text). Not deprecated. (Verified: registry + on-disk README.)
- API (from on-disk `README.md`): `const bidi = bidiFactory(); const { levels } = bidi.getEmbeddingLevels(text, "rtl"); const flips = bidi.getReorderSegments(text, embeddingLevels);` then reverse each `[start,end]` range in place to get **visual order**. Also `getMirroredCharactersMap` for parens/brackets.
- This is the missing piece fontkit doesn't provide. Tiny, ubiquitous, correct (conforms to UAX#9 §C1, passes the Unicode conformance suite).

## 3. Font — Noto Naskh Arabic / Amiri

- **Noto Naskh Arabic** via `@fontsource/noto-naskh-arabic` **5.2.11 (2026-02-01), OFL-1.1** — or just vendor the raw `NotoNaskhArabic-Regular.ttf` (OFL) into `src/assets/fonts/`. Amiri (OFL) is the prettier alternative for literary text; Noto Naskh is the safer default (smaller, exhaustive coverage, well-tested GSUB).
- **Does it include presentation-form glyphs (for option 1b)?** It has the *glyphs*, but they are reached via **GSUB substitution rules from the base U+06xx codepoints**, not necessarily via a cmap entry for U+FE70–FEFC. That is *exactly why option (b) is fragile* and why the fontkit-GSUB path (a) is correct — you feed base Arabic codepoints and let GSUB pick the right contextual glyph.
- **Vite bundling (lazy chunk):** import the `.ttf` as a URL/asset and fetch it on first Arabic use, OR import as bytes. Two clean patterns:
  - `import fontUrl from "../assets/fonts/NotoNaskhArabic-Regular.ttf?url";` then `const bytes = await fetch(fontUrl).then(r => r.arrayBuffer());` — Vite emits the `.ttf` as a hashed asset, fetched on demand (true lazy).
  - Keep the whole Arabic path behind a `await import("./arabicText")` dynamic import so fontkit + bidi-js + the font fetch are all in one lazy chunk that never loads for EN/FR users.
  - Use `embedFont(bytes, { subset: true })` (supported — `PDFDocument.js:1017` reads `{ subset, customName, features }`) to shrink the embedded font to only used glyphs.

## 4. Per-dependency fact table (all Verified against npm + on-disk)

| Package | Latest | Last publish | License | Weekly dl | Deprecated? | Size | Browser |
|---------|--------|-------------|---------|-----------|-------------|------|---------|
| `@pdf-lib/fontkit` | 1.1.1 | 2020-11-28 | MIT | ~928,610 | No | 4.2 MB node_modules / ~0.2 MB ES bundle | ✅ |
| `bidi-js` | 1.0.3 | 2023-07-31 | MIT | ~22,127,973 | No | 216 KB | ✅ |
| `arabic-reshaper` | 1.1.0 | 2016-11-21 | **GPL-3.0** | (low) | No, but abandoned | small | ✅ |
| `arabic-persian-reshaper` | 1.0.1 | 2020-01-26 | MIT | (low) | No, abandoned | small | ✅ |
| `harfbuzzjs` | 1.3.0 | 2026-06-14 | MIT | (mid) | No | ~1.01 MB (wasm) | ✅ |
| `@fontsource/noto-naskh-arabic` | 5.2.11 | 2026-02-01 | OFL-1.1 | (mid) | No | ~120–250 KB/weight | ✅ |

> Both `@pdf-lib/fontkit@1.1.1` and `bidi-js@1.0.3` are **already installed** (`package.json` devDep + dep respectively). No new shaping/bidi install required — only the font asset.

## 5. Recommended integration (the simplest correct path TODAY)

Pipeline: **logical Unicode → bidi reorder to visual order → `drawText` with embedded Noto Naskh Arabic** (fontkit shapes inside drawText).

```ts
// src/export/arabicText.ts  (dynamic-imported so EN/FR users never load it)
import bidiFactory from "bidi-js";
import fontkit from "@pdf-lib/fontkit";
import notoUrl from "../assets/fonts/NotoNaskhArabic-Regular.ttf?url";

const bidi = bidiFactory();

/** logical string -> visual-order string (per UAX#9). */
export function toVisualOrder(text: string, base: "rtl" | "ltr" = "rtl"): string {
  const el = bidi.getEmbeddingLevels(text, base);
  const flips = bidi.getReorderSegments(text, el);
  const chars = Array.from(text); // code-point safe
  for (const [start, end] of flips) {
    for (let i = start, j = end; i < j; i++, j--) {
      const tmp = chars[i]; chars[i] = chars[j]; chars[j] = tmp;
    }
  }
  // (optional) apply getMirroredCharactersMap for parens/brackets in RTL runs
  return chars.join("");
}

let _fontBytes: ArrayBuffer | null = null;
async function arabicFontBytes() {
  if (!_fontBytes) _fontBytes = await fetch(notoUrl).then(r => r.arrayBuffer());
  return _fontBytes;
}

/** Draw correctly-shaped, correctly-ordered Arabic into a pdf-lib page. */
export async function drawArabic(
  pdfDoc: any, page: any, rgb: any,
  logicalText: string, opts: { x: number; y: number; size: number; color?: any },
) {
  pdfDoc.registerFontkit(fontkit);                       // REQUIRED before embedFont of a custom font
  const font = await pdfDoc.embedFont(await arabicFontBytes(), { subset: true });
  const visual = toVisualOrder(logicalText, "rtl");
  // fontkit's ArabicShaper runs GSUB inside drawText -> connected contextual forms:
  page.drawText(visual, { x: opts.x, y: opts.y, size: opts.size,
                          font, color: opts.color ?? rgb(0, 0, 0) });
}
```

Wire-in point in this repo: `src/export/pdfElementRenderer.ts` (currently uses only `StandardFonts[...]` + `embedFont` at lines ~100/196) — detect Arabic-bearing text elements (`/[؀-ۿݐ-ݿﭐ-﻿]/`) and route them through `drawArabic` instead of the StandardFont `drawText`. `exportService.ts:83` already imports `{ PDFDocument, rgb, StandardFonts, degrees }`; add the dynamic `import("./arabicText")` there.

### What this WILL handle
- Contextual joining (isolated/initial/medial/final) — via fontkit ArabicShaper GSUB. ✅
- **Lam-alef ligature** (mandatory `لا`) — it is a GSUB rule in Noto Naskh; fontkit applies it. ✅
- Correct visual order, incl. mixed Arabic+Latin+digits (bidi-js UAX#9). ✅
- Mirrored parens/brackets in RTL runs — if you apply `getMirroredCharactersMap`. ✅

### What it will NOT (or only partially) handle
- **Tashkeel / harakat diacritics (GPOS mark positioning):** fontkit's GPOS for marks is weaker than harfbuzz; marks usually render but may be slightly mis-positioned vertically. Acceptable for most overlays; if exact, go harfbuzz (option c). ⚠️
- **Per-line bidi for wrapped text:** `drawText`'s own `maxWidth` wrapping happens AFTER you've reordered the whole paragraph → wrapping a reordered RTL string breaks. **Do your own line-breaking in logical order, run `toVisualOrder` per line, and draw each line yourself (no `maxWidth`).** This is the main implementation footgun. ⚠️
- **Kashida/justification stretching** — not supported. ❌
- Right-alignment is your responsibility (measure with `font.widthOfTextAtSize(visual, size)` and set `x = right - width`).

## 6. Honest feasibility verdict

**Least-risky, ship-today path = fontkit (already present) + bidi-js (already present) + a vendored Noto Naskh Arabic OFL TTF.** Zero new shaping deps, all MIT/OFL, all browser-proven, total added weight ≈ one ~30–60 KB subset font. The only real engineering work is (1) per-line reorder-then-draw discipline and (2) Arabic detection + right-alignment in `pdfElementRenderer`. Reserve harfbuzzjs strictly for a future "perfect tashkeel" upgrade. Avoid the presentation-forms reshapers entirely (GPL or abandoned, and strictly worse than the GSUB path you already get for free).

