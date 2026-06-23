# QA Review — PDF→DOCX/MD/TXT flow export (2026-06-23)

Files read:
- `src/utils/flowDoc.ts` (full)
- `src/utils/flowDocWriters.ts` (full)
- `src/export/exportService.ts` (`exportAsDocx`/`exportAsMarkdown`/`_extractFlowDoc`/`_rasterizeImagePlacement`, ~810–1180)

Overall the domain is mature and well-guarded. The RTL gate, image-store
resolution, ordered-list ordinals and margin/heading heuristics are all
implemented carefully and match their documented contracts. The findings below
are genuine defects, not documented ceilings.

---

## P1 — Markdown hyperlink URL is emitted unescaped → broken/maliciously-shaped links

`flowDocWriters.ts:245`
```ts
if (r.linkUrl) styled = `[${styled}](${r.linkUrl})`;
```
`r.linkUrl` comes straight from `page.getAnnotations()` Link `url`
(`exportService.ts:1049-1058`) with NO validation beyond `typeof url === 'string'`.

Two real problems:
1. **Functional breakage:** a URL containing `)` or whitespace (very common in
   tracking links, e.g. `…?a=(b)` ) terminates the Markdown link early, producing
   garbage output. The link text body IS escaped (`mdEscapeInline`), but the URL
   target is not, and the URL parenthesis is the markdown link delimiter.
2. **Injected scheme:** a PDF can carry a Link annotation with
   `url: "javascript:alert(1)"` or `data:text/html,…`. Emitted verbatim into MD,
   a renderer that turns `[x](javascript:…)` into a clickable anchor executes it.
   The DOCX path is safer (it forces `ExternalHyperlink` and Word sandboxes most
   schemes) but still passes the raw scheme through.

Recommendation: percent-encode `(`/`)`/whitespace in the URL (or use the
`<…>` angle-bracket Markdown autolink form) AND allow-list schemes
(`http:`/`https:`/`mailto:`) for both MD and DOCX — drop or render-as-text any
`javascript:`/`data:`/`vbscript:` link target.

---

## P2 — Markdown heading body is emitted UN-trimmed; lists/paragraphs differ

`flowDocWriters.ts:252`
```ts
blocks.push(p.heading > 0 ? `${'#'.repeat(p.heading)} ${body.trim()}` : body);
```
Headings call `body.trim()`, but the plain-paragraph branch pushes raw `body`
(which can carry leading/trailing whitespace assembled from run lead/trail
fragments at 236-247). Minor: a leading space on a non-heading paragraph survives
into the `.md`. Cosmetic but inconsistent with the heading/list branches that all
trim. Recommendation: trim the paragraph branch too (`blocks.push(body.trim())`).

---

## P2 — `assignHeadings` all-caps promotion mis-fires on non-Latin scripts

`flowDoc.ts:1201-1207`
```ts
const letters = text.replace(/[^A-Za-z]/g, '');
if (letters.length < 3) continue;
...
const allCaps = text === text.toUpperCase() && /[A-Z]/.test(text);
if (fullyBold || allCaps) p.heading = promotionLevel;
```
The `letters` count is **ASCII-only** (`[^A-Za-z]`). A Cyrillic/Greek heading set
at body size with no A–Z letters yields `letters.length === 0 < 3` → never
promoted by the all-caps path (only by `fullyBold`). Conversely
`text === text.toUpperCase()` is true for ANY string with no cased characters
(CJK, digits, Arabic) — so a 3+-"letter" check that happens to include one stray
A–Z plus CJK could promote a non-heading. Edge-case precision/recall gap for
non-Latin docs. Recommendation: count Unicode letters (`\p{L}` with the `u` flag)
and require `/\p{Lu}/u` for the all-caps test.

---

## P2 — Hyperlink grouping splits across a paragraph but ordered/MD ordinal map keyed by object identity is fine; the DOCX hyperlink children can be empty-text

`flowDocWriters.ts:382-390` groups consecutive same-`url` runs into one
`ExternalHyperlink`. If a run's `text` is empty (possible after run-merge edge
cases), an `ExternalHyperlink` with a zero-width child is emitted. Word tolerates
this but it produces an invisible clickable region. Low impact; recommend
filtering `group` to runs with non-empty `text` before wrapping.

---

## P2 — Image base64 → bytes via `atob`+`charCodeAt` loop can throw on malformed data, aborting the whole DOCX

`flowDocWriters.ts:426-428`
```ts
const bin = atob(img.base64);
const data = new Uint8Array(bin.length);
for (let i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i);
```
`img.base64` is produced by `canvas.toDataURL(...).split(',')[1]` so in the normal
path it is valid. But there is no guard: if `base64` is ever malformed (a future
caller, a corrupt data URL), `atob` throws `InvalidCharacterError`, which
propagates out of `flowDocToDocxBase64` and is caught only by the top-level
`exportAsDocx` catch → "export failed" with NO partial document. A single bad
image kills the whole export. Recommendation: wrap per-image decode in try/catch
and skip the offending image (the text still exports). The `_rasterizeImagePlacement`
producer already null-guards; the writer consumer does not.

---

## P3 — `reverseRtlText` / `orderLineWords` RTL gating is correct (verified — no finding)

Confirmed the RTL reorder fires ONLY for RTL:
- `orderLineWords` (`flowDoc.ts:499-524`) computes `rtl` from
  `rtlCount*2 > words.length` where `word.rtl` is `it.dir === 'rtl'`
  (`reconstructPage:1053`). Cyrillic/CJK/Latin items report `dir: 'ltr'` from
  pdf.js, so `rtl` is false and the function returns ascending-x with text
  **untouched** — no `reverseRtlText`, no NFKC. Cyrillic/CJK pass through intact.
- `textElementsToFlowParagraphs` and `ocrTextToFlowDoc` use `isArabicText(line)`
  (Arabic-block-only regex `flowDoc.ts:458`) to set `rtl` — Cyrillic/CJK never
  match, correctly stay LTR. Matches the documented #2 multi-language contract.

This is clean; listing only to record it was checked.

---

## P3 — `commonObjs` `g_` resolution is correct (verified — no finding)

`exportService.ts:1142` `const store = imageName.startsWith('g_') ? page.commonObjs : page.objs;`
matches the documented ISSUE-3 fix and pdf.js v6 GlobalImageCache behaviour. The
`store.has` guard + `?.bitmap` null guard + `<=10pt` reject are all present. Clean.

---

## P3 — ordered-list ordinal correctness (verified — no finding)

`computeOrderedOrdinals` (writers 185-201) and the DOCX `orderedInstances`
(331-343) share the same break-on-non-ordered / break-on-different-ref restart
logic via `orderedRefKey`. `toAlpha`/`toRoman` are correct (spreadsheet alpha,
greedy roman). The MD/TXT writers reuse the same ordinal map. Consistent across
all three writers. Clean.

---

## Notes on robustness (no crash found)

- Malformed text items: `reconstructPage:1024` guards `if (!it.str || !it.str.trim()) continue;`
  and `size = hypot(...) || abs(height) || 12` guards a zero/NaN transform. A text
  item with a non-array `transform` would throw on destructuring, but pdf.js always
  supplies a 6-element transform — not a realistic input.
- `detectColumnSplit` handles `< 4` words and single-baseline gracefully.
- Redaction intersection (`isItemRedacted`) is well-reasoned (partial overlap
  redacts) and the rotated un-rotate (CORE-P0-1) is wired through `totalRot`.
