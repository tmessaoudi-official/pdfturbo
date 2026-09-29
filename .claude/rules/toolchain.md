---
paths:
  - "package.json"
  - "vite.config.ts"
  - "vitest*.config.ts"
  - ".github/**"
  - "tests/infra/**"
  - "locales/**"
  - "src/utils/i18n.ts"
  - "src/utils/fontkitAdapter.ts"
---

# pdfturbo gotchas — toolchain

Moved verbatim from CLAUDE.md § Gotchas on 2026-09-28 (review-remediation 5.3, /rules-split). Scope: dependencies and upgrades, vitest, CI flakiness, i18n, the PWA, the Claude bundle. These entries are this project's decision register (the design docs they came from were removed in `ac4ef68`). New entries for this area go HERE, not into CLAUDE.md. A § "…" reference names a heading in CLAUDE.md or in another `.claude/rules/` file — CLAUDE.md § Gotchas lists every moved heading; a § that names a bold paragraph (e.g. "MD/TXT parity") or paraphrases a heading resolves by grepping the phrase in `.claude/rules/`.

### A raised `testTimeout` does not raise `hookTimeout` — it blocked a push (2026-08-22)

`vitest.config.ts` raised `testTimeout` to 30s (`a214076`) because node-forge RSA-2048 keygen is slow
under full-suite CPU contention. `hookTimeout` was left at vitest's **10s default**, so a `beforeAll`
running that *identical* keygen got one third of the budget of a test running it. Three signing hooks
were patched individually with `}, 60_000)`; the fourth (`incrementalSigner.test.ts:106`) was missed
and eventually failed a real pre-push run — `Hook timed out in 10000ms` — **blocking the push**.

**It is contention, not a hang, and that is measured**: the failing hook's exact workload (keygen +
`loadP12`) runs in **242–466ms idle** and **564–2297ms under 8-way CPU saturation** on this machine.
So the operation was never close to broken; only the budget was. Re-measure rather than citing those
figures — they are one machine on one day.

**The fix is the config, not a fourth argument** (`hookTimeout: 60_000`, the value the three sibling
sites independently converged on). Patching the fourth site would have left the next hook someone
writes on the same 10s cliff. The three explicit `60_000` args are now redundant and deliberately
kept as local documentation.

**Two things worth carrying forward.** First, this is the global framework's "full-set coverage" trap
(Phase 6's semantic checklist — it has no section in this file) in its purest form — three of four members fixed one at a time, and the miss surfaced only when the unlucky one hit
a loaded machine. When a per-site workaround appears three times, the workaround is the bug report:
fix the origin. Second, `tests/infra/vitestTimeouts.test.ts` asserts the **effective config value**,
not the file text — a text regex would accept a present-but-too-small `hookTimeout`, which sabotage
confirmed (5s → the guard goes red on both assertions; absent → red as well).

### vitest 5 leaks its root module cache into /tmp on every run — `globalSetup` removes it (2026-09-28)

Every `vitest run` left `/tmp/<nanoid>/{client,ssr}/<sha1>` (23 MB, 842 files per full suite; 375 dirs
after one day of pushes). Vitest keeps two fetcher caches: each project's `tmpDir`, removed by
`TestProject.close()`, and the root `Vitest._tmpDir`, removed by nothing (5.0.0 and 5.0.2). The
`globalSetup` `tests/vitestTmpCleanup.ts` removes it at run end. It reads that `@internal` field, so it
checks it at SETUP and stops the run if a vitest upgrade reshapes it: re-check then whether vitest
cleans up itself, and if so delete the file and its `globalSetup` line. `vitest.browser.config.ts` does
not need it: a full `npm run test:browser` left 0 such dirs (measured 2026-09-28).

### `jsdom` is held at 30.0.x — vitest 5.0.2's Blob shim cannot read 30.1's Blob (2026-09-29)

The 2026-09-29 upgrade-to-latest took every dependency to its newest release except this one, and the reason is
measured. With `jsdom` 30.1.1 under `vitest` 5.0.2, `URL.createObjectURL(new Blob([…]))` throws
`Cannot read properties of undefined (reading '_bytes')` — 3 cases in `tests/utils/codeGenerator.test.ts`,
deterministic in isolation, not load. vitest replaces `URL.createObjectURL` with a shim (`createJSDOMCompatURL`,
`node_modules/vitest/dist/chunks/index.*.js`) that finds jsdom's hidden implementation object as
`Object.getOwnPropertySymbols(Object.getOwnPropertyDescriptors(new window.Blob()))[0]` and reads `impl._bytes`. A real
30.1.1 Blob has **no own symbols** (`[]`), so the lookup is `undefined` and the read throws. vitest 5.0.2 is the
latest release, so nothing upstream fixes it yet.

`package.json` therefore has `"jsdom": "~30.0.1"` (patch-only, so a fresh install cannot float to 30.1) and the
`overrides` block gained `"undici": "^8.11.2"`: jsdom 30.0.1 pulls `undici@8.10.0`, inside the advisory range
GHSA-3wwx-pv8p-q78v (8.1.0–8.10.1); jsdom 30.1.1 had cleared it by bumping `undici` to `^8.10.2`, and the override does
the same without the jsdom bump. jsdom 30.0.1 declares `undici ^8.9.0`, so 8.11.2 stays inside its own range. Both are
devDependency-only. **Remove both when a vitest release reads jsdom 30.1's Blob:** bump `jsdom` to `^30.1.x`, drop the
override, and the `codeGenerator` cases are the check (they fail on the first `createObjectURL`). Do not stub
`URL.createObjectURL` in the test to make it pass — that hides the harness break for every future caller.

### The 2026-09-13 upgrade to latest — three traps, each measured before it was fixed

Every dependency went to its latest release on 2026-09-13 (vitest 5.0.0 and its four `@vitest/*`
packages, `@cantoo/pdf-lib` 2.11.0, pdfjs-dist 6.3.289, vite 8.3.0, oxlint 1.82.0, playwright 1.63.0;
CI `setup-node@v7`, `upload-artifact@v7`). Three things broke in the harness, none of them in `src/` — and
WS7 round 10 then found two that DID reach users (the last two bullets):

- **Run the local gate on the CI Node, never the shell's `node`.** CI pins **Node 26** since the
  2026-09-24 developer ruling (`deploy.yml`, `.nvmrc`, `engines` — Node 24 before that, and every WS7
  round record through round 17 was gated on 24). `tests/infra/prePushHook.test.ts` fails if
  `deploy.yml` drifts from `.nvmrc`. On Node 25+ Node defines its OWN `localStorage` global, which is `undefined` without
  `--localstorage-file`, and under vitest 4 it shadowed jsdom's — so the three crop kill-switch cases in
  `tests/core/pageRenderPipeline.test.ts` failed with `Cannot read properties of undefined (reading
  'removeItem')` on Node 26 and on the v27 nightly `/stack` put on `PATH`, and passed on Node 24. vitest 5
  fixes that shadowing (the same files pass on Node 26), but the rule stands: prefix
  `PATH=/stack/tools/nvm/versions/node/v26.<x>/bin:$PATH` for every gate step (the `.nvmrc` line), or a red is about the
  machine, not the product.
- **`@cantoo/pdf-lib` 2.11.0 is not valid Node ESM.** Its ES build does
  `import X from './Courier-Bold.compressed.json'` with no `with { type: 'json' }`, so an externalized
  import dies with `needs an import attribute of "type: json"` — 48 jsdom files went red. (This bullet
  split them 37 at collection and 11 downstream; the failing run's log was not kept, so the split is
  withdrawn [WS7 round 10].) The browser bundle is unaffected (Vite handles JSON), so
  `vitest.config.ts` set `server.deps.inline: ['@cantoo/pdf-lib']` [removed 2026-09-29: 2.11.1 ships the attribute and the full jsdom suite passes without it — 3304 tests]. **`deps.optimizer.client` looks
  like the faster fix and is not one**: its pre-bundle resolves fflate's `node` export condition
  (`esm/index.mjs` opens with `createRequire`) and throws `createRequire is not a function` at import.
  The cost of inlining is a cold transform per worker — enough to push the DOCX editor's lazy
  `import('./docxToPdf')` past `vi.waitFor`'s 1 s (a 13089 ms figure quoted here is in no retained log)
  — so a test that waits on a lazy pdf-lib import must warm it in a hook
  (`tests/docx/docxEditorController.test.ts`); left cold it timed out inside `vi.waitFor`'s 1 s,
  skipped its `destroy()`, and every later case in the file queried the stale modal. **2.9.2 has no JSON
  imports**, which is the fallback if inlining ever stops working.
- **Nine base64 PNG fixtures were broken, only a strict decoder noticed — and they hid a PRODUCT regression.**
  Eight had a truncated zlib stream (zlib error -5) and `docx-to-pdf.browser.test.ts`'s had a bad CRC
  (-3). pdf-lib 2.11.0 swapped pako for fflate, whose inflate rejects them where pako did not; Chrome's
  `decode()` recovers three of the four distinct truncated images (the 1×1 ones — the 2×2 RGB one fails
  there too). Each fixture is now a generated PNG of the same size and colour type. **This bullet first
  called the lost image "correct product behaviour, wrong fixture", and WS7 round 10 refuted it**: a PNG a
  user can SEE in the browser stopped embedding, so DOCX→PDF dropped it silently (`drawImage`'s
  `catch { return; }`) and opening it as a document failed with `toast.imageConversionFailed`. Fixed by
  `src/utils/pngEmbed.ts` `embedPngTolerant` — pdf-lib first, so every PNG that embedded is byte-identical,
  then a browser `decode()` + canvas re-encode, gated on `HTMLImageElement.prototype.decode` so jsdom
  rethrows instead of waiting on image events that never fire — and DOCX→PDF now COUNTS what it still
  cannot embed (`skippedImages` → `docxEditor.pdfImagesSkipped`). Guards:
  `tests/browser/png-embed-tolerant.browser.test.ts` (7) + the skip cases in `tests/docx/docxToPdf.test.ts`
  and `docxEditorController.test.ts`. **Validate a hand-pasted binary fixture with a strict decoder, and
  when a stricter dependency rejects one, ask what the same bytes do in a user's file.**
- **pdf-lib 2.11.0 silently DROPS an object it cannot parse when no `endobj` follows before EOF** — 2.8.1
  threw `Failed to parse invalid PDF object` on the same bytes. pdf.js still renders the page, so the loss
  shows only in exports: measured, a page whose content stream was that object exported EMPTY. **A check
  after a default load cannot see it**: `updateMetadata: true` registers a new `/Info` dict under the next
  free object number, which after a drop IS the dropped number, so `/Contents 5 0 R` resolves to the Info
  dict and nothing dangles. `src/utils/pdfLoadGuard.ts` `loadPdfDocument` loads without the stamp, refuses
  (`PdfObjectDroppedError`) when an object pdf-lib DROPPED is reachable from the trailer and nothing later
  replaced it, then applies pdf-lib's own `updateInfoDict()`. **The drops are recorded inside pdf-lib's
  parser, never found by reading the file.** `installDropRecorder` wraps the only two places pdf-lib drops
  an object — `PDFParser.tryToParseInvalidIndirectObject` returning nothing, and
  `PDFObjectStreamParser.parseIntoContext` throwing part-way, which loses every member not yet assigned —
  returns what they return, rethrows what they throw, and throws itself if a pdf-lib release renames one.
  Rounds 10 and 11 scanned the text for `N G obj` headers instead, and WS7 round 12 found that scan wrong
  six ways: a stream with no `endstream`, a header glued to `endobj` / `>>` / `]` / `)`, `>> stream` inside
  a string, a comment between header tokens, object-stream members (which have no header), and a string
  reading ` 9 0 obj `. The first five made it ACCEPT a file pdf-lib had dropped from; round 11 had added the
  stream skip and the boundary rule that caused three of them. **Each was a second tokenizer disagreeing
  with pdf-lib's — do not bring a text scan back.** **Supersede is decided by assignment ORDER, never by
  value** (WS7 round 13): round 12 kept what each reference resolved to at the drop and compared it at the
  end, and that refused a legal file — pdf-lib interns `null`, booleans and names, so an older revision and
  its replacement can be the very same object. Each drop now carries the parser's assignment clock, and it
  is superseded only when pdf-lib assigned that object again AFTER it (an object-stream member takes the
  clock of the member TABLE, not of the throw). A dropped NEWEST revision with an older one standing in
  still refuses. **A reachable damaged object refuses any standing drop** (round 13): pdf-lib keeps a
  terminated but unparseable object as a `PDFInvalidObject`, whose references cannot be read, so a drop
  reachable only through it was invisible to the walk and the file loaded — measured, the dropped page
  content exported empty.
  **The second half is `PdfXrefMismatchError`** (round 13): pdf-lib keeps the LAST definition of an object
  and the LAST trailer; pdf.js follows `startxref` and the xref chain. Measured in pdf.js 6.3.289 before
  writing it: first-wins per section, a table's `/XRefStm` queued before `/Prev`, offsets relative to the
  first `%PDF-` in the first 1024 bytes, and a rebuild by scanning that keeps the last definition, exactly
  like pdf-lib (when it happens — round 16, below) — EXCEPT when two copies differ in generation, where it
  keeps the first (closing audit, 2026-09-24). So a file whose table points at an EARLIER copy showed
  one page and exported or SIGNED another with nothing dropped (probe: pdf.js read VIEWED, pdf-lib SIGNED).
  The recorder also keeps each definition's offset and the xref sections pdf-lib parses and then discards;
  a reachable object refuses when the chain lands on a definition pdf-lib did not keep and the VALUES differ
  — serialized bytes, because round 14 found identity refusing two byte-identical copies of a stream — and a
  `/Root` the startxref trailer names differently from the kept one refuses too. **Round 14 added two
  shapes**, each measured in pdf.js first. An entry that is absent, free or at offset 0 makes `XRef.getEntry`
  return null, so a page whose content is marked free draws BLANK while pdf-lib exports the content: that
  refuses when the document ROOT reaches the object (not only /Info, which pdf-lib merges across trailers)
  and pdf-lib holds a non-null value, on every file whose chain pdf.js reads, not only revised ones. And
  pdf-lib's `maybeRecoverRoot` swaps a /Root lacking `/Type /Catalog` for another catalog pdf.js never shows,
  which refuses whenever pdf.js would accept the declared root, one trailer or many. A table subsection
  numbered from 1 over the free object-0 row is renumbered from 0, as pdf.js does. Nothing is compared when
  the chain's root is one pdf.js rejects (not a dictionary whose /Pages is a dictionary): pdf.js then
  rebuilds by scanning and agrees with pdf-lib. **Round 16 found two more, each measured first.** pdf.js reads
  each queued section inside a try/catch (`XRef.readXRef`), so a `/Prev` or `/XRefStm` it cannot read — into an
  object, past EOF, at a content stream, at a table with no trailer, at a stream it rejects part-way (keeping the
  rows read before the failure) — is skipped and the queue goes on; the chain was abandoned there instead, leaving the
  round-13 shape uncompared behind one bad pointer. And an entry that does not land on its object makes pdf.js
  THROW, and it rebuilds only when that happens on its opening walk to the first or last page (`checkFirstPage` /
  `checkLastPage`, now mirrored with the `/Count` skip and the `getAllPageDicts` fallback): anywhere else the page
  draws blank or fails while pdf-lib exports and signs it, so such an object refuses like one pdf.js finds nothing
  for. Round 13's "a wrong table offset rebuilds" had been measured on a file whose offsets were ALL wrong, where
  the first-page walk meets one — **measure the shape you generalise to, not the one you had.** One existing
  fixture was that shape: `buildContentStreamPdf({ padStreamBytes })` wrote its table in file order, pointing
  `5 0 R` at object 6, which pdf.js draws blank (measured); it now writes rows by object number.
  **Round 17 found that "the queue goes on" was not true either, and a gap no cross-reference table shows**, each
  measured in pdf.js first. A table pdf.js cannot finish — no trailer, a trailer that is not a dictionary, or object 0
  in use once its rows are in — leaves `XRef._tableState` behind, so every LATER table in the queue restores it,
  fails the same way and reads no rows. The guard read them, so content named only behind such a table compared as
  shown while pdf.js drew the page blank. A stream ignores that state, but `streamState` does the same between
  streams, and a stream read after a rejected one refuses rather than being modelled. `/Prev` and `/XRefStm` written
  as references are resolved through the rows read so far, as `Dict.get` does (the guard used to refuse a file both
  readers agree on). A linearized file is read from the section after its first object (`PDFDocument.startXRef`),
  with its first page and count from the linearization dictionary. And a third refusal, `PdfPageMismatchError`:
  `Catalog.getPageDict` skips a subtree by its `/Count` and counts any dictionary without `/Kids` as a page, while
  pdf-lib's `PDFPageTree.traverse` ignores `/Count` and keeps only `/Type /Page` leaves, so a `/Count` lie in an
  ordinary tree showed one page and exported or signed another. Each index pdf.js shows is compared with the page
  pdf-lib holds there; fewer pages loads, a different or extra one refuses. **"Costs that section only" had been
  stated as measured on nine surfaces; it held only when no table followed the unfinished one** — a rule measured on
  the last section of a queue says nothing about the sections after it.
  **The closing audit (2026-09-24) ENDED the mirror's review rounds** (developer ruling "disclose and close"): a
  branch-by-branch comparison with pdf.js 6.3.289 measured ten more crafted shapes that get past the guard — one
  cause, the mirror re-reads cross-reference bytes on pdf-lib's parse, so any bytes the two tokenize differently
  slip through — and they are ONE disclosed bound in `SECURITY.md` / `KNOWN_ISSUES.md`, not ten fixes. **Do not
  start a round 18 on the mirror**; closing the class means running pdf.js and comparing what it shows per page.
  Its one false refusal (a table whose declared row count is wrong, which pdf.js rebuilds past) is fixed by
  `viewerTableRows`.
  **WS8 (2026-09-24) DID exactly that, and the mirror is DELETED** — everything in this bullet about xref chains,
  page walks, `describeParse`, predictors and `PdfXrefMismatchError` describes code that no longer exists and is kept
  as history. `loadPdfDocument` now takes a REQUIRED `viewerCheck: 'source' | false`; `'source'` runs
  `src/utils/viewerCheck.ts` — pdf.js on the original and on pdf-lib's pages copied into a FRESH document (a plain
  `save()` keeps the quirks, so pdf.js re-reads it identically and a mismatch compares equal), per-page text
  (str + origin), operator fingerprint and a hash of numeric operands and `#rrggbb` colours (other strings are
  per-document ids and are skipped) taken with annotations DISABLED (drawn, 7 of 8 real forms mismatched on
  widgets), plus — since limits row 13 — a hash of each painted image XObject's DECODED pixels (an image reaches the
  operator list only as id + size, so a same-size swap compared equal; `buildDupImagePdf`). In a browser the
  hash reduces pdf.js's `ImageBitmap` to 64×64 with `createImageBitmap` (async — 36 ms worst main-thread step on
  gpt3's 19 MP scans); without a bitmap (Node/jsdom) it samples the raw `data`, so the two branches are pinned
  separately (sabotaging the bitmap branch reds only the Chrome case). Hashed BEFORE `page.cleanup()`, which frees
  the images. Cost: +3.4 s per pass on gpt3, mostly waiting on pdf.js's image transfer — and refuses with `PdfPageMismatchError(['page N', …])`. pdf.js showing FEWER pages is allowed. The
  verdict is cached by BYTES IDENTITY (`viewerVerdict.ts`), prewarmed wherever `addSourcePdf` runs and inherited by a
  true edit's bytes, because the pass costs 8–13 s wall-clock on a 67–142-page report (measured in Chrome; main-thread
  long tasks ≤ 115 ms). A copy of a source's bytes (`.slice(0)`) misses the cache and re-runs it. `false` is for bytes
  pdf-lib wrote in the same operation; which sites pass which is pinned by name in `pdfLoadGuard.test.ts`.
  **Since limits row 14 `loadPdfDocument` also raises `largestObjectNumber` past every REFERENCED number**
  (`reserveReferencedNumbers`): pdf-lib numbers new objects from the largest DEFINED one, so the `/Info` stamp or a
  true edit's font took a legal dangling number and the reference resolved to it — measured, a dangling page font
  became the Info dict and pdf.js dropped its text from the export. The viewer check could not see it: it runs
  BEFORE the stamp. 0 of 104 corpus files change (3 dangle, all below their largest number). The ten
  audit shapes are tracked in `tests/fixtures/ws8-audit/`: nine refuse with `PdfPageMismatchError`, and P6 does not
  load at all — pdf.js itself throws `InvalidPDFException` on it, so the check rejects. `viewerVerdict` sets the pdf.js worker
  itself in a real browser: relying on `infra/pdfRenderer.ts` having been imported first failed every guarded load
  in the browser suite. The same step found that `copyPages` never copies `/OCProperties`, so a layer the source
  switches OFF came out visible — every page copy now goes through `src/export/copySourcePages.ts`, which copies the
  pages and the layer settings with ONE `PDFObjectCopier` (a second copier duplicates the groups and viewers match
  them by reference). See `SECURITY.md` / `KNOWN_ISSUES.md` for what the check does not compare.
  **A test that `vi.mock`s `pdfjs-dist` and reaches a `'source'` load must also mock `../../src/utils/viewerVerdict`
  with a clean verdict** — otherwise the check runs on the stub and the export reports a failure that is not a
  product bug (`No "GlobalWorkerOptions" export`); `tests/export/imageExportOptions.test.ts` is the shape.
  **A resolved chain is not a compared chain.** Round 13
  recorded "14 of 15 real files reached the comparison". Measuring round 14's fixes showed pdf-lib inflates a
  cross-reference STREAM but never applies its `/DecodeParms /Predictor`, which Acrobat and most producers
  set: 11 of the 15 files use one, 10 of them were among the 14 counted, and their recorded entries were
  noise that landed on nothing. The claim was vacuous for those 10, and under round 14's nothing-for rule
  the noise was one garbage `/Root` entry away from refusing real files. The recorder now decodes xref-stream
  entries itself with `PredictorStream` / `readXRefStream` semantics (PNG predictors 10–15 with all five row
  filters, TIFF 2 at 8 bits, entry types 0–2), and both corpus halves assert that every in-use chain entry at
  a file offset lands on a definition pdf-lib parsed there. Bounds, all in `KNOWN_ISSUES.md` / `SECURITY.md`:
  no comparison through an xref stream whose filters are not modelled (one pdf.js rejects part-way is skipped
  with the rows it read, as pdf.js does), for entries inside
  an object stream, or for pdf.js's trailer choice in recovery mode; pages are not compared when pdf-lib cannot
  list them, and pages written directly in `/Kids` only by position.
  **Measured on 15 real
  files** (`LOAD_GUARD_CORPUS=1 npx vitest run tests/utils/pdfLoadGuardCorpus.test.ts`, report in
  `var/claude/ws7/load-guard-corpus.json`): guard outcome equals raw pdf-lib on 15 of 15, all 15 read through
  the chain pdf.js follows, and 12,059 of 12,059 in-use chain entries landing on a parsed
  definition — so zero false refusals is a measurement, not an absence of input. Re-run after round 16's fix:
  unchanged, 15 of 15 and 12,059 of 12,059. Re-run after round 17's: unchanged again.
  Found while re-running it: the recorder installs on the first `loadPdfDocument`, so a run filtered with `-t`
  measured its first file before anything was recorded and reported it unread by pdf.js; `describeParse` now
  throws on a parse with no record, and the corpus file installs the recorder first. Load time in ONE run at load
  19.1: Publication 17 11433 ms raw vs 19272 ms guarded, the census report 5291 vs
  12016, and no other file more than 505 ms slower. Round 14's
  completeness lens measured guarded/raw ratios from 1.0x to 3.5x between two runs on a loaded machine, so
  this is one observation, not a spread claim. The tracked 5-file public corpus, with the same landing
  assertion, runs on every jsdom pass.
  Sabotage, re-measured after round 14 on `tests/utils/pdfLoadGuard.test.ts`, `exportPasswordSave`,
  `exportSaveRouting`, `pdfSanitizerInvalidObject` and the corpus file together (124 cases, the gated corpus
  case skipped), each mutation landed and restored byte-identical: `S1` damaged object walked as readable → 2;
  `S2` standing drop behind damaged object ignored → 1; `S3` membersUnknown ignores damaged objects → 1; `S4`
  objstm drop clock taken at the throw → 2; `S5` supersede ignored → 7; `S6` per-object comparison never
  refuses → 8; `S7` startxref Root comparison never refuses → 1; `S8` header offset ignored → 2; `S9` oldest
  xref section wins → 2 (1 guard, 1 corpus); `S10` identical copies refuse → 24 (23 guard, 1 corpus); `S11`
  unreachable duplicates compared → 1; `S12` entry offset compared exactly → 1; `S13` comparison needs
  something pdf.js finds nothing for → 9; `S14` trailer dict not attached to its table → 12; `S15` assignments
  not counted while parsing → 17; `R1` classic drop never recorded → 18 (17 guard, 1 exportSaveRouting); `R2`
  object-stream throw records nothing → 3; `R3` constructor failure not flagged → 2; `R4` reachability skipped
  → 4; `T1` nothing-for rule off → 5; `T2` fromRoot scope dropped → 1; `T3` PDFNull exemption dropped → 1;
  `T4` acceptsAsRoot always true → 2; `T5` recoveredFrom never recorded → 2; `T6` sameValue by identity → 3;
  `T7` table shift not mirrored → 1; `T8` heldAsNothing never true → 3; `P1` predictor never applied → 4; `P2`
  PNG Sub and Up swapped → 2; `P4` PNG Average ignores left → 2; `P5` TIFF predictor not applied → 1; `P6`
  entry type 3 accepted → 1; `P7` unsupported predictor passed through → 1; `P8` pdf-lib entries recorded
  (pre-fix wrapper) → 5. The gated 15-file corpus also ran for `S10`, `S11`, `S12`, `T2`, `T3`, `T4`, `T6`,
  `T7`, `P1`, `P8`, and went red for `S10`, `P1`, `P8`. Not pinned, each for a stated reason: `P3` Paeth
  tie-break reordered (its tie-break differs from pdf.js only when pa ≤ pb ≤ pc and left ≠ up, a shape the
  type, offset and generation bytes of a cross-reference row never produce here; the branch is pdf.js's line
  for line); `P9` abbreviated /F /DP guard dropped (no fixture carries the abbreviated /F or /DP keys, and
  with them pdf-lib hands over still-compressed bytes that the entry-type check already rejects, so the skip
  is a documented bound rather than a tested one). (`T8`'s `heldAsNothing` is `heldDifferently` since round 16.)
  Round 16's eleven, on the same five files (155 cases), each landed and restored with `cmp`: `S1` a section
  pdf-lib did not parse abandons the chain → 4; `S2` an unmodelled stream skipped like a missing one → 1; `S3` an
  unreadable entry skipped in the comparison → 6; `S4` the load-walk mirror removed → 4; `S5` a rejected stream's
  rows dropped → 1; `S6` `/XRefStm` followed from a stream → 1; `S7` the compare trigger back to nothing-only → 6;
  `S9` a rejected section still yielding a trailer and `/Prev` → 2; `S10` the `getAllPageDicts` fallback removed
  → 1; `S11` the first-page walk removed → 1. `S5`, `S6` and `S10` stayed green until a shape was measured in
  pdf.js and pinned for each. `S8`, the `/Count` cache not shared between the walks, stays green and is
  equivalent: a node is cached only after it was read, so no answer changes.
  **Scope a sabotage figure by the files it ran against.**
  `tests/browser/pdf-load-guard.browser.test.ts` runs the refusals — drops, the parse differential and a
  predictor-compressed cross-reference stream — in the Vite bundle, where a second copy of
  pdf-lib would leave the jsdom suite green and every browser load unguarded. **Every pdf-lib load in `src/`
  goes through it**; `tests/utils/pdfLoadGuard.test.ts` fails by file name on a direct `PDFDocument.load`.
  **A refusal is its own message, `toast.pdfLoadRefused`** (WS7 round 15): each caller used to show its generic
  failure, and OCR and signing said "please try again" to a refusal that repeats on every attempt.
  `isPdfLoadRefusal` is asked first in the seven `exportService` save catches, `runOcr` and the sign modal, and
  follows `cause`, because the signer wraps a load failure in `SignError('PDF_PARSE_FAILED')`. Guards:
  `tests/utils/pdfLoadRefusal.test.ts` (5), the refusal block in `tests/export/exportSaveRouting.test.ts`,
  `tests/handlers/signingContext.test.ts` and `tests/core/ocrRefusalToast.test.ts`. Sabotage on those four
  files: the export key always the fallback → 8; `cause` not followed → 3; the sign branch dropped → 3; the OCR
  branch dropped → 1; any error counted as a refusal → 6, all of them controls. The Word/Markdown/text, table,
  XFDF and OCR-text exports read through pdf.js and never reach the guard, so they do not refuse.
  Bounds: bytes pdf-lib never parses as an object (skipped as junk, or swallowed by a stream whose end it
  places too late) are not a drop and are not detected; when an object stream fails before its member list
  is known, any reachable dangling or damaged reference refuses the file; and a legal dangling reference
  nothing was dropped for is still left for pdf-lib's stamp to reuse. Found while preparing the round-10
  fixes, not by a lens — the first probe used a WELL-FORMED unterminated object, which pdf-lib has always
  tolerated, and read clean.

### `@cantoo/pdf-lib` 2.8.1 broke custom-font subsetting — adapt fontkit, don't pin back (2026-08-07)

A lockfile-only bump (`^2.7.1` allowed 2.7.4 → **2.8.1**) turned CI red: **13 tests across 6 files**, every
one of them a custom-font embed, all dying identically:

```
TypeError: Cannot read properties of undefined (reading 'pos')
  |- Struct.encode                            @pdf-lib/fontkit
  |- TTFSubset.encode                         @pdf-lib/fontkit
  |- CustomFontSubsetEmbedder.serializeFont   @cantoo/pdf-lib
```

**Bisected, not guessed: 2.8.0 passes, 2.8.1 fails, nothing else changed.** 2.8.1 added feature-detection
to `serializeFont` — *"Upstream fontkit v2+ exposes sync `encode()`; @pdf-lib/fontkit uses Node-style
`encodeStream()`"* — and takes the `encode()` branch whenever the method merely EXISTS. `@pdf-lib/fontkit`
v1's subset does have an `encode`: restructure's low-level **`Struct.encode(stream)`**, which needs a
stream. Called bare it dereferences `undefined`.

**The discriminator is ARITY, not presence** — fontkit v2's sync `encode()` takes 0 args, v1's takes 1. So
`src/utils/fontkitAdapter.ts` wraps the registered module and hides `encode` only when
`encode.length > 0`, forcing the `encodeStream()` path v1 actually implements. Nothing is monkey-patched;
the real objects are untouched behind a `Proxy`. It self-obsoletes safely in both directions: if pdf-lib
fixes the detection the wrapper is inert, and on a real fontkit v2 it stops hiding anything.

**Rejected: `subset: false`.** That embeds the whole ~250 KB Noto Naskh Arabic face in every Arabic
export instead of the few glyphs used — a permanent size regression to dodge a transient upstream bug.
Also rejected: pinning back to 2.7.4/2.8.0 (developer ruling — keep the dependency current).

**EVERY `registerFontkit` must go through `adaptFontkit`.** Production has exactly one site
(`arabicOverlay.getArabicFont`), but three browser fixtures register fontkit themselves to build
subset-font PDFs, and they stayed red until routed through the adapter too — which is also what keeps a
fixture faithful to the real embed path. `grep -rn registerFontkit src/ tests/` is the check.

**The transferable part:** a dependency's *minor* bump inside a caret range can break a path no test of
ours touches directly, and the failure surfaced 500 lines deep in two vendored libraries. What identified
it in minutes was bisecting the single changed version with `npm i --no-save` and re-running ONE failing
file — not reading the stack trace harder. Note the whole diff was `package-lock.json`; `package.json`
never changed, so nothing in the repo's own history hints at it.

### The Claude bundle is a CROSS-REPO artefact — align it, don't fork it (2026-08-06)

> **[Re-checked 2026-09-28]** **superseded** — container-era history. `install.sh`, `CLAUDE-global.md`, `test-install.sh` and the repo's own `/converge` / `/cross-check` copies were removed on 2026-08-18 (`3bb130b`, `b139d7d`); § "Claude config in this repo" is current. The present-tense sentences below describe that removed setup. Candidate for deletion with the developer.

Five repos share this bundle (`phorj` 07-23 → **pdfturbo** 07-28 → `twes-in` 08-02 → `stack` 08-06 →
`rent-watch` 08-06). The *file set* is identical in all five; every difference is content, and each repo
tailors the prose to its own invariants. **pdfturbo was second-oldest, so it had missed four rounds of
convention evolution.** Unified against `rent-watch` (newest) — seven items. What the exercise taught:

**1. A ported test is worth more than a ported doc, because it can fail.** `test-precompact-handoff.sh`
was missing here. Porting and running it immediately failed **5 of 35** assertions — this repo's
`precompact-handoff.sh` had no `<!-- manual -->` guard, so it would **clobber a handoff a human wrote**.
That is a live data-loss bug nobody would have found by reading. The newer 223-line hook was ported too
and the suite was 35/35. **The hook and its PreCompact registration are both GONE (2026-08-18)** — the
global-is-reference ruling removed every repo copy of something `~/.claude/` already owns, and handoffs
are the global PreCompact hook's job now [Verified 2026-08-19: `jq '.hooks | keys'` → `["PostToolUse"]`;
no `precompact-handoff.sh` under `.claude/hooks/`]. The lesson survives its subject: a ported test can
fail, and this one did.

**2. Env-var renames are the trap in a cross-repo port.** The test set `RENTWATCH_HANDOFF_DIR` while this
repo's hook reads `PDFTURBO_HANDOFF_DIR`. Left alone it would have exercised a default path and passed
while proving nothing — a green test that tests the wrong thing. Three vars needed remapping
(`_HANDOFF_DIR`, `_HANDOFF_LLM`, `_HANDOFF_MODEL`). **Grep the ported file for the OTHER repo's name
before running it, and don't trust a "clean" grep you printed unconditionally** — mine reported "portable
as-is" while the grep above it had found two hits.

**3. Two contradictory defaults in `/converge`.** Both `CERTIFY == reviewer` and `CERTIFY == self` were
labelled *(default)*. That is how a session talks itself into self-grading the work it just produced —
the exact blind spot the ladder exists to close, in the repo's highest-traffic skill. `self` is now
labelled a last-resort fallback requiring disclosure.

**4. The bundle documented machinery that does not exist, and believing it would silence gates.** The
autonomous-mode section described sentinels under `~/.claude/run/` and `~/.claude/state/`, a statusline
indicator, an `ask` permission tier and a bash firewall. **None exist here** [Verified 2026-08-06: both
dirs absent; `settings.json` keys are exactly `permissions`, `hooks`]. Replaced with the container-true
version, plus two dependent passages nobody had noticed — an "Active-plan statusline pointer" block and a
Phase 8 `rm -f` of a pointer that is never created. The § "Plans live in the repo" already said there is
no such pointer, so the bundle had been contradicting the project file.

**5. Two harness-vs-developer conflicts were unruled, and a session had to resolve them live.** The
container's harness prompt instructs a `Claude-Session` trailer and a `claude/<name>` designated branch.
The project rule said only "no `Co-Authored-By`" and never named the branch, so a session had to reason
from first principles (it omitted the trailers and pushed to `master` — correct). Both are now ruled
explicitly in `CLAUDE.md` § Git autonomy AND in the bundle's Rule 10. **Name the thing the harness names**;
a rule that covers the neighbouring case leaves the session guessing.

**6. `/cross-check --drift` is the tool this repo most needed and did not have.** Present in three of the
four siblings. Its `--drift` mode compares a doc against reality — and the 2026-08-05 session alone
produced five doc-vs-reality drifts (C10 false in two places, a `globalAlpha` mechanism absent from
`src/`, "every row is test-pinned" when 3 of 9 were not, an invented Type3 font gate, and a "four
surfaces" count contradicting its own five-row table). **Its example table had to be fully retargeted** —
inherited rows told the reader to query `config/sources.yaml` and `tests/fixtures/tenure/`, neither of
which exists here. A drift detector that names non-existent commands is worse than none.

**7. `completeness-reviewer` gained "do not invent a subject".** Adapted, not copied — rent-watch's
version is greenfield-specific. It exists because a review asserted a Type3 font gate on `deleteTextAt`
that lives only in `replaceTextAt`; a toast, a test and a `SECURITY.md` caveat were built for it before a
later round refuted all three. It also codifies verifying a NEGATIVE with a control, after a byte scan
read a pdf.js-detached buffer and laundered a live leak into a non-finding.

**The habit worth keeping: diff the bundle against the newest sibling whenever one of them is touched.**
Every file differed, so "the files are all there" proves nothing — compare headings and counts, then read
the deltas. Four of these seven were things actively wrong here, not features missing.

**ROUND 2 (same day, after the developer updated all four siblings). Nine more items — and the two most
useful were things round 1 got wrong or missed, which is why "we already swept" is not a reason to skip a
second pass.**

- **A real bug, from phorj: `log_obs` wrote to `~/.claude/logs/`**, wiped when the container is reclaimed,
  so every line a hook logged in a real session went where nobody could read it. Rule 13 satisfied on
  paper, useless in practice. Now `var/claude/logs/` in the repo. **And Rule 13 itself still mandated the
  dead-end path** — the code moved and the rule that requires it did not, so the file contradicted itself
  319 lines apart with both halves live in `~/.claude/CLAUDE.md`. Three of four siblings had already
  rewritten that rule; pdfturbo was the last. **When you change where something writes, grep for the rule
  that told it to write there.**
- **`install.sh` now copies UNCONDITIONALLY** (developer ruling: the repo is always the truth). `cp -u` was
  wrong in both directions, and its own header claimed the opposite — see § "Claude config in this repo".
  This **superseded a THINKING.md rule round 1 had ported hours earlier**, and made a *different* line
  actively harmful: `CLAUDE-global.md` still said "edit `~/.claude/THINKING.md`", which under unconditional
  copy is destroyed at the next SessionStart rather than merely diverging.
- **Round 1's absent-machinery sweep was NOT complete**, though its entry above reads as if it were. Three
  more instances surfaced: `§ Memory System Toggles` (a `session-remember` pipeline), `BLAST-RADIUS.md`'s
  registry section AND its state-sentinel paragraph (an `ask` tier and a bash firewall). Worse, the
  framework asserted `~/.claude/skills/` does not exist while the **host installs 40 skills there** — so a
  session was told to ignore `pdf`, `docx`, `xlsx`, `pptx` and the `grdf-*` org workflows. **A
  false-absence claim is as harmful as a false-presence one, and this class needed three passes to clear.**
- **Full autonomy, ruled: `deny` stays empty** — in the web container a denied command is one *nobody* can
  run. The allow list goes 13 → 85, staged as `settings.json.pending` because the classifier blocks Claude
  from writing its own permission surface (a platform guard, not repo policy — do not work around it).
  **Describe that list honestly**: it is not "read-only", and `bash:*` alone makes the enumeration
  containment-free. An earlier draft of that bullet said "the usual read-only shell tools", which was false
  of 16 entries.
- **A guard suite can be vacuous in a way `bash -n` and a green run never show.** `test-install.sh` case 7
  asserted "exit 0 when var/claude cannot be created" via `chmod 500` — which does not bind root, so it
  passed because the mkdir SUCCEEDED, and the asserted behaviour was in fact false (`set -e` + a failing
  `mkdir` exits 1). Fixed both ends: a file-in-the-way makes it genuinely fail, and the `mkdir` is now
  `|| true` so a hook never loses the session over a scratch directory. Reverting the guard fails exactly
  that case.

### A flaky gate: never scan a whole PDF for a short byte sequence (2026-07-30)

`tests/browser/arabic-overlay.browser.test.ts` asserted
`expect(String.fromCharCode(...bytes)).not.toContain('(?')` — the ENTIRE saved PDF, FlateDecode
streams and the embedded font subset included — to prove the Arabic overlay had not fallen back to a
WinAnsi `?` substitution. Compressed bytes are effectively random, so `0x28 0x3F` appeared by
coincidence: **measured 2 failures in 8 local runs (25%)**, and it took down the CI run for `eabcc3f`.
The product was never wrong; the assertion was. A flaky test in a deploy-blocking pipeline blocks
deploys at random, which is why this is a defect and not a nuisance.

Now scoped to the page content stream, and stated positively:
`expect(stream).toMatch(/<[0-9A-Fa-f]+>\s*Tj/)` plus a negative on a literal-string show op carrying
`?`. **Two non-obvious details:** (1) `page.node.Contents()` is a `PDFArray` of stream refs, so each
must be looked up in `doc.context`; (2) pdf-lib **FlateDecode-compresses the content stream it
writes** (raw bytes open with `78 9C`), so it must be inflated first — `fflate`'s `unzlibSync`, already
a dependency via the DOCX OPC path. Asserting on the raw bytes matches nothing, which is how a first
attempt at this fix went 0/8 instead of 8/8.

Verified non-vacuous: the real stream is
`q BT 0 0 0 rg /NotoNaskhArabic-… 24 Tf 1 0 0 1 231.016 100 Tm <00010002000300040005> Tj ET Q`
(one hex show op, 5 CIDs for the 5 letters), the negative regex flags a synthetic `(?????) Tj`, and
does not match the real stream. 8/8 consecutive runs green.

**The general rule:** a byte-level assertion on a container format must be scoped to the decoded part
it is actually about. Whole-file `toContain` over compressed data is a coin flip.

### i18n

Every user-visible string goes through `t()`; `escapeValue: true` is set
(`i18n.ts:70`) — i18next HTML-escapes interpolated values, so the XSS surface is small.
Still prefer `textContent` over `innerHTML` for any user/translation data, and never
disable escaping. The three locale files must stay key-identical (a hook checks this on
write). **Arabic review status — STRINGS COMPLETE (2026-07-30):** a native speaker reviewed and validated
**all 31 keys** that had carried `ar [Unverified]`, across two rounds (15, then a further 16 that the
first extraction missed: `findReplace.*`, `docxEditor.deleteImage`, `docxToolbar.insertImage`,
`sign.error.UNSUPPORTED_XREF`). Every entry read `ar reviewed 2026-07-30`, and **that review changed no
Arabic value** — the one issue reported turned out not to be one (see the `صف` vs `سطر` note below).
Do not re-add `ar [Unverified]` to an existing key; NEW keys start unverified as before.
**AMENDED 2026-08-05:** three reviewed values HAVE since been changed — `toolbar.cropTitle`,
`toast.modeHint.crop` and `toast.redactionPlaced`, because their wording contradicted the hide-vs-remove
grades (see that § for why). They are single-verb substitutions and were pending a native pass until the
2026-09-13 closure below. So the sign-off is no longer a blanket "nothing changed since"; check the
pending count before assuming a key is reviewed.
**AMENDED 2026-09-13 — WS3 CLOSED by developer ruling** ("consider the arabic review done"): the 15
values that had accumulated since, and the two UNRECONCILED sets, are accepted as reviewed. That is a
RULING, not a second native read — say so whenever citing it. **Pending count: 14** — `toolbar.compressTitle` and `toast.ocrRotatedUnsupported` (re-worded, limits row 30 on 2026-09-27), 
`modal.compress.modeImages` and `modal.compress.hintImages` (new, limits row 27 on 2026-09-27), `toast.flattenAnnotationsSkipped` (new) and `toast.flattenDone` (re-worded), limits row 23 on 2026-09-27,
`progress.ocrLoadingModel` (row 12) and `toolbar.clearRecentFiles` (row 11), added by the limits walkthrough on 2026-09-26, `thumbnail.previewUnavailable`, added by the limits walkthrough (A6) on 2026-09-26, `toast.exportLayersConflict`, added by WS8 on 2026-09-24, `toast.pdfLoadRefused`, added by WS7 round 15 on 2026-09-14, and `toolbar.sanitizeTitle`, re-worded on the closure day to en/fr parity by the session, so it is a new value and
starts unverified, plus the two keys WS7 round 10 added that day (`docxEditor.pdfImagesSkipped`, `toast.sanitizeRefusedInvalidObject`), also
session-written. The count's home is § "The hide-vs-remove audit"; `KNOWN_ISSUES.md` § "Arabic locale strings"
carries a fifth copy (found stale at three on 2026-09-26) — update it with the others.
**Sign-off covers STRING translations only.** The RTL *rendering* ceilings are untouched by it and
remain open: C18 (per-glyph select/copy/search precision); bracket mirroring in the overlay, RTL list-marker
placement and C19 (tashkeel/GPOS micro-positioning) were fixed by limits row 25. A reviewed string can still render
imperfectly — those are separate, and none of them is a translation pass. **Nor do they need HarfBuzz
(limits row 17, measured 2026-09-27):** fontkit — already the shaper behind pdf-lib's embed — produced HarfBuzz's
glyphs and positions exactly on Noto Naskh (5 strings, 69 glyphs, 0.00 pt apart). The tashkeel error (up to 12.25 pt
at 24 pt) is pdf-lib drawing fontkit's glyphs with their plain advances and dropping the GPOS offsets, so C19 was
fixed from fontkit's own `layout().positions` (row 25 — § "Tashkeel placed by GPOS in the Arabic overlay"). C18 is not a shaping
problem: the glyphs and their positions come from the PDF, and what is missing is per-character advances inside a
pdf.js text item. **The same row measured PDFium and did not adopt it** — 2.1 MB gzip of wasm, and on 729 corpus
runs replaced by themselves reversed it kept font, ink, text and width on 474 (65%); on 222 runs containing spaces the
space read back as `ÿ` and the width changed [Inferred cause: the subset has no space glyph]. What it would have
bought is keeping an embedded SIMPLE font in place, which our engine never does today — measured by running
`replaceTextAt` on each of the 630 runs it located, alone on a fresh document: 608 substituted, 22 refused, 0 in
place. Of those, 171 carry a ToUnicode that encodes the edit, and all 171 are literal-string operands, which Path 2
could not rewrite then (`replaceShowOpHex` took hex only — fixed by row 38): 170 substituted, 1 refused. The other 459 have no ToUnicode.
Rows 38–39 close both in our own engine, within C1's floor: row 39 edits a no-ToUnicode run in place only with codes
its stream already draws (147 of 459 for a realistic one-letter edit, 459 of 459 for its own reversed text). Report and scripts:
`var/claude/d2/` (gitignored); the probes are not committed.

**`صف` (table row) vs `سطر` (text line) — do not "fix" one into the other.** The reviewer flagged
`docxToolbar.addRow`/`deleteRow` as needing `سطر`, reading the French gloss *"Ajouter une ligne"*
— French *ligne* is ambiguous. Those buttons call `addRowAfter`/`deleteRow` from
**prosemirror-tables**, so they are TABLE rows and `صف` is correct; `formatting.lineSpacingLabel`
already uses `أسطر` for genuine text lines. Confirmed keep-`صف` by the reviewer. The file is
internally consistent on this distinction — preserve it.

### PWA is `registerType: 'prompt'`

(`vite.config.ts:12`) — a new deploy does NOT silently
swap open sessions; the SW waits and the app surfaces an update prompt (`toast.appUpdateAvailable`).
Pushes to `master` are still production releases (auto-deployed via GitHub Pages), but open
clients update only on user action / next load, not instantly.
