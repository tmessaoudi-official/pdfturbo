# PDF→DOCX / Markdown / TXT Export Fidelity — Blocker Enumeration (2026-06-15)

Read-only static-analysis pass over `src/utils/flowDoc.ts`, `src/utils/flowDocWriters.ts`,
`src/export/exportService.ts`, `src/export/exportPipeline.ts`. Extends (does NOT repeat) the
DOCX-centric `research-2026-06-15/scorecard-docx.md` + `01-docx-gaps.md`. Two material findings up front:

1. **The scorecard is STALE.** It marks rows 13 (roman), 21 (rotated image), 23 (underline/strike),
   24 (super/subscript) as 🟡 reachable/queued. **All four are already implemented in source today**
   (Sprint 4, per CLAUDE.md). Verified below. The scorecard predates the merge → mis-classified.
2. **The scorecard is DOCX-only.** The Markdown and TXT writers (`flowDocToMarkdown`,
   `flowDocToText`) are dramatically lower-fidelity than the DOCX path and are NOT scored at all.
   They drop ordinal format, list nesting, images, color, super/sub, underline/strike, RTL, and headings-in-lists.
   This is the largest *un-tracked* fidelity surface. New IDs MD-1..MD-7 / TX-1..TX-3 below.

---

## A. Scorecard rows RE-VERIFIED against current source

| Scorecard row | Scorecard says | Actual today | Evidence |
|---|---|---|---|
| 13 roman `(i)` | 🟡 queued | **DONE** (lowerRoman/upperRoman) | `flowDoc.ts:370,374-378,407-420` `isMultiCharRoman`+roman branch; writer `flowDocWriters.ts:350-356` `LEVEL_FORMAT` incl. `LOWER_ROMAN`/`UPPER_ROMAN` |
| 18 spot/Separation `scn` | 🟡 black-collapse | **STILL REAL but narrowed** — see G6 | op-walk handles only `setFillRGBColor`/`Gray`/`CMYK` (`exportService.ts:534-541`); no `setFillColorN`/`setFillColorSpace`. v6 pre-resolves *most* spaces to RGB string, so collapse now only hits Pattern/uncommon DeviceN fills. |
| 21 rotated image | 🟡 queued | **DONE** | `flowDoc.ts:163-171` `decomposeImageCtm`; used `exportService.ts:491-500`; writer `flowDocWriters.ts:308-309` `rotation` (degrees) |
| 23 underline/strike | 🟡 queued | **DONE** | `flowDoc.ts:74-90` `classifyRuleAsUnderline`; rule collection `exportService.ts:505-533`; matched `flowDoc.ts:800-807`; writer `flowDocWriters.ts:241-242` |
| 24 super/subscript | 🟡 queued | **DONE** | `flowDoc.ts:549-554` vertAlign detect; merge-key `:591`; writer `flowDocWriters.ts:243-244` |
| 26 RTL flags / reorder | 🟡 flags only / ⛔ reorder | **PARTIALLY DONE** — single-RTL-line logical reorder now works (`orderLineWords`/`reverseRtlText` `flowDoc.ts:442-463,502-503`). Mixed LTR+RTL single-line reorder still ⛔. |

**Net:** of the 7 rows the scorecard lists as 🟡 reachable, **5 are already shipped**; only spot-color
(G6, narrowed) and heading bold/caps promotion (G5) remain genuinely open.

---

## B. Blocker table (NEW + still-open)

| ID | One-line | CLASS | file:line | Root cause | Test env | Confirming-test design (input → today's WRONG output → expected) |
|----|----------|-------|-----------|-----------|----------|------------------------------------------------------------------|
| MD-1 | MD/TXT ordered lists ALWAYS render `1.` — format + actual ordinal lost | REACHABLE | `flowDocWriters.ts:119-122` (txt), `:153` (md) | Writer hardcodes `\`1. ${text}\`` / `\`- \`` regardless of `listFormat`/`listOrdinalText`/sequence position | jsdom | `flowDocToMarkdown` on a FlowDoc with 3 ordered paras `listFormat:'lowerLetter', listOrdinalText:'%1)'` → today emits `1. x\n\n1. y\n\n1. z` → expected `a) x\n\nb) y\n\nc) z` (or at minimum `1.`/`2.`/`3.` decimal counter). it.fails on asserting `/a\)/`. |
| MD-2 | MD/TXT list NESTING flattened — `listDepth` ignored | REACHABLE | `flowDocWriters.ts:152-153` (md), `:119-121` (txt) | Writer never reads `p.listDepth`; no indentation emitted. DOCX path honors it (`flowDocWriters.ts:283,285`) | jsdom | `flowDocToMarkdown` on para `{listType:'bullet', listDepth:2}` → today `- item` (flush left) → expected `    - item` (4 spaces/level, CommonMark nesting). it.fails asserting leading-space count. |
| MD-3 | MD has NO image output — images silently dropped | REACHABLE | `flowDocWriters.ts:132-158` never touches `page.images` | MD writer iterates `page.paragraphs` only | jsdom | `flowDocToMarkdown` on a FlowPage with `images:[{base64,mimeType,...}]` and 0 paragraphs → today `''` → expected an `![](data:image/png;base64,...)` line (or a `media/` ref). it.fails asserting `/!\[/`. (DOCX emits the image; MD/TXT lose it entirely — asymmetry.) |
| MD-4 | MD drops color / super-sub / underline / strike (all run attrs except bold/italic/link) | REACHABLE (partial — MD has no native syntax for color) | `flowDocWriters.ts:137-150` only handles bold/italic/linkUrl | Run loop ignores `color`, `vertAlign`, `underline`, `strikethrough` | jsdom | `flowDocToMarkdown` with run `{strikethrough:true,text:'gone'}` → today `gone` → expected `~~gone~~` (GFM strikethrough). Super/sub → `<sup>`/`<sub>` HTML. it.fails asserting `/~~gone~~/`. (color = no clean MD syntax → CEILING-adjacent for MD only.) |
| MD-5 | MD/TXT drop RTL — Arabic exports with no direction marker | REACHABLE (limited) | `flowDocWriters.ts:132-158`, `:115-125` ignore `p.rtl`/`r.rtl` | No RLM/`dir` emitted; logical reorder already done upstream so chars are correct but bidi context for mixed lines is lost in plain text | jsdom | `flowDocToMarkdown` on an rtl para → today plain text → expected wrapped in `<div dir="rtl">` (MD-with-HTML) or a leading U+200F RLM. **Evidence-only is acceptable** if the team decides plain-text RTL is out of scope; otherwise it.fails on the marker. |
| MD-6 | MD heading suppressed when paragraph is ALSO a list item | REACHABLE (edge) | `flowDocWriters.ts:152-154` — list branch `continue`s before heading check | A list item that size-clusters as a heading loses its `#` (rare but real) | jsdom | para `{listType:'bullet', heading:2, runs:[run('Title')]}` → today `- Title` → expected either `- Title` (intentional) or doc decision. **Low priority / possibly correct-by-design** — flag as evidence-only. |
| TX-1 | TXT ordered list = `1.` for every item (same root as MD-1) | REACHABLE | `flowDocWriters.ts:120-121` | Hardcoded `\`1. \`` | jsdom | `flowDocToText` on 2 ordered paras → `1. a\n\n1. b` → expected `1. a\n\n2. b`. it.fails asserting `/2\. b/`. |
| TX-2 | TXT drops images + all run styling (lossy by nature, but image loss is silent) | REACHABLE (image) / by-design (styling) | `flowDocWriters.ts:115-125` | `flowDocToText` = `paragraphText` join only | jsdom | TXT on image-only page → `''` → expected a `[image]` placeholder line so the user knows content was dropped. it.fails asserting non-empty. |
| TX-3 | TXT loses heading hierarchy entirely (no marker, no blank-line emphasis) | by-design / REACHABLE-lite | `flowDocWriters.ts:117-122` | headings flattened to plain lines | jsdom | TXT on `heading:1` para → identical to body → expected e.g. UPPERCASE or `===` underline. Low ROI; evidence-only. |
| G5 | Heading detection is SIZE-ONLY — bold/caps same-size headings missed; all-big docs mis-tag body | REACHABLE | `flowDoc.ts:896-920` `assignHeadings` (size cluster only); no weight/caps signal; no <30%-body sanity cap | Single-signal heuristic | jsdom | `assignHeadings` on a doc where every run is `fontSize:24` and one short bold line should be H-level → today ALL paras get `heading:0` (no size exceeds modal) OR all tagged headings on a slide → expected the bold short line promoted / body suppressed. it.fails asserting the bold line `heading>0`. |
| G6 | Spot/Separation/Pattern fill via `scn`/`sc` → colored text collapses to last color (often black) | REACHABLE (black-collapse + key-miss) / CEILING (exact Lab/ICC tint) | `exportService.ts:534-541` (only RGB/Gray/CMYK handled); no `OPS.setFillColorN`/`setFillColorSpace`; colorMap exact-key lookup `flowDoc.ts:796` | scn ops ignored → stale `fillHex`; sub-pixel origin drift misses the key | browser (op-list only populates in real Chrome) | Real-Chrome export of a Separation-spot-color PDF → run `color` undefined/`000000` → expected the brand hex. Also jsdom-unit the colorMap *nearest-±2pt* lookup tolerance (key-miss half is pure). |
| G7 | colorMap lookup is EXACT rounded-origin — 1px Tm-vs-item drift drops the color | REACHABLE | `flowDoc.ts:796` `colorMap.get(\`${Math.round(x)},${Math.round(y)}\`)` vs op-walk key `exportService.ts:570-574` | Two independent roundings of the same origin can differ by 1 | jsdom | Build colorMap with key `"100,200"`; reconstructPage with an item whose origin rounds to `"101,200"` → today `color` undefined → expected nearest-within-2pt match returns the color. it.fails on the off-by-one item. |
| G8 | Multi-line super/subscript & vertAlign merge-key can split a footnote ref into its own line | REACHABLE (precision) | `flowDoc.ts:483-487` overlapClose gate; `:549-554` | A superscript at line END with no body glyph after it may not satisfy `overlap>0.3*smaller` and spawns a 1-word line | jsdom | reconstructColumn with body line + a trailing tiny raised glyph just past line end → today a separate paragraph → expected same line, `vertAlign:'super'`. it.fails asserting one paragraph. (lower ROI) |
| C1 | Lattice / borderless TABLES — no detection, no `Table`/`TableRow`/`TableCell` emission | CEILING | absent (grep: no Table* in flowDoc/writers) | Requires vector-ruling grid reconstruction OR column-gap clustering → chronic FP | n/a | Evidence-only: a tabular PDF exports as run-together paragraphs; no `<w:tbl>` in DOCX. Document, don't it.fails. |
| C2 | Vector graphics (logos/charts/dividers) → no DrawingML | CEILING | `constructPath` only mined for thin underline rules `exportService.ts:505-533`; fills/strokes otherwise discarded | No client-side path→OOXML translator | n/a | Evidence-only. |
| C3 | 3+ column / recursive XY-cut — only ONE vertical cut | CEILING | `flowDoc.ts:823-835` single `detectColumnSplit`, no recursion | One V-cut → 2 columns max | n/a | Evidence-only: a 3-col magazine page interleaves columns. Could be REACHABLE-hard (recursive alternating cut) but multi-day + degrades; keep CEILING. |
| C4 | Tagged-PDF `getStructTree` exact fast-path absent | CEILING (scope) | grep: no `getStructTree` in src | Parallel exact path is a separate multi-day build; only ~15% of PDFs tagged | n/a | Evidence-only. NOTE: where a struct tree EXISTS this is REACHABLE and high-value — re-classify as REACHABLE-large if prioritized. |
| C5 | Headers / footers routing to docx header/footer | CEILING (noisy) | grep: no header/footer logic in flowDoc | Repeated-band detection across pages, chronic FP | n/a | Evidence-only: running heads land inline as body paragraphs. |
| C6 | Mixed LTR+RTL single-line bidi reorder + Arabic tashkeel GPOS | CEILING | `orderLineWords` `flowDoc.ts:453-463` handles majority-RTL line only | Full UAX#9 bidi + shaping is structurally hard client-side | n/a | Evidence-only (single-RTL-run already works — A. row 26). |
| C7 | Exact subset-font face (`ABCDEF+Foo` not in allow-list) | CEILING | `flowDocWriters.ts:72-82` resolveWordFont → generic fallback | No embedded font file recovered; subset family unrecoverable | jsdom (the fallback is testable) | jsdom: resolveWordFont on `psName:'XYZABC+ProprietarySans'` → today generic `Arial`/`Times` → "expected" exact face is UNRECOVERABLE → assert the fallback is at least the right serif/sans CLASS, not the wrong one. (Ceiling for exact; reachable for class-correctness.) |

---

## C. Highest-ROI REACHABLE (ordered by value/effort)

1. **MD-1 + TX-1 — ordered-list ordinals in MD/TXT (S, ~0.5d).** The single most visible MD/TXT
   defect: every numbered list reads `1. 1. 1.`. The data (`listFormat`, `listOrdinalText`, and a
   simple running counter that resets on a non-list paragraph — the DOCX writer already computes the
   instance boundary at `flowDocWriters.ts:200-212`) is all present; the MD/TXT writers just ignore it.
   Pure → jsdom it.fails on the second item's marker.
2. **MD-2 — MD list nesting (S, ~0.5d).** `listDepth` is computed and DOCX-honored; MD emits flush-left.
   Add `'  '.repeat(depth)` indent. Pure jsdom. Cheap, real structural fidelity win.
3. **MD-3 / TX-2 — image presence in MD/TXT (S–M).** DOCX embeds images; MD/TXT silently drop them —
   an image-only PDF exports as an empty `.md`/`.txt` while its `.docx` has the picture. At minimum emit
   a data-URI `![]()` (MD) and `[image]` placeholder (TXT) so content loss is not silent. Pure jsdom.

**Runner-up:** G7 colorMap ±2pt tolerance (S, jsdom, fixes a real but intermittent black-text bug);
G5 heading bold/caps promotion (M, recall improvement). G6 spot-color is now narrow (v6 pre-resolves
most spaces) — lower ROI than the scorecard implied.

**Scorecard hygiene action (not a code fix):** update `scorecard-docx.md` rows 13/21/23/24 to ✅ and
row 26 to ✅-partial — they ship today; leaving them 🟡 understates current fidelity and risks
re-implementing done work.
