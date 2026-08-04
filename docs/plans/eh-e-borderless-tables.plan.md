# EH-E — borderless table detection Plan

Release the one escape hatch in `KNOWN_ISSUES.md` that costs nothing structural: no new dependency, no
WASM payload, no backend. Unlocks **C13** (borderless → CSV) now, with **C9** (borderless → DOCX) as a
deliberately separate follow-on — see the scope ruling below.

## Decisions Log

- [2026-08-04 22:45] AGREED: EH-E is the next feature, after the defect hunt that preceded it found two
  real boundary bugs in exactly this code path (`753c639`). Building on a verified foundation was the
  point of that ordering.
- [2026-08-04 22:50] AGREED: **synthesize pseudo-rules and reuse `buildTableGrid`** rather than build a
  second grid builder. Inferred column/row boundaries become zero-height `RuleRect`s, so cell
  assignment, reading order, the empty-band pruning and every consumer (CSV, DOCX, MD, TXT) are shared
  with the lattice path. One grid shape, one set of semantics, and the boundary fix from `753c639`
  applies automatically.
- [2026-08-04 22:52] AGREED: detect columns as **global whitespace bands** — an x-range that NO text
  item on the page crosses — rather than per-line gap persistence. Simpler, stricter, and it rejects
  prose by construction: prose lines collectively cover the full measure, so no global band survives.
  A row with a spanning cell closes a band and degrades to fewer columns, which is graceful.
- [2026-08-04 22:55] AGREED: the false-positive gate that matters is the **multi-column-page
  discriminator**. A 2-column page layout produces exactly one global whitespace band and would
  otherwise read as a 2-column table. The discriminator: in a real table a single line spans multiple
  column bands, whereas in a multi-column page each line lives in exactly ONE band. So require a
  majority of lines to place text in ≥2 bands. This is the load-bearing rule; without it EH-E would
  turn every two-column article into a table.
- [2026-08-04 23:00] AGREED: **v1 wires the CSV path only (C13), NOT the DOCX path (C9)** — a stated
  scope decision, not a quiet narrowing. The harm profiles are asymmetric: `exportTableCsv` runs only
  when the user has explicitly asked for a table, so a false positive costs them one bad CSV they can
  discard. The DOCX path is different — `reconstructPage` REMOVES in-region words from the paragraph
  flow, so a false positive there silently mangles an ordinary document's prose into a table. C9 gets
  wired once the gate has been exercised against real files; the engine is shared, so it is a wiring
  change plus a stricter threshold, not new work.

- [2026-08-04 23:40] AGREED: shipped for CSV. `MIN_SPANNING_RATIO` proven load-bearing by injection —
  disabling it makes the two-column-page test fail and only that test. Verified end-to-end against real
  pdf.js output, not just synthetic geometry. C13 marked closed in `KNOWN_ISSUES.md`; C9 left open with
  the harm-asymmetry reason recorded on the row itself.

- [2026-08-04 23:55] AGREED: the borderless fallback now reaches a SECOND export surface (XLSX, #56b),
  because both table exports share `ExportService._resolveTableGrid`. The per-path harm reasoning is
  unchanged and still holds — an XLSX export is just as user-invoked as a CSV one — but extending a
  scope ruling is itself a decision, so it is recorded here rather than left implicit in a refactor.

## Formal Plan

### New pure module `src/utils/borderlessTable.ts`

- `lineClusters(items, tol)` → items grouped into text lines by baseline y, top-first.
- `whitespaceBands(items, minGap)` → global uncovered x-ranges, from the union of each item's
  `[x, x + width]` extent. Requires `TableTextItem.width` (optional field, see below).
- `inferBorderlessGrid(items, opts?)` → `TableGrid | null`. Synthesizes row bounds (midpoints between
  adjacent baselines, plus outer margins) and column bounds (band midpoints, plus outer edges), then
  delegates to `buildTableGrid` with a tight tolerance since the synthesized bounds are already exact.
- Confidence gate, every threshold named and justified in code: ≥3 lines, ≥2 columns, minimum band
  width relative to the content measure, and the multi-column-page discriminator above. Refuses by
  returning `null` — never guesses.

### Touch points

- `tableExtract.ts` — add OPTIONAL `width?: number` to `TableTextItem`. Additive; the lattice path
  ignores it, so existing behaviour is byte-identical.
- `exportService._extractPageTableData` — stop dropping `it.width` in the item mapping.
- `exportService.exportTableCsv` — `buildTableGrid(...) ?? inferBorderlessGrid(...)`. Lattice keeps
  priority, so a ruled table's output is unchanged; the fallback only runs where today's answer is
  "no table found".

### Acceptance

- Lattice tables: byte-identical CSV (regression-guarded).
- A borderless table extracts with correct rows/columns.
- **Prose does NOT become a table**, and a two-column page layout does NOT become a table — these are
  the two cases that decide whether the feature is shippable, so both are explicit tests.
- Full deploy gate green, including the live sweep.
