# Sprint 1 — Redaction leak in PDF→DOCX/MD/TXT export

**Verdict: P0 CONFIRMED and FIXED.** Redacted source text leaked into flow exports.

## Root cause
`ExportService._extractFlowDoc()` reads source text via pdf.js `getTextContent()` and
passed it straight to `reconstructPage()`. It never consulted redaction elements, so any
text painted under a redaction box was reconstructed verbatim into the FlowDoc model that
feeds ALL three flow writers (DOCX / Markdown / TXT). The PDF export path rasterizes +
fillRects redactions (`exportPipeline.rasterizePageWithRedactions`); the flow path had no
equivalent — a true data-leak.

## STEP 1 — Reproduce (RED)
New test `tests/utils/flowDocRedaction.test.ts`. Exercises the pure flow layer (jsdom-safe;
no live pdf.js needed — same pattern as the existing `flowDoc.test.ts`).

Pre-fix run:
```
TypeError: isItemRedacted is not a function           (helper absent)
AssertionError: expected 'Public heading text SECRET password is hunter2'
  not to contain 'SECRET'                              (LEAK reproduced)
```
4 failed / 1 passed (the 1 pass is the "no-redaction baseline leaks" control).

## STEP 2 — Fix
`src/utils/flowDoc.ts`:
- `export interface RedactionRect { x,y,width,height }` — editor space, top-left origin.
- `export function isItemRedacted(item, red, pageHeight)` — converts the y-up PDF baseline
  glyph box to top-origin space (`topY = pageHeight - (baseline+size)`), tests AABB overlap.
  Any intersection (partial included) drops the item.
- `reconstructPage(..., redactions?: RedactionRect[])` — 6th optional param; filters items
  via `isItemRedacted` before building words. Backward-compatible (optional).

`src/export/exportService.ts`:
- `_extractFlowDoc` now gathers `elements.filter(type==='redaction' && pageId===docPage.id)`
  → `RedactionRect[]` and passes them to `reconstructPage`. One filter point covers
  DOCX + MD + TXT (shared FlowDoc model).

### Coordinate contract (verified)
- Redaction `el.x/el.y/el.width/el.height` = page-point units, TOP-LEFT origin (confirmed
  by `rasterizePageWithRedactions`: `ctx.fillRect(el.x*SCALE, el.y*SCALE,…)` on a
  viewport-sized canvas; `redactionElement.render` uses the same un-scaled coords).
- pdf.js text item: `transform[4]=x`, `transform[5]=baseline y` (y-up, bottom origin).
- pageHeight passed = `vp.height` (scale-1 viewport), matching element point space.

## STEP 3 — Verify (GREEN)
```
npx vitest run tests/utils/flowDocRedaction.test.ts  → 5 passed, exit 0
npx vitest run tests/utils/flowDoc.test.ts           → 29 passed (regression, optional param safe)
npx oxlint src/utils/flowDoc.ts src/export/exportService.ts → clean (no warnings)
```
The FIX test asserts redacted text ('SECRET','hunter2') is ABSENT while the adjacent
non-redacted line ('Public heading text') survives — proving no over-filtering.

## Files changed
- `src/utils/flowDoc.ts` (RedactionRect, isItemRedacted, reconstructPage param + filter)
- `src/export/exportService.ts` (_extractFlowDoc gathers + passes redactions; import)
- `tests/utils/flowDocRedaction.test.ts` (NEW)

## Notes / scope
- Did NOT touch contentStreamEditor.ts, historyManager.ts, a11y files (out of scope).
- Did not run project-wide tsc/oxlint (parent owns the full gate; parallel agents editing).
- Rotation: redaction rects are filtered in un-rotated page space, consistent with how the
  PDF rasterizer treats them (it also fillRects in canvas space pre-rotation). Rotated-page
  redaction geometry is a pre-existing limitation of BOTH paths, not introduced here.
