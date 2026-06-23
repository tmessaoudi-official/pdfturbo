# i18n / RTL (Arabic) QA — raw findings — 2026-06-23

Domain: internationalization and right-to-left (Arabic) support.
Files read (actual source):
- `src/utils/i18n.ts`
- `src/utils/textLayer.ts` (prompt said `src/core/textLayer.ts` — does not exist; real path is `src/utils/textLayer.ts`)
- `src/utils/rtlClipboard.ts`
- `src/handlers/textSearchHandler.ts`
- `src/core/searchManager.ts`
- `src/ui/elementLayerRenderer.ts` (excerpt)
- `src/styles/base.css` (skip-link region)
- `locales/{en,fr,ar}.json` (parity + content audit, programmatic)

---

## Summary of the assigned P1 (Arabic-RTL horizontal overflow)

**Verdict: RESOLVED in the committed tree. The memory note that "a handoff re-locked it" is stale.**

The documented root cause was a visually-hidden skip-link positioned with `left:-9999px`,
which in `dir=rtl` flips into ~10000px of horizontal page overflow (scrollWidth balloons,
layout displaces). Commit `eb7ac11` ("fix: clip the RTL skip-link offscreen instead of
left:-9999px") replaced it with the clip-based visually-hidden pattern.

`src/styles/base.css:6-28`:
```css
/* Skip-nav: hidden until focused (keyboard a11y).
   Uses the clip-based visually-hidden pattern — NOT `left:-9999px`, which is
   RTL-unsafe: in `dir=rtl` an off-screen-left box flips into ~10000px of
   horizontal page overflow ... */
.skip-link {
  position: absolute; left: 0; top: 0; ...
  width: 1px; height: 1px; overflow: hidden;
  clip: rect(0 0 0 0); clip-path: inset(50%); white-space: nowrap;
}
```

I then swept the whole `src/` tree for any *other* offscreen-left / content-scaled-width
pattern that could resurface the overflow under RTL:
- `grep -rn 'left: *-|9999|right: *-' src/**/*.ts src/styles index.html` → the only `9999`
  hits are z-index values (`placementManager.ts:248`, `index.html` modals) and the
  `BYTE_RANGE_SENTINEL` (signing), all benign.
- No `width: max-content` / `fit-content` that scales with RTL text content was found in
  the stylesheets.

So there is **no live overflow defect** in the code as committed. (I could not drive a
real RTL browser render in this review to produce a pixel screenshot — that confirmation
is recommended below — but the CSS root cause is demonstrably removed and no equivalent
pattern remains.)

---

## Findings

### P1 — PDF text-search regex path has NO ReDoS guard (inconsistent with overlay path) — DoS
- **Category:** security
- **File:** `src/handlers/textSearchHandler.ts:126-130, 141-143, 204-209`
- **Evidence:** The find bar exposes a user-controlled regex toggle (`index.html:199`
  `id="findRegex"`). When enabled, `searchManager.run` calls `textSearchHandler.search`
  with `useRegex:true`. `search()` compiles the raw user pattern with **no safety check**:
  ```ts
  pattern = useRegex ? new RegExp(query, flags) : new RegExp(query.replace(...), flags);
  ```
  and the normalized + cross-item line passes do the same (`new RegExp(normQuery, nflags)`
  at 141-143, `new RegExp(normQuery, gflags)` at 204-209). These patterns are then executed
  in a synchronous `while ((m = pattern.exec(item.str)))` loop over **every text item on
  every page** (and over reconstructed line text). A catastrophic-backtracking pattern
  (e.g. `(a+)+$` against a long item) freezes the tab — there is no Worker, no timeout, no
  pattern rejection.
  The sibling overlay-text path in the SAME search DOES guard: `searchManager._matchesQuery`
  → `_isSafeRegex(query)` (`searchManager.ts:108, 119-126`) rejects long patterns and nested
  quantifiers. So the protection is applied to the *minor* path (overlay boxes) and skipped
  on the *primary* path (pdf.js page text). The CLAUDE.md DOCX find/replace notes explicitly
  acknowledge "catastrophic backtracking inside one `re.exec()` is uninterruptable" as a
  documented ceiling for the DOCX editor — but here it is an **undocumented gap** in the PDF
  search path, and the fix already exists in the same module (`_isSafeRegex`).
- **Recommendation:** Run the user pattern through `_isSafeRegex` (export it from
  `searchManager.ts` or duplicate the cheap check) before compiling in
  `textSearchHandler.search`; on rejection, return `[]` and surface the existing
  invalid-regex UX. This makes both halves of one search consistent and closes the freeze.

### P3 — Inaccurate comment claims `escapeValue:false` (i18next actually runs with escapeValue:true)
- **Category:** security (documentation/contract clarity, not an exploit)
- **File:** `src/ui/elementLayerRenderer.ts:92`
- **Evidence:** The doc comment reads:
  > "...passed as a plain string via setAttribute — never injected as HTML — so it is safe
  > even though i18next runs with escapeValue:false."
  But `src/utils/i18n.ts:70` sets `interpolation: { escapeValue: true }`. The interpolated
  value at `elementLayerRenderer.ts:99` (`t('element.aria.labelWithContent', { ... content })`)
  is user text from `_a11yContent` (a trimmed/truncated plain string, `:105-110`) — it is
  HTML-escaped by i18next AND only ever reaches `setAttribute('aria-label', …)`, so there is
  no actual XSS. The code is safe; the comment's stated premise is simply false and will
  mislead a future reader into thinking escaping is off (and possibly "fixing" it by adding
  `escapeValue:true` somewhere, or relaxing setAttribute discipline elsewhere on the false
  belief that escaping is on globally).
- **Recommendation:** Correct the comment to "...so it is safe; i18next additionally escapes
  with `escapeValue:true` (`i18n.ts:70`)." One-line doc fix.

---

## Things explicitly verified CLEAN (no finding)

- **3-locale key parity:** programmatic flatten + 3-way diff → en 569 / fr 569 / ar 569 keys,
  **0 missing rows**. The locale-sync write hook is doing its job.
- **Arabic translation completeness:** only 10 ar values are byte-identical to en, and every
  one is a proper noun / symbol that *should* not be translated: `app.title`="PDFturbo",
  `toolbar.ocrLabel`="OCR", `modal.sign.x/y`="X"/"Y", `thumbnail.imgPng/Jpeg`="PNG"/"JPEG",
  `modal.bates.prefixPlaceholder`="ACME-", `modal.code.ecL/M/Q`="L – 7%"/"M – 15%"/"Q – 25%".
  No untranslated English leakage. (Native-speaker correctness of the actual Arabic strings
  remains a documented out-of-scope ceiling.)
- **escapeValue intact:** `i18n.ts:70` `escapeValue: true`; no `escapeValue:false` anywhere in
  `src/`.
- **textContent vs innerHTML:** `applyTranslations` (`i18n.ts:22-42`) uses `textContent`,
  `title`, `placeholder`, `setAttribute('aria-label'…)`, `alt`, `optgroup.label` — never
  `innerHTML`. No `innerHTML` sink fed by `t(...)` anywhere.
- **dir/lang switching:** `updateHtmlDir` (`i18n.ts:46-50`) sets `<html dir>` to `rtl` only
  for `ar`, splits BCP-47 region (`split('-')[0]`), defaults `en`. Correct.
- **Copy reconstruction (no internal reversal):** `rtlClipboard.reconstructLogicalText`
  orders spans by reading POSITION (RTL → x-descending via `[...byX].reverse()`) and
  NFKC-folds each span WITHOUT reversing internal chars (`:71, :81`) — matching the
  documented `السلام`→correct (not `السمال`) fix. Space inference from x-gaps
  (`medianW*0.4`). Gated to Arabic selections only (`textLayer.ts:76`
  `!isArabicText(raw)` early-return) so LTR copy falls through to native.
- **Arabic cross-item search:** `buildLogicalLines` reconstructs per-line logical text from
  per-glyph items, token→item offset map, and the line pass (`:202-243`) maps a match to the
  covering items' union box. The line pass is gated `isArabicText(normQuery)` and the per-item
  normPattern fallback is gated `!isArabicText(normQuery)` (`:179`) — **mutually exclusive**,
  so no double-counting between the two Arabic strategies. Zero-length-match guards present in
  both loops (`:171`, `:218`).
- **Toolbar/selection mirroring:** `alignSpanOrderToVisual` (`textLayer.ts:185-204`) is gated
  to RTL/Arabic-dominant pages (`rtl*2 <= len → return false`), so it never reorders LTR
  multi-column reading order. Reordering absolutely-positioned spans is visually invisible.
  Copy re-sorts by geometry so DOM reorder doesn't affect copy output.
- **Arabic overlay export:** `arabicOverlay.ts` uses `encodeText` (already visual order) →
  raw `Tj`, does NOT reverse CID pairs (`:194` + header note), embeds the vendored Noto Naskh
  **.ttf** (not woff — the documented mis-embed trap, `:21-25`), bounds the font fetch with a
  15s abort + anti-poison cache clearing on failure (`:57-94`). Mixed Arabic+Latin routed to
  `drawBidiLine` with per-script fonts and a graceful non-WinAnsi fallback to Noto. Solid;
  remaining limits (char-level bidi, tashkeel GPOS, rotated Arabic) are documented ceilings.

---

## Recommended manual confirmation (not a code finding)

The assigned P1 is fixed at the CSS level, but per the project's visual-evidence rule, a
real-browser RTL render (switch to Arabic, load a doc, check `document.scrollWidth` ≈
viewport width and no horizontal scrollbar) would convert this from "[Inferred] fixed by
removing the root-cause CSS" to "[Verified] no overflow." I could not drive a browser in
this review pass.
